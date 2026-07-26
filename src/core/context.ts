/**
 * Wiring. The one place credentials are read and the object graph is built.
 */

import { MarvinClient } from "./client.js";
import { configPath, resolveCredentials } from "./config.js";
import { Journal } from "./journal.js";
import { Repo } from "./repo.js";
import { SyncDb, missingSyncKeys, syncConfigFrom } from "./sync.js";
import type { Ctx } from "./ops/types.js";

export class ConfigError extends Error {}

export function loadCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  // Environment first, then ~/.marvin/config.json, so the CLI works from any
  // directory without a .env next to it.
  const creds = resolveCredentials(env);
  const apiToken = creds.MARVIN_API_TOKEN;
  const fullAccessToken = creds.MARVIN_FULL_ACCESS_TOKEN;

  const missing = [
    !apiToken && "MARVIN_API_TOKEN",
    !fullAccessToken && "MARVIN_FULL_ACCESS_TOKEN",
    ...missingSyncKeys(creds),
  ].filter(Boolean) as string[];

  if (missing.length) {
    throw new ConfigError(
      `Missing ${missing.length === 1 ? "credential" : "credentials"}:\n` +
        missing.map((key) => `  ${key}`).join("\n") +
        "\n\nAll six are on one page in Amazing Marvin: Settings > API\n" +
        "(https://app.amazingmarvin.com/pre?api). The two tokens are at the " +
        "top; the sync values are further down.\n\n" +
        "Save them once with `marvin auth` — run `marvin auth --help` for the " +
        `flags. Saved credentials live in ${configPath()}.`
    );
  }

  const syncConfig = syncConfigFrom(creds)!;
  const client = new MarvinClient({
    apiToken: apiToken!,
    fullAccessToken: fullAccessToken!,
  });
  return {
    repo: new Repo(client, new SyncDb(syncConfig)),
    journal: new Journal(),
    now: () => new Date(),
  };
}
