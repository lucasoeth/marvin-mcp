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

export function toolsFromRegistry(): Tool[] {
  return ops.map((op) => ({
    name: toolNameFor(op),
    description: op.details ? `${op.summary}. ${op.details}` : op.summary,
    inputSchema: schemaOf(op) as Tool["inputSchema"],
  }));
}

export async function callOp(
  name: string,
  args: unknown,
  ctx: Ctx
): Promise<CallToolResult> {
  const op = ops.find((candidate) => toolNameFor(candidate) === name);
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
    return {
      content: [{ type: "text", text: op.render(output) }],
      structuredContent: output as Record<string, unknown>,
    };
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

export function createMcpServer(ctxFactory: () => Ctx): McpServer {
  const mcp = new McpServer(
    { name: "marvin", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsFromRegistry(),
  }));

  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callOp(request.params.name, request.params.arguments, ctxFactory())
  );

  return mcp;
}
