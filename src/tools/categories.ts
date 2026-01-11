/**
 * Category-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "../marvin-api.js";
import { CreateCategoryArgs, CreateCategoryArgsSchema } from "../types/tools.js";
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
    inputSchema: CreateCategoryArgsSchema.toJSONSchema() as any,
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

  async createCategory(args: CreateCategoryArgs): Promise<CallToolResult> {
    return handleToolExecution(
      "create category",
      async () => {
        // Validate with Zod
        const validated = CreateCategoryArgsSchema.parse(args);
        const category = await this.marvin.createCategory(validated);
        return formatCategory(category);
      },
      (result) => result
    );
  }
}
