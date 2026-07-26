/**
 * The daily picture in one call.
 *
 * Existing tools needed four or more round trips to answer "what should I do
 * now?". This answers it once, and specifically surfaces the failure mode the
 * account is already exhibiting: things with a deadline that were never given a
 * day, which quietly rot past due.
 */

import { z } from "zod";
import { type Task, addDays, today as todayStr } from "../model.js";
import { defineOp } from "./types.js";

const input = z.object({
  horizon: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(7)
    .describe("How many days ahead to consider a deadline 'approaching'"),
});

export interface Brief {
  date: string;
  /** Scheduled for today and not finished. */
  today: Task[];
  /** Past their deadline. */
  overdue: Task[];
  /** Deadline inside the horizon but no day assigned. The planning prompt. */
  dueSoonUnscheduled: Task[];
  /** Finished today, for a sense of progress. */
  completedToday: Task[];
  totalEstimateMinutes: number;
}

export const brief = defineOp({
  name: "brief",
  summary: "Today's plan: scheduled, overdue, and deadlines with no day assigned",
  details:
    "Combines /todayItems and /dueItems into a single picture. Anything with a " +
    "deadline inside the horizon but no scheduled day is called out separately, " +
    "since that is how tasks silently go overdue.",
  input,
  mutates: false,
  async run({ horizon }, ctx) {
    const date = todayStr(ctx.now());
    const limit = addDays(date, horizon);

    const [todayTasks, dueTasks] = await Promise.all([
      ctx.repo.today(),
      ctx.repo.due(),
    ]);

    const open = (task: Task) => !task.done;
    const byId = new Map<string, Task>();
    for (const task of [...todayTasks, ...dueTasks]) byId.set(task.id, task);
    const all = [...byId.values()];

    return {
      date,
      today: todayTasks.filter(open).sort(byUrgency),
      overdue: all
        .filter((t) => open(t) && t.dueBy !== null && t.dueBy < date)
        .sort(byUrgency),
      dueSoonUnscheduled: all
        .filter(
          (t) =>
            open(t) &&
            t.scheduledFor === null &&
            t.dueBy !== null &&
            t.dueBy >= date &&
            t.dueBy <= limit
        )
        .sort(byUrgency),
      completedToday: todayTasks.filter((t) => t.done),
      totalEstimateMinutes: todayTasks
        .filter(open)
        .reduce((sum, t) => sum + (t.estimate ?? 0), 0),
    } satisfies Brief;
  },
  render(brief) {
    const lines: string[] = [`${brief.date}`];

    if (brief.overdue.length) {
      lines.push("", `Overdue (${brief.overdue.length})`);
      lines.push(...brief.overdue.map((t) => "  " + formatTask(t, brief.date)));
    }

    lines.push("", `Today (${brief.today.length})`);
    if (brief.today.length === 0) {
      lines.push("  nothing scheduled");
    } else {
      lines.push(...brief.today.map((t) => "  " + formatTask(t, brief.date)));
      if (brief.totalEstimateMinutes > 0) {
        lines.push(`  ${formatMinutes(brief.totalEstimateMinutes)} estimated`);
      }
    }

    if (brief.dueSoonUnscheduled.length) {
      lines.push(
        "",
        `Due soon, no day assigned (${brief.dueSoonUnscheduled.length})`
      );
      lines.push(
        ...brief.dueSoonUnscheduled.map((t) => "  " + formatTask(t, brief.date))
      );
    }

    if (brief.completedToday.length) {
      lines.push("", `Done today: ${brief.completedToday.length}`);
    }

    return lines.join("\n");
  },
});

/** Frog first, then priority, then nearest deadline. */
function byUrgency(a: Task, b: Task): number {
  if (a.frog !== b.frog) return b.frog - a.frog;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.dueBy && b.dueBy) return a.dueBy.localeCompare(b.dueBy);
  if (a.dueBy) return -1;
  if (b.dueBy) return 1;
  return a.title.localeCompare(b.title);
}

export function formatTask(task: Task, relativeTo?: string): string {
  const marks: string[] = [];
  if (task.frog > 0) marks.push("frog");
  if (task.priority > 0) marks.push("!".repeat(task.priority));
  if (task.estimate) marks.push(formatMinutes(task.estimate));
  if (task.dueBy) {
    marks.push(
      relativeTo && task.dueBy < relativeTo
        ? `due ${task.dueBy}, overdue`
        : `due ${task.dueBy}`
    );
  }
  if (task.scheduledFor && task.scheduledFor !== relativeTo) {
    marks.push(`for ${task.scheduledFor}`);
  }
  const suffix = marks.length ? `  (${marks.join(", ")})` : "";
  return `${task.done ? "x" : "-"} ${task.title}${suffix}  [${task.id}]`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${rest}m` : `${hours}h`;
}
