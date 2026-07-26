/**
 * Mark a task done.
 *
 * Accepts either an id or a title fragment, because in practice you know what the
 * thing is called and not what its hash is. An ambiguous fragment refuses rather
 * than guessing, since completing the wrong task is annoying to reverse.
 */

import { z } from "zod";
import type { Task } from "../model.js";
import { defineOp, type Ctx } from "./types.js";
import { formatTask } from "./brief.js";

const input = z.object({
  task: z
    .string()
    .min(1)
    .describe("Task id, or part of its title"),
});

export const complete = defineOp({
  name: "complete",
  summary: "Mark a task done, by id or title fragment",
  input,
  mutates: true,
  positional: "task",
  async run({ task: needle }, ctx) {
    const match = await resolveTask(needle, ctx);
    await ctx.repo.markDone(match.id);
    return { ...match, done: true };
  },
  render(task) {
    return `done: ${formatTask(task)}`;
  },
});

/**
 * Shared by ops that take "an id or something that looks like a title".
 * Searches today's and the due list first, and only widens to the whole account
 * if neither matched.
 */
export async function resolveTask(
  needle: string,
  ctx: Pick<Ctx, "repo">
): Promise<Task> {
  const [today, due] = await Promise.all([ctx.repo.today(), ctx.repo.due()]);
  const near = dedupe([...today, ...due]);

  const exact = near.find((t) => t.id === needle);
  if (exact) return exact;

  let found = matchByTitle(near, needle);
  if (found.length === 1) return found[0];
  if (found.length > 1) throw ambiguous(needle, found);

  // Widen to the whole account. One query against the sync database.
  const all = await ctx.repo.everyTask();
  const byId = all.find((t) => t.id === needle);
  if (byId) return byId;

  found = matchByTitle(all, needle);
  if (found.length === 1) return found[0];
  if (found.length > 1) throw ambiguous(needle, found);

  // Last resort: it may be a real id that no listing returned.
  try {
    return await ctx.repo.getTask(needle);
  } catch {
    throw new Error(`No task matching "${needle}"`);
  }
}

function matchByTitle(tasks: Task[], needle: string): Task[] {
  const lower = needle.toLowerCase();
  const open = tasks.filter((t) => !t.done);
  const exact = open.filter((t) => t.title.toLowerCase() === lower);
  if (exact.length) return exact;
  return open.filter((t) => t.title.toLowerCase().includes(lower));
}

function dedupe(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return [...byId.values()];
}

function ambiguous(needle: string, matches: Task[]): Error {
  const list = matches
    .slice(0, 8)
    .map((t) => `  ${t.title}  [${t.id}]`)
    .join("\n");
  const more = matches.length > 8 ? `\n  ...and ${matches.length - 8} more` : "";
  return new Error(
    `"${needle}" matches ${matches.length} tasks. Use an id:\n${list}${more}`
  );
}
