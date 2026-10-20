# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Since 2026-10-19 this package is the whole Software Factory app in NooblyJS**, at `/factory`, with two parts: the
**Product section** (`product/`, pages in `public/product/`: signals → ideas → specs → architecture → UX → UI →
handoff; it was `nooblyjs-ai-product`) and the **line** (everything below: issues in, verified PRs out). The section
keeps its own code, tests and docs, with its own `CLAUDE.md`; how it sits in the Factory is `src/services/sections.js`
and `public/js/sections.js` (below, "Sections"). The factory is Product, Design, Build and Test: Quality joins as the
**Test** section in Phase 20 (decided 2026-10-20; root `roadmap.md`), built the same way as Product. Infrastructure was
a section here from 2026-10-19 to 2026-10-20 and is the hosted app `../nooblyjs-ai-infrastructure` again (CHG-007).

`factory` is an agentic software factory built on top of the `noobly` harness (`../nooblyjs-ai-harness`, linked as a `file:` dependency, so it must be checked out next to this repo). Shared AI building blocks (cost, tokens, frontmatter, SSE) come from the AI module `nooblyjs-ai-common`, which lives inside `nooblyjs-core` (`../../nooblyjs-core/src/aiservice/common`) and is linked the same way. Issues go in; verified PRs come out. It's a learning project built one concept per phase (F00–F25). Each phase has a plain-language doc in `.claude/docs/` explaining what it adds and why. `.claude/docs/reference.md` lists every command, config key, repo file, env var, station, status, event and endpoint. The plan lives in `.claude/steering/` (PRD, Architecture, Roadmap). Architecture §20 and PRD §16 describe what was actually built.

## Part of NooblyJS (read first)

