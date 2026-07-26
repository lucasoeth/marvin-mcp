/**
 * Where credentials live when they are not in the environment.
 *
 * The CLI is meant to be run from anywhere, so it cannot depend on a `.env`
 * sitting in the current directory. Anything absent from the environment is
 * read from `$MARVIN_HOME/config.json` (default `~/.marvin/config.json`), which
 * is written once and then forgotten about.
 *
 * The environment still wins, so a shell export or a CI secret overrides the
 * file without editing it.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

/** Every credential the app understands. All optional; sync is a fast path. */
export const CREDENTIAL_KEYS = [
  "MARVIN_API_TOKEN",
  "MARVIN_FULL_ACCESS_TOKEN",
  "MARVIN_SYNC_SERVER",
  "MARVIN_SYNC_DATABASE",
  "MARVIN_SYNC_USER",
  "MARVIN_SYNC_PASSWORD",
] as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

export function marvinHome(): string {
  return process.env.MARVIN_HOME ?? join(homedir(), ".marvin");
}

export function configPath(): string {
  return join(marvinHome(), "config.json");
}

/**
 * Environment overlaid on the config file.
 *
 * A missing or unreadable config file is not an error — running purely from the
 * environment is a supported setup, and that is how the remote server is
 * deployed. Malformed JSON is the one case worth complaining about, since
 * silently ignoring it would present as "credentials missing" and send you
 * looking in the wrong place.
 */
export function resolveCredentials(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  const stored = readConfig();
  const merged: Record<string, string | undefined> = {};
  for (const key of CREDENTIAL_KEYS) {
    merged[key] = env[key] ?? stored[key];
  }
  return merged;
}

export function readConfig(): Record<string, string | undefined> {
  let text: string;
  try {
    text = readFileSync(configPath(), "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${configPath()} is not valid JSON. Fix or delete it, or run ` +
        `\`marvin auth\` to rewrite it.`
    );
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const out: Record<string, string | undefined> = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Merge values into the config file, 0600.
 *
 * Read-modify-write so setting sync credentials later does not drop the API
 * tokens. The mode is set explicitly rather than trusted to the umask, because
 * these are bearer tokens for a live account.
 */
export function writeConfig(values: Record<string, string>): string {
  const path = configPath();
  const merged = { ...readConfigUnchecked(), ...values };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600); // writeFileSync leaves an existing file's mode alone
  return path;
}

/** Like readConfig but tolerates malformed JSON, so a rewrite can repair it. */
function readConfigUnchecked(): Record<string, string | undefined> {
  try {
    return readConfig();
  } catch {
    return {};
  }
}
