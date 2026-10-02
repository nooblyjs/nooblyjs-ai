# Phase F06: Scheduler, leases and budgets

**Goal:** go from "one job, when I type a command" to a **queue** that a long-running `factory serve` drains by itself: several runs at once, in a sensible order, within money limits, with a red button that works from any terminal.

---

## The idea: a queue with limits

```
factory submit ×10 ──► queue ──► scheduler (every tick) ──► workers (≤ maxConcurrent)
                        ▲            │ recover · requeue · stop? · pick · lease
factory cancel ─────────┤            ▼
factory stop-all ───────┘     event log + lease table (the only shared state)
```

Every piece of shared state lives in the store. `submit`, `status`, `cancel` and `stop-all` are separate processes that append events; `serve` reads them. Nothing talks to `serve` directly, so it can be killed and restarted at any moment and pick up exactly where the log says things are.

## The tick (`src/scheduler/scheduler.js`, ~110 lines)

```
every tickMs:
  1. recover        running runs whose lease expired or whose worker died → interrupted
  2. requeue        interrupted by ACCIDENT, attempts left              → queued again (attempt + 1)
  3. stop?          stop-all → abort every run held here; start nothing
  4. pick           which queued runs start (a pure function)
  5. lease + start  take each run's lease, record run.leased, run it in the background
```

The loop decides nothing clever itself. The rules live in pure functions (`pickRuns`, `canStart`), and each is a one-line table test.

## Which run next? (`pick.js`)

| Order | Why |
|---|---|
| 1. **priority** (`priority: high` in the issue, or `--priority`) | urgent things first |
| 2. **fairness**: the repo with the fewest runs going right now | ten runs for repo A mustn't starve the one for repo B |
| 3. **oldest first** | equal runs go in the order they came |

Limits **skip** a run rather than stop the loop (the next run may still fit): global `maxConcurrent`, per-repo `maxConcurrent`, the budget.

**A bug worth remembering:** the first version sorted the queue **once**, then filled slots. Fairness compares how busy each repo is, but "busy" changes as soon as you decide to start something. Sorted once, every slot went to the repo that queued first. Now it re-sorts after every pick. The fairness test (10 runs for A queued before 1 for B, 2 slots → A gets one slot and B gets the other) failed until it did.

## Leases: "mine, until…, unless I say so again"

Two workers must never run the same run at once. A lock held by a process that dies is held forever, so the factory uses a **lease**, which **expires**:

| | How | |
|---|---|---|
| acquire | in one transaction: insert, if the run has no lease or only an expired one | atomic across processes |
| renew | every `heartbeatMs`: push `expires_at` forward, **if the `lease_id` is still ours** | |
| lost | renew finds another `lease_id` → someone took over → stop and **write nothing more** | |
| expired | nobody renewed within `leaseTtlMs` → the scheduler may give it to another worker | works across machines, and for workers that hang rather than die |

Each lease gets a random `lease_id`. A worker that froze for a minute (a laptop lid, a debugger) and wakes up can't renew a lease that was meanwhile given to someone else, because the ids don't match.

**Check the lease before every side effect.** `deliver` calls `guard()` right before pushing and before writing the PR. A worker that lost its lease must not deliver. (The industrial version of this is a **fencing token**: every write carries the lease id and the storage refuses old ones. Here the worker checks.)

### Not everything belongs in the event log

Heartbeats are high-frequency, low-value facts ("still here", every few seconds, per run). Logging them as events would bury the story under noise. So leases live in a small **mutable table** (migration 2). Only lease *changes* (`run.leased`, `run.interrupted`, `run.requeued`) are events. Event sourcing is for facts you'll want to read later, not for every "still here".

### Another bug a test found

The scheduler tracked its running work by **run id**. After a lease expired, the same scheduler could lease the same run again while the old worker was still winding down. The new entry **overwrote** the old: the old worker's heartbeat was never checked (so it never learned it had lost the lease), and when it finally finished, its cleanup deleted the **new** worker's entry. Now it's keyed by **lease id**. The test checks both that the old worker is told `lease lost` and that the new one keeps going.

