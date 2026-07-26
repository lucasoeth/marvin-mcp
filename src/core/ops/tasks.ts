/**
 * The general read.
 *
 * `brief` answers one question well and `hierarchy` lists containers, which
 * left no way to ask anything else: what is in the inbox, what was captured and
 * never scheduled, what is sitting in a given project. Those tasks were not
 * hidden by design — nothing exposed them. Anything captured without a date was
 * invisible to every read the tool had unless you remembered its title well
 * enough to search for it, which is a poor property in the one place a capture
 * habit is supposed to pay off.
 *
 * This replaces `find`. Keyword search is `query`, one filter among several,
 * rather than the only way in.
 *
 * Reads are constrained by nothing but taste, so this is deliberately general:
 * one Mango query against the sync database, free against Marvin's API budget,
 * and it sees completed tasks, which the public API cannot return at all.
 */

import { z } from "zod";
import { INBOX } from "../repo.js";
import { isValidDate, type Task } from "../model.js";
import { defineOp } from "./types.js";
import { formatTask } from "./brief.js";

const date = z
  .string()
  .refine(isValidDate, "expected a real calendar date as YYYY-MM-DD");

const input = z.object({
  query: z.string().optional().describe("Substring of the title or note"),
  parent: z
    .string()
    .optional()
    .describe(`Container id, or "${INBOX}" for tasks filed nowhere`),
  unscheduled: z.boolean().optional().describe("Only tasks with no day assigned"),
  noDeadline: z.boolean().optional().describe("Only tasks with no deadline"),
  scheduledFrom: date.optional().describe("Earliest scheduled day"),
  scheduledTo: date.optional().describe("Latest scheduled day"),
  dueFrom: date.optional().describe("Earliest deadline"),
  dueTo: date.optional().describe("Latest deadline"),
  status: z
    .enum(["open", "done", "any"])
    .default("open")
    .describe("Completion state to include"),
  limit: z.number().int().min(1).max(200).default(50),
});

export const tasks = defineOp({
  name: "tasks",
  summary: "List tasks, filtered. No filters means every open task",
  details:
    "Filters combine with AND. One database query however many are set, and " +
    'it does not count against Marvin\'s API budget. Use parent="' +
    INBOX +
    '" for the inbox and unscheduled=true for anything captured but never ' +
    "given a day.",
  input,
  mutates: false,
  positional: "query",
  async run(filter, ctx) {
    const { limit, ...rest } = filter;
    const { tasks: found, warning } = await ctx.repo.queryTasks(rest);
    const ordered = [...found].sort(byPlanningOrder);
    return {
      total: ordered.length,
      tasks: ordered.slice(0, limit),
      warning,
    };
  },
  render({ total, tasks: shown, warning }) {
    if (total === 0) return "no tasks match";

    const lines = [
      `${total} task${total === 1 ? "" : "s"}`,
      ...shown.map((task: Task) => "  " + formatTask(task)),
    ];
    if (total > shown.length) {
      lines.push(`  ...${total - shown.length} more`);
    }
    // Surfaced rather than swallowed: this is CouchDB saying the query was a
    // full scan. Harmless at this size, and the only warning you would ever get
    // before it stops being harmless.
    if (warning) lines.push(`note: ${warning}`);
    return lines.join("\n");
  },
});

/**
 * Soonest first, by the day you plan to do it, then by deadline. Tasks with
 * neither sort last: they are the pile you have not decided about, and burying
 * the decided work under them is backwards.
 */
function byPlanningOrder(a: Task, b: Task): number {
  const key = (task: Task) => task.scheduledFor ?? task.dueBy ?? "￿";
  const ordered = key(a).localeCompare(key(b));
  return ordered !== 0 ? ordered : a.title.localeCompare(b.title);
}
