/**
 * Task-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "../marvin-api.js";
import { CreateTaskArgs, UpdateTaskArgs } from "../types/tools.js";
import { validateDate, validateId, validatePriority, validateTimeEstimate, assertValid } from "../utils/validation.js";
import { formatTask, formatList, formatTaskDetails } from "../utils/formatting.js";
import { handleToolExecution } from "../utils/errors.js";

/**
 * Tool definitions for task operations
 */
export const taskTools: Tool[] = [
  {
    name: "marvin_create_task",
    description:
      "Create a new task in Amazing Marvin. Supports inline syntax in title like '+today' for scheduling, '#Category' for categorization, and '@label' for labels.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Task title. Can include inline syntax like '+today', '+tomorrow', '#CategoryName', '@labelName'",
        },
        day: {
          type: "string",
          description: "Scheduled date in YYYY-MM-DD format (e.g., '2024-01-15')",
        },
        dueDate: {
          type: "string",
          description: "Due date in YYYY-MM-DD format",
        },
        timeEstimate: {
          type: "number",
          description: "Estimated time in minutes",
        },
        parentId: {
          type: "string",
          description: "ID of parent project or category",
        },
        labelIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of label IDs to attach",
        },
        note: {
          type: "string",
          description: "Additional notes for the task",
        },
        isStarred: {
          type: "number",
          enum: [1, 2, 3],
          description: "Priority level: 1=yellow (low), 2=orange (medium), 3=red (high)",
        },
      },
      required: ["title"],
    },
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
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to update",
        },
        title: {
          type: "string",
          description: "New title for the task",
        },
        day: {
          type: "string",
          description: "New scheduled date in YYYY-MM-DD format",
        },
        dueDate: {
          type: "string",
          description: "New due date in YYYY-MM-DD format",
        },
        timeEstimate: {
          type: "number",
          description: "New time estimate in minutes",
        },
        note: {
          type: "string",
          description: "New notes for the task",
        },
        parentId: {
          type: "string",
          description: "New parent project or category ID",
        },
        labelIds: {
          type: "array",
          items: { type: "string" },
          description: "New array of label IDs",
        },
        isStarred: {
          type: "number",
          enum: [0, 1, 2, 3],
          description: "Priority level: 0=none, 1=yellow, 2=orange, 3=red",
        },
      },
      required: ["taskId"],
    },
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
        // Validate inputs
        if (args.day) {
          assertValid(validateDate(args.day), `Invalid date format for day: ${args.day}. Use YYYY-MM-DD`);
        }
        if (args.dueDate) {
          assertValid(validateDate(args.dueDate), `Invalid date format for dueDate: ${args.dueDate}. Use YYYY-MM-DD`);
        }
        if (args.timeEstimate !== undefined) {
          assertValid(validateTimeEstimate(args.timeEstimate), `Time estimate must be a positive number`);
        }
        if (args.isStarred !== undefined) {
          assertValid(validatePriority(args.isStarred), `Priority (isStarred) must be 1, 2, or 3`);
        }

        const task = await this.marvin.createTask(args);

        return `Task created successfully!

ID: ${task._id}
Title: ${task.title}${task.day ? `\nScheduled: ${task.day}` : ""}${task.dueDate ? `\nDue: ${task.dueDate}` : ""}${task.isStarred ? `\nPriority: ${task.isStarred}` : ""}`;
      }
    );
  }

  async getTodayTasks(): Promise<CallToolResult> {
    return handleToolExecution(
      "get today's tasks",
      async () => {
        const tasks = await this.marvin.getTodayTasks();
        return formatList(tasks, formatTask, "Today's tasks", "No tasks scheduled for today.");
      }
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
      }
    );
  }

  async completeTask(taskId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "complete task",
      async () => {
        assertValid(validateId(taskId), "Task ID is required and must be non-empty");
        await this.marvin.completeTask(taskId);
        return `Task ${taskId} marked as complete!`;
      }
    );
  }

  async updateTask(args: UpdateTaskArgs): Promise<CallToolResult> {
    return handleToolExecution(
      "update task",
      async () => {
        assertValid(validateId(args.taskId), "Task ID is required and must be non-empty");

        // Validate optional fields
        if (args.day) {
          assertValid(validateDate(args.day), `Invalid date format for day: ${args.day}. Use YYYY-MM-DD`);
        }
        if (args.dueDate) {
          assertValid(validateDate(args.dueDate), `Invalid date format for dueDate: ${args.dueDate}. Use YYYY-MM-DD`);
        }
        if (args.timeEstimate !== undefined) {
          assertValid(validateTimeEstimate(args.timeEstimate), `Time estimate must be a positive number`);
        }

        const updates: Record<string, unknown> = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.day !== undefined) updates.day = args.day;
        if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
        if (args.timeEstimate !== undefined) updates.timeEstimate = args.timeEstimate;
        if (args.note !== undefined) updates.note = args.note;
        if (args.parentId !== undefined) updates.parentId = args.parentId;
        if (args.labelIds !== undefined) updates.labelIds = args.labelIds;
        if (args.isStarred !== undefined) updates.isStarred = args.isStarred;

        await this.marvin.updateDocument(args.taskId, updates);
        return `Task ${args.taskId} updated successfully!`;
      }
    );
  }

  async deleteTask(taskId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "delete task",
      async () => {
        assertValid(validateId(taskId), "Task ID is required and must be non-empty");
        await this.marvin.deleteDocument(taskId);
        return `Task ${taskId} deleted successfully!`;
      }
    );
  }

  async getTask(taskId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "get task",
      async () => {
        assertValid(validateId(taskId), "Task ID is required and must be non-empty");
        const task = await this.marvin.getDocument<any>(taskId);
        return formatTaskDetails(task);
      }
    );
  }

  async getInboxTasks(): Promise<CallToolResult> {
    return handleToolExecution(
      "get inbox tasks",
      async () => {
        const tasks = await this.marvin.getInboxTasks();
        return formatList(tasks, formatTask, "Inbox tasks", "No tasks in inbox.");
      }
    );
  }

  async searchTasks(query: string): Promise<CallToolResult> {
    return handleToolExecution(
      "search tasks",
      async () => {
        assertValid(!!query && query.trim().length > 0, "Search query is required");
        const tasks = await this.marvin.searchTasks(query);
        return formatList(tasks, formatTask, `Tasks matching "${query}"`, `No tasks found matching "${query}".`);
      }
    );
  }

  async getTasksByDate(date: string): Promise<CallToolResult> {
    return handleToolExecution(
      "get tasks by date",
      async () => {
        assertValid(validateDate(date), `Invalid date format: ${date}. Use YYYY-MM-DD`);
        const tasks = await this.marvin.getTasksByDate(date);
        return formatList(tasks, formatTask, `Tasks for ${date}`, `No tasks scheduled for ${date}.`);
      }
    );
  }

  async getAllTasks(): Promise<CallToolResult> {
    return handleToolExecution(
      "get all tasks",
      async () => {
        const tasks = await this.marvin.getAllTasks();
        return formatList(tasks, formatTask, "All tasks", "No tasks found.");
      }
    );
  }
}
