/**
 * The container tree.
 *
 * Needed mostly so an agent can resolve "file this under Work" to a parentId
 * before calling capture or apply.
 */

import { z } from "zod";
import type { Container } from "../model.js";
import { defineOp } from "./types.js";

const input = z.object({
  kind: z
    .enum(["all", "project", "category"])
    .default("all")
    .describe("Restrict to projects or categories"),
});

export const hierarchy = defineOp({
  name: "hierarchy",
  summary: "List projects and categories, as a tree",
  input,
  mutates: false,
  async run({ kind }, ctx) {
    const all = await ctx.repo.containers();
    const containers = kind === "all" ? all : all.filter((c) => c.kind === kind);
    return { containers };
  },
  render({ containers }) {
    if (containers.length === 0) return "no projects or categories";

    const byParent = new Map<string | null, Container[]>();
    const ids = new Set(containers.map((c) => c.id));
    for (const container of containers) {
      // Treat a parent outside the filtered set as a root, so filtering by kind
      // does not silently hide anything.
      const key =
        container.parentId && ids.has(container.parentId)
          ? container.parentId
          : null;
      const siblings = byParent.get(key) ?? [];
      siblings.push(container);
      byParent.set(key, siblings);
    }

    const lines: string[] = [];
    const walk = (parent: string | null, depth: number, seen: Set<string>) => {
      const children = (byParent.get(parent) ?? []).sort((a, b) =>
        a.title.localeCompare(b.title)
      );
      for (const child of children) {
        if (seen.has(child.id)) continue; // guard against a parentId cycle
        seen.add(child.id);
        const marks = [child.kind === "project" ? "project" : "category"];
        if (child.done) marks.push("done");
        lines.push(
          `${"  ".repeat(depth)}${child.title}  (${marks.join(", ")})  [${child.id}]`
        );
        walk(child.id, depth + 1, seen);
      }
    };
    walk(null, 0, new Set());
    return lines.join("\n");
  },
});
