/**
 * MCP adapter.
 *
 * Generated from the same op registry as the CLI, so the two surfaces cannot
 * drift. Each op becomes tool `marvin_<name>`, its zod schema becomes the tool's
 * inputSchema, and its render() becomes the text content.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { MarvinError } from "../core/client.js";
import { ops } from "../core/ops/index.js";
import type { Ctx, Op } from "../core/ops/types.js";
import { schemaOf } from "./cli.js";

export const TOOL_PREFIX = "marvin_";

export function toolNameFor(op: Op<any, any>): string {
  return TOOL_PREFIX + op.name;
}

/** Ops the MCP surface exposes. See `Op.cliOnly` for why anything is excluded. */
const exposed = () => ops.filter((op) => !op.cliOnly);

/**
 * Annotations come straight from `mutates`, so they cannot disagree with what
 * the op actually does. Clients use these to decide what needs confirming.
 *
 * `destructiveHint` is true for every writing op rather than only `delete`,
 * because rescheduling twelve tasks is destructive in the sense clients care
 * about: it overwrites state the user did not hand over in this request.
 * `idempotentHint` is false throughout — `capture` creates a second task if you
 * call it twice, and `complete` sets `doneAt` afresh.
 */
export function toolsFromRegistry(): Tool[] {
  return exposed().map((op) => ({
    name: toolNameFor(op),
    description: op.details ? `${op.summary}. ${op.details}` : op.summary,
    inputSchema: schemaOf(op) as Tool["inputSchema"],
    annotations: {
      title: op.summary,
      readOnlyHint: !op.mutates,
      destructiveHint: op.mutates,
      idempotentHint: false,
      openWorldHint: true, // talks to Marvin's hosted API
    },
  }));
}

export async function callOp(
  name: string,
  args: unknown,
  ctx: Ctx
): Promise<CallToolResult> {
  // Filtered, not just unlisted: a client that guesses the name of a cliOnly op
  // must not be able to invoke it.
  const op = exposed().find((candidate) => toolNameFor(candidate) === name);
  if (!op) {
    return errorResult(`Unknown tool: ${name}`);
  }

  const parsed = op.input.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    return errorResult(`Invalid arguments for ${name}: ${issues}`);
  }

  try {
    const output = await op.run(parsed.data, ctx);
    // Text only, deliberately. Returning structuredContent alongside it does
    // not mean "both are available" — clients pick one and discard the other,
    // and they disagree about which.
    //
    // Claude Code 2.1.220 filters every text block out of the result when
    // structuredContent is present and hands the model JSON.stringify of it
    // instead (anthropics/claude-code#55677, #45575). VS Code does the same.
    // Claude Desktop and Cursor do the opposite: they read content and ignore
    // structuredContent entirely. So shipping both meant Claude Code users
    // never saw a single render() in this codebase, and paid 3.6x the tokens
    // for the privilege — a measured 2,504 against 695 for one search.
    //
    // The spec asks for the *serialized JSON* in the text block, not a separate
    // human rendering, and SEP-1624 requires the two payloads to be
    // semantically equivalent. Ours were not. Every render carries the full
    // task ids the model needs to act, so text alone is sufficient and is now
    // what every client gets.
    //
    // Do not add outputSchema: declaring one makes structuredContent mandatory
    // and turns its absence into a hard client-side error.
    return { content: [{ type: "text", text: op.render(output) }] };
  } catch (error) {
    if (error instanceof MarvinError) return errorResult(error.message);
    return errorResult(
      error instanceof Error ? error.message : String(error)
    );
  }
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Sent once at initialize and carried in the model's context thereafter, so it
 * is billed against every message. Everything here has to earn its tokens.
 *
 * The bar for inclusion: it must be something the model cannot infer from tool
 * schemas and would plausibly get wrong. The two date fields are the clearest
 * case — nothing in the schema says which one a human means by "do this
 * Tuesday", and picking the wrong one silently moves a deadline.
 *
 * The planning notes are here rather than in tool descriptions because they are
 * about restraint across a whole conversation, not about how to call one tool.
 */
export const SERVER_INSTRUCTIONS = `Amazing Marvin task management.

TWO DATE FIELDS, easily confused and costly to get wrong:
- scheduledFor: the day the user intends to work on it.
- dueBy: the actual deadline.
"Do it Tuesday" means scheduledFor. "It's due Tuesday" means dueBy. Setting
dueBy when scheduledFor was meant moves a real deadline; the reverse silently
reschedules work. If a request is genuinely ambiguous, ask rather than guess.

BATCH WRITES with marvin_apply instead of several single calls. It commits as
one change set, so marvin_undo reverts the whole plan rather than a twelfth of
it. Preview large change sets with dryRun first.

UNDO: marvin_undo reverts the last change set. It cannot restore a genuine
deletion, because Marvin issues a new id on recreate. Prefer completing or
rescheduling a task over deleting it.

COST: reads are cheap. marvin_find is a single database query and does not
count against Marvin's API budget, so search freely. Writes do count, against
1440 requests/day that Marvin enforces by restricting the account rather than
returning an error, so do not write in a loop. Use marvin_brief rather than
marvin_find for "what's on today"; it answers directly.

WHEN PLANNING:
- Do not silently reschedule everything. If the day is overcommitted, say so and
  propose what to drop or defer; let the user decide.
- marvin_brief reports total estimated minutes. Check it before adding more.
- A task with a dueBy and no scheduledFor is the one that quietly goes overdue.
  It is worth raising unprompted.
- Never invent tasks the user did not ask for, and do not mark work done that
  the user has not said is done.

Nine task fields are exposed. Habits, recurring tasks, subtasks, time tracking
and time blocks are deliberately not available; say so rather than approximating
them with ordinary tasks.`;

export function createMcpServer(ctxFactory: () => Ctx): McpServer {
  const mcp = new McpServer(
    { name: "marvin", version: "2.0.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsFromRegistry(),
  }));

  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callOp(request.params.name, request.params.arguments, ctxFactory())
  );

  return mcp;
}
