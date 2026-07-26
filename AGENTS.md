# AGENTS.md

Personal task management for Amazing Marvin, as a CLI and an MCP server. Single
user. The CLI is the primary surface; the MCP server exists for clients with no
shell.

## Install

```bash
npm install -g .        # from a clone
marvin auth --api-token <t> --full-access-token <t>
```

Credentials resolve from the environment first, then
`~/.marvin/config.json` (`$MARVIN_HOME` overrides the directory). The file is
written 0600 and merged on each `auth` call, so sync credentials can be added
later without repeating the tokens. Not published to npm: it is one person's
account-shaped tool, and `files` plus `private: true` say so.

## Using it

If you have shell access, use the CLI. It is the same surface as the MCP tools.

```bash
marvin                          # today's brief — start here
marvin capture "call dentist +tomorrow #Health"
marvin complete "dentist"       # id or title fragment
marvin find "invoice"
marvin hierarchy                # projects and categories, with ids
marvin apply --changes '[...]'  # batch write
marvin undo                     # revert the last change set
```

Every command takes `--json` for machine-readable output. Use it when you need
ids or need to pipe into `jq`.

### The two date fields are not interchangeable

- `scheduledFor` — the day I intend to work on it (Marvin's `day`)
- `dueBy` — the deadline (Marvin's `dueDate`)

Setting `dueBy` when you meant `scheduledFor` moves a deadline. Setting
`scheduledFor` when you meant `dueBy` silently reschedules work. They were
deliberately renamed from Marvin's own names to make the distinction hard to
miss. A task with a `dueBy` and no `scheduledFor` is the thing that quietly goes
overdue — `brief` calls those out separately.

### Writing

Write authority is full: no confirmation prompts. The safety net is that every
mutating op journals the before-state to `~/.marvin/journal.jsonl`, and
`marvin undo` reverts the last change set.

Prefer `apply` over a sequence of individual writes. It commits one atomic change
set, so `undo` reverts the whole plan rather than one twelfth of it. Use
`--dry-run` first when the change set is large.

`undo` deletes items that were created, and restores fields that were changed. It
cannot restore a genuine deletion — Marvin reissues ids on recreate.

## Working on the code

```bash
npm run build      # tsc
npm test           # vitest
npm run typecheck
```

### Architecture

```
src/core/
  client.ts    HTTP, auth, error mapping. Knows nothing about the domain.
  model.ts     raw Marvin <-> domain mappers. The only file that knows the wire shape.
  repo.ts      domain-level reads and writes.
  journal.ts   write-ahead log and undo.
  ops/         the registry — one file per op.
src/adapters/
  cli.ts       registry -> commander commands
  mcp.ts       registry -> MCP tools
src/bin/       entrypoints
```

**Adding a capability means adding an op.** Write `src/core/ops/<name>.ts` using
`defineOp`, register it in `src/core/ops/index.ts`, and you get a CLI command and
an MCP tool simultaneously, sharing one schema, one description and one renderer.
Do not add a command or a tool by hand — the whole point of the registry is that
the two surfaces cannot drift.

An op declares:

| Field | Purpose |
|---|---|
| `name` | `brief` becomes `marvin brief` and tool `marvin_brief` |
| `summary` | `--help` text and the MCP tool description, one source |
| `input` | zod schema; validates CLI flags and MCP arguments alike |
| `mutates` | `true` means it must journal before-state for undo |
| `positional` | which input key may be given positionally on the CLI |
| `run` | the work |
| `render` | human output; `--json` bypasses it |
| `cliOnly` | omit from MCP. Only for ops that configure the client, never for capabilities |

`auth` is the only `cliOnly` op. The remote MCP server is reachable over the
network, so a tool that writes credentials to its disk is a footgun. It is
filtered from `callOp` as well as from the tool list, so guessing the name does
not work.

`marvin auth` has to run before credentials exist, so the CLI builds `Ctx`
lazily: an op that touches no field of it never triggers the load.

### Marvin API landmines

All of these are load-bearing and were found the hard way. Do not "simplify" them
away.

- **`timeZoneOffset` sign is inverted from JavaScript.** The API wants negative
  west of UTC (Pacific is `-480`); `Date.getTimezoneOffset()` returns `+480`.
  Always use `marvinTimeZoneOffset()`. Getting this wrong dates items to the
  wrong day.
- **`timeEstimate` is milliseconds**, despite reading like minutes. The domain
  layer works in minutes and converts. A raw `30` means 30ms.
- **Inline `#Category` does not resolve.** Marvin strips the token from the title
  but stores the literal string as `parentId` (observed: `parentId: "#Admin"`).
  The task then belongs to no real container and no tree crawl can find it again.
  `capture` resolves the name to a real id before sending. Inline `+today` is
  fine and is left to the server.
- **`unassigned` is a real sentinel**, used as a value for `day` and `parentId`,
  and as a `parentId` argument to `/children` to read the inbox. It is not null
  and must be mapped at the boundary.
- **The API is rate limited to 1440 requests/day and 1 per 3 seconds.** This is
  documented but *not server-enforced* — there is no `429` and no rate-limit
  header, so there is no backpressure to react to. Enforcement is account
  restriction after human review, which makes it more dangerous to ignore, not
  less. Budget accordingly: `brief` costs 3 requests, `find` costs 22 on this
  account and fires them concurrently.
- **The public API has no search endpoint and no bulk export**, so without sync
  credentials `find` crawls the container tree. Two consequences worth knowing:
  the crawl is expensive against the rate limit, and `/children` does not return
  completed tasks, so the crawl cannot see completion history at all (measured:
  53 tasks visible via crawl, 354 via the database).
- **`MARVIN_SYNC_*` enables a read-only fast path.** Marvin's sync database is a
  real CouchDB, so `find` becomes one Mango query instead of ~22 requests, and it
  sees everything including completed work. `Repo` picks this automatically when
  the credentials are present and falls back to the crawl when they are not.
  Reads only — writes stay on the public API, which owns conflict resolution and
  the reward/kudos side effects that writing directly would bypass.
- **Writes must carry `fieldUpdates.<field>` timestamps.** Marvin resolves
  multi-device conflicts per field by comparing them, and the public API does not
  maintain them for you. `updateRaw` handles this. Omitting it means an edit from
  the phone silently beats yours regardless of write order.
- **The tree can contain cycles.** Any recursive walk needs a visited set.
- **`/addCategory` is undocumented.** It is used by nothing right now; verify
  before relying on it.

Reference: [Marvin API](https://github.com/amazingmarvin/MarvinAPI/wiki/Marvin-API)
and [data types](https://github.com/amazingmarvin/MarvinAPI/wiki/Marvin-Data-Types).

### Dependency notes

`package.json` pins `@hono/node-server` forward via `overrides`. It arrives
transitively through the MCP SDK, and versions below 2.0.5 carry
GHSA-frvp-7c67-39w9, a path traversal in `serve-static` on Windows. Nothing here
serves static files, so it is unreachable, but a public repo reporting
vulnerabilities is its own problem.

Do not run `npm audit fix --force` to resolve it. Its remedy is to downgrade
`@modelcontextprotocol/sdk` to 1.24.3, which reinstates GHSA-345p-7cg4-v4c7, a
cross-client data leak affecting 1.3.0 through 1.25.3. Trading a Windows-only
static-file bug we cannot hit for a live data leak we can is a bad trade. Drop
the override once the SDK depends on >= 2.0.5 itself.

### Testing against a real account

There is no Marvin sandbox, so any manual verification runs against somebody's
live task list. Reads are free. If you must write:

- Prefix titles with `ZZ` so the litter is obvious, and delete afterwards.
- Check the delete response status. A failed delete returns 200-shaped output in
  some ad-hoc scripts and will leave the task behind.
- Never modify a pre-existing document.

Do not commit credentials, not even into an example string in a comment. That
has happened here once already.

## Deliberately not supported

Habits, goals, trackers, rewards, kudos, time tracking, recurring tasks,
subtasks, dependencies, snoozing, time blocks and daily sections. The model
exposes nine task fields out of roughly seventy. Adding one back is easy;
carrying all seventy was the problem with the previous version.

The narrow surface is the feature. Nine predictable fields is what makes the
tool safe to hand to an agent with write access; seventy fields with subtle
interdependencies is not. If you need the rest of Marvin, use Marvin.

Two things to know before adding one back:

- **Completed tasks are invisible to the public API.** `/children` does not
  return them, so anything built on completion history needs the sync database.
- **Habits, time blocks and recurring tasks each have their own document type**
  with their own lifecycle rules. They are not extra fields on a task, and
  treating them as such is how the previous version got unmaintainable.

## Why writes still go through the public API

Reads are strictly better via the database, but writes are not:

- `/addTask` resolves inline `+today` / `+tomorrow` server-side. Writing
  documents directly means reimplementing date-phrase parsing.
- `/markDone` has observable side effects beyond `done` — it was measured
  mutating `day` from `unassigned` to today, and setting `doneAt`.
- A task created via `/addTask` comes back with ~37 populated fields
  (`masterRank`, `rank`, `firstScheduled`, `dailySection`, ...) that Marvin's own
  clients likely assume exist.

For anything the API lacks an endpoint for, use `/doc/create` with the
full-access token rather than reaching for the database. That is how a category
would be created, since `/addCategory` returns 404.

Design rationale lives in `docs/superpowers/specs/`.
