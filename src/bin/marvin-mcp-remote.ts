#!/usr/bin/env node
/**
 * Remote MCP server over Streamable HTTP, for clients with no shell access
 * (Poke, mobile). Single user: credentials come from the environment, and
 * API_KEY gates access.
 *
 * Rebuilt on the op registry. Three bugs from the previous implementation are
 * fixed here rather than inherited:
 *   - the auth token was written to stdout on every request via req.url
 *   - sessions expired on age rather than idleness, killing live connections
 *     at the 30 minute mark regardless of activity
 *   - a client that never echoed Mcp-Session-Id created a new server and
 *     transport on every single request, leaking both
 */

import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../adapters/mcp.js";
import { ConfigError, loadCtx } from "../core/context.js";

const PORT = Number(process.env.PORT ?? 3000);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const API_KEY = process.env.API_KEY;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") ?? ["*"];
const IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_MS ?? 30 * 60 * 1000);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 64);

try {
  loadCtx();
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(78);
}

if (!API_KEY) {
  console.error(
    "Refusing to start without API_KEY. This server is reachable from the " +
      "internet and holds write access to your tasks."
  );
  process.exit(78);
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastUsedAt: number;
}

const sessions = new Map<string, Session>();

function touch(session: Session): Session {
  session.lastUsedAt = Date.now();
  return session;
}

function closeSession(id: string, reason: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  void session.transport.close().catch(() => {});
  console.log(`[session] closed ${id} (${reason})`);
}

/** Evict on idleness, not age, so an active connection is never dropped. */
setInterval(() => {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, session] of sessions) {
    if (session.lastUsedAt < cutoff) closeSession(id, "idle");
  }
}, 60_000).unref();

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: ALLOWED_ORIGINS[0] === "*" ? "*" : ALLOWED_ORIGINS,
    credentials: ALLOWED_ORIGINS[0] !== "*",
    methods: ["GET", "POST", "OPTIONS", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Mcp-Session-Id",
      "MCP-Protocol-Version",
      "Accept",
      "Last-Event-ID",
    ],
    exposedHeaders: ["Mcp-Session-Id"],
  })
);

// req.path, never req.url: the token travels in the query string.
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.use((req, res, next) => {
  if (NODE_ENV === "production" && req.header("x-forwarded-proto") !== "https") {
    res.status(403).json({ error: "HTTPS required" });
    return;
  }
  next();
});

/**
 * Prefer `Authorization: Bearer <key>`; accept `?token=` as a fallback.
 *
 * The query parameter is the weaker option and is only still here because some
 * hosted MCP clients cannot set headers on the connection. A key in a URL leaks
 * into access logs, proxy logs, browser history and Referer headers, and there
 * is no way to un-leak it once a log ships somewhere. Anything that can send a
 * header should.
 *
 * The request logger above deliberately prints `req.path` rather than
 * `req.url`, because `req.url` includes the query string and would write the
 * key straight into this server's own logs.
 */
function authenticate(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const header = req.header("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const provided = bearer ?? req.query.token;

  if (typeof provided !== "string" || !timingSafeEqual(provided, API_KEY!)) {
    res.status(401).json({ error: "Invalid or missing token" });
    return;
  }
  next();
}

/** Constant-time compare so the key cannot be recovered by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

app.post("/mcp", authenticate, async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId === "string" && sessions.has(sessionId)) {
      const session = touch(sessions.get(sessionId)!);
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessions.size >= MAX_SESSIONS) {
      res.status(503).json({ error: "Too many active sessions" });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, lastUsedAt: Date.now() });
        console.log(`[session] opened ${id}`);
      },
      onsessionclosed: (id) => closeSession(id, "client closed"),
    });
    const server = createMcpServer(loadCtx);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("POST /mcp failed:", error);
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  }
});

app.get("/mcp", authenticate, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Unknown session; POST /mcp first" });
    return;
  }
  await touch(sessions.get(sessionId)!).transport.handleRequest(req, res);
});

app.delete("/mcp", authenticate, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
    res.status(404).json({ error: "Unknown session" });
    return;
  }
  // Let the transport run the protocol-level teardown before we drop it.
  await sessions.get(sessionId)!.transport.handleRequest(req, res);
  closeSession(sessionId, "deleted");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    activeSessions: sessions.size,
    uptime: process.uptime(),
  });
});

app.listen(PORT, () => {
  console.log(`marvin MCP remote listening on :${PORT} (${NODE_ENV})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    for (const id of [...sessions.keys()]) closeSession(id, "shutdown");
    process.exit(0);
  });
}
