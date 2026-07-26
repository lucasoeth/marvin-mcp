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
 *
 * A created item that has been edited since is left alone. "Capture it, then
 * add the note and the estimate, then undo the capture" would otherwise destroy
 * the note along with the task, and the note is the part that cannot be
 * retyped from memory.
 */

import { z } from "zod";
import { defineOp, type Ctx } from "./types.js";

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
        // Created by the op being undone, so undoing means removing it — but
        // only if it is still the thing that was created. `entry.ts` is stamped
        // after every write in the set lands, so a later `updatedAt` means a
        // human or another client touched the document in between, and deleting
        // it would take their edit with it.
        const title = change.after.title;
        const label = typeof title === "string" ? `"${title}"` : change.id;
        if (await editedSince(change.id, entry.ts, ctx)) {
          skipped.push(`${label} was edited after it was created; left alone`);
          continue;
        }
        if (!dryRun) await ctx.repo.deleteDoc(change.id);
        details.push(`deleted ${label}`);
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

/**
 * Whether the document has a newer `updatedAt` than the change set that created
 * it. `updateRaw` maintains `updatedAt` on every write, ours included.
 *
 * A document that can no longer be read is not treated as edited: it has most
 * likely already been deleted by hand, and the delete below is then a no-op.
 */
async function editedSince(
  id: string,
  ts: number,
  ctx: Pick<Ctx, "repo">
): Promise<boolean> {
  let updatedAt: unknown;
  try {
    updatedAt = (await ctx.repo.getRaw(id)).updatedAt;
  } catch {
    return false;
  }
  return typeof updatedAt === "number" && updatedAt > ts;
}
