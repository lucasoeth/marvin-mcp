/**
 * Project-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { MarvinAPI } from "../marvin-api.js";
import {
  CreateProjectArgs,
  UpdateProjectArgs,
  CreateProjectArgsSchema,
  UpdateProjectArgsSchema
} from "../types/tools.js";
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
    inputSchema: zodToJsonSchema(CreateProjectArgsSchema as any, {
      $refStrategy: "none",
    }) as any,
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
    inputSchema: zodToJsonSchema(UpdateProjectArgsSchema as any, {
      $refStrategy: "none",
    }) as any,
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
        // Validate with Zod
        const validated = CreateProjectArgsSchema.parse(args);
        const project = await this.marvin.createProject(validated);
        
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
        // Validate with Zod
        const validated = UpdateProjectArgsSchema.parse(args);

        const updates: Record<string, unknown> = {};
        if (validated.title !== undefined) updates.title = validated.title;
        if (validated.priority !== undefined) updates.priority = validated.priority;
        if (validated.day !== undefined) updates.day = validated.day;
        if (validated.dueDate !== undefined) updates.dueDate = validated.dueDate;
        if (validated.note !== undefined) updates.note = validated.note;

        await this.marvin.updateDocument(validated.projectId, updates);
        return `Project ${validated.projectId} updated successfully!`;
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
