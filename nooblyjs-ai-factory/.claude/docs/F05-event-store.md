# Phase F05: Durable state, the event store

**Goal:** make crashes boring. Everything the factory does is written to an append-only log, so a run survives `kill -9`: it can be seen, explained, and carried on from where it stopped, without paying for the agent twice or opening a second PR.

---

## The idea: write down what happened, derive what is

Until now a job lived only in memory. Kill the process mid-run and the factory forgot the run existed. There was an orphaned workspace, maybe a pushed branch, maybe a PR, and nothing to say how they fit together.

A factory runs unattended for hours, on many things at once, so **crashes are normal events, not disasters.** The classic answer is **event sourcing**:

```
      the only write                          derived, disposable
┌───────────────────────────┐   reduce   ┌───────────────────────────────┐
│ events (append-only)      │ ─────────► │ runs · items · effects         │
│ #2  run.started           │            │ run-…: status delivered,       │
│ #3  step.started build    │            │        attempt 2, $0.0055, …   │
│ #5  run.interrupted       │            └───────────────────────────────┘
│ #6  run.retried           │
│ …                         │
│ #29 run.finished          │
└───────────────────────────┘
```

- The **log** says what *happened*, in order, forever. Nothing is updated or deleted.
- The **projections** say what *is* ("which runs are running?"). Each is a **pure function** `reduce(row, event) → row`, applied event by event.

### Why is "append, then derive" easier to make crash-safe than "update rows"?

| Update rows in place | Append events, derive rows |
|---|---|
| A change often touches several rows; a crash between them leaves a mix of old and new | One event, plus its projection updates, in **one transaction**: all or nothing |
| The old value is gone. "What happened?" has no answer | The whole history is there: `factory logs` is just reading it |
| A bug that wrote a wrong value has corrupted data | A bug in a reducer: fix it, **rebuild** the tables from the log |

## The store (`src/store/`)

**One SQLite file** (`~/.factory/factory.db`) through `node:sqlite`, which is built into Node 24, so there's no dependency:

```sql
CREATE TABLE events (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,   -- the global order
  stream TEXT NOT NULL,                       -- 'run:<id>', 'item:<id>'
  type   TEXT NOT NULL,                       -- 'step.finished', …
  data   TEXT NOT NULL,                       -- JSON
  at     TEXT NOT NULL,
  key    TEXT UNIQUE                          -- idempotency key (or NULL)
);
CREATE TABLE runs (id TEXT PRIMARY KEY, data TEXT NOT NULL, seq INTEGER NOT NULL);   -- and items, effects
```

| Piece | What it does | Why |
|---|---|---|
| `db.js` | opens the file, **WAL** mode, a busy timeout, **migrations** (`PRAGMA user_version`) | readers don't block the writer; two processes *wait* for each other instead of failing with "database is locked"; old files upgrade themselves |
| `transaction()` | `BEGIN IMMEDIATE … COMMIT` / `ROLLBACK` | IMMEDIATE takes the write lock at the *start*, so two processes can't both read "not there" and both write |
| `events.js` | `append`, `read`, `subscribe`, `transaction`, `rebuild` | the only way anything is written |
| `projections.js` | pure reducers for `items`, `runs`, `effects` | state, derived |
| `effects.js` | intended → done, reconciled after a crash | side effects outside the database (below) |
| `recovery.js` | dead pid → `run.interrupted` | runs whose process died |
| `artifacts.js` | files by content hash | diffs, PR text, transcripts |

### Idempotency keys

An event may carry a unique `key`. Appending a second event with the same key **does nothing** and returns `null`. That turns "did I already do this?" into a database constraint instead of a hope. For example, `item.created` has the key `item:<repo>#<n>`, so filing the same issue twice gives one item with two runs.

### Things that surprised me

- **`seq` has gaps.** SQLite's `AUTOINCREMENT` uses up a number even for an insert that the unique key made it *ignore* (in a probe, the ids went 1, 3). Order is guaranteed; contiguity isn't. So readers ask for "`seq > last seen`", never "`seq = last + 1`".
- **"Notify after commit" is harder than it looks.** `append` tells listeners about an event after its transaction commits. But inside a *caller's* transaction, `append`'s own commit is a no-op (it joins the outer one), and the listener would hear about an event that the outer transaction then **rolls back**. The first version had that bug, and the tests didn't catch it until one looked for it. Now `store.transaction()` holds notifications until the *outermost* commit, and drops them on rollback.

