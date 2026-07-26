/**
 * The domain model.
 *
 * Marvin exposes roughly 70 fields on a task. We expose nine. This module is the
 * only place that knows Marvin's wire shape; everything above it works in domain
 * terms. See docs/superpowers/specs/2026-07-26-marvin-cli-redesign-design.md.
 */

/** Marvin uses the literal string "unassigned" where most APIs would use null. */
export const UNASSIGNED = "unassigned";

export type Salience = 0 | 1 | 2 | 3;

export interface Task {
  id: string;
  title: string;
  done: boolean;
  /** The day I intend to work on it (YYYY-MM-DD), or null. Marvin: `day`. */
  scheduledFor: string | null;
  /** The deadline (YYYY-MM-DD), or null. Marvin: `dueDate`. */
  dueBy: string | null;
  /** Minutes, or null. Marvin stores milliseconds. */
  estimate: number | null;
  note: string | null;
  parentId: string | null;
  /** 0 none, 1 yellow, 2 orange, 3 red. Marvin: `isStarred`. */
  priority: Salience;
  /** 0 none, 1 normal, 2 baby, 3 monster. Marvin: `isFrogged`. */
  frog: Salience;
  labelIds: string[];
}

export type ContainerKind = "project" | "category";

export interface Container {
  id: string;
  title: string;
  kind: ContainerKind;
  parentId: string | null;
  done: boolean;
}

export interface Label {
  id: string;
  title: string;
}

/** Fields a caller may change. Everything optional; omitted means "leave alone". */
export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "scheduledFor"
    | "dueBy"
    | "estimate"
    | "note"
    | "parentId"
    | "priority"
    | "frog"
    | "labelIds"
  >
>;

// ---------------------------------------------------------------- reading

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === UNASSIGNED) return null;
  return trimmed;
}

/**
 * Marvin's own docs note isStarred/isFrogged may be `true` from an older version,
 * so a boolean has to collapse to 1 rather than blow up.
 */
function salience(value: unknown): Salience {
  if (value === true) return 1;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const rounded = Math.trunc(value);
  if (rounded <= 0) return 0;
  if (rounded >= 3) return 3;
  return rounded as Salience;
}

const MS_PER_MINUTE = 60_000;

/**
 * Marvin documents timeEstimate as milliseconds. The previous implementation
 * advertised minutes and passed the number through untouched, so a 30-minute
 * estimate was stored as 30ms.
 */
function estimateToMinutes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value / MS_PER_MINUTE);
}

export function toTask(raw: Record<string, unknown>): Task {
  return {
    id: String(raw._id ?? ""),
    title: typeof raw.title === "string" ? raw.title : "",
    done: raw.done === true,
    scheduledFor: str(raw.day),
    dueBy: str(raw.dueDate),
    estimate: estimateToMinutes(raw.timeEstimate),
    note: str(raw.note),
    parentId: str(raw.parentId),
    priority: salience(raw.isStarred),
    frog: salience(raw.isFrogged),
    labelIds: Array.isArray(raw.labelIds) ? raw.labelIds.map(String) : [],
  };
}

export function toContainer(raw: Record<string, unknown>): Container {
  return {
    id: String(raw._id ?? ""),
    title: typeof raw.title === "string" ? raw.title : "",
    kind: raw.type === "project" ? "project" : "category",
    parentId: str(raw.parentId) === "root" ? null : str(raw.parentId),
    done: raw.done === true,
  };
}

export function toLabel(raw: Record<string, unknown>): Label {
  return {
    id: String(raw._id ?? ""),
    title: typeof raw.title === "string" ? raw.title : "",
  };
}

/** Tasks live in db="Tasks"; projects and categories both live in db="Categories". */
export function isTaskDoc(raw: unknown): raw is Record<string, unknown> {
  return (raw as Record<string, unknown> | null)?.db === "Tasks";
}

export function isContainerDoc(raw: unknown): raw is Record<string, unknown> {
  return (raw as Record<string, unknown> | null)?.db === "Categories";
}

export function isProjectDoc(raw: unknown): boolean {
  const doc = raw as Record<string, unknown> | null;
  return doc?.db === "Categories" && doc?.type === "project";
}

// ---------------------------------------------------------------- writing

/**
 * Translate a domain patch into Marvin's field names and units.
 *
 * `null` is meaningful: it clears the field. `undefined` means "leave alone", so
 * the two cannot be collapsed.
 */
export function toMarvinPatch(patch: TaskPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.scheduledFor !== undefined) {
    out.day = patch.scheduledFor ?? UNASSIGNED;
  }
  if (patch.dueBy !== undefined) out.dueDate = patch.dueBy ?? null;
  if (patch.estimate !== undefined) {
    out.timeEstimate = patch.estimate === null ? 0 : patch.estimate * MS_PER_MINUTE;
  }
  if (patch.note !== undefined) out.note = patch.note ?? "";
  if (patch.parentId !== undefined) out.parentId = patch.parentId ?? UNASSIGNED;
  if (patch.priority !== undefined) out.isStarred = patch.priority;
  if (patch.frog !== undefined) out.isFrogged = patch.frog;
  if (patch.labelIds !== undefined) out.labelIds = patch.labelIds;
  return out;
}

// ---------------------------------------------------------------- dates

/** Local calendar date as YYYY-MM-DD. Never use toISOString(), which is UTC. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(y, m - 1, d + days);
  return today(shifted);
}

/**
 * The wire fields `/markDone` mutates.
 *
 * It is not just `done`. Marvin also stamps `doneAt`, and moves `day` from
 * `unassigned` to today, so a journal entry that records only `done` restores
 * one field of three and leaves the task dated to whenever it was completed.
 */
export const MARK_DONE_FIELDS = ["done", "doneAt", "day"] as const;

/**
 * These two use the `unassigned` string sentinel rather than null, so a
 * document that is missing them has to be snapshotted as `unassigned`. Writing
 * null back into `parentId` files the task under no container at all, which is
 * not the same as the inbox and is not somewhere it can be found again.
 */
const SENTINEL_FIELDS = new Set<string>(["day", "parentId"]);

/**
 * Snapshot the named wire fields of a raw document for the journal.
 *
 * Only the keys about to change: storing the whole document would make the
 * journal enormous and would risk undo clobbering unrelated concurrent edits.
 */
export function snapshotFields(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] =
      source[key] ?? (SENTINEL_FIELDS.has(key) ? UNASSIGNED : null);
  }
  return out;
}

/** Strict YYYY-MM-DD validation that rejects rollovers like 2024-02-31. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const parsed = new Date(y, m - 1, d);
  return (
    parsed.getFullYear() === y &&
    parsed.getMonth() === m - 1 &&
    parsed.getDate() === d
  );
}
