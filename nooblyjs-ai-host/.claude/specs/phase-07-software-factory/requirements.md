# Phase 7 — Software Factory integration: requirements

> **Status: done, approved 2026-10-10 (the real-model run to a PR and the decisions in the summary are still open).** Summary: `docs/phases/phase-07-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

> Source: `.claude/steering/roadmap.md` Phase 7. Goal: a handoff produces Factory runs and PRs, gates use the
> item's quality attributes, and stuck runs ask a developer. Repos: `nooblyjs-ai-factory` (the store, the scheduler
> when hosted, the handoff intake, gates, the pages), `nooblyjs-ai-host` (the Developer home, the item's thread and page, the
> demo repo), `nooblyjs-ai-workflows` and `nooblyjs-ai-product` (what the handoff carries).
>
> This one spec covers all the repos. Each task in `tasks.md` names its repo. The factory's own design (stations,
> the line engine, gates, the forge) is in its `CLAUDE.md` and `.claude/docs/`, and stays as it is.

## Where the phase starts

The Factory is already hosted in the frame at `/factory` (done early): `register()`, its rail item, nav, status
card, a UI module with Line, Runs, Inbox, Campaigns and Metrics pages, its API behind NooblyJS's sign-in,
permissions and audit, and `services.status()` and `runsForItem()`.

Not there yet:

- Its event log is SQLite (`data/factory/factory.db`), which the stack rules forbid.
- Hosted, nothing works the queue: a separate `factory serve` process has to. NooblyJS only reads the log.
- A handoff creates work items as files (`data/workflows/handoffs/…`) and the item moves to Build, where it waits.
  Nothing turns a work item into a run.
- Gates come only from the repo's `.factory/config.json`. An item's quality attributes are shown on Home but
  gate nothing.
- A run's question reaches only the Factory's own Inbox page.
- The `merge` station can still merge at autonomy L3.

## Decisions taken before starting

Answered by Stevie on 2026-10-10 unless marked.

| Question | Answer |
| --- | --- |
| Which repository runs work on (the roadmap's *Before you start*) | **A local demo repo**, created by the factory's seed under `data/factory/repos/` (in Node: the factory's `make-demo-repo.sh` is bash only). PRs go to the factory's local forge, as files. A sandbox GitHub repo waits for Phase 12 |
| Which item is handed off in the test script | **PRD-028 · Slot picker screens**, the handoff already waiting on the Design lead in the seed (six work items, four repos). The demo repo stands in for **`web-storefront`**, so two of its work items become runs and four wait for a repository. No item is added to the seed, so the Home numbers the mockups show stay as they are `[CONFIRM]` |
| When the event log moves off SQLite | **First.** A daily-YAML-stream store goes behind `openStore()` before anything else is built |
| Where runs execute | **Inside the NooblyJS process**: the scheduler starts with `register()`. Separate workers come later (`tech.md` §6) |
| Sandboxing on a machine with no bubblewrap or container image | **Unsandboxed in development only**: allowed with `NOOBLY_DEV_LOGIN=true`, refused when `NODE_ENV=production` |
| What the agent is, offline | The factory's **scripted agent**. `data/factory/scripts/<work item title>.json` is the script for that work item; the seed has one that delivers ("SlotChip, HoldTimer") and one whose gate keeps failing ("picker, nearby, basket"). A work item with no script and no model configured waits, and says so. With `AI_PROVIDER=anthropic` the run uses a model (the roadmap's "once with a real model") `[CONFIRM]` |
| Which repo a work item goes to | `data/factory/repos.yaml` maps a work item's `repo` name to a folder. Only `web-storefront` is mapped (to the demo repo); an item for an unmapped repo stays "waiting for a repository" and says so `[PLACEHOLDER]` |
| How a quality attribute becomes a gate | An attribute row is `{ attribute, scenario, target, verifiedBy }`. Where `verifiedBy` names a gate the repo declares in `.factory/config.json` ("test", "contract"), that gate is the attribute's check, and its result is shown against the attribute. Otherwise the attribute is listed on the PR as "not checked by a gate". No attribute's text is ever run as a command `[CONFIRM]` |
| Who answers a run's question | Anyone with `draft`, in the Factory Inbox or on their Developer home. Until repositories have owners (Platform, Phase 9), a Developer's "your repos" is every mapped repo `[PLACEHOLDER]`. Agents can't answer |
| Merging | Refused for every hosted run, at any autonomy level. The refusal is audited. A person merges |

## Requirements

### R1 — The event log is files
1. The factory's store SHALL keep every event in append-only daily YAML streams under its data folder, and
   SHALL not open a SQLite database. Projections SHALL be derived from the log, as they are now.
2. `openStore()` SHALL keep its interface (append with idempotency keys, transactions, read, get, list,
   subscribe, rebuild), so the stations, the scheduler and the pages don't change.
3. Leases SHALL still stop two workers executing one run, and SHALL expire.
4. An existing `factory.db` SHALL be left alone and reported at start; it is not migrated `[CONFIRM]`.

### R2 — Runs execute in NooblyJS
1. Hosted, the scheduler SHALL start with the app and stop with it, on the host's clock.
2. Unsandboxed commands SHALL be refused unless the host says development; in production they are refused.
3. The kill switch, budgets and concurrency limits SHALL apply as they do under `factory serve`.

### R3 — A handoff becomes runs
1. On `handoff.created`, each work item whose repo is mapped SHALL become one factory issue and one queued run,
   once, however often the event is delivered. The run SHALL carry the NooblyJS item, the work item and the spec.
2. A work item for an unmapped repo SHALL be recorded as waiting, with the reason, and SHALL start nothing.
3. The item's quality attributes SHALL become the run's gates as decided above.
4. Runs, PRs and gate results SHALL report back to the item: events with the item id (Activity, Lifecycle), and
   the item's page SHALL list its runs with status, gates, PR and cost.
5. A finished run's PR SHALL be a file with its evidence, gates, cost and the source spec.

### R4 — A stuck run asks a developer
1. A run that parks on a question SHALL show on the Developer home of the people who can answer it, and as a
   line in the item's thread.
2. Answering SHALL need `draft`, SHALL be a person's action (an agent is refused), and SHALL let the run continue.

### R5 — Agents never merge
1. A hosted run SHALL never merge, whatever its line or autonomy says. An attempt to configure one SHALL be
   refused and audited. There is a test that proves it.

### R6 — The screens
1. Line, Runs, Inbox, Campaigns and Metrics SHALL use the UI kit's components and pass axe.
2. Factory **Metrics** SHALL show the runs, the median times and the cost, and an empty state on a fresh reset.

### R7 — Hosting
1. `nooblyjs-ai-factory` SHALL pass the hosted-app checklist, including a deep link to `/factory/runs/<id>`.

## Done when
Steps 1–5 of the Phase 7 test script pass offline (scripted agent), and once with a real model, and
`nooblyjs-ai-factory` passes the hosted-app checklist.
