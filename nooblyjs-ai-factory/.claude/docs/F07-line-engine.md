# Phase F07: The line engine and stations

**Goal:** turn "the job" (one hard-coded function) into an **assembly line**: stations declared as data, and a pure `decide()` that says what a run should do next. Then add the first station that saves money instead of spending it: **triage**.

---

## The idea: the pipeline is data; the next step is a question

Until now `executeRun` was code that did build, then deliver. Every new stage (triage now, specs in F08, review in F11) would have meant editing that function. Instead:

```json
{ "name": "default", "stations": [
    { "id": "triage",  "kind": "triage",  "retries": 1 },
    { "id": "build",   "kind": "build" },
    { "id": "verify",  "kind": "verify",  "retries": 1, "when": "build.agent.outcome == 'success'" },
    { "id": "deliver", "kind": "deliver", "retries": 2 } ] }
```

and a loop:

```
loop:
  run  = store.get('runs', id)          ← its state, from its events (F05)
  next = decide(run, line)              ← PURE: no I/O, no clock
  run a station  → step.started … step.finished (or step.failed)
  finish         → run.finished {status}
  pause          → run.paused
```

## `decide()`: a pure function (`src/line/engine.js`)

```
decide(run, line) → { action: 'run', station } | { action: 'finish', status } | { action: 'pause' }
```

Station by station, in line order:

