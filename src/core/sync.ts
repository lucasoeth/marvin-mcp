/**
 * Direct CouchDB (Cloudant) read access.
 *
 * Marvin's public API has no search endpoint and no bulk export, and
 * `/children` never returns completed tasks. Finding a task through it meant
 * crawling the container tree: ~22 requests against an API documented at 1 per
 * 3 seconds, which in practice returned partial results nondeterministically
 * and could not see completed work at all.
 *
 * The sync database Marvin exposes is a real CouchDB, so a Mango query does the
 * same job in one request. Measured on a 785-document account: all open tasks in
 * 878ms, a regex title search in 527ms.
 *
 * READ ONLY. Writes continue to go through the public API, which owns conflict
 * resolution and reward/kudos side effects that writing to the database directly
 * would bypass.
 *
 * Credentials come from Settings > API and are required. The crawl was the
 * fallback and has been removed; see the Repo constructor for why.
 * https://github.com/amazingmarvin/MarvinAPI/wiki/Database-Access
 */

import { MarvinError } from "./client.js";

export interface SyncConfig {
  server: string;
  database: string;
  user: string;
  password: string;
}

/** Returns null when any sync credential is missing. Callers treat that as fatal. */
export function syncConfigFrom(env: NodeJS.ProcessEnv): SyncConfig | null {
  const server = env.MARVIN_SYNC_SERVER;
  const database = env.MARVIN_SYNC_DATABASE;
  const user = env.MARVIN_SYNC_USER;
  const password = env.MARVIN_SYNC_PASSWORD;
  if (!server || !database || !user || !password) return null;
  return { server: server.replace(/\/$/, ""), database, user, password };
}

/** Which sync credentials are missing, for error messages. */
export function missingSyncKeys(env: NodeJS.ProcessEnv): string[] {
  return [
    "MARVIN_SYNC_SERVER",
    "MARVIN_SYNC_DATABASE",
    "MARVIN_SYNC_USER",
    "MARVIN_SYNC_PASSWORD",
  ].filter((key) => !env[key]);
}

export interface MangoQuery {
  selector: Record<string, unknown>;
  fields?: string[];
  limit?: number;
  skip?: number;
  bookmark?: string;
}

interface MangoResponse<T> {
  docs: T[];
  bookmark?: string;
  warning?: string;
}

export class SyncDb {
  private readonly base: string;
  private readonly auth: string;

  constructor(config: SyncConfig) {
    this.base = `${config.server}/${config.database}`;
    this.auth =
      "Basic " +
      Buffer.from(`${config.user}:${config.password}`).toString("base64");
  }

  /**
   * Mango query, paging through bookmarks so a large result is not silently
   * truncated at CouchDB's default page size.
   */
  async find<T>(query: MangoQuery): Promise<T[]> {
    return (await this.findWithMeta<T>(query)).docs;
  }

  /**
   * As `find`, but keeps CouchDB's `warning`.
   *
   * The warning is how "no matching index found, create an index to optimize
   * query time" reaches us. There is no index on `day` or `parentId`, so the
   * filtered queries behind `tasks` are full scans. That is fine at this size
   * and still one request against a rate limit that a tree crawl would spend
   * twenty-two on — but it should be visible rather than silently discarded,
   * because the day it stops being fine, the only symptom is slowness.
   */
  async findWithMeta<T>(
    query: MangoQuery
  ): Promise<{ docs: T[]; warning?: string }> {
    const pageSize = query.limit ?? 500;
    const out: T[] = [];
    let warning: string | undefined;
    let bookmark: string | undefined;

    // Bounded so a bookmark that stops advancing cannot spin forever.
    for (let page = 0; page < 20; page++) {
      const body: MangoQuery = { ...query, limit: pageSize, bookmark };
      const response = await this.request("/_find", body);
      const parsed = JSON.parse(response) as MangoResponse<T>;
      out.push(...parsed.docs);
      warning ??= parsed.warning;
      if (parsed.docs.length < pageSize || !parsed.bookmark) break;
      bookmark = parsed.bookmark;
    }
    return { docs: out, warning };
  }

  /** Cheap liveness probe, used to decide whether the fast path is usable. */
  async reachable(): Promise<boolean> {
    try {
      const response = await fetch(this.base, {
        headers: { Authorization: this.auth, Accept: "application/json" },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async request(path: string, body: unknown): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        method: "POST",
        headers: {
          Authorization: this.auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new MarvinError(
        `Could not reach the sync database: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        undefined,
        path
      );
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new MarvinError(
        response.status === 401
          ? "Sync database rejected the credentials. Re-copy MARVIN_SYNC_* from Settings > API."
          : `Sync database error (${response.status}): ${detail}`,
        response.status,
        path
      );
    }

    return response.text();
  }
}

/** Escapes a user string for safe use inside a Mango $regex. */
export function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
