/**
 * Wiring. The one place credentials are read and the object graph is built.
 */

import { MarvinClient } from "./client.js";
import { Journal } from "./journal.js";
import { Repo } from "./repo.js";
import type { Ctx } from "./ops/types.js";

export class ConfigError extends Error {}

export function loadCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  const apiToken = env.MARVIN_API_TOKEN;
  const fullAccessToken = env.MARVIN_FULL_ACCESS_TOKEN;

  if (!apiToken || !fullAccessToken) {
    const missing = [
      !apiToken && "MARVIN_API_TOKEN",
      !fullAccessToken && "MARVIN_FULL_ACCESS_TOKEN",
    ]
      .filter(Boolean)
      .join(" and ");
    throw new ConfigError(
      `Missing ${missing}.\n` +
        "Find both in Amazing Marvin under Settings > API, then export them or " +
        "put them in a .env file."
    );
  }

  const client = new MarvinClient({ apiToken, fullAccessToken });
  return {
    repo: new Repo(client),
    journal: new Journal(),
    now: () => new Date(),
  };
}
