# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Migration status (2026-10-18)

This host and its five hosted apps were brought into this monorepo together (`.claude/steering/migration-plan.md`
in the monorepo root), all enabled in `src/seed/data/config/hosted-apps.yaml`. The sample organisation is the
fictional **Acme Retail** (repositories `acme/<repo>`, the wiki's `Acme Space`).

## Current state

This repo is the **host app for NooblyJS**, an engineering-lifecycle platform: idea → spec →
architecture → design → build → ship, where AI agents draft and people decide. **Phases 0
(Foundations), 1 (Shell and design system), 2 (Lifecycle core), 3 (People, onboarding and "For
you" homes), 4 (Team chat), 5 (Product Factory, the hosted app `nooblyjs-ai-product`), 6 (Digital Teammates
everywhere, and the Teams simulator), 7 (Software Factory integration), 8 (Knowledge
Repository), 9 (Platform and governance), 9a (Infrastructure joins NooblyJS), 10 (Metrics) and 11 (Development tools:
Bitbucket and Jira, read-only) are done** (`.claude/phases/phase-0N-summary.md`; Phase 11: `src/services/devtools/`,
tech.md §8a). **Phase 16a (nine stages: Verify, Release and Operate replace Ship) is built and waiting for review**
(`.claude/specs/phase-16a-nine-stages/`), and so is **Phase 16b (lifecycle v3: eight stages, Discover · Product · Design ·
Engineer · Build · Test · Release · Operate; approvals given on someone's behalf; the Factory's five sidebar groups)**
(`.claude/specs/phase-16b-product-design-build/`; the root roadmap `../.claude/steering/roadmap.md` holds every phase). **Phase 16c (the
Design section: business requirements, solution architecture, functional analysis and stories, each story a lifecycle
item of its own with its own Design handoff) is built and waiting for review** (`.claude/specs/phase-16c-design-section/`;
the section is `../nooblyjs-ai-factory/design/`, `host.service('design')`; stories in `src/lifecycle/services/engine.js`). **Phase 16d (Engineering:
each story's application architecture drawn from the code, its test analysis in the Factory's new Test section, and the
Engineering sign-off's checks) is built and waiting for review** (`.claude/specs/phase-16d-engineering/`; the Factory's
`src/services/engineering/` and `../nooblyjs-ai-factory/quality/`, `host.service('quality')`). **Phase 16e (Build and
Test: each pull request the Factory delivers for a story is a lifecycle item with its Build and Test approvals, its
evidence listing the required tests by test case id; changes asked for are repaired by the line; a new commit clears
both approvals; a person merges after both; a story passes Test with its last merge and a feature goes to Release on its
own) is built and waiting for review** (`.claude/specs/phase-16e-build-and-test/`; `src/lifecycle/services/pull-requests.js`
and the Factory's `src/services/pull-requests/`). **Phase 12, Microsoft 365 (SSO, notifications, the real Teams bot), is built and reviewed (2026-10-20)**
(`.claude/specs/phase-12-microsoft-365/`, tech.md §7.3; the Teams app project is `apps/msteams/noobly-bot`). Source control is **Bitbucket**, not
GitHub. **Jira and Bitbucket are production systems.** NooblyJS reads them (Phase 11) and, since **Phase 13 (built, reviewed
2026-10-20)**, writes to them only through the write gate (`src/services/devtools/writes.js`, tech.md §8a): nothing is sent
unless `DEVTOOLS_WRITES=true`, an Owner switched that system to Send, and a write token is set; otherwise it is
recorded in the outbox. There is no write that merges or deletes, and **tests never write: use
`test/fixtures/atlassian.js`, never a real fetch**. Phase 13 also added backup and restore (`npm run backup`,
`npm run restore`), `npm run perf`, `.claude/runbooks/` and `.claude/audits/`. NooblyJS
boots, signs you in (dev picker, local, Entra or Google, creating a person record on first sign-in), and
serves one frame from the nooblyjs-core UI kit (`nooblyjs-core/public/ui/`, at `/ui/`). Home, Platform and
Dev are built-in app modules (`src/built-in-apps.js`, `public/js/modules/`). Home's **Overview,
Lifecycle, Approvals and Activity** are real (`public/js/pages/home/`, over the lifecycle engine at
`/workflows/api/v1`, `GET /api/v1/home/overview`, `GET /api/v1/activity` and the SSE stream
`GET /api/v1/events/stream`). **For you** (one layout per work role, `GET /api/v1/home/for-you`),
**Teams & roles** and first-login **onboarding** (`/onboarding`, `/api/v1/me/…`, copy in
`data/config/work-roles.yaml`) are real too; a person with no `profile.md` is redirected to onboarding.
**Team chat** is real: `src/services/chat.js` and `/api/v1/chat/…`, with the docked panel in the UI kit
(`/ui/js/chat.js`), shown wherever a page calls `ctx.chat.scope()`. **Every agent action is a teammate task**:
chat replies, Product Factory drafts and Teams answers call `host.service('teammates').runTask()`
(`src/services/agents.js`), which checks, bills and attributes them. With no model configured the task plays a
scripted answer (`data/chat/scripts.yaml`, `data/teams/scripts.yaml`); a reply can only append messages. The
**Teams bot** (`src/teams/`, `POST /api/teams/messages`) checks Microsoft's token and replies through the Bot
Connector; `/dev/teams` simulates it, and `TEAMS_BOT_DEV_UNSIGNED=true` lets the Agents Playground in (development).
The **Software Factory** (`nooblyjs-ai-factory`, at `/factory`) works its queue inside the NooblyJS process: an approved
handoff becomes runs on the repositories in `data/factory/repos.yaml` (the seed makes a demo `web-storefront`),
runs report to the item (`GET /api/v1/home/items/:id/runs`) and the Developer home, a stuck run asks a person with
`draft`, and a hosted run never merges. Its log is YAML files, not SQLite.
**Knowledge** is the Wiki Platform (`nooblyjs-ai-knowledge`) hosted at `/wiki`: the seed imports a sample export
(personal data redacted on the way in), its AI panel answers from cited sources even with no model configured,
an answer can be added to an item, saved or reported as wrong (`/wiki/datasources/needs-review`), a page with a
`process-model` block draws the enterprise process model, and other apps reach it as `host.service('knowledge')`.
**Platform** is real (`src/services/platform/`, `/api/v1/platform/…`, `public/js/pages/platform/`): repositories and
agent access, model routes, budgets with a spend ledger, guardrails, a simulated container runtime, secrets (references
only), members and the audit log. `host.service('platform').checkAgentWork()` runs before every agent action
(Teammates' `runTask`, Product drafts, Factory intake). **Infrastructure** (`nooblyjs-ai-infrastructure`, at
`/infrastructure`, rail label Infra) owns environments and previews: designs, provisioning runs (a mock provisioner),
drift and cloud cost. Its design approvals are `infra-design` approvals in the lifecycle engine, shown on Home ·
Approvals; it asks Platform's **cloud** budget before provisioning; Platform · Environments lists its environments.
Home's **Metrics** is real (`src/services/metrics/`, `GET /api/v1/home/metrics`, `public/js/pages/home/metrics.js`):
every number is computed from the event log (`facts.js` → `compute.js`), past days are regenerable roll-ups in
`data/metrics/rollups/`, and the seed writes a sample history of events (`sampleHistory: true`, hidden from Activity)
that gives the mockup's numbers. A new event type a metric should read goes in `facts.js`.
Business time comes from `src/services/clock.js` (`host.clock` for hosted apps), which `/dev/clock`
can move in development: never use `Date.now()` for targets or reminders. `/dev/styleguide` shows every
kit component. **Teammates (`nooblyjs-ai-teammate`) is hosted in the frame** at `/teammates`, as
the pattern for porting the other apps: follow `.claude/guides/porting-an-app.md` for Factory and Knowledge. `app.js` (repo root) is the composition root and entry point (`npm start`), and
`src/noobly.js` mounts NooblyJS itself. The other files in `src/utils/` (besides `createServer.js` and
`StructuredLogger.js`) are unused CommonJS leftovers.

The design lives in the Kiro steering docs. They are always loaded by Kiro and are the source of truth.
Read the relevant one before changing anything:

| File | Answers |
| --- | --- |
| `.claude/steering/product.md` | What NooblyJS does: systems, the 8-stage lifecycle, every screen, roles, governance rules |
| `.claude/steering/tech.md` | How it's built: stack, storage, API conventions, agents, Teams bot, config, commands |
| `.claude/steering/structure.md` | Where things live: sibling repos, the hosted-app `register()` contract, `public/`, `data/` |
| `../.claude/steering/roadmap.md` | **The one roadmap** (monorepo root): every phase, each with a manual test script, and a stop for review. The root's `product.md`, `design.md` and `stack.md` give the whole factory across the SDLC |
| `.claude/steering/brief/` | Design input (build brief + mockups). **Not in this repo**: the original brief was company material and stayed out of the migration (the migration plan, since removed from the monorepo root). |

When you change scope or architecture, update the steering doc that owns it. Keep the four docs
consistent with each other.

## Non-negotiable stack choices

These override the brief's TypeScript/React/Postgres suggestions:

- **Node.js + Express 5, ES modules, no build step.** The front end is **plain HTML, CSS and JS**
  (native ES modules). No React, JSX, TypeScript, bundlers or CSS frameworks.
- **Storage is files only:** Markdown with YAML front matter for entities, `.yaml` for config, and
  append-only daily YAML streams for events and audit, all under `data/` (gitignored). No SQLite,
  Mongo or Postgres. Use the FsStore pattern (atomic tmp+rename writes, per-path locks,
  path-segment validation) from `nooblyjs-ai-teammate/src/store/fs-store.js`, which is moving to `nooblyjs-core`.
- **Minimal dependencies:** `express`, `js-yaml`, plus sibling projects linked as `file:../<project>` (and `nooblyjs-core` as `file:../../nooblyjs-core`). The
  composition root `app.js` also uses `helmet`, `compression`, `express-rate-limit`, `express-session`
  and `passport` (tech.md §1).
- **Tests:** `node:test`, offline by default (mock AI provider). API tests use `createApp()` on port 0 and the built-in `fetch`.

## Architecture: one host, hosted apps

The projects live side by side in the `nooblyjs-ai` monorepo, with `nooblyjs-core` as a separate repo next to it. `nooblyjs-ai-host` is the single host process. It
initialises nooblyjs-core's `ServiceRegistry` (the **`serverManager`**) once, then loads each child listed in
`data/config/hosted-apps.yaml` by calling its `index.js` export `register(app, serverManager, options)`:

- `nooblyjs-ai-factory` → `/factory`, `nooblyjs-ai-teammate` → `/teammates`, `nooblyjs-ai-knowledge` → `/wiki` (it also
  answers to `host.service('knowledge')`).
  Each one serves a UI module (`public/js/module.js`, a route table) and its API under
  `<mountPath>/api/v1`, and returns its rail entry and nav as data from `register()`.
- `nooblyjs-ai-infrastructure` → `/infrastructure` (designs, environments, provisioning runs, drift, cloud cost).
- Since 2026-10-19 `nooblyjs-ai-factory` carries a **section**: Product (`/factory/product`, was `nooblyjs-ai-product`).
  One rail item; the Factory's `provides` keeps `host.service('product')`. Its data is `data/factory/product` (moved
  from `data/product` on the first start: `src/hosted-apps.js` `foldData`). Infrastructure was a section too from
  2026-10-19 to 2026-10-20; it is an app of its own again (CHG-007), and `foldData` moves an install's
  `data/factory/infrastructure` back to `data/infrastructure`.
- **The lifecycle engine is part of `nooblyjs-ai-host` itself** (`src/lifecycle/`: items, stages, approvals, handoffs). It was the
  hosted app `nooblyjs-ai-workflows` until 2026-10-10. `src/noobly.js` mounts it before any hosted app; it still answers at
  `/workflows/api/v1`, keeps its files in `data/workflows/`, and is `host.service('workflows')` to the children.
  Its own tests are in `test/lifecycle/`. The `../nooblyjs-ai-workflows` repo is retired.
- The Product Factory is the Factory's Product section (its own screens in the Factory's UI module, its API at
  `/factory/product/api/v1`: artefacts and drafting agents).
