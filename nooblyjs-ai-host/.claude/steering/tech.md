---
inclusion: always
---

# NooblyJS — Technology and architecture

> How NooblyJS is built. `product.md` says **what** to build; this says **how**. The rules
> here apply to `nooblyjs-ai-host` and to every child project (`nooblyjs-core`, `nooblyjs-ai-common`, `nooblyjs-ai-harness`, `nooblyjs-ai-factory` with its Product
> section, `nooblyjs-ai-teammate`, `nooblyjs-ai-knowledge`, `nooblyjs-ai-infrastructure`). The lifecycle engine is part of `nooblyjs-ai-host` (`src/lifecycle/`). Each hosted child restates the rules it must follow
> in its own `.claude/steering/tech.md`; this document wins if they disagree. Where the build brief (`brief/noobly-build-brief.md` §4) suggests
> TypeScript, React, Postgres or pgvector, **this document overrides it**.

---

## 1. Stack at a glance

| Layer | Choice | Not allowed |
| --- | --- | --- |
| Runtime | **Node.js 24 LTS** (minimum 22.12), ES modules (`"type": "module"`) | CommonJS in new code |
| Server | **Express 5** serving JSON APIs and static files | Next.js, Nest, Fastify, GraphQL servers |
| Front end | **Plain HTML, CSS and JavaScript** (native ES modules in the browser) | React, JSX, Vue, Svelte, Angular, TypeScript, Tailwind, bundlers, transpilers |
| Storage | **Markdown files with YAML front matter**, and **YAML files** for config and logs, in a `data/` folder | SQLite, MongoDB, Postgres, Redis as a store of record, JSON databases |
| Shared services | `nooblyjs-core` (logging, caching, queueing, scheduling, notifying, measuring, searching, auth) | Re-implementing these per project |
| AI | `nooblyjs-ai-common` (providers, model catalogue, tokens, cost) and `nooblyjs-ai-harness` (agent runtime) | Calling a model provider SDK directly from a feature |
| Tests | `node:test` and `node:assert`, offline by default (mock provider) | Jest, Mocha, Vitest |

**No build step.** `npm start` runs the source as written. Use JSDoc comments where types help.

