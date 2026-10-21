---
inclusion: always
---

# Product Factory engine: where things live

> **An app of its own again since CHG-009 (2026-10-21)**, hosted at `/product` with its data in `data/product/`. From
> 2026-10-19 to 2026-10-21 it was the Software Factory's Product section (`/factory/product`). There is no `server.js`
> or standalone mode: run NooblyJS. Architecture's sidebar row is the Design app's (`/design/architecture`), which draws
> this app's architecture pages. See `CLAUDE.md`.

> `tech.md` has the platform rules and the `register()` contract. This repo is NooblyJS's **Product
> Factory**: it owns the product artefacts, the drafting agents, and its **screens** (Portfolios, Product board,
> Spec, Architecture, UX Design, UI Design, Reviews, Handoffs, Settings), which are a UI module in the NooblyJS frame at
> `/product/…`, like Teammates. They call this repo's API at **`/product/api/v1`**. What the screens show
> is in `product.md` §5 (and `../../nooblyjs-ai-host/.claude/steering/product.md` §5.3).

## 1. Who owns what

| Owner | Owns | Example |
| --- | --- | --- |
| **`nooblyjs-ai-product`** (this repo) | Where work sits (strategic themes, portfolios and value streams with their documents and templates, products), and product **artefacts** and their drafting: signals, ideas (RICE), specs and their versions, architecture (diagram as code, ADRs, standards check, quality attributes), UX (journeys, flows, research, open questions), UI (screens, design-system reuse, accessibility checks, handoff preview), the roadmap | `data/product/specs/PRD-031.md` |
| the lifecycle engine (part of `noobly`, `src/lifecycle/`) | **Items** and their stage and status, readiness rules, approvals (with targets and escalation), handoffs, send-back | `data/workflows/items/PRD-031.md`, `data/workflows/approvals/…` |
| `noobly` | The frame (rail, sidebar, chat panel), people, access roles, audit, events | the rail item for `/product` |
| `nooblyjs-ai-teammate` | The agents that draft, and their billing | Ada Quill drafts PRD-031 |
| `nooblyjs-ai-knowledge` | The context drafts must cite | `kn-slot-capacity-model` |

This repo **never moves an item's stage or records an approval itself**. "Approve & send to
Architecture" is a person's decision. The engine passes it to `host.service('workflows')`, which
records the approval and emits `item.stage_changed`. The engine reacts to that event (for
example, by starting the Architecture drafts).

## 2. Layout

```
nooblyjs-ai-product/
  index.js                  register(app, serverManager, options) → HostedApp (ui, nav, status, services)
  public/                   the UI module the NooblyJS frame loads (no index.html of its own):
    js/module.js            the route table · js/lib.js shared helpers · js/pages/ one file per screen
                            (strategy.js the Portfolios page · document.js a portfolio's or value stream's document ·
                            settings.js the templates · portfolios.js the board's labels and panel)
    css/product.css         every selector scoped to [data-module="product"]
  server.js                 standalone dev server (noobly structure.md §2a, standalone mode): the API plus a dev sign-in, no screens;
                            `--seed [--reset]` seeds and exits (npm run seed)
  package.json              "name": "nooblyjs-ai-product", "type": "module", "main": "index.js"
  src/
    routes/                 index.js (the API router: auth, audit, 404, errors) and one file per area,
                            mounted under /product/api/v1: system.js (/about, /seed) · board.js (board,
                            signals, ideas, roadmap, catalogue) · strategy.js (portfolio and value stream
                            documents, templates) · specs.js · architecture.js · ux.js · ui.js · drafts.js
    services/               catalogue.js (themes, portfolios, value streams, products) · documents.js (a portfolio's
                            and value stream's document) · templates.js (what they start from) ·
                            views.js (per-person views, statuses in words) · board.js (kanban projection) ·
                            specs.js (versions, If-Match) · spec-format.js · readiness.js · stages.js · rice.js · roadmap.js ·
                            c4.js (diagram as code) · architecture.js · ux.js · drafting.js · draft-kinds.js ·
                            architecture.js · adrs.js · standards.js · quality-attributes.js ·
                            ux.js · ui.js · accessibility.js · handoff-preview.js · drafting.js · summary.js
    repos/                  signals · ideas · specs · drafts · roadmap · catalogue · portfolios · valueStreams ·
                            templates · artefacts (architecture/, ux/ per item) · budget (over host.store)
    workers/drafting.js     runs a drafting job as a teammate task (queued with serverManager.queue())
    seed/                   index.js + data/ mirroring data/product/ for the PRD-031 story (seed.yaml records it)
    util/                   ids.js · md-table.js · errors.js
  test/
    public/module.test.js   CSS scoped, nav rows routed, no history/body use, pages answer with the frame
    register.test.js        hosted-app contract (the hosted-app checklist in noobly roadmap.md)
    governance.test.js      refuses: agent accepts an ADR, agent approves, agent sends to Factory, drafting over budget
    routes/*.test.js        API tests: createApp on port 0 + fetch
    fixtures/host.js        stand-in host (also used by server.js), test serverManager, and fake 'workflows',
                            'teammates' and 'knowledge' services
    helpers.js              startApp(): the engine on a bare Express 5 app, port 0, temp data folder
```

