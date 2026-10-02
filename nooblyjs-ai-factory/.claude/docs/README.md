# factory docs: start here

These notes explain, in plain language, what was built and *why*: all 26 phases (F00–F25) of the [roadmap](../steering/Roadmap.md), one note each.
Read them in order the first time; later, the [**reference**](./reference.md) has every command, config key, file, event and endpoint in one place.

## Reading paths

Short on time? Each path stands on its own (🎯 marks the phases that carry the big ideas).

| If you want to understand… | Read |
|---|---|
| **the core loop**: one issue to one PR, safely | F01 → F02 → F03 → F04 → F05 |
| **running many items**: queues, pipelines, specs, parallel work | F06 → F07 → F08 → F10 |
| **trust**: why you can believe a factory PR | F04 → F11 → F13 → F14 → F24 |
| **people in the loop** | F12 → F16 → F17 → F18 |
| **measuring and improving** | F19 → F20 → F21 → F22 |
| **scale**: other machines, other forges, many repos | F15 → F23 → F25 |

## The phases

The factory is built **on top of** the `noobly` harness. If a harness idea comes up (sessions, events, the sandbox, headless mode), its own doc is linked: those live in [`../nooblyjs-learn-harness/.claude/docs/`](../../../nooblyjs-learn-harness/.claude/docs/README.md).

