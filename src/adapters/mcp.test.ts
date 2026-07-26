import { describe, expect, it } from "vitest";
import { ops } from "../core/ops/index.js";
import {
  SERVER_INSTRUCTIONS,
  callOp,
  toolsFromRegistry,
  toolNameFor,
} from "./mcp.js";
import type { Ctx } from "../core/ops/types.js";

const tools = toolsFromRegistry();
const byName = new Map(tools.map((t) => [t.name, t]));

describe("the MCP surface", () => {
  it("exposes every op except the cliOnly ones", () => {
    const expected = ops.filter((op) => !op.cliOnly).map(toolNameFor);
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
  });

  it("never exposes auth, which writes credentials to disk", () => {
    // The remote server is internet-reachable. This is a security property, not
    // a tidiness one, so it is pinned rather than left to reviewer attention.
    expect(byName.has("marvin_auth")).toBe(false);
  });

  it("refuses to invoke a cliOnly op even when named directly", async () => {
    const result = await callOp("marvin_auth", { apiToken: "x" }, {} as Ctx);
    expect(result.isError).toBe(true);
    expect(String(result.content[0].text)).toContain("Unknown tool");
  });
});

describe("tool annotations", () => {
  it("marks every writing op as destructive and not read-only", () => {
    for (const op of ops.filter((o) => !o.cliOnly && o.mutates)) {
      const tool = byName.get(toolNameFor(op))!;
      expect(tool.annotations?.readOnlyHint, `${op.name} readOnlyHint`).toBe(
        false
      );
      expect(
        tool.annotations?.destructiveHint,
        `${op.name} destructiveHint`
      ).toBe(true);
    }
  });

  it("marks undo as a write", () => {
    // Regression guard. `mutates` used to mean "journals for undo", under which
    // undo was false — advertising to every client that reverting a change set
    // is read-only and safe to call unattended. It writes to Marvin.
    expect(byName.get("marvin_undo")?.annotations?.readOnlyHint).toBe(false);
  });

  it("leaves the read-only ops read-only", () => {
    for (const name of ["marvin_brief", "marvin_find", "marvin_hierarchy"]) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
  });
});

describe("server instructions", () => {
  it("explains both date fields, which is the whole reason it exists", () => {
    expect(SERVER_INSTRUCTIONS).toContain("scheduledFor");
    expect(SERVER_INSTRUCTIONS).toContain("dueBy");
  });

  it("stays small enough to carry in every message", () => {
    // Billed per message. A rough character budget is enough to catch someone
    // pasting an essay in here later.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(3000);
  });
});
