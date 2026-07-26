/**
 * Wiring. The one place credentials are read and the object graph is built.
 */

import { MarvinClient } from "./client.js";
import { configPath, resolveCredentials } from "./config.js";
import { Journal } from "./journal.js";
import { Repo } from "./repo.js";
import { SyncDb, syncConfigFrom } from "./sync.js";
import type { Ctx } from "./ops/types.js";

export class ConfigError extends Error {}

export function loadCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  // Environment first, then ~/.marvin/config.json, so the CLI works from any
  // directory without a .env next to it.
  const creds = resolveCredentials(env);
  const apiToken = creds.MARVIN_API_TOKEN;
  const fullAccessToken = creds.MARVIN_FULL_ACCESS_TOKEN;

  if (!apiToken || !fullAccessToken) {
    const missing = [
      !apiToken && "MARVIN_API_TOKEN",
      !fullAccessToken && "MARVIN_FULL_ACCESS_TOKEN",
    ]
      .filter(Boolean)
      .join(" and ");
    throw new ConfigError(
      `Missing ${missing}.\n\n` +
        "Find both in Amazing Marvin under Settings > API, then either export " +
        "them, or save them once with:\n\n" +
        "  marvin auth --api-token <token> --full-access-token <token>\n\n" +
        `Saved credentials live in ${configPath()}.`
    );
  }

  const client = new MarvinClient({ apiToken, fullAccessToken });
  const syncConfig = syncConfigFrom(creds);
  return {
    repo: new Repo(client, syncConfig ? new SyncDb(syncConfig) : null),
    journal: new Journal(),
    now: () => new Date(),
  };
}
