/**
 * Amazing Marvin API Client
 *
 * Handles all communication with the Amazing Marvin API.
 * Supports both limited API token and full-access token operations.
 */

const API_BASE = "https://serv.amazingmarvin.com/api";

export interface MarvinTask {
  _id: string;
  title: string;
  done?: boolean;
  day?: string;
  dueDate?: string;
  timeEstimate?: number;
  parentId?: string;
  labelIds?: string[];
  note?: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  isReward?: boolean;
  rewardPoints?: number;
  rewardId?: string;
  // Priority: 1=yellow, 2=orange, 3=red (or true from old version)
  isStarred?: number | boolean;
  // Document type
  db?: string;
}

export interface MarvinProject {
  _id: string;
  title: string;
  parentId?: string;
  priority?: "high" | "mid" | "low";
  done?: boolean;
  day?: string;
  dueDate?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface MarvinCategory {
  _id: string;
  title: string;
  type?: "category" | "project";
  parentId?: string;
  color?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface MarvinLabel {
  _id: string;
  title: string;
  color?: string;
  groupId?: string;
  icon?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface CreateTaskOptions {
  title: string;
  day?: string;
  dueDate?: string;
  timeEstimate?: number;
  parentId?: string;
  labelIds?: string[];
  note?: string;
  isReward?: boolean;
  rewardPoints?: number;
  rewardId?: string;
  // Priority: 1=yellow, 2=orange, 3=red
  isStarred?: number;
}

export interface CreateProjectOptions {
  title: string;
  parentId?: string;
  priority?: "high" | "mid" | "low";
  day?: string;
  dueDate?: string;
}

export class MarvinAPI {
  private apiToken: string;
  private fullAccessToken: string;

  constructor(apiToken: string, fullAccessToken: string) {
    this.apiToken = apiToken;
    this.fullAccessToken = fullAccessToken;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      useFullAccess?: boolean;
    } = {}
  ): Promise<T> {
    const { method = "GET", body, useFullAccess = false } = options;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (useFullAccess) {
      headers["X-Full-Access-Token"] = this.fullAccessToken;
    } else {
      headers["X-API-Token"] = this.apiToken;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Marvin API error (${response.status}): ${text}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json() as Promise<T>;
    }

    return response.text() as unknown as T;
  }

  // ============ Task Operations ============

  /**
   * Create a new task
   * Supports title with inline syntax: +today, #Category, @label
   */
  async createTask(options: CreateTaskOptions): Promise<MarvinTask> {
    const payload: Record<string, unknown> = {
      title: options.title,
      timeZoneOffset: new Date().getTimezoneOffset(),
    };

    if (options.day) payload.day = options.day;
    if (options.dueDate) payload.dueDate = options.dueDate;
    if (options.timeEstimate) payload.timeEstimate = options.timeEstimate;
    if (options.parentId) payload.parentId = options.parentId;
    if (options.labelIds) payload.labelIds = options.labelIds;
    if (options.note) payload.note = options.note;
    if (options.isReward) payload.isReward = options.isReward;
    if (options.rewardPoints) payload.rewardPoints = options.rewardPoints;
    if (options.rewardId) payload.rewardId = options.rewardId;
    if (options.isStarred) payload.isStarred = options.isStarred;

    return this.request<MarvinTask>("/addTask", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Mark a task as done
   */
  async completeTask(taskId: string): Promise<void> {
    await this.request("/markDone", {
      method: "POST",
      body: {
        itemId: taskId,
        timeZoneOffset: new Date().getTimezoneOffset(),
      },
    });
  }

  /**
   * Get tasks scheduled for today
   */
  async getTodayTasks(): Promise<MarvinTask[]> {
    return this.request<MarvinTask[]>("/todayItems");
  }

  /**
   * Get tasks that are due (overdue)
   */
  async getDueTasks(): Promise<MarvinTask[]> {
    return this.request<MarvinTask[]>("/dueItems");
  }

  /**
   * Get a specific document by ID (requires full access)
   */
  async getDocument<T>(id: string): Promise<T> {
    return this.request<T>(`/doc?id=${encodeURIComponent(id)}`, {
      useFullAccess: true,
    });
  }

  /**
   * Update a document (requires full access)
   */
  async updateDocument(
    id: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    await this.request("/doc/update", {
      method: "POST",
      body: {
        itemId: id,
        setters: updates,
      },
      useFullAccess: true,
    });
  }

  /**
   * Delete a document (requires full access)
   */
  async deleteDocument(id: string): Promise<void> {
    await this.request("/doc/delete", {
      method: "POST",
      body: { itemId: id },
      useFullAccess: true,
    });
  }

  /**
   * Get children of a parent (tasks/projects under a category/project)
   */
  async getChildren(parentId: string): Promise<(MarvinTask | MarvinProject)[]> {
    return this.request<(MarvinTask | MarvinProject)[]>(
      `/children?parentId=${encodeURIComponent(parentId)}`
    );
  }

  // ============ Project Operations ============

  /**
   * Create a new project
   */
  async createProject(options: CreateProjectOptions): Promise<MarvinProject> {
    const payload: Record<string, unknown> = {
      title: options.title,
      timeZoneOffset: new Date().getTimezoneOffset(),
    };

    if (options.parentId) payload.parentId = options.parentId;
    if (options.priority) payload.priority = options.priority;
    if (options.day) payload.day = options.day;
    if (options.dueDate) payload.dueDate = options.dueDate;

    return this.request<MarvinProject>("/addProject", {
      method: "POST",
      body: payload,
    });
  }

  // ============ Category Operations ============

  /**
   * Get all categories
   */
  async getCategories(): Promise<MarvinCategory[]> {
    return this.request<MarvinCategory[]>("/categories");
  }

  // ============ Label Operations ============

  /**
   * Get all labels
   */
  async getLabels(): Promise<MarvinLabel[]> {
    return this.request<MarvinLabel[]>("/labels");
  }

  // ============ Account Operations ============

  /**
   * Get account info (useful for testing connection)
   */
  async getMe(): Promise<{ email: string; name?: string }> {
    return this.request("/me");
  }

  // ============ Advanced Query Operations ============

  /**
   * Get inbox tasks (tasks without a parent category/project)
   * Tries root as parent, falls back to aggregating unparented tasks
   */
  async getInboxTasks(): Promise<MarvinTask[]> {
    try {
      // Try getting children of root
      const items = await this.request<MarvinTask[]>("/children?parentId=root");
      return items.filter((item) => item.db === "Tasks" || !item.db);
    } catch {
      // Fallback: get today + due items and filter those without parentId
      const [today, due] = await Promise.all([
        this.getTodayTasks(),
        this.getDueTasks(),
      ]);
      const allTasks = [...today, ...due];
      const seen = new Set<string>();
      return allTasks.filter((task) => {
        if (seen.has(task._id)) return false;
        seen.add(task._id);
        return !task.parentId || task.parentId === "root";
      });
    }
  }

  /**
   * Get tasks for a specific date
   */
  async getTasksByDate(date: string): Promise<MarvinTask[]> {
    return this.request<MarvinTask[]>(
      `/todayItems?date=${encodeURIComponent(date)}`
    );
  }

  /**
   * Search tasks by title (aggregates from multiple sources)
   * Note: This is client-side filtering due to API limitations
   */
  async searchTasks(query: string): Promise<MarvinTask[]> {
    const lowerQuery = query.toLowerCase();

    // Aggregate tasks from available sources
    const [today, due, categories] = await Promise.all([
      this.getTodayTasks(),
      this.getDueTasks(),
      this.getCategories(),
    ]);

    // Get children of all categories
    const categoryChildren = await Promise.all(
      categories.map((cat) =>
        this.getChildren(cat._id).catch(() => [] as MarvinTask[])
      )
    );

    // Combine all tasks
    const allTasks: MarvinTask[] = [
      ...today,
      ...due,
      ...categoryChildren.flat(),
    ];

    // Deduplicate by ID
    const seen = new Set<string>();
    const uniqueTasks = allTasks.filter((task) => {
      if (seen.has(task._id)) return false;
      seen.add(task._id);
      return true;
    });

    // Filter by query
    return uniqueTasks.filter(
      (task) =>
        task.title?.toLowerCase().includes(lowerQuery) ||
        task.note?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get all tasks (aggregates from multiple sources)
   * Note: May not include all tasks due to API limitations
   */
  async getAllTasks(): Promise<MarvinTask[]> {
    const [today, due, categories] = await Promise.all([
      this.getTodayTasks(),
      this.getDueTasks(),
      this.getCategories(),
    ]);

    // Get children of all categories
    const categoryChildren = await Promise.all(
      categories.map((cat) =>
        this.getChildren(cat._id).catch(() => [] as MarvinTask[])
      )
    );

    // Combine all tasks
    const allTasks: MarvinTask[] = [
      ...today,
      ...due,
      ...categoryChildren.flat(),
    ];

    // Deduplicate by ID
    const seen = new Set<string>();
    return allTasks.filter((task) => {
      if (seen.has(task._id)) return false;
      seen.add(task._id);
      return true;
    });
  }
}
