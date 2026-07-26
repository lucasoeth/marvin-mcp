# Marvin CLI + MCP Redesign

**Date:** 2026-07-26
**Status:** Approved, in implementation

## Why

`marvin-mcp` today is a thin CRUD wrapper over the Amazing Marvin HTTP API: 20 tools
mapping roughly 1:1 to `/addTask`, `/markDone`, `/children`. It is API-shaped, not
agent-shaped. Answering "what should I work on now?" costs four or more round trips.

Two facts reframe the rebuild.

**The account is dormant.** A read-only audit found 0 tasks scheduled today, 0 labels,
0 kudos, 0 reward points, 0 pomodoros lifetime, and exactly one overdue task left over
from May. Never populated: `startDate`, `endDate`, `plannedWeek`, `plannedMonth`,
`taskTime`, `dailySection`, `timeBlockSection`, `labelIds`, `parentId`, `subtasks`,
`dependsOn`, `reviewDate`, `recurring`, `times`. The scaffolding exists (18 containers,
9 projects and 9 categories) but nothing is filed in it.

So the problem is not coverage, it is **consistency**. Nothing enters the system, and
every ritual downstream of capture therefore has no input. The build must optimise for
making the daily loop frictionless enough to stick, not for faithfully mirroring Marvin.

**The CLI is the tool surface.** Claude Code has shell access, so a good CLI *is* an MCP
server minus the server. The MCP adapter remains for Poke and mobile, but it is generated
from the same registry rather than hand-maintained.

## Non-goals

- A faithful or complete Marvin API client. Explicitly rejected by the user.
- Habits, goals, trackers, rewards, kudos, time tracking, recurring tasks, subtasks,
  dependencies, snoozing, time blocks, daily sections. All provably unused.
- Backwards compatibility with the current tool names or shapes. Greenfield.

## Domain model

Marvin exposes roughly 70 task fields. Expose nine, normalised at the boundary.

| Domain field | Marvin field | Notes |
|---|---|---|
| `id` | `_id` | |
| `title` | `title` | |
| `done` | `done` | |
| `scheduledFor` | `day` | The day I intend to work on it. `null` when unassigned. |
| `dueBy` | `dueDate` | The deadline. |
| `estimate` | `timeEstimate` | Minutes in the domain. Marvin's unit needs verification (see Open questions). |
| `note` | `note` | |
| `parent` | `parentId` | Resolved to a container name where useful. |
| `priority` | `isStarred` | `0..3`. |
| `frog` | `isFrogged` | `0..3`. Kept despite zero current usage: it is the one Marvin methodology the user deliberately built a workflow around, and it is cheap. |
| `labels` | `labelIds` | Resolved to names. |

### On `scheduledFor` vs `dueBy`

These are independent axes and the most important distinction in the model. Marvin
separates them at the API level too: `/todayItems` reads `day`, `/dueItems` reads
`dueDate`.

They are deliberately **not** named `day` and `dueDate` in the domain. `day` is vague
enough that an agent will occasionally conflate it with a deadline, and that mistake
silently reschedules real work. Explicit names make the distinction unmissable in both
CLI help and MCP tool schemas, at zero cost since we map at the boundary regardless.

The single real task in the account illustrates why both matter:

```
"Dry cleaner pickup at 6pm"   dueDate: 2026-05-20   day: unassigned
```

Due in May, never given a day, therefore quietly overdue for two months. Surfacing
"has a `dueBy` approaching but no `scheduledFor`" is a primary job of `brief`.

### Dropped date fields

- `startDate` — a gate, "cannot begin before X".
- `endDate` — a *soft* deadline distinct from `dueDate`, differing only in gamification
  penalty.

Both redundant for this user. Re-addable later; ops are additive.

## Architecture

```
src/
  core/
    client.ts        HTTP, auth, error mapping
    model.ts         raw Marvin <-> domain mappers
    journal.ts       write-ahead log + undo
    context.ts       Ctx passed to every op
    ops/
      types.ts       Op contract + defineOp
      index.ts       the registry
      *.ts           one file per op
  adapters/
    cli.ts           registry -> commands
    mcp-stdio.ts     registry -> tools
    mcp-http.ts      registry -> tools over Streamable HTTP
  bin/
    marvin.ts        CLI entry
```

