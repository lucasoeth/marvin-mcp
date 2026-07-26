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

/**
 * What `parent` means when you want the inbox rather than a container.
 *
 * Spelled as a word rather than exposing Marvin's `unassigned` sentinel,
 * because "inbox" is what it is called everywhere a user can see it.
 */
export const INBOX = "inbox";

/** Filters for `Repo.queryTasks`. All of them AND together. */
export interface TaskFilter {
  /** Substring of title or note, case-insensitive. */
  query?: string;
  /** Container id, or `INBOX` for tasks filed nowhere. */
  parent?: string;
  /** Only tasks with no day assigned. */
  unscheduled?: boolean;
  /** Only tasks with no deadline. */
  noDeadline?: boolean;
  scheduledFrom?: string;
  scheduledTo?: string;
  dueFrom?: string;
  dueTo?: string;
  /** Defaults to `open`. */
  status?: "open" | "done" | "any";
}

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

  /**
   * The general task query. One Mango request, whatever the filters.
   *
   * Every filter ANDs. No filters means every open task.
   */
  async queryTasks(
    filter: TaskFilter
  ): Promise<{ tasks: Task[]; warning?: string }> {
    const and: Record<string, unknown>[] = [];

    const status = filter.status ?? "open";
    if (status === "open") and.push(notDone());
    if (status === "done") and.push({ done: true });

    if (filter.query) {
      const pattern = `(?i).*${regexEscape(filter.query)}.*`;
      and.push({
        $or: [{ title: { $regex: pattern } }, { note: { $regex: pattern } }],
      });
    }

    if (filter.parent !== undefined) {
      and.push(
        filter.parent === INBOX ? absent("parentId") : { parentId: filter.parent }
      );
    }

    if (filter.unscheduled) and.push(absent("day"));
    if (filter.noDeadline) and.push(absent("dueDate"));

    if (filter.scheduledFrom || filter.scheduledTo) {
      and.push(between("day", filter.scheduledFrom, filter.scheduledTo));
    }
    if (filter.dueFrom || filter.dueTo) {
      and.push(between("dueDate", filter.dueFrom, filter.dueTo));
    }

    const selector: Record<string, unknown> = { db: "Tasks" };
    if (and.length) selector.$and = and;

    const { docs, warning } = await this.sync.findWithMeta<Raw>({ selector });
    return { tasks: docs.map(toTask), warning };
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

/**
 * "Not finished", including documents carrying no `done` field at all.
 *
 * CouchDB's `$ne` does not match a missing field. `{ done: { $ne: true } }` is
 * the obvious spelling and is what this inherited from the old `find` op, and
 * it silently drops every task Marvin never wrote the flag onto. Measured on a
 * real account: 13 of 42 open tasks, invisible, with no symptom other than a
 * count that looked plausible. 309 done + 29 "open" against 351 total was the
 * only evidence, and nothing surfaced the arithmetic.
 */
function notDone(): Record<string, unknown> {
  return { $or: [{ done: { $exists: false } }, { done: { $ne: true } }] };
}

/**
 * "This field is empty", in all the shapes Marvin uses for it.
 *
 * `day` and `parentId` carry the literal string `unassigned` rather than null,
 * `dueDate` is nulled outright, and a field can simply be absent on older
 * documents. Testing only one of those is how a filter silently returns the
 * wrong half of the account.
 */
function absent(field: string): Record<string, unknown> {
  return {
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: "" },
      { [field]: UNASSIGNED },
    ],
  };
}

/**
 * An inclusive date range on a YYYY-MM-DD field.
 *
 * Both bounds are always sent, even when the caller gave one. CouchDB compares
 * these as strings, and `unassigned` sorts *above* every real date (`u` > `9`),
 * so an open-ended `$gte: "2026-01-01"` would happily return every unscheduled
 * task in the account. The upper sentinel is what excludes them.
 */
function between(
  field: string,
  from?: string,
  to?: string
): Record<string, unknown> {
  return { [field]: { $gte: from ?? "0000-01-01", $lte: to ?? "9999-12-31" } };
}
