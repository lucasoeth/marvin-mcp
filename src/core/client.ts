/**
 * Low-level HTTP client for the Amazing Marvin API.
 *
 * Knows about transport, auth and errors. Knows nothing about the domain model.
 * https://github.com/amazingmarvin/MarvinAPI/wiki/Marvin-API
 */

const API_BASE = "https://serv.amazingmarvin.com/api";

export class MarvinError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly endpoint?: string
  ) {
    super(message);
    this.name = "MarvinError";
  }
}

/**
 * Timezone offset in the sign convention Marvin expects.
 *
 * The API documents this as "Time offset in minutes. Added to time to fix time
 * zone issues. So if the user is in Pacific time, this would be -8*60" — i.e.
 * negative west of UTC. JavaScript's getTimezoneOffset() is the inverse, so
 * Pacific yields +480 where the API wants -480.
 */
export function marvinTimeZoneOffset(): number {
  return -new Date().getTimezoneOffset();
}

export interface MarvinClientOptions {
  apiToken: string;
  fullAccessToken: string;
  baseUrl?: string;
}

export class MarvinClient {
  private readonly apiToken: string;
  private readonly fullAccessToken: string;
  private readonly baseUrl: string;

  constructor(opts: MarvinClientOptions) {
    this.apiToken = opts.apiToken;
    this.fullAccessToken = opts.fullAccessToken;
    this.baseUrl = opts.baseUrl ?? API_BASE;
  }

  async get<T>(
    endpoint: string,
    params: Record<string, string | undefined> = {},
    opts: { fullAccess?: boolean } = {}
  ): Promise<T> {
    const query = Object.entries(params)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    return this.request<T>(endpoint + (query ? `?${query}` : ""), {
      method: "GET",
      fullAccess: opts.fullAccess,
    });
  }

  async post<T>(
    endpoint: string,
    body: unknown,
    opts: { fullAccess?: boolean } = {}
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body,
      fullAccess: opts.fullAccess,
    });
  }

  private async request<T>(
    endpoint: string,
    opts: { method: "GET" | "POST"; body?: unknown; fullAccess?: boolean }
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.fullAccess) {
      headers["X-Full-Access-Token"] = this.fullAccessToken;
    } else {
      headers["X-API-Token"] = this.apiToken;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: opts.method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (cause) {
      throw new MarvinError(
        `Could not reach Marvin: ${cause instanceof Error ? cause.message : String(cause)}`,
        undefined,
        endpoint
      );
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new MarvinError(
        describeStatus(response.status, detail),
        response.status,
        endpoint
      );
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }
}

function describeStatus(status: number, detail: string): string {
  const suffix = detail ? `: ${detail}` : "";
  if (status === 401 || status === 403) {
    return `Marvin rejected the credentials (${status}). Check MARVIN_API_TOKEN and MARVIN_FULL_ACCESS_TOKEN${suffix}`;
  }
  if (status === 404) return `Marvin returned 404${suffix}`;
  if (status === 429) return `Marvin rate-limited the request (429)${suffix}`;
  if (status >= 500) return `Marvin server error (${status})${suffix}`;
  return `Marvin API error (${status})${suffix}`;
}