## Rebuilding

Because reducers are pure and the log is complete, the tables are **disposable**:

```bash
$ factory db rebuild
Replayed 29 events → 1 items, 1 runs, 2 effects.
The rebuilt tables are identical to the old ones.
```

That's how you fix a projection bug, or add a new projection to old history, without losing anything. A test runs a full job, snapshots the tables, rebuilds, and compares.

The reducers are also tested **as tables** (`test/store.test.js`): a list of events in, the expected row out. There's no database and no mocks, because a pure function needs neither.

## Side effects: the hard part

Appending events is atomic. **The outside world isn't.** Pushing a branch or writing a PR happens outside the database, so a crash can land *between* "did it" and "wrote down that I did it". Retry naively and you get two PRs.

The pattern (`src/store/effects.js`): **write down the intention first, then act, then write down the result.**

```
effect.intended {key}  ──►  perform()  ──►  effect.done {key, result}
```

On a retry, look up the key:

| The log says | Meaning | What to do |
|---|---|---|
| `done` | it happened and we know it | skip; return the saved result |
| `intended` only | **we crashed in between: we don't know** | `check()` the world: "does origin's branch point at this sha?" / "is there a PR for this head that says this sha?" If yes, record `done` (*reconciled*) **without doing it again**. If no, do it now |
| nothing | never tried | do it |

**What exactly is idempotency for a step that opens a PR?** It's this: the effect's key is `pr:<run>:<sha>`. It names the effect **and its input**. Re-delivering the same commit is the same effect, so it happens once. A new build (a new commit) is a new effect. And the PR itself stores `sha:` in its frontmatter, so `check()` can tell "the PR for *this* build exists" from "an older PR for the same branch exists".