## 3. API (`/product/api/v1`, a proposal to settle in the Phase 5 spec)

| Method and path | Purpose | Who |
| --- | --- | --- |
| `GET /board?portfolio=&valueStream=&product=&mine=` | Kanban columns: Signals → Ideas → Spec drafting → In review → To architecture, plus top signals and the Q4 roadmap | signed in |
| `GET /signals` · `POST /signals/:id/idea` | clustered signals (Zendesk, app reviews, app logs), and turning one into an idea | Contributor+ |
| `GET/POST /ideas` · `PUT /ideas/:id` | ideas with their product and RICE score (`product`, and `portfolio` for a new product) | Contributor+ |
| `GET /catalogue` · `POST /catalogue/themes` · `/catalogue/portfolios` · `/catalogue/value-streams` · `/catalogue/products` | strategic themes, portfolios, value streams (`{ name, portfolio }`) and products (`{ name, portfolio?, valueStream? }`) as labels; adding one (a portfolio or value stream gets its document from its template) | read · Contributor+ |
| `PATCH` and `DELETE /catalogue/themes/:name` · `/catalogue/value-streams/:name` | rename or describe a theme (portfolios' links follow); rename or move a value stream (its products follow); remove one not in use | Approver+ |
| `GET` · `PUT /portfolios/:id` · `/value-streams/:id` | the document: the template's sections with their hints and text, where it sits; `PUT { sections: [{ heading, text }] }` with `If-Match` | read · Contributor+ |
| `GET /settings/templates` · `/settings/templates/:kind` · `PUT /settings/templates/:kind` | the portfolio and value-stream templates; `PUT { body }` with `If-Match` | read · Approver+, people only |
| `PUT /catalogue/products/:name/tools` | where a product is built (NooblyJS Phase 11): `repositories` (as Platform lists them) and `jiraProject` (one NooblyJS reads); new ideas and specs start with them | Contributor+ |
| `GET /architecture/:itemId/knowledge` · `GET …/knowledge/search?q=` · `POST …/knowledge` · `PATCH` and `DELETE …/knowledge/:linkId` | knowledge the item is built with (NooblyJS, 2026-10-10): files and folders from the Knowledge Repository (`host.service('knowledge').find`, `locate`), each with a person's note on what it is for; `artefactsFor(itemId).architecture.knowledge` carries them to the Software Factory | read · Contributor+, people only |
| `GET` · `PUT /architecture/:itemId/repositories` | the item's repositories, confirmed or narrowed (people only); the handoff refuses work items outside them | read · Contributor+ |
| `PATCH` and `DELETE /catalogue/portfolios/:name` · `/catalogue/products/:name` | rename, move to another portfolio (a product also to a value stream: `valueStream`), set a portfolio's strategic `themes`, remove (a rename refiles every record; one in use is not removed) | Approver+ |
| `GET/POST /specs` · `GET/PUT /specs/:id` · `GET /specs/:id/versions` | specs (problem, goals, stories, acceptance criteria, out of scope), versioned, with `If-Match` | Contributor+ to edit |
| `POST /specs/:id/drafts` | "Ask the agent to draft" → `202 { draftId }`. Progress comes as events | Contributor+ |
| `POST /specs/:id/decision` | **Request changes** or **Approve & send to Architecture**, passed to the lifecycle engine (part of `noobly`, `src/lifecycle/`) | Approver+ (people only) |
| `PUT /specs/:id/knowledge` | link knowledge (Knowledge's "Add to PRD-031") | Contributor+ |
| `GET/PUT /architecture/:itemId/diagram` | the container view as code (`[DECIDE format]`, `product.md` §12 Q7) | Contributor+ to edit |
| `GET/POST /architecture/:itemId/adrs` · `POST /adrs/:id/accept` · `POST /adrs/:id/discuss` | ADRs. **Accept** is people only | Architect+ to accept |
| `GET /architecture/:itemId/standards-check` | approved stack only, customer data in-region, every API has a contract, a new dependency needs an ADR | signed in |
| `GET/PUT /architecture/:itemId/quality-attributes` | attribute, scenario, target, verified by (these rows become Factory gates) | Contributor+ |
| `GET/PUT /ux/:itemId/journey` · `/flows/:flow` · `/research` · `/questions` | journey map (Doing / Feeling / Pain / Opportunity), flows, research, open questions | Contributor+ |
| `GET /ui/:itemId/screens` · `/design-system` · `/accessibility-checks` · `/handoff-preview` | screen gallery and status, reuse (n of m components), checks (contrast ≥ 4.5:1, 44px targets, not colour alone, screen-reader labels), generated work items with repo count and cost range | signed in |
| `POST /ui/:itemId/handoff` | **Send to Software Factory**, passed to the lifecycle engine (part of `noobly`, `src/lifecycle/`) (which creates the handoff) | people only, per the approval rules |
| `GET /roadmap` | items across the quarter with their stage span | signed in |

## 4. Data (`data/product/`, written only by the NooblyJS process)

```
data/product/
  catalogue.yaml                           strategic themes, portfolios (id, themes), value streams (id, portfolio), products
  portfolios/<id>.md · value-streams/<id>.md   each one's document, one `## ` section per heading of its template
  templates/portfolio.md · templates/value-stream.md   what the documents start from (Settings)
  signals/<id>.md · ideas/<IDEA-ID>.md · specs/<PRD-ID>.md · roadmap.yaml
  specs/<PRD-ID>/versions/v<N>.md          earlier versions (the current one is specs/<PRD-ID>.md)
  architecture/<PRD-ID>/  diagram.md · adrs/ADR-014.md · quality-attributes.md
  ux/<PRD-ID>/            journey.md · flows/<flow>.md · research/<study>.md · questions.md
  ui/<PRD-ID>/            screens/<screen>.md · handoff.md
  drafts/<draft-id>.md                     a drafting job: who asked, teammate, stage, status, cost
  standards.yaml · accessibility.yaml      the check rules people can change `[CONFIRM location]`
```

Front matter keys are camelCase (`draftedBy`, `updatedAt`). Ids follow NooblyJS: `IDEA-018`,
`PRD-031`, `ADR-014`, and generated ids `<prefix>_<random>` (a portfolio `pfl_…`, a value stream `vs_…`).

## 5. Drafting agents

1. A person clicks a draft action (`POST …/drafts`), or `item.stage_changed` arrives for a stage
   that drafts automatically `[CONFIRM which]`.
2. The engine checks the budget, records `data/product/drafts/<id>.md`, and queues a job.
3. `workers/drafting.js` gets context from `host.service('knowledge').contextFor({ itemId })`
   and runs the task as the assigned teammate through
   `host.service('teammates').runTask({ slug, workType: 'spec-drafting', itemId, system: 'product', input: { task, context }, caller, billTo, scripted })`
   (NooblyJS Phase 6). `scripted` is this stage's scripted draft, which the teammate plays when no model is configured;
   with a model, the answer is read as one JSON object with the same keys (`readDraft`). An agent nobody has hired
   (the Design and UI agents today) drafts from the script alone.
4. The result is saved as a **new version** (`draftedBy`, `version + 1`). A draft never
   overwrites a person's unsaved edit (`If-Match`). Then `spec.drafted` and `agent.action` (with
   cost) are emitted.

Drafts are mock or scripted until NooblyJS Phase 6. Agents never approve, accept an ADR, send to
the Factory, or edit after a person has approved a version.

## 6. Talking to the rest of NooblyJS

| Direction | What |
| --- | --- |
| Emits | `catalogue.theme_added` · `_changed` · `_removed`, `catalogue.portfolio_added` · `_renamed` · `_themes_changed` · `_removed`, `catalogue.value_stream_added` · `_renamed` · `_moved` · `_removed`, `catalogue.product_added` · `_renamed` · `_moved` · `_tools_changed` · `_removed`, `portfolio.updated`, `value_stream.updated`, `settings.template_updated`, `signal.clustered`, `idea.created`, `idea.updated`, `idea.scored`, `spec.created`, `spec.updated`, `spec.drafted`, `spec.drafted`, `draft.requested`, `draft.progressed`, `budget.reached`, `architecture.diagram_updated`, `architecture.updated`, `adr.proposed`, `adr.accepted`, `adr.discussed`, `ux.updated`, `ux.journey_drafted`, `ux.flow_drafted`, `ux.quick_test_ran`, `ui.screen_updated`, `ui.handoff_requested`, `ui.screen_updated`, `draft.failed`, `agent.action` |
| Listens to | `item.stage_changed`, `approval.decided`, `handoff.created`, `item.sent_back` (from the lifecycle engine (part of `noobly`, `src/lifecycle/`)), `knowledge.answer_flagged` (flags the specs that cite it) |
| `services` it exposes | `linkKnowledge({ itemId, links, actor })` (the Knowledge Repository's "Add to item": a person only), `adrFor(adrId)`, `artefactsFor(itemId)` (for Home and the item page), `readinessFacts(itemId)` (what the lifecycle engine's readiness rules check), `summary(person)` (agents on duty and monthly spend), `gatesFor(itemId)` (quality attributes as Factory gates), `waitingFor(person)` (Home · Waiting on you, For you), `metrics()` (NooblyJS Metrics) |
| Services it uses | `workflows` (decisions, items, handoffs), `teammates` (drafting tasks), `knowledge` (context and citations). Any of them may be missing when standalone, so degrade gracefully |

## 7. Seed

`seed({ reset })` writes the PRD-031 "Same-day delivery slots" story: the signals (including
"Substitutions feel random"), the ideas, PRD-031 at v4 (readiness 6 of 7; the Teams demo
uses v5 with 7 of 7), ADR-013 and ADR-014, the quality attributes, the journey and flows, the
screens with the failing "Timer needs a screen-reader label" check, and the handoff preview
(6 work items across 3 repos, $18–$26). Mockup numbers are sample data.
