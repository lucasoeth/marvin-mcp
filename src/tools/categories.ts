/**
 * Category-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "../marvin-api.js";
import { formatCategory, formatList } from "../utils/formatting.js";
import { handleToolExecution } from "../utils/errors.js";

/**
 * Tool definitions for category operations
 */
export const categoryTools: Tool[] = [
  {
    name: "marvin_get_hierarchy",
    description:
      "Get the complete organizational hierarchy in Amazing Marvin (categories and projects). Returns all containers with their type (category/project) and parent relationships. Essential for understanding the workspace structure.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "marvin_create_category",
    description:
      "Create a new category in Amazing Marvin. Categories are organizational containers for tasks and projects.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Category title",
        },
        parentId: {
          type: "string",
          description: "ID of parent category for nesting (optional)",
        },
        color: {
          type: "string",
          description: "Category color (optional)",
        },
      },
      required: ["title"],
    },
  },
];

/**
 * Category tool handlers
 */
export class CategoryHandlers {
  constructor(private marvin: MarvinAPI) {}

  async getCategories(): Promise<CallToolResult> {
    return handleToolExecution(
      "get hierarchy",
      async () => {
        const categories = await this.marvin.getCategories();
        return formatList(categories, formatCategory, "Organizational Hierarchy (Categories & Projects)", "No items found.");
      },
      (result) => result
    );
  }

  async createCategory(args: { title: string; parentId?: string; color?: string }): Promise<CallToolResult> {
    return handleToolExecution(
      "create category",
      async () => {
        const category = await this.marvin.createCategory(args);
        return formatCategory(category);
      },
      (result) => result
    );
  }
}
