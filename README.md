# marvin

Personal task management for [Amazing Marvin](https://amazingmarvin.com), as a
command line tool and an MCP server.

Built for one person and one workflow: get things captured, see what today looks
like, and let an AI assistant do the planning. It exposes nine task fields out of
Marvin's roughly seventy, on purpose.

## Install

```bash
npm install
npm run build
npm link          # optional, puts `marvin` on your PATH
```

Set your credentials, from Amazing Marvin under **Settings → API**:

```bash
export MARVIN_API_TOKEN=...
export MARVIN_FULL_ACCESS_TOKEN=...
```

Or put them in `.env`.

## Use

```bash
marvin                                      # today's brief
marvin capture "call dentist +tomorrow"     # add something
marvin complete "dentist"                   # by id or title fragment
marvin find "invoice"
marvin hierarchy                            # projects and categories
marvin undo                                 # revert the last change
```

`marvin` on its own prints the brief, because that is the thing you type every
morning:

```
2026-07-26

Overdue (1)
  - Dry cleaner pickup at 6pm  (due 2026-05-20, overdue)  [71c2a7c1...]

Today (3)
  - Write the migration plan  (frog, 90m)  [a4f2...]
  - Review PR #412  (!!, 30m)  [8c1e...]
  - Book flights  (due 2026-07-28)  [3b90...]
  2h30m estimated

Due soon, no day assigned (1)
  - Renew passport  (due 2026-07-29)  [d55a...]
```

That last section is the point. A task with a deadline and no day assigned is how
things quietly go overdue.

Add `--json` to any command for machine-readable output.

### Scheduling vs deadlines

Two independent fields, deliberately named so they cannot be confused:

- **`scheduledFor`** — the day you plan to work on it
- **`dueBy`** — the actual deadline

```bash
marvin capture "file taxes" --due-by 2026-09-01 --scheduled-for 2026-08-20
```

### Batch changes and undo

```bash
marvin apply --changes '[
  {"action":"update","id":"a4f2...","set":{"scheduledFor":"2026-07-27"}},
  {"action":"complete","id":"8c1e..."}
]'

marvin undo
```

Writes are applied without confirmation. Every one records its before-state to
`~/.marvin/journal.jsonl`, and `undo` reverts the last change set as a unit.
Genuine deletions cannot be undone, because Marvin issues a new id on recreate.

## MCP

The CLI and the MCP server are generated from the same registry, so they expose
identical capabilities. Use the CLI if your agent has a shell; use MCP if it
does not.

Claude Desktop:

```json
{
  "mcpServers": {
    "marvin": {
      "command": "node",
      "args": ["/absolute/path/to/marvin-mcp/dist/bin/marvin-mcp.js"],
      "env": {
        "MARVIN_API_TOKEN": "...",
        "MARVIN_FULL_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

For remote access (Poke, mobile), `npm run mcp:remote` serves Streamable HTTP.
It requires `API_KEY` and refuses to start without one, since it is
internet-reachable and holds write access to your tasks. Authenticate with
`?token=<API_KEY>`.

## Develop

```bash
npm test
npm run typecheck
```

Adding a capability means adding an op in `src/core/ops/` and registering it. The
CLI command and the MCP tool are generated from it. See `AGENTS.md` for the
architecture and for the Marvin API quirks worth knowing about.
