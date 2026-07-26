import { describe, expect, it } from "vitest";
import { Repo } from "./repo.js";
import type { MarvinClient } from "./client.js";

/**
 * Stub standing in for Marvin, recording what it was asked to do.
 *
 * `addTaskResponse` lets a test reproduce the server-side behaviour that matters
 * here: Marvin strips a `#token` from the title and returns it as `parentId`.
 */
function stubClient(addTaskResponse: Record<string, unknown>) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = {
    async post(path: string, body: unknown) {
      calls.push({ path, body });
      if (path === "/addTask") return addTaskResponse;
      return {};
    },
    async get() {
      return [];
    },
  } as unknown as MarvinClient;
  return { client, calls };
}

describe("createTask and Marvin's inline # handling", () => {
  it("puts the title back when Marvin invents a #parentId", async () => {
    // What Marvin actually returns for "Review PR #412": token eaten, stored
    // as a parentId that names no real container.
    const { client, calls } = stubClient({
      _id: "abc",
      db: "Tasks",
      title: "Review PR",
      parentId: "#412",
    });

    const task = await new Repo(client).createTask("Review PR #412");

    expect(task.title).toBe("Review PR #412");
    expect(task.parentId).toBeNull();

    const repair = calls.find((c) => c.path === "/doc/update");
    expect(repair, "a repair update should have been issued").toBeDefined();
    const setters = (repair!.body as { setters: Array<{ key: string; val: unknown }> })
      .setters;
    expect(setters).toContainEqual({ key: "title", val: "Review PR #412" });
    expect(setters).toContainEqual({ key: "parentId", val: "unassigned" });
  });

  it("honours an explicit parentId when repairing", async () => {
    const { client } = stubClient({
      _id: "abc",
      db: "Tasks",
      title: "Pay invoice",
      parentId: "#1042",
    });

    const task = await new Repo(client).createTask("Pay invoice #1042", {
      parentId: "real-container-id",
    });

    expect(task.title).toBe("Pay invoice #1042");
    expect(task.parentId).toBe("real-container-id");
  });

  it("leaves a genuine parentId alone", async () => {
    // A caller-resolved #Category is the working path and must not be undone.
    const { client, calls } = stubClient({
      _id: "abc",
      db: "Tasks",
      title: "Book a checkup",
      parentId: "1cf00c06-real-id",
    });

    const task = await new Repo(client).createTask("Book a checkup", {
      parentId: "1cf00c06-real-id",
    });

    expect(task.parentId).toBe("1cf00c06-real-id");
    expect(calls.find((c) => c.path === "/doc/update")).toBeUndefined();
  });

  it("does not repair an ordinary create", async () => {
    const { client, calls } = stubClient({
      _id: "abc",
      db: "Tasks",
      title: "Buy milk",
      parentId: "unassigned",
    });

    const task = await new Repo(client).createTask("Buy milk");

    expect(task.title).toBe("Buy milk");
    expect(task.parentId).toBeNull();
    expect(calls.find((c) => c.path === "/doc/update")).toBeUndefined();
  });
});
