/**
 * Shared types for tool arguments and responses
 */

import { z } from "zod";

// ============ Task Schemas ============

export const CreateTaskArgsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  timeEstimate: z.number().positive("Time estimate must be positive").optional(),
  parentId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  note: z.string().optional(),
  isStarred: z.number().int().min(1).max(3, "isStarred must be 1, 2, or 3").optional(),
});

export const UpdateTaskArgsSchema = z.object({
  taskId: z.string().min(1, "Task ID is required"),
  title: z.string().min(1, "Title cannot be empty").optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  timeEstimate: z.number().positive("Time estimate must be positive").optional(),
  note: z.string().optional(),
  parentId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  isStarred: z.number().int().min(1).max(3, "isStarred must be 1, 2, or 3").optional(),
});

// ============ Project Schemas ============

export const CreateProjectArgsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  parentId: z.string().optional(),
  priority: z.enum(["high", "mid", "low"]).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  note: z.string().optional(),
});

export const UpdateProjectArgsSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  title: z.string().min(1, "Title cannot be empty").optional(),
  priority: z.enum(["high", "mid", "low"]).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  note: z.string().optional(),
});

// ============ Category Schemas ============

export const CreateCategoryArgsSchema = z.object({
  title: z.string().min(1, "Title is required"),
  parentId: z.string().optional(),
  color: z.string().optional(),
});

// ============ Type Exports ============

export type CreateTaskArgs = z.infer<typeof CreateTaskArgsSchema>;
export type UpdateTaskArgs = z.infer<typeof UpdateTaskArgsSchema>;
export type CreateProjectArgs = z.infer<typeof CreateProjectArgsSchema>;
export type UpdateProjectArgs = z.infer<typeof UpdateProjectArgsSchema>;
export type CreateCategoryArgs = z.infer<typeof CreateCategoryArgsSchema>;
