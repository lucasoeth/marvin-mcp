/**
 * Build the .mcpb bundle: the double-click installer for Claude Desktop.
 *
 * The point of this file is that the bundle is genuinely self-contained.
 * Desktop ships its own Node runtime, so vendoring node_modules means a user
 * needs nothing installed at all — no Node, no npm, no Python, no uv. The
 * comparable Python bundles in this space declare `"type": "python"` with
 * `command: "uvx"`, which still requires uv on PATH and produces a steady
 * trickle of "uvx not found" issues. Being Node is the one structural advantage
 * available here, and it is only real if node_modules is inside the archive.
 *
 * The manifest is generated rather than checked in, for the same reason the CLI
 * and the MCP tools are generated from one registry: a hand-maintained copy of
 * the version and the tool list is a copy that goes stale.
 *
 *   node scripts/build-mcpb.mjs
 *
 * Output: build/marvin-<version>.mcpb
 */

import { execFileSync } from "child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "build", "mcpb");
const server = join(stage, "server");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });

console.log("building typescript...");
run("npm", ["run", "build"]);

console.log("staging...");
rmSync(join(root, "build"), { recursive: true, force: true });
mkdirSync(server, { recursive: true });

cpSync(join(root, "dist"), join(server, "dist"), { recursive: true });
cpSync(join(root, "README.md"), join(stage, "README.md"));
cpSync(join(root, "LICENSE"), join(stage, "LICENSE"));

// package.json travels with the server because mcp.ts reads its own version
// from it at runtime. `prepare` is stripped: it runs tsc, and there is no
// TypeScript in the bundle for it to run on.
const { prepare, ...scripts } = pkg.scripts;
writeFileSync(
  join(server, "package.json"),
  JSON.stringify({ ...pkg, scripts }, null, 2) + "\n"
);
cpSync(join(root, "package-lock.json"), join(server, "package-lock.json"));

console.log("vendoring production dependencies...");
run("npm", ["ci", "--omit=dev", "--ignore-scripts"], server);
rmSync(join(server, "package-lock.json"));

/**
 * Tool names come from the registry, so the manifest cannot advertise a tool
 * that does not exist or miss one that does. Desktop shows this list on the
 * install screen, before any credentials have been entered.
 */
const { toolsFromRegistry } = await import(
  join(server, "dist", "adapters", "mcp.js")
);
const tools = toolsFromRegistry().map((tool) => ({
  name: tool.name,
  description: tool.annotations?.title ?? tool.description,
}));

/**
 * Every credential is `required` and `sensitive`. Desktop renders these as a
 * form with masked inputs and stores the values in the OS keychain, which is
 * the entire reason a non-technical user can install this: no terminal, no
 * environment variables, no config file to find.
 *
 * All six come from one page. The descriptions say so on every field rather
 * than once, because the form does not show them together.
 */
const settings = "Amazing Marvin > Settings > API";
const credential = (title, description) => ({
  type: "string",
  title,
  description,
  required: true,
  sensitive: true,
});

const manifest = {
  manifest_version: "0.2",
  name: "marvin",
  display_name: "Amazing Marvin",
  version: pkg.version,
  description: pkg.description,
  long_description:
    "Read and write your Amazing Marvin tasks from Claude: what is on today, " +
    "what is overdue, capturing tasks, and planning or rescheduling a day. " +
    "Runs entirely on your own machine against your own Marvin account. " +
    "Nothing is uploaded anywhere, and every tool that writes is marked " +
    "destructive so Claude asks before it changes anything.",
  author: { name: pkg.author },
  repository: { type: "git", url: pkg.repository.url },
  homepage: pkg.homepage,
  documentation: pkg.homepage,
  support: pkg.bugs.url,
  license: pkg.license,
  keywords: pkg.keywords,
  server: {
    type: "node",
    entry_point: "server/dist/bin/marvin-mcp.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/dist/bin/marvin-mcp.js"],
      env: {
        MARVIN_API_TOKEN: "${user_config.api_token}",
        MARVIN_FULL_ACCESS_TOKEN: "${user_config.full_access_token}",
        MARVIN_SYNC_SERVER: "${user_config.sync_server}",
        MARVIN_SYNC_DATABASE: "${user_config.sync_database}",
        MARVIN_SYNC_USER: "${user_config.sync_user}",
        MARVIN_SYNC_PASSWORD: "${user_config.sync_password}",
      },
    },
  },
  tools,
  tools_generated: false,
  user_config: {
    api_token: credential("API token", `From ${settings}. Ends in "=".`),
    full_access_token: credential(
      "Full access token",
      `From ${settings}, just below the API token. Needed to change tasks, not only read them.`
    ),
    sync_server: credential(
      "Sync server",
      `From ${settings}, under Database Access. Starts with https://. Used to search your tasks, including completed ones, which Marvin's API cannot do.`
    ),
    sync_database: credential("Sync database", `From ${settings}, under Database Access.`),
    sync_user: credential("Sync user", `From ${settings}, under Database Access.`),
    sync_password: credential("Sync password", `From ${settings}, under Database Access.`),
  },
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: ">=20" },
  },
};

writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("packing...");
const out = join(root, "build", `marvin-${pkg.version}.mcpb`);
run("npx", ["--yes", "@anthropic-ai/mcpb", "pack", stage, out]);

const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`\n${out}  (${mb} MB, ${tools.length} tools)`);
