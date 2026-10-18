---
inclusion: always
---

# Software Factory: where things live as a NooblyJS hosted app

> `tech.md` has the platform rules and the `register()` contract. This file covers the factory's
> layout when NooblyJS hosts it at **`/factory`**. The factory's internal design (stations, the line
> engine, gates, forge, harness use) is in `CLAUDE.md`, `.claude/steering/Architecture.md` and
> `.claude/docs/`. Those stay the reference for how the factory works inside.

## 1. Layout

```
nooblyjs-ai-factory/
  index.js                  the library's exports, and register(app, serverManager, options) → HostedApp (src/services/hosted.js)
                            (no server.js: NooblyJS hosts it, and bin/factory.js is the standalone CLI; tech.md §1)
  package.json              "name": "nooblyjs-ai-factory", "type": "module", "main": "index.js", "exports": { ".": "./index.js" }
  bin/factory.js            the CLI (unchanged; see tech.md §3 for writes when hosted)
  lines/*.json              lines as data (the merge station is refused when hosted)
  src/                      only config/ controllers/ middleware/ models/ roles/ routes/ services/ utils/
                            (the same folders as nooblyjs-ai-teammate; test/structure.test.js holds it)
    config/                 factory-config.js (operator) · repo-config.js (.factory/config.json) · harness-settings.js
    controllers/            request handlers: api.js (dashboard) · workers.js · webhooks.js · cli/ (one per command)
    middleware/             auth.js (bearer token) · worker-auth.js · body.js (size-capped bodies) · static.js
    models/                 store/ (the event log, projections, artifacts, effects) · line · spec · issue ·
                            findings · inbox · workers. The store is files: store/files.js (daily YAML streams) behind openStore()
    roles/                  builtin/*.md, loader.js, prompts.js
    routes/                 route tables: api.js (to be served under /factory/api/v1) · workers.js (worker
                            callbacks, under /factory/internal/v1) · webhooks.js · http.js (the router) · cli.js
    services/               the factory itself: line/ (engine, executor, stations) · exec/ · scheduler/ · forge/ ·
                            job/ · review/ · knowledge/ · mcp/ · remote/ · metrics/ · … · harness.js · sse.js
                            For hosting: hosted.js (register, status card, the services other apps call §4; the
                            PRD-031 seed §5 is still to add) and to-express.js (route table → Express router)
    utils/                  clock · ids · paths · log · glob · frontmatter
  public/                   static files only, served under /factory (no index.html)
    css/factory.css         only what the kit doesn't cover; every selector starts with [data-module="factory"]
    js/
      module.js             route table (§2)
      lib.js · parts.js     what the pages share: safe DOM, the page() runner, icons, pills, the inbox card
      pages/                line.js · runs.js · run.js · inbox.js · campaigns.js · metrics.js
    dashboard/              the F17 dashboard page, which `factory dashboard` still serves (not served when hosted)
  test/                     mirrors src/: test/<folder>/…/<module>.test.js. redteam.test.js and
                            structure.test.js stay at the top, because they cover the whole factory
    register.test.js        hosted-app contract (the hosted-app checklist in noobly roadmap.md)
    module.test.js          routes, render() exports, CSS scoping
    fixtures/host.js        stand-in host until nooblyjs-core ships createShell()/FsStore
```

`public/dashboard/` and the root `index.html` go away once the pages in `public/js/pages/`
replace them.

## 2. What the shell shows

```js
{
  name: 'factory', label: 'Factory', icon: 'factory', mountPath: '/factory',
  ui: { entry: 'js/module.js', styles: ['css/factory.css'] },
  nav: [
    { key: 'line',      label: 'Line',      path: '/line' },
    { key: 'runs',      label: 'Runs',      path: '/runs' },
    { key: 'inbox',     label: 'Inbox',     path: '/inbox', badge: 'inbox' },
    { key: 'campaigns', label: 'Campaigns', path: '/campaigns' },
    { key: 'metrics',   label: 'Metrics',   path: '/metrics' },
  ],
}
```

**Status card** (`status()`, `../nooblyjs-ai-host/.claude/steering/product.md` §5.4): accepting work or
stopped, slots running and queued, and spend today against the daily cap. **Stop all runs** is a
button on the Line page, because the status card holds text only. If it must also sit in the
sidebar, ask NooblyJS for a card action `[CONFIRM]`.

| Route (`module.js`) | Page | Notes |
| --- | --- | --- |
| `/` | redirect to `/line` | |
| `/line` | `line.js` | stations, running and queued work, finished today, Stop all runs |
| `/runs` | `runs.js` | recent runs |
| `/runs/:id` | `run.js` | a run's steps, story, evidence and artifacts. `ctx.chat.scope({ kind: 'run', id })` |
| `/inbox` | `inbox.js` | what's waiting for a person (approve, answer, give feedback) |
| `/campaigns` | `campaigns.js` | campaigns across repos |
| `/metrics` | `metrics.js` | 7 days / 30 days / all time. Delivery figures and the Stations table. Plain empty states |

Old hash links map one to one: `#/run/<id>` → `/factory/runs/<id>`.

## 3. Data (`data/factory/`, written only by the NooblyJS process)

```
data/factory/
  events/YYYY/MM/YYYY-MM-DD.yaml   the factory event log (append-only, seq-numbered), the source of truth
  artifacts/<sha>                  artifact text referenced from events
  issues/<issue-id>.md             work items received from NooblyJS handoffs
  forge/                           the local forge (when not using GitHub)
  config.yaml                      factory settings people change at runtime
```

Projections (runs, steps, inbox, metrics) are rebuilt in memory from `events/` at start.

## 4. Talking to the rest of NooblyJS

| Direction | What |
| --- | --- |
| Listens to | `handoff.created` (from the lifecycle engine (part of `noobly`, `src/lifecycle/`)): turn each work item into a factory issue and start runs |
| Emits to `host.events` | `run.started`, `run.finished` (outcome, cost), `pr.opened`, `gate.failed`, `run.asked` (a question for a person), `run.answered`, `run.waiting` (a work item that started nothing, and why), `merge.refused`. Each carries the NooblyJS `itemId` and the repository |
| `services` it exposes | `runsForItem(itemId)`, `runsFor(person)`, `questionsFor(person)`, `waitingWork(itemId)`, `intake({ handoffId })`, `status()`, for Home ("For you", Developer home) and the item page |
| Services it uses | `host.service('workflows').handoffOf({ handoffId })` for the work items; `host.service('product')?.gatesFor(itemId)` and `artefactsFor(itemId)` for the quality attributes and the spec; `host.service('knowledge')?.contextFor(...)` for station context, if loaded |
| Browser calls | The Factory pages call only `/factory/api/v1`. Links to items go to `/product/…` or `/` |

## 5. Seed

`seed({ reset })` writes the runs for the PRD-031 story (the "6 work items across 3 repos"
handoff) into `data/factory/`, so Home and the item page have something to show.
