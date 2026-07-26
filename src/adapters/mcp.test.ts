import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { ops } from "../core/ops/index.js";
import {
  SERVER_INSTRUCTIONS,
  VERSION,
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

  it("leaves the read-only ops read-only", () => {
    for (const name of ["marvin_brief", "marvin_tasks", "marvin_hierarchy"]) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
  });
});

describe("result shape", () => {
  it("returns text only, never structuredContent", async () => {
    // Clients disagree about which field wins and discard the other. Claude
    // Code and VS Code drop the text and show the model stringified JSON;
    // Claude Desktop and Cursor ignore structuredContent. Emitting both meant
    // half of all clients never saw a render(). See callOp for the detail.
    const stub = {
      repo: { today: async () => [], due: async () => [] },
      now: () => new Date("2026-07-26T12:00:00Z"),
    } as unknown as Ctx;

    const result = await callOp("marvin_brief", {}, stub);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
  });

  it("declares no outputSchema, which would make structuredContent mandatory", () => {
    for (const tool of tools) {
      expect(
        (tool as { outputSchema?: unknown }).outputSchema,
        `${tool.name} must not declare an outputSchema`
      ).toBeUndefined();
    }
  });
});

describe("server instructions", () => {
  it("explains both date fields, which is the whole reason it exists", () => {
    expect(SERVER_INSTRUCTIONS).toContain("scheduledFor");
    expect(SERVER_INSTRUCTIONS).toContain("dueBy");
  });

  it("opens by naming when to reach for these tools", () => {
    // Under tool search the instructions are the only thing loaded at session
    // start, so the first sentence is what decides whether the model ever looks
    // for marvin_* at all. A bare product name does not do that.
    const opening = SERVER_INSTRUCTIONS.slice(0, 300);
    expect(opening).toMatch(/todo|task/i);
    expect(opening).toContain("marvin_brief");
  });

  it("stays under Claude Code's silent 2KB truncation cap", () => {
    // Billed per message, and truncated without warning above ~2048 bytes. The
    // nine-fields paragraph is at the bottom and is what falls off the cliff.
    const bytes = Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8");
    expect(bytes).toBeLessThan(1900);
  });
});

describe("the date warning reaches clients that ignore instructions", () => {
  // Claude Desktop receives the instructions field and never reads it
  // (claude-code#23808, #43749). It is also the .mcpb audience. So the two ops
  // that can move a real deadline restate the distinction in their own
  // descriptions, where every client sees it.
  it.each(["marvin_capture", "marvin_apply"])("%s says which field is which", (name) => {
    const description = byName.get(name)?.description ?? "";
    expect(description).toContain("scheduledFor");
    expect(description).toContain("dueBy");
  });
});

describe("server identity", () => {
  it("reports the real package version, not a hardcoded one", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
