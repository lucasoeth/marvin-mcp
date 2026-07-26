/**
 * Domain-level reads and writes.
 *
 * Sits between the raw client and the ops: speaks Task/Container, hides endpoint
 * names and Marvin's wire quirks.
 */

import type { MarvinClient } from "./client.js";
import { marvinTimeZoneOffset } from "./client.js";
import {
  type Container,
  type Label,
  type Task,
  type TaskPatch,
  isTaskDoc,
  isProjectDoc,
  toContainer,
  toLabel,
  toMarvinPatch,
  toTask,
} from "./model.js";

type Raw = Record<string, unknown>;

export class Repo {
  constructor(private readonly client: MarvinClient) {}

  // -------------------------------------------------------------- reads

  /** Tasks whose `day` is today. */
  async today(): Promise<Task[]> {
    const raw = await this.client.get<Raw[]>("/todayItems");
    return asArray(raw).filter(isTaskDoc).map(toTask);
  }

  /** Tasks Marvin considers due. Includes overdue and due-today. */
  async due(): Promise<Task[]> {
    const raw = await this.client.get<Raw[]>("/dueItems");
    return asArray(raw).filter(isTaskDoc).map(toTask);
  }

  async tasksOn(date: string): Promise<Task[]> {
    const raw = await this.client.get<Raw[]>("/todayItems", { date });
    return asArray(raw).filter(isTaskDoc).map(toTask);
  }

  async containers(): Promise<Container[]> {
    const raw = await this.client.get<Raw[]>("/categories");
    return asArray<Raw>(raw).filter(Boolean).map(toContainer);
  }

  async labels(): Promise<Label[]> {
    const raw = await this.client.get<Raw[]>("/labels");
    return asArray<Raw>(raw).filter(Boolean).map(toLabel);
  }

  async getRaw(id: string): Promise<Raw> {
    return this.client.get<Raw>("/doc", { id }, { fullAccess: true });
  }

  async getTask(id: string): Promise<Task> {
    return toTask(await this.getRaw(id));
  }

  async children(parentId: string): Promise<Raw[]> {
    return asArray(await this.client.get<Raw[]>("/children", { parentId }));
  }

  /**
   * Every task reachable from the container tree, plus today and due.
   *
   * Marvin documents no search endpoint and no bulk export, so a crawl is the
   * only option. Cycle-protected: a parentId loop in the data would otherwise
   * recurse forever, which the previous implementation did not guard against.
   */
  async allTasks(): Promise<Task[]> {
    const seenContainers = new Set<string>();
    const byId = new Map<string, Task>();

    const collect = (docs: Raw[]) => {
      for (const doc of docs) {
        if (!isTaskDoc(doc)) continue;
        const task = toTask(doc);
        if (task.id) byId.set(task.id, task);
      }
    };

    const walk = async (parentId: string): Promise<void> => {
      if (seenContainers.has(parentId)) return;
      seenContainers.add(parentId);
      let docs: Raw[];
      try {
        docs = await this.children(parentId);
      } catch {
        return; // a single unreadable container must not fail the whole crawl
      }
      collect(docs);
      await Promise.all(
        docs.filter(isProjectDoc).map((doc) => walk(String(doc._id)))
      );
    };

    const [todayTasks, dueTasks, containers] = await Promise.all([
      this.today().catch(() => [] as Task[]),
      this.due().catch(() => [] as Task[]),
      this.containers().catch(() => [] as Container[]),
    ]);

    for (const task of [...todayTasks, ...dueTasks]) byId.set(task.id, task);
    await Promise.all(containers.map((container) => walk(container.id)));
    collect(await this.children("unassigned").catch(() => []));

    return [...byId.values()];
  }

  // -------------------------------------------------------------- writes

  /**
   * Create a task. Marvin parses inline syntax (`+today`, `#Category`, `@label`)
   * out of the title server-side unless X-Auto-Complete is disabled, so plain
   * text capture needs no client-side parsing.
   */
  async createTask(
    title: string,
    patch: TaskPatch = {}
  ): Promise<Task> {
    const body: Raw = {
      title,
      timeZoneOffset: marvinTimeZoneOffset(),
      ...toMarvinPatch(patch),
    };
    return toTask(await this.client.post<Raw>("/addTask", body));
  }

  async markDone(id: string): Promise<void> {
    await this.client.post("/markDone", {
      itemId: id,
      timeZoneOffset: marvinTimeZoneOffset(),
    });
  }

  /** Marvin's update takes an array of {key, val} setters rather than an object. */
  async updateRaw(id: string, fields: Record<string, unknown>): Promise<void> {
    const setters = Object.entries(fields).map(([key, val]) => ({ key, val }));
    if (setters.length === 0) return;
    await this.client.post(
      "/doc/update",
      { itemId: id, setters },
      { fullAccess: true }
    );
  }

  async updateTask(id: string, patch: TaskPatch): Promise<void> {
    await this.updateRaw(id, toMarvinPatch(patch));
  }

  async deleteDoc(id: string): Promise<void> {
    await this.client.post("/doc/delete", { itemId: id }, { fullAccess: true });
  }
}

function asArray<T>(value: T[] | unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
