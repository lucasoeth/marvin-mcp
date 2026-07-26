/**
 * Search.
 *
 * Marvin's public API documents no search endpoint and `/children` never returns
 * completed tasks, so this goes to the sync database instead: one Mango query,
 * complete, deterministic, and free against the API's daily budget. That is why
 * MARVIN_SYNC_* is required rather than optional — see AGENTS.md.
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
    "One query against the sync database, so it sees completed tasks too, " +
    "which the public API cannot return at all.",
  input,
  mutates: false,
  positional: "query",
  async run({ query, includeDone, limit }, ctx) {
    const tasks = await ctx.repo.searchTasks(query, includeDone);
    return { query, total: tasks.length, tasks: tasks.slice(0, limit) };
  },
  render({ query, total, tasks }) {
    if (total === 0) return `no tasks matching "${query}"`;
    const shown = tasks.map((t: Task) => "  " + formatTask(t)).join("\n");
    const truncated =
      total > tasks.length ? `\n  ...${total - tasks.length} more` : "";
    return `${total} matching "${query}"\n${shown}${truncated}`;
  },
});
