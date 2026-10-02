# factory: reference

Everything you can type, configure or read, in one place. The **why** is in the phase docs ([README](./README.md)); this page is the **what**.

- [Commands](#commands)
- [Operator config: `~/.factory/config.json`](#operator-config-factoryconfigjson)
- [Repository config: `.factory/config.json`](#repository-config-factoryconfigjson)
- [Files in a repository](#files-in-a-repository)
- [Environment variables](#environment-variables)
- [Lines and stations](#lines-and-stations)
- [Roles](#roles)
- [Run statuses](#run-statuses)
- [Events](#events)
- [HTTP endpoints](#http-endpoints)
- [Where things are on disk](#where-things-are-on-disk)

---

## Commands

`factory <command> --help` shows each command's own options.

### Doing work

| Command | What it does | Phase |
|---|---|---|
| `factory run <issue.md> --repo <path>` | One item, start to finish, in this terminal | F03–F07 |
| `  --script f.json` / `--echo` / `--provider p --model m` | scripted replies (no model, no cost) / echo / a real model | F01, F05 |
| `  --autonomy L0–L3` · `--routing <policy>` · `--line <name>` · `--driver in-process\|subprocess` · `--budget usd` · `--allow-unsandboxed` | | F12, F22, F07, F01, F06, F02 |
| `factory run retry <run> [--from <station>]` | run a finished or interrupted run again, from a station | F05, F07 |
| `factory submit <issue.md>… --repo <path> [--priority high\|low\|n]` | queue items for `serve` (same options as `run`) | F06 |
| `factory serve [--until-idle]` | the scheduler: runs the queue | F06 |
| `  --dashboard [--port 8788]` · `--webhooks` · `--workers [--workers-port 8790]` | the dashboard, GitHub webhooks, remote workers, in the same process | F17, F15, F23 |
| `factory campaign create --spec c.md --repos a,b [--repos-file f]` · `status [id]` · `list` | one change across many repos | F25 |
| `factory init <repo> [--agent]` | draft steering and repo config, as a PR | F08 |
| `factory agent "<prompt>" [--repo <path>]` | one agent, optionally in a fresh workspace (for experiments) | F01, F02 |

### Watching and steering

| Command | What it does | Phase |
|---|---|---|
| `factory status` | what's running, what's waiting and **why**, spend today | F06 |
| `factory runs` · `logs <run>` · `events [--run <id>]` | runs; one run's story; the raw event log | F05 |
| `factory dashboard [--port 8788]` | the dashboard (prints a link with its token) | F17 |
| `factory inbox` · `approve <id>` · `reject <id> --feedback "…"` · `answer <id> "…"` (`--now` to continue in this terminal) | what's waiting for a person | F12 |
| `factory pause <run>` · `resume <run>` · `cancel <run>` | one run | F06, F07 |
| `factory stop-all` · `resume-all` | the red button | F06 |
| `factory metrics [--since 7d] [--json] [--no-detect]` | flow, quality and cost metrics (notices local merges) | F20 |
| `factory notify test\|once` | outgoing notifications | F18 |

### Improving and operating

| Command | What it does | Phase |
|---|---|---|
| `factory bench --verify` · `--agent oracle\|null` · `--label x --repeat 3` · `--compare a.json --compare b.json` · `--routing <p>` · `mine --repo <path>` | the end-to-end benchmark | F19, F22 |
| `factory learn [--now] [--agent] [--propose [--bench]]` | the learning loop | F21 |
| `factory github poll --repo owner/name` · `webhook-test` | GitHub without webhooks | F15 |
| `factory worker --server <url> --enroll <token>` · `list` · `revoke <id>` | remote workers | F23 |
| `factory mcp --operator` (your noobly chat) · `--step` (started by the harness) | the factory as an MCP server | F16 |
| `factory audit export [--since 30d] [--out f]` · `verify <f>` | the hash-chained audit log | F24 |
| `factory workspace create\|list\|release\|clean` | workspaces by hand | F02 |
| `factory db rebuild` | replay the event log into fresh tables | F05 |

## Operator config: `~/.factory/config.json`

Yours, on the machine that runs the factory. Every key is optional.

```jsonc
{
  // Scheduler and money (F06)
  "maxConcurrent": 3,              // runs at the same time
  "dailyBudgetUsd": 20,            // across all runs, per UTC day
  "runBudgetUsd": 2,               // per run (reserved when it starts)
  "maxAttempts": 3,                // lost/interrupted runs are requeued up to this
  "leaseTtlMs": 60000, "heartbeatMs": 15000, "tickMs": 1000,
  "repos": { "calc": { "maxConcurrent": 1, "dailyBudgetUsd": 5, "autonomy": "L2" } },   // per repo (slug or folder name)

  // Agents
  "models": { "fast": "claude-haiku-4-5", "balanced": "claude-sonnet-5-5", "strong": "claude-opus-5-5" },   // tiers (F09)
  "roles": { "builder": { "tier": "strong" } },                   // operator overrides of role fields (F09)
  "taskConcurrency": 3,            // fan-out tasks built at once per run (F10)
  "repairAttempts": 2,             // fixer attempts before escalating (F13)
  "autonomy": "L1",                // L0 suggest · L1 approve specs · L2 PRs · L3 merge green (F12)
  "routing": { "policy": "cheap-first", "lowConfidence": 0.6, "policies": { "mine": { "stations": { "build": { "start": "fast", "climbOn": ["retry"] } } } } },   // F22

  // Integrations
  "github": { "tokenEnv": "GITHUB_TOKEN", "webhookSecretEnv": "FACTORY_WEBHOOK_SECRET", "label": "factory",
              "allowedUsers": ["sam"], "webhookPort": 8787, "apiUrl": "https://api.github.com",
              "repos": [{ "owner": "acme", "name": "calc", "clone": "/src/calc" }] },          // F15, F18
  "notify": { "targets": [{ "name": "team", "urlEnv": "SLACK_WEBHOOK_URL", "format": "slack",
              "events": ["inbox.opened", "run.escalated", "run.delivered", "budget.exceeded"], "repos": ["calc"], "batchMs": 60000 }] },   // F18
  "isolation": { "image": "node:24-slim" },                        // repo commands in containers (F23)

  // Improvement and fleet
  "learning": { "minRuns": 3, "settleHours": 24 },                 // F21
  "campaigns": { "maxPrsPerRepoPerDay": 1 },                       // F25
  "schedules": [{ "name": "deps", "cron": "0 9 * * 1", "repos": ["../a"], "spec": "schedules/deps.md", "autonomy": "L2" }]   // F25, paths relative to ~/.factory
}
```

Secrets are **never** in this file: it names environment variables (`tokenEnv`, `urlEnv`…) instead.

## Repository config: `.factory/config.json`

The repository's instructions to the factory, **read from the pinned base commit** (committed and reviewed), never from anyone's working copy.

```jsonc
{
  "network": "none",                 // the agent's sandbox: "none" (default), "allow", or a list of hosts (F02)
  "setup": { "command": "npm ci", "cacheKey": ["package-lock.json"], "cachePaths": ["node_modules"] },   // F02
  "gates": {                         // the checks, in order, fail fast (F04). Also a list: [{ "name": "test", "run": "npm test" }]
    "lint": "npm run lint",
    "test": { "command": "npm test", "timeoutMs": 300000 },
    "e2e":  { "command": "npm run e2e", "fast": false }       // fast: false → not run by the agent's Stop hook
  },
  "timeoutMs": 600000,               // default per gate
  "scope": "strict",                 // "warn": record scope violations without failing (F14)
  "review": { "sensitive": ["src/auth/**"], "dependencies": true }       // what also gets the security reviewer (F11)
}
```

## Files in a repository

| Path | What | Phase |
|---|---|---|
| `.factory/config.json` | gates, setup, network, scope, review | F02–F14 |
| `.factory/steering/{product,tech,structure}.md` | what every agent should know (drafted by `factory init`) | F08 |
| `.factory/steering/conventions.md` | rules, including ones learned from review feedback | F21 |
| `.factory/roles/<role>.md` | the repo's version of a role (invariants still apply) | F09 |
| `.factory/specs/<item>/{requirements,design,tasks}.md` | a medium/large item's spec (on its branch) | F08 |

All of `.factory/` except `specs/` is **protected** (F14): the factory never merges changes to it by itself.

## Environment variables

| Variable | What |
|---|---|
| `FACTORY_HOME` | where the factory keeps its files (default `~/.factory`) |
| `FACTORY_DEBUG=1` | a debug log in `~/.factory/debug.log` |
| `FACTORY_NOOBLY_BIN` | the `noobly` binary for the subprocess driver (tests use a fake) |
| `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, `XAI_API_KEY`) | the model key; the harness keeps it from the agent's commands |
| `GITHUB_TOKEN` · `FACTORY_WEBHOOK_SECRET` | GitHub (names configurable) |
| `FACTORY_DASHBOARD_TOKEN` | fixes the dashboard token (otherwise made once, in `~/.factory/dashboard-token`) |
| `FACTORY_WORKER_ENROLL_TOKEN` · `FACTORY_WORKERS_HOST` | remote workers: the enrollment secret; the address to listen on (default 127.0.0.1) |
| `FACTORY_CONTAINER_IMAGE` · `FACTORY_CONTAINER_RUNTIME` | run the repo's commands in containers; docker or podman |
| `FACTORY_STEP_TOKEN` · `FACTORY_WORKSPACE` | set by the factory for `factory mcp --step` (not by you) |

**Agents never see the factory's secrets**: everything named like a secret is removed from a subprocess agent's environment, and an in-process agent that could run commands with secrets in reach is refused (F24).

## Lines and stations

`lines/default.json` (the default) and `lines/quick.json` (build → verify → deliver, for experiments). A line is data; each station has a `kind` and an optional `when`:

| Station | Kind | Runs when | Does |
|---|---|---|---|
| triage | triage | always | kind, size, clear?, confidence; stops vague or out-of-scope items |
| spec | spec | medium/large | requirements (EARS), design, tasks; checked and fixed |
| approve | approval | always (decides by autonomy) | parks a spec for a person at L1; L0 suggests only |
| build | build | | the builder (fan-out for multi-task specs); on a worker with `--workers` |
| verify | verify | | scope guard, then the gates, on a clean checkout |
| review | review | | tampering check, then the reviewer |
| security | review | sensitive paths or dependencies | the security reviewer |
| repair | repair | checks failed, blocking findings, or a person asked for changes | the fixer; then verify again |
| deliver | deliver | | security hold, push, the PR with its evidence |
| merge | merge | L3, green, nothing protected | merges |

## Roles

`src/roles/builtin/*.md`: **triager** (fast, read-only), **spec-writer** (strong), **builder** (balanced), **integrator**, **reviewer** and **security-reviewer** (read-only), **fixer**, **retro** (fast, read-only). Front matter: `tier`, `model`, `readOnly`, `permissionMode`, `allow`, `deny`, `maxTurns`, `budgetUsd`, `output`. Override per repo (`.factory/roles/`) or per operator (`"roles"`); invariants (read-only stays read-only, the always-deny rules) can't be overridden.

## Run statuses

| Status | Means |
|---|---|
| `queued` · `running` · `paused` · `parked` | in progress (parked = waiting for a person; holds nothing) |
| `delivered` | a ready PR |
| `merged` | merged (L3, a person on GitHub, or noticed locally by `factory metrics`) |
| `gate_failed` · `changes_requested` · `agent_failed` · `no_changes` | a draft PR (or none) and the reason |
| `needs_info` · `rejected` · `suggested` | stopped at triage or approval, on purpose |
| `blocked` | the security hold was rejected: nothing pushed |
| `cancelled` · `interrupted` · `error` | stopped |

## Events

The event log (`factory events`) is the source of truth. Types, by area:

- **items and runs**: `item.created` · `run.queued` `run.started` `run.leased` `run.requeued` `run.retried` `run.rewound` `run.paused` `run.pause_requested` `run.resumed` `run.parked` `run.cancel_requested` `run.interrupted` `run.finished` `run.merged`
- **stations**: `step.started` `step.finished` `step.failed` `step.progress` · `workspace.acquired` · `agent.event` · `wave.started` `wave.integrated` `task.finished` · `repair.attempted` · `route.decided`
- **the outside world**: `effect.intended` `effect.done` (pushes, PRs, statuses, merges) · `artifact.stored`
- **people**: `inbox.opened` `inbox.answered` · `policy.gap` · `scope.granted` · `pr.changes_requested` · `decision.recorded`
- **safety**: `security.blocked` · `system.stop_all` `system.resume_all` · `budget.exceeded`
- **fleet and learning**: `campaign.created` `campaign.item_submitted` `campaign.item_failed` · `learning.recorded` `retro.done` `learning.proposed` · `worker.registered` `worker.revoked`

## HTTP endpoints

All bind to `127.0.0.1` unless told otherwise.

| Server | Port | Auth | Endpoints |
|---|---|---|---|
| dashboard (F17) | 8788 | token (the link's `#token=`) as `Authorization: Bearer` or `X-Factory-Token` (the dashboard's own; survives proxies like Cloud Shell's web preview); POSTs header-only | `GET /api/status` `/api/runs` `/api/runs/:id` `/api/inbox` `/api/metrics` `/api/campaigns` `/api/events` (SSE) · `POST /api/inbox/:id` `/api/runs/:id/{cancel,pause,resume,retry}` `/api/stop-all` `/api/resume-all` |
| webhooks (F15, F18) | 8787 | HMAC signature | `POST /webhooks/github` (issues, pull_request, pull_request_review, issue_comment) |
| workers (F23) | 8790 | enrollment token, then per-worker tokens | `POST /worker/register` `/worker/lease` `/worker/heartbeat` `/worker/events` `/worker/complete` `/worker/fail` |

## Where things are on disk

```
~/.factory/
  config.json               the operator config
  factory.db                the event log and its tables (SQLite, WAL)
  repos/                    one bare mirror per repository
  workspaces/               worktrees, their harness homes, kept failures
  artifacts/                PR bodies, evidence.json, diffs, transcripts (by content hash)
  forge/                    the local forge: issues and PRs as files
  campaigns/<id>/issue.md   a campaign's spec
  secret · dashboard-token  made on first use (0600)
  notify-cursor.json        the notifier's place in the log
```
