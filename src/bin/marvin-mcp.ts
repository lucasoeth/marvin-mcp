#!/usr/bin/env node
/**
 * Local MCP server over stdio, for Claude Desktop and anything else that speaks
 * MCP but has no shell. Shell-capable agents should prefer the `marvin` CLI.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../adapters/mcp.js";
import { ConfigError, loadCtx } from "../core/context.js";

async function main() {
  // Fail fast on missing credentials rather than on the first tool call.
  loadCtx();

  const server = createMcpServer(loadCtx);
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; anything human-readable must go to stderr.
  console.error("marvin MCP server ready on stdio");
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(78);
  }
  console.error("Failed to start:", error);
  process.exit(1);
});
