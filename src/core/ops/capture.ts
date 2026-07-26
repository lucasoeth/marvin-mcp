/**
 * The habit primitive.
 *
 * The account audit found nothing gets captured, and every other ritual is
 * downstream of capture. So this has to be the fastest thing in the tool: plain
 * text in, task out, no LLM and no client-side date parsing.
 *
 * Marvin expands `+today` and `+tomorrow` out of the title server-side, which
 * works correctly and is left alone.
 *
 * `#Category` is NOT left alone. Marvin strips the token from the title but
 * stores the literal string as parentId (verified: `parentId: "#Admin"`), which
 * dangles — the task then belongs to no real container, does not appear under
 * that category, and is not in `unassigned` either, so nothing can find it
 * again. We therefore resolve `#Name` against the real container list here and
 * pass a genuine id.
 */

import { z } from "zod";
import { isValidDate } from "../model.js";
import { defineOp, type Ctx } from "./types.js";
import { formatTask } from "./brief.js";

const date = z
  .string()
  .refine(isValidDate, "expected a real calendar date as YYYY-MM-DD");

const input = z.object({
  text: z
    .string()
    .min(1)
    .describe(
      "Task title. Supports Marvin inline syntax: +today, +tomorrow, #Category, @label"
    ),
  scheduledFor: date.optional().describe("Day to work on it (YYYY-MM-DD)"),
  dueBy: date.optional().describe("Deadline (YYYY-MM-DD)"),
  estimate: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Estimate in minutes"),
  note: z.string().optional(),
  parentId: z.string().optional().describe("Project or category to file it under"),
  priority: z.number().int().min(0).max(3).optional().describe("0 none to 3 red"),
  frog: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe("0 none, 1 normal, 2 baby, 3 monster"),
});

export const capture = defineOp({
  name: "capture",
  summary: "Add a task. Supports +today, #Category and @label inline",
  details:
    "Inline syntax is expanded by Marvin itself, so no date parsing happens " +
    "locally. Explicit flags win over anything inferred from the title.",
  input,
  mutates: true,
  positional: "text",
  async run({ text, ...patch }, ctx) {
    let title = text;
    let parentId = patch.parentId;

    // An explicit --parent-id always wins over anything in the title.
    if (!parentId) {
      const resolved = await resolveInlineParent(text, ctx);
      title = resolved.title;
      parentId = resolved.parentId;
    }

    const task = await ctx.repo.createTask(title, {
      scheduledFor: patch.scheduledFor,
      dueBy: patch.dueBy,
      estimate: patch.estimate,
      note: patch.note,
      parentId,
      priority: patch.priority as 0 | 1 | 2 | 3 | undefined,
      frog: patch.frog as 0 | 1 | 2 | 3 | undefined,
    });
    await ctx.journal.record("capture", [
      { id: task.id, before: null, after: { title: task.title } },
    ]);
    return task;
  },
  render(task) {
    return formatTask(task);
  },
});

/**
 * Pull a `#Category` token out of the title and resolve it to a real container id.
 *
 * Matching is case-insensitive, exact title first, then unique prefix. An
 * unresolvable token is left in the title untouched rather than guessed at: a
 * wrong parent silently files the task somewhere you will never look, which is
 * worse than a slightly ugly title.
 */
export async function resolveInlineParent(
  text: string,
  ctx: Ctx
): Promise<{ title: string; parentId: string | undefined }> {
  const match = text.match(/(?:^|\s)#([\p{L}\p{N}_-]+)/u);
  if (!match) return { title: text, parentId: undefined };

  const token = match[1];
  let containers: Awaited<ReturnType<Ctx["repo"]["containers"]>>;
  try {
    containers = await ctx.repo.containers();
  } catch {
    return { title: text, parentId: undefined };
  }

  const lower = token.toLowerCase();
  const exact = containers.filter((c) => c.title.toLowerCase() === lower);
  const candidates =
    exact.length > 0
      ? exact
      : containers.filter((c) => c.title.toLowerCase().startsWith(lower));

  if (candidates.length !== 1) return { title: text, parentId: undefined };

  const title = (text.slice(0, match.index) + text.slice(match.index! + match[0].length))
    .replace(/\s{2,}/g, " ")
    .trim();

  return { title: title || text, parentId: candidates[0].id };
}
