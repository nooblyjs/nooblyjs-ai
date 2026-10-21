---
inclusion: always
---

# NooblyJS — Structure

> Where things live. `product.md` says what to build, `tech.md` says how, and `roadmap.md`
> says in what order. Follow these layouts in `nooblyjs-ai-host` and in every child project.

---

## 1. Workspace: the monorepo and nooblyjs-core

The projects live side by side in the `nooblyjs-ai` monorepo, so `file:../<project>` dependencies resolve;
`nooblyjs-core` is its own repo next to the monorepo (`file:../../nooblyjs-core`):

```
nooblyjs-core/                 shared services + FsStore + event bus + UI kit and shell     (library, its own repo)
  src/aiservice/common/        the AI module (imported as nooblyjs-ai-common): providers (incl. Bedrock, Vertex, Azure), model catalogue, tokens, cost, SSE
nooblyjs-ai/                   the monorepo
  nooblyjs-ai-host/            the NooblyJS app: shell, Home, Product Factory screens, Platform, chat, Teams bot
  nooblyjs-ai-harness/         agent runtime                                   (library + CLI)
  nooblyjs-ai-product/          Product: screens, artefacts + drafting, at /product   (module; a Factory section 2026-10-19 to CHG-009)
  nooblyjs-ai-design/           Design: requirements, solution, functional analysis, stories, at /design (Phase 16c; a Factory section to CHG-009)
  nooblyjs-ai-factory/         Software Factory: one app at /factory           (module + workers + CLI)
    quality/                   its Test section: test analysis (Phase 16d); runs, coverage, defects later (Phase 20).
                               The Test approvals are the Factory's own pages (src/services/pull-requests/, Phase 16e)
  nooblyjs-ai-infrastructure/  Infrastructure: designs, environments, runs, drift, cost   (module + standalone server)
  nooblyjs-ai-teammate/        Digital Teammates                               (module + standalone server)
  nooblyjs-ai-knowledge/       Knowledge Repository                            (module + workers)
  nooblyjs-ai-desktop/         projects, documents and chat for any LLM        (standalone app, not hosted)
```

Dependency direction (an arrow means "may import"). Nothing imports upwards, and child
modules never import each other. They talk through events, through services the host hands
out (`options.host.service(name)`, §2a), and, from the browser, through each other's HTTP APIs:

```
nooblyjs-ai-host ──► nooblyjs-ai-factory (with its sections), nooblyjs-ai-knowledge, nooblyjs-ai-teammate
              │                 │                          │                    │
              └────────┬────────┴─────────┬────────────────┴────────────────────┘
                       ▼                  ▼
                  nooblyjs-core         nooblyjs-ai-harness ──► nooblyjs-ai-common
                       ▲                                      ▲
                       └──────────── (all may use) ───────────┘
```

## 1a. Steering: nooblyjs-ai-host owns everything shared

**`nooblyjs-ai-host` owns everything shared: the product, the lifecycle, governance rules, the hosted-app contract and the
cross-app services.** The single roadmap, and the whole-factory view across the SDLC, live in the monorepo root's
`.claude/steering/` (decided 2026-10-19). Each other repo owns only what is true of itself. A rule is written
once, in the repo that owns it; other repos link to it and never copy it, because copies drift.

| Topic | Owner | Where |
| --- | --- | --- |
| The product: lifecycle stages, every screen, roles and the permissions matrix, governance | nooblyjs-ai-host | `product.md` |
| Stack, storage, API conventions, agents and model routing, config, commands | nooblyjs-ai-host | `tech.md` |
| The lifecycle engine (items, stages, approvals, handoffs) | nooblyjs-ai-host | `tech.md`, `src/lifecycle/` |
| The hosted-app contract (`register()`, `options.host`, the UI module, standalone mode) | nooblyjs-ai-host | this file, §2a |
| The cross-app services (`host.service(name)`: who provides what, who calls it) | nooblyjs-ai-host | `tech.md` §8b |
| The roadmap: every phase for every repo, the hosted-app checklist, the hosted apps' open work | monorepo root | `../.claude/steering/roadmap.md` |
| The whole factory across the SDLC: stages, systems, trace, checks, target stack | monorepo root | `../.claude/steering/{product,design,stack}.md` |
| The shared rules in brief, loaded in every other repo | nooblyjs-ai-host | `.claude/steering/nooblyjs-ai-shared-rules.md`, copied as `.claude/steering/nooblyjs-ai.md` |
| What an app does: its screens, capabilities, data and open points | that repo | its `product.md` |
| Where its code and data live, the `services` it returns and the events it emits | that repo | its `structure.md` |
| Its own values for the contract, its deviations from the defaults, and its state today | that repo | its `tech.md` |

How it works:

- **Kiro and Claude Code only load the steering of the repo they are opened in**, and Kiro resolves file references
  from that repo's root. So each repo gets **`.claude/steering/nooblyjs-ai.md`**: the shared rules in brief, with a table
  of where each shared topic lives in `../nooblyjs-ai-host`. It is generated from `.claude/steering/nooblyjs-ai-shared-rules.md` by
  `npm run steering:sync` (in nooblyjs-ai-host), and `test/steering.test.js` fails while any copy is out of date. Never
  edit a copy.
- **A repo's own `tech.md`** starts by pointing at `NOOBLY.md` and then gives only its values (mount path, entry,
  name, which `host` members it relies on) and where it differs from §2a (Teammates has no standalone server,
  the wiki mounts at `/wiki` from `index.mjs`). It does not restate the contract.
- **One roadmap.** Work in any repo is a phase (or part of one) in the root `../.claude/steering/roadmap.md`, with
  its spec in this repo's `.claude/specs/`. The hosted apps' old roadmaps are history in their
  `docs/roadmap-history.md`; what was still open in them is in the root roadmap, "Hosted apps: open work". This repo's
  `roadmap.md` is only a pointer (phases 0–15 moved to the root on 2026-10-19).
- **Changing a shared rule** is one change in nooblyjs-ai-host: edit the owning doc (and `nooblyjs-ai-shared-rules.md` if the brief
  changes), run `npm run steering:sync`, and commit the copies in each repo with it.

## 2. The `nooblyjs-ai-host` repository