This repo is hosted by **NooblyJS** (`../nooblyjs-ai-host`) at `/factory`. Before changing how it starts, serves
pages, signs people in, stores data, emits events or calls models, read
`.claude/steering/nooblyjs-ai.md` (the shared rules, imported below: noobly owns them, and the full contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a), `.claude/steering/tech.md` (this repo's values and how it differs) and
`.claude/steering/structure.md` (this repo's layout as a hosted app). The source of truth is
`../nooblyjs-ai-host/.claude/steering/structure.md` §2a. Where anything below conflicts with those, they win.

@.claude/steering/nooblyjs-ai.md

## Commands

```bash
npm install                                   # links ../nooblyjs-ai-harness and nooblyjs-ai-common (../../nooblyjs-core/src/aiservice/common)
npm test                                      # all tests: the line's, then the Product section's (product/test), offline
node --test test/services/line/line.test.js   # one test file
node --test --test-name-pattern="<regex>" test/services/line/line.test.js   # one test
npm run check:examples                        # run every documented example (examples/examples.txt) against a fresh demo repo
node bin/factory.js --help                    # the CLI (also `npm start`)
```

There is no build step and no linter. Type checking comes from `// @ts-check` plus JSDoc.

Offline end-to-end run with a scripted agent (no API key needed):
```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-slow.json --autonomy L2 --allow-unsandboxed
```
Without bubblewrap (Linux) or `FACTORY_CONTAINER_IMAGE`, the factory refuses to run unsandboxed commands unless you pass `--allow-unsandboxed`.

One known flaky test: F05's multi-process database test fails about one full run in four. The F24 doc describes it.

## Architecture

- **The harness is the worker; the factory is the control plane.** Each agent step is a `noobly` session (in-process or subprocess driver, `src/services/exec/harness/`) running in its own git worktree with a per-step sandboxed harness home (`src/services/exec/workspace/`). The factory commits, pushes and decides. Agents never push and never see the factory's secrets (`src/services/security/agent-env.js`).
- **The event log is the only source of truth** (`src/models/store/`). Every state change is appended as an event to daily YAML streams (`$FACTORY_HOME/events/YYYY/MM/<day>.yaml`, default `~/.factory`; one event a line, `events/HEAD`, and a lock folder so several processes can append: `src/models/store/files.js`). There is no database. Tables are in-memory projections derived from the log (`projections.js`), rebuilt at start, and `factory db rebuild` replays them. Leases are in `leases.yaml` (`store.leases()`). The dashboard, metrics, audit, notifications, retries and the learning loop all read from this log. Events can carry an idempotency `key`, and outside-world effects go through `performEffect` (`effects.js`).
- **Lines are data** (`lines/*.json`): an ordered list of stations, each with a `kind`, an optional `when` condition (`src/services/line/conditions.js`) and `retries`. `src/services/line/engine.js` `decide(run, line)` is a pure function from the run's projected state to the next action. `executor.js` performs that action, records events, and asks again, so crash recovery just means calling `decide()` again. Station implementations live in `src/services/line/stations/`. In the engine's terms, a station that *throws* has failed and gets retried, while a station that returns a stop result (e.g. triage says the issue is unclear) is done.
- **Stations build agents with `agentFor`** (`src/services/line/stations/common.js`), which applies roles (`src/roles/builtin/*.md`, overridable per repo and by the operator), model tiers, cost-aware routing (F22) and factory MCP tools (F16). Stations that change code run agents through `stepRunnerFor`, which lets them run on remote workers (F23). The core step is `src/services/exec/step-runner.js`: acquire workspace → cached setup → agent (with Stop hook) → gates → release.
- **Deterministic checks decide.** The repo's gates (`.factory/config.json`), the scope guard, the test-tampering check (`src/services/review/tampering.js`) and the secret scan decide whether a PR is ready or draft. Model reviewers can add findings, but a model's verdict never passes a gate.
- **Hosted in NooblyJS (F26).** `register()` (`src/services/hosted.js`, exported from the root `index.js`) mounts the same API route table on the host's Express through `toExpressRouter` (`src/services/to-express.js`) at `/factory/api/v1`, behind the host's sign-in, permissions (`PERMISSIONS`: every write must name one) and audit. The pages are a UI module for NooblyJS's frame: `public/js/module.js`, `lib.js`, `parts.js`, `pages/`, and `public/css/factory.css` (every selector under `[data-module="factory"]`). `public/dashboard/` is still what `factory dashboard` serves. Hosted, the log lives in the `dataDir` NooblyJS passes (`../nooblyjs-ai-host/data/factory/`). **NooblyJS Phase 7:** hosted, the scheduler runs inside the NooblyJS process (`register()` starts it, `close()` stops it); `handoff.created` becomes issues and queued runs (`src/services/intake/handoff.js`, repositories from `repos.yaml`, `src/config/repos-map.js`); a run carries what it is for in NooblyJS (`request.noobly`) and its PR evidence shows the item's quality attributes against the repository's gates (`intake/attributes.js`: by gate name only, nothing from a row is run); `FACTORY_HOSTED=noobly` makes the merge station refuse; answering an escalation sends the run back to repair; `seed()` writes a demo repository and scripted agents (`intake/demo-repo.js`, `examples/noobly/`). The page head, pills, stat tiles and notices on the pages are the NooblyJS UI kit's components (`kit()` in `public/js/lib.js`).
- `src/routes/cli.js` maps command names to `src/controllers/cli/*.js`. `src/services/forge/` is the PR target: a local forge under `$FACTORY_HOME/forge/` or GitHub. The HTTP side is split the same way: route tables in `src/routes/` (`api.js`, `workers.js`, `webhooks.js`, and `http.js`, the router), handlers in `src/controllers/`, token, body and static-file handling in `src/middleware/`. SSE is `src/services/sse.js`, and the dashboard page is `public/dashboard/`.

### Sections (2026-10-19)

- **Server.** `register()` (`src/services/hosted.js`) first calls `mountSections()` (`src/services/sections.js`), which
  calls each section's own `register()` (`product/index.js`) at `/factory/<section>` (`/factory/product`), with the
  Factory's host and a store of its own (`data/factory/<section>/`). Sections mount
  **before** the Factory's router, whose page fallback would otherwise answer their URLs. A new section folder is
  seeded at once. `FACTORY_SECTIONS` (comma-separated keys) leaves a section out; `register({ sections: [] })` mounts
  none (tests of the line alone).
- **What NooblyJS sees.** One app: the sidebar is the Product rows (keys `product-…`), then the Factory's own (group
  Build); the status card has a line per section and their badges under prefixed keys; the sections' stylesheets load
  with `css/factory.css`; and `provides: { product }` keeps `host.service('product')` working for every other app.
- **Browser.** `public/js/module.js` adds each section's route table (imported from `../product/js/module.js`, the URL it
  is served at) through `public/js/sections.js`, which moves the routes under the section's path, prefixes their nav
  keys, and gives each page a `ctx` bound to the section (`ctx.api` at `/factory/<section>/api/v1`, links and
  `navigate()` under `/factory/<section>`). The page draws inside `<div data-module="<section>">`, so the section's
  stylesheet, scoped as it always was, still applies. `test/sections.test.js` checks the server and browser tables agree.