- `nooblyjs-core` (with its AI module `src/aiservice/common`, imported as `nooblyjs-ai-common`: model providers, cost) and
  `nooblyjs-ai-harness` (agent runtime) are libraries.
- `nooblyjs-ai-host` itself owns Home, the Product Factory screens, Platform, onboarding, team chat and the Teams bot endpoint.
- **nooblyjs-ai-host owns everything shared** (`structure.md` §1a): the product, the lifecycle, governance, the hosted-app
  contract (§2a), and the cross-app services (`tech.md` §8b). The one roadmap is in the monorepo root (`../.claude/steering/roadmap.md`). Child repos describe only themselves,
  and load the shared rules from `.claude/steering/nooblyjs-ai.md`, generated from `.claude/steering/nooblyjs-ai-shared-rules.md`:
  after changing that file run `npm run steering:sync` (`test/steering.test.js` fails on a stale copy).

Children must not call `serverManager.initialize()`, listen on a port when hosted, or write outside
their own `data/<mountPath>/` folder. The browser loads **one frame** (rail, sidebar, chat dock) from
the UI kit at `/ui/` (`nooblyjs-core/public/ui/`). Each app's module is loaded into the content area, so
switching apps never reloads the page. Children never draw the rail or sidebar, and their CSS is scoped
under `[data-module="<name>"]`. See `structure.md` §2a and `.claude/adr/ADR-001-host-owned-shell.md`.