```
noobly/
  app.js                    the composition root: createApp({ config }) builds the Express app, its middleware
                            (helmet, rate limits, session, Passport), nooblyjs-core and sign-in, then mounts NooblyJS;
                            `node app.js` also creates the HTTP/HTTPS server, listens and shuts down gracefully
  package.json              "type": "module"; deps: express, js-yaml, helmet, compression, express-rate-limit,
                            express-session, passport, nooblyjs-core (file:), nooblyjs-ai-common (file:), child modules (file:)
  .env.example              every variable from tech.md §9, with safe defaults
  src/
    noobly.js                 prepareData() (seed on first start) and mountNoobly(): audit, CSRF, sign-in routes,
                            the shell API, the hosted apps, the frame, 404 and errors
    config.js               reads the environment once, validated (dev login, SESSION_SECRET, AUTH_METHOD, HTTPS)
    utils/createServer.js   HTTP or HTTPS (HTTPS_ENABLED, HTTPS_KEY_PATH, HTTPS_CERT_PATH) and the HTTP→HTTPS redirect
    utils/StructuredLogger.js   JSON logs in production
    startup/startupRunner.js    times each startup step and reports when the port is bound
    hosted-apps.js          loads data/config/hosted-apps.yaml, calls each child's register(app, serverManager, options)
                            and adds what it returns to the shell's app list (§2a)
    middleware/             auth.js · csrf.js · roles.js · audit.js · errors.js · dev-login.js
    routes/                 one file per API area, matching /api/v1/<area>
      home.js               overview (joins the lifecycle engine's counts with a card per system), activity, for-you, metrics (GET /api/v1/home/metrics)
      me.js                 profile, onboarding (content, complete, skip) and the /onboarding page
      chat.js               thread for what is on screen, messages, quick actions, card decisions and apply
      platform.js           /api/v1/platform: repositories, containers, settings (routes, budgets, guardrails,
                            integrations), environments, secrets, members, the audit log (Phase 9)
      events.js             GET /api/v1/events/stream (SSE: every event, as its Activity row)
      internal.js           /internal/v1 worker callbacks
      teams.js              POST /api/teams/messages (the bot endpoint: it verifies the caller itself, no session or CSRF)
      dev.js                the dev clock API and the Teams simulator's API (only when NOOBLY_DEV_LOGIN=true)
    services/               business rules; one file per concern
      profiles.js (profile.md, the first-week checklist ticked from events) · work-roles.js (the six roles and
      their onboarding copy) · teams.js (teams, the matrix rows, members, invite) · for-you.js (the role homes) ·
      chat.js (threads, messages, mentions, cards; an agent's reply is a teammate task) · chat-reply.js (what a
      model's reply may carry) · agents.js (agent teammates, from Digital Teammates)
      platform/             host.service('platform') (Phase 9): index.js (checkAgentWork, spend → budget.reached,
                            secrets, environments) · files.js (YAML read fresh, mtime-cached) · repositories.js ·
                            routes.js (model routes) · budgets.js (budgets and the spend ledger) · guardrails.js ·
                            containers.js (the simulated ContainerRuntime) · governance.js (members, audit query)
    lifecycle/              the lifecycle engine (was the repo nooblyjs-ai-workflows until 2026-10-10): index.js (register, the
                            services other apps call as host.service('workflows')) · services/engine.js (items, stages,
                            approvals, handoffs, send-back, the sweep; a fact with its own words is an extra
                            readiness check, Phase 18) · services/pull-requests.js (Phase 16e: pull
                            requests as items, their Build and Test approvals, merges, the story and its feature
                            following them) · services/checks.js (Phase 16f: its checks, one check's override, its
                            part of the trace) · services/views.js (Overview, Lifecycle,
                            Approvals) · routes.js (/workflows/api/v1) · repos.js · stages.js · working-days.js ·
                            config.js (approval rules, readiness) · seed/ (the PRD-031 story's items and approvals)
    teams/                  the Teams bot: activities.js · cards.js + cards/*.yaml · sessions.js · bot.js · simulator.js
      platform.js · guardrails.js · budgets.js · audit-log.js · events.js · metrics/ (facts.js · compute.js · index.js) ·
      checks.js (an item's checks from every app, one shape, Phase 16f) · trace.js (the trace index, Phase 16f) ·
      metrics/places.js (spend by value stream and per item, Phase 17)
      devtools/ (transport.js: the reader, GET only · writer.js: the only HTTP writer, listed kinds only · git-push.js: a factory/… branch, never forced
                 writes.js: the write gate, locks, rules and the outbox · sync.js: work items in step with Jira and Bitbucket · jira.js · bitbucket.js · index.js)
      backup.js             backup, verify and restore of data/ (Phase 13)
      clock.js (business time, movable in development) · activity.js (events → Activity rows)
    teams/                  Teams bot
      verify.js             Bot Framework JWT verification
      connector.js          Bot Connector REST client
      sessions.js           MeetingSession handling (joinedAt, billing team)
      cards/                Adaptive Card templates as YAML: pick-teammate.yaml · teammate-joined.yaml · answer.yaml
    repos/                  one per entity: people.js · teams.js · profiles.js · threads.js · messages.js · repositories.js …
    seed/                   index.js (writes seed on first start) · data/ (seed files mirroring data/)
    util/                   ids.js · dates.js · errors.js · md-table.js
  public/                   the host's own UI modules (Home, Product Factory, Platform) and the login and onboarding pages (§3)
  apps/msteams/noobly-bot/    the NooblyJS Teams app: manifest + package builder (npm run package), Agents Toolkit setup, and a forwarder to /api/teams/messages
  apps/msteams/noobly-app/    a Teams tab project from the Agents Toolkit template (React + Vite; not built into NooblyJS)
  apps/edge/                the NooblyJS Edge extension (Manifest V3, plain JS): side panel, sign-in from the NooblyJS session, Jira page reader (product.md §5.11)
  apps/electron/            the desktop window (npm run electron): main.js starts or opens NooblyJS; no NooblyJS code lives here
  test/                     mirrors src/: test/services/*.test.js, test/routes/*.test.js, test/teams/*.test.js
    fixtures/               temp DATA_DIR builders, recorded Bot Framework activities
    e2e/                    Playwright + axe, one spec per screen (dev only)
  .claude/                  every document of this repo (there is no docs/ folder: it moved here on 2026-10-21)
    steering/               product.md · tech.md · structure.md · roadmap.md (a pointer to the root) ·
                            nooblyjs-ai-shared-rules.md (the source of every child's nooblyjs-ai.md, npm run steering:sync) ·
                            brief/ (design input, read-only)
    specs/                  per-phase Kiro specs (requirements, design, tasks) · bugs-and-changes/ (BUG-NNN, CHG-NNN)
    phases/                 phase-NN-summary.md written at the end of each roadmap phase
    adr/                    ADR-NNN-<slug>.md (decisions about NooblyJS itself, e.g. ADR-001-host-owned-shell.md)
    guides/                 how-tos for people building on NooblyJS (porting-an-app.md)
    runbooks/               operating NooblyJS: start-stop, backup-restore, budget, sync, tokens, writes
    audits/                 dated audits and reviews (security, production readiness, mocking-audit.md)
    learning/ · skills/     tutorials (the learning skill) and project skills
    style/                  brand assets
```

