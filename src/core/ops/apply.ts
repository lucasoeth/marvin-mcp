/**
 * Batch mutation. The autonomy surface.
 *
 * The agent has full write authority, so the right shape is: reason over the
 * whole day, then commit one atomic change set. Twelve individual writes leave
 * the day half-rewritten if the sixth fails, and cost twelve round trips against
 * a rate-limited account.
 *
 * There is no preview mode. Whatever is driving this — a client that shows the
 * call and waits, or a person typing it — has already seen the change set by
 * the time it runs, and a second pass that resolves ids only tells you what
 * the caller is expected to already know.
 */

import { z } from "zod";
import { isValidDate, toMarvinPatch, type TaskPatch } from "../model.js";
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
});

type ChangeInput = z.infer<typeof change>;

export const apply = defineOp({
  name: "apply",
  summary: "Apply a batch of task changes as one ordered set",
  details:
    "Actions: update, complete, create, delete. Applied in order, in one call " +
    "rather than one request per change. " +
    // See capture.ts for why this line is repeated rather than left to
    // SERVER_INSTRUCTIONS.
    "scheduledFor is the day to work on it; dueBy is the deadline.",
  input,
  mutates: true,
  async run({ changes }, ctx) {
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

    return { applied: results.length, results };
  },
  render({ applied, results }) {
    return [
      `applied ${applied} change(s)`,
      ...results.map((r: string) => "  " + r),
    ].join("\n");
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
