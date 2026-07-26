/**
 * `apply --dry-run`.
 *
 * This is the only check a CLI write gets: there is no undo, and no client in
 * front of it asking for approval. A preview that reformats the arguments you
 * just typed does not qualify, which is what this used to do.
 */

import { describe, expect, it, vi } from "vitest";
import { apply } from "./apply.js";
import type { Task } from "../model.js";
import type { Ctx } from "./types.js";

const task = (over: Partial<Task> & { id: string; title: string }): Task => ({
  done: false,
  scheduledFor: null,
  dueBy: null,
  estimate: null,
  note: null,
  parentId: null,
  priority: 0,
  frog: 0,
  labelIds: [],
  ...over,
});

const shoes = task({
  id: "shoes",
  title: "Buy shoes",
  scheduledFor: "2026-01-02",
});
const drumming = task({
  id: "drum",
  title: "reach out to the drumming group",
  scheduledFor: "2026-04-12",
  note: "ask about beginner slots",
});

function ctxWith(writes: Record<string, unknown> = {}): Ctx {
  return {
    repo: {
      async tasksById(ids: string[]) {
        return new Map(
          [shoes, drumming].filter((t) => ids.includes(t.id)).map((t) => [t.id, t])
        );
      },
      ...writes,
    },
    now: () => new Date("2026-07-26T12:00:00Z"),
  } as unknown as Ctx;
}

const run = (changes: unknown[]) =>
  apply.run({ changes, dryRun: true } as any, ctxWith());

describe("a dry run resolves against the account", () => {
  it("names the task and shows what each field changes from", async () => {
    const { results } = await run([
      { action: "update", id: "shoes", set: { scheduledFor: "2026-07-27" } },
    ]);
    expect(results[0]).toContain('"Buy shoes"');
    expect(results[0]).toContain("scheduledFor: 2026-01-02 → 2026-07-27");
  });

  it("says none rather than null for a field that was empty", async () => {
    const { results } = await run([
      { action: "update", id: "shoes", set: { estimate: 30 } },
    ]);
    expect(results[0]).toContain("estimate: none → 30");
  });

  it("marks a value that is not actually changing", async () => {
    const { results } = await run([
      { action: "update", id: "shoes", set: { scheduledFor: "2026-01-02" } },
    ]);
    expect(results[0]).toContain("(unchanged)");
  });

  it("reports an id that does not exist instead of echoing it", async () => {
    // The most likely thing to be wrong in a hand-written or model-written
    // change set, and the whole reason to look before writing. The old preview
    // printed `delete also-fake` and called it a day.
    const { results } = await run([
      { action: "delete", id: "not-a-real-id" },
    ]);
    expect(results[0]).toMatch(/^ERROR/);
    expect(results[0]).toContain("no such task");
  });

  it("spells out what a delete destroys, since nothing can undo it", async () => {
    const { results } = await run([{ action: "delete", id: "drum" }]);
    expect(results[0]).toContain('"reach out to the drumming group"');
    expect(results[0]).toContain("for 2026-04-12");
    expect(results[0]).toContain("has a note");
    expect(results[0]).toContain("permanent");
  });

  it("does not need to resolve a create, which has no id yet", async () => {
    const { results } = await run([
      { action: "create", title: "ZZ scratch", set: { scheduledFor: "2026-07-28" } },
    ]);
    expect(results[0]).toContain('"ZZ scratch"');
    expect(results[0]).toContain("scheduledFor=2026-07-28");
  });
});

describe("a dry run writes nothing", () => {
  it("touches no write method, whatever the change set contains", async () => {
    const writes = {
      updateRaw: vi.fn(),
      markDone: vi.fn(),
      createTask: vi.fn(),
      deleteDoc: vi.fn(),
    };
    await apply.run(
      {
        dryRun: true,
        changes: [
          { action: "update", id: "shoes", set: { estimate: 5 } },
          { action: "complete", id: "shoes" },
          { action: "delete", id: "drum" },
          { action: "create", title: "ZZ scratch" },
        ],
      } as any,
      ctxWith(writes)
    );
    for (const [name, fn] of Object.entries(writes)) {
      expect(fn, name).not.toHaveBeenCalled();
    }
  });
});
