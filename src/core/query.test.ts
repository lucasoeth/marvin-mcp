/**
 * The selectors `queryTasks` builds.
 *
 * These assert on the Mango query rather than on results, because the failure
 * mode here is silent: a selector that is subtly wrong returns a plausible list
 * with the wrong half of the account in it, and nothing about the output says
 * so.
 */

import { describe, expect, it } from "vitest";
import { INBOX, Repo, type TaskFilter } from "./repo.js";
import { UNASSIGNED } from "./model.js";
import type { MarvinClient } from "./client.js";
import type { SyncDb } from "./sync.js";

/** Runs a filter and hands back the selector the sync layer was given. */
async function selectorFor(filter: TaskFilter): Promise<any> {
  let captured: any;
  const sync = {
    async findWithMeta(query: { selector: unknown }) {
      captured = query.selector;
      return { docs: [] };
    },
  } as unknown as SyncDb;
  await new Repo({} as MarvinClient, sync).queryTasks(filter);
  return captured;
}

/** The AND clauses, or [] when the query had none. */
const clauses = (selector: any): any[] => selector.$and ?? [];

describe("queryTasks selectors", () => {
  it("scopes to tasks and hides completed ones by default", async () => {
    const selector = await selectorFor({});
    expect(selector.db).toBe("Tasks");
    expect(clauses(selector)).toEqual([{ done: { $ne: true } }]);
  });

  it("drops the done filter entirely for status=any", async () => {
    const selector = await selectorFor({ status: "any" });
    expect(clauses(selector)).toEqual([]);
  });

  it("ANDs every filter rather than replacing", async () => {
    const selector = await selectorFor({
      query: "invoice",
      parent: "proj1",
      noDeadline: true,
    });
    expect(clauses(selector)).toHaveLength(4); // done + query + parent + noDeadline
  });
});

describe("the unassigned sentinel", () => {
  // Marvin stores "unassigned" where most APIs store null, but only for `day`
  // and `parentId`; `dueDate` is nulled outright, and any of them can be absent
  // on an older document. Testing one shape returns the wrong half of the list.
  const emptyShapes = (clause: any, field: string) =>
    expect(clause.$or).toEqual([
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: "" },
      { [field]: UNASSIGNED },
    ]);

  it("treats the inbox as every empty shape of parentId", async () => {
    const [, parent] = clauses(await selectorFor({ parent: INBOX }));
    emptyShapes(parent, "parentId");
  });

  it("does not do that for a real container id", async () => {
    const [, parent] = clauses(await selectorFor({ parent: "proj1" }));
    expect(parent).toEqual({ parentId: "proj1" });
  });

  it("treats unscheduled as every empty shape of day", async () => {
    const [, day] = clauses(await selectorFor({ unscheduled: true }));
    emptyShapes(day, "day");
  });

  it("treats noDeadline as every empty shape of dueDate", async () => {
    const [, due] = clauses(await selectorFor({ noDeadline: true }));
    emptyShapes(due, "dueDate");
  });
});

describe("date ranges exclude the sentinel", () => {
  // "unassigned" sorts above every real date in CouchDB's string comparison,
  // because "u" > "9". An open-ended $gte would therefore return every
  // unscheduled task in the account — the exact opposite of asking for a range.
  it("sends both bounds even when only one was given", async () => {
    const [, day] = clauses(await selectorFor({ scheduledFrom: "2026-07-01" }));
    expect(day).toEqual({ day: { $gte: "2026-07-01", $lte: "9999-12-31" } });
  });

  it("bounds the lower end too", async () => {
    const [, due] = clauses(await selectorFor({ dueTo: "2026-08-01" }));
    expect(due).toEqual({ dueDate: { $gte: "0000-01-01", $lte: "2026-08-01" } });
  });

  it("keeps the sentinel outside the upper bound", () => {
    // The property the bound relies on, asserted directly so it cannot rot.
    expect(UNASSIGNED > "9999-12-31").toBe(true);
  });
});
