/**
 * Label-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "../marvin-api.js";
import { formatLabel, formatList } from "../utils/formatting.js";
import { handleToolExecution } from "../utils/errors.js";

/**
 * Tool definitions for label operations
 */
export const labelTools: Tool[] = [
  {
    name: "marvin_get_labels",
    description:
      "Get all labels in Amazing Marvin. Labels can be attached to tasks for additional organization.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Label tool handlers
 */
export class LabelHandlers {
  constructor(private marvin: MarvinAPI) {}

  async getLabels(): Promise<CallToolResult> {
    return handleToolExecution(
      "get labels",
      async () => {
        const labels = await this.marvin.getLabels();
        return formatList(labels, formatLabel, "Labels", "No labels found.");
      }
    );
  }
}
