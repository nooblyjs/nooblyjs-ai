# Phase 7 — Software Factory integration: summary

**Status:** approved 2026-10-10, with the real-model run and the decisions below still open. Spec: `.claude/specs/phase-07-software-factory/`
(requirements, design, tasks: all 13 worked through; the live run in task 12 ran but did not reach a PR, see below). Work is in three repos: `nooblyjs-ai-factory`, `nooblyjs-ai-host` and
`nooblyjs-ai-workflows` (one new service), plus one steering line each in `nooblyjs-ai-teammate`, `nooblyjs-ai-product` and
`nooblyjs-ai-knowledge`. **Nothing is committed yet** in any of them (Phase 6 is not committed either).

To see it, run `npm run seed -- --reset` (it wipes `data/`) and `npm start`, then follow the five steps below.
With `AI_PROVIDER=mock` in `.env`, the two demo work items are built by the seed's scripted agents; the git
work, the test gate and the PR files are real.

## What is there

| Area | What |
| --- | --- |
| The Factory's log is files | SQLite is gone, for the CLI as well as hosted. Events are daily YAML streams under `data/factory/events/YYYY/MM/<day>.yaml`, one event a line, with a lock folder so several processes can append. Projections are in memory, rebuilt at start. An old `factory.db` is ignored, with a warning |
| The scheduler runs in NooblyJS | `register()` starts the same loop `factory serve` runs, and `close()` stops it. `npm start` is all it takes. Leases and heartbeats use the machine's clock, not the dev clock |
| A handoff becomes runs | `handoff.created` → one issue file and one queued run per work item, once, however often the event arrives. Only repositories named in `data/factory/repos.yaml` can get runs. A work item with no repository, or with neither a script nor a model, waits, and the item's page says why |
| Seed | A demo `web-storefront` repository (a few functions, real tests, one gate: `node --test`), `repos.yaml`, and scripted agents for PRD-028's two web work items. One builds cleanly. The other has a bug its first repair doesn't fix |
| Runs report to the item | `run.started`, `run.finished`, `pr.opened`, `gate.failed`, `run.asked`, `run.answered`, `run.waiting` and `merge.refused` reach NooblyJS's events with the item's id. The item page has a **Software Factory** card (runs, status, gate results, PR, cost, what is waiting); Activity shows them under Factory |
| A stuck run asks | The Developer home has **Runs on your repos** and **A run is asking you**, with the question, a box and **Send answer**. The item's thread gets a line. Answering an escalation sends the run back to repair with the person's words |
| Who may answer | A question or an escalation takes `draft` (Contributor and up). An approval or a policy change in the inbox still takes `approve`. An agent is refused whatever it holds. Refusals are audited |
| No agent merges | Hosted, the merge station refuses whatever the line or autonomy level says. A configured agent merge (`autonomy: L3` in the Factory's config) is refused when the run is queued, and the refusal is in NooblyJS's audit log with the item |
| Quality attributes on the PR | The PR's evidence has a **From NooblyJS** section: the item, the work item, and each quality attribute against the repository's gates. A row counts as checked only when its "verified by" names a gate the repository declares. The rest are listed as "not checked by a gate". Nothing in a row is ever run |
| Factory pages | The page head, status pills, number tiles and empty states on Line, Runs, Run, Inbox, Campaigns and Metrics are the UI kit's components. Metrics has an empty state |

## Test script result (roadmap Phase 7)

Run on 2026-10-10 through the real apps (`test/software-factory.test.js`) and in a real browser
(`test/e2e/software-factory.story.js`, with axe on every Factory page it lands on), on scripted agents.

| Step | Result |
| --- | --- |
| 1. Hand off a small item to the demo repo. Runs appear on the Line and on Priya's home | PASS, on **PRD-028**: Stevie approves the waiting handoff; two runs are queued on `web-storefront`, and four work items wait for a repository |
| 2. A run finishes and a PR file appears with its evidence, gates, cost and source spec | PASS: "SlotChip, HoldTimer" ends **PR ready**, `test passed`. The source spec is a summary in the issue and a pointer in the PR, not the spec text (see decision 5) |
| 3. Force a gate to fail twice. The run asks Priya. She answers on her home and the run continues | PASS: the gate fails, one repair changes nothing, the run asks. Priya answers on her home, the run is repaired and ends **PR ready**. A Viewer's answer is refused (403) |
| 4. Try to configure an agent merge. It's refused and audited | PASS through the API test (`autonomy: L3` in `data/factory/config.json`): `merge.refused` in the audit log, for PRD-028. Not driven from a screen: there is no screen for the Factory's config |
| 5. Factory Metrics shows the runs, the median times and the cost. The empty state shows on a fresh reset | PASS: empty state before, then 2 runs, lead time to PR, per-station medians and cost |

**With a real model: not passed.** `npm run test:live:factory` ran once on 2026-10-10 with the "SlotChip,
HoldTimer" script removed. The run reached the model (`claude-haiku-4-5`, the triager, $0.025), and triage
judged the work item **unclear**: the run ended "Needs information" with four questions written on the issue
file, and nothing was built. That is the Factory working as designed on a work item that is only a repository
and a two-word title, but it means steps 2 and 3 have **not** been seen end to end with a real model. Two
things follow, and both need your call:

- **A work item needs more than a title for a model to build it.** The handoff carries `{ repo, title }`; the
  issue adds the spec's title and problem statement when the Product Factory has them (it has none for PRD-028).
- **Triage's questions do not reach a person in NooblyJS.** They are a comment on the issue file. The item's card
  shows "Needs information", but nothing appears under "A run is asking you", and there is no way to answer
  from NooblyJS. Only a parked run or an escalation asks there today.

Tests: `nooblyjs-ai-host` 143 of 143 · `nooblyjs-ai-workflows` 24 of 24 · `nooblyjs-ai-product` 140 of 140 · `npm run test:e2e`: 37 specs,
the 8-test Phase 5 story and the 6-test Software Factory story, with 0 WCAG AA violations on the screens they
land on. `nooblyjs-ai-factory`: 334 of 362 on the last full run, with 27 failures: the 25 standing ones (see "Things to know")
and two timing tests that failed while other suites were running on the machine and pass when run alone.

## Hosted-app checklist for `nooblyjs-ai-factory`

| Step | Result |
| --- | --- |
| 1, 2, 4, 5, 7, 11 | PASS (`test/factory.test.js`; the Factory's own `test/register.test.js` and `test/module.test.js`) |
| 3 | PASS in the browser story: from Home, the rail opens the Line with no reload. I did not check the open chat thread surviving the switch for the Factory specifically; `shell.spec.js` checks that for the frame |
| 6 | PASS by reading the code: it logs through the host's `serverManager.logger`. Not checked on `/services/` by eye |
| 8 | PASS: the e2e specs run with it disabled; NooblyJS starts, the rail lists it, and the Developer home says the Factory is not running here |
| 9, 10 | PASS for the loader, with the throwing fixtures (`shell.spec.js`), as in earlier phases. The Factory's own failed start leaves nothing mounted (its `register.test.js`) |
| 12 | The Factory keeps its CLI (`factory serve`, `factory dashboard`), which still runs standalone on the file log |

## Decisions that need your confirmation

1. **The test script runs on PRD-028, not a new small item.** Its handoff is already waiting on the Design lead in
   the seed, so no seeded numbers on Home change. The demo repository stands in for `web-storefront`.
2. **Answering an escalation sends the run back to repair**, with the answer as the instruction to the fixer.
3. **A Contributor may answer a stuck run's question; approvals in the Factory inbox still need an Approver.**
4. **Unsandboxed gate commands no longer inherit the process's environment** (secrets). This is a change to
   the Factory's core, not only the hosted path.
5. **"Source spec" on the PR is a pointer, not the text.** The issue carries the spec's title and problem
   statement; the PR names the item and says the spec is the item's, in NooblyJS.
6. **A quality attribute matches a gate by exact name only** ("test", "gate: test", "test gate"). "Load test in
   staging" is not the gate "test". With today's seed, PRD-028 has no quality attributes and the demo
   repository declares one gate, so every real row will read "not checked by a gate" until repositories
   declare more gates.
7. **Until repositories have owners (Phase 9), every Developer sees every run** `[PLACEHOLDER]`.
8. **Scripts are matched by work-item title.** PRD-031's handoff has the same two web titles as PRD-028's, so
   with the Factory on, sending PRD-031 to the Software Factory also starts two scripted runs.

## Not built, or left for later phases

- **"Standards broken on PRs" on the Architect home still says "Arrives in Phase 7".** It was not in this
  phase's spec, and who runs that check (a Factory gate or a review station) is still an open `[CONFIRM]` in
  the Factory's steering. It needs a decision and a phase.
- **Buttons, tables, cards, the station strip, the run page's stepper and terminal** are still the Factory's
  own, inside `.fx-root`. Only the four component kinds above moved to the kit.
- **Separate workers.** Runs execute inside the NooblyJS process, three at a time by default. A long run uses the
  web process's CPU.
- **A real sandbox.** Hosted runs execute the repository's gates unsandboxed, in development only. In
  production the Factory refuses, as before, until a sandbox is configured.
- **GitHub.** PRs are files in the local forge (`data/factory/forge/`). A sandbox GitHub repo and webhooks wait
  for Phase 12.
- **A person's merge.** Nothing merges yet, by an agent or by a person from NooblyJS; both PRs stay ready.
- **The four work items with no repository** (`slots-api` ×2, `mobile-app`, `design-system`) wait until someone
  adds those names to `repos.yaml`; they are retried at the next start.
- **Bedrock, Vertex and Azure adapters** for the Factory's agents (as for Teammates).

## Things to know

- **The Factory's full suite has 25 failures on this Windows machine, before and after this phase**: the same
  25 tests on the last commit and on the file store. They are not from this phase and I did not fix them.
  Its `CLAUDE.md` documented one flaky test, not 25.
- **Scripted runs still show model names** ("Haiku 4.5", "Sonnet 5.5") on the Line and the run page, because the
  role's model route is recorded even when a script answers. Costs shown for them are fractions of a cent.
- **`npm run test:e2e` takes about four minutes longer**, because the Factory story waits for real runs. It has
  its own config and its own fresh NooblyJS (`test/e2e/playwright.factory.config.js`).
- **Two new members on `host`**: `development` (true only with the dev sign-in) and `logLevel` (from Phase 6).
  The child repos' steering lists them.
- **Carried from Phase 6, still open:** the Design and UI agents are not hired in Teammates; `.env` sets
  `NODE_TLS_REJECT_UNAUTHORIZED=0`; the older steering drift report.

## Guide points for your review

- Is the PR evidence enough for a reviewer?
- What should a stuck run ask? Today it shows the failing gate's output and what the fixer tried.
