/**
 * Batch mutation. The autonomy surface.
 *
 * The agent has full write authority, so the right shape is: reason over the
 * whole day, then commit one atomic change set. Twelve individual writes leave
 * the day half-rewritten if the sixth fails, and cost twelve round trips against
 * a rate-limited account.
 *
 * `--dry-run` renders the whole set without writing, which is the cheap way to
 * check a large plan before committing it.
 */

import { z } from "zod";
import {
  isValidDate,
  toMarvinPatch,
  type Task,
  type TaskPatch,
} from "../model.js";
import { resolveInlineParent } from "./capture.js";
import { defineOp } from "./types.js";

const date = z
  .string()
  .refine(isValidDate, "expected a real calendar date as YYYY-MM-DD");

const patch = z.object({
  title: z.string().optional(),
  scheduledFor: date.nullable().optional().describe("Day to work on it; null clears"),
  dueBy: date.nullable().optional().describe("Deadline; null clears"),
  estimate: z.number().int().positive().nullable().optional().describe("Minutes"),
  note: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  frog: z.number().int().min(0).max(3).optional(),
});

const change = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    id: z.string().min(1),
    set: patch,
  }),
  z.object({
    action: z.literal("complete"),
    id: z.string().min(1),
  }),
  z.object({
    action: z.literal("create"),
    title: z.string().min(1),
    set: patch.optional(),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.string().min(1),
  }),
]);

const input = z.object({
  changes: z.array(change).min(1).describe("Change set, applied in order"),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Report what would happen without writing"),
});

type ChangeInput = z.infer<typeof change>;

export const apply = defineOp({
  name: "apply",
  summary: "Apply a batch of task changes as one ordered set",
  details:
    "Actions: update, complete, create, delete. Applied in order, in one call " +
    "rather than one request per change. Use --dry-run to preview. " +
    // See capture.ts for why this line is repeated rather than left to
    // SERVER_INSTRUCTIONS.
    "scheduledFor is the day to work on it; dueBy is the deadline.",
  input,
  mutates: true,
  async run({ changes, dryRun }, ctx) {
    if (dryRun) {
      // Resolve first. A preview that only reformats the arguments you just
      // typed tells you nothing you did not already know, and this is the only
      // check a CLI write gets — there is no undo, and no client sitting in
      // front of it asking for approval. So: name the tasks, show what each
      // field is changing *from*, and refuse to pretend an id exists.
      //
      // One sync query for the whole set, so the preview is free against the
      // API budget and costs less than the write it is previewing.
      const known = await ctx.repo.tasksById(
        changes.flatMap((item) => ("id" in item ? [item.id] : []))
      );
      return {
        applied: 0,
        dryRun: true,
        results: changes.map((item) => preview(item, known)),
      };
    }

    const results: string[] = [];

    for (const item of changes) {
      switch (item.action) {
        case "update": {
          await ctx.repo.updateRaw(item.id, toMarvinPatch(item.set as TaskPatch));
          results.push(describe(item));
          break;
        }
        case "complete": {
          await ctx.repo.markDone(item.id);
          results.push(describe(item));
          break;
        }
        case "create": {
          // Same inline-#Category resolution capture does, and for the same
          // reason: Marvin strips a `#token` from the title server-side and
          // stores the literal string as parentId, so "Review PR #412" becomes
          // "Review PR" filed under a container named "#412" that does not
          // exist. The task is then in neither that category nor the inbox,
          // so nothing lists it. Going through createTask directly skipped this, which made
          // `apply` — the path agents are told to prefer — the one that
          // silently loses tasks. An explicit parentId still wins.
          const set = (item.set ?? {}) as TaskPatch;
          let title = item.title;
          let parentId = set.parentId ?? undefined;
          if (!parentId) {
            const resolved = await resolveInlineParent(item.title, ctx);
            title = resolved.title;
            parentId = resolved.parentId;
          }

          const created = await ctx.repo.createTask(title, {
            ...set,
            parentId,
          });
          results.push(`created "${created.title}" [${created.id}]`);
          break;
        }
        case "delete": {
          await ctx.repo.deleteDoc(item.id);
          results.push(describe(item));
          break;
        }
      }
    }

    return { applied: results.length, dryRun: false, results };
  },
  render({ applied, dryRun, results }) {
    const header = dryRun
      ? `would apply ${results.length} change(s)`
      : `applied ${applied} change(s)`;
    return [header, ...results.map((r: string) => "  " + r)].join("\n");
  },
});

function describe(item: ChangeInput): string {
  switch (item.action) {
    case "update": {
      const fields = Object.entries(item.set)
        .map(([k, v]) => `${k}=${v === null ? "cleared" : String(v)}`)
        .join(", ");
      return `update ${item.id}: ${fields || "nothing"}`;
    }
    case "complete":
      return `complete ${item.id}`;
    case "create":
      return `create "${item.title}"`;
    case "delete":
      return `delete ${item.id}`;
  }
}

/**
 * One line of a dry run, against the task as it stands today.
 *
 * Unknown ids are reported rather than echoed. An id that does not resolve is
 * the single most likely thing to be wrong in a hand-written or model-written
 * change set, and it is the whole reason to look before writing.
 */
function preview(item: ChangeInput, known: Map<string, Task>): string {
  if (item.action === "create") {
    const set = item.set ?? {};
    const extra = Object.entries(set)
      .map(([key, value]) => `${key}=${show(value)}`)
      .join(", ");
    return `create   "${item.title}"${extra ? `  (${extra})` : ""}`;
  }

  const task = known.get(item.id);
  if (!task) return `ERROR    ${item.id}: no such task`;

  switch (item.action) {
    case "complete":
      return `complete "${task.title}"${task.done ? "  (already done)" : ""}`;

    case "delete":
      // Deletion is the one thing nothing can walk back, so say what is being
      // lost rather than only which id.
      return `delete   "${task.title}"${context(task)}  — permanent`;

    case "update": {
      const diffs = Object.entries(item.set)
        .filter(([key]) => key in task)
        .map(([key, next]) => {
          const before = (task as unknown as Record<string, unknown>)[key];
          return show(before) === show(next)
            ? `${key}: ${show(next)} (unchanged)`
            : `${key}: ${show(before)} → ${show(next)}`;
        });
      return `update   "${task.title}"  ${diffs.join(", ") || "nothing"}`;
    }
  }
}

/** Whatever else is worth knowing before destroying it. */
function context(task: Task): string {
  const parts: string[] = [];
  if (task.scheduledFor) parts.push(`for ${task.scheduledFor}`);
  if (task.dueBy) parts.push(`due ${task.dueBy}`);
  if (task.note) parts.push("has a note");
  return parts.length ? `  (${parts.join(", ")})` : "";
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  return String(value);
}
