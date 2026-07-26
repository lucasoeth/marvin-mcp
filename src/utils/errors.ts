/**
 * Error handling utilities for consistent error responses
 */

import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Creates a success response with text content
 */
export function createSuccessResponse(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * Creates an error response with context about what operation failed
 */
export function createErrorResponse(operation: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Failed to ${operation}: ${message}` }],
    isError: true,
  };
}

/**
 * Wraps a tool handler with consistent error handling.
 * `operation` names the action for the error message, e.g. "create task"
 * produces "Failed to create task: ...".
 */
export async function handleToolExecution(
  operation: string,
  handler: () => Promise<string>
): Promise<CallToolResult> {
  try {
    return createSuccessResponse(await handler());
  } catch (error) {
    return createErrorResponse(operation, error);
  }
}
