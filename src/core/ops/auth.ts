/**
 * Save credentials once, so the CLI works from any directory.
 *
 * Without this the only way to supply tokens is the environment, which means
 * either exporting them in every shell or keeping a `.env` beside you and only
 * ever running the tool from that one directory. Neither survives contact with
 * "type `marvin` in the morning".
 *
 * This op never contacts Marvin, so it is the one op that must run before
 * credentials exist. It touches no field of `Ctx`, which is what lets the CLI
 * construct the context lazily and dispatch here with nothing configured.
 */

import { z } from "zod";
import { CREDENTIAL_KEYS, configPath, readConfig, writeConfig } from "../config.js";
import { defineOp } from "./types.js";

const input = z.object({
  apiToken: z.string().min(1).optional().describe("MARVIN_API_TOKEN"),
  fullAccessToken: z
    .string()
    .min(1)
    .optional()
    .describe("MARVIN_FULL_ACCESS_TOKEN"),
  syncServer: z.string().min(1).optional().describe("MARVIN_SYNC_SERVER"),
  syncDatabase: z.string().min(1).optional().describe("MARVIN_SYNC_DATABASE"),
  syncUser: z.string().min(1).optional().describe("MARVIN_SYNC_USER"),
  syncPassword: z.string().min(1).optional().describe("MARVIN_SYNC_PASSWORD"),
});

/** Input key -> the environment variable it stands in for. */
const FIELDS = {
  apiToken: "MARVIN_API_TOKEN",
  fullAccessToken: "MARVIN_FULL_ACCESS_TOKEN",
  syncServer: "MARVIN_SYNC_SERVER",
  syncDatabase: "MARVIN_SYNC_DATABASE",
  syncUser: "MARVIN_SYNC_USER",
  syncPassword: "MARVIN_SYNC_PASSWORD",
} as const;

export const auth = defineOp({
  name: "auth",
  summary: "Save Marvin credentials to ~/.marvin/config.json",
  details:
    "Find the tokens in Amazing Marvin under Settings > API. Values given here " +
    "are merged into any already saved, so sync credentials can be added later " +
    "without repeating the tokens. Environment variables still take precedence " +
    "over the file. With no arguments, reports what is currently configured.",
  input,
  mutates: false, // Touches local config, not Marvin. Nothing for `undo` to revert.
  cliOnly: true,
  async run(args) {
    const values: Record<string, string> = {};
    for (const [key, envName] of Object.entries(FIELDS)) {
      const value = args[key as keyof typeof FIELDS];
      if (value !== undefined) values[envName] = value;
    }

    const path = Object.keys(values).length ? writeConfig(values) : configPath();
    const saved = readConfig();

    return {
      path,
      wrote: Object.keys(values).length > 0,
      // Never echo the secrets back, not even truncated. This output goes to a
      // terminal that may be shared, logged or screen-shared.
      configured: CREDENTIAL_KEYS.filter((key) => saved[key] !== undefined),
      // The environment wins, so a stale file can look authoritative and not be.
      overriddenByEnv: CREDENTIAL_KEYS.filter(
        (key) => process.env[key] !== undefined
      ),
    };
  },
  render({ path, wrote, configured, overriddenByEnv }) {
    const lines = [wrote ? `saved to ${path}` : `${path}`];

    if (configured.length === 0) {
      lines.push("  nothing configured");
    } else {
      lines.push(...configured.map((key) => `  ${key}`));
    }

    const missing = ["MARVIN_API_TOKEN", "MARVIN_FULL_ACCESS_TOKEN"].filter(
      (key) => !configured.includes(key as never)
    );
    if (missing.length) {
      lines.push("", `required and still missing: ${missing.join(", ")}`);
    }
    if (!configured.includes("MARVIN_SYNC_SERVER")) {
      lines.push(
        "",
        "no sync credentials: search will crawl the API instead of querying",
        "the database, which is slower and cannot see completed tasks"
      );
    }
    if (overriddenByEnv.length) {
      lines.push(
        "",
        `set in the environment, which wins over this file: ${overriddenByEnv.join(", ")}`
      );
    }

    return lines.join("\n");
  },
});
