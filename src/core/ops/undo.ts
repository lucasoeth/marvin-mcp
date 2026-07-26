/**
 * Revert the most recent change set.
 *
 * The safety net for full write autonomy. Marvin itself has no undo, so this
 * replays the journal's before-state back onto the affected documents.
 *
 * Created items are undone by deleting them: "I just captured that by mistake"
 * is the most common reason to reach for undo, so skipping it would make the
 * command useless in its most likely case.
 *
 * Deletes cannot be undone. Marvin issues a new id on recreate, so restoring one
 * would silently break anything referencing the old id. Those are reported as
 * skipped rather than faked.
 */

import { z } from "zod";
import { defineOp } from "./types.js";

const input = z.object({
  dryRun: z
    .boolean()
    .default(false)
    .describe("Show what would be reverted without writing"),
});

export const undo = defineOp({
  name: "undo",
  summary: "Revert the last change set",
  input,
  // Writes to Marvin, so clients must treat it as a change. It deliberately
  // journals nothing of its own: an undo of an undo is worse than no undo.
  mutates: true,
  async run({ dryRun }, ctx) {
    const entry = await ctx.journal.lastUndoable();
    if (!entry) return { reverted: 0, op: null, details: [], skipped: [] };

    const details: string[] = [];
    const skipped: string[] = [];

    for (const change of entry.changes) {
      if (change.after === null) {
        skipped.push(`${change.id} was deleted; Marvin cannot restore it`);
        continue;
      }
      if (change.before === null) {
        // Created by the op being undone, so undoing means removing it.
        if (!dryRun) await ctx.repo.deleteDoc(change.id);
        const title = change.after.title;
        details.push(
          `deleted ${typeof title === "string" ? `"${title}"` : change.id}`
        );
        continue;
      }
      if (!dryRun) await ctx.repo.updateRaw(change.id, change.before);
      details.push(`${change.id}: restored ${Object.keys(change.before).join(", ")}`);
    }

    if (!dryRun) await ctx.journal.markUndone(entry.ts);
    return { reverted: details.length, op: entry.op, details, skipped };
  },
  render({ reverted, op, details, skipped }) {
    if (op === null) return "nothing to undo";
    const lines = [`reverted ${reverted} change(s) from "${op}"`];
    lines.push(...details.map((d: string) => "  " + d));
    if (skipped.length) {
      lines.push("skipped:");
      lines.push(...skipped.map((s: string) => "  " + s));
    }
    return lines.join("\n");
  },
});