- **A section's own rules** (its permissions, its approvals, its events and their `system: 'product'`) did not change.
  Its tests mount it on its own, at `/product`, on its own fixture host.

### Layout

`src/` holds only `config/ controllers/ middleware/ models/ roles/ routes/ services/ utils/`, the same folders as `nooblyjs-ai-teammate`. The sections are not in `src/`: each keeps its own layout in `product/` (`src/`, `test/`, `docs/`, `.claude/steering/`), and its browser files in `public/product/`. `test/` mirrors it (`test/services/line/fanout.test.js` tests `src/services/line/`). `test/structure.test.js` fails if a new top-level folder appears in either.

| Folder | What goes there |
| --- | --- |
| `config/` | reading settings: the operator's `~/.factory/config.json`, the repo's `.factory/config.json`, harness settings |
| `controllers/` | request handlers: the dashboard API, the worker API, GitHub webhooks, and `cli/` (one file per `factory` command) |
| `middleware/` | what runs before a handler: tokens, size-capped bodies, static files |
| `models/` | the event store (`store/`) and the data shapes read from it or from files: line, spec, issue, findings, inbox, workers |
| `roles/` | the built-in roles and their loader |
| `routes/` | route tables: which URL or command reaches which controller |
| `services/` | everything else the factory does: the line, stations, exec, scheduler, forge, review, knowledge, MCP… |
| `utils/` | small helpers with no factory knowledge: clock, ids, paths, log, glob, frontmatter |

The library's exports are in the root `index.js` (`"main"`).

## Conventions

- Node ≥ 24, ES modules, `// @ts-check` + JSDoc types.
- **Core code uses Node built-ins only.** In `src/`, the harness is the only dependency (`sections.js` also uses `nooblyjs-core`'s `FsStore`, which the sections brought with `js-yaml`). Adding a new dependency requires a line in Architecture §17.
- **Import the harness only through `src/services/harness.js`**, and never copy harness code. Deep imports of harness internals are listed there.
- Each file holds one concept and opens with a comment naming the phase that added it and explaining the idea in plain words. Keep modules under ~300 lines.
- Anything that depends on time or randomness takes a `clock` (`src/utils/clock.js`) so tests never wait.
- A new event type needs a line in `describe()` (`src/controllers/cli/history.js`) and in the event list in `reference.md`.
- Nothing is pushed without the secret scan. New secrets go in environment variables that config names, never in files.

## Tests

- `npm test` must pass **offline**, with no network and no API key. Use the harness mock provider (`createMockProvider`), a scripted provider, a fake `noobly` (`FACTORY_NOOBLY_BIN`) or the fake GitHub (`test/fixtures/fake-github.js`).
- Tests that touch files use a temporary `FACTORY_HOME` / `NOOBLY_HOME` (see `testEnv()` and `makeRepo()` in `test/helpers.js`), never the real `~/.factory`.
- `test/redteam.test.js` lists things that must never be delivered. A change that lets one of them through is a security bug.

## Phase workflow

Work on a branch `phase-FNN-<slug>`, add `.claude/docs/FNN-<topic>.md` (template: `.claude/docs/_template.md`), merge to `main`, and tag `phase-FNN`. Then update the docs index (`.claude/docs/README.md`), the README phase table, the Roadmap status, and `reference.md` for any new command, config key, file, event or endpoint.
