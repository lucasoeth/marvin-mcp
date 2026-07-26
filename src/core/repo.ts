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
  UNASSIGNED,
  isTaskDoc,
  toContainer,
  toLabel,
  toMarvinPatch,
  toTask,
} from "./model.js";

type Raw = Record<string, unknown>;

export class Repo {
  constructor(
    private readonly client: MarvinClient,
    /**
     * Required. Reads go to the sync database, writes to the public API.
     *
     * This used to be optional, with a container crawl as the fallback. The
     * crawl cost ~22 requests against an account budget of 1440/day that Marvin
     * enforces by restricting accounts rather than returning 429s, and it could
     * not see completed tasks at all, so search silently missed most of the
     * account. Neither is acceptable to ship to somebody else. Requiring the
     * credentials costs four more values at setup, once.
     */
    private readonly sync: SyncDb
  ) {}

  /** Search titles and notes. One Mango query. */
  async searchTasks(query: string, includeDone: boolean): Promise<Task[]> {
    const pattern = `(?i).*${regexEscape(query)}.*`;
    const selector: Record<string, unknown> = {
      db: "Tasks",
      $or: [{ title: { $regex: pattern } }, { note: { $regex: pattern } }],
    };
    if (!includeDone) selector.done = { $ne: true };
    const docs = await this.sync.find<Raw>({ selector });
    return docs.map(toTask);
  }

  /** Every task, including completed ones. */
  async everyTask(): Promise<Task[]> {
    const docs = await this.sync.find<Raw>({ selector: { db: "Tasks" } });
    return docs.map(toTask);
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

  // -------------------------------------------------------------- writes

  /**
   * Create a task, repairing Marvin's inline-`#` handling if it fires.
   *
   * Marvin parses inline syntax (`+today`, `#Category`, `@label`) out of the
   * title server-side. `+today` is genuinely useful and we keep it. `#token` is
   * not: Marvin strips the token from the title and stores the literal string
   * as `parentId`, even when no such container exists. "Review PR #412" becomes
   * "Review PR" filed under `parentId: "#412"`, which is not a real container,
   * so the task appears in neither that category nor the inbox.
   *
   * Callers resolve `#Category` to a real id first where they can, but that
   * only helps when the category exists. `#412`, `#1`, `#hashtag` cannot
   * resolve and are exactly the common case — issue and invoice numbers.
   *
   * So: detect the mangling by its signature, a `parentId` beginning with `#`
   * that the caller did not ask for, and put both fields back. Costs one extra
   * request, and only when it actually happened.
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
    const created = toTask(await this.client.post<Raw>("/addTask", body));

    const mangled =
      created.parentId?.startsWith("#") && created.parentId !== patch.parentId;
    if (!mangled) return created;

    const intendedParent = patch.parentId ?? UNASSIGNED;
    await this.updateRaw(created.id, {
      title,
      parentId: intendedParent,
    });
    return {
      ...created,
      title,
      parentId: intendedParent === UNASSIGNED ? null : intendedParent,
    };
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