| The station's step | → |
|---|---|
| `when` is false | skip it |
| never started, or pending (rewound) | **run it** |
| left "running" (we're deciding, so nobody is running it: the last worker died) | **run it again** |
| failed, failures ≤ `retries` | **run it again** |
| failed, out of retries | optional? skip : **finish `error`** |
| done, and its result says `stop` | **finish** with that status |
| done | next station |
| all done | finish with the last station's status |

Because it's pure, **every behaviour of every line is a table test**: "these steps so far → this next action". `test/line.test.js` has the happy path, stops, `when`, retries, dead workers and pause, all without a database or a model.

And "carry on after a crash" stops being a special case. A fresh executor asks `decide()` the same question and gets the same answer, because the answer depends only on the events.

### Two kinds of "didn't work"

| | Example | Recorded as | Retried? |
|---|---|---|---|
| **Broke** | an exception; invalid JSON from triage; git failed | `step.failed` | yes, up to the station's `retries` |
| **Said no** | triage: "unclear"; build: "changed nothing" | `step.finished` with `stop: { status }` | **no**: asking again won't change a considered "no" |

Getting this distinction right is most of what a retry policy is.

## `when`: config is never code (`src/line/conditions.js`)

`"when": "triage.size != 'small' && tasks.count > 1"` looks like JavaScript. It must never *be* JavaScript: a line file that said `"when": "require('child_process')…"` must be a syntax error, not a program. So conditions have their own tiny language and parser (recursive descent, about 80 lines): comparisons, `&&`, `||`, `!`, parentheses, strings, numbers, and dotted paths into earlier stations' results. No `eval`, no `new Function`.

- Conditions are compiled when the line is **loaded**. A typo fails at load time with its position, not halfway through a run.
- A missing path is `undefined`. In a config language "missing" and "null" should mean the same, so `==` treats them as equal (the first version didn't, and `nothing.here == null` was false).

## Loading a line (`src/line/line.js`)

Validation lists **every** problem at once (duplicate ids, unknown kinds, bad conditions), before any run starts. `factory submit` validates the line when you submit, not when `serve` picks the run up an hour later.

## The stations (`src/line/stations/`)

A station is one function, `run(ctx) → result`. Its result is plain data; later stations and `when` conditions can read it, and `result.costUsd` feeds the budgets.

| Station | Does | Result |
|---|---|---|
| **triage** | read-only agent (`plan` mode, no Stop hook) → validated JSON | `kind`, `size`, `clear`, `questions`… or **stop**: `needs_info` / `rejected`, with a comment on the issue |
| **build** | the builder (F03–F05), Stop hook on, no final gates | branch, sha, stat… or **stop**: `no_changes` / `agent_failed` |
| **verify** | gates on a **clean checkout** of the build's commit | `passed`, gate results |
| **deliver** | push + PR as idempotent effects (F05) | `status`, `head`, PR |

### Triage: the cheapest fix there is

A vague issue sent straight to a builder produces a confident guess: a PR nobody asked for, paid for in full. Triage asks first:

```json
{ "kind": "feature", "size": "medium", "clear": false,
  "questions": ["Which part should be better: new operations, input checking, performance, or documentation?", …],
  "reason": "The request names no behaviour to change and no way to check the result." }
```

- **Validated before trusted.** Invalid JSON or a missing field is a *failure* (retried), never a guess. An "unclear" answer with no questions is invalid too, because it's useless to the person who filed the issue.
- **Unclear** → the run ends `needs_info`, and the questions are posted **on the issue**, where the requester will see them. The builder is never paid for.
- **Out of scope** → `rejected`, with the reason on the issue.
- Comments live in a separate file (`issues/2-….comments.md`), so re-filing the issue from its source never erases them.

### Verify: the commit, not the disk

In F04 the gates ran in the builder's workspace, which checks the files **on disk**. That isn't quite the commit. A git-ignored file, a build artifact or a patched `node_modules` can make a check pass that the commit alone fails. Now verify checks out the **exact commit** in a fresh workspace and runs the gates there. That's what CI proves, and what a reviewer is about to merge.

The test shows it: the agent writes `GREETING.md` plus `local.txt`, which is **git-ignored**. The gate is `test -f local.txt`. The Stop hook, running in the builder's workspace, is happy. Verify, on a clean checkout, says ❌. **"Works on my machine" is a station now.**

Verify still reads the gates from the **original** base commit (`configSha`), so a build that edited `.factory/config.json` can't change which checks run.

## Controls

| Command | What |
|---|---|
| `factory run … --line quick` | build → verify → deliver (no triage) |
| `factory run retry <run> --from build` | `run.rewound`: that station and the ones after it start over; earlier results (triage) are kept. A new commit updates the **same** PR. Same commit → the effects are skipped |
| `factory pause <run>` | stops **between** stations; the one it's on finishes; the lease is released |
| `factory resume <run>` | back in the queue; `serve` carries on from the next station |

Pausing between stations, rather than mid-agent, is deliberate: nothing half-done, nothing to clean up.

## Bugs found on the way

- **Every run and the daily budget cost $0 (since F06).** `spentToday()` and the run's `costUsd` read `result.costUsd`, but the build step kept its cost at `result.agent.costUsd`. The demos used free scripted models, so nobody noticed. Every station now reports a top-level `costUsd`, and a test with a priced model checks that the run's cost is the sum of its stations'.
- **The triager was told "the tests fail, keep working".** Every workspace got the gates' Stop hook, including the read-only triager's. When triage tried to finish, the hook ran the repo's tests, which of course fail before the feature is built. The hook only makes sense for agents that change code, so `runStep` now takes `stopHook: false`.
- **`factory logs` crashed** after triage started reporting an agent summary: its "is this a build step?" check (`result.agent`) matched triage too. Each station's result is now recognised by what only it has.
- **A crash during delivery now heals itself.** In F05, a crash right after writing the PR left the run in `error` for a human to retry. Now the deliver station's `retries: 2` tries again at once, and the PR effect **reconciles** ("that PR already exists") instead of writing it twice. F05's effects plus F07's retry policy fix this without a human. The test changed to expect exactly that.

## Changes to earlier behaviour

- The **default line has triage**, so a script for `factory run`/`submit` needs a triage reply. Scripts can now be per station: `{ "triage": [...], "build": [...] }`. A plain list means the builder's replies only, and using one with a line that has triage fails with a message saying so (no guessing). All example scripts were converted.
- Tests about build and delivery say `line: 'quick'`, because that's what they test.

## What was built

| File | What it does |
|---|---|
| `lines/default.json`, `lines/quick.json` | Lines as data |
| `src/line/conditions.js` | The `when` language: tokenizer + recursive-descent parser |
| `src/line/line.js` | Load and validate a line |
| `src/line/engine.js` | `decide()`: pure |
| `src/line/executor.js` | The loop: decide → station → event → again; interruptions |
| `src/line/stations/{triage,build,verify,deliver,common}.js` | The stations, and what they share (which model, budgets, JSON extraction) |
| `src/job/run-job.js` | Now only creates, queues, starts and retries runs |
| `src/forge/local.js` | Issue comments |
| `src/store/projections.js` | Per-station tries and failures; rewind; pause |
| `src/commands/*` | `--line`, `retry --from`, `pause`, `resume`; logs describe each station |

## Try it

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

# A clear issue: all four stations (the script has a triage reply and the builder's):
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-self-fix.json --allow-unsandboxed
node bin/factory.js logs <run>
#   └ triage: feature · small · clear
#   │ notice: Stop hook: not done yet. … Check "test" (`node --test`) failed …
#   └ build: agent success · 1 commit(s)
#   └ verify: gates passed (clean checkout)
#   └ deliver: delivered → factory/issue-1/main

# THE CHECKPOINT: a vague issue stops at triage, with questions on the issue:
node bin/factory.js run examples/issues/make-it-better.md --repo /tmp/calc \
  --script examples/scripts/triage-unclear.json --allow-unsandboxed
#   needs_info
#   questions (also on the issue):
#     - Which part should be better: new operations (subtract, multiply…), input checking, performance, or documentation?
#     - How will we know it is better? …
cat $FACTORY_HOME/forge/*/issues/2-*.comments.md

# Redo part of a run:
node bin/factory.js run retry <run> --from verify --allow-unsandboxed   # same commit → deliver's effects are skipped
```

## What we learned

- **Make the pipeline data and the next step a pure question.** New stages become configuration; every behaviour becomes a table test; recovery isn't a special case.
- **Separate "it broke" from "it said no".** Retry the first; never the second.
- **Config is never code.** A small parser beats `eval`, and compiling at load time catches mistakes early.
- **Ask before you build.** Triage is the cheapest station and saves the most money.
- **Check the commit, not the disk.** Verify on a clean checkout is what CI does, for the same reason.
- **Hooks belong to roles, not to workspaces.** A read-only agent must not get a builder's hook.
- **Money bugs hide behind free demos.** Test cost accounting with a priced model.
- How the commercial factories appear to do it: Kiro turns a request into requirements → design → tasks before code; Devin asks clarifying questions when a task is ambiguous; Jules shows a plan to approve before it changes code. CI systems (GitHub Actions, GitLab CI) are exactly this: a pipeline declared as data, stages with conditions (`if:` / `rules:`) and retry policies, run on a clean checkout of a commit.
