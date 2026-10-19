---
inclusion: always
---

# Software Factory: this repo in NooblyJS

> **Read `NOOBLY.md` first** (in this folder; generated from noobly). noobly owns everything shared, and this file does not
> repeat it: the hosted-app contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a, the cross-app services are
> `../nooblyjs-ai-host/.claude/steering/tech.md` §8b, governance and the permissions matrix are `../nooblyjs-ai-host/.claude/steering/product.md`,
> and the one roadmap is `../.claude/steering/roadmap.md` (with the hosted-app checklist this repo must pass).
> If this file and noobly disagree, **noobly wins**: follow it and fix this file in the same change.
>
> NooblyJS mounts this repo at **`/factory`**. This file gives only this repo's values for the contract, where it
> differs from the defaults, and what it is like today.

## 1. This repo's values

| | |
| --- | --- |
| Entry | `index.js` (`"main"`, `"exports"`): re-exports the factory library (`src/index.js`) and `register()` from `src/services/hosted.js`, so library users are unaffected |
| `register()` | default mount `/factory`, name `factory`, styles `css/factory.css`, data under `data/factory/` (its event log is daily YAML streams, `src/models/store/`) |
| Standalone | No `server.js`: `npm start` is the CLI (`bin/factory.js`), which keeps working on its own `$FACTORY_HOME`. When NooblyJS hosts the factory, only the NooblyJS process writes `data/factory/` |
| `host.development` | A demo repository's gate commands run unsandboxed only then, never when `NODE_ENV` is production, and never with the process's secrets |
| `agent.action` | `system: 'factory'`; every agent step carries its cost; `run.finished` carries `workType: 'implementation'` |
| `services`, events | `host.service('factory')` is in noobly `tech.md` §8b; the events it emits are in `structure.md` |
| Bitbucket (NooblyJS Phase 13) | A run on a repository NooblyJS imported from Bitbucket uses `src/services/forge/bitbucket.js` (`request.forge = { kind: 'bitbucket', name }`, set by intake). It holds **no token**: it asks `host.service('devtools').forge` to push the `factory/…` branch and open the pull request, and NooblyJS's write gate decides whether anything is sent. Recorded only, the PR file on disk is the record. It never merges |
| Merging | The `merge` station **refuses when hosted** (`FACTORY_HOSTED=noobly`), whatever the line or autonomy level says, and appends `merge.refused`, which NooblyJS audits |

## 2. Platform (NooblyJS Phase 9)

**NooblyJS Phase 9 (Platform).** Hosted, the intake asks `host.service('platform').checkAgentWork({ system: 'factory',
workType: 'implementation', repo, needs: 'openPrs' })` before a work item becomes a run: a repository where agents
may not open PRs, or a reached budget, makes it wait with Platform's reason. The daily cap is Platform's
(Settings · Budgets, followed on `budget.changed`). A run executing here is registered on Platform's container
runtime; `host.service('factory')` gains `cancel(runId)` and `stopAll()` for Platform · Containers.
`run.finished` carries `workType: 'implementation'` so its cost counts against that model route.

## 3. This repo today, and what changed when it joined NooblyJS

The Software Factory works as a CLI, a `node:http` dashboard and a learning project
(phases F00–F25, documented in `.claude/docs/` and `.claude/steering/`). Its **internal design
stays**: the event log is the source of truth, `decide()` is pure, stations run in sandboxed
worktrees, deterministic gates decide, and agents never push. Hosting changes only the edges.
The NooblyJS roadmap does this work in **Phase 7**.

| Today | Hosted in NooblyJS |
| --- | --- |
| `package.json` name `nooblyjs-learn-factory`, `"main": "src/index.js"` | Name **`nooblyjs-ai-factory`** (NooblyJS imports it by this name). Root `index.js` exports `register()` and re-exports `./src/index.js`, so library users are unaffected |
| `src/server/http.js` (a `node:http` router, bearer token, bound to 127.0.0.1) | `register()` mounts an Express router at `/factory`. The route table in `src/server/api.js` (`[method, pattern, handler]`) is adapted, not rewritten: a small `toExpressRouter(routes)` turns each `handler({ params, query, body, req, res })` into an Express handler behind `host.auth`. `factory serve` keeps `http.js` for CLI use |
| API at `/api/status`, `/api/runs/:id`, `/api/inbox`, `/api/events` | `/factory/api/v1/status`, `/factory/api/v1/runs/:id`, `/factory/api/v1/inbox`. Live updates go through `host.events` and the host's SSE stream (topic `factory`), not `/api/events` |
| `POST /api/runs/:id/:action`, `/api/stop-all`, `/api/inbox/:id` | The same verbs under `/factory/api/v1`, each with `host.requireRole` and `host.audit` |
| (was) SQLite event log in `$FACTORY_HOME/factory.db` | **Done (NooblyJS Phase 7), for the CLI too:** daily YAML streams under `<home>/events/YYYY/MM/<day>.yaml` behind the same `openStore()` interface (`src/models/store/files.js`, `events.js`). Projections are in memory, rebuilt at start. `node:sqlite` is not used anywhere |
| Artifacts under `$FACTORY_HOME` | `data/factory/artifacts/<sha>` (text) through `host.store` |
| Stations run in-process or on remote workers (F23) | **NooblyJS Phase 7:** the scheduler and the stations run **inside the NooblyJS process** (`register()` starts the scheduler). Separate workers, queued and reporting through `/factory/internal/v1/…`, come later |
| GitHub webhooks on their own `node:http` port (`src/server/webhooks.js`) | `POST /factory/api/v1/webhooks/github`, verified by signature and exempt from session and CSRF, like the Teams bot. How the host exempts it is decided in the Phase 7 spec `[CONFIRM]` |
| Dashboard in `src/server/dashboard/` (hash routes `#/`, `#/runs`, `#/run/:id`, `#/inbox`, `#/campaigns`, `#/metrics`), plus `index.html` at the repo root | `public/js/module.js` with History-API routes (`structure.md` §2) and pages in `public/js/pages/`, restyled with the NooblyJS kit. The old header nav, the `🏭` brand and other emoji, and the dashboard's own CSS tokens go away |
| The `merge` station on `lines/*.json` | **Refuses when hosted** (`FACTORY_HOSTED=noobly`), whatever the line or the autonomy level says, and appends `merge.refused`, which NooblyJS audits. A configured autonomy L3 is refused at intake too. Merging is a person's action |
| Daily spend cap in `src/scheduler/budgets.js` | Still enforced, and every agent step also emits `agent.action` with its cost. From NooblyJS Phase 9, the cap comes from `data/platform/budgets.yaml` through the host |
| Models through the harness, with any provider | The harness calls `nooblyjs-ai-common` providers (Bedrock / Vertex / Azure in production). Roles and tiers map to **work types** (`implementation`, `triage`, `review`) |
| CLI (`bin/factory.js`) writes to `$FACTORY_HOME` | The CLI keeps working standalone. When NooblyJS hosts the factory, only the NooblyJS process writes `data/factory/`, so CLI commands that change state call the API. Which commands do this is decided in the Phase 7 spec `[CONFIRM]` |

Kept as they are: `// @ts-check` plus JSDoc, one concept per file opening with a comment that
names its phase, the `clock` for anything time-based, offline tests, and the secret scan before
any push. The rule "core code uses Node built-ins only" gains `nooblyjs-core`, `js-yaml` and
(for `server.js` only) `express`. Add a line for each to Architecture §17, as that rule requires.
Record the integration as a factory phase doc (`.claude/docs/F26-hosted-in-NOOBLY.md`) `[CONFIRM numbering]`.
