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

You'll need a terminal for this part. It's three commands and about two minutes,
and you only do it once.

### 1. Install it

```bash
npm install -g marvin-mcp
```

If that fails with "command not found: npm", you need [Node.js](https://nodejs.org)
first — download the LTS version, install it, then run the command again.

### 2. Get your Amazing Marvin tokens

Open [**Settings → API**](https://app.amazingmarvin.com/pre?api) in Amazing
Marvin. You'll see two buttons that generate codes. You need both:

- **API Token**
- **Full Access Token**

Copy them somewhere for a moment. They're passwords for your account — don't
paste them into a public chat or a GitHub issue.

### 3. Save them

```bash
marvin auth --api-token PASTE_FIRST_ONE --full-access-token PASTE_SECOND_ONE
```

It checks both tokens with Marvin before saving them, so if a paste went wrong
you'll find out immediately rather than three commands later. The tokens end in
`=`, which is the character people most often miss when selecting by hand.

That's it. Run `marvin` and you should see today.

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

**Claude Desktop** — open Settings → Developer → Edit Config, and add:

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
write access to your tasks. Clients authenticate with `?token=<API_KEY>`.
Generate a real random string for this, and don't reuse a password.

</details>

---

## Faster search (optional)

Amazing Marvin's public API has no search endpoint, so by default `marvin find`
has to walk your whole project tree — around 22 requests, a few seconds, and it
can't see completed tasks at all.

If you add your sync credentials — further down that same
[Settings → API](https://app.amazingmarvin.com/pre?api) page — search becomes a
single query: roughly half a second, and it can see your completed history too.

```bash
marvin auth \
  --sync-server https://... \
  --sync-database YOUR_DB \
  --sync-user YOUR_USER \
  --sync-password YOUR_PASSWORD
```

This is read-only. Every write still goes through the official API, because that's
what handles conflict resolution when you're also editing on your phone.

**A note on rate limits:** Marvin's API allows 1440 requests a day. Normal use is
nowhere near that — `marvin` costs 3 requests. But `marvin find` without sync
credentials costs 22 each time, so if you search constantly, add the sync
credentials or you'll eventually hit the ceiling.

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
