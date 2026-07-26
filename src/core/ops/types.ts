/**
 * The op contract.
 *
 * An op is one unit of user intent. The CLI and the MCP adapters are both
 * generated from the registry of ops, so they cannot drift apart: adding an op
 * yields a `marvin <name>` command and a `marvin_<name>` tool at the same time.
 */

import type { z } from "zod";
import type { Journal } from "../journal.js";
import type { Repo } from "../repo.js";

export interface Ctx {
  repo: Repo;
  journal: Journal;
  /** Injected so tests can pin "today" without touching the clock. */
  now: () => Date;
}

export interface Op<I = unknown, O = unknown> {
  /** `brief` becomes `marvin brief` and the MCP tool `marvin_brief`. */
  name: string;
  /** Single source for --help text and the MCP tool description. */
  summary: string;
  /** Longer help, shown by `marvin <name> --help` and appended to the tool description. */
  details?: string;
  /** Validates CLI flags and MCP arguments alike. */
  input: z.ZodType<I>;
  /** When true the runner wraps the call in a journal entry so `undo` can revert it. */
  mutates: boolean;
  /**
   * Name of the input key that may be supplied positionally on the CLI, so
   * `marvin capture "buy milk"` works instead of `--text "buy milk"`.
   */
  positional?: string;
  /**
   * Exclude from the MCP surface.
   *
   * This is a deliberate hole in "the two surfaces cannot drift", and it is only
   * for ops that configure the client rather than act on Marvin. The remote MCP
   * server is reachable over the network, so a tool that writes credentials to
   * its disk is a footgun with no matching benefit. Do not reach for this to
   * make an ordinary capability CLI-only.
   */
  cliOnly?: boolean;
  run(input: I, ctx: Ctx): Promise<O>;
  /** Human-readable rendering. `--json` bypasses this and prints the raw output. */
  render(output: O): string;
}

/** Identity helper that pins the generics so each op file stays inference-friendly. */
export function defineOp<I, O>(op: Op<I, O>): Op<I, O> {
  return op;
}