Known pitfall: nooblyjs-core registers Express 4 route patterns that Express 5 rejects. So
`nooblyjs-ai-teammate` runs core's routes on a separate core-owned Express app
(`nooblyjs-ai-teammate/src/core/index.js`). The registry also binds to the first Express app it sees.

## Governance rules the code must enforce server-side

- Agents propose, people decide. Agents are capped at the Contributor access role and **never merge
  to main or approve anything**, including from chat or the Teams bot.
- Every write is audited, and every agent action records actor, item, system, model route and cost.
- Models only via AWS Bedrock / Google Vertex AI / Azure, through the AI module (`nooblyjs-ai-common`). Direct consumer
  APIs are allowed in development only. No GitHub Copilot integrations.
- A person's **work role** (PM, Architect, Developer…) only shapes their home page. Permissions come
  only from the access role.

## Working agreement

- Build in roadmap phases. Each phase starts with a Kiro spec in `.claude/specs/phase-NN-<name>/`,
  ends with its test script passing, and stops for the user's review before the next phase.
- Done phase specs are frozen. Bugs and small changes in any repo go in `.claude/specs/bugs-and-changes/tasks.md`
  (`BUG-NNN`, `CHG-NNN`; rules in its `requirements.md`): a bug fix starts with a failing test, a commit message
  starts with the ID, a change updates the steering doc it alters, and only the user ticks an entry (verified).
