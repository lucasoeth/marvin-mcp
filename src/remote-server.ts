#!/usr/bin/env node

/**
 * Amazing Marvin Remote MCP Server
 *
 * A remote HTTP server that exposes the Marvin MCP tools over the internet
 * using Streamable HTTP transport with SSE support.
 * Simple single-user setup.
 */

import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "./marvin-api.js";
import { taskTools, TaskHandlers } from "./tools/tasks.js";
import { projectTools, ProjectHandlers } from "./tools/projects.js";
import { categoryTools, CategoryHandlers } from "./tools/categories.js";
import { labelTools, LabelHandlers } from "./tools/labels.js";
import { accountTools, AccountHandlers } from "./tools/account.js";
import {
  CreateTaskArgs,
  UpdateTaskArgs,
  CreateProjectArgs,
  UpdateProjectArgs,
  CreateCategoryArgs,
} from "./types/tools.js";
import { createErrorResponse } from "./utils/errors.js";

// Configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || ["*"];

// Marvin API credentials (single-user mode)
const MARVIN_API_TOKEN = process.env.MARVIN_API_TOKEN;
const MARVIN_FULL_ACCESS_TOKEN = process.env.MARVIN_FULL_ACCESS_TOKEN;
const API_KEY = process.env.API_KEY; // Optional API key for authentication

// Validate required credentials
if (!MARVIN_API_TOKEN || !MARVIN_FULL_ACCESS_TOKEN) {
  console.error("Error: Missing required environment variables.");
  console.error("Please set MARVIN_API_TOKEN and MARVIN_FULL_ACCESS_TOKEN");
  process.exit(1);
}

// Session management for SSE support
interface Session {
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer;
  createdAt: Date;
}

const sessions = new Map<string, Session>();

// Clean up stale sessions (older than 30 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  for (const [sessionId, session] of sessions) {
    if (now - session.createdAt.getTime() > maxAge) {
      console.log(`[Session] Cleaning up stale session: ${sessionId}`);
      session.transport.close();
      sessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration
app.use(
  cors({
    origin: ALLOWED_ORIGINS[0] === "*" ? "*" : ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Mcp-Session-Id",
      "Accept",
      "Cache-Control",
      "Last-Event-ID",
    ],
    exposedHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
  })
);

// Trust proxy (needed for Coolify/reverse proxy)
app.set("trust proxy", true);

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// Authentication middleware (optional - only if API_KEY is set)
async function authenticate(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  // If no API_KEY is set, allow all requests
  if (!API_KEY) {
    return next();
  }

  // Check for API key in multiple locations for compatibility
  // 1. Authorization Bearer header (Poke.com standard)
  const authHeader = req.header("authorization");
  let providedKey: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    providedKey = authHeader.substring(7); // Remove "Bearer " prefix
  }

  // 2. Query param 'token' (fallback for other clients)
  if (!providedKey) {
    providedKey = req.query.token as string | undefined;
  }

  if (!providedKey) {
    return res.status(401).json({
      error: "Missing authentication",
      message: "Please provide an API key in the Authorization header (Bearer token) or 'token' query parameter",
    });
  }

  if (providedKey !== API_KEY) {
    return res.status(401).json({
      error: "Invalid API key",
      message: "The provided API key is not valid",
    });
  }

  next();
}

// HTTPS enforcement in production
app.use((req, res, next) => {
  if (
    NODE_ENV === "production" &&
    req.header("x-forwarded-proto") !== "https"
  ) {
    return res.status(403).json({
      error: "HTTPS required",
      message: "This server requires HTTPS in production",
    });
  }
  next();
});

// Fix Accept header for MCP SDK compatibility
// The MCP SDK strictly requires Accept: application/json, text/event-stream
// Some clients (like Poke) may not send this header, so we ensure it's present
app.use("/mcp", (req, res, next) => {
  const acceptHeader = req.header("accept") || "";

  // If the Accept header is missing or doesn't include required types, fix it
  const hasJson = acceptHeader.includes("application/json");
  const hasSSE = acceptHeader.includes("text/event-stream");

  if (!hasJson || !hasSSE) {
    // Set the required Accept header
    req.headers.accept = "application/json, text/event-stream";
    console.log(`[MCP] Fixed Accept header from: "${acceptHeader}" to: "application/json, text/event-stream"`);
  }

  next();
});

// Combine all tools
const allTools = [
  ...taskTools,
  ...projectTools,
  ...categoryTools,
  ...labelTools,
  ...accountTools,
];

/**
 * Factory function to create an MCP server instance
 */