## 2a. Hosted applications: how child apps attach to `nooblyjs-ai-host`

`nooblyjs-ai-host` is the **one host process**. Child projects with a UI are **hosted applications**.
`nooblyjs-ai-host` loads each one, passes it the **Express app** and the **`serverManager`** (the
nooblyjs-core `ServiceRegistry` instance that `nooblyjs-ai-host` has already initialised), and the child
**attaches itself** under its own path.

In the browser, `nooblyjs-ai-host` owns **one frame**: the suite rail, the module sidebar (nav, badges,
status card, signed-in person), the content area and the docked chat panel. A hosted app
doesn't draw any of that. It provides a **UI module**, an ES module that the frame loads into
the content area. Moving between apps is client-side, so the frame (and an open chat thread)
stays in place. Why: `.claude/adr/ADR-001-host-owned-shell.md`.

| Child project | Mount path | Has a UI module (`public/js/module.js`) | API base |
| --- | --- | --- | --- |
| `nooblyjs-ai-product` (the Product Factory; provides its services as `product`, its name) | `/product` | yes | `/product/api/v1/…` |
| `nooblyjs-ai-design` (provides `design`; shows Product's Architecture pages) | `/design` | yes | `/design/api/v1/…` |
| `nooblyjs-ai-factory` (with its Test section since 16d; provides `quality`) | `/factory`; the section at `/factory/quality` | yes (one module: the section's routes are in it) | `/factory/api/v1/…`, `/factory/quality/api/v1/…` |
| `nooblyjs-ai-infrastructure` | `/infrastructure` | yes | `/infrastructure/api/v1/…` |
| `nooblyjs-ai-teammate` | `/teammates` | yes | `/teammates/api/v1/…` |
| `nooblyjs-ai-knowledge` (the Wiki Platform; provides `knowledge`) | `/wiki` | yes | `/wiki/api/v1/…` |
| the lifecycle engine (**not a child project**: `noobly/src/lifecycle/`, mounted by `src/noobly.js` before any hosted app; it was the hosted app `nooblyjs-ai-workflows` until 2026-10-10) | `/workflows` (reserved) | no (API only; its screens are Home's Overview, Lifecycle and Approvals) | `/workflows/api/v1/…`, and `host.service('workflows')` |
| `nooblyjs-core`, `nooblyjs-ai-common`, `nooblyjs-ai-harness` | — | libraries, not hosted | — |

The Software Factory owns everything under `/factory`, its section included: its page URLs
(`/factory/quality/test-analysis`) answer with the frame and the Factory's UI module draws them. Product and Design are
apps of their own (CHG-009, 2026-10-21), listed before the Factory in `hosted-apps.yaml` so the rail reads Product,
Design, Factory. Product was the hosted app `nooblyjs-ai-product` at `/product` until 2026-10-19, then the Factory's
Product section (`/factory/product`, CHG-005); Design was a Factory section from Phase 16c. On the first start after
CHG-009, an install's `data/factory/product` and `data/factory/design` move back to `data/product` and `data/design`,
and their entries go into `hosted-apps.yaml` above the Factory's (`src/hosted-apps.js` `UNFOLDED`, `foldData`); an old
`/factory/product/…` or `/factory/design/…` address lands on the same page in the app (the Factory's
`public/js/pages/moved-app.js`). Infrastructure was a section of the Factory from 2026-10-19 to 2026-10-20 and is the
hosted app `nooblyjs-ai-infrastructure` at `/infrastructure` again (CHG-007), moved back the same way. An app's `provides` may be a list (other names for its services, like the wiki's
`knowledge`) or an object (names with services of their own, like the Factory's `quality`). API-only apps have no rail item,
and their router calls `next()` for anything that isn't theirs.

**This section is the only copy of the contract** (§1a). A child repo's `tech.md` gives only its own values and
how it differs, and its `.claude/steering/nooblyjs-ai.md` (generated) points here. When you change the contract, change the
child code that depends on it in the same change; the child docs need no edit unless one of their values changes.

The `nooblyjs-ai-host` host keeps `/` (Home), `/platform`, `/login`, `/onboarding`, `/api/v1/…`
(including `/api/v1/shell`), `/api/teams/messages`, `/services/…` (nooblyjs-core dashboards) and
`/ui/…` (the shared UI kit). Home, Product Factory and Platform are the host's **built-in apps**:
they're described with the same fields as a hosted app and use the same module contract, so
all six rail items behave the same.

### Layout of a hosted application

```
noobly-ai-<name>/
  index.js                  the entry point nooblyjs-ai-host imports: exports register() (contract below)
  server.js                 standalone dev server: builds its own Express app, serverManager and shell, then calls register()
  package.json              "main": "index.js"; "exports": { ".": "./index.js" }
  src/
    routes/                 API routers, mounted by register() under <mountPath>/api/v1
    services/ repos/ workers/ seed/ util/
  public/                   static files only: no index.html (the host's frame is the page)
    css/<name>.css          only what the shared UI kit doesn't cover; every selector scoped (see below)
    js/
      module.js             the UI module: exports the app's route table (contract below)
      pages/                one module per screen, e.g. factory: line.js · runs.js · inbox.js · campaigns.js · metrics.js
  test/
    register.test.js        mounts the app into a bare Express app with a test serverManager and shell
    module.test.js          the route table is valid; every page module exports render()
```

### The `register()` contract

```js
// nooblyjs-ai-factory/index.js
/**
 * Attach the Software Factory to a host Express app.
 * @param {import('express').Express} app   the host's Express app (nooblyjs-ai-host, or server.js when standalone)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {object} [options]
 * @param {string} [options.mountPath='/factory']
 * @param {string} options.dataDir          this app's own folder, e.g. <DATA_DIR>/factory
 * @param {object} options.host             what the host shares (below)
 * @returns {Promise<HostedApp>}
 */
export async function register(app, serverManager, options = {}) { … }

// options.host
// {
//   express,        the host's express module: build routers and static handlers with it, never your own copy
//   auth,           middleware: a signed-in person (req.person) or 401 / redirect to /login
//   requireRole,    (permission) => middleware: 403 + audit record when the access role lacks it
//   can,            (accessRole, permission) => Promise<boolean>: the same check, for a rule decided in a service
//   audit,          middleware for writes, and audit.record({ actor, action, target, … }) for anything else
//   events,         events.emit(type, payload) → appended to data/events/ and published on the SSE stream;
//                   events.on(type, fn) to react to other apps
//   store,          FsStore rooted at options.dataDir (atomic writes, locks, path safety)
//   people,         read-only: people, teams, access roles
//   clock,          { now() } like Date: business time (approval targets, reminders, "today"). NooblyJS's dev clock
//                   (/dev/clock) can move it, so read it instead of Date.now()
//   service,        (name) => the `services` object another app returned, or undefined; resolve it when
//                   you need it, not inside register(), because apps register in order
//   frame,          the frame page handler (fallback for UI routes)
//   publicBaseUrl,  for deep links in notifications and Teams cards
//   logLevel,       the host's LOG_LEVEL, so an app's own log lines are as loud as NooblyJS's
//   development,    true only when NooblyJS runs with the dev sign-in. An app may relax a safety default for a
//                   developer's machine on it (the Factory runs a demo repository's gates unsandboxed), and must
//                   still refuse when NODE_ENV is production
//   service(name),  another app's `services`; also 'teams' (the NooblyJS teams: list(), get(id)), from the host
//   sampleData,     false in a data folder made by `npm run seed:blank`: write your system files only (rules, settings,
//                   libraries), and no sample content. seed({ content }) defaults to it. Undefined or true: the seed story
//   checksCsrf,     true: the host checks the CSRF token on every change before the app sees it, so the app
//                   adds no CSRF check of its own (the browser sends the noobly.csrf cookie value as X-CSRF-Token)
// }

/**
 * @typedef {object} HostedApp                what the host's shell needs, without loading any browser code
 * @property {string} name                   'factory'; also the CSS scope (data-module="factory")
 * @property {string} label                  'Factory' (rail) · sidebar title is label.toLowerCase() unless `title` is set
 * @property {string} [title]                sidebar title when it isn't the lower-cased label ('product factory')
 * @property {string} [tag]                  the small pill next to the sidebar title ('Lifecycle')
 * @property {string} icon                   a /ui/js/icons.js name
 * @property {string} mountPath              '/factory'
 * @property {{ entry: string, styles?: string[] }} [ui]   e.g. { entry: 'js/module.js', styles: ['css/factory.css'] },
 *                                           relative to mountPath (an entry starting with '/' is used as is);
 *                                           omitted for an API-only app, which gets no rail item
 * @property {NavItem[]} [nav]               sidebar rows: { key, label, path, icon?, group?, badge?, requires? }
 * @property {{ name: string, icon?: string, hint?: string }[]} [groups]   how the sidebar heads each `group`
 * @property {(req) => Promise<AppStatus>} [status]   this person's badges and sidebar status card
 * @property {object} [services]             server-side functions other apps may call via host.service(name)
 * @property {string[]} [provides]           other names the same services answer to: the wiki returns ['knowledge'], so
 *                                           host.service('knowledge') finds it whatever the app is called
 * @property {(opts: { reset: boolean, content?: boolean }) => Promise<void>} [seed]   writes this app's seed files into dataDir;
 *                                           `content: false` (a blank NooblyJS) means its system files only, no sample story
 *                                           (first start, and `npm run seed -- --reset` in nooblyjs-ai-host)
 * @property {() => Promise<void>} close     stops timers, workers and queues
 */
```

`NavItem.path` is relative to the mount path (`/runs`). `group` gives the sidebar sections
(Platform's *Build* / *Govern*; the Factory's *Product* / *Design* / *Engineering* / *Build* / *Test*): each is drawn as its own block
(`role="group"`, named by its header) with a divider above it, and `groups` may give each one a kit icon and a
one-line `hint` under its name (2026-10-19, CHG-006). A group with no entry in `groups` shows its name only. `badge` names a key in `AppStatus.badges`. `requires` names a
permission from the matrix (`product.md` §6). The host leaves out rows the person can't use,
but that only hides them: the API still enforces the permission. `AppStatus` is
`{ badges?: { [badgeKey]: number }, card?: StatusCard }`, where every part of the card is optional:

```js
// StatusCard: the sidebar card under the nav (the mockups' "Agents working now", "Line health")
{
  pill:  { text: 'All systems healthy', tone: 'ok' | 'info' | 'warning' | 'danger' | 'muted' },
  items: [{ label: 'Agents working now', value: '3 agents · 14 items in flight' }],
  meter: { label: 'Spent today', value: '$46 of $400', ratio: 0.115, tone: 'ok' | 'warning' | 'danger' },
  lines: ['Next review in 2 days'],
}
```

Before an app has real numbers, it returns honest zeros (`0 agents · 0 items in flight`, `$0`),
never sample data.

What `register()` must do:

1. Build **one `options.host.express.Router()`** and mount it once: `app.use(mountPath, router)`.
   It never adds routes outside its mount path, and never calls `app.listen()`. Route patterns
   use Express 5 syntax (`/*splat`, not `*`).
2. Serve `public/` statically under `mountPath` with
   `host.express.static(publicDir, { index: false, redirect: false })`. Without `redirect: false`,
   the bare mount path (`/factory`) answers 301 to `/factory/`, because `public/` is a folder.
   The other defaults stay (`max-age=0` plus ETag, so a restart's new code is picked up). For any other non-API `GET` under it
   (`/factory/runs/214`), call **`options.host.frame`**, which returns the frame page. The
   child never serves its own HTML shell.
3. Mount its API under `mountPath + '/api/v1'`. It uses the **host's** `auth`, `requireRole`
   and `audit` middleware from `options.host`, so sign-in, permissions and the audit log are
   the same everywhere.
4. Take shared services from `serverManager`: `serverManager.logger()`, `.cache()`,
   `.queue()`, `.scheduling()`, `.notifying()`, `.measuring()`, `.searching()`,
   `.getEventEmitter()`. It **never calls `serverManager.initialize()`**, because the host
   owns that.
5. Read and write files only under `options.dataDir`, through the host's `store`. Shared
   things (events, audit, people, teams) go through `options.host`. It never `import`s
   another child app. Server-side calls go through `options.host.service(name)` or events.
6. Return its **`HostedApp`** description: the rail entry, the UI module's entry, the sidebar
   `nav` (which Home and search also use to link into it), an optional `status()`, and a
   `close()` for graceful shutdown. The host builds the rail and sidebar from this data
   without loading the app's browser code.
7. Be **idempotent and isolated**: a failure in `register()` is logged and the host starts
   without that app (its rail item shows "Unavailable"). It doesn't crash NooblyJS. A `status()`
   that throws or takes longer than 1 s is left out of that response. It never blocks the shell.

How `nooblyjs-ai-host` loads them (`src/hosted-apps.js`), listed in `data/config/hosted-apps.yaml`:

```yaml
apps:
  - package: nooblyjs-ai-factory     # file:../nooblyjs-ai-factory in package.json
    mountPath: /factory
    enabled: true
  - package: nooblyjs-ai-teammate
    mountPath: /teammates
    enabled: true
  - package: nooblyjs-ai-knowledge
    mountPath: /wiki
    enabled: true
```

```js
// noobly/src/hosted-apps.js (sketch)
const shell = createShell({ rail: SUITE_RAIL });   // from nooblyjs-core; built-in apps (Home, Product, Platform) added first
for (const cfg of config.apps.filter((a) => a.enabled)) {
  try {
    const { register } = await import(cfg.package);
    const appDir = path.join(dataDir, cfg.mountPath.slice(1));
    const hosted = await register(app, serverManager, {
      mountPath: cfg.mountPath,
      dataDir: appDir,
      host: { express, auth, requireRole, audit, events, store: storeFor(cfg.mountPath), people,
              service: (name) => services.get(name), publicBaseUrl, frame: shell.frame },
    });
    if (hosted.services) services.set(hosted.name, hosted.services);
    if (hosted.seed && isEmpty(appDir)) await hosted.seed({ reset: false });
    shell.add(hosted);                     // rail, sidebar, search; close() for shutdown
  } catch (err) {
    log.error(`could not mount ${cfg.package}`, err);
    shell.unavailable(cfg.mountPath);      // rail item shows "Unavailable"
  }
}
app.use(auth, shell.router);               // GET /api/v1/shell and /api/v1/shell/status
```

The rail order is fixed by the suite (`product.md` §5.1): Home, Product, then the hosted apps
with a UI in `hosted-apps.yaml` order, then Platform. The host adds its own built-in page
fallbacks (`/product/*`, `/platform/*`, `/`) after every hosted app has registered.

### One frame for every app

The frame, its router and the UI kit live in **`nooblyjs-core`**: `public/ui/` in the browser and
`createShell()` on the server. `nooblyjs-ai-host` and a standalone child serve the same frame, without copies.

**The frame page.** `shell.frame` returns one static page for every UI URL and every person.
It checks the session first and sends a signed-out person to `/login`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NooblyJS</title>
  <link rel="stylesheet" href="/ui/css/tokens.css">
  <link rel="stylesheet" href="/ui/css/base.css">
  <link rel="stylesheet" href="/ui/css/shell.css">
  <link rel="stylesheet" href="/ui/css/components.css">
  <script type="module" src="/ui/js/frame.js"></script>
</head>
<body>
  <a class="skip-link" href="#noobly-content">Skip to content</a>
  <div id="noobly-shell"></div>  <!-- frame.js renders: rail · sidebar · <main id="noobly-content" data-module> · chat dock -->
</body>
</html>
```

The real page is `nooblyjs-core/public/ui/frame.html`. The rail (`#noobly-rail`), sidebar
(`#noobly-sidebar`), content (`#noobly-content`, `tabindex="-1"`) and chat dock (`#noobly-chat`) are
static elements, and `#noobly-announce` is a polite live region that reads out each new page title.

**Boot.** `frame.js` calls `GET /api/v1/shell`, which returns
`{ person, permissions, features, apps: [{ name, label, title, tag, icon, mountPath, ui, nav, state, apiOnly, rail, phase }] }`.
`nav` is already filtered for this person, and `permissions` (the access role's list) backs
`ctx.can()`. `state` is one of `ready`, `unavailable`, `not-installed` or `not-running-here`.
The frame drops `apiOnly` apps. `rail: false` apps (`/dev`) can be routed to but aren't on the rail.
`phase` is the roadmap phase in which a not-installed app arrives. `features.events` turns on the
EventSource (Phase 2). For a first-login person, the call can return `{ redirect: '/onboarding' }`
instead. `frame.js` draws the rail and sidebar, then routes the current URL.
`GET /api/v1/shell/status` returns `{ [appName]: AppStatus }` for badges and status cards.
The frame refetches it after SSE events arrive (at most once every 3 s), and every 60 s.

**Navigation.** The frame intercepts clicks on any same-origin `<a href>` that some app owns. It
leaves alone `/api/`, `/ui/`, `/services`, `/login`, `/logout`, `/healthz`, in-page `#` anchors,
links with `target` or `download`, and links marked `data-reload`. Pages write normal links. The router picks the app whose `mountPath` is the
longest prefix of the URL (Home, at `/`, gets whatever no other app claims). The first time an
app is opened in a tab, the frame adds its `ui.styles` stylesheets and calls `import()` on its
`ui.entry`. It then matches one of the module's routes. It aborts the current page's
`ctx.signal`, calls that page's `destroy()`, and renders the new page into `#noobly-content`. It
also updates `data-module`, the active sidebar row, `document.title`
(`<title> · <label> · NooblyJS`) and the chat panel. Focus moves to the new page's `h1`, so keyboard and
screen-reader users land on it. Back and forward re-route. A change of `#hash` alone doesn't.

**The module contract.** An app's `public/js/module.js` exports its route table:

```js
// nooblyjs-ai-factory/public/js/module.js
export const routes = [
  { path: '/',         redirect: '/line' },
  { path: '/line',     nav: 'line', title: 'Line', page: () => import('./pages/line.js') },
  { path: '/runs/:id', nav: 'runs', title: 'Run',  page: () => import('./pages/runs.js') },
];
export function init(ctx) {}   // optional: runs once, the first time the app is opened in a tab
```

Route fields: `path` (relative to the mount path, with `:param` segments; case-insensitive,
trailing slash optional, first match wins) · `nav` (the sidebar
row to highlight) · `title` · `page` (a lazy import) · `requires` (a permission; without it, the
frame shows a "not for your role" card) · `layout: 'full'` (hides the sidebar and chat dock, e.g.
Knowledge Graph) · `redirect` (relative to the mount path) · `meta` (anything the page wants back as
`route.meta`; the built-in placeholders keep their phase and mockup there).

```js
// nooblyjs-ai-factory/public/js/pages/runs.js
export async function render(view, { params, query, ctx, route }) { … }   // renders into view; route = the matched entry
export function destroy() {}                                       // optional
```

| `ctx` member | What it is |
| --- | --- |
| `ctx.api` | the kit's fetch wrapper, bound to `<mountPath>/api/v1` (`ctx.api.get('runs/214')`). `ctx.hostApi` is bound to `/api/v1` |
| `ctx.sse.on(topic, fn)` | a subscription on the tab's one EventSource |
| `ctx.signal` | an AbortSignal that fires when the person leaves the page. `ctx.api` and `ctx.sse` use it by default |
| `ctx.navigate(path, { absolute, replace })` | client-side navigation. `path` is relative to the mount path; `absolute: true` goes into another app (`'/product/specs/PRD-031'`) |
| `ctx.app` | `{ name, label, mountPath }` of the app the page belongs to |
| `ctx.person`, `ctx.can(permission)` | who is signed in, and what their access role allows (a UI hint only; the API enforces) |
| `ctx.chat.scope({ kind, id })` | points the docked chat panel at the item, repo or channel on screen (`item`, `spec`, `architecture`, `ux`, `ui` share the item's thread; `repository`; `channel`). Pages that don't call it show no panel. A page about the same thing as the last one keeps the open panel and what is typed in it |
| `ctx.setTitle(text)` | for titles known only after loading (`PRD-031 · Spec`) |
| `ctx.isCurrent()` | false once a newer navigation has started. Check it after each `await`, before touching `view` |

**Rules for code that shares one page:**

- **CSS is scoped.** Every selector in `css/<name>.css` starts with `[data-module="<name>"]`,
  and a test checks this. Anything meant to look the same everywhere belongs in the kit.
- **A page touches only `view`.** Toasts, dialogs and the chat panel go through the kit and
  `ctx`. Don't use globals. Listeners on `window` or `document` are attached with
  `{ signal: ctx.signal }`.
- **The kit is imported by absolute URL** (`/ui/js/html.js`), so all apps share one copy of each
  kit module, including one API client and one EventSource. Imports inside an app are relative
  (`./pages/line.js`). They resolve against the module's own URL, so the app works under any
  mount path.
- **Failures stay in the content area.** If `import()`, `init()` or `render()` throws, the
  content area shows an error card ("Factory couldn't load this page", with **Retry**) and the
  error is logged. The rail, sidebar, chat and other apps keep working. Retry re-imports the
  module with a cache-busting query.
- **Components return strings.** Kit components (`/ui/js/components/index.js`) return escaped
  `SafeHtml` built with the `html` tagged template, so they run (and are tested) in Node too.
  Pages compose them, set `view.innerHTML` once, then attach listeners. Untrusted text is only
  ever interpolated through `html`.

**Porting an app that had its own page** (sidebar, router, sign-in): follow
`.claude/guides/porting-an-app.md`. `nooblyjs-ai-teammate` is the worked example: a route table over a bridge
that runs the old pages unchanged, CSS scoped with `nooblyjs-core/scripts/scope-css.js` with its tokens pointed at the
kit's, and kit class collisions reverted inside the app's pages.

**Document mode (transitional).** An app that hasn't been ported yet can return
`ui: { mode: 'document' }`. Its rail item is then a normal link (a full page load), and the app
serves its own page. It doesn't pass the hosted-app checklist in this mode, and new apps never use it.

### Standalone mode (development of one child)

`npm start` in a child runs its `server.js`. That file initialises its own `serverManager`,
Express app and `createShell()` from `nooblyjs-core`, and serves `/ui/`. It calls
`register(app, serverManager, { mountPath: '/factory', host: { …, frame: shell.frame } })`,
passes the result to `shell.add()`, and listens. Hosted and standalone run the same code path
and the same frame. In standalone mode, the rail items for other apps show "Not running here",
and the chat panel is hidden because chat belongs to `nooblyjs-ai-host`.

Standalone mode is optional. `nooblyjs-ai-teammate` has none: it is a library only NooblyJS runs, and its tests mount
`register()` on a stand-in host (`test/fixtures/host.js`) instead. The wiki's standalone server is `server.mjs`
(`npm run start:nooblyjs-ai-host`).

## 3. The browser apps

### 3.1 Shared UI kit (`nooblyjs-core/public/ui/`, served at `/ui/` by every host)

```
ui/
  css/
    tokens.css              design tokens as custom properties (brief §7), nothing else
    base.css                reset, typography, focus, skip link
    shell.css               rail, sidebar, content grid, chat dock, responsive stacking
    components.css          buttons, pills, cards, tables, kanban, timeline, meters, chevrons, chat bubbles
  fonts/                    Figtree 400–700, Bricolage Grotesque 500–800, JetBrains Mono 400/500 (woff2, self-hosted, OFL licences beside them)
  img/                      favicon.svg, logos
  frame.html                the one page every UI route returns (§2a)
  package.json              { "type": "module" }, so Node (the tests) treats the kit as ES modules
  js/
    frame.js                boots the frame: GET /api/v1/shell, draws the shell, starts the router, loads app modules (§2a)
    shell.js                renders the suite rail, module sidebar (nav, badges, status card, person) and chat dock
    router.js               History-API router: picks the app by longest mount path, then the module's route; aborts ctx.signal
    api.js                  fetch wrapper (CSRF, JSON, errors), bound to a base (ctx.api, ctx.hostApi)
    sse.js                  one EventSource per tab, topic subscribe/unsubscribe
    chat.js                 the docked chat panel's controller: load, post, card and chip actions, live updates
    html.js                 escaping tagged template
    markdown.js             sanitising Markdown renderer (Phase 2)
    icons.js                inline SVG stroke icons
    format.js               money, durations, relative time
    components/             index.js (re-exports all) · button.js · status-pill.js · stat-card.js · list-row.js ·
                            data-table.js · kanban.js · timeline.js · meter.js · process-chevron.js ·
                            stage-strip.js · swimlane.js · checklist.js · chips.js · layout.js (pageHead, card, notice) ·
                            chat-panel.js (messages, working line, chips, composer) ·
                            chat-card.js (plan · comparison · pr-link · facts · approval)
```

The server half of the kit is `createShell({ express, auth, can, permissionsFor, features, log })`
in `nooblyjs-core/src/shell` (CommonJS). It returns `{ router, frame, uiDir, builtIn(desc, { position:
'start'|'end' }), add(hosted, entry), unavailable(entry, meta), notInstalled(entry, meta), list(),
appsFor(person), statusFor(req) }`. `/dev/styleguide` in `nooblyjs-ai-host` shows every component in every state.

### 3.2 The host's pages (`noobly/public/`)

Home, Product Factory and Platform are built-in apps. They load into the same frame as the
hosted apps, so there's no host `index.html`.

```
public/
  (sign-in is server-rendered by src/pages/login.js, with the kit CSS plus css/login.css)
  (onboarding is server-rendered by src/pages/onboarding.js: no rail, the kit CSS plus css/onboarding.css,
   and the module js/pages/onboarding/steps.js)
  css/<area>.css            only when a screen needs layout no component covers; scoped like a hosted app's
                            (home.css: Overview, Lifecycle, Approvals, Activity)
  js/
    modules/                one UI module per built-in app (same contract as a hosted app's module.js). Their
                            descriptions (rail, nav, status) are in src/built-in-apps.js, with an absolute
                            ui.entry ('/js/modules/home.js'), because noobly/public is served at the root
      home.js               mountPath /         (/, /home/approvals, …)
      platform.js           mountPath /platform
      dev.js                mountPath /dev      (no rail item; only when NOOBLY_DEV_LOGIN=true)
    pages/
      home/                 for-you.js (greeting, filter row, tiles, first week) · for-you-pm.js ·
                            for-you-architect.js · for-you-developer.js (each role's panels) ·
                            overview.js · lifecycle.js · item.js (one item: history, readiness, send back) ·
                            approvals.js · activity.js · metrics.js · teams.js · lib.js (shared helpers)
      onboarding/           steps.js
      product/              board.js · spec.js · architecture.js · ux.js · ui.js · reviews.js · handoffs.js
      platform/             repositories.js (+ the detail panel) · containers.js · environments.js · settings.js ·
                            secrets.js · members.js · audit.js · lib.js; styles in public/css/platform.css
      dev/                  teams-simulator.js · styleguide.js · clock.js
      placeholder.js        "Not built yet: Phase N", naming the mockup from route.meta, until a screen is built
```

### 3.3 Hosted apps' pages (in their own repos, see §2a)

Each app's `public/js/module.js` lists these pages in its route table.

```
nooblyjs-ai-factory/public/js/pages/     line.js · runs.js · inbox.js · campaigns.js · metrics.js
nooblyjs-ai-teammate/public/js/pages/   roster.js · profile.js · timeline.js · billing.js · hire.js · team-memory.js · settings.js · admin.js
nooblyjs-ai-knowledge/public/js/pages/   ask.js · spaces.js · process-model.js · collections.js · sources.js · graph.js · review.js · contributions.js · access.js
```

URLs: `/` and `/home/approvals`, `/product/specs/PRD-031`, `/platform/repositories/acme__slots-api`
(host); `/factory/runs/214`, `/teammates/team`, `/wiki/#/Enterprise%20Space/Business%20processes/L0%20Enterprise%20Process%20Model.md` (hosted apps; the wiki keeps its own
navigation in the hash).

## 4. The data folder (`data/`, gitignored)

```
data/
  config/                 settings.yaml · organisation.yaml · hosted-apps.yaml · work-roles.yaml (the six work
                          roles: onboarding copy, tools, first-week tasks and the event that completes each)
  access/                 roles.yaml (permissions matrix) · job-title-roles.yaml
  people/<person-id>/     PERSON.md (name, email, access role, job title) · profile.md (work role, teams, onboarding)
  teams/<team-id>.md      people + teammates, focus areas, Teams channel
  checks/<item>.yaml      each check's last result, so check.recorded says what changed (Phase 16f)
  trace/index.yaml        the trace index: each item's nodes and links, derived, rebuilt (npm run trace:rebuild; Phase 16f)
  workflows/              (owned by the lifecycle engine, noobly/src/lifecycle/; the folder keeps its name)
    items/<ITEM-ID>.md    IDEA-018, PRD-031, STORY-031-1, PR-031-1-1, slots-api-482 … (stage, status, owner, work, history;
                          a story's passedTestAt; a pull request's `pr`: run, commit, evidence, Phase 16e)
    approvals/<apr_id>.md · handoffs/<hof_id>.md   (a pull request's Build and Test approvals carry its commit, `sha`)
    approval-rules.yaml (Who approves what) · readiness.yaml (checks per stage, and a pull request's, Phase 16e)
  chat/
    threads/<thread-id>.md                   scope (item | repo | channel), participants, Teams mirror
    messages/<thread-id>/YYYY-MM-DD.yaml     append-only
    cards/<card-id>.md                       cards that can be acted on, and what was decided or applied
    scripts.yaml                             scripted agent replies, played when no model is configured
  teams/sessions/<conversation-id>.md        Teams MeetingSession; <conversation-id>/YYYY-MM-DD.yaml is what was said since the join
  teams/links.yaml                           which NooblyJS team and item a Teams conversation belongs to
  teams/scripts.yaml                         teammates' introductions and scripted answers in a meeting
  teams/sim/                                 the Teams simulator: meetings.yaml and each meeting's transcript (development)
  factory/                (owned by nooblyjs-ai-factory)
    events/YYYY/MM/YYYY-MM-DD.yaml           the event log, one event a line; events/HEAD is the last sequence number
    leases.yaml · config.json                who is working which run; the operator's settings
    repos.yaml                               repository name → folder (the only repositories a handoff can start runs on)
    repos/web-storefront/                    the seed's demo repository (development and demos)
    scripts/<work-item-title>.json           scripted agents for the seed story (used when no model is configured)
    intake/<handoff-id>/<work-item-id>.md    each work item as an issue file
    forge/ · artifacts/ · workspaces/        PR files with their evidence, run artefacts, git worktrees
  product/                (owned by nooblyjs-ai-product; data/factory/product from 2026-10-19 to CHG-009)
      signals/<id>.md · ideas/<OPP-ID>.md · specs/<PRD-ID>.md · roadmap.yaml
      architecture/<PRD-ID>/  diagram.md · adrs/ADR-014.md · quality-attributes.md
      ux/<PRD-ID>/            journey.md · flows/<flow>.md · research/<study>.md
      ui/<PRD-ID>/            screens/<screen>.md · handoff.md
      business-cases/<id>.md  an idea's or epic's business case (Phase 17)
      elicitation/<PRD-ID>.md stakeholders, sessions, candidates, requirements, the NFR walk, questions (Phase 18)
  design/                 (owned by nooblyjs-ai-design; data/factory/design from Phase 16c to CHG-009)
      nfr-catalogue.yaml · items/<itemId>/design.md (requirements, systems, NFRs, features, interfaces, technical, stories)
    quality/              the Test section (Phase 16d)
      test-policy.yaml · test-analysis/<storyId>.md (the cases: given/when/then, level, automated, systems, status)
    engineering/architecture/<storyId>.md   each story's application architecture, per system (Phase 16d)
    testing/              runs.yaml · defects/<id>.md (CHG-008's sample, until Phase 20)
  infrastructure/         (owned by nooblyjs-ai-infrastructure; in data/factory/infrastructure/ 2026-10-19 to 2026-10-20)
    designs/<id>.md · designs/<id>/versions/vN.md   a design, and each approved version kept as it was
    environments/<name>.md · runs/<id>.md · drift/<id>.md   (a destroyed environment keeps its file)
    blueprints.yaml · policies.yaml · apply-rules.yaml · promotion-paths.yaml · budget.yaml · agent.yaml
    cost/ledger.yaml · sweep.yaml            the cloud cost ledger; when the drift sweep last ran
  teammates/              (owned by nooblyjs-ai-teammate: <slug>/TEAMMATE.md, memory/, timesheets/)
  wiki/                   (owned by nooblyjs-ai-knowledge, the Wiki Platform; JSON records, its own layout)
    spaces/spaces.json · spaces/<slug>/files/…   the spaces and their pages (Markdown). A process-model page carries
                                                 a fenced `process-model` block (level, code, band, parent, linked-items)
    knowledge/sources.json                       what was imported, when, how many documents, what was redacted
    knowledge/answers.json · flags.json          answers from search (newest 500); documents flagged for review
    imports/<name>/                              an export folder an operator puts here to import
  platform/
    repositories/<owner>__<repo>.md          agent access, the five "what agents may do" toggles, build & test
    pools.yaml · base-images.yaml · model-routes.yaml · budgets.yaml · guardrails.yaml
    environments.yaml                        Platform's list until Infrastructure (which owns them) is hosted
    secrets.yaml                             secret REFERENCES per repository (vault:staging/NAME), never values
    spend/YYYY-MM.yaml                       the spend ledger: per day, by system and by model route; which
                                             budgets were reached (regenerable from events/)
  events/YYYY/MM/YYYY-MM-DD.yaml             append-only, every domain event
  audit/YYYY/MM/YYYY-MM-DD.yaml              append-only, every write
  metrics/rollups/YYYY-MM-DD.yaml            a past day's metric facts; regenerable from events (delete freely)
  metrics/sample-history.yaml                marks that the seed's sample history was written (once)
  dev/clock.yaml                             the dev clock's offset (development only; delete it for the real time)
  logs/                                      nooblyjs-core logging
  core/                                      nooblyjs-core auth/session files
```

Each module writes only under its own folder. Shared folders (`events/`, `audit/`, `people/`,
`teams/`, `access/`) are written only through `nooblyjs-core` / `nooblyjs-ai-host` services.

## 5. Naming conventions

| Thing | Convention | Example |
| --- | --- | --- |
| Files (JS, CSS) | kebab-case | `for-you-architect.js`, `chat-panel.js` |
| Entity files | the entity id, or slug | `PRD-031.md`, `ADR-014.md`, `ada-quill/TEAMMATE.md` |
| Lifecycle ids | `<PREFIX>-<NNN>` | `IDEA-018`, `PRD-031`, `ADR-014` |
| Generated ids | `<prefix>_<random>` | `apr_8f3k2`, `hof_2k9x1`, `thr_PRD-031`, `msg_x92k`, `card_a71` |
| Person / teammate ids | kebab-case slug of the name | `lerato-m`, `rhea-voss` |
| Repository files | `<owner>__<repo>` | `acme__slots-api.md` |
| Events | `<entity>.<past-tense verb>` | `approval.decided`, `teammate.joined_meeting` |
| API paths | `/api/v1/<area>/<plural-noun>[/:id[/<verb>]]` | `/api/v1/chat/cards/card_a71/decision` |
| YAML/front-matter keys | camelCase | `draftedBy`, `joinedAt` |
| CSS classes | component-first, kebab-case | `.status-pill`, `.status-pill--warning`, `.chat-bubble--agent` |
| Tests | `<unit>.test.js` next to its mirror path | `test/services/onboarding.test.js` |

## 6. Where to put new things

- **A new screen:** add it to the app that owns it. A Home, Product or Platform screen goes
  in `noobly/public/js/pages/`. A Factory, Teammates or Knowledge screen goes in that child's
  `public/js/pages/`, with its API in the child's `src/routes/`. Either way, add a route to the
  app's module (`module.js`, or `noobly/public/js/modules/<area>.js`) and, if it has a sidebar
  row, a `nav` entry. Add an e2e spec in `noobly/test/e2e/` that runs against the hosted path.
- **A new shared component:** add it to the UI kit in `nooblyjs-core/public/ui/`, never to one app.
- **A new hosted app:** give it the §2a layout, a `register()` that returns its `HostedApp`
  description, and a `public/js/module.js`. Add it to `hosted-apps.yaml`, which also sets its
  place on the rail. It must pass the hosted-app checklist (`roadmap.md`).
- **A new entity:** add a repo in `src/repos/`, a folder in `data/` (update §4), seed files in
  `src/seed/data/`, and the event names it emits.
- **A new rule or policy:** a service function plus a "refuses" test. If people should change
  it at runtime, it is configured in `data/**/*.yaml`.
- **A decision about NooblyJS itself:** `.claude/adr/ADR-NNN-<slug>.md`.
- **Design input:** `.claude/steering/brief/` is read-only. Never edit the mockups.
