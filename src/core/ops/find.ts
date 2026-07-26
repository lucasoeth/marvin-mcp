/**
 * Search escape hatch.
 *
 * Marvin documents no search endpoint and no bulk export, so this crawls the
 * container tree and filters locally. That is genuinely the only option, not
 * laziness. It is the slowest op by a wide margin, hence not part of the daily
 * loop.
 */

import { z } from "zod";
import { defineOp } from "./types.js";
import { formatTask } from "./brief.js";
import type { Task } from "../model.js";

const input = z.object({
  query: z.string().min(1).describe("Matched against task titles and notes"),
  includeDone: z.boolean().default(false).describe("Include completed tasks"),
  limit: z.number().int().min(1).max(200).default(50),
});

export const find = defineOp({
  name: "find",
  summary: "Search tasks by keyword across the whole workspace",
  details:
    "Crawls every container and filters client-side, because the Marvin API " +
    "exposes no search endpoint. Slower than the other reads.",
  input,
  mutates: false,
  positional: "query",
  async run({ query, includeDone, limit }, ctx) {
    const needle = query.toLowerCase();
    const { tasks, unreadable } = await ctx.repo.allTasks();
    const matches = tasks
      .filter((t) => includeDone || !t.done)
      .filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          (t.note?.toLowerCase().includes(needle) ?? false)
      );
    return {
      query,
      total: matches.length,
      tasks: matches.slice(0, limit),
      unreadable,
    };
  },
  render({ query, total, tasks, unreadable }) {
    // Never report "not found" as though the search were complete.
    const caveat = unreadable.length
      ? `\n  warning: ${unreadable.length} container(s) could not be read, ` +
        `so this result may be incomplete`
      : "";
    if (total === 0) return `no tasks matching "${query}"${caveat}`;
    const shown = tasks.map((t: Task) => "  " + formatTask(t)).join("\n");
    const truncated =
      total > tasks.length ? `\n  ...${total - tasks.length} more` : "";
    return `${total} matching "${query}"\n${shown}${truncated}${caveat}`;
  },
});