| # | Doc | What you'll learn |
|---|---|---|
| F00 | [F00-project-setup.md](./F00-project-setup.md) | Harness vs factory; the harness as a linked dependency; one import file; ids that sort by time; a controllable clock |
| F01 | [F01-driving-the-harness.md](./F01-driving-the-harness.md) | 🎯 An agent as a function call: in-process vs subprocess drivers, NDJSON streams, stopping runs (caller, timeout, budget), estimating cost while it runs, fakes + a contract test |
| F02 | [F02-isolated-workspaces.md](./F02-isolated-workspaces.md) | A workspace per step: a bare mirror, pinned bases, worktrees, a per-workspace harness home (trusted settings in, transcript out), the control plane commits, a cached single-flight setup, failing closed without a sandbox, cross-process locks |
| F03 | [F03-issue-in-pr-out.md](./F03-issue-in-pr-out.md) | 🎯 The first job: assigned, not chatted. A forge as a folder, PRs identified by their branch, the control plane pushes and you merge, prompt injection defended in layers |
| F04 | [F04-deterministic-gates.md](./F04-deterministic-gates.md) | A claim is not a fact: the repo's checks, run by the factory in order, fail fast, time-limited, fail closed; a Stop hook shows the agent the verdict early; refuse before spending money |
| F05 | [F05-event-store.md](./F05-event-store.md) | 🎯 Event sourcing: an append-only log in SQLite, pure reducers, rebuildable tables, idempotency keys, side effects that survive a crash (intended → done → reconciled), dead-run recovery, `kill -9` then `run retry` |
| F06 | [F06-scheduler-leases-budgets.md](./F06-scheduler-leases-budgets.md) | 🎯 A queue with limits: `factory serve`, priority + fairness, leases with heartbeats (not locks), budgets that reserve, stop-all/cancel as events, retry policy; two database races found by a flaky test |
| F07 | [F07-line-engine.md](./F07-line-engine.md) | 🎯 The pipeline as data and a pure `decide()`; `when` conditions without eval; "broke" vs "said no"; triage asks before anyone builds; verify on a clean checkout; retry `--from`, pause, resume |
| F08 | [F08-spec-driven-development.md](./F08-spec-driven-development.md) | 🎯 Requirements (EARS) → design → tasks before code; a deterministic check + fix loop; traceability in the PR; steering files; `factory init` drafts them as a PR |
| F09 | [F09-agent-roles.md](./F09-agent-roles.md) | Roles as files (prompt, tier, permissions, limits); built-in → repo → operator layers; invariants no layer can break (read-only stays read-only); models by tier; one prompt order |
| F10 | [F10-fan-out-fan-in.md](./F10-fan-out-fan-in.md) | 🎯 A spec's tasks built in parallel waves (dependencies merged first, overlapping paths apart), merged back by the control plane, conflicts resolved by an integrator; a check belongs at the level it describes |
| F11 | [F11-reviewer-agents.md](./F11-reviewer-agents.md) | Judgment after facts: deterministic tampering check, a read-only reviewer against the spec with validated findings, a security reviewer for sensitive changes; scripted mode never reaches a real model |
| F12 | [F12-humans-in-the-loop.md](./F12-humans-in-the-loop.md) | 🎯 Graduated autonomy (L0–L3, the operator's to give); human gates that PARK a run (free waiting); approve / reject with feedback that rewinds to the producer; an inbox; policy gaps; L3 auto-merge |
| F13 | [F13-repair-loops.md](./F13-repair-loops.md) | Failure is information: a fixer gets the exact failure, the run rewinds to verify; bounded attempts, loop detection by signature, escalation with a draft PR; loop state kept outside what the loop resets |
| F14 | [F14-scope-and-evidence.md](./F14-scope-and-evidence.md) | 🎯 Declared scope checked (protected paths need a person); the PR is the evidence (claims beside facts, requirement → task → test, cost that adds up); reading a PR cold; `npm run check:examples` |
| F15 | [F15-github-forge.md](./F15-github-forge.md) | 🐙 The Forge interface on GitHub (REST + GraphQL, rate limits, token by env); signed, idempotent webhooks (label → run, review → fixer, merge → merged); polling; a fake GitHub for offline tests |
| F16 | [F16-factory-tools-mcp.md](./F16-factory-tools-mcp.md) | 🔧 Six narrow step tools (read_spec, report_progress, ask_human → park, record_decision, submit_artifact, request_scope) served in-process and over MCP; per-step HMAC tokens; `factory mcp --operator` for your own noobly chat |
| F17 | [F17-dashboard.md](./F17-dashboard.md) | 📺 The line in a browser: SSE from the event log (resumes with Last-Event-ID), a JSON API built on the CLI's own functions, no framework; token in the fragment, header-only POSTs, textContent only |
| F18 | [F18-notifications-chatops.md](./F18-notifications-chatops.md) | 🔔 Ping only for actions: outgoing webhooks (Slack/Discord/JSON) with filters, batching and a cursor; `@factory run\|fix\|stop\|explain` with a fixed grammar and an allow-list |
| F19 | [F19-factory-bench.md](./F19-factory-bench.md) | 🏁 21 cases scored by hidden tests through the whole line; checkers verified (fail on start, pass on solution); oracle 100% / null 0% bound the pipeline; repeats, spread, flips; a case miner |
| F20 | [F20-metrics.md](./F20-metrics.md) | 📊 Metrics as pure functions of the log: lead time (median/p90), time and cost per station, first-pass gates, PR acceptance, human edits (local merges detected with git), escalations, cost per merged PR |
| F21 | [F21-learning-loop.md](./F21-learning-loop.md) | 🔁 Retro after close → learnings → deterministic clustering (per repo, counted in runs) → a draft PR adding one rule to steering, with the evidence and a bench before/after; nothing applied without a person |
| F22 | [F22-cost-aware-routing.md](./F22-cost-aware-routing.md) | 💸 Routing policies as data: start cheap, climb fast→balanced→strong on signals from the run (repairs, retries, low triage confidence, size, human review); every decision an event; cost and success per station and tier; `bench --routing` |
| F23 | [F23-containers-and-workers.md](./F23-containers-and-workers.md) | 🛰 Agent steps on remote workers: a leased queue, heartbeats that carry the stop button, commits as git bundles, per-worker tokens; the repo's commands in containers (and why that's not the agent's sandbox) |
| F24 | [F24-security-hardening.md](./F24-security-hardening.md) | 🛡 A threat model; every commit scanned for secrets and risky changes before the push (held for a person); the factory's own secrets scrubbed from agents (a real hole, closed); a hash-chained audit export; a red-team suite of 7 attacks that must never deliver |
| F25 | [F25-fleet-campaigns.md](./F25-fleet-campaigns.md) | 🚢 One change across many repos: a campaign is a batch of ordinary items (each repo's steering adapts the spec), isolated failures, a per-repo-per-day PR limit, batch tracking; cron schedules, once per minute, no catch-up |

Plus: [**reference.md**](./reference.md), everything you can type, configure or read.

New phase? Copy [_template.md](./_template.md).

## Recurring lessons

Some ideas came back phase after phase. They're the best summary of what building a factory teaches:

- **Deterministic checks decide; models advise.** Gates (F04), scope (F14), tampering (F11) and the secret scan (F24) are programs. The agent's summary and the reviewer's opinion never are the verdict.
- **The event log is the backbone.** Retries (F05), the scheduler (F06), the dashboard's live feed (F17), notifications (F18), metrics (F20), learning (F21) and the audit trail (F24) are all views of one append-only log.
- **Idempotency at every door.** Pushes, PRs, comments, webhooks, schedules and notifications all carry keys: networks retry, processes crash, and nothing may happen twice.
- **Leases, not locks.** Runs (F06) and remote steps (F23) are held only while someone heartbeats; a vanished worker costs a lease, not the work.
- **Park, don't wait.** A run that needs a person holds nothing (F12, F16, F24).
- **Test the docs, attack the controls.** `check:examples` found 8 of 11 examples broken (F14); the red-team suite found the factory's own secrets reachable by agents (F24).

---

## Quick start

```bash
npm install                                      # links ../nooblyjs-learn-harness into node_modules
node bin/factory.js --help
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc             # a tiny repo with a real test gate
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-slow.json --autonomy L2 --allow-unsandboxed    # F03–F14, offline
node bin/factory.js serve --dashboard            # F06, F17: the queue and a browser view
node bin/factory.js bench --verify               # F19: every bench case's checker
npm test                                         # offline, no API key
npm run check:examples                           # every example in these docs still works
```
