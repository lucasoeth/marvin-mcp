/**
 * The op registry.
 *
 * The single source both adapters are generated from. Add an op here and it
 * becomes a CLI command and an MCP tool at the same time, with the same schema,
 * the same description and the same rendering.
 */

import type { Op } from "./types.js";
import { apply } from "./apply.js";
import { auth } from "./auth.js";
import { brief } from "./brief.js";
import { capture } from "./capture.js";
import { complete } from "./complete.js";
import { find } from "./find.js";
import { hierarchy } from "./hierarchy.js";
import { undo } from "./undo.js";

export const ops: Op<any, any>[] = [
  brief,
  capture,
  complete,
  find,
  hierarchy,
  apply,
  undo,
  auth,
];

export function findOp(name: string): Op<any, any> | undefined {
  return ops.find((op) => op.name === name);
}

export { type Ctx, type Op } from "./types.js";