function createMcpServer(): McpServer {
  const marvin = new MarvinAPI(MARVIN_API_TOKEN!, MARVIN_FULL_ACCESS_TOKEN!);

  // Initialize handlers
  const taskHandlers = new TaskHandlers(marvin);
  const projectHandlers = new ProjectHandlers(marvin);
  const categoryHandlers = new CategoryHandlers(marvin);
  const labelHandlers = new LabelHandlers(marvin);
  const accountHandlers = new AccountHandlers(marvin);

  // Create MCP server
  const mcpServer = new McpServer(
    {
      name: "marvin-mcp-remote",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const server = mcpServer.server;

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // ============ Task Handlers ============
        case "marvin_create_task":
          return await taskHandlers.createTask(
            args as unknown as CreateTaskArgs
          );
        case "marvin_get_today_tasks":
          return await taskHandlers.getTodayTasks();
        case "marvin_get_due_tasks":
          return await taskHandlers.getDueTasks();
        case "marvin_complete_task":
          return await taskHandlers.completeTask(args?.taskId as string);
        case "marvin_update_task":
          return await taskHandlers.updateTask(
            args as unknown as UpdateTaskArgs
          );
        case "marvin_delete_task":
          return await taskHandlers.deleteTask(args?.taskId as string);
        case "marvin_get_task":
          return await taskHandlers.getTask(args?.taskId as string);
        case "marvin_get_inbox":
          return await taskHandlers.getInboxTasks();
        case "marvin_search_tasks":
          return await taskHandlers.searchTasks(args?.query as string);
        case "marvin_get_tasks_by_date":
          return await taskHandlers.getTasksByDate(args?.date as string);
        case "marvin_get_all_tasks":
          return await taskHandlers.getAllTasks();

        // ============ Project Handlers ============
        case "marvin_create_project":
          return await projectHandlers.createProject(
            args as unknown as CreateProjectArgs
          );
        case "marvin_get_project":
          return await projectHandlers.getProject(args?.projectId as string);
        case "marvin_update_project":
          return await projectHandlers.updateProject(
            args as unknown as UpdateProjectArgs
          );
        case "marvin_delete_project":
          return await projectHandlers.deleteProject(args?.projectId as string);
        case "marvin_get_children":
          return await projectHandlers.getChildren(args?.parentId as string);

        // ============ Category Handlers ============
        case "marvin_get_hierarchy":
          return await categoryHandlers.getCategories();
        case "marvin_create_category":
          return await categoryHandlers.createCategory(
            args as unknown as CreateCategoryArgs
          );

        // ============ Label Handlers ============
        case "marvin_get_labels":
          return await labelHandlers.getLabels();

        // ============ Account Handlers ============
        case "marvin_test_connection":
          return await accountHandlers.testConnection();

        default:
          return createErrorResponse(
            "execute tool",
            new Error(`Unknown tool: ${name}`)
          );
      }
    } catch (error) {
      return createErrorResponse("execute tool", error);
    }
  });

  return mcpServer;
}

/**
 * POST /mcp - Main MCP endpoint for requests (with session support for SSE)
 */
app.post("/mcp", authenticate, async (req, res) => {
  console.error(`[MCP] Incoming POST request: ${req.method} ${req.url}`);

  try {
    // Check if there's an existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      const session = sessions.get(sessionId)!;
      console.error(`[MCP] Reusing existing session: ${sessionId}`);
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // Create a new session with transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Create a new MCP server instance
    const mcpServer = createMcpServer();

    // Connect server to transport
    await mcpServer.connect(transport);

    // Handle the MCP request
    await transport.handleRequest(req, res, req.body);

    // Store session for future requests (including SSE)
    const newSessionId = transport.sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, {
        transport,
        mcpServer,
        createdAt: new Date(),
      });
      console.error(`[MCP] Created new session: ${newSessionId}`);
    }

    console.error(`[MCP] POST request handled successfully`);
  } catch (error) {
    console.error("Error handling MCP POST request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  }
});

/**
 * GET /mcp - SSE endpoint for server-to-client streaming
 */
app.get("/mcp", authenticate, async (req, res) => {
  console.error(`[MCP] Incoming GET request (SSE): ${req.url}`);

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({
      error: "Invalid session",
      message: "Please provide a valid Mcp-Session-Id header. Create a session first with POST /mcp",
    });
  }

  const session = sessions.get(sessionId)!;
  console.error(`[MCP] SSE connection for session: ${sessionId}`);

  // Handle the SSE request
  await session.transport.handleRequest(req, res);

  // Cleanup on connection close
  res.on("close", () => {
    console.error(`[MCP] SSE connection closed for session: ${sessionId}`);
  });
});

/**
 * DELETE /mcp - Session cleanup endpoint
 */
app.delete("/mcp", authenticate, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId) {
    return res.status(400).json({
      error: "Missing session ID",
      message: "Please provide a Mcp-Session-Id header",
    });
  }

  const session = sessions.get(sessionId);
  if (session) {
    session.transport.close();
    sessions.delete(sessionId);
    console.error(`[MCP] Session deleted: ${sessionId}`);
    res.status(200).json({ message: "Session deleted" });
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

/**
 * GET /health - Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    mode: "stateful-sse",
    activeSessions: sessions.size,
    uptime: process.uptime(),
  });
});

/**
 * GET /stats - Statistics endpoint (authenticated)
 */
app.get("/stats", authenticate, (req, res) => {
  res.json({
    mode: "stateful-sse",
    activeSessions: sessions.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Start the server
 */
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║   Amazing Marvin Remote MCP Server                   ║
╚═══════════════════════════════════════════════════════╝

🚀 Server running on port ${PORT}
🌍 Environment: ${NODE_ENV}
📡 Transport: HTTP + SSE (Stateful)
🔒 Authentication: Query param 'token'

Endpoints:
  POST   /mcp              - MCP requests (creates session)
  GET    /mcp              - SSE stream (requires session)
  DELETE /mcp              - Delete session
  GET    /health           - Health check
  GET    /stats            - Server statistics

${API_KEY ? "🔐 API Key authentication: ENABLED" : "⚠️  API Key authentication: DISABLED (set API_KEY env var to enable)"}
  `);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\nSIGINT received, shutting down gracefully...");
  process.exit(0);
});
