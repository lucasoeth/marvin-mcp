# Marvin Caching: Research and Design

**Date:** 2026-07-26
**Status:** Research complete, design proposed
**Method:** Live probing of `serv.amazingmarvin.com/api` against the user's real account, plus the full API wiki (cloned from `MarvinAPI.wiki.git`) and the MarvinAPI issue tracker.

All test documents were titled `ZZ cache probe *` and were deleted and verified gone
(`GET /api/doc?id=…` returns `{"error":"not_found","reason":"deleted"}` for all three,
and a sweep of `/categories` + `/children` for all 18 containers + `unassigned` +
`/todayItems` + `/dueItems` finds none remaining). No pre-existing document was read
destructively or modified.

---

## The headline finding

The interesting constraint is not staleness. It is the documented rate limit, which
neither the abandoned `CACHING_RESEARCH_AND_PLAN.md` nor the redesign spec mentions.

From the wiki `Home.md`, and repeated verbatim in `marvin-api.yaml`:

> Please do not use the API to create more than 1 item per second. Please do not use the
> API to burst than 1 query each 3 seconds, nor 1440 queries per day (1 per minute).
> Please do not create 1 item every second until your database is gigantic, etc. **Your
> API access or account may be restricted if you abuse the API.**
>
> These rate limits apply both to Marvin's public API **and to direct database access.**

**1440 queries per day. One query per three seconds.**

`Repo.allTasks()` costs 22 requests on this account (1 `/todayItems` + 1 `/dueItems` +
1 `/categories` + 18 `/children` + 1 `/children?parentId=unassigned`), and it issues the
18 container reads through `Promise.all`, i.e. simultaneously. That is a burst-limit
violation on every single call and consumes 1.5% of the daily budget. `find` is built on
it. Paced at the documented 1-per-3s it would take 66 seconds.

So the framing shifts. Caching here is not a latency optimisation — requests are ~300ms
and the account is tiny. Caching is **budget compliance**, and the design question is how
to spend a 1440/day allowance without ever letting a stale value reach a write decision.

---

## (a) Findings table

