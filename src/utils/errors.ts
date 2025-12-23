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
 * Wraps a tool handler with consistent error handling
 */
export async function handleToolExecution<T>(
  operation: string,
  handler: () => Promise<T>,
  formatter: (result: T) => string
): Promise<CallToolResult> {
  try {
    const result = await handler();
    return createSuccessResponse(formatter(result));
  } catch (error) {
    return createErrorResponse(operation, error);
  }
}