All opinionated logic lives in `core/ops`. Adapters carry none.

### The op contract

```ts
interface Op<I, O> {
  name: string           // "brief" -> `marvin brief` and tool `marvin_brief`
  summary: string        // --help text AND MCP tool description, single source
  input: z.ZodType<I>    // validates CLI flags AND MCP arguments
  mutates: boolean       // true -> automatically wrapped in the journal
  run(input: I, ctx: Ctx): Promise<O>
  render(output: O): string
}
```

- CLI prints `render(output)`, or raw JSON with `--json` for piping to `jq`.
- MCP returns `render(output)` as text content plus `structuredContent`.
- Adding an op yields a CLI command and an MCP tool simultaneously.

This is the permanent fix for the duplicated dispatch switch currently present in both
`index.ts` and `remote-server.ts`: there is nothing left to duplicate.

## Ops (v1)

| Op | Mutates | Purpose |
|---|---|---|
| `capture` | yes | The habit primitive. Relies on Marvin's server-side `+today` / `#Category` / `@label` parsing, so no LLM and no client-side date parsing. Must feel instant. |
| `brief` | no | One call, whole picture: scheduled today, overdue, due-soon-but-unscheduled, inbox. The reason to come back daily. |
| `find` | no | Search escape hatch. Client-side filtering; Marvin documents no search endpoint. |
| `complete` | yes | Close things out. |
| `apply` | yes | Batch mutation. The autonomy surface: the agent reasons over the whole day and commits one atomic change set rather than dribbling out individual writes. |
| `hierarchy` | no | The 18 projects and categories, for resolving parents. |
| `undo` | yes | Revert the last change set. |

`triage` and `review` are deliberately deferred. They have nothing to operate on until
capture has been running for a while.

## Write authority and the journal

The user chose **full autonomy**: the agent writes directly, with no confirmation step.
The risk (a bad plan silently rewriting a day, with no undo in Marvin) was stated and
accepted.

The mitigation is a safety net that costs no friction. Every op with `mutates: true`
captures the before-state of each affected document and appends a change set to
`~/.marvin/journal.jsonl`:

```jsonc
{ "ts": 1..., "op": "apply", "changes": [ { "id": "...", "before": {...}, "after": {...} } ] }
```

`marvin undo` reverts the most recent change set via `/doc/update`. It doubles as the
agent's own record of what it just did.

## Testing

Ops are functions over a client interface, so the client is mocked and ops are tested
directly. The repository currently has zero tests; vitest is introduced in phase 1.

Priority coverage: the domain mappers (unit conversion and the `scheduledFor`/`dueBy`
split are exactly where silent corruption happens), journal round-tripping, and
`brief`'s categorisation logic.

## Sequencing

1. **Core + registry + CLI** with `capture`, `brief`, `find`, `complete`, `hierarchy`.
   The habit loop, usable immediately.
2. **`apply` + journal + undo.** Full autonomy, safely.
3. **MCP adapters regenerated** from the registry; delete `remote-server.ts` and
   `index.ts`; redeploy for Poke.
4. **`triage` / `review`** once there is real data to operate on.

## Open questions

- **`timeEstimate` units.** The wiki documents milliseconds; the current tool schema
  advertises minutes and passes the value through raw. If the wiki is correct, a
  30-minute estimate is currently stored as 30ms. The only task in the account has `0`,
  so this is empirically unresolved and needs a write test before the mapper is built.
- **`/addCategory`.** Used by the current server but absent from the documented endpoint
  list. Needs a live test.
- **Documentation.** 3,688 lines of markdown, much of it describing removed or
  never-built features. Proposed cut: one README plus one agent prompt file. Separate
  pass, out of scope here.

## Prior fixes folded in

Committed to `main` before this redesign, and carried forward:

- Token no longer logged (`req.url` -> `req.path`).
- `@modelcontextprotocol/sdk` 1.25.1 -> 1.29.0, clearing GHSA-345p-7cg4-v4c7.
- `timeZoneOffset` sign inversion corrected; the API wants negative-west-of-UTC, JS
  returns the inverse.
- README tool inventory corrected against the real 20 tools.
