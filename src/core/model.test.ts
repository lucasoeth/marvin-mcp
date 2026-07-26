import { describe, expect, it } from "vitest";
import {
  addDays,
  isValidDate,
  toContainer,
  toMarvinPatch,
  toTask,
  today,
} from "./model.js";

describe("toTask", () => {
  it("converts timeEstimate from milliseconds to minutes", () => {
    // Regression: the old schema advertised minutes and passed the value
    // through raw, so a 30-minute estimate was stored as 30ms.
    expect(toTask({ timeEstimate: 2_700_000 }).estimate).toBe(45);
    expect(toTask({ timeEstimate: 1_800_000 }).estimate).toBe(30);
  });

  it("treats a zero estimate as absent rather than zero minutes", () => {
    expect(toTask({ timeEstimate: 0 }).estimate).toBeNull();
  });

  it('maps Marvin\'s "unassigned" sentinel to null', () => {
    const task = toTask({ day: "unassigned", parentId: "unassigned" });
    expect(task.scheduledFor).toBeNull();
    expect(task.parentId).toBeNull();
  });

  it("keeps scheduledFor and dueBy independent", () => {
    const task = toTask({ day: "2026-07-26", dueDate: "2026-08-01" });
    expect(task.scheduledFor).toBe("2026-07-26");
    expect(task.dueBy).toBe("2026-08-01");
  });

  it("collapses the legacy boolean form of isStarred to 1", () => {
    // The wiki notes these may be `true` from an older version.
    expect(toTask({ isStarred: true }).priority).toBe(1);
    expect(toTask({ isFrogged: true }).frog).toBe(1);
  });

  it("clamps salience into 0..3", () => {
    expect(toTask({ isStarred: 9 }).priority).toBe(3);
    expect(toTask({ isStarred: -4 }).priority).toBe(0);
    expect(toTask({ isStarred: undefined }).priority).toBe(0);
  });
});

describe("toMarvinPatch", () => {
  it("converts minutes back to milliseconds", () => {
    expect(toMarvinPatch({ estimate: 45 })).toEqual({ timeEstimate: 2_700_000 });
  });

  it("distinguishes omitted from explicitly cleared", () => {
    // undefined means leave alone; null means clear. Collapsing the two would
    // make it impossible to unschedule a task.
    expect(toMarvinPatch({})).toEqual({});
    expect(toMarvinPatch({ scheduledFor: null })).toEqual({ day: "unassigned" });
    expect(toMarvinPatch({ dueBy: null })).toEqual({ dueDate: null });
  });

  it("maps the renamed date fields onto Marvin's names", () => {
    expect(toMarvinPatch({ scheduledFor: "2026-07-26", dueBy: "2026-08-01" })).toEqual({
      day: "2026-07-26",
      dueDate: "2026-08-01",
    });
  });

  it("round-trips an estimate through both mappers", () => {
    const patch = toMarvinPatch({ estimate: 90 });
    expect(toTask(patch).estimate).toBe(90);
  });
});

describe("toContainer", () => {
  it("distinguishes projects from categories by the type field", () => {
    expect(toContainer({ type: "project" }).kind).toBe("project");
    expect(toContainer({ type: "category" }).kind).toBe("category");
    expect(toContainer({}).kind).toBe("category");
  });

  it("treats a root parent as no parent", () => {
    expect(toContainer({ parentId: "root" }).parentId).toBeNull();
  });
});

describe("isValidDate", () => {
  it("rejects dates that only exist after JS rollover", () => {
    // Regression: the old validator accepted these because `new Date()`
    // silently rolls them into the following month.
    expect(isValidDate("2024-02-31")).toBe(false);
    expect(isValidDate("2025-11-31")).toBe(false);
  });

  it("accepts real dates including leap days", () => {
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2026-07-26")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidDate("2024-13-01")).toBe(false);
    expect(isValidDate("26-07-2026")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });
});

describe("today / addDays", () => {
  it("uses the local calendar date, not UTC", () => {
    // 23:30 local on the 26th must be the 26th even where UTC has ticked over.
    expect(today(new Date(2026, 6, 26, 23, 30))).toBe("2026-07-26");
    expect(today(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-07-26", 7)).toBe("2026-08-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
