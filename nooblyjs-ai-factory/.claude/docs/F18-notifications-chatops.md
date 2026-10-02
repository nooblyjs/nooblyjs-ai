# Phase F18: Notifications and chatops

**Goal:** bring people in only when they're needed, where they already are: a chat channel, and the issue or PR they're looking at.

---

## Part 1: notifications (`src/notify/`)

### What's worth a ping

Most events are for the dashboard: steps starting, agents typing, gates running. A channel should only get things **someone has to do something about**:

| Event in the log | Notification kind | Why a person cares |
|---|---|---|
| `inbox.opened` (approval, question, policy, scope) | `inbox.opened` | the factory is waiting for them |
| `inbox.opened` (escalation) | `run.escalated` | the factory gave up and needs help |
| `run.finished` delivered | `run.delivered` | a PR to review |
| `run.finished` failed | `run.failed` | (opt-in) |
| `run.merged` | `run.merged` | (opt-in) |
| `budget.exceeded` (new) | `budget.exceeded` | work is waiting on money |

`budget.exceeded` is new: the scheduler already knew a run was waiting on the daily budget, but only as a line in `factory status`. Now it's an event, recorded **once per day per budget** (an idempotency key, `budget:2026-09-30:daily budget`), not once per tick.

### Targets, filters, batching

```json
"notify": { "targets": [
  { "name": "team", "urlEnv": "SLACK_WEBHOOK_URL", "format": "slack",
    "events": ["inbox.opened", "run.escalated", "run.delivered", "budget.exceeded"],
    "repos": ["calc"], "batchMs": 60000 },
  { "name": "alerts", "urlEnv": "DISCORD_WEBHOOK_URL", "format": "discord", "events": ["run.escalated"], "batchMs": 0 }
] }
```

- **Formats**: `slack` → `{ text }` (Slack and Mattermost incoming webhooks), `discord` → `{ content }` (≤ 2000 characters, `**bold**`), `json` → `{ notifications: [...] }` for your own endpoint.
- **Filters**: by kind (`"*"` for all) and by repo.
- **Batching**: a target's notifications wait until the oldest is `batchMs` old, then go as **one** message ("factory: 3 updates"). Five runs finishing in a minute is one ping, not five. People mute channels that shout, and a muted channel hides the escalation that mattered.
- URLs come from **environment variables** (`urlEnv`): a webhook URL is a password for that channel.

### Following the log, safely

```
notifier.poll()   store.read({ after: cursor }) → notifications → each target's queue
notifier.flush()  send what's due
```

It's the dashboard's trick again (F17): the log is the feed. The **cursor** (the last seq handled) is saved in `~/.factory/notify-cursor.json`, so a restart **neither repeats nor loses** anything (tested). On the very first start it begins at the **end** of the log: nobody wants a ping for every event since last year.

Failures: 5xx, 429 or network errors are retried with backoff three times, then logged and dropped. A 4xx is dropped at once (the URL is wrong; retrying won't fix it). A notification is a courtesy, **never a reason to stop the factory**.

`factory serve` runs the notifier every 2 s (and flushes the batch when it stops). Without `serve`: `factory notify once` from cron. `factory notify test` sends a hello to every target.

### Checkpoint: an escalation pings the channel

A local HTTP server stood in for Slack. `subtract-buggy.json`'s fixer can't fix the bug, so the run escalates:

```
factory notify once                     → 0 notification(s)            (first start: from the end)
factory run add-subtract.md … --script subtract-buggy.json
factory notify once                     → 2 notification(s) in 1 message(s)

*factory: 2 updates*

*🆘 Needs a person: Add a subtract function*
local#1 needs a person: check "test" failed
the fixer changed nothing.
→ factory inbox (ask-…)

*❌ gate_failed: Add a subtract function*
Draft PR: …/prs/issue-1.md
→ factory logs run-…
```

Every ping says **what to do next** (`factory inbox …`, `factory logs …`).

## Part 2: chatops (`src/forge/github/commands.js`)

Comment on a GitHub issue or PR:

| Command | Where | Does |
|---|---|---|
| `@factory run` | an issue | queues a run (like the label) and replies "On it (run `…`)" |
| `@factory fix <what to change>` | a factory PR | the F13 fixer gets your text, like a "changes requested" review (F15) |
| `@factory stop` | either | cancels the run working on it |
| `@factory explain` | either | replies with the run's timeline (the `factory logs` lines) in a code block |

### A fixed grammar

One command per comment, **at the start of a line**, from a list of four. "please @factory run it" is *not* a command. There's no natural-language parsing: a command that can be misread will be, and these spend money and cancel work. Anything else after `@factory` gets a reply listing the commands; an ordinary comment gets no reply at all.

### Who may command it

Only `github.allowedUsers`. Anyone else gets a **polite reply** ("Sorry @mallory, only @sam can give the factory commands here."). Silence would look like the factory is broken. Nothing runs for them (tested).

Two more safety rules:
- **Never answer ourselves.** The factory's own comments carry a `<!-- factory:… -->` marker (F15), and comments with it, or from bots, are ignored. Otherwise a reply that quotes `@factory run` would start a loop.
- **One reply per delivery.** Replies are keyed by the webhook's delivery id, so GitHub redelivering a webhook doesn't make the factory say "On it" twice.

Which run does a comment mean? The newest run for that issue's item, or whose PR URL ends in `/pull/<number>`. No extra API call is needed.

**Checkpoint.** `@factory explain` on a PR replies with the run's timeline. Tested against the fake GitHub: `run` → a queued run and "On it"; the same delivery again → no second reply; `run` again → "Already on it"; `explain` → the status and timeline; `stop` → cancelled; a stranger → the polite no; `fix` on a PR the factory didn't make → "I can't find a factory PR". Trying it on real GitHub needs the F15 setup (a token and a webhook secret).

## A bug found on the way

`cancelRun` couldn't cancel a **parked** run: it fell through to "already finished" and left it parked forever. `@factory stop` on a run waiting for an answer found it. Parked runs hold nothing (no lease, no slot), so they can simply end, and now they do. This fixes `factory cancel` and the dashboard's Cancel button too.

## What was built

| File | What it does |
|---|---|
| `src/notify/messages.js` | event → notification (or nothing); formats for slack, discord, json |
| `src/notify/notifier.js` | follow the log from a cursor; filters; batches; retries |
| `src/commands/notify.js` | `factory notify test \| once` |
| `src/scheduler/scheduler.js` | `budget.exceeded`, once a day per budget |
| `src/forge/github/commands.js` | `parseCommand`, `parseComment`, `handleComment` |
| `src/server/webhooks.js` | `issue_comment` → commands; replies posted once per delivery |
| `src/commands/queue.js` | `serve` runs the notifier; the webhook server can reply |

## What we learned

- **Only ping for actions.** Choosing what *not* to send is the design. Batching and filters keep the channel worth reading.
- **The log is the feed, and a cursor makes it safe to restart.** It's the same idea as F17's `Last-Event-ID`, kept in a file.
- **Notifications are best-effort.** Retry, then drop and log; never block the line.
- **A fixed grammar for commands that act.** Parse four words exactly, answer everything else with help.
- **Answer strangers politely and yourself never.**
- How the commercial factories appear to do it: Devin and Codex post to Slack and take requests there; GitHub's Copilot coding agent is driven by assigning issues and commenting on its PRs; bots like Dependabot and Renovate use fixed `@dependabot rebase`-style comment grammars, and Prow (Kubernetes) uses `/retest`, `/lgtm` with an allow-list (OWNERS). The fixed grammar plus an allow-list is the well-worn pattern.
