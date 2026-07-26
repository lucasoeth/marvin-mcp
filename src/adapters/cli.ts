/**
 * CLI adapter.
 *
 * Generates one command per op from the registry. Nothing op-specific lives
 * here: flags, help text and validation all come from the op's zod schema via
 * JSON Schema, which is the same representation the MCP adapter consumes. That
 * is what keeps the two surfaces identical by construction.
 */

import { Command, Option } from "commander";
import { z } from "zod";
import { ConfigError, loadCtx } from "../core/context.js";
import { MarvinError } from "../core/client.js";
import { ops } from "../core/ops/index.js";
import type { Ctx, Op } from "../core/ops/types.js";

interface JsonSchemaProp {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProp;
  anyOf?: JsonSchemaProp[];
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

/** `io: "input"` so defaulted fields are optional rather than required. */
export function schemaOf(op: Op<any, any>): JsonSchema {
  return z.toJSONSchema(op.input as z.ZodType, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchema;
}

/** anyOf shows up for nullable/optional unions; take the first concrete type. */
function effectiveType(prop: JsonSchemaProp): string {
  if (prop.type) return prop.type;
  const branch = prop.anyOf?.find((b) => b.type && b.type !== "null");
  return branch?.type ?? "string";
}

function flagName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

function coerce(raw: unknown, prop: JsonSchemaProp, key: string): unknown {
  const type = effectiveType(prop);
  if (raw === undefined) return undefined;
  if (type === "boolean") return raw;
  if (type === "integer" || type === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`--${flagName(key)} expects a number`);
    return n;
  }
  if (type === "array" || type === "object") {
    if (typeof raw !== "string") return raw;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`--${flagName(key)} expects JSON`);
    }
  }
  return raw;
}

function addOptions(command: Command, op: Op<any, any>) {
  const schema = schemaOf(op);
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const flag = flagName(key);
    const type = effectiveType(prop);
    const describe = prop.description ?? "";

    if (type === "boolean") {
      command.addOption(
        new Option(
          prop.default === true ? `--no-${flag}` : `--${flag}`,
          describe
        )
      );
      continue;
    }

    const hint = type === "array" || type === "object" ? "<json>" : "<value>";
    const option = new Option(`--${flag} ${hint}`, describe);
    if (prop.enum) option.choices(prop.enum);
    if (prop.default !== undefined) option.default(prop.default);
    command.addOption(option);
  }
}

/**
 * Defers building the context until an op actually reaches for it.
 *
 * `marvin auth` has to run when no credentials exist yet, and building the
 * context eagerly would fail before it got the chance. An op that touches
 * nothing on `Ctx` never triggers the load; every other op behaves as before,
 * including the ConfigError it raises when credentials are missing.
 */
function lazyCtx(factory: () => Ctx): Ctx {
  let built: Ctx | undefined;
  const get = () => (built ??= factory());
  return {
    get repo() {
      return get().repo;
    },
    now: () => get().now(),
  };
}

async function execute(
  op: Op<any, any>,
  raw: Record<string, unknown>,
  json: boolean,
  ctxFactory: () => Ctx
) {
  const schema = schemaOf(op);
  const input: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const value = coerce(raw[key], prop, key);
    if (value !== undefined) input[key] = value;
  }

  const parsed = op.input.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "input"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid arguments for "${op.name}":\n${issues}`);
  }

  const output = await op.run(parsed.data, lazyCtx(ctxFactory));
  process.stdout.write(
    (json ? JSON.stringify(output, null, 2) : op.render(output)) + "\n"
  );
}

export function buildProgram(ctxFactory: () => Ctx = loadCtx): Command {
  const program = new Command()
    .name("marvin")
    .description(
      "Amazing Marvin from the command line.\n" +
        "Running `marvin` with no arguments prints today's brief."
    )
    .option("--json", "Print raw JSON instead of formatted text")
    .enablePositionalOptions()
    .showHelpAfterError();

  for (const op of ops) {
    const command = program.command(op.name).description(op.summary);

    if (op.details) command.addHelpText("after", "\n" + op.details);

    // Also accept --json after the subcommand. `marvin find x --json` is what
    // both humans and agents reach for; requiring it before the verb is a trap.
    command.addOption(
      new Option("--json", "Print raw JSON instead of formatted text")
    );

    const schema = schemaOf(op);
    const positional = op.positional;
    if (positional) {
      // Optional here even when the schema requires it. The same key is also a
      // flag (below), so `marvin complete --task x` has to be accepted, and
      // commander would reject it for a missing `<task>`. zod still enforces
      // requiredness, with a better message than commander's.
      command.argument(
        `[${positional}]`,
        schema.properties?.[positional]?.description
      );
    }

    // The positional key gets a flag too. On an op like `tasks`, where every
    // other filter is a flag, having exactly one of them be positional-only is
    // a trap: `--query` looks obviously right, and commander answers "unknown
    // option" rather than pointing at the positional form.
    addOptions(command, op);

    command.action(async (...args: unknown[]) => {
      const opts = (
        positional ? args[1] : args[0]
      ) as Record<string, unknown>;
      const raw = { ...opts };
      if (positional && args[0] !== undefined) raw[positional] = args[0];
      const json = opts.json === true || program.opts().json === true;
      delete raw.json;
      await execute(op, raw, json, ctxFactory);
    });
  }

  // Bare `marvin` is the thing you type every morning, so make it the brief.
  program.action(async () => {
    const brief = ops.find((op) => op.name === "brief")!;
    await execute(brief, {}, program.opts().json === true, ctxFactory);
  });

  return program;
}

export async function runCli(
  argv: string[] = process.argv,
  ctxFactory: () => Ctx = loadCtx
): Promise<number> {
  try {
    await buildProgram(ctxFactory).parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 78; // EX_CONFIG
    }
    if (error instanceof MarvinError) {
      process.stderr.write(`${error.message}\n`);
      return 69; // EX_UNAVAILABLE
    }
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}
