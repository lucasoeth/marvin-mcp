/**
 * Batch mutation. The autonomy surface.
 *
 * The agent has full write authority, so the right shape is: reason over the
 * whole day, then commit one atomic change set. Twelve individual writes leave
 * the day half-rewritten if the sixth fails, and produce twelve journal entries
 * that have to be undone one at a time.
 *
 * Every change captures its before-state first, so `undo` can revert the whole
 * set in one go.
 */

import { z } from "zod";
import { isValidDate, toMarvinPatch, type TaskPatch } from "../model.js";
import type { Change } from "../journal.js";
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
  summary: "Apply a batch of task changes atomically, with undo support",
  details:
    "Actions: update, complete, create, delete. The whole set is journalled as " +
    "one entry, so `marvin undo` reverts all of it. Use --dry-run to preview.",
  input,
  mutates: true,
  async run({ changes, dryRun }, ctx) {
    if (dryRun) {
      return { applied: 0, dryRun: true, results: changes.map(describe) };
    }

    const journalled: Change[] = [];
    const results: string[] = [];

    for (const item of changes) {
      switch (item.action) {
        case "update": {
          const before = await ctx.repo.getRaw(item.id);
          const fields = toMarvinPatch(item.set as TaskPatch);
          journalled.push({
            id: item.id,
            before: pick(before, Object.keys(fields)),
            after: fields,
          });
          await ctx.repo.updateRaw(item.id, fields);
          results.push(describe(item));
          break;
        }
        case "complete": {
          const before = await ctx.repo.getRaw(item.id);
          journalled.push({
            id: item.id,
            before: pick(before, ["done"]),
            after: { done: true },
          });
          await ctx.repo.markDone(item.id);
          results.push(describe(item));
          break;
        }
        case "create": {
          // Same inline-#Category resolution capture does, and for the same
          // reason: Marvin strips a `#token` from the title server-side and
          // stores the literal string as parentId, so "Review PR #412" becomes
          // "Review PR" filed under a container named "#412" that does not
          // exist. The task is then reachable by neither the tree crawl nor the
          // inbox. Going through createTask directly skipped this, which made
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
          journalled.push({
            id: created.id,
            before: null,
            after: { title: created.title },
          });
          results.push(`created "${created.title}" [${created.id}]`);
          break;
        }
        case "delete": {
          const before = await ctx.repo.getRaw(item.id);
          journalled.push({ id: item.id, before, after: null });
          await ctx.repo.deleteDoc(item.id);
          results.push(describe(item));
          break;
        }
      }
    }

    await ctx.journal.record("apply", journalled);
    return { applied: journalled.length, dryRun: false, results };
  },
  render({ applied, dryRun, results }) {
    const header = dryRun
      ? `would apply ${results.length} change(s)`
      : `applied ${applied} change(s)  (marvin undo to revert)`;
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
 * Snapshot only the keys about to change. Storing the whole document would make
 * the journal enormous and would risk undo clobbering unrelated concurrent edits.
 */
function pick(
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = source[key] ?? null;
  return out;
}
