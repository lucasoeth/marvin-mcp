/**
 * Domain-level reads and writes.
 *
 * Sits between the raw client and the ops: speaks Task/Container, hides endpoint
 * names and Marvin's wire quirks.
 */

import type { MarvinClient } from "./client.js";
import { marvinTimeZoneOffset } from "./client.js";
import { regexEscape, SyncDb } from "./sync.js";
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
  constructor(
    private readonly client: MarvinClient,
    /** Optional read-only fast path. Absent is a supported configuration. */
    private readonly sync: SyncDb | null = null
  ) {}

  /**
   * Search titles and notes.
   *
   * With sync credentials this is one Mango query. Without them it is the
   * container crawl, which is slow and can come back incomplete — hence the
   * `unreadable` list.
   */
  async searchTasks(
    query: string,
    includeDone: boolean
  ): Promise<{ tasks: Task[]; unreadable: string[] }> {
    if (this.sync) {
      const pattern = `(?i).*${regexEscape(query)}.*`;
      const selector: Record<string, unknown> = {
        db: "Tasks",
        $or: [{ title: { $regex: pattern } }, { note: { $regex: pattern } }],
      };
      if (!includeDone) selector.done = { $ne: true };
      const docs = await this.sync.find<Raw>({ selector });
      return { tasks: docs.map(toTask), unreadable: [] };
    }

    const { tasks, unreadable } = await this.allTasks();
    const needle = query.toLowerCase();
    return {
      tasks: tasks
        .filter((t) => includeDone || !t.done)
        .filter(
          (t) =>
            t.title.toLowerCase().includes(needle) ||
            (t.note?.toLowerCase().includes(needle) ?? false)
        ),
      unreadable,
    };
  }

  /** Every task, for resolution fallbacks. One query when sync is available. */
  async everyTask(): Promise<{ tasks: Task[]; unreadable: string[] }> {
    if (this.sync) {
      const docs = await this.sync.find<Raw>({ selector: { db: "Tasks" } });
      return { tasks: docs.map(toTask), unreadable: [] };
    }
    return this.allTasks();
  }

  get hasFastPath(): boolean {
    return this.sync !== null;
  }

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
   * Every task reachable from the container tree, plus today, due and the inbox.
   *
   * Marvin documents no search endpoint and no bulk export, so a crawl is the
   * only option. Three things this has to get right:
   *
   * 1. The API is documented at 1 request per 3 seconds. Firing all 20-odd
   *    container reads at once made them fail intermittently, and because the
   *    failures were swallowed the crawl silently returned partial results:
   *    consecutive runs on the same account returned 16, 38, 46 and 53 tasks.
   *    Concurrency is capped and failures are retried.
   * 2. A read that still fails after retries is reported, never hidden. A search
   *    that quietly misses half the account is worse than a slow one.
   * 3. A parentId cycle would otherwise recurse forever.
   */
  async allTasks(): Promise<{ tasks: Task[]; unreadable: string[] }> {
    const seenContainers = new Set<string>();
    const byId = new Map<string, Task>();
    const unreadable: string[] = [];

    const collect = (docs: Raw[]) => {
      for (const doc of docs) {
        if (!isTaskDoc(doc)) continue;
        const task = toTask(doc);
        if (task.id) byId.set(task.id, task);
      }
    };

    const readChildren = async (parentId: string): Promise<Raw[] | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.children(parentId);
        } catch {
          if (attempt < 2) await sleep(250 * 2 ** attempt);
        }
      }
      unreadable.push(parentId);
      return null;
    };

    const walk = async (parentId: string): Promise<void> => {
      if (seenContainers.has(parentId)) return;
      seenContainers.add(parentId);
      const docs = await readChildren(parentId);
      if (!docs) return;
      collect(docs);
      const nested = docs.filter(isProjectDoc).map((doc) => String(doc._id));
      await mapLimited(nested, CRAWL_CONCURRENCY, walk);
    };

    const [todayTasks, dueTasks, containers] = await Promise.all([
      this.today(),
      this.due(),
      this.containers(),
    ]);

    for (const task of [...todayTasks, ...dueTasks]) byId.set(task.id, task);

    const roots = ["unassigned", ...containers.map((c) => c.id)];
    await mapLimited(roots, CRAWL_CONCURRENCY, walk);

    return { tasks: [...byId.values()], unreadable };
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

  /**
   * Marvin's update takes an array of {key, val} setters rather than an object.
   *
   * Each setter is paired with a `fieldUpdates.<key>` timestamp. This is not
   * cosmetic. Marvin resolves multi-device conflicts per field by comparing
   * `fieldUpdates` timestamps, and the public API does not maintain them for us
   * (verified: updating a title leaves both `updatedAt` and
   * `fieldUpdates.title` at their original values). Without this, an edit made
   * on the phone wins the merge regardless of who actually wrote last, and a
   * change made here can silently vanish.
   *
   * https://github.com/amazingmarvin/MarvinAPI/wiki/Marvin-API
   */
  async updateRaw(id: string, fields: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(fields);
    if (entries.length === 0) return;

    const now = Date.now();
    const setters = entries.flatMap(([key, val]) => [
      { key, val },
      { key: `fieldUpdates.${key}`, val: now },
    ]);
    setters.push({ key: "updatedAt", val: now });

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

/**
 * Marvin documents 1 request per 3 seconds and 1440 per day, but enforces
 * neither with a 429 — there is no backpressure to react to, so we self-limit.
 * Strict pacing would make a full crawl take over a minute, which is unusable
 * interactively; a small window keeps requests reliable without that cost.
 */
const CRAWL_CONCURRENCY = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Like Promise.all over a mapper, but with at most `limit` in flight. */
async function mapLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      await fn(items[cursor++]);
    }
  });
  await Promise.all(workers);
}
