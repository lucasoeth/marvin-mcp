/**
 * Response formatting utilities for consistent output
 */

import { MarvinTask, MarvinProject, MarvinCategory, MarvinLabel } from "../marvin-api.js";

/**
 * Formats a task for display in lists
 */
export function formatTask(task: MarvinTask): string {
  const checkbox = task.done ? "x" : " ";
  const parts = [`- [${checkbox}] ${task.title} (ID: ${task._id})`];
  
  if (task.day) parts.push(` [${task.day}]`);
  if (task.dueDate) parts.push(` [Due: ${task.dueDate}]`);
  if (task.isStarred) parts.push(` [Priority: ${task.isStarred}]`);

  return parts.join("");
}

/**
 * Formats a project for display
 */
export function formatProject(project: MarvinProject): string {
  const parts = [`- ${project.title} (ID: ${project._id})`];
  
  if (project.priority) parts.push(` [${project.priority}]`);
  if (project.done) parts.push(` [✓]`);
  
  return parts.join("");
}

/**
 * Formats a category for display
 */
export function formatCategory(category: MarvinCategory): string {
  const parts = [`- ${category.title} (ID: ${category._id})`];

  if (category.type) parts.push(` [${category.type}]`);
  if (category.parentId) parts.push(` [parent: ${category.parentId}]`);

  return parts.join("");
}

/**
 * Formats a label for display
 */
export function formatLabel(label: MarvinLabel): string {
  const parts = [`- ${label.title} (ID: ${label._id})`];
  
  if (label.color) parts.push(` [${label.color}]`);
  if (label.icon) parts.push(` ${label.icon}`);
  
  return parts.join("");
}

/**
 * Formats a list of items with a header
 */
export function formatList<T>(
  items: T[],
  formatter: (item: T) => string,
  header: string,
  emptyMessage: string
): string {
  if (items.length === 0) {
    return emptyMessage;
  }
  
  const itemList = items.map(formatter).join("\n");
  return `${header} (${items.length}):\n\n${itemList}`;
}

/**
 * Formats task details for display
 */
export function formatTaskDetails(task: MarvinTask): string {
  const details: string[] = [
    `Task: ${task.title}`,
    `ID: ${task._id}`,
  ];
  
  if (task.done) details.push(`Status: Completed`);
  if (task.day) details.push(`Scheduled: ${task.day}`);
  if (task.dueDate) details.push(`Due: ${task.dueDate}`);
  if (task.timeEstimate) details.push(`Time Estimate: ${task.timeEstimate} minutes`);
  if (task.isStarred) details.push(`Priority: ${task.isStarred}`);
  if (task.note) details.push(`\nNote:\n${task.note}`);

  return details.join("\n");
}