**Dependencies stay minimal.** The baseline is `express`, `js-yaml` and `nooblyjs-core`
(an app that calls models also links the AI module inside core, `file:../../nooblyjs-core/src/aiservice/common`);
the NooblyJS packages are linked as `file:../<project>` dependencies, the way `nooblyjs-ai-teammate` does it. The host (`noobly/app.js`) also uses `helmet` (security headers),
`compression`, `express-rate-limit` (API and sign-in limits), and `express-session` + `passport`
(sessions and sign-in through nooblyjs-core's authservice, including Microsoft Entra ID). Adding any
other runtime dependency needs a reason in the PR.

**Desktop window (optional).** `npm run electron` opens NooblyJS in an Electron window (`apps/electron/main.js`, CommonJS
because Electron loads it before an ESM loader exists). It is a window, not a second build: it starts `app.js` as a
child process under the installed Node with the same `.env`, on the same address (`PORT`, `HTTPS_ENABLED`), or opens
the NooblyJS already running there; `NOOBLY_URL` points it at a NooblyJS elsewhere. Pages get no Node access, links that leave
NooblyJS open in the browser, sign-in redirects stay in the window, and only the local development certificate is
accepted unsigned. `electron` is a devDependency and nothing in `src/` or `public/` may depend on it.

## 2. Architecture

```
   Browser: NooblyJS frame + app modules (/ui kit)      Microsoft Teams (chats, meetings)
   (ES modules, History-API router)                        │ Bot Framework activities
        │  fetch JSON · EventSource (SSE)                   │ (JWT-signed)
        ▼                                                   ▼
┌──────────────────────────── nooblyjs-ai-host (Express 5, one process) ─────────────────────────────┐
│  middleware: session/SSO → CSRF → role check → audit (every write) → rate limit         │
│                                               POST /api/teams/messages (bot endpoint)   │
│  /api/v1/home   /workflows/api/v1   /product/api/v1   /api/v1/platform   /api/v1/events │
│  /api/v1/me (profile, onboarding)   /api/v1/chat (threads, messages, cards)             │
│        │                │                  │                  │                         │
│  ┌─────┴────────────────┴──────────────────┴──────────────────┴──────────────────────┐ │
│  │ hosted apps: register(app, serverManager, options) → /factory /teammates /wiki      │ │
│  │  lifecycle (nooblyjs-ai-host) items · stages · readiness · approvals · handoffs · escalation  │ │
│  │  nooblyjs-ai-factory   product/: signals · specs · architecture · UX · UI · drafting  │ │
│  │  nooblyjs-ai-knowledge spaces · sources · ingest · search · answers · process models  │ │
│  │  nooblyjs-ai-teammate teammates · skills · memory · timesheets · billing             │ │
│  │                        line · runs · inbox · campaigns · gates · PRs                  │ │
│  │                        infrastructure/: designs · environments · runs · drift · cost  │ │
│  └──────────────────────────────────┬─────────────────────────────────────────────────┘ │
│        services:  event bus · audit · notifications · metrics · search index            │
│        (nooblyjs-core)                  │                                                     │
│        store:  FsStore (Markdown + YAML, atomic writes, per-file locks, cache)          │
└──────────────────────────────────────┼──────────────────────────────────────────────────┘
                                       ▼
                              data/  (Markdown + YAML)
                                       ▲
              results via API only     │
┌──────────────────────────────────────┴──────────────────────────────────────────────────┐
│ workers (separate processes / containers, queued by nooblyjs-core):                          │
│   factory stations · teammate tasks · chat replies · drafting agents · indexers          │
│   run on nooblyjs-ai-harness; call models through nooblyjs-core's AI → Bedrock / Vertex / Azure │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Principles

1. **One web process owns `data/`.** Only the NooblyJS server process writes to the data
   folder. Workers (agents in sandboxes, factory stations, indexers) never touch `data/`
   directly. They report back through the internal API. This keeps file locking simple
   and makes every write pass through the audit middleware.
2. **Child apps are hosted, not separate servers.** Each child with a UI or API exports
   `register(app, serverManager, options)` from its `index.js`. `nooblyjs-ai-host` passes in its Express
   app and its initialised nooblyjs-core `ServiceRegistry` (the `serverManager`), and the child
   attaches itself under its own path: `/factory`, `/teammates`, `/wiki` (with a UI
   module) or `/workflows` (API only). Its standalone `server.js` uses the same `register()`.
   The full contract is in `structure.md` §2a.
3. **Events are the backbone.** Every state change emits a named event (`item.stage_changed`,
   `approval.requested`, `approval.decided`, `handoff.created`, `run.finished`,
   `pr.merged`, `agent.action`, `budget.reached`, `guardrail.changed`, …). Events are
   appended to the event log and published on the nooblyjs-core event bus. Activity,
   Metrics, notifications and live updates (SSE) all read from events.
4. **The server enforces governance, not the UI.** Role checks, guardrails, budgets
   (pause on limit), agent access to repos, and "agents never merge" are checked in
   services before any write or agent dispatch. A hidden button is not a control.
5. **Every agent action carries its context:** `{ actor, teammateId, itemId, system,
   modelRoute, costUsd, at }`. Cost comes from the AI module (`nooblyjs-ai-common/cost`) and is written to
   the event, the audit log and the teammate's timesheet.
6. **The host owns the frame.** The browser loads one page: the NooblyJS frame (rail, sidebar,
   content area, chat dock). Apps, both built-in and hosted, provide UI modules that the frame
   loads into the content area. They describe their rail entry and nav as data from
   `register()`. Switching apps never reloads the page, so chat and SSE survive it
   (`.claude/adr/ADR-001-host-owned-shell.md`).

## 3. Storage: Markdown and YAML in `data/`

### 3.1 Formats

| Use | Format | Example |
| --- | --- | --- |
| An entity with prose (spec, ADR, item, teammate, knowledge document, runbook) | `.md`: YAML front matter for fields, Markdown body for content | `data/product/specs/PRD-031.md` |
| Configuration, rules, matrices, routing | `.yaml` | `data/platform/model-routes.yaml` |
| Append-only streams (events, audit, activity) | `.yaml` multi-document stream (`---` between records), one file per day | `data/events/2026/10/2026-10-08.yaml` |
| Tabular body content inside an entity | Markdown table in the body (see `md-table.js` in teammates) | goals, quality attributes |

Example entity:

```markdown
---
id: PRD-031
type: spec
title: Same-day delivery slots
stage: specify
status: in_review
domain: delivery
owner: lerato-m
draftedBy: ada-quill
version: 4
readiness: { passed: 6, total: 7, failing: [rollout-plan] }
links: { idea: IDEA-012, knowledge: [kn-slot-capacity-model, ADR-013] }
createdAt: 2026-09-30T08:12:00Z
updatedAt: 2026-10-08T09:41:00Z
---

## Problem
Customers who shop after work find every same-day slot taken by mid-morning…

## Goals
| Measure | Today | Target |
| --- | --- | --- |
| Same-day slots still open at 12:00 | 18% | 45% |
```

### 3.2 The store (`FsStore`)

Reuse the store from `nooblyjs-ai-teammate/src/store/fs-store.js`. Move it into
`nooblyjs-core` so every project shares one copy. It must keep these guarantees:

- **Atomic writes:** write to a temp file, then `rename`. A reader never sees a half-written file.
- **Per-path async mutex** for read-modify-write (`updateDoc(path, fn)`).
- **Path safety:** every path segment matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, and
  the resolved path must stay under `data/`.
- **YAML `CORE_SCHEMA`** so ISO dates stay strings.
- **mtime/size-validated cache** (nooblyjs-core caching), so edits made by hand outside the
  app are picked up.
- **Appends** for event and audit streams are serialized per file.

**Repositories** (`src/repos/*.js`) wrap the store, one per entity type: `list`, `get`,
`create` and `update(id, fn)`. They validate ids with a regex. Routes never call the store directly.

### 3.3 Querying without a database

- **Lists** come from directory listings plus front matter. Keep folders shallow and
  partition large sets (events by day; documents by space and collection).
- **Indexes** (search, backlinks, counts per stage, approvals waiting on a person) are
  built **in memory at startup** from the files. They are kept current from events and can
  always be rebuilt. They are a cache, never the source of truth.
- **Metrics** are computed from the event stream only (`src/services/metrics/`): `facts.js` turns an event into
  metric facts and is the only file that knows event types; `compute.js` is a pure function from facts, a range and
  now to the numbers. A past day's facts are kept as a roll-up in `data/metrics/rollups/<date>.yaml`, rebuilt when
  it is missing or when the day's event file changed; today is always read from the events. The seed's sample
  history (`src/seed/metrics-history.js`) is events marked `sampleHistory: true`, which Activity and Platform's
  ledger rebuild skip. A new event type that a metric should read is added in `facts.js` (and the roll-up version
  raised when a fact changes shape). Since Phase 17 a `spend` fact carries its item (roll-up version 3), and
  `src/services/metrics/places.js` places this month's agent and cloud spend by value stream and portfolio (the
  Product app's `placeOf`, Infrastructure's `cloudByItem`, Platform's portfolio budgets) and sums agent spend per
  item for a business case's estimate (`host.service('metrics')`: `spendByItem`, `spendByValueStream`). Since Phase 16e `ask` and `decide` facts carry the approval's type (roll-up
  version 2), which gives the pull requests waiting on a Build approval and on a Test approval now, with the oldest's
  age; a pull request's own item events (`itemType: 'pr'`) are its story's work, not lead time.
- **Checks and the trace** (Phase 16f, root `design.md` §4–§5). Each app maps its own checks to one shape in a
  `checksFor` service (the lifecycle: readiness and the Build and Test approvals; the Product app: the spec's
  readiness and the standards check; the Software Factory: gates, quality attributes, required tests; Infrastructure:
  policy checks) and gives its links in a `trace` service. `src/services/checks.js` gathers an item's checks (with its
  stories' and pull requests'), gives each a stable id, keeps the last results in `data/checks/<item>.yaml` and emits
  `check.recorded` when one is new or changed (Activity leaves it out). One readiness check can be overridden by a
  person with a reason (`check.overridden`, audited), for that stage. `src/services/trace.js` keeps the derived index
  `data/trace/index.yaml` (built again when anything changed since, or when it is missing); `npm run trace:rebuild`
  compares it with a fresh build. Links an item knows about live in its front matter (`links: [{ rel, to }]`).
- **Knowledge search** is the Wiki Platform's own indexer over nooblyjs-core's searching service (lexical). It was
  not changed in Phase 8. Semantic search is not built `[DECIDE format]`.
- **Knowledge (Phase 8)** is the Wiki Platform at `/wiki` (`src/wiki/knowledge/` in `nooblyjs-ai-knowledge`). An
  import turns an export folder into spaces, with email addresses, phone numbers and ID numbers replaced before a
  file is stored. Asking (`POST /wiki/api/v1/ai/chat/search`) answers from the top sources with numbered
  citations; with no AI agent configured the answer is the sources' own passages and says so. Every answer is
  kept with an id, so a person with `draft` can add it to an item (`host.service('product').linkKnowledge`), save
  it as a page, or report it as wrong, which flags its documents (Needs review, cleared with `approve`) and
  emits `knowledge.answer_flagged`. Importing takes `change-repo-access` (an Owner). Other apps call
  `host.service('knowledge')`: `contextFor({ itemId, query })`, `search`, `flagged`, `status`. The wiki's own AI
  agents still call their provider directly, outside `nooblyjs-ai-common` and Teammates: development only.

### 3.4 Data layout

The full `data/` tree is in `structure.md` §4.

- `data/` is **gitignored**. Seed data lives in `src/seed/` and is written on first start
  (`DATA_DIR` defaults to `./data`). The seed tells the PRD-031 story from the mockups.
- **No secrets in `data/`.** Repository secrets are stored as references (`vault:staging/REDIS_URL`).
  Credentials come from environment variables or the platform secret store.
- **Personal data** is redacted before a knowledge document or agent log is written.

## 4. Server (Express)

### 4.1 Layers

`routes` (thin: parse → call service → respond) → `services` (rules, guardrails, events,
cost) → `repos` (one per entity, over the store) → `FsStore`. Each layer only calls the one
below it. The composition root `app.js` exports `createApp({ config })` so tests can run the
whole app without a fixed port; running `node app.js` also creates the HTTP or HTTPS server,
listens and handles shutdown. Folder layout: `structure.md` §2.

### 4.2 API conventions

- JSON over HTTP, with plural nouns. The host's APIs are under **`/api/v1/<area>/…`**, and a
  hosted app's are under **`<mountPath>/api/v1/…`** (e.g. `/factory/api/v1/runs`). For example:
  `GET /workflows/api/v1/items?stage=architect`,
  `POST /workflows/api/v1/approvals/:id/decision`.
- Actions that aren't plain CRUD are sub-resources with verbs:
  `POST /product/api/v1/specs/PRD-031/send-to-architecture`,
  `POST /product/api/v1/ui/PRD-031/handoff`.
- Errors use one shape: `{ "error": { "code": "readiness_failed", "message": "…", "details": {} } }`,
  with the right status (400 validation, 401, 403 role/guardrail, 404, 409 conflict, 422 rule refused).
- Writes accept an `If-Match` version (front-matter `version` or `updatedAt`) and return 409 on conflict.
- **Live updates** go over `GET /api/v1/events/stream`, a Server-Sent Events stream
  (the AI module, `nooblyjs-ai-common/sse`) filtered to what the user may see. The UI uses it for "Live now",
  badges, status cards and **chat**. One stream per tab carries every topic; the client
  subscribes to topics (`?topics=thread:PRD-031,approvals`). Clients send with plain
  `POST`. **There is no WebSocket server.** The brief's Phase 2 says "WebSockets", but SSE + POST
  gives the same real-time behaviour without a dependency (decided, Phase 2). The stream
  reconnects with `Last-Event-ID`, and events are replayed from the day's event file. Today it sends
  every event, as its Activity row (`event: nooblyjs-ai-host`), and pages subscribe by event type or `'*'`;
  filtering by topic on the server comes with chat (Phase 4). It is sent with
  `Cache-Control: no-transform` so compression doesn't buffer it. A page that refetches on events
  does so at most once every 2 s, because the API is rate limited.
- An internal worker API (`/internal/v1/…`, a service token, not exposed publicly) is how
  workers report progress, results and cost.

### 4.3 Middleware order

`helmet-style headers → session (nooblyjs-core auth; Entra ID OIDC [PHASE]) → CSRF (double-submit
cookie for non-GET) → role check (permissions matrix) → audit (writes) → route → error handler`

The Teams bot endpoint skips session and CSRF and verifies the Bot Framework JWT instead (§7).

### 4.4 Development sign-in

While Entra SSO isn't wired, sign-in uses nooblyjs-core auth with **seeded people** (Stevie as
Owner / Platform engineer, Lerato M. as Approver / Product manager, Thabo N. as Architect,
Priya S. as Contributor / Developer). With `NOOBLY_DEV_LOGIN=true`, `/login` shows a
**person picker**, so you can test each role and home in one click. Startup refuses
`NOOBLY_DEV_LOGIN` when `NODE_ENV=production`.

The same flag turns on the **dev clock** (`/dev/clock`, `GET/POST /api/v1/dev/clock`): it moves
NooblyJS's "now" forward by hours or working days. Events, the audit log and every hosted app read
that clock (`host.clock`), never `Date.now()`, for business time. Its offset is kept in
`data/dev/clock.yaml`. In production the clock can't be moved.

## 5. Front end (plain HTML, CSS, JS)

- **One frame, many app modules.** Every UI URL (`/`, `/product/…`, `/design/…`, `/factory/…`) returns
  the same static **frame page** from nooblyjs-core's `createShell()`. It loads the **shared UI
  kit** from `/ui/` (`nooblyjs-core/public/ui/`). `/ui/js/frame.js` reads the app list from
  `GET /api/v1/shell`, draws the suite rail, the module sidebar and the chat dock once, and
  loads each app's **UI module** (`<mountPath>/js/module.js`, or `noobly/public/js/modules/<area>.js`
  for Home, Product Factory and Platform) with `import()` the first time it's opened.
  Navigation is client-side everywhere, including between apps. The contract is in
  `structure.md` §2a.
- **Router:** the kit's History-API router (`/ui/js/router.js`) picks the app by the longest
  matching mount path, then a route from that app's module. The frame intercepts ordinary
  same-origin links (opt out with `data-reload`), so pages write plain `<a href>`. Every
  app's server answers any non-API, non-static path under its mount path with the frame, so
  deep links and refresh work.
- **Pages** (`<app>/public/js/pages/…/<screen>.js`) export `render(view, { params, query, ctx, route })`,
  which renders into the content element, and an optional `destroy()`. They call their own
  API through `ctx.api` (the kit's `api.js`, bound to `<mountPath>/api/v1`, with CSRF, JSON and
  error handling). They use `ctx.signal`, which the router aborts when the person leaves the
  page, so requests and subscriptions don't leak between pages or apps.
- **Shared page, scoped code:** apps share one document. Each app's CSS selectors start
  with `[data-module="<name>"]`, pages touch only their `view`, and the kit is imported by
  absolute URL so every app uses the same copy. A module that fails to load shows an error
  card in the content area, and the rest of NooblyJS keeps working.
- **Components** are plain functions in `/ui/js/components/index.js` (`button`, `statusPill`,
  `statCard`, `listRow`, `dataTable`, `kanbanColumn`, `timelineRow`, `meter`, `processChevrons`,
  `stageStrip`, `swimlane`, `checklist`, `chips`, `pageHead`, `card`, `notice`) that return `SafeHtml`
  strings through the tagged template in `/ui/js/html.js`, which **escapes by default**. They
  work in Node, so `node:test` covers them. Never put untrusted text into `innerHTML` unescaped.
  Markdown will be rendered by `/ui/js/markdown.js` with sanitising, built when the first screen
  needs it (no Phase 2 screen did). `/dev/styleguide`
  shows every component in every state.
- **CSS:** `tokens.css` holds the NooblyJS tokens as custom properties (colours, type, radii,
  spacing from brief §7), `base.css` the reset and typography, `components.css` the
  components, and one file per module only when needed. There are no inline styles: the
  mockups' inline values are turned into classes and tokens. The layout uses Grid and Flexbox
  and stacks at narrow widths.
- **Fonts and icons:** Figtree (400–700, the interface), Bricolage Grotesque (500–800, headings) and JetBrains Mono (400/500), self-hosted as woff2 in
  `nooblyjs-core/public/ui/fonts/` under the SIL Open Font Licence (copies beside them). No font CDN.
  Icons are inline SVG strokes in `/ui/js/icons.js`, with no emoji.
- **Accessibility:** WCAG 2.2 AA. Use real `<button>`, `<a>` and `<label>`, give focus a
  visible style, and use `aria-live` for live counts. Status is always said in words. Controls
  are at least 44px tall, and a scrollable region gets `tabindex="0"`, a role and a label.
  `npm run test:e2e` (Playwright + axe) checks every page for AA violations, horizontal scroll at
  375px and the keyboard path.
- The Factory, Teammates and Knowledge UIs stay in their own repos as hosted apps. They
  become UI modules, pick up the kit's tokens, and move to its components over time.
  **Teammates is done** and is the pattern (`.claude/guides/porting-an-app.md`):
  - a route table over a bridge that runs the old pages unchanged
  - CSS scoped with `nooblyjs-core/scripts/scope-css.js`, with the old tokens pointing at the kit's
  - kit class-name collisions reverted inside the app's pages
  - the app's own CSP and CSRF check dropped in favour of the host's (`host.checksCsrf`)

## 6. AI and agents

- **Which models exist is looked up, not typed in** (2026-10-10): `nooblyjs-ai-common/discovery` reads each configured
  provider's own model list (Anthropic, OpenAI, xAI, Gemini, DeepSeek, Ollama; GET only), keeps the chat models, and
  prices each one from the best source: the catalogue (`models.js`, curated) · the provider's own list (xAI) ·
  OpenRouter's public list price, labelled as a reference · else "price unknown". Cached for a day. The catalogue
  keeps only what a person decided (agreed prices, request quirks, defaults). In production the public APIs are not
  listed. Teammates offers any listed model under a tier (Light, Balanced, Premium): it bills at that tier's rate, and
  its list price records API cost (Settings · Models & pricing).
- Model calls go **only** through the AI module (`nooblyjs-ai-common`, imported as
  `nooblyjs-ai-common/providers`). It has the **AWS Bedrock** (SigV4-signed, AWS event-stream reply), **Google
  Vertex AI** (`streamRawPredict`, a service-account token) and **Azure** (Microsoft Foundry's Anthropic-compatible
  endpoint) adapters, built in Phase 9 with `node:crypto` only: `createProvider('bedrock' | 'vertex' | 'azure')`.
  A catalogue model is mapped to each host's id (`cloudModelId`, overridable with `<HOST>_MODEL_IDS`). The direct
  public APIs (Anthropic, OpenAI, …) are refused by `createProvider` when `NODE_ENV=production`, and
  `nooblyjs-ai-teammate` refuses to start with them. Until a provider's credentials are set, development uses the
  Anthropic API and tests the mock (`product.md` §12 Q4 is still open; all three adapters exist).
- **Every agent action is a teammate task** (Phase 6). Chat replies, Product Factory drafts and Teams
  answers call `host.service('teammates').runTask({ slug, workType, itemId, system, input, billTo,
  caller, scripted })`. Teammates checks the teammate can take work (not retired, paused, off shift or
  at the monthly cap), runs the task without tools, writes the timesheet entry (billed to the NooblyJS
  team in `billTo`) and the work item, and emits `teammate.task_started` / `task_finished` /
  `task_refused` with the §2.1 context. `costUsd` is the model cost; hours × rate is on the timesheet.
  With no model configured the mock plays the caller's `scripted` answer, so the same path serves demos.
- **The Platform check** (Phase 9): before any agent work starts, `runTask` and the Software Factory's intake ask
  `host.service('platform').checkAgentWork({ system, workType, repo, needs })`. In order it refuses a route whose
  provider is a direct API in production (`provider_not_allowed`), a repository agents may not touch
  (`repo_no_access`), and work for a system at its budget (`budget_reached`). Platform audits each refusal
  (`agent.work_refused`). It reads its files on every check (mtime-cached), so a change applies with no restart.
- **Model routing** (`data/platform/model-routes.yaml`, Platform · Settings · Models) maps work type → model →
  fallback → provider. Features ask for a *work type* (`spec-drafting`, `implementation`, `chat.reply`), never a
  model id. `runTask` uses the route's model instead of the teammate's own, tries the fallback once when the
  provider fails, and reports `modelRoute` as `<provider>/<model>` (`mock/<model>` with no model configured). A
  work type with no route keeps the teammate's model.
- Agents run in **`nooblyjs-ai-harness`** inside sandboxes (container per run or task, no outbound
  internet except allow-listed registries, staging secrets only). Factory stations and
  teammate tasks are queued with nooblyjs-core queueing and leased by workers.
- Every call is costed (`costOf`) and tagged with item, teammate and system. Platform adds each costed
  `teammate.task_finished` and `run.finished` to its spend ledger (`data/platform/spend/YYYY-MM.yaml`, by system
  and route). With **Pause all agents when a budget is reached** on, a system at its monthly budget (the Software
  Factory: its daily cap) takes no new agent work, and the month's total pauses all; `budget.reached` is emitted
  once per limit and period, and again when a budget change puts a system at or over.
- **Containers** run over a `ContainerRuntime` (`src/services/platform/containers.js`). Until a hosting target is
  chosen (`product.md` §12 Q3) it is **simulated**: teammate tasks and Factory runs register themselves while they
  run (Stop aborts or cancels them), beside sample workloads from `pools.yaml`.
- An offline **mock provider** is the default in tests and when no credentials are set.
  Seeded **scripted replies** (the mockups' answers, e.g. Ada on "what's still blocking the
  slot pilot?") make demos repeatable without a model.

## 7. Onboarding, team chat and the Teams bot

### 7.1 Profile and onboarding

- `GET/PUT /api/v1/me/profile`: work role, teams, tool connections, notification
  preferences, onboarding state, first-week checklist, dismissed hints. Stored in
  `data/people/<id>/profile.md`. `GET /api/v1/me/onboarding` returns what the four steps show (the
  roles and their copy from `data/config/work-roles.yaml`, the suggested role, the teams);
  `POST /api/v1/me/onboarding` completes it and `POST …/skip` skips it. A signed-in person with no
  `profile.md` is redirected to `/onboarding` from any page.
- The work role is pre-selected from the Entra `jobTitle` (Microsoft Graph `/me`). The
  mapping is in `data/access/job-title-roles.yaml`. In development the seeded people carry
  a job title.
- The first-week checklist is driven by events. Each task names the event that completes
  it in `work-roles.yaml` (`approval.decided` with `subject: ADR-014`, `profile.onboarded`,
  `knowledge.space_pinned`). The host listens to every event and ticks the actor's matching tasks
  (`profile.first_week_progressed`). No page marks a task done by itself, and a `PUT` can only hide
  the card. A task whose event no app emits yet stays open.
- **Work role never reaches the permission check.** Only the access role does. A test enforces this.
- "For you" pages are one page module per role, built from shared panel components. The
  server returns the role's panel data from `GET /api/v1/home/for-you`, already filtered
  by the profile's teams, or unfiltered with `?scope=all` ("Show everything"). It is built from
  the lifecycle engine's `snapshot()` service; a tile or panel whose source isn't built yet returns an
  honest zero and the phase that brings it. Signals on the PM home are read from the Product
  Factory's API in the browser.

### 7.2 Team chat

- **Threads** are scoped to an item, a repo or a channel: `data/chat/threads/<thread-id>.md`
  (scope, participants, mirrored Teams channel). The thread comes from what is on screen
  (`ctx.chat.scope({ kind, id })`): an item's Spec, Architecture and Lifecycle pages share
  `thr_<ITEM-ID>`; a repository has `thr_repo-<id>`; a channel `thr_channel-<id>`.
  `GET /api/v1/chat/thread?kind=&id=` returns it with its last 100 messages. Messages are append-only daily YAML
  streams: `data/chat/messages/<thread-id>/YYYY-MM-DD.yaml`. Messages are never edited
  in place; a correction is a new message that references the old one.
- `POST /api/v1/chat/threads/:id/messages` (the `draft` permission) parses `@mentions` against
  people and teammates (the roster comes from Digital Teammates, `src/services/agents.js`). A mention
  of an agent runs a **teammate task** (`chat.reply`) with the last 20 messages and the item's facts
  (stage, readiness, waiting on); Knowledge context arrives in Phase 8. `chat.agent_working` shows
  while it runs, then the reply is appended with its cost and model route. With a model configured the
  reply is the model's text plus at most one `facts`, `plan` or `comparison` card, read from a fenced
  `noobly-card` block and rebuilt field by field (`src/services/chat-reply.js`); anything else is
  dropped. With none, the task plays the first matching reply in `data/chat/scripts.yaml` after a
  pause of `CHAT_MOCK_REPLY_MS`. A teammate who can't take work, or Teammates switched off, gets a
  line from NooblyJS saying why, and nothing is billed. A reply can only append messages. The task runs
  in the NooblyJS process (workers come later).
- **Cards** are typed YAML objects (`plan`, `comparison`, `pr-link`, `facts`, `approval`)
  rendered by one client component (`/ui/js/components/chat-card.js`). A card that can be acted
  on keeps its state in `data/chat/cards/<card-id>.md`; messages are never edited. An
  **approval card** is answered by `POST /api/v1/chat/cards/:id/decision`. The server checks the
  access role against the card's own permission and returns 403 to anyone else, and it **always
  refuses an agent**. A plan card is applied by `POST /api/v1/chat/cards/:id/apply` (`draft`,
  people only).
- Agent content edits made from a thread (e.g. "spec v5") go through the owning app's normal
  service (`product.updateSpec()` for a spec) when a person applies them, and emit a system message.
- Quick actions (`POST /api/v1/chat/threads/:id/actions`): `summarise`, `related-adrs`, `gate-failed`.
- Chat events (`chat.message_posted`, `chat.card_decided`, `chat.card_applied`) carry `threadId`
  on the event stream, so an open panel refreshes itself; the stream sends events in the order
  they happened.

### 7.3 Microsoft Teams bot

> **Built (Phases 6 and 12):** the bot's flows, cards, sessions and endpoint (`src/teams/`, `src/routes/teams.js`).
> The endpoint accepts a **Bot Framework token** for NooblyJS's bot (`src/teams/auth.js`: RS256 with `node:crypto`,
> signing keys from the Bot Framework OpenID metadata cached a day, issuer, audience = `TEAMS_BOT_APP_ID`, expiry
> with five minutes' skew, the token's serviceUrl = the activity's), the simulator's dev key, or, in development
> only (`TEAMS_BOT_DEV_UNSIGNED=true`), an unsigned Agents Playground activity from this machine, acting as
> `TEAMS_BOT_DEV_PERSON`. Anything else is 401, audited. A valid activity is **acknowledged with 200 first** and
> handled after. Replies go out through the **Bot Connector** (`src/teams/connector.js`, client-credentials token,
> sent only to Bot Framework hosts; a Playground reply carries none). A person is matched by the `entraId` on their
> record, written when they sign in with Microsoft (`src/services/entra.js`, which also reads their job title from
> Graph `/me`, only with `AZURE_AD_READ_PROFILE=true`: that adds Graph's `User.Read` to the sign-in, which needs admin
> consent in the Acme Retail tenant. By default the sign-in asks for `openid profile email` alone, the Entra id comes
> from the sign-in itself, and the job title is not known). "post meeting notes to <item>" posts the teammate's
> notes of what was said since it joined to the item's thread (`kind: meeting-notes`); since Phase 18 the
> `teams.meeting_notes_posted` event carries the notes, and the Product app records them as an elicitation session
> of a spec (no other meeting is read). Approvals reach reviewers in
> Teams (a card in their personal chat, opted in) and by email (Graph `sendMail`, app-only) from
> `src/services/notify.js`; neither can decide. The Teams app project is `apps/msteams/noobly-bot` (manifest, package
> builder, and a forwarder on 3978 for the Agents Toolkit's tunnel and Playground).

- One Entra-registered **Teams app / bot** called "NooblyJS". Its messaging endpoint is `POST
  /api/teams/messages`. Each incoming activity's JWT is verified against the Bot Framework
  OpenID metadata (signing keys cached, issuer, audience = app id) using `node:crypto`.
  Replies go out through the **Bot Connector REST API** (`{serviceUrl}/v3/conversations/…`)
  with a client-credentials token. That's plain `fetch`, so there's no `botbuilder` dependency
  unless it proves necessary `[DECIDE]`.
- **Adaptive Cards** are YAML templates in `src/teams/cards/` (`pick-teammate`,
  `teammate-joined`, `teammate-says`, `answer`). They are filled from data and sent as JSON
  (`src/teams/cards.js`). `Action.Submit` only ever carries `{ nooblyjs-ai-host: 'add' | 'choose-someone-else' }`,
  which choose who is in the chat. Anything that decides is an `Action.OpenUrl` deep link into NooblyJS,
  never a decision taken in Teams. A test checks every template.
- **MeetingSession** (`data/teams/sessions/<conversation-id>.md`): teammate, added by,
  billed team, `joinedAt`, linked item. Messages with a timestamp before `joinedAt` are ignored,
  and the bot never fetches chat history. What was said since the join is kept in
  `data/teams/sessions/<conversation-id>/`, and is all the teammate is given. Every in and out
  message is appended to the item's thread stream and to the audit log, and its cost is billed to the
  session's team. Only a person NooblyJS knows, with the `draft` permission, may add a teammate or ask
  one a question. The billed team is the conversation's linked team (`data/teams/links.yaml`), else
  the first team of the person who added the teammate; with neither, the bot refuses.
- **Teammate identity.** A single bot can't post under several display names in Teams. The
  mockups show each teammate posting under its own name. Options: (a) one bot whose
  cards carry the teammate's name and avatar in the header, or (b) one Teams app
  registration per teammate. **Decided 2026-10-10: (a).** People address a teammate as plain
  text (`@Ada …`) or by mentioning `@NooblyJS` while the teammate is in the chat.
- **Local testing without a tenant:** with `NOOBLY_DEV_LOGIN=true`, `/dev/teams` serves a
  **Teams simulator page**. Its API (`/api/v1/dev/teams/…`) builds real Bot Framework–shaped
  activities as the signed-in person and hands them to the same code as the endpoint, with a dev
  key made at start in place of Microsoft's signature. The page draws the Adaptive Cards the bot
  sends (`data/teams/sim/`). Every bot phase can be tested in a browser before it goes near Teams.

### 7.4 The Edge extension (`apps/edge`, Phase 14)

A Manifest V3 extension in plain JavaScript (ES modules, no build), loaded unpacked in development and installed by
Edge management policy for Acme Retail people `[CONFIRM]`. A service worker opens a **side panel**; a content script on
`https://*.atlassian.net/browse/*` reads the open Jira issue when the panel asks; an options page holds the NooblyJS
address. Permissions are only `sidePanel` and `storage`, localhost, and any other NooblyJS address the person grants
(`optional_host_permissions`). No `cookies`, `webRequest` or `scripting`.

- **Sign-in is the NooblyJS session.** The extension has host permission for NooblyJS, so the panel's
  `fetch(…, { credentials: 'include' })` carries the session nooblyjs-core's authservice made (`noobly.sid`;
  `SameSite=None` on https). `GET /api/v1/shell` says who it is. Measured 2026-10-11: 401 before signing in to
  NooblyJS in a tab, the person after. For changes (chat, drafts) the CSRF cookie isn't readable from the extension, so
  Phase 14 adds `POST /api/v1/extension/token`: with a session and an `Origin` of an allowed extension id, it returns a
  short-lived token (an hour `[CONFIRM]`) for the extension's own routes only, never an approval or a Platform change.
  An Entra sign-in in the extension (`chrome.identity.launchWebAuthFlow`, an id token NooblyJS verifies against Entra's
  keys like the Teams token check) is the fallback if the session route isn't enough. **Never** a browser profile's
  email sent to the server as proof of identity (the old wiki's `/api/auth/identity` did this, unverified).
- **Talks only to NooblyJS.** Chat and drafts go through NooblyJS's API as teammate tasks (`runTask`, checked by Platform).
  The extension holds no Jira or Bitbucket credentials and calls no Jira API; NooblyJS reads Jira itself through
  `host.service('devtools')` (read only).
- **"Put in the field"** places a draft into Jira's editor on the page in the content script, only on the person's
  click. It never submits a form or clicks Jira's buttons. `test/edge-extension.test.js` holds the reader to that.
- Checks: `npm run test:edge` (the extension in Playwright's Chromium against a stand-in NooblyJS and a fake Jira page),
  `test/edge-extension.test.js` (manifest, icons, permissions).

## 8. Child projects: technical responsibilities

| Project | Ships as | Technical scope |
| --- | --- | --- |
| `nooblyjs-ai-host` | The host (`server.js`), loads hosted apps | The suite's app list and `/api/v1/shell`, built-in app modules, onboarding + profiles, Home (incl. For you) + Product Factory + Platform pages, team chat, Teams bot endpoint + simulator, mounting child modules, SSO, roles, audit middleware, SSE |
| `nooblyjs-core` | Library | Shared UI kit (`public/ui/`: frame, shell, router, components), `createShell()`, service registry (the `serverManager`), logging, caching, queueing, scheduling, notifying (Teams/Outlook), measuring, searching, auth, **FsStore**, event bus |
| `nooblyjs-ai-common` | Library, inside nooblyjs-core (`src/aiservice/common`) | Provider adapters (Anthropic, OpenAI-compatible, mock, Bedrock, Vertex AI, Azure), model discovery, model catalogue, tokens, cost, retry, SSE, front matter |
| `nooblyjs-ai-harness` | Library + CLI | Agent loop, tools, permissions, sandboxing, hooks, MCP, skills, memory |
| `nooblyjs-ai-infrastructure` | Hosted app at `/infrastructure` (Phase 9a; a section of the Software Factory from 2026-10-19 to 2026-10-20); its provisioning runs work one at a time in the NooblyJS process | Designs and their versions, apply rules by environment kind, policy checks, the provisioner interface (only `mock` today), runs with a log, drift and its sweep, the cloud cost ledger. Opens `infra-design` approvals in the lifecycle engine and carries their decisions out; asks Platform's cloud budget before a run |
| `nooblyjs-ai-factory` | Hosted app at `/factory`; its scheduler runs in the NooblyJS process (separate workers later); it mounts its Test section first (`src/services/sections.js`) and provides `quality` | Line, stations, scheduler, gates (the repository's, matched to quality attributes by name), PR delivery, handoff intake, factory events |
| `nooblyjs-ai-teammate` | Hosted app at `/teammates` (a library: no standalone server) | The source of agents (`services`: `roster`, `get`, `availability`, `provider`, `runTask`). Teammates, skills, memory, timesheets, billing (incl. per-team billing for meetings), hiring, `chat.reply` tasks |
| `nooblyjs-ai-knowledge` | Hosted app at `/wiki` (the Wiki Platform: CommonJS modules behind an adapter, its UI generated into the frame) | Spaces, pages, search, AI chat with cited answers; from Phase 8: import with PII redaction, sources, answer actions, needs-review, the process model, `services` for other apps (`provides: ['knowledge']`) |
| the lifecycle engine (`noobly/src/lifecycle/`, part of NooblyJS since 2026-10-10; before that the hosted app `nooblyjs-ai-workflows`) | Mounted by `src/noobly.js` before any hosted app: API at `/workflows/api/v1`, `host.service('workflows')`, files in `data/workflows/` | Items, stages, readiness checks, approvals + escalation (an in-process sweep on the host's clock), handoffs, send-back, stage orchestration (emits `item.stage_changed`) |
| `nooblyjs-ai-product` (a section of the Software Factory from 2026-10-19 to CHG-009) | Hosted app at `/product` + drafting workers; listed before Design and the Factory | Product Factory engine: signals, ideas (RICE), specs and versions, architecture (diagram as code, ADRs, standards check, quality attributes), UX (journeys, flows, research), UI (screens, design-system reuse, accessibility checks, handoff preview), roadmap; drafting agents per stage. Owns its screens (UI module in the frame, like Teammates) |

`nooblyjs-ai-factory` keeps its event log as daily YAML streams under `data/factory/events/YYYY/MM/<day>.yaml`
(one event a line, a `HEAD` file, a lock folder for writers in other processes). Its projections are rebuilt in
memory at start. It used SQLite before Phase 7; an old `factory.db` is ignored.

**Software Factory in NooblyJS (Phase 7).** `handoff.created` → the Factory's intake turns each work item into an
issue and a queued run (since Phase 16b the lifecycle emits it on the Engineering sign-off, with the work items the
Design handoff planned, so nothing is built before Engineering signs off), once (idempotency key `handoff:<handoffId>:<workItemId>`). A work item whose repository
is not in `data/factory/repos.yaml`, or that has neither a script nor a model, waits with the reason. The Factory
tells NooblyJS what happens through `host.events` (`run.started`, `run.finished`, `pr.opened`, `gate.failed`,
`run.asked`, `run.answered`, `run.waiting`, `merge.refused`), each with the lifecycle `itemId`. Other apps read it
through `host.service('factory')`: `runsForItem`, `runsFor`, `questionsFor(person)`, `waitingWork`, `status`.
A stuck run's question or escalation takes the `draft` permission to answer (`POST /factory/api/v1/inbox/:id`);
an approval or a policy change in the inbox still takes `approve`; an agent is always refused. A hosted run never
merges, and a refused merge is in the audit log. A repository's gate commands run unsandboxed **only** when the
host says this is development (`host.development`), never in production, and never with the process's secrets.

## 8a. Development tools: Bitbucket and Jira (Phases 11 and 13)

NooblyJS **reads** Bitbucket Cloud and Jira Cloud (Phase 11), and writes to them only through the write gate (Phase 13,
below). Reading is kept read-only by construction:
`src/services/devtools/transport.js` is the only code that calls them, a reader is bound to one https origin and
sends `GET` with no body, and a test reads the folder's source to prove nothing else reaches the network. A scoped
Jira token works only at `api.atlassian.com/ex/jira/<cloudId>` (the cloud id is read from the site's public
`/_edge/tenant_info`, without the token). A Jira search takes a filter, never JQL, is always inside the configured
projects, and drops anything else that comes back. Unit and API tests use a fake `fetch`; `npm run test:live:devtools`
makes real GET requests.

- `host.service('devtools')`: `status()`, `repositories()`, `repository(slug)`, `file(slug, path, { ref })`, `jira.search/issue/issues`,
  `links` (Jira issues linked to an item, idea or work item, kept in `data/devtools/links.yaml`) and
  `agentReads()` (what a teammate reads for a chat question: Platform's `checkAgentWork` first, every read audited
  as `agent.devtools_read`). Answers are cached in memory for five minutes; `?fresh=1` asks again.
- What NooblyJS may see is `data/config/devtools.yaml` (Bitbucket projects and repositories, Jira project keys; Owners
  change it with `PATCH /api/v1/devtools/config`). It starts with `nooblyjs-ai-harness` and `DTE`.
- Platform's repositories are imported from Bitbucket (at start, and **Refresh from Bitbucket**): what Bitbucket owns
  (branch, project, last commit) is refreshed; agent access stays NooblyJS's own record and starts read-only; a repository
  that leaves Bitbucket is marked gone, never deleted.
- Knowledge an item is built with (2026-10-10): Architecture's **Knowledge** tab searches the Knowledge Repository for
  files and folders (`host.service('knowledge').find`) and links them with a person's note ("Data relating to the
  application standard"). The Software Factory's intake reads them (`contextOf`) into each work item: what each is
  for, where it is (`[Space]\\path`) and its text.
- Where an item is built: a product's default repositories and Jira project (Product Factory catalogue), copied to a
  new idea and spec, confirmed or narrowed in Architecture (people only). The handoff refuses a work item
  outside that list and passes it to the lifecycle engine; the Software Factory's intake refuses one too.

### Writing to Jira and Bitbucket (Phase 13)

**They are production systems, so a write is sent only through one door, and only when it is allowed.**

- **The gate** (`src/services/devtools/writes.js`): every write is `writes.send({ kind, key, actor, itemId, payload,
  cause })`. It refuses an unknown kind, any asker that is not NooblyJS's own (`lifecycle`, `devtools-sync`, `factory`;
  an agent always), and a write whose facts do not hold (an approved handoff behind an issue; an issue NooblyJS linked; a
  `factory/…` branch on a repository where Platform's `pushAgentBranches` / `openPrs` are on, to that repository's
  main branch). Then the kind's **rule**: `automatic`, `off`, or `approval` (a `devtools-write` app approval in the
  lifecycle engine; an Approver decides it, and `decideApproval` sends it). Then the **three locks**:
  `DEVTOOLS_WRITES=true`, the system's mode set to `send` by an Owner, and a write credential. With a lock closed the
  write is **recorded**, not sent. Every attempt is an outbox entry (`data/devtools/outbox/<id>.yaml`: recorded,
  waiting-approval, sent, failed, refused, discarded) and an audit record (`devtools.write_*`). The same `key` is
  never sent twice.
- **The writer** (`writer.js`) can send only `KINDS`: `jira.create-issue`, `jira.transition`, `jira.comment`,
  `bitbucket.open-pr`, `bitbucket.update-pr` (each one method on one shape of path, on a fixed origin), and
  `git-push.js` only `bitbucket.push-branch`: one commit to a `factory/…` branch, never forced, the token in git's
  environment. **There is no kind that merges, declines, deletes or changes a setting.** Writing uses its own tokens
  (`JIRA_WRITE_API_TOKEN`, `BITBUCKET_WRITE_API_TOKEN`); a read token is never sent with a write.
  `test/services/devtools.test.js` reads the folder's source to hold all of this.
- **Who owns what** (`sync.js`): NooblyJS owns the lifecycle; Jira owns each issue once it exists. `handoff.created` →
  one issue per work item, linked (`links.made`). `run.started` (the Factory now sends `workItemId`) → the issue to
  In Progress; a merged pull request → Done; never backwards, and when a person moved it back in Jira NooblyJS leaves it
  (`devtools.sync_conflict`). Every `DEVTOOLS_SYNC_MINUTES` (and **Read Jira and Bitbucket now**) NooblyJS reads the
  linked issues (`workitem.status_changed`) and the open pull requests (state, reviewers, build statuses). What it
  knows is `data/devtools/work.yaml`.
- **Pull requests:** the Software Factory's Bitbucket forge (`nooblyjs-ai-factory/src/services/forge/bitbucket.js`) holds
  no token: it asks `host.service('devtools').forge.pushBranch` / `openOrUpdatePullRequest`, which go through the
  gate and add the repository's default reviewers. Intake picks it when Platform's record says the repository came
  from Bitbucket. Recorded only: nothing is pushed or opened, and the run's PR file on disk is the record.
- **A person's merge is recorded, not counted early:** when every work item of the item's handoff has a pull request
  merged by a person, `workflows.movedByMerge` is told. Since Phase 16b the Build and Test approvals move the item, so
  a merge made while the item is still in Build or Test, before them, moves nothing: it is flagged on the item
  (`mergedEarly`) as "merged in Bitbucket by …" (`item.merged`, audit `item.merged_before_approval`). A merge by NooblyJS's own Bitbucket account is ignored and audited
  (`devtools.merge_ignored`); NooblyJS never merges. **Since Phase 16e** a work item whose pull request is a lifecycle
  pull request (a story's) is told first, per pull request (`workflows.pullRequestMergedOutside`): with its Build and Test
  approvals for its commit the merge counts (`pr.merged`), without them it is flagged on the pull request and its story
  (`pr.merged_early`, audit `pr.merged_before_approval`) and not counted as done.
- **API** (`src/routes/devtools.js`): `GET /api/v1/devtools/writes` (modes, rules, outbox), `PATCH …/writes/mode`
  and `…/writes/rules`, `POST …/writes/:id/send` and `/discard` (all four `change-guardrails`, Owner),
  `POST /api/v1/devtools/sync` (`draft`), `GET /api/v1/devtools/work/:itemId`. **No route takes a write to send.**
- **Tests never write.** Jira and Bitbucket are `test/fixtures/atlassian.js` (a fake `fetch`) and a bare git
  repository on disk. There is no live write test.

### Backups and readiness (Phase 13)

- `src/services/backup.js`: a backup is a copy of `data/` in `<BACKUP_DIR>/noobly-<stamp>/` with a manifest (each
  file's size and SHA-256, audit records per day). `npm run backup` (`--list`, `--verify <name>`); nightly at
  `BACKUP_HOUR` when `BACKUP_DIR` is set, keeping `BACKUP_KEEP`. `npm run restore -- <name> [--into <dir>]` restores
  into an **empty** folder and verifies every hash and the audit log. Left out: logs, Factory workspaces and caches,
  generated secrets, temporary files.
- `npm run perf`: NooblyJS on ten times the seed volume in a temporary folder, timing the key pages' APIs (target 1 s).
- `.claude/audits/phase-13-security-review.md` (what was checked, fixed and remains) and `.claude/runbooks/`.
- `/healthz` returns `status` and `version` only.

## 8b. Cross-app services (`host.service(name)`)

**This table is the source of truth for what one app may call on another.** A hosted app returns `services` from
`register()`; NooblyJS's own services are set in `src/noobly.js`. Resolve a service when you need it (not inside
`register()`), and cope with `undefined` (the app is disabled, or this is a standalone run). Adding, renaming or
changing a function here is a shared change: update this table in the same change, and the callers.

| Name | Provided by | Functions | Main callers |
| --- | --- | --- | --- |
| `workflows` | NooblyJS, the lifecycle engine (`src/lifecycle/index.js`) | `item`, `items({ stage })`, `approvals({ type })`, `decide`, `requestApproval`, `requestAppApproval`, `closeAppApproval`, `withdrawAppApprovals`, `sendBack`, `handoff`, `handoffOf`, `syncStories`, `handoffStory`, `storiesOf` (Phase 16c: stories as items, the Design handoff per story), `signOffEngineering`, `readinessOf` (Phase 16d), `decideApproval`, `recordPullRequest`, `canMerge`, `pullRequestMerged`, `pullRequestMergedOutside`, `pullRequest`, `pullRequests`, `featuresOf` (Phase 16e: pull requests as items, `src/lifecycle/services/pull-requests.js`), `checksFor`, `overrideCheck`, `trace`, `familyOf` (Phase 16f, `src/lifecycle/services/checks.js`), `acceptIdea` (Phase 17), `recordDefect`, `decideDefect`, `defects` (Phase 20: defects as items, `src/lifecycle/services/defects.js`), `featureDeployed` (Phase 22: a released feature's stories to Operate), `waitingFor`, `counts`, `overview`, `live`, `snapshot`, `rules`, `sweep` | Product, Design, Factory (Engineering, Pull requests, Test, the pull request bridge), devtools (a Bitbucket merge), Infrastructure, Home |
| `platform` | NooblyJS (`src/services/platform/index.js`) | `checkAgentWork`, `route(workType)`, `budgetFor`, `spendFor`, `guardrail(key)`, `repository(ref)`, `repositories.list()` (each with its owning `team`, Phase 16c), `environments`, `containers`, `secrets` (references only) | every agent action (Teammates, Product, Factory, Knowledge, Infrastructure) |
| `devtools` | NooblyJS (`src/services/devtools/`): reads (Phase 11), and writes through the gate only (Phase 13) | `writes` (`status`, `outbox`, `retry`, `discard`, `setMode`, `setRule`), `sync` (`onHandoff`, `onRunStarted`, `poll`, `workFor`), `forge` (`pushBranch`, `openOrUpdatePullRequest`, for the Factory), `decideApproval`, `status`, `repositories`, `repository(slug)`, `file(slug, path, { ref })`, `jira.search` / `issue` / `issues` / `projects`, `links`; `release.record` (Phase 22: a release's Jira fix version and Bitbucket tags, as Operations) | Product (Architecture · Repositories), Factory |
| `teams` | NooblyJS | `list`, `get(id)` (NooblyJS teams, for billing and homes) | Teammates, Factory |
| `oncall` | NooblyJS (`src/services/notify.js`, Phase 23) | `alert({ title, text, link, itemId, source })`: the on-call channel in Teams (`TEAMS_ONCALL_CONVERSATION`), the simulator's in development; audited | Operations (SLO alerts) |
| `notify` | NooblyJS (`src/services/notify.js`, Phase 25a) | `tell({ to, title, text, link, key, system, itemId })`: a notice on each person's For you page (`data/notices/<id>.yaml`, the newest 50) and a message in their personal chat with the NooblyJS app in Teams when they have it; the same `key` reaches a person once; audited (`notify.told`); `notices(personId)` | Product (closing the loop), For you |
| `teammates` | `nooblyjs-ai-teammate` | `roster`, `get(slug)`, `availability(slug)`, `provider`, **`runTask(request)`**: every agent action in NooblyJS is one | chat, the Teams bot, Product, Infrastructure |
| `product` | `nooblyjs-ai-product` (the Factory's `provides` until CHG-009) | `artefactsFor`, `summary`, `readinessFacts`, `updateSpec` (a person's edit; agents refused), `linkKnowledge`, `adrFor`, `architectureFor`, `gatesFor`, `designInputs` (the spec parsed, its repositories, the container view, quality attributes and ADRs; Phase 16c), `waitingFor`, `metrics`, `checksFor(itemId)`, `trace(itemId)` (Phase 16f), `placeOf(itemId)`, `portfolios()`, `businessCases()`, `hierarchy()` (Phase 17; `readinessFacts` answers an idea's business case too), `elicitationFor(itemId)`, `elicitations()`, `decideCandidate` (a person's; agents refused), `requirementsFor(itemId)` (Phase 18; `readinessFacts` adds a spec's `questions-answered` fact, with its own words, while it has questions); Phase 23: `raiseSignal` (a signal from production, linked to its release and item), `createIdea`; Phase 25a: `evidence()` (the PM's home: notes not linked yet, Ada's suggestions, portal ideas waiting, who will be told), `importance(ids)` (customer importance in words), `peopleToTell(itemId)` | Home, chat, Knowledge, Factory, Design, Platform, Metrics |
| `design` | `nooblyjs-ai-design` (Phase 16c; the Factory's `provides` until CHG-009) | `readinessFacts(itemId)` (Design's checks, null with no Design work), `designFor(itemId)`, `items()`, `acceptRequirement` (a person's; agents refused), `trace(itemId)` (Phase 16f), `nfrCatalogue()` (Phase 18: the categories with their prompts) | the lifecycle engine (Design's readiness), Home (the Design homes) |
| `factory` | `nooblyjs-ai-factory` (`src/services/hosted.js`) | `status`, `runsForItem`, `runsFor`, `questionsFor(person)`, `waitingWork`, `intake`, `cancel(runId)`, `stopAll`, `engineeringReadiness(itemId)` (the Engineering sign-off's checks, null with no Engineering work), `engineeringFor()` (the stories in Engineer; Phase 16d), `checksFor({ itemId, itemIds })` and `trace({ itemId, itemIds })` (gates, quality attributes, required tests; runs; Phase 16f) | Home, Platform · Containers, the lifecycle engine (Engineering readiness) |
| `quality` | the Factory's Test section (`nooblyjs-ai-factory/quality`, through the Factory's `provides`; Phase 16d) | `readinessFacts(storyId)`, `casesFor(storyId, repo)`, `summaryFor(storyId)`, `stories()`, `trace(itemId)` (Phase 16f); Phase 20: `recordGates`, `recordRequired` (the Factory's verify and deliver steps as test runs), `testRuns`, `coverageOf(itemId)`, `coverage`, `gaps`, `defects`, `raiseDefect`, `decideDefect`; Phase 21: `runEnvironment({ environment, storyIds?, actor? })`, `environmentRuns({ environment?, prId? })` | the Factory (the sign-off's checks, a work item's test cases), Home (the Test analyst's home) |
| `knowledge` (the wiki returns `provides: ['knowledge']`) | `nooblyjs-ai-knowledge` | `contextFor`, `search`, `find`, `locate`, `contextOf`, `flagged`, `status`, `writePage` (Phase 23: a page another app writes for a person, e.g. a post-incident review) | Product (drafts, Architecture · Knowledge), Factory (run context), chat |
| `infrastructure` | `nooblyjs-ai-infrastructure` (`src/services/summary.js`) | `summary`, `designFor`, `environmentsFor`, `previewFor`, `waitingFor`, `environments`, `decideApproval`, `environment(name)`, `recordTests`, `previewForPr(prId)` (Phase 21), `deployRelease`, `rollbackRelease`, `releaseCandidate` (Phase 22, I10: Production only through a release) | Home · Approvals (through the lifecycle engine), Platform · Environments |
| `security` | `nooblyjs-ai-security` (Phase 19) | `draftThreatModel`, `threatModelFor`, `findingsFor`, `riskFor`, `scanChange` (the Factory's verify station), `scanEnvironment` (Phase 21: DAST and the image scan as an environment's suites), `sbomFor` (Phase 22: a release's SBOM), `acceptRisk`, `home`, `checksFor`, `trace`, `decideApproval` | Design (the threat model), Factory (scans), Home (the Security engineer, Approvals), checks and trace |
| `operations` | `nooblyjs-ai-operations` (Phases 22–23) | `releaseFor(id)`, `releases`, `decideApproval` (a release's deploy approval), `home` (the SRE), `slosFor(itemId)`, `incidents`, `outcomeReviews` (Phase 23) | the devtools write gate, the lifecycle engine (Home · Approvals) |

Events are the other way apps talk (`host.events.emit` / `on`); each app lists the events it emits in its own
`structure.md`, and metrics read them through `src/services/metrics/facts.js`.

## 9. Configuration

Environment variables (with `--env-file-if-exists=.env`):

| Variable | Purpose |
| --- | --- |
| `PORT` / `HOST` | Where to listen (`HOST` defaults to `127.0.0.1`) `[CONFIRM default port]` |
| `DATA_DIR` | Data root, default `./data` |
| `NODE_ENV` | `production` turns on secure cookies and blocks direct consumer AI APIs |
| `AI_PROVIDER` | `mock`, `bedrock`, `vertex`, `azure` (`anthropic` in development only) |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | Bedrock. `BEDROCK_INFERENCE_PREFIX` (e.g. `eu.`) for cross-region inference profiles; `BEDROCK_MODEL_IDS` (`claude-sonnet-5-5=anthropic.…`) overrides model ids |
| `VERTEX_PROJECT_ID` / `VERTEX_REGION` (default `global`) / `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_ACCESS_TOKEN` | Vertex AI. `VERTEX_MODEL_IDS` overrides model ids |
| `AZURE_AI_ENDPOINT` / `AZURE_AI_API_KEY` | Azure (Microsoft Foundry, `https://<resource>.services.ai.azure.com/anthropic`) `[CONFIRM]`. `AZURE_MODEL_IDS` maps models to deployments |
| `SESSION_SECRET` | Signs sessions and CSRF tokens |
| `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` | SSO |
| `DEVTOOLS_WRITES` / `JIRA_WRITE_API_TOKEN` / `BITBUCKET_WRITE_API_TOKEN` / `DEVTOOLS_SYNC_MINUTES` | Writing to Jira and Bitbucket (Phase 13): off unless `DEVTOOLS_WRITES=true`; the write tokens are separate from the read ones; how often the linked issues and pull requests are read (5) |
| `AZURE_AD_READ_PROFILE` | `true` adds Microsoft Graph's `User.Read` to the Entra sign-in, to read the job title (onboarding's role suggestion). Off by default: without admin consent for it, every sign-in stops at "Approval required" |
| `NOOBLY_SAMPLE_DATA` | `false`: an empty `DATA_DIR` is seeded with the system files only, no sample story (what `npm run seed:blank` does ahead of time). A blank folder stays blank (`data/config/seed.yaml`: `content: false`), and each hosted app is told through `host.sampleData` |
| `BACKUP_DIR` / `BACKUP_KEEP` / `BACKUP_HOUR` | Backups of `data/`: where (never inside `DATA_DIR`), how many are kept (14), and the hour of the nightly one (2, local) |
| `BITBUCKET_*`, `JIRA_*`, `MS_GRAPH_*` | Integrations. Bitbucket and Jira (Phase 11): `JIRA_SITE`, `JIRA_USERNAME` (the Atlassian account email), `JIRA_API_TOKEN`, `BITBUCKET_API_TOKEN`, `BITBUCKET_EMAIL` (else `BITBUCKET_USERNAME` when it is an email, else `JIRA_USERNAME`), `BITBUCKET_WORKSPACE` (default `acme`). Tokens are scoped and read-only |
| `TEAMS_BOT_APP_ID` / `TEAMS_BOT_APP_SECRET` / `TEAMS_BOT_TENANT_ID` | The NooblyJS Teams bot's Entra app: tokens are checked against its id, replies sent as it. The tenant is empty for a multi-tenant bot |
| `TEAMS_BOT_DEV_UNSIGNED` / `TEAMS_BOT_DEV_PERSON` | Development: accept unsigned Agents Playground activities from this machine, acting as that person (default `stevie`). Needs `NOOBLY_DEV_LOGIN`; refused in production |
| `MS_GRAPH_TENANT_ID` / `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` / `MS_GRAPH_SENDER` | Approval emails through Microsoft Graph (app-only, `Mail.Send`), from the sender's mailbox |
| `NOOBLY_DEV_LOGIN` | `true` enables the person picker on `/login` and the `/dev/teams` simulator. Refused in production |
| `NOOBLY_OWNERS` | Emails (comma-separated) that start as Owner when NooblyJS creates their record on first sign-in. Everyone else starts as `newPersonRole` in `data/access/roles.yaml` (Viewer). Never upgrades an existing record |
| `PUBLIC_BASE_URL` | Used for deep links in Teams cards and notifications |
| `CHAT_MOCK_REPLY_MS` | How long a scripted agent "works" before its chat reply appears, when no model is configured (default 1500) |
| `ANTHROPIC_API_KEY` | Development only, with `AI_PROVIDER=anthropic` (or unset): teammates answer with a real model. Refused when `NODE_ENV=production` |
| `API_RATE_LIMIT` | Requests a signed-in person may make to `/api/` in 15 minutes (default 500; Owners four times as many, signed-out callers a fifth) |
| `SIGN_IN_RATE_LIMIT` | Sign-in attempts from one address in 15 minutes (default 20) |

Everything else that people change at runtime lives in `data/` YAML and is edited through Platform → Settings.

## 10. Commands

```bash
npm install          # links the sibling repos via file: dependencies
npm start            # node --env-file-if-exists=.env app.js
npm run dev          # the same, restarting on changes (nodemon, a development dependency: not installed with --omit=dev)
npm run electron     # NooblyJS in a desktop window (apps/electron/main.js); test:electron loads the first page and quits
npm run seed:blank   # a data folder with the system files and NO sample content (-- --owner you@… --name "…"; --reset moves an existing folder aside)
npm run backup       # a dated, verified copy of data/ in BACKUP_DIR (--list, --verify <name>); npm run restore -- <name>
npm run perf         # NooblyJS on 10x the seed volume: how long the key pages' APIs take (target 1 s)
npm run test:edge    # the Edge extension (apps/edge) loaded into Playwright's Chromium (§7.4)
npm test             # node --test "test/**/*.test.js"   (offline, mock provider); report in .temp/test-results/unit.txt
npm run coverage     # node --test --experimental-test-coverage …
npm run seed         # (re)write seed data into DATA_DIR  (-- --reset wipes data/ first)
npm run test:e2e     # Playwright + axe per screen (dev dependency)
npm run test:live    # LIVE: one real model call through team chat (needs ANTHROPIC_API_KEY; a few cents)
npm run metrics:reconcile   # recompute every metric from raw events and diff with the screens
npm run trace:rebuild       # build the trace again from every app and diff with data/trace/index.yaml (Phase 16f)
```

Clone the repos side by side (`<workspace>/noobly`, `…\nooblyjs-core`, …) so the
`file:../` links resolve.

## 11. Testing

- **Unit:** services and repos against a temp `DATA_DIR` (`fs.mkdtemp`). Cover atomic
  writes, locks, path safety, approval rules, guardrails, budgets and cost.
- **API:** start `createApp()` on port 0 and call it with the built-in `fetch`. No supertest.
- **Rules first:** every governance rule in `product.md` §3 has a test that proves it
  refuses (an agent merge, a missing approver, a guardrail turned off, a budget reached).
- **UI:** Playwright smoke tests and axe accessibility checks per screen (dev dependency,
  as in `nooblyjs-core`). Screenshots go next to the matching mockup in the PR.
- **Bot:** contract tests replay recorded Bot Framework activities against `/api/teams/messages`
  (bad signature → 401, message before `joinedAt` ignored, approval action is a deep link).
- Each `roadmap.md` phase lists its own manual test script. Automated tests cover the same steps.
- **Results** go to `.temp/test-results/` (gitignored): `unit.txt` from `npm test`, `coverage.txt`, `live*.txt` from the
  live runs, and one Playwright folder per e2e suite (`e2e/`, `e2e-story/`, …) with traces and screenshots of failures.
  Each run replaces its own file or folder.
- No test calls a real model or network service unless it is explicitly marked live.
