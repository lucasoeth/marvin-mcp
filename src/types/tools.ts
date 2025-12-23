/**
 * Shared types for tool arguments and responses
 */

/**
 * Arguments for creating a task
 */
export interface CreateTaskArgs {
  title: string;
  day?: string;
  dueDate?: string;
  timeEstimate?: number;
  parentId?: string;
  labelIds?: string[];
  note?: string;
  isStarred?: number;
}

/**
 * Arguments for updating a task
 */
export interface UpdateTaskArgs {
  taskId: string;
  title?: string;
  day?: string;
  dueDate?: string;
  timeEstimate?: number;
  note?: string;
  parentId?: string;
  labelIds?: string[];
  isStarred?: number;
}

/**
 * Arguments for creating a project
 */
export interface CreateProjectArgs {
  title: string;
  parentId?: string;
  priority?: "high" | "mid" | "low";
  day?: string;
  dueDate?: string;
}

/**
 * Arguments for updating a project
 */
export interface UpdateProjectArgs {
  projectId: string;
  title?: string;
  priority?: "high" | "mid" | "low";
  day?: string;
  dueDate?: string;
}
