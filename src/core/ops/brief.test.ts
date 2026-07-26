import { describe, expect, it } from "vitest";
import { brief } from "./brief.js";
import type { Ctx } from "./types.js";
import type { Task } from "../model.js";

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    title: partial.id,
    done: false,
    scheduledFor: null,
    dueBy: null,
    estimate: null,
    note: null,
    parentId: null,
    priority: 0,
    frog: 0,
    labelIds: [],
    ...partial,
  };
}

/** Only the surface brief actually touches. */
function ctxWith(today: Task[], due: Task[]): Ctx {
  return {
    repo: {
      today: async () => today,
      due: async () => due,
    } as unknown as Ctx["repo"],
    journal: {} as Ctx["journal"],
    now: () => new Date(2026, 6, 26),
  };
}

const TODAY = "2026-07-26";

describe("brief", () => {
  it("separates overdue from scheduled-today", async () => {
    const result = await brief.run(
      { horizon: 7 },
      ctxWith(
        [task({ id: "scheduled", scheduledFor: TODAY })],
        [task({ id: "late", dueBy: "2026-05-20" })]
      )
    );
    expect(result.today.map((t) => t.id)).toEqual(["scheduled"]);
    expect(result.overdue.map((t) => t.id)).toEqual(["late"]);
  });

  it("surfaces deadlines inside the horizon that have no day assigned", async () => {
    // The whole reason brief exists: this is how a task silently rots past due.
    const result = await brief.run(
      { horizon: 7 },
      ctxWith([], [task({ id: "unplanned", dueBy: "2026-07-29" })])
    );
    expect(result.dueSoonUnscheduled.map((t) => t.id)).toEqual(["unplanned"]);
  });

  it("does not flag a deadline that already has a day", async () => {
    const result = await brief.run(
      { horizon: 7 },
      ctxWith(
        [],
        [task({ id: "planned", dueBy: "2026-07-29", scheduledFor: "2026-07-28" })]
      )
    );
    expect(result.dueSoonUnscheduled).toEqual([]);
  });

  it("respects the horizon", async () => {
    const far = [task({ id: "far", dueBy: "2026-09-01" })];
    expect(
      (await brief.run({ horizon: 7 }, ctxWith([], far))).dueSoonUnscheduled
    ).toEqual([]);
    expect(
      (await brief.run({ horizon: 90 }, ctxWith([], far))).dueSoonUnscheduled
    ).toHaveLength(1);
  });

  it("excludes completed work from the open lists and counts it separately", async () => {
    const result = await brief.run(
      { horizon: 7 },
      ctxWith(
        [
          task({ id: "open", scheduledFor: TODAY }),
          task({ id: "shipped", scheduledFor: TODAY, done: true }),
        ],
        []
      )
    );
    expect(result.today.map((t) => t.id)).toEqual(["open"]);
    expect(result.completedToday.map((t) => t.id)).toEqual(["shipped"]);
  });

  it("sums estimates for open work only", async () => {
    const result = await brief.run(
      { horizon: 7 },
      ctxWith(
        [
          task({ id: "a", scheduledFor: TODAY, estimate: 30 }),
          task({ id: "b", scheduledFor: TODAY, estimate: 45 }),
          task({ id: "c", scheduledFor: TODAY, estimate: 60, done: true }),
        ],
        []
      )
    );
    expect(result.totalEstimateMinutes).toBe(75);
  });

  it("orders by frog, then priority, then nearest deadline", async () => {
    const result = await brief.run(
      { horizon: 7 },
      ctxWith(
        [
          task({ id: "plain", scheduledFor: TODAY }),
          task({ id: "frog", scheduledFor: TODAY, frog: 2 }),
          task({ id: "urgent", scheduledFor: TODAY, priority: 3 }),
        ],
        []
      )
    );
    expect(result.today.map((t) => t.id)).toEqual(["frog", "urgent", "plain"]);
  });

  it("does not double-count a task present in both today and due", async () => {
    const shared = task({ id: "both", scheduledFor: TODAY, dueBy: "2026-05-01" });
    const result = await brief.run({ horizon: 7 }, ctxWith([shared], [shared]));
    expect(result.overdue).toHaveLength(1);
  });
});
