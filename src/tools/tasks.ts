/**
 * Task-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "../marvin-api.js";
import {
  CreateTaskArgs,
  UpdateTaskArgs,
  CreateTaskArgsSchema,
  UpdateTaskArgsSchema
} from "../types/tools.js";
import { validateDate, validateId, validatePriority, validateTimeEstimate, assertValid } from "../utils/validation.js";
import { formatTask, formatList, formatTaskDetails } from "../utils/formatting.js";
import { handleToolExecution, createSuccessResponse, createErrorResponse } from "../utils/errors.js";

/**
 * Tool definitions for task operations
 */
export const taskTools: Tool[] = [
  {
    name: "marvin_create_task",
    description:
      "Create a new task in Amazing Marvin. Supports inline syntax in title like '+today' for scheduling, '#Category' for categorization, and '@label' for labels.",
    inputSchema: CreateTaskArgsSchema.toJSONSchema() as any,
  },
  {
    name: "marvin_get_today_tasks",
    description:
      "Get all tasks scheduled for today in Amazing Marvin. Returns tasks with their IDs, titles, and other details.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "marvin_get_due_tasks",
    description:
      "Get all overdue tasks in Amazing Marvin. Returns tasks that have passed their due date.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "marvin_complete_task",
    description: "Mark a task as complete in Amazing Marvin.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to complete",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "marvin_update_task",
    description:
      "Update an existing task in Amazing Marvin. Can modify title, dates, notes, and other properties.",
    inputSchema: UpdateTaskArgsSchema.toJSONSchema() as any,
  },
  {
    name: "marvin_delete_task",
    description: "Delete a task from Amazing Marvin permanently.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to delete",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "marvin_get_task",
    description: "Get detailed information about a specific task by ID.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to retrieve",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "marvin_get_inbox",
    description:
      "Get tasks from the inbox (tasks without a parent category/project). These are unorganized tasks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "marvin_search_tasks",
    description:
      "Search for tasks by keyword. Searches in task titles and notes. Returns matching tasks from across your workspace.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to match against task titles and notes",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "marvin_get_tasks_by_date",
    description: "Get all tasks scheduled for a specific date.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (e.g., '2024-01-15')",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "marvin_get_all_tasks",
    description:
      "Get all tasks from Amazing Marvin. Aggregates tasks from today, overdue, and all categories. Note: May not include every single task due to API limitations.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Task tool handlers
 */
export class TaskHandlers {
  constructor(private marvin: MarvinAPI) {}

  async createTask(args: CreateTaskArgs): Promise<CallToolResult> {
    return handleToolExecution(
      "create task",
      async () => {
        // Validate with Zod
        const validated = CreateTaskArgsSchema.parse(args);
        const task = await this.marvin.createTask(validated);

        return `Task created successfully!

ID: ${task._id}
Title: ${task.title}${task.day ? `\nScheduled: ${task.day}` : ""}${task.dueDate ? `\nDue: ${task.dueDate}` : ""}${task.isStarred ? `\nPriority: ${task.isStarred}` : ""}`;
      },
      (result) => result
    );
  }

  async getTodayTasks(): Promise<CallToolResult> {
    return handleToolExecution(
      "get today's tasks",
      async () => {
        const tasks = await this.marvin.getTodayTasks();
        return formatList(tasks, formatTask, "Today's tasks", "No tasks scheduled for today.");
      },
      (result) => result
    );
  }

  async getDueTasks(): Promise<CallToolResult> {
    return handleToolExecution(
      "get overdue tasks",
      async () => {
        const tasks = await this.marvin.getDueTasks();
        return formatList(
          tasks,
          (t) => `- ${t.title} (ID: ${t._id}) [Due: ${t.dueDate}]`,
          "Overdue tasks",
          "No overdue tasks."
        );
      },
      (result) => result
    );
  }

  async completeTask(taskId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "complete task",
      async () => {
        assertValid(validateId(taskId), "Task ID is required and must be non-empty");
        await this.marvin.completeTask(taskId);
        return `Task ${taskId} marked as complete!`;
      },
      (result) => result
    );
  }

  async updateTask(args: UpdateTaskArgs): Promise<CallToolResult> {
    return handleToolExecution(
      "update task",
      async () => {
        // Validate with Zod
        const validated = UpdateTaskArgsSchema.parse(args);

        const updates: Record<string, unknown> = {};
        if (validated.title !== undefined) updates.title = validated.title;
        if (validated.day !== undefined) updates.day = validated.day;
        if (validated.dueDate !== undefined) updates.dueDate = validated.dueDate;
        if (validated.timeEstimate !== undefined) updates.timeEstimate = validated.timeEstimate;
        if (validated.note !== undefined) updates.note = validated.note;
        if (validated.parentId !== undefined) updates.parentId = validated.parentId;
        if (validated.labelIds !== undefined) updates.labelIds = validated.labelIds;
        if (validated.isStarred !== undefined) updates.isStarred = validated.isStarred;

        await this.marvin.updateDocument(validated.taskId, updates);
        return `Task ${validated.taskId} updated successfully!`;
      },
      (result) => result
    );
  }

  async deleteTask(taskId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "delete task",
      async () => {
        assertValid(validateId(taskId), "Task ID is required and must be non-empty");
        await this.marvin.deleteDocument(taskId);
        return `Task ${taskId} deleted successfully!`;
      },
      (result) => result
    );
  }

  async getTask(taskId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "get task",
      async () => {
        assertValid(validateId(taskId), "Task ID is required and must be non-empty");
        const task = await this.marvin.getDocument<any>(taskId);
        return formatTaskDetails(task);
      },
      (result) => result
    );
  }

  async getInboxTasks(): Promise<CallToolResult> {
    return handleToolExecution(
      "get inbox tasks",
      async () => {
        const tasks = await this.marvin.getInboxTasks();
        return formatList(tasks, formatTask, "Inbox tasks", "No tasks in inbox.");
      },
      (result) => result
    );
  }

  async searchTasks(query: string): Promise<CallToolResult> {
    return handleToolExecution(
      "search tasks",
      async () => {
        assertValid(!!query && query.trim().length > 0, "Search query is required");
        const tasks = await this.marvin.searchTasks(query);
        return formatList(tasks, formatTask, `Tasks matching "${query}"`, `No tasks found matching "${query}".`);
      },
      (result) => result
    );
  }

  async getTasksByDate(date: string): Promise<CallToolResult> {
    return handleToolExecution(
      "get tasks by date",
      async () => {
        assertValid(validateDate(date), `Invalid date format: ${date}. Use YYYY-MM-DD`);
        const tasks = await this.marvin.getTasksByDate(date);
        return formatList(tasks, formatTask, `Tasks for ${date}`, `No tasks scheduled for ${date}.`);
      },
      (result) => result
    );
  }

  async getAllTasks(): Promise<CallToolResult> {
    return handleToolExecution(
      "get all tasks",
      async () => {
        const tasks = await this.marvin.getAllTasks();
        return formatList(tasks, formatTask, "All tasks", "No tasks found.");
      },
      (result) => result
    );
  }
}
