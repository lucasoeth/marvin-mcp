#!/usr/bin/env node

/**
 * Amazing Marvin Remote MCP Server
 *
 * A remote HTTP server that exposes the Marvin MCP tools over the internet
 * using Streamable HTTP transport. Supports multiple concurrent users with
 * session management and authentication.
 */

import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
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

// User credentials mapping - in production, use a database
interface UserCredentials {
  apiToken: string;
  fullAccessToken: string;
  userId: string;
}

// Simple in-memory token store - replace with database in production
const authorizedTokens = new Map<string, UserCredentials>();

// Session management
interface Session {
  sessionId: string;
  userId: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: Date;
  lastActivity: Date;
}

const sessions = new Map<string, Session>();

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

// Authentication middleware
async function authenticate(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers["authorization"];

  if (!authHeader?.startsWith("Bearer ")) {
    return res
      .status(401)
      .header("WWW-Authenticate", 'Bearer realm="Marvin MCP Server"')
      .json({
        error: "Missing authentication",
        message: "Please provide a Bearer token in the Authorization header",
      });
  }

  const token = authHeader.substring(7);
  const userCreds = authorizedTokens.get(token);

  if (!userCreds) {
    return res.status(401).json({
      error: "Invalid token",
      message: "The provided authentication token is not valid",
    });
  }

  // Attach user credentials to request
  (req as any).userCredentials = userCreds;
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

// Combine all tools
const allTools = [
  ...taskTools,
  ...projectTools,
  ...categoryTools,
  ...labelTools,
  ...accountTools,
];

/**
 * Factory function to create an MCP server instance for a user
 */
function createMcpServerForUser(
  apiToken: string,
  fullAccessToken: string
): McpServer {
  const marvin = new MarvinAPI(apiToken, fullAccessToken);

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
 * POST /mcp - Main MCP endpoint for requests
 */
app.post("/mcp", authenticate, async (req, res) => {
  const userCreds = (req as any).userCredentials as UserCredentials;
  const sessionIdHeader = req.headers["mcp-session-id"] as string | undefined;
  const body = req.body;

  try {
    let session: Session;
    const isInitialize = body?.method === "initialize";

    // Check if this is a new session or existing
    if (sessionIdHeader && sessions.has(sessionIdHeader)) {
      // Existing session
      session = sessions.get(sessionIdHeader)!;
      session.lastActivity = new Date();
    } else if (!isInitialize) {
      // Non-initialize request without valid session
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "No valid session. Please initialize first.",
        },
        id: body?.id,
      });
    } else {
      // New session - create MCP server instance for this user
      const sessionId = uuidv4();
      const mcpServer = createMcpServerForUser(
        userCreds.apiToken,
        userCreds.fullAccessToken
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });

      await mcpServer.connect(transport);

      session = {
        sessionId,
        userId: userCreds.userId,
        transport,
        server: mcpServer,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      sessions.set(sessionId, session);

      console.log(
        `Created new session ${sessionId} for user ${userCreds.userId}`
      );
    }

    // Handle the request through the transport
    await session.transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
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
 * GET /mcp - SSE endpoint for server-initiated messages
 */
app.get("/mcp", authenticate, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({
      error: "Invalid session",
      message: "No valid session ID provided or session expired",
    });
  }

  const session = sessions.get(sessionId)!;
  session.lastActivity = new Date();

  try {
    // Handle the GET request for SSE stream
    await session.transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error in SSE stream:", error);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

/**
 * DELETE /sessions/:sessionId - Terminate a session
 */
app.delete("/sessions/:sessionId", authenticate, async (req, res) => {
  const { sessionId } = req.params;
  const userCreds = (req as any).userCredentials as UserCredentials;

  if (!sessions.has(sessionId)) {
    return res.status(404).json({
      error: "Session not found",
      message: `No session found with ID: ${sessionId}`,
    });
  }

  const session = sessions.get(sessionId)!;

  // Verify user owns this session
  if (session.userId !== userCreds.userId) {
    return res.status(403).json({
      error: "Forbidden",
      message: "You do not have permission to delete this session",
    });
  }

  // Close the session
  try {
    await session.transport.close();
    sessions.delete(sessionId);
    console.log(
      `Session ${sessionId} terminated by user ${userCreds.userId}`
    );
    res.status(204).end();
  } catch (error) {
    console.error("Error closing session:", error);
    res.status(500).json({
      error: "Failed to close session",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /health - Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeSessions: sessions.size,
    uptime: process.uptime(),
  });
});

/**
 * GET /stats - Statistics endpoint (authenticated)
 */
app.get("/stats", authenticate, (req, res) => {
  const userCreds = (req as any).userCredentials as UserCredentials;

  // Get user's sessions
  const userSessions = Array.from(sessions.values()).filter(
    (s) => s.userId === userCreds.userId
  );

  res.json({
    userId: userCreds.userId,
    activeSessions: userSessions.length,
    sessions: userSessions.map((s) => ({
      sessionId: s.sessionId,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    })),
  });
});

/**
 * POST /admin/tokens - Create a new authentication token (admin only)
 * In production, this should be replaced with proper user management
 */
app.post("/admin/tokens", async (req, res) => {
  const { apiToken, fullAccessToken, userId, adminSecret } = req.body;

  // Simple admin authentication - replace with proper auth in production
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Invalid admin credentials",
    });
  }

  if (!apiToken || !fullAccessToken || !userId) {
    return res.status(400).json({
      error: "Bad request",
      message: "apiToken, fullAccessToken, and userId are required",
    });
  }

  // Generate a new token
  const token = uuidv4();

  authorizedTokens.set(token, {
    apiToken,
    fullAccessToken,
    userId,
  });

  console.log(`Created new authentication token for user ${userId}`);

  res.json({
    token,
    userId,
    message: "Token created successfully",
  });
});

/**
 * Session cleanup - remove inactive sessions
 */
const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = new Date();
  const expiredSessions: string[] = [];

  for (const [sessionId, session] of sessions.entries()) {
    const inactiveTime = now.getTime() - session.lastActivity.getTime();
    if (inactiveTime > SESSION_TIMEOUT) {
      expiredSessions.push(sessionId);
    }
  }

  for (const sessionId of expiredSessions) {
    const session = sessions.get(sessionId)!;
    session.transport.close().catch(console.error);
    sessions.delete(sessionId);
    console.log(`Cleaned up expired session ${sessionId}`);
  }

  if (expiredSessions.length > 0) {
    console.log(`Cleaned up ${expiredSessions.length} expired sessions`);
  }
}, 10 * 60 * 1000); // Check every 10 minutes

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
📡 Transport: HTTP + SSE
🔒 Authentication: Bearer Token

Endpoints:
  POST   /mcp              - Main MCP endpoint
  GET    /mcp              - SSE stream endpoint
  DELETE /sessions/:id     - Terminate session
  GET    /health           - Health check
  GET    /stats            - User statistics
  POST   /admin/tokens     - Create auth token (admin)

Active sessions: ${sessions.size}
  `);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");

  // Close all sessions
  for (const session of sessions.values()) {
    await session.transport.close();
  }

  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\nSIGINT received, shutting down gracefully...");

  // Close all sessions
  for (const session of sessions.values()) {
    await session.transport.close();
  }

  process.exit(0);
});
