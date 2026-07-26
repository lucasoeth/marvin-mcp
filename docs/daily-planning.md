# Daily planning

The workflow this tool exists to serve. Written for an assistant doing the
planning; the tool calls shown are CLI, but the MCP tools are identical.

This replaces the previous 1,000-line prompt file, most of which described
capabilities the tools did not have. Everything below is executable today.

## Morning

**1. Look before suggesting.**

```bash
marvin --json
```

One call gives you today's scheduled work, anything overdue, deadlines inside the
horizon with no day assigned, and the total estimate already committed.

**2. Deal with the unscheduled deadlines first.** `dueSoonUnscheduled` is the
list of things with a deadline that were never given a day. This is where work
goes to rot. Each one either gets a day or an explicit decision that it slips.

**3. Name the frog.** One task, the one most likely to be avoided — important and
uncomfortable, not merely large. Ask rather than assert:

> "Looking at today, I think the frog is *rewrite the migration plan* — it has a
> deadline, it's the only thing here you can't do on autopilot, and it's been
> moved twice. Sound right?"

If they dodge naming it, the thing they are not mentioning is usually the frog.

Once agreed, mark it, so it survives the conversation:

```bash
marvin apply --changes '[{"action":"update","id":"...","set":{"frog":3,"scheduledFor":"2026-07-26"}}]'
```

`brief` sorts frogs to the top, so tomorrow's briefing shows it first.

**4. Sanity-check the load.** Compare `totalEstimateMinutes` against the hours
actually available. If today holds six hours of estimates and four hours of
meetings, say so and propose what moves. Do not silently accept an impossible
plan.

**5. Commit the plan in one write.** Build the whole change set and apply it
once, so `marvin undo` reverts the plan as a unit rather than leaving it half
applied.

## Through the day

Capture is the thing that has to be frictionless. Inline syntax means no flags
for the common case:

```bash
marvin capture "email the landlord +today #Admin"
```

When the day goes sideways, re-brief and reshuffle rather than apologising for
the original plan. Move what did not happen, drop what no longer matters.

## Evening

```bash
marvin --json
```

`completedToday` is the honest count. What is left in `today` either moves to a
specific day or gets deliberately dropped — leaving it scheduled for a day that
has passed is how the overdue pile grows.

## Principles

- **Read before writing.** Never propose a plan without calling `brief` first.
- **One frog, not three.** The point of the frog is that it is singular.
- **Estimates are a budget, not decoration.** If nothing has an estimate, the
  plan is a wish list.
- **`scheduledFor` is not `dueBy`.** Moving a deadline to fit a plan is a
  different act from moving the plan to fit a deadline. Never do the first
  without saying so.
- **Batch the writes.** One `apply` per planning session.
- **Prefer asking to guessing** on which task is the frog and on what should
  slip. Those are the two judgements that are actually the user's.
