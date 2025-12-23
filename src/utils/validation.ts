/**
 * Input validation utilities for Marvin MCP server
 */

/**
 * Validates a date string in YYYY-MM-DD format
 */
export function validateDate(date: string): boolean {
  if (!date) return false;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) return false;
  
  // Check if it's a valid date
  const parsed = new Date(date);
  return !isNaN(parsed.getTime());
}

/**
 * Validates a task/project/category ID
 */
export function validateId(id: string): boolean {
  return typeof id === "string" && id.trim().length > 0;
}

/**
 * Validates priority level (1-3)
 */
export function validatePriority(priority: number): boolean {
  return [1, 2, 3].includes(priority);
}

/**
 * Validates project priority
 */
export function validateProjectPriority(priority: string): boolean {
  return ["high", "mid", "low"].includes(priority);
}

/**
 * Validates time estimate (positive number in minutes)
 */
export function validateTimeEstimate(minutes: number): boolean {
  return typeof minutes === "number" && minutes > 0 && Number.isFinite(minutes);
}

/**
 * Throws an error if validation fails
 */
export function assertValid(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
