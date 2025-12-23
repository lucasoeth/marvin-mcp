/**
 * Project-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "../marvin-api.js";
import { CreateProjectArgs, UpdateProjectArgs } from "../types/tools.js";
import { validateDate, validateId, validateProjectPriority, assertValid } from "../utils/validation.js";
import { formatProject, formatList } from "../utils/formatting.js";
import { handleToolExecution } from "../utils/errors.js";

/**
 * Tool definitions for project operations
 */
export const projectTools: Tool[] = [
  {
    name: "marvin_create_project",
    description: "Create a new project in Amazing Marvin.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Project title",
        },
        parentId: {
          type: "string",
          description: "ID of parent category or project for nesting",
        },
        priority: {
          type: "string",
          enum: ["high", "mid", "low"],
          description: "Project priority level",
        },
        day: {
          type: "string",
          description: "Scheduled date in YYYY-MM-DD format",
        },
        dueDate: {
          type: "string",
          description: "Due date in YYYY-MM-DD format",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "marvin_get_project",
    description: "Get detailed information about a specific project by ID.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The ID of the project to retrieve",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "marvin_update_project",
    description: "Update an existing project in Amazing Marvin.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The ID of the project to update",
        },
        title: {
          type: "string",
          description: "New title for the project",
        },
        priority: {
          type: "string",
          enum: ["high", "mid", "low"],
          description: "New priority level",
        },
        day: {
          type: "string",
          description: "New scheduled date in YYYY-MM-DD format",
        },
        dueDate: {
          type: "string",
          description: "New due date in YYYY-MM-DD format",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "marvin_delete_project",
    description: "Delete a project from Amazing Marvin permanently.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The ID of the project to delete",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "marvin_get_children",
    description:
      "Get all child items (tasks and projects) under a parent category or project.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: {
          type: "string",
          description: "The ID of the parent category or project",
        },
      },
      required: ["parentId"],
    },
  },
];

/**
 * Project tool handlers
 */
export class ProjectHandlers {
  constructor(private marvin: MarvinAPI) {}

  async createProject(args: CreateProjectArgs): Promise<CallToolResult> {
    return handleToolExecution(
      "create project",
      async () => {
        // Validate inputs
        if (args.day) {
          assertValid(validateDate(args.day), `Invalid date format for day: ${args.day}. Use YYYY-MM-DD`);
        }
        if (args.dueDate) {
          assertValid(validateDate(args.dueDate), `Invalid date format for dueDate: ${args.dueDate}. Use YYYY-MM-DD`);
        }
        if (args.priority) {
          assertValid(validateProjectPriority(args.priority), `Priority must be "high", "mid", or "low"`);
        }

        const project = await this.marvin.createProject(args);
        
        return `Project created successfully!

ID: ${project._id}
Title: ${project.title}${project.priority ? `\nPriority: ${project.priority}` : ""}`;
      },
      (result) => result
    );
  }

  async getProject(projectId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "get project",
      async () => {
        assertValid(validateId(projectId), "Project ID is required and must be non-empty");
        const project = await this.marvin.getDocument<Record<string, unknown>>(projectId);
        return `Project details:\n\n${JSON.stringify(project, null, 2)}`;
      },
      (result) => result
    );
  }

  async updateProject(args: UpdateProjectArgs): Promise<CallToolResult> {
    return handleToolExecution(
      "update project",
      async () => {
        assertValid(validateId(args.projectId), "Project ID is required and must be non-empty");

        // Validate optional fields
        if (args.day) {
          assertValid(validateDate(args.day), `Invalid date format for day: ${args.day}. Use YYYY-MM-DD`);
        }
        if (args.dueDate) {
          assertValid(validateDate(args.dueDate), `Invalid date format for dueDate: ${args.dueDate}. Use YYYY-MM-DD`);
        }
        if (args.priority) {
          assertValid(validateProjectPriority(args.priority), `Priority must be "high", "mid", or "low"`);
        }

        const updates: Record<string, unknown> = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.priority !== undefined) updates.priority = args.priority;
        if (args.day !== undefined) updates.day = args.day;
        if (args.dueDate !== undefined) updates.dueDate = args.dueDate;

        await this.marvin.updateDocument(args.projectId, updates);
        return `Project ${args.projectId} updated successfully!`;
      },
      (result) => result
    );
  }

  async deleteProject(projectId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "delete project",
      async () => {
        assertValid(validateId(projectId), "Project ID is required and must be non-empty");
        await this.marvin.deleteDocument(projectId);
        return `Project ${projectId} deleted successfully!`;
      },
      (result) => result
    );
  }

  async getChildren(parentId: string): Promise<CallToolResult> {
    return handleToolExecution(
      "get children",
      async () => {
        assertValid(validateId(parentId), "Parent ID is required and must be non-empty");
        const children = await this.marvin.getChildren(parentId);
        return formatList(
          children,
          (item) => `- ${item.title} (ID: ${item._id})`,
          `Children of ${parentId}`,
          "No items found under this parent."
        );
      },
      (result) => result
    );
  }
}
