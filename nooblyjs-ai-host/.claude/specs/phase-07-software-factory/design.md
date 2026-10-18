# Phase 7 — Software Factory integration: design

> **Status: done, approved 2026-10-10 (the real-model run to a PR and the decisions in the summary are still open).** Summary: `docs/phases/phase-07-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

## Pieces

```
nooblyjs-ai-factory
  src/models/store/
    files.js              the file store: daily YAML streams, in-memory projections, keys, leases
    events.js             openStore(): the same interface, on files.js
    projections.js        the reducers, unchanged; applied in memory
    db.js                 removed (node:sqlite is no longer imported anywhere)
  src/services/scheduler/leases.js    the same functions, on the store instead of a database handle
  src/services/hosted.js              starts the scheduler; the handoff intake; services other apps call
  src/services/intake/handoff.js      handoff.created → issues and queued runs
  src/services/intake/attributes.js   quality attributes → gates
  src/services/line/stations/merge.js refuses when hosted
  public/js/pages/                    Line, Runs, Run, Inbox, Campaigns, Metrics on kit components
  src/config/repos-map.js             repos.yaml: a work item's repo name → a folder
  src/services/intake/demo-repo.js    the demo repo (a tiny web-storefront), created by seed()
  examples/noobly/                      the two scripts the seed copies to data/factory/scripts/
nooblyjs-ai-host
  src/services/for-you.js             Developer home: "Runs asking you", from the factory
  src/routes/home.js                  the item page's runs
  public/js/pages/home/               the runs panel, and answering a question
```

## The file store

```
data/factory/
  events/YYYY/MM/YYYY-MM-DD.yaml     one event per line:  - {"seq":412,"stream":"run:r1","type":"step.finished","data":{…},"at":"…","key":null}
  leases.yaml                        the few live leases (rewritten atomically; not events, as today)
  artifacts/…                        as today
```

- **Each line is a YAML list item whose value is JSON** (JSON is YAML). It reads with any YAML parser, and the
  store reads it back with `JSON.parse` per line, so the factory keeps its "Node built-ins only" rule.
- **Projections live in memory.** `openStore()` replays the log through the same reducers once, then applies each
  new event as it is appended. `rebuild()` replays again. Rows keep the `seq` that last changed them, for
  `list()`'s order.
- **The interface stays synchronous.** `append` is `fs.appendFileSync`; `seq` is the last one plus one.
- **A transaction** buffers its events and their projection changes and writes the lines in one append at the
  end. If the function throws, the buffered changes are dropped and nothing is written.
- **Idempotency keys** are a set built from the log.
- **More than one process.** The scheduler now runs in NooblyJS, but the CLI (`factory submit`, `factory runs`) can
  still open the same folder. Every append takes a lock (a lock folder made with `mkdirSync`, with a stale
  timeout), reads what other processes appended since it last looked, then writes. Reads check the files' sizes
  first and catch up the same way.
- **Leases** are a small file rewritten with tmp-then-rename under the same lock: `acquire`, `renew`, `holds`,
  `release` keep their rules (a random lease id, an expiry on the injected clock).
- `store.db` goes. Its three users change: `leases.js` (above), `budgets.js` (sums cost from `read()`), and
  `history.js` (row counts from `list()`).
- An old `factory.db` is not read. `register()` logs that it is there and ignored.

## Runs in NooblyJS

`register()` creates the scheduler it already has for `factory serve` (`createScheduler`) with the host's clock
and starts it; `close()` stops it and waits for the running step. `options.host.development` (new: true with
`NOOBLY_DEV_LOGIN`) is the only thing that allows unsandboxed commands; in production the flag is never set and the
factory refuses, as it does today. The demo repo's gates (`npm test`) run on this machine that way.

## From a handoff to a run

```
nooblyjs-ai-workflows  handoff.created { handoffId, itemId, workItemIds }
  → factory intake (host.events.on)
      for each work item (host.service('workflows').workItems(handoffId)):
        repo = repos.yaml[workItem.repo]            missing → intake.waiting { workItemId, reason }; nothing starts
        script = scripts/<slug of the title>.json   none, and no model → intake.waiting; nothing starts
        attributes = host.service('product').gatesFor(itemId)
        submitJob(store, { issue, repo, agent: { script }, nooblyjs-ai-host: { itemId, workItemId, handoffId, attributes } },
                  { key: `handoff:${handoffId}:${workItem.id}` })      the key makes a redelivery a no-op
```

- The run row gains `nooblyjs-ai-host` (item, work item, handoff, spec version), so `runsForItem(itemId)` and the events
  passed to the host carry the NooblyJS item id, not the factory's own.
- **Gates.** `attributes.js` takes the rows `{ attribute, scenario, target, verifiedBy }` and the repo's declared
  gates. Where `verifiedBy` names a declared gate, that gate's result is the attribute's. Anything else goes on the
  PR's evidence as "not checked by a gate". The repo's gates all run, as they always do; nothing from an
  attribute is executed as text.
- **Events to the host**, each with `itemId`, `system: 'factory'`, the run and a summary: `run.started`,
  `run.finished` (with the outcome and cost), `pr.opened` (with the gate results), `gate.failed`, `run.asked`,
  `run.answered`. Activity and the item's timeline show them; cost is counted once, on `run.finished`.
- **The PR file** is the local forge's (`data/factory/forge/…`), with the evidence bundle the factory already
  builds, plus the source spec and the attributes that no gate checked.

## A run asks a developer

- `services.questionsFor(person)` returns the open inbox entries a person with `draft` may answer, with the NooblyJS
  item each run is for. `services.runsFor(person)` returns the runs in flight.
  The Developer home's "Runs asking you" panel shows them with the question, the run and **Answer**.
- Answering goes to the factory's own `POST /factory/api/v1/inbox/:id` (it already needs a permission and is
  audited). Its permission becomes `draft` for a question, and stays `approve` for an approval gate.
- When a run parks, the factory emits `run.asked`. NooblyJS listens for it and adds a line to the item's thread
  with `chat.relay()`, as the system. The factory never writes to a thread itself.

## Agents never merge

`register()` passes `hosted: true` into the run context. `merge.js` returns "a person merges" for every hosted
run before it looks at autonomy, and records `merge.refused`, which the host audits. A line whose `merge`
station is set to act (`"when": "always"` or autonomy L3 in config) is refused at `submitJob` when hosted, with
the reason. The CLI outside NooblyJS keeps its behaviour.

## The screens

The pages already load in the frame and use the kit's tokens. Each moves to the kit's components where one
exists (`pageHead`, `statCard`, `dataTable`, `statusPill`, `chips`, `notice`, `meter`, `timelineRow`), keeping
`parts.js` only for what the kit lacks (the station strip, the inbox card). Metrics gets its empty state.

## What does not change

- The line engine, the stations other than `merge`, the gates runner, the scope guard, the secret scan.
- The factory's CLI and its own dashboard page (`factory dashboard`).
- How NooblyJS approves the handoff.

## Risks

- **The store swap touches everything the factory does.** Its own suite (the F05 store tests, the scheduler and
  recovery tests) is the safety net: it must pass on the file store before any integration work starts.
- **A blocking store in the NooblyJS process.** Appends are synchronous file writes, and a replay at start reads the
  whole log. Fine at this size; a snapshot of the projections is the next step if start-up gets slow.
- **Running repo commands in the NooblyJS process** in development. They run in the run's own worktree, never in
  NooblyJS's folder, and only for mapped repos.
- **Two things called "item".** The factory's item is an issue; NooblyJS's is a lifecycle item. The run carries both.