| # | Lead | Verdict | Evidence |
|---|---|---|---|
| 1a | `GET /api/doc` returns `_rev` | **CONFIRMED** | `GET /api/doc?id=1cf00c06-…` → `{"_id":"1cf00c06-…","_rev":"5-0503e17770de1ee08c4df7f8fb323bdb",…}`. Also documented in `Marvin-API.md:205`. |
| 1b | `POST /api/doc/update` validates `_rev` | **REFUTED** | Four forms tested against probe A at known-current `_rev` `2-859bf…`, all with the deliberately stale `_rev` `1-da99b…`: top-level `"_rev"` → **HTTP 200, applied**, doc advanced to `3-9c01b…`; body field `"rev"` → **200, applied**; header `If-Match: "1-da99b…"` → **200, applied**; `_rev` as a setter → **HTTP 500 "Internal server error"**. Final state `_rev 6-8ed2a…`, `note:"D"`. There is no optimistic concurrency control. |
| 1c | `_rev` is returned by write responses | **CONFIRMED (partial)** | `/doc/update` and `/doc/delete` responses include the *new* `_rev`. `/addTask` does **not** — its response has no `_rev`, no `updatedAt`, no `fieldUpdates`. Wiki `Marvin-API.md:30`: *"stable, but new document's `_id` and `_rev` will be included in the response in the future"*. |
| 1d | List endpoints return `_rev` | **CONFIRMED, unevenly** | `/dueItems` and `/children` items carry `_rev`. `/categories` returns a **stripped projection**: keys are exactly `['_id','color','icon','masterRank','parentId','title','type']` — no `_rev`, no `updatedAt`, no `fieldUpdates`. |
| 2 | Changes feed / sync endpoint / "since" param | **REFUTED for the public API** | `/api/{changes,_changes,sync,updates,docs,search,tasks,items}` all → **404**. `/children?parentId=unassigned` with `since=0`, `updatedSince=0`, `modifiedSince=0`, `after=0`, `since=2026-01-01` all returned the **identical 10626-byte** full body: unknown params are silently ignored. Nothing in the wiki or `marvin-api.yaml`. |
| 2b | CouchDB `_changes` via direct DB access | **UNVERIFIED — exists on paper, not testable here** | `Database-Access.md:1-5` and `Home.md:41` document `syncServer`, `syncDatabase`, `syncUser`, `syncPassword`, obtainable only from the authenticated settings page, and say *"use the couchdb API to get it done"* against a Cloudant instance. Those credentials are **not in `.env`** (which has only `MARVIN_API_TOKEN`, `MARVIN_FULL_ACCESS_TOKEN`, `API_KEY`, and server config), so I could not test `_changes`. See §(e). |
| 3 | Webhooks can drive invalidation | **CONFIRMED to exist, REFUTED as a fit** | `Webhooks.md` documents `add`/`edit`/`markDone`/`delete` (+ `…Task`/`…Project` variants), full document in the body, `edit` additionally carries a `setter` object. Three disqualifiers, all from primary sources: (i) *"Webhooks are sent as cross-origin AJAX requests **from the client**"* — they fire only while a Marvin app is open, and require the target to answer a CORS preflight with `Access-Control-Allow-Origin`; (ii) *"If you add/change tasks/projects using Marvin's API … **you are responsible for calling any applicable Webhooks**"* — API-originated writes fire nothing; (iii) delivery is unreliable in practice — open issue [#63](https://github.com/amazingmarvin/MarvinAPI/issues/63) reports *"no webhook requests … received at all"* for **hours daily**, still open. Also outbound-rate-limited to 1 per 3 seconds. Nothing is configured on this account: `GET /api/doc?id=strategySettings.webhooks` → `{"error":"not_found","reason":"missing"}`. |
| 4 | Conditional requests (ETag / Last-Modified / Cache-Control) | **REFUTED** | Full response headers from `/todayItems`, `/dueItems`, `/categories`, `/labels`, `/children`, `/me`, `/doc` are exactly: `content-type`, `vary: Accept-Encoding` (sometimes), `access-control-allow-*`, `x-cloud-trace-context`, `date`, `server: Google Frontend`, `content-length`. **No `etag`, no `last-modified`, no `cache-control`, no `age`.** Sending `If-None-Match: *` and `If-Modified-Since: <now>` to `/children` → **200 with the full 10626-byte body** both times, identical to the unconditional request. `If-None-Match: "6-8ed2a…"` (the doc's true current rev) to `/doc` → **200, 682 bytes**. |
| 5 | Cheap `max(updatedAt)` or "changed since" | **REFUTED, and worse than expected** | Three separate problems. (i) No endpoint exposes an aggregate, so any watermark requires the same 22-request crawl you were trying to avoid. (ii) `/categories` strips `updatedAt` entirely, so containers cannot participate. (iii) **The public API does not maintain `updatedAt` or `fieldUpdates` at all.** Probe C was created via `/doc/create` with `updatedAt: 1785072521136` and `fieldUpdates.title: 1785072521136`; a subsequent `/doc/update` setting `title` produced `_rev 2-968292…`, `title: "ZZ cache probe C renamed"` — and `updatedAt` **still `1785072521136`**, `fieldUpdates.title` **still `1785072521136`**. `markDone` behaves the same: probe A after `markDone` had `done:true`, `doneAt:1785072490295`, and `updatedAt`/`fieldUpdates` still absent. Only device-originated edits maintain these (the real `Health` category has `fieldUpdates` with 9 per-field timestamps). An `updatedAt` watermark would therefore be blind to every change this tool itself makes. |
| 6 | Rate limits | **CONFIRMED (documented), NOT server-enforced** | Documented at 1440/day and 1-per-3s (quoted above). Empirically: 40 concurrent `GET /labels` completed in **1.94s, all HTTP 200**, no `429`, and no rate-limit headers of any kind before or after. Enforcement is therefore by human review and account restriction, not by the server. This makes the limit *more* dangerous to ignore, not less — there is no backpressure signal to react to. |

### Incidental findings worth carrying forward

- **`markDone` mutates `day`.** Probe A had `day: "unassigned"` before `markDone` and
  `day: "2026-07-26"` after. So completing a task changes its `/todayItems` membership,
  which matters for invalidation.
- **Read-your-own-write is immediately consistent.** Probe B was created and appeared in
  `/children?parentId=unassigned` on the very next request, 311ms later, first attempt.
  No propagation delay to design around for our own writes.
- **Latency is uniform and unremarkable**: `/todayItems` 311ms, `/dueItems` 302ms,
  `/categories` 253ms, `/labels` 327ms, `/children` 298ms (3 samples each).
- **The desktop app has a local API server** (marvin-cli README; help article 5165191),
  which would sidestep cloud rate limits entirely and read the locally-synced replica.
  Marvin desktop *is* running on this machine (`Marvin 32706 … 127.0.0.1:64231 (LISTEN)`)
  but that listener returns `401 Invalid Authentication Credentials` on `/` and **404 on
  every `/api/*` path**, and `GET /api/doc?id=strategySettings.apiServer` →
  `not_found`. The feature exists and is not enabled. See §(e).

### A write-correctness bug this research surfaced

Not caching, but discovered by the same probe and directly about multi-writer safety.

Marvin resolves CouchDB conflicts **per field, by `fieldUpdates` timestamp**
(`Database-Access.md:70`): *"all of the conflicting documents are merged together with
the most recently changed field winning"*, and *"make sure you update `fieldUpdates` if
you use the direct database access"*. `Marvin-API.md:233` extends the same advice to the
public API: *"It is recommended that you update `fieldUpdates.FIELD` in order to get
functioning conflict resolution and `updatedAt` for correct display within Marvin."*

`Repo.updateRaw` (`src/core/repo.ts:143`) sends only the domain setters. Probe C proves
the server does not fill these in. Consequence: every write this tool makes carries a
**stale-or-absent** `fieldUpdates` timestamp for the fields it changed. If the user edits
the same field on their phone, the phone's edit wins the merge **regardless of who wrote
last in wall-clock time** — and if `fieldUpdates.day` is absent entirely, our write is
maximally weak. The agent's change can silently vanish.

Fix, independent of any caching work — in `updateRaw`, expand each setter:

```ts
async updateRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  const setters = Object.entries(fields).flatMap(([key, val]) => [
    { key, val },
    { key: `fieldUpdates.${key}`, val: now },
  ]);
  if (setters.length === 0) return;
  setters.push({ key: "updatedAt", val: now });
  await this.client.post("/doc/update", { itemId: id, setters }, { fullAccess: true });
}
```

This is exactly the shape the wiki's own `/doc/update` example uses
(`Marvin-API.md:242-247`). It costs nothing and it is the only lever this codebase has
over multi-writer conflict resolution. `markDone` goes through `/markDone`, which we do
not control, so it keeps its current behaviour.

---

## (b) Recommended caching design

Three tiers, one hard rule each. The rule matters more than the TTL.

### Tier 0 — Never cached, ever

**Any read whose result the agent will select from and then write to.**

- `/todayItems`, `/dueItems`, `/children?parentId=unassigned` when serving `brief`,
  `find`, `complete`, or `apply`.
- `getRaw` / `getTask` when capturing a journal before-image.
- `getRaw` / `getTask` on any document that is about to be written.

These are the reads where a stale value produces a wrong write: completing a task the
user already completed, rescheduling a task the user already moved, reporting "you have
nothing today" when three things were added from the phone.

Cost: `brief` = 3 requests. `complete` = 1 verify read + 1 write. That is affordable
inside 1440/day and it is not negotiable.

### Tier 1 — Request-scoped memoisation (the free win)

Within a single CLI process or a single MCP tool call, memoise identical `GET`s by
`endpoint + params`. Lifetime = the invocation, typically under a second.

**This adds exactly zero staleness** — the values cannot become more stale than the
invocation that requested them, and the alternative is to fetch the identical bytes
twice inside the same 500ms window. It is pure deduplication.

This is where most of the current waste is. `allTasks()` already fetches `/todayItems`,
`/dueItems` and `/categories`, and callers that then also call `today()` or
`containers()` re-fetch them. Under memoisation, a `find` drops from 22+3 to 22.

- **Cache:** in-memory, per process.
- **Invalidate on:** any `POST` in the same process clears the whole memo table. Coarse,
  correct, and free.

### Tier 2 — Cross-invocation structural cache

Only `/categories` and `/labels`. Two endpoints, 18 + 0 rows on this account.

- **Cache for:** 10 minutes, on disk at `~/.marvin/cache.json`.
- **Use for:** rendering `id → name` and nothing else.
- **Invalidate on:** any write that creates or modifies a container or label; any
  `--no-cache`; any name lookup that misses (below).

The hard rule that makes this safe:

> **A name → id lookup that misses in the cache must revalidate before it may return
> "not found".**

Absence is never served from cache. If `capture "x #Errands"` cannot find `Errands`, the
cache is dropped and `/categories` is re-fetched once before concluding it does not
exist. Misses are rare (they happen only when the user just created a container), so the
extra request costs nothing on average, and it eliminates the single realistic failure
mode: a project created on the phone five minutes ago being treated as nonexistent and
the task landing in the inbox instead.

Renames are harmless — the `_id` is stable, so a task filed under a cached name still
lands in the right container and merely displays an old label for up to 10 minutes.
Deletion of a cached container makes the write fail loudly (404), which is the correct
outcome.

### Tier 3 — The long-tail task index (replaces the `allTasks` crawl)

`find` is the only op that needs to see tasks outside today/due/inbox, and the crawl that
serves it is the budget problem. Do not cache the crawl's *result* as a substitute for
live reads. Instead:

- Maintain `~/.marvin/index.json`: `{id, title, parentId, day, dueDate, done}` for every
  task, refreshed by **one paced crawl at most once per hour**, and paced at 1 request
  per 3 seconds (22 requests ≈ 66 seconds, run in the background or on explicit
  `marvin refresh`).
- The index is **allowed to be stale and allowed to have false negatives.**
- Every `find` therefore does: live `/todayItems` + live `/dueItems` + live
  `/children?parentId=unassigned` (3 requests, covering the three places new tasks
  actually land), unioned with index matches for the long tail.
- **Any index hit that the user or agent then acts on is re-read live via
  `/doc?id=` before it is displayed as authoritative or written to.** One request,
  and it collapses the staleness window on the acted-upon document to zero.

`find` cost drops from 22 to 3 requests plus one verify per acted-upon result, and the
hourly crawl amortises to ~22 requests/hour worst case if actually triggered hourly.

### Explicitly rejected

- **TTL-caching `/todayItems` and `/dueItems`**, which is what
  `CACHING_RESEARCH_AND_PLAN.md` proposes (§2 "Date-Scoped Data (High Priority)"). Any
  TTL > 0 on these means `brief` can report a day that does not exist and `apply` can
  write against it. The saving is at most a few requests per day. Not worth one wrong
  write.
- **Caching `/doc` reads across invocations.** These exist almost exclusively to
  serve writes.
- **`_rev` as a cheap change detector.** Getting the current `_rev` requires a
  `GET /doc`, which returns the whole document anyway. No saving.

---

## (c) The multi-writer problem, concretely

**Scenario: the user adds a task on their phone thirty seconds ago, then the agent runs
`brief`.**

Under this design, `brief` issues three live requests: `/todayItems`, `/dueItems`,
`/children?parentId=unassigned`. Nothing in `brief`'s path reads a cross-invocation
cache. The new task appears if — and only if — it has reached Marvin's cloud database.

**Staleness window contributed by the cache: zero.** Not "small". Zero. `brief` sees
precisely what a fresh, cache-free client would see at that instant.

The residual window is Marvin's own device → cloud sync latency, and it is worth being
precise about why that is not ours to fix. Marvin is a PouchDB/CouchDB multi-master
system (`Database-Access.md:35`: *"couchdb is a many-master system"*, *"It allows Marvin
to work offline"*). A change on the phone exists only on the phone until the phone syncs.
Until then it is invisible to the public API, to the desktop app, and to every other
device the user owns. No caching strategy on our side can surface data that has not left
the originating device. I could not measure this latency empirically — it needs the
user's phone — but it is typically seconds when the app is foregrounded and unbounded
when it is offline.

The honest statement is therefore: **our added staleness on task data is 0ms; the floor
is Marvin's sync latency, which is a platform property and which the desktop app is
subject to as well.**

For the container tree the answer is different and bounded. A project created on the
phone 30 seconds ago may be absent from a Tier-2 cache for up to 10 minutes — but the
miss-revalidate rule converts that from a wrong write into one extra request. The only
observable effect of Tier-2 staleness is a container *rename* displaying the old name for
up to 10 minutes, which cannot cause a wrong write because the `_id` is unchanged.

For the Tier-3 index the window is up to one hour, and it is neutralised structurally:
the index is only consulted for tasks *outside* today/due/inbox, it is unioned with live
reads of those three, and every result acted upon is re-read live first. Its failure mode
is a false negative on an old, unscheduled, uncategorised task — the agent says "I don't
see it" rather than writing to the wrong thing.

**The genuinely dangerous concurrent-write case is not a cache problem at all.** It is
the `fieldUpdates` bug in §(a): the user edits the task on their phone while the agent
writes to the same field, and Marvin's per-field merge silently discards the agent's
write because our `fieldUpdates` timestamp is stale or absent. Since `/doc/update`
ignores `_rev` (empirically proven above), there is no compare-and-swap available and
maintaining `fieldUpdates` is the only defence.

---

## (d) Implementation sketch

The cache does **not** go inside `MarvinClient`. A transport-level cache cannot tell a
"read to render" from a "read to write against", and that distinction is the entire
correctness argument. It goes in `Repo`, where the semantics live.

New file `src/core/cache.ts`:

```ts
/** A cache that knows nothing about Marvin. Two implementations, one interface. */
export interface Cache {
  /** Returns undefined on miss or when the entry is older than maxAgeMs. */
  get<T>(key: string, maxAgeMs: number): T | undefined;
  set(key: string, value: unknown): void;
  /** Drop everything, or everything under a key prefix. */
  clear(prefix?: string): void;
}

/** Lives for one process. Zero added staleness. Always on. */
export class MemoCache implements Cache { … }

/** ~/.marvin/cache.json. Structural data only. Off under MARVIN_NO_CACHE=1. */
export class DiskCache implements Cache { … }

/** Every get() misses, every set() is a no-op. Used by --no-cache. */
export const NO_CACHE: Cache = { … };
```

`Repo` gains one constructor parameter and three private read helpers, so that each call
site declares its freshness requirement in one word and cannot forget:

```ts
export class Repo {
  constructor(
    private readonly client: MarvinClient,
    private readonly memo: Cache = new MemoCache(),
    private readonly disk: Cache = new DiskCache()
  ) {}

  /** Tier 0/1. Network every invocation; deduplicated within one invocation only. */
  private async live<T>(endpoint: string, params = {}, opts = {}): Promise<T> {
    const key = cacheKey(endpoint, params);
    const hit = this.memo.get<T>(key, Infinity);
    if (hit !== undefined) return hit;
    const value = await this.client.get<T>(endpoint, params, opts);
    this.memo.set(key, value);
    return value;
  }

  /** Tier 2. Survives across invocations. Only for id -> name rendering. */
  private async structural<T>(endpoint: string): Promise<T> {
    const key = cacheKey(endpoint, {});
    const hit = this.disk.get<T>(key, TEN_MINUTES) ?? this.memo.get<T>(key, Infinity);
    if (hit !== undefined) return hit;
    const value = await this.client.get<T>(endpoint);
    this.memo.set(key, value);
    this.disk.set(key, value);
    return value;
  }

  /** Every mutating path funnels through here. */
  private invalidateAll(): void {
    this.memo.clear();
    this.disk.clear();
  }
}
```

Call sites change by one word each, and the diff reads as the policy:

```ts
async today()  { return this.live<Raw[]>("/todayItems"); }          // never cached
async due()    { return this.live<Raw[]>("/dueItems"); }            // never cached
async children(parentId: string) { return this.live<Raw[]>("/children", { parentId }); }
async getRaw(id: string) { return this.live<Raw>("/doc", { id }, { fullAccess: true }); }

async containers() { return (await this.structural<Raw[]>("/categories")).map(toContainer); }
async labels()     { return (await this.structural<Raw[]>("/labels")).map(toLabel); }
```

The miss-revalidate rule becomes a method, so no caller can bypass it:

```ts
/**
 * Resolve a container by name. Never concludes "not found" from cache: a miss
 * drops the structural cache and retries once against the network, because the
 * one thing a stale container list gets wrong is a project the user just created
 * on another device.
 */
async resolveContainer(name: string): Promise<Container | null> {
  const match = byName(await this.containers(), name);
  if (match) return match;
  this.disk.clear("/categories");
  this.memo.clear("/categories");
  return byName(await this.containers(), name) ?? null;
}
```

Every write method calls `this.invalidateAll()` after a successful `POST` —
`createTask`, `markDone` (which also mutates `day`, so it must invalidate `/todayItems`
too), `updateRaw`, `deleteDoc`.

**Bypass**, three ways, all of which resolve to constructing `Repo` with `NO_CACHE` for
the disk tier (`MemoCache` is always safe and always on):

1. `--no-cache` CLI flag, exposed on every command.
2. `MARVIN_NO_CACHE=1` in the environment.
3. Automatically whenever the disk cache file is unreadable, corrupt, or written by a
   different schema version — degrade to correct-and-slow, never to fast-and-wrong.

**Also change, unrelated to the cache but required by the budget:** replace the
`Promise.all` fan-out in `allTasks()` (`src/core/repo.ts:98` and `:110`) with a paced
sequential crawl at 1 request per 3 seconds, and move it behind the Tier-3 index rather
than letting `find` trigger it inline.

**Testability.** `Cache` is a three-method interface with no I/O in the memo
implementation, so the whole policy is unit-testable against a fake client: assert that
`today()` hits the network on every invocation, that `containers()` does not, that a
failed `resolveContainer` issues exactly two `/categories` requests, and that a write
followed by a read hits the network.

---

## (e) What I could not verify

Stated plainly, without guessing.

1. **The CouchDB `_changes` feed.** This is the one design that would give real
   push-based invalidation, and I could not test it. The credentials
   (`syncServer`, `syncDatabase`, `syncUser`, `syncPassword`) are documented at
   `Home.md:41` and `Database-Access.md:1` but are obtainable only from the authenticated
   settings page at `app.amazingmarvin.com/pre?api`, and they are not in `.env`. I
   therefore do not know: whether the credentials grant `_changes` access at all, whether
   Cloudant's `since`/`filter`/`continuous` parameters work against Marvin's database,
   what the document volume looks like, or how the rate limit applies. The wiki says the
   1440/day limit *"appl[ies] both to Marvin's public API and to direct database
   access"*, which cuts both ways: a single long-lived `_changes?feed=continuous`
   connection is arguably one query and would be the best possible answer, or it is
   arguably abuse. **The docs do not say and I could not test it.** If you want this
   answered, grab those four values from the settings page and it is a 20-minute follow-up.

2. **Whether the documented rate limits are actually enforced, and at what threshold.**
   40 concurrent requests in 1.94s all returned 200 with no `429` and no rate-limit
   headers. So the published numbers are not the enforcement point. I deliberately did
   not probe for the real threshold, because the documented penalty is account
   restriction on the user's real account. The design above respects the *documented*
   limit on the assumption that it is what a human reviewer would measure against.

3. **Marvin's device → cloud sync latency.** This is the dominant term in the
   multi-writer window in §(c) and I have no way to measure it without the user's phone.
   I can only establish that it exists and that no client-side design can shrink it.

4. **Whether webhooks would work well enough in practice.** I did not configure one —
   that would have meant modifying the user's `profile.strategySettings`, which the
   instructions forbid, and it needs a publicly reachable CORS-answering HTTPS endpoint.
   The design rejection in §(a) rests on the documented architecture plus open issue #63,
   not on a delivery test.

5. **The desktop local API server.** It exists (marvin-cli README; Marvin ≥ 1.60.0), and
   would be strictly better than everything above: a local, always-fresh, rate-limit-free
   read of the synced replica. It is not enabled on this account. Enabling it requires a
   checkbox in the desktop API strategy settings, which is a user action, and I have not
   tested what subset of endpoints it serves or how it authenticates. The listener I
   found on `127.0.0.1:64231` is some other Marvin service — `401` on `/`, `404` on all
   `/api/*` paths. **This is the highest-value unexplored lead and I recommend it be
   tried before the Tier-3 index is built**, because if it serves `/children` it makes
   the crawl free and the index unnecessary.

6. **`/categories` projection stability.** I observed that `/categories` strips `_rev`,
   `updatedAt` and `fieldUpdates` while `/children` and `/dueItems` do not. This is
   undocumented. I do not know whether it is deliberate or incidental, so the design does
   not depend on it beyond noting that a container watermark is unavailable.

---

## Verdict

Caching is worth it here, but not for the reason the abandoned plan assumed, and not in
the shape it proposed.

Latency is 300ms and the account has 19 tasks — nobody needs a faster `brief`. What the
account needs is to stop spending 22 requests per `find` against a documented 1440/day
budget while fanning out 18 simultaneous requests against a documented 1-per-3-seconds
burst limit.

So: memoise within an invocation (free, zero staleness), cache the 18-row container tree
for ten minutes behind a mandatory miss-revalidation (bounded, cannot cause a wrong
write), replace the crawl with a paced hourly index that is only ever used to *narrow*
candidates and never to *decide* (false negatives only), and read live for everything a
write depends on.

And fix `fieldUpdates` in `updateRaw`. Of everything in this document, that is the change
most likely to prevent an actual lost write.
