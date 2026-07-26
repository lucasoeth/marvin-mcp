/**
 * Account-related MCP tools
 */

import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MarvinAPI } from "../marvin-api.js";
import { handleToolExecution } from "../utils/errors.js";

/**
 * Tool definitions for account operations
 */
export const accountTools: Tool[] = [
  {
    name: "marvin_test_connection",
    description:
      "Test the connection to Amazing Marvin API and verify authentication.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Account tool handlers
 */
export class AccountHandlers {
  constructor(private marvin: MarvinAPI) {}

  async testConnection(): Promise<CallToolResult> {
    return handleToolExecution(
      "test connection",
      async () => {
        const me = await this.marvin.getMe();
        return `Connection successful!\n\nEmail: ${me.email}${me.name ? `\nName: ${me.name}` : ""}`;
      }
    );
  }
}