The test `CRASH DURING DELIVERY` does it for real: a forge that writes the PR and then throws, as if the process died. The retry reconciles the PR (`effect.done … reconciled: true`), pushes nothing new, reuses the build (**the agent isn't paid for again**), and there's still exactly **one** PR.

## Runs as a sequence of steps

The job (`src/job/run-job.js`) now reads its own history to decide what's left to do:

```
item.created ─► run.started ─► build ─────────────────► deliver ──────────────────► run.finished
                               (workspace, agent,        (push effect, PR effect)
                                gates, commit)
```

| On retry, if the log says… | …then |
|---|---|
| build **done** | reuse its result (commits, sha, gates); don't run the agent again |
| build **started but not done** (the process died) | the old workspace is released with `keep` (its partial work committed to its own branch), and the build starts fresh |
| push / PR done | skip (effects) |

Everything that goes into the log is **plain data**: a run's `request` stores the model name, the script *path*, the limits. It never stores a provider object or a function, because a retry in another process must be able to rebuild everything from the log alone.

## Noticing dead runs (`recovery.js`)

A run is "running" until something appends `run.finished`. After `kill -9`, nothing ever will. So `run.started` / `run.retried` record the **pid**, and recovery asks the OS whether that process still exists (`process.kill(pid, 0)`: signal 0 sends nothing, it only asks). If not, it appends `run.interrupted`. Every `factory runs`, `logs` and `run retry` does this first.

A pid only means something on one machine, and only until it's reused. F06 replaces this with **leases and heartbeats**, which work across machines.

## What the agent did, at a sensible size (`record.js`)

A harness turn emits hundreds of `text_delta` events. The recorder **coalesces** them into one `agent.event {kind: 'text'}` per paragraph, plus one each for tool calls, tool results (first 1000 characters), notices (like a Stop hook's complaint) and the turn's end. That's enough for `factory logs` to tell the story. The full transcript (for subprocess runs) and the diff are **artifacts**.

There's an honest trade-off, visible in the checkpoint below: text is buffered until the next event, so when the process was killed mid-sentence, **attempt 1's half-streamed text never reached the log.** Coalescing saves space and loses the last few seconds on a crash. Real systems make the same trade (flush intervals, batching) and pick where the line goes.

## Artifacts, by content (`artifacts.js`)

```
~/.factory/artifacts/1d/2005f480cc…     ← sha256 of the file IS its name
```

The same bytes are stored once. A file can't change without its name changing, so the event `artifact.stored {sha}` stays true forever. Writes go to a temp file first and are then renamed, so a reader never sees half a file. It's the same idea as git's object store.

## Many processes, one database

Two `factory run` commands at once are two processes writing one SQLite file. WAL plus a busy timeout make them **take turns** instead of failing. The test starts four processes appending 40 events each and expects exactly 160: nothing lost, nothing doubled.

## What was built

| File | What it does |
|---|---|
| `src/store/db.js` | SQLite: WAL, busy timeout, migrations, `transaction()` |
| `src/store/events.js` | The log: `append` (with keys), `read`, `subscribe`, `transaction`, `get`/`list`, `rebuild` |
| `src/store/projections.js` | Pure reducers: `items`, `runs`, `effects`; apply and rebuild |
| `src/store/effects.js` | `performEffect()`: intended → done, reconciled after a crash |
| `src/store/recovery.js` | Dead pid → `run.interrupted` |
| `src/store/artifacts.js` | Content-addressed files |
| `src/job/run-job.js` | `startJob` / `executeRun` / `retryRun`: a run as recorded steps |
| `src/job/deliver.js` | Push and PR as idempotent effects |
| `src/job/record.js` | The agent's events, coalesced into the log |
| `src/exec/harness/script.js` | Scripted models, now with `delayMs` (slow enough to kill) |
| `src/commands/history.js` | `factory runs`, `logs`, `events`, `db rebuild` |
| `factory run retry <run>` | Carry on after a crash |

## Try it: the checkpoint

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

# 1. Start a job with a deliberately SLOW scripted agent, in the background…
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-slow.json --allow-unsandboxed &
# 2. …and kill it hard, mid-agent:
sleep 2; kill -9 $!

# 3. The factory notices:
node bin/factory.js runs
#   ⏸️ run-…  interrupted   $0.0000  Add a subtract function
#      retry: factory run retry run-…

# 4. Carry on:
node bin/factory.js run retry <run-id>
#   kept the interrupted attempt's workspace: …
#   gates: test passed · push …: performed · PR created (performed)
#   delivered

# 5. The whole story, and proof nothing doubled:
node bin/factory.js logs <run-id>
node bin/factory.js run retry <run-id>        # → "was delivered: nothing to retry"
ls $FACTORY_HOME/forge/*/prs/                  # → one PR
node bin/factory.js db rebuild                 # → identical tables
node bin/factory.js events --run <run-id>      # the raw log
```

What `factory logs` shows:

```
#2  ▶ run started (pid 20226)
#3  ┌ build
#4  │ workspace ws-…b32124
#5  ⏸ interrupted: the process doing the work (pid 20226) is gone
#6  ↻ retried: attempt 2 (pid 20324)
#7  ┌ build
#8  │ workspace ws-…fcb5c4
#9  │ agent: I'll look at how add is written…
#10 │ ● Read(add.js)
…
#20 └ build: agent success · 1 commit(s) · gates passed
#22 ┌ deliver
#23 │ → push (intended)
#24 │ ✓ push done
#25 │ → pr (intended)
#26 │ ✓ pr done
#29 ■ finished: delivered
```

Note that `#5`'s time is when the death was *noticed*, not when it happened. With pids, you only find out when you look. Heartbeats (F06) will narrow that gap.

## What we learned

- **Append-only plus derived state** makes crash safety a property of one transaction, not of careful code everywhere.
- **Pure reducers make state disposable**: rebuild, compare, test as tables.
- **Idempotency keys** turn "did I already do this?" into a database constraint.
- **The outside world isn't transactional.** Record the intention, act, record the result, and after a crash **check the world** before redoing anything.
- **An effect's key should name its input** (`pr:<run>:<sha>`), so "same thing again" and "a new thing" are told apart.
- **Retries should reuse finished work**, above all the expensive agent.
- **Everything in the log must be plain data**, so any process can pick a run up.
- **Coalescing trades durability for size.** Know where your line is.
- How the industry does it: durable-workflow engines are built on this idea. Temporal records an **event history** per workflow and **replays** it to recover state after a crash; its "activities" (side effects) are retried and must be idempotent. AWS Step Functions keeps a similar execution history per run. GitHub's model helps too: a PR is identified by its head branch, so pushing again updates it instead of duplicating it.
