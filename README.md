# marvin

Use [Amazing Marvin](https://amazingmarvin.com) from your terminal, and let AI
assistants like Claude read and update your tasks.

Two things you can do with it:

**Talk to your task list.** Connect it to Claude and say "what should I focus on
today?", "move everything I didn't finish to tomorrow", or "add the six things
from this email as tasks in my Work project". Claude reads your real Marvin
tasks and makes the changes in your real account.

**Type instead of click.** `marvin` shows today. `marvin capture "call the
dentist +tomorrow"` adds a task. No app switching, no waiting for a page to
load.

It's free, open source, and works with your existing Amazing Marvin account.

---

## What it looks like

```
$ marvin

2026-07-26

Today (3)
  - Write the migration plan  (frog, 90m)  [a4f2...]
  - Review PR #412  (!!, 30m)  [8c1e...]
  - Book flights  (due 2026-07-28)  [3b90...]
  2h30m estimated

Due soon, no day assigned (1)
  - Renew passport  (due 2026-07-29)  [d55a...]
```

That last section is the whole reason this exists. A task with a deadline and no
day assigned is how things quietly go overdue — Marvin knows about it, but it
isn't on any day's list, so you never see it until it's late. This puts it in
front of you while there's still time.

---

## Setup

Two ways in. Both need the same six values from Marvin, and you only do this
once.

### Just Claude Desktop? No terminal needed.

1. Download **`marvin-<version>.mcpb`** from the
   [latest release](https://github.com/lucasoeth/marvin-mcp/releases/latest).
2. Double-click it. Claude Desktop opens and asks whether to install.
3. Paste the six values from step 2 below into the form it shows you.

That's the whole thing. You don't need Node.js, npm or anything else installed —
Claude Desktop brings its own, and everything the server needs is inside the
file. Desktop stores the credentials in your operating system's keychain.

Skip to [step 2](#2-get-your-amazing-marvin-tokens) for where the six values
live, then to [Everyday use](#everyday-use).

### Want the command line too?

Then it's three commands and about two minutes.

### 1. Install it

```bash
npm install -g marvin-mcp
```

If that fails with "command not found: npm", you need [Node.js](https://nodejs.org)
first — download the LTS version, install it, then run the command again.

### 2. Get your Amazing Marvin tokens

Everything you need is on one page: [**Settings → API**](https://app.amazingmarvin.com/pre?api).

At the top, two buttons generate tokens:

- **API Token**
- **Full Access Token**

Further down the same page, under the sync database section, four more values:

- **Sync server**, **database**, **user**, **password**

These are passwords for your account — don't paste them into a public chat or a
GitHub issue.

### 3. Save them

```bash
marvin auth \
  --api-token PASTE_API_TOKEN \
  --full-access-token PASTE_FULL_ACCESS_TOKEN \
  --sync-server PASTE_SERVER \
  --sync-database PASTE_DATABASE \
  --sync-user PASTE_USER \
  --sync-password PASTE_PASSWORD
```

It checks the tokens with Marvin before saving anything, so if a paste went
wrong you'll find out immediately rather than three commands later. The tokens
end in `=`, which is the character people most often miss when selecting by
hand.

That's it. Run `marvin` and you should see today.

<details>
<summary>Why six values and not two?</summary>

Marvin's public API has no search endpoint and can't return completed tasks at
all, so without the sync database, search meant walking your entire project tree
— about 22 requests per search against an allowance of 1440 a day, and it still
couldn't see anything you'd finished.

Marvin enforces that allowance by restricting accounts rather than by returning
an error, so the failure mode was *your* account getting flagged. That's not
something to ship to somebody else as a default. With the sync credentials,
search is a single query, it's roughly 20× faster, and it sees your completed
history.

Reads use the sync database. Every write still goes through the official API,
because that's what handles conflict resolution when you're also editing on your
phone.

</details>

Your tokens are saved to `~/.marvin/config.json`, readable only by you. You
won't need to enter them again, and `marvin` will work from any folder.

---

## Everyday use

```bash
marvin                                    # what's today
marvin capture "call the dentist"         # add a task
marvin capture "file taxes +tomorrow"     # ...for tomorrow
marvin complete "dentist"                 # tick it off
marvin find "invoice"                     # search everything
marvin hierarchy                          # your projects and categories
marvin undo                               # take back the last change
```

`marvin complete` accepts part of a title, so you don't have to look anything up.
If the fragment matches more than one task it stops and shows you the options
rather than guessing.

### Deadlines vs. days

Marvin has two date fields, and mixing them up is the single easiest way to make
a mess. This tool renames them so you can't:

- **`--scheduled-for`** — the day you plan to work on it
- **`--due-by`** — the actual deadline

```bash
marvin capture "file taxes" --due-by 2026-09-01 --scheduled-for 2026-08-20
```

Plan to start on August 20th. Hard deadline September 1st. Two different things.

### Undo

Changes happen immediately, with no "are you sure?". The safety net is that every
change is written to a log first:

```bash
marvin undo
```

That reverts the entire last change set — if Claude just rescheduled twelve
tasks, `undo` puts all twelve back, not one of them. The one thing it can't
reverse is a genuine deletion, because Marvin issues a new id when a task is
recreated.

Add `--json` to any command if you want to pipe the output into something else.

---

## Connecting Claude

This is the part that makes it more than a keyboard shortcut.

**Claude Code:**

```bash
claude mcp add marvin -- marvin-mcp
```

**Claude Desktop** — if you installed the `.mcpb`, you're already done; it's
under Settings → Extensions. Otherwise open Settings → Developer → Edit Config
and add:

```json
{
  "mcpServers": {
    "marvin": {
      "command": "marvin-mcp"
    }
  }
}
```

Restart Claude. No tokens in the config file — it reads the ones you already
saved in step 3.

Then just talk to it:

> *"What's on my plate today? Anything I should move?"*
>
> *"I'm out sick. Push everything from today to Thursday."*
>
> *"Here are my notes from the meeting — pull out the action items and add them
> to my Work project with deadlines."*

Claude can read and change your tasks, so treat it the way you'd treat an
assistant with access to your calendar. `marvin undo` is there when it
misunderstands you.

<details>
<summary>Other MCP clients, and remote access from your phone</summary>

Any MCP client works — the server is a standard stdio MCP server, run as
`marvin-mcp`.

For remote access (Poke, or anything that can't run a local process), there's an
HTTP server:

```bash
API_KEY=some-long-random-string npm run mcp:remote
```

It refuses to start without `API_KEY`, because it's internet-reachable and has
write access to your tasks. Generate a real random string for it and don't reuse
a password.

Clients authenticate with `Authorization: Bearer <API_KEY>`. A `?token=<API_KEY>`
query parameter also works, for hosted clients that can't set headers, but prefer
the header where you have the choice: keys in URLs end up in access logs, proxy
logs and `Referer` headers, and you can't un-leak a key once a log has shipped
somewhere.

</details>

---

## Your data

Worth being explicit, since this asks for tokens to your task list:

- It runs entirely on your own machine. There is no server of mine involved.
- It talks to exactly two places, both Amazing Marvin's: their API for writes,
  and their sync database for reads. Nothing else, ever.
- Your tokens are stored in `~/.marvin/config.json` with permissions that make
  the file readable only by your user account. They're never transmitted
  anywhere except to Amazing Marvin.
- No telemetry, no analytics, no crash reporting, no phoning home. Nothing about
  you or your tasks is ever sent to me.
- `~/.marvin/journal.jsonl` keeps a local record of changes so `marvin undo`
  works. It stays on your machine. Delete it whenever you like.

If you connect it to Claude, then Claude sees whatever tasks it reads — that's
the point of connecting it, but it's worth saying out loud.

---

## What it deliberately doesn't do

Marvin has around seventy fields on a task. This exposes nine: title, notes,
scheduled day, deadline, time estimate, project, priority, frog, and labels.

No habits, goals, trackers, rewards, time tracking, recurring tasks, subtasks,
dependencies, snoozing, or time blocks. That's not an oversight and it's not a
roadmap — a small surface is why the tool is predictable enough to hand to an AI.
If you need Marvin's full power, use Marvin. This is for the daily loop.

---

## Contributing

Bug reports and pull requests welcome.

```bash
npm install
npm test
npm run typecheck
```

Adding a capability means adding one file in `src/core/ops/`. The CLI command
and the MCP tool are both generated from it, so the two surfaces can't drift
apart. `AGENTS.md` has the architecture and a list of Marvin API quirks that
were all found the hard way — read that before changing anything that talks to
the API.

MIT licensed. Not affiliated with Amazing Marvin LLC.