### What happens to a lost run?

```
lease expired / worker gone ──► run.interrupted ──► attempts left? ──► run.requeued ──► run.leased (attempt 2)
```

**Automatic retry is a policy decision, not a mechanism.** Accidents (a crash, a lost lease, `serve` shutting down) are requeued up to `maxAttempts`. **Human decisions are not**: runs stopped by `stop-all`, cancelled runs, and Ctrl+C stay stopped until someone runs `factory run retry`.

`factory run` and `factory run retry` also hold a lease (as `cli:<host>:<pid>`), so a run is always held by exactly one worker, however it was started. F05's pid check stays as a fast path: on the same machine, a dead pid is noticed at once, without waiting for the TTL.

## Budgets: money, in layers (`budgets.js`)

| Level | Limit | Enforced |
|---|---|---|
| run | `min(run's --budget, runBudgetUsd)` | **during** the run (F01's watchdog) |
| repo / day | `repos[slug].dailyBudgetUsd` | when **starting** a run |
| everything / day | `dailyBudgetUsd` | when **starting** a run |

Starting a run **reserves** its whole run budget:

```
can start  ⇔  spent today + reserved by running runs + this run's budget  ≤  daily cap
```

Without reservations, ten runs could all start at "$19 spent of $20" and together spend $39. And a run never gets more than what's left: the scheduler passes its budget into the run (`run.leased … budget $1.00`), where it caps the agent.

"Today" is the UTC day of the injectable clock, so a test can move to tomorrow in one line and see the budget reset.

## The red button (`kill-switch.js`)

| Command | Event | Effect |
|---|---|---|
| `factory stop-all` | `system.stop_all` | no new runs; every worker aborts at its next heartbeat; workspaces kept |
| `factory resume-all` | `system.resume_all` | queued runs start again; **stopped runs stay stopped** |
| `factory cancel <run>` | `run.finished {cancelled}` or `run.cancel_requested` | queued → cancelled now; running → stops at its next heartbeat |

They're **events, not signals to a process**. `stop-all` might be typed in another terminal (or, later, on another machine) than where the work runs. Every worker checks at each heartbeat, so the button works within one heartbeat, wherever the work is. A run stopped this way records `interrupted: stopped` and its build is **not** marked done, so a later retry builds again instead of reusing half a build.

## The operator's config: `~/.factory/config.json`

```json
{ "maxConcurrent": 3, "dailyBudgetUsd": 20, "runBudgetUsd": 2, "leaseTtlMs": 60000, "heartbeatMs": 15000,
  "maxAttempts": 3, "repos": { "calc": { "maxConcurrent": 1, "dailyBudgetUsd": 5 } } }
```

This is not the repo's `.factory/config.json` (what a repo says about itself: gates, setup). This one is what *you* say about the factory: how much at once, how much money.

## Two database races (found by a flaky test)

A test that has several processes append at once failed **once** in the full suite and never alone. Flaky concurrency tests usually point to a real race. Reading `db.js` again found two:

1. `PRAGMA journal_mode = WAL` ran **before** `PRAGMA busy_timeout`. Even switching to WAL needs a lock, so a process that found the file busy failed instantly ("database is locked") instead of waiting. Now the timeout is set first.
2. Migrations read the schema version *outside* the write lock. Two processes creating a new database at once both saw "version 0" and both created the tables ("table events already exists"). Now the version is re-checked inside the transaction.

The test now makes six processes **create** a fresh database at the same moment. Without the fixes it failed 5 out of 5 times with exactly those two errors; with them, 8 out of 8 passed. **A flaky concurrency test is a bug report, not bad luck.**

## What was built

| File | What it does |
|---|---|
| `src/config/factory-config.js` | `~/.factory/config.json` with defaults; per-repo limits |
| `src/scheduler/pick.js` | Pure: priority, fairness, slots, budgets → start / wait (with reasons) |
| `src/scheduler/budgets.js` | Spend today, reservations, `canStart`, a run's budget |
| `src/scheduler/leases.js` | Acquire, renew, hold-check, release |
| `src/scheduler/worker.js` | `holdRun`: heartbeat, stop reasons, `guard()` before side effects |
| `src/scheduler/kill-switch.js` | stop-all, resume-all, cancel |
| `src/scheduler/scheduler.js` | The tick: recover, requeue, stop, pick, lease, start |
| `src/store/db.js` | Migration 2: `leases`, `system`; the two race fixes |
| `src/store/recovery.js` | Now also: expired leases |
| `src/job/run-job.js` | `submitJob`; every execution holds a lease; interruptions recorded as such |
| `src/commands/queue.js` | `submit`, `serve`, `status`, `stop-all`, `resume-all`, `cancel` |

## Try it: the checkpoint

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc && examples/make-demo-repo.sh /tmp/abacus
mkdir -p /tmp/issues && for i in $(seq 1 10); do printf -- "---\ntitle: Note number $i\n---\nAdd a NOTES.md.\n" > /tmp/issues/note-$i.md; done
echo '{ "maxConcurrent": 3, "heartbeatMs": 1000, "leaseTtlMs": 5000, "tickMs": 500 }' > $FACTORY_HOME/config.json

S=examples/scripts/add-note-slow.json
node bin/factory.js submit /tmp/issues/note-{1..6}.md --repo /tmp/calc --script $S --allow-unsandboxed
node bin/factory.js submit /tmp/issues/note-7.md --repo /tmp/calc --priority urgent --script $S --allow-unsandboxed
node bin/factory.js submit /tmp/issues/note-{8..10}.md --repo /tmp/abacus --script $S --allow-unsandboxed

node bin/factory.js status          # explains what will start first, and why the rest wait
node bin/factory.js serve &         # in another terminal is nicer
node bin/factory.js status          # 3/3 running: #7 (urgent), #8 (abacus: fairness), #1 (oldest)
node bin/factory.js stop-all        # within a second: 0 running, the rest "stopped"
node bin/factory.js resume-all      # the queue drains; the 3 stopped runs stay stopped
node bin/factory.js run retry <a stopped run>
```

What the serve log showed:

```
13:25:42 [1e9a89] run.leased        ← #7, urgent
13:25:42 [21f577] run.leased        ← #8, the other repo, though submitted last
13:25:42 [95af8b] run.leased        ← #1, the oldest
13:25:46 … ■ finished: delivered ×3
13:25:46 [cb0184] run.leased  [fba4bf] run.leased  [d6092f] run.leased
13:25:49 system.stop_all
13:25:49 [fba4bf] ⏸ interrupted: stopped   (all three, within one heartbeat)
13:25:52 system.resume_all
13:25:52 … the remaining queued runs start and finish
```

## What we learned

- **A scheduler is a small loop around pure rules.** Keep the decisions pure and the state in the store, and the loop is easy to test and safe to kill.
- **Leases, not locks**: they expire, carry an id, and must be checked before every side effect.
- **Not every fact is an event.** Heartbeats go in a mutable table; the story goes in the log.
- **Retry policy is a decision.** Retry accidents automatically; respect human stops.
- **Reserve budget at start**, cap each run by what's left, and enforce the run's own limit while it runs.
- **Controls are events**, so the red button works from anywhere, within one heartbeat.
- **Fairness has to be re-evaluated after each decision.**
- **Flaky concurrency tests are bug reports.** Here, two real races in opening the database.
- How the industry does it: work queues with **visibility timeouts** (Amazon SQS) and **leases/heartbeats** (Temporal activity heartbeats, Kubernetes' Lease objects for leader election) are the same idea: work is "yours" only while you keep saying so. CI systems (GitHub Actions concurrency groups, Buildkite agents) cap parallelism per repo; cloud agents cap spend per task.
