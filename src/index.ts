#!/usr/bin/env node

/**
 * Amazing Marvin MCP Server
 *
 * An MCP server that provides tools for managing tasks, projects,
 * categories, and labels in Amazing Marvin.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { CreateTaskArgs, UpdateTaskArgs, CreateProjectArgs, UpdateProjectArgs, CreateCategoryArgs } from "./types/tools.js";
import { createErrorResponse } from "./utils/errors.js";

// Environment variables for authentication
const API_TOKEN = process.env.MARVIN_API_TOKEN;
const FULL_ACCESS_TOKEN = process.env.MARVIN_FULL_ACCESS_TOKEN;

if (!API_TOKEN || !FULL_ACCESS_TOKEN) {
  console.error("Error: Missing required environment variables.");
  console.error("Please set MARVIN_API_TOKEN and MARVIN_FULL_ACCESS_TOKEN");
  process.exit(1);
}

const marvin = new MarvinAPI(API_TOKEN, FULL_ACCESS_TOKEN);

// Initialize handlers
const taskHandlers = new TaskHandlers(marvin);
const projectHandlers = new ProjectHandlers(marvin);
const categoryHandlers = new CategoryHandlers(marvin);
const labelHandlers = new LabelHandlers(marvin);
const accountHandlers = new AccountHandlers(marvin);

// Combine all tools
const tools = [
  ...taskTools,
  ...projectTools,
  ...categoryTools,
  ...labelTools,
  ...accountTools,
];

// Create and configure the server
const mcpServer = new McpServer(
  {
    name: "marvin-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Access the underlying server for low-level request handlers
const server = mcpServer.server;

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ============ Task Handlers ============
      case "marvin_create_task":
        return await taskHandlers.createTask(args as unknown as CreateTaskArgs);
      case "marvin_get_today_tasks":
        return await taskHandlers.getTodayTasks();
      case "marvin_get_due_tasks":
        return await taskHandlers.getDueTasks();
      case "marvin_complete_task":
        return await taskHandlers.completeTask(args?.taskId as string);
      case "marvin_update_task":
        return await taskHandlers.updateTask(args as unknown as UpdateTaskArgs);
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
        return await projectHandlers.createProject(args as unknown as CreateProjectArgs);
      case "marvin_get_project":
        return await projectHandlers.getProject(args?.projectId as string);
      case "marvin_update_project":
        return await projectHandlers.updateProject(args as unknown as UpdateProjectArgs);
      case "marvin_delete_project":
        return await projectHandlers.deleteProject(args?.projectId as string);
      case "marvin_get_children":
        return await projectHandlers.getChildren(args?.parentId as string);

      // ============ Category Handlers ============
      case "marvin_get_hierarchy":
        return await categoryHandlers.getCategories();
      case "marvin_create_category":
        return await categoryHandlers.createCategory(args as unknown as CreateCategoryArgs);

      // ============ Label Handlers ============
      case "marvin_get_labels":
        return await labelHandlers.getLabels();

      // ============ Account Handlers ============
      case "marvin_test_connection":
        return await accountHandlers.testConnection();

      default:
        return createErrorResponse("execute tool", new Error(`Unknown tool: ${name}`));
    }
  } catch (error) {
    return createErrorResponse("execute tool", error);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("Amazing Marvin MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