- **Every document goes under `.claude/`** (there is no `docs/` folder since 2026-10-21; `structure.md` §1 lists them):
  phase summaries in `.claude/phases/`, specs in `.claude/specs/`, ADRs in `.claude/adr/`, how-tos in `.claude/guides/`,
  runbooks in `.claude/runbooks/`, audits and reviews in `.claude/audits/`, the shared rules in
  `.claude/steering/nooblyjs-ai-shared-rules.md`.
- Use `[PLACEHOLDER]` for unknown company facts instead of inventing them.
- Mockup numbers are sample data for the "PRD-031 Same-day delivery slots" seed story.

## Commands

From `tech.md` §10. `npm run test:e2e` uses Playwright with the locally installed Chromium and serves NooblyJS on port 11299 with a temp `DATA_DIR`:

```bash
npm start                                   # node --env-file-if-exists=.env app.js
npm run dev                                 # the same with node --watch
npm run electron                            # NooblyJS in a desktop window (apps/electron/main.js starts it, or opens the one already running)
npm run test:electron                       # the same, hidden: start, load the first page, quit
npm run backup                              # a dated, verified copy of data/ in BACKUP_DIR (--list, --verify <name>)
npm run restore -- <backup>                 # into an EMPTY data folder (--into <dir>); verifies every hash and the audit log
npm run perf                                # NooblyJS on 10x the seed volume: times the key pages' APIs (target 1 s)
npm run test:edge                           # the Edge extension (apps/edge) in Playwright's Chromium: side panel, sign-in, Jira reader on a fake page
npm test                                    # node --test --test-force-exit "test/**/*.test.js" (the hosted wiki's watchers have no stop); report in .temp/test-results/unit.txt
node --test test/services/onboarding.test.js   # a single test file
node --test --test-name-pattern="refuses" "test/**/*.test.js"   # tests matching a name
npm run seed -- --reset                     # wipe data/ and rewrite the seed story
npm run seed:blank -- --owner you@x.com     # start from scratch: system files only, no sample content (--reset moves data/ aside, never deletes)
npm run metrics:reconcile                   # recompute Metrics from the raw events; exit 1 on any difference
npm run test:e2e                            # Playwright + axe (specs, then five stories, each on its own NooblyJS; ~15 min); failures in .temp/test-results/e2e*
npm run test:live                           # LIVE: one real model call (needs ANTHROPIC_API_KEY)
npm run test:live:devtools                  # LIVE, READ ONLY: GET requests to Jira and Bitbucket with the .env tokens
```

