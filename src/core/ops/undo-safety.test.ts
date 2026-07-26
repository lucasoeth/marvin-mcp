/**
 * The ops that can destroy data, and the journal entries they leave behind.
 *
 * Everything here is a regression guard for a bug that shipped: each test names
 * the wrong behaviour it replaced, because "why is this asserted" is the part
 * that gets lost.
 */

import { describe, expect, it, vi } from "vitest";
import { apply } from "./apply.js";
import { complete } from "./complete.js";
import { undo } from "./undo.js";
import { UNASSIGNED } from "../model.js";
import type { Change } from "../journal.js";
import type { Ctx } from "./types.js";

interface Recorded {
  op: string;
  changes: Change[];
}

function ctxWith(repo: Record<string, unknown>, recorded: Recorded[] = []): Ctx {
  return {
    repo,
    journal: {
      record: async (op: string, changes: Change[]) => {
        if (changes.length) recorded.push({ op, changes });
      },
    },
    now: () => new Date("2026-07-26T12:00:00Z"),
  } as unknown as Ctx;
}

describe("apply journals what actually landed", () => {
  it("records the writes that succeeded when a later one throws", async () => {
    // Was: record() ran only after the loop, so a throw at change three left
    // changes one and two committed with no journal entry at all — and the next
    // `undo` silently reverted an older, unrelated change set instead.
    const recorded: Recorded[] = [];
    const updateRaw = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Marvin said no"));
    const ctx = ctxWith(
      {
        getRaw: async (id: string) => ({ _id: id, title: "before" }),
        updateRaw,
      },
      recorded
    );

    await expect(
      apply.run(
        {
          dryRun: false,
          changes: [
            { action: "update", id: "a", set: { title: "one" } },
            { action: "update", id: "b", set: { title: "two" } },
            { action: "update", id: "c", set: { title: "three" } },
          ],
        },
        ctx
      )
    ).rejects.toThrow("Marvin said no");

    expect(recorded).toHaveLength(1);
    expect(recorded[0].changes.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("writes no journal entry when the very first change fails", async () => {
    const recorded: Recorded[] = [];
    const ctx = ctxWith(
      {
        getRaw: async () => {
          throw new Error("not found");
        },
      },
      recorded
    );

    await expect(
      apply.run(
        { dryRun: false, changes: [{ action: "update", id: "a", set: { title: "x" } }] },
        ctx
      )
    ).rejects.toThrow();
    expect(recorded).toHaveLength(0);
  });
});

describe("completing a task journals every field markDone touches", () => {
  const marvinFields = (changes: Change[]) => Object.keys(changes[0].before!).sort();

  it("snapshots done, doneAt and day from apply", async () => {
    // Was: ["done"] only. /markDone also stamps doneAt and moves day from
    // unassigned to today, so undo restored one field of three and left the
    // task dated to whenever it was completed.
    const recorded: Recorded[] = [];
    const ctx = ctxWith(
      {
        getRaw: async () => ({ done: false, doneAt: null, day: "2026-07-20" }),
        markDone: async () => {},
      },
      recorded
    );

    await apply.run({ dryRun: false, changes: [{ action: "complete", id: "a" }] }, ctx);
    expect(marvinFields(recorded[0].changes)).toEqual(["day", "done", "doneAt"]);
    expect(recorded[0].changes[0].before).toMatchObject({ day: "2026-07-20" });
  });

  it("snapshots the same three from the complete op", async () => {
    const recorded: Recorded[] = [];
    const task = { id: "a", title: "pay invoice", done: false };
    const ctx = ctxWith(
      {
        today: async () => [task],
        due: async () => [],
        getRaw: async () => ({ done: false, doneAt: null, day: "unassigned" }),
        markDone: async () => {},
      },
      recorded
    );

    await complete.run({ task: "a" }, ctx);
    expect(marvinFields(recorded[0].changes)).toEqual(["day", "done", "doneAt"]);
  });

  it("restores day as the unassigned sentinel, never null", async () => {
    // Was: pick() used `?? null`. Restoring parentId or day as null files the
    // task under no container at all, which is not the inbox and is not
    // somewhere it can be found again.
    const recorded: Recorded[] = [];
    const ctx = ctxWith(
      {
        getRaw: async () => ({ done: false }), // no day, no doneAt
        markDone: async () => {},
      },
      recorded
    );

    await apply.run({ dryRun: false, changes: [{ action: "complete", id: "a" }] }, ctx);
    expect(recorded[0].changes[0].before).toEqual({
      done: false,
      doneAt: null,
      day: UNASSIGNED,
    });
  });

  it("restores a cleared parentId as the sentinel too", async () => {
    const recorded: Recorded[] = [];
    const ctx = ctxWith(
      { getRaw: async () => ({}), updateRaw: async () => {} },
      recorded
    );

    await apply.run(
      { dryRun: false, changes: [{ action: "update", id: "a", set: { parentId: "p1" } }] },
      ctx
    );
    expect(recorded[0].changes[0].before).toEqual({ parentId: UNASSIGNED });
  });
});

describe("undo refuses to delete a created task that has been edited since", () => {
  const entry = (ts: number) => ({
    ts,
    op: "capture",
    changes: [{ id: "new1", before: null, after: { title: "call dentist" } }],
  });

  function undoCtx(updatedAt: unknown, ts: number, deleteDoc = vi.fn()) {
    return {
      ctx: {
        repo: { getRaw: async () => ({ updatedAt }), deleteDoc },
        journal: {
          lastUndoable: async () => entry(ts),
          markUndone: async () => {},
        },
        now: () => new Date(),
      } as unknown as Ctx,
      deleteDoc,
    };
  }

  it("skips it, and says why", async () => {
    // "Capture it, then add the note, then undo the capture" destroyed the
    // note. The note is the part that cannot be retyped from memory.
    const { ctx, deleteDoc } = undoCtx(2_000, 1_000);
    const result = await undo.run({ dryRun: false }, ctx);
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(result.reverted).toBe(0);
    expect(result.skipped[0]).toContain("edited after it was created");
  });

  it("still deletes an untouched one", async () => {
    const { ctx, deleteDoc } = undoCtx(1_000, 2_000);
    const result = await undo.run({ dryRun: false }, ctx);
    expect(deleteDoc).toHaveBeenCalledWith("new1");
    expect(result.reverted).toBe(1);
  });

  it("treats an unreadable document as already gone rather than as edited", async () => {
    const deleteDoc = vi.fn();
    const ctx = {
      repo: {
        getRaw: async () => {
          throw new Error("404");
        },
        deleteDoc,
      },
      journal: { lastUndoable: async () => entry(1_000), markUndone: async () => {} },
      now: () => new Date(),
    } as unknown as Ctx;

    const result = await undo.run({ dryRun: false }, ctx);
    expect(result.reverted).toBe(1);
  });
});
