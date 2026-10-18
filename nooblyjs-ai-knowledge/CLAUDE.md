# CLAUDE.md

Guidance for Claude Code in this repository.

## Part of NooblyJS (read first)

This repo is hosted by **NooblyJS** (`../nooblyjs-ai-host`) at `/wiki` (the root `index.mjs` exports `register()`). Before changing how it starts, serves
pages, signs people in, stores data, emits events or calls models, read
`.claude/steering/nooblyjs-ai.md` (the shared rules, imported below: noobly owns them, and the full contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a), `.claude/steering/tech.md` (this repo's values and how it differs) and
`.claude/steering/structure.md` (this repo's layout as a hosted app). The source of truth is
`../nooblyjs-ai-host/.claude/steering/structure.md` §2a. Where anything below conflicts with those, they win.

@.claude/steering/nooblyjs-ai.md

## Knowledge on top of the wiki (NooblyJS Phase 8)

Everything new on the server is `src/wiki/knowledge/` (CommonJS), registered from `src/wiki/routes/index.js`
(`routes/knowledgeRoutes.js`) and built in `src/wiki/initialize.js` as `services.knowledge` (null when the space
managers are missing). Search itself is not touched: it only asks the indexer and filters hits.

| File | What |
|---|---|
| `redact.js` | pure: ID numbers, email addresses, phone numbers → `[REDACTED …]`, with counts. Names are not redacted |
| `store.js` | `<appBaseDir>/knowledge/{sources,answers,flags}.json`, written by tmp + rename, one writer at a time |
| `importer.js`, `sample-export/` | an export folder (`export.json` + one folder per space) → spaces, redacted files, the index, a source record. The seed imports the bundled sample once. An operator's own export goes under `<appBaseDir>/imports/<name>`; a path is never taken from a request |
| `answers.js` | the answer when NO AI agent is configured (the top three sources' own sentences, cited `[1] [2] [3]`, saying no model wrote it), and a source as a link a spec can keep |
| `processModel.js` | pure: the fenced `process-model` block (level, code, name, band, parent, order, linked-items) and the model around one page |
| `access.js` | hosted: NooblyJS's permissions through `host.can` (`draft` for answer actions, `approve` to clear a flag, `change-repo-access` to import), an agent always refused, each write in NooblyJS's audit log. Standalone: signed in, and `admin` for the last two |
| `index.js` | ties them together, and is what `index.mjs` returns as `services` (`contextFor`, `search`, `flagged`, `status`; `provides: ['knowledge']`) |

- `/ai/chat/search` no longer answers 400 without an agent: it answers from passages, keeps every answer with
  sources (`answerId`), and `/ai/chat/status` says `searchWithoutModel`.
- Pages saved from answers (`Answers/…`) are never used as the sources of a new answer.
- UI, in the standalone sources and then `npm run port:ui`: `screens/sources.js` and `screens/needs-review.js`
  (datasources), `modules/answerActions.js` (the three buttons under an answer), `modules/processModelController.js`
  and `renderProcessModel` in `public/js/markdown/markdown-parser.js` (the block is a placeholder the controller
  fills from `/knowledge/process-model`).
- Tests: `test/redact.test.mjs`, `test/knowledge.test.mjs` (the six NooblyJS test steps on a real registry, offline).

## Hosted in NooblyJS (`index.mjs`)

NooblyJS imports `index.mjs` (`package.json` `main`/`exports`) and calls `register(app, serverManager, { mountPath =
'/wiki', dataDir, host })`. It mounts ONE Express 5 router and returns the app description (name `wiki`). It is `.mjs`
because the rest of this package is CommonJS. NooblyJS lists the app in `../nooblyjs-ai-host/src/seed/data/config/hosted-apps.yaml`
(and each install's own `data/config/hosted-apps.yaml`) and depends on it as `file:../nooblyjs-ai-knowledge`.

**Server: the existing modules run unchanged behind an adapter.** `src/hosted/platform.cjs` builds the core services
`app.js` builds, but from the host's already-initialised registry (instances named `wiki`, so cache, search, queue and
schedules do not mix with NooblyJS's) and hands `src/initialize.js` a facade instead of the Express app.
`src/hosted/legacyApp.cjs` is that facade and the whole translation:

| Standalone | Hosted |
|---|---|
| `/applications/wiki/api/x` | `/wiki/api/v1/x` |
| `/api/x` (datasources) | `/wiki/api/v1/ds/x` |
| `/applications/wiki/{media,avatars}` | `/wiki/{media,avatars}` |
| anything else (`/wizard`, the legacy views, the datasources UI gate) | not mounted |
| `:name(*)` and a trailing `*` (Express 4) | `{*name}` (Express 5), joined back into the one string handlers expect |
| `app.set/get('spaceManager')`, `req.app.get(…)` | the facade's own settings (falls back to the host app) |
| Socket.IO `io.emit` | `host.events.emit('wiki.file_changed' \| 'wiki.user_notified' \| 'wiki.broadcast_sent')` |

- **Sign-in needs no translation**: NooblyJS runs the same nooblyjs-core Passport, so `req.user` / `req.isAuthenticated()` mean
  what they mean standalone. Everything under `/api/v1`, `/media` and `/avatars` is behind `host.auth` first, so the
  paths that are public standalone (`/config`, `/health`) need a session here, and **bearer-token clients (daemon,
  extensions, MCP) cannot write**: NooblyJS refuses a change without its CSRF token before this app sees it.
- **Data** goes to `dataDir` (`../nooblyjs-ai-host/data/wiki`). `WIKI_APP_BASE_DIR` points it at an existing `.application` instead.
- `src/initialize.js` now THROWS where it used to `process.exit(1)`, so a failed start cannot take NooblyJS down
  (`app.js` still exits, in its own `start().catch`).
- `close()` stops the workflow bridge only. The file watcher and the modules' `setInterval`s have no stop.
- The modules still use `global.*` (`eventBus`, `io`, `treeCache`, …), now inside the NooblyJS process.

**Browser: the standalone UI is GENERATED into the frame's shape — never edit `public/app`, `public/vendor`,
`public/css/wiki-app.css` or `public/css/wiki-ds.css`.** `npm run port:ui` (`scripts/port-wiki-ui.mjs`) reads
`src/web/wiki/public`, `public/js/markdown/*` and the datasources screens (`src/web/datasources/public`, below) and
writes them out with the same few mechanical changes in every file, so the standalone UI
keeps working from one source until it is retired. `npm test` fails when the output is stale (`--check`).

| The standalone page does | In the frame |
|---|---|
| calls `/applications/wiki/api/…`, `/api/…` | URL literals rewritten to `/wiki/api/v1/…` (**the mount path is baked in**: URLs sit inside HTML strings. `--mount` regenerates for another) |
| `fetch`, `XMLHttpRequest` | `__wikiEnv.fetch` / `.XMLHttpRequest`: the same call plus NooblyJS's `X-CSRF-Token` on a change |
| `history.pushState`, `location.pathname`, `popstate` | `__wikiEnv.history` / `.location` / `.onPopState`: the wiki believes it is at `/wiki/<Space>/<path>`; the address bar says `/wiki/#/<Space>/<path>`. The frame redraws the page on every PATH change, so the wiki's own navigation lives in the hash |
| `DOMContentLoaded` | `__wikiEnv.onReady` (the markup is in the frame) |
| Socket.IO client | `__wikiEnv.io`: fed from the frame's event stream. That stream carries no payload, so each `wiki.file_changed` signal pulls `GET /changes?since=` and dispatches what it returns |
| `window`/`document` listeners | `__wikiEnv.windowEvents` / `.documentEvents`: silent while another NooblyJS app is on screen |
| `document.body.appendChild` (dialogs, toasts) | `__wikiEnv.portal`: `#wiki-portal[data-module="wiki"]`, so scoped CSS still reaches them |
| Bootstrap, bootstrap-icons, marked, Prism, highlight.js, mermaid from CDNs | copied from `node_modules` to `public/vendor` (the frame's policy is `script-src 'self'`) |
| `styles.css`, `wiki.css`, `onboarding.css`, Bootstrap | one stylesheet, every selector under `[data-module="wiki"]` (nooblyjs-core `scopeCss`) |

Hand-written, and the only places to change frame behaviour: `public/js/hosted/env.js` (`__wikiEnv`),
`public/js/pages/wiki.js` (the one page: puts the markup in the frame, loads the classic scripts in order, starts the
app ONCE per tab and keeps its DOM when the person visits another NooblyJS app), `public/js/module.js` (routes: `/` plus
one per depth, since the frame's router has no wildcard and a link to `/wiki/Space/doc.md` must still land),
`public/css/wiki-hosted.css` (full-width layout; hides the wiki's own logo, brand and sign-out).

**The datasources screens (standalone `/applications/datasources`) are at `/wiki/datasources/…`**: Dashboard,
Workflows, Schedules, Execution history, Repositories, Spaces, Agents, Prompts, Users (user activity) and Settings.
- **Getting there:** the wiki is `layout: 'full'`, so the frame's sidebar is not on screen beside it. The way in is
  the **Administration** link `pages/wiki.js` puts in the wiki's top bar; the screens themselves use the frame's
  usual layout, and their sidebar rows are the app's nav (`index.mjs` `NAV`, grouped) with **Wiki** as the way back.
- **Open to everyone signed in to NooblyJS.** No row, route or link asks for a permission. Standalone, their API takes
  the `Datasources Administrator` / `admin` role (`roleValidationMiddleware`); hosted, `src/hosted/platform.cjs`
  sets `datasourcesOpenToSignedIn`, which keeps the sign-in and drops the role. Standalone is unchanged.
  **One exception, and it is the host's:** the Settings console calls nooblyjs-core's `/services/settings/api`, which
  NooblyJS guards itself (`../nooblyjs-ai-host/app.js` `servicesAuth`: a core admin, i.e. an Owner). Anyone else sees
  "Insufficient privileges" there. Per-space rules (`spaceFilingRoutes`, a private space's files) also still apply.
- **One page serves them all** (`public/js/pages/datasources.js`). Standalone, `js/app.js` drew a UIService shell
  and gave every screen to the app's own state Router; here the frame is the shell, so `app.js` is NOT ported and
  the page gives the Router its `#mainContent` and the screen the route names (`meta.screen`). The Router has no
  URLs of its own, so `Router.onNavigate` (a hook in `js/core/router.js`, unset standalone) moves the address bar
  and the highlighted row when a screen opens another one. A sub-screen (`workflowEdit`, `repository`,
  `user-activity-detail`) keeps its parent's row and URL, so a refresh there lands on the parent list.
- **Only the scripts `index.html` loads are ported**, in its order (`public/app/ds/scripts.js`); the folder also
  holds an older generation of screens (`workflowEditor.js`, `scheduleManager.js`, `pages/*`) nothing loads.
- **Kept apart from the wiki in the one document:** `__wikiEnv.ds` has its own "on screen" flag for page-wide
  listeners and its own portal, and `css/wiki-ds.css` puts every rule under `[data-module="wiki"] .ds-root`
  (`datasources.css` restyles `.btn`, `.hidden`, `.page-title`, … which the wiki also uses). A dialog must be INSIDE
  `.ds-root` inside a `[data-module="wiki"]` element: the two on one element match nothing.
- CodeMirror 5 (step and code editors) is the `codemirror` dev dependency, copied to `public/vendor/codemirror`.
  The settings console and the space file browser are nooblyjs-core's own scripts, served by the host at
  `/services/{settings,filing}/scripts`; `/services` keeps its own protection and is not under NooblyJS's CSRF check.
- The eight inline `on…=""` attributes in these screens are bound by `pages/datasources.js` `bindInlineHandlers`.
- A space called `datasources` would lose its `/wiki/datasources/…` deep links to these routes (its `#/` links work).

**Known gaps in the frame** (all work standalone):
- Inline `on…=""` attributes in generated HTML do not run. `pages/wiki.js` `bindInlineHandlers` covers the eight that
  exist (image `onerror` fallbacks, two `onclick`s). Write new handlers with `addEventListener`.
- Profile → API documentation (swagger-ui from a CDN) and `documentcontroller`'s `new Function` are blocked by the policy.
- The wiki's theme/branding (`/js/theme.js`) is not loaded: NooblyJS owns the look. Nunito Sans is dropped with it.
- Datasources' Socket.IO events (`workflow:*`) arrive without their payload, so nothing listens for them.
- The datasources screens show no live run updates for the same reason (`core/realtime.js` finds no Socket.IO
  client): Refresh, or reopen the screen.
- A few modules inject their own `<style>` at run time (`.we-root …`), which is outside the scope rule.
- It still draws its own top bar and navigation tree (`layout: 'full'` hides NooblyJS's sidebar). Not yet checked: axe,
  phone width, NooblyJS's e2e walk (`../nooblyjs-ai-host/test/e2e`, where the app is listed but disabled).

Tests: `npm test` (`node:test`, `test/*.test.mjs`; Express 5 is the `express5` alias): the contract on a stand-in host
(`register.test.mjs`, `module.test.mjs`) and the modules on a real registry (`platform.test.mjs`).

## Project Overview

**noobly Wiki Platform v2.0** — unified multi-platform app (Node.js/Express, port 9101):
- **Datasources Module** — Workflow automation, data pipeline orchestration
- **Wiki Module** — Real-time collaborative knowledge management

**Status:** 72% complete. Phases 1–5.5 done (core arch, backend unification, Vite, RBAC, unit/E2E tests, performance, Spaces Filing). Backend: 56+ unit tests (36+ passing), 31 E2E Playwright tests.

## Architecture

```
app.js (port 9101)
  ├── Express + Socket.IO + Passport Auth
  ├── Service Registry (digital-technologies-core)
  ├── Datasources Module (src/datasources/)
  │   ├── SpaceManager, WorkflowManager, WorkflowExecutor, WorkflowScheduler, WorkflowBridge
  │   └── Routes: /api/spaces/*, /api/workflows/*, /api/connections/*, /api/settings/*, /api/agents/*
  └── Wiki Module (src/wiki/)
      ├── DataManager, EventBus, FileWatcher, SearchIndexer, AIService
      └── Routes: /applications/wiki/api/*
```

**Key points:**
- Shared services from `digital-technologies-core`: Cache, Queue, Workflow, Scheduling, Filing, Search, Auth, AI, Logger
- File-based storage in `./.application/` (JSON) — no database required
- FileWatcher (Chokidar, 300ms debounce) → EventBus → Socket.IO broadcast
- Each module initializes via `src/{datasources,wiki}/initialize.js`; `src/initialize.js` wires both onto the app that the root `app.js` creates
- Auth: local (file-based), Google OAuth2, Bearer tokens (24hr)

## Ports

| Port | Service |
|------|---------|
| **9101** | Unified backend (primary) - `npm start` |
| 9101 | Legacy datasources only - `npm run start:datasources` |
| 11002 | Legacy wiki only - `npm run start:wiki` |
| 3001 | Datasources UI dev server |
| 3002 | Wiki UI dev server |
| 11100 | Wiki sync daemon — live status dashboard (`applications/daemon/wiki`, `DASHBOARD_PORT`) |

## Layout

Server and web frontends live in ONE `src/` folder with ONE `package.json` / `node_modules` at the repo root
(merged 2026-10-09 from the old `backend/` and `applications/` folders):

```
app.js                    composition root (Express, Socket.IO, Passport, core registry, port)
src/
  initialize.js           wires the API modules onto the app (was backend/app.js)
  datasources/ wiki/ shared/   API modules (was backend/src/*)
  configuration/          worker-thread activities (was backend/configuration)
  swagger/                OpenAPI specs
  web/datasources/ web/wiki/   web frontends: index.js mount module + public/ (was applications/web/*)
scripts/                  cert generation, one-off migrations, port-wiki-ui.mjs (was backend/scripts)
workflows/                the workflow definitions and their steps, one folder per group (was the sibling workflows repo)
tests/backend/            Jest suites
public/                   root landing page and shared assets; ALSO the NooblyJS frame's files (js/module.js, js/pages, js/hosted,
                          and the generated app/, vendor/, css/wiki-app.css, css/wiki-ds.css)
index.mjs · src/hosted/ · test/   the NooblyJS hosted entry (see "Hosted in NooblyJS")
```

**Workflows live in this repo, in `workflows/`** (moved in 2026-10-10 from the sibling workflows repo).
`WorkflowBridge`, `WorkflowManager` and the `run-workflow` activity all load from `<repo root>/workflows`
(`path.resolve(__dirname, '../../../workflows')`); `WORKFLOWS_PATH` overrides it, and the three must agree or a
workflow lists in the UI but cannot be scheduled. Wherever this file says "the sibling workflows repo" or
`noobly-app-wiki-workflows`, read `workflows/`: the lockstep rules below still hold, between two folders of one repo.
- A step reaches this app's code by relative path: `require('../../../src/shared/…')` from
  `workflows/<group>/steps|services|utilities/` (one more `../` under `tests/`). The copies that came across still
  said `../../../digital-technologies-knowledge/backend/src/…`, which resolves to nothing here.
- Bare dependencies resolve from the root `node_modules`, so the registry is `require('nooblyjs-core')`
  (`digital-technologies-core` is the old name and is not installed). There is no `workflows/package.json`.
- A step's fallback for the app's files is `<repo root>/.application` (`../../../.application`), the standalone
  default; hosted, the platform passes `appBaseDir` and that fallback is not what is used.

## Setup & Installation

```bash
npm install        # once, at the repo root — there are no per-folder installs any more
```

**Prerequisite:** `nooblyjs-core` must sit beside this repo (`package.json` links it as `../nooblyjs-core`):
```
parent-directory/
├── nooblyjs-core/            ← required
└── nooblyjs-ai-knowledge/
```

## Running

```bash
npm run dev:web             # auto-reload (nodemon)
npm start                   # production

# Frontends on their own static server (optional, connect to port 9101)
npm run dev:web-datasources # → localhost:3001
npm run dev:web-wiki        # → localhost:3002
```

## Commands (run from the repo root)

```bash
npm start              # Production (port 9101)
npm run dev            # Dev with auto-reload
npm run tests          # Run all tests
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report → coverage/
npm run kill           # Kill process on port 9101
```

## Testing

- Framework: Jest; config: `"jest"` field in the root `package.json`
- Tests live in `tests/backend/`; jest runs from the repo root (`modulePaths` points at the root `node_modules` so steps required out of the sibling workflows repo resolve their bare deps)
- Test dirs: `tests/backend/{components,datasources,integration,performance}/`
- `tests/backend/configuration/` holds workflow scripts (`*.script.js`, etc.), not unit tests — not matched by `testMatch`
- Timeout: 10s per test

```bash
npm run tests                                                  # all tests
npm run tests -- tests/backend/datasources/pathSanitizer.test.js  # single file
npm run tests -- --testNamePattern "API"                       # pattern match
```

## Configuration

**`.env`** at the repo root (copy from `.env.example`):
```bash
PORT=9101
NODE_ENV=development
SESSION_SECRET=change-me-in-prod   # CHANGE IN PRODUCTION
GOOGLE_CLIENT_ID=<id>              # Optional OAuth
GOOGLE_CLIENT_SECRET=<secret>
CORS_ORIGINS=/^chrome-extension:\/\//,http://localhost:3000  # Regex or plain URLs, comma-separated
AI_MODEL=tinyllama:1.1b
OLLAMA_URL=http://localhost:11434
LOG_LEVEL=info
```

**Chrome extension config:** `applications/chrome/wiki/config.json` — set `defaultServerUrl` and `supportedHosts` for your deployment.

**Data storage:** `./.application/` — `data/auth/`, `documents/`, `spaces/`, `workflows/`, `wiki-files/`, `logs/`

**Configuration files** all live under `<APP_BASE_DIR>/configuration/`: `settings/settings.enc.json` (core settings service — grouped key/value, AES-256-GCM at rest, behind the datasources Settings screen), `settings/settings-agents.json` (AI agents), `settings/settings-general.json`, `prompts/prompts.json`. **Every path is derived from `APP_BASE_DIR`** — app.js once passed the settings service a literal `'../.application/settings/settings.enc.json'`, which the provider resolves with `path.resolve()` against `process.cwd()`, so it was a second relative root that could (and did) drift from `APP_BASE_DIR`: the store ended up in `<APP_BASE_DIR>/settings/` while everything else sat in `configuration/settings/`, and an earlier populated store was silently orphaned. Never give a core service a relative filepath — join it onto `APP_BASE_DIR`.

**EVERY per-document artifact is FOLDER-LOCAL, in `<that document's folder>/.system/`. Nothing mirrors the space tree from a root namespace.** `shared/utils/filePolicy.js` is the single source of truth (`SYSTEM_DIR`, `DERIVED_DIR`, `ORIGINALS_DIR`, `CONTEXT_DIR` + their `to*/from*/is*RelPath` helpers). Layout for a document `sub/x`:

| Artifact | Path | Naming |
|---|---|---|
| `derived` (`toDerivedRelPath`) | `sub/.system/derived/x.pdf.md` | full name + `.md` — feeds the markdown view (office) and search/context |
| `originals` (`toOriginalsRelPath`) | `sub/.system/originals/x.docx` | untouched source of an office doc whose markdown became the *visible* `sub/x.md` page; served by its download link, resolved via `originalCandidatesForMarkdown` |
| `context` (`toContextRelPath`) | `sub/.system/context/x.md` (markdown source) or `x.pdf.md` (binary source) | plus a fixed `_folder.md` roll-up (`FOLDER_CONTEXT_FILE`) per folder |
| ordering / colours | `sub/.system/file-order.json`, `file-types.json` | `wiki/utils/fileOrder.js`, `wiki/utils/folderTypes.js` |
| home provenance (`toHomeSeedRelPath`) | `sub/.system/home-seed.json` | folder-level, one per folder — proves the context build wrote `sub/.home.md` (see below) |

**Rationale:** spaces whose folders are symlinks to separate git repos keep each repo's artifacts **inside that repo**, so they are versioned and cloned with the documents they describe — a space-root namespace stranded them outside.

**Deleting a document must take its artifacts with it, and `.system` is watcher-ignored so nothing else ever revisits them.** `wiki/utils/documentArtifacts.js` is the single place that maps a deleted document to everything it owned (`artifactRelPathsFor` → derived + context + BOTH originals shapes: a stored source under the document's own name, and the office source behind a converted `.md` page, whose extension is only recoverable by probing `originalCandidatesForMarkdown`); it prunes each artifact dir once empty, leaving `.system` itself alone (at the space root it also holds `templates/`+`useractivity/`). The caller is `wiki/activities/artifactCleanup.js`, which subscribes to the **event bus** rather than hooking the watcher's `unlink` — the bus is where every delete converges, so the watcher (drag-out, git checkout, a workflow writing to disk) and the `DELETE /applications/wiki/api/{documents,folders}/:path` routes go through identical code. Both firing for one delete is expected and harmless: removal is idempotent and the two context rebuilds coalesce in the ContextTrigger debounce. It then calls `contextTrigger.scheduleRemoval(space, path)` so the folder's roll-up stops describing what is gone — for a deleted FOLDER that means rebuilding the **parent** (its `## Subfolders` section). Two gates keep it cheap: `isHiddenPath` (never react to `.system`/`.aicontext` churn — that is the cleanup's own output) and `ownsContext` (an image or video never had a summary, so no AI run). The workflow side prunes independently — see `pruneOrphanContext` in the cross-repo note below — which is what repairs deletes that raised no event at all.

**Derived sidecars are the ONLY way a PDF's text reaches search, and `wiki/utils/derivedSidecar.js` is the one place that writes them** (`sidecarStatus`/`ensureSidecar`/`removeSidecar`, `SidecarStatus`). `getPolicy('.pdf')` is `{view:'original', download:'original', search:'markdown'}` — the PDF stays the document that is shown, linked and downloaded, and `searchIndexer.indexFileWithWrapper` reads `toDerivedRelPath(...)` for content while keying the index entry under the **original's** path (sidecars are skipped as standalone docs via `isDerivedRelPath`), so a content hit inside a PDF returns a result that opens the PDF. Two writers, both delegating to that module: (1) **FileWatcher** on add/change (`generateSidecar`, `force:true` — the source is what just landed); (2) **SearchIndexer** during a build, via the `setDerivedSidecarResolver` hook wired in `wiki/initialize.js`. The second is not redundant — the watcher runs `ignoreInitial: true`, so any PDF already on disk at boot (bulk-copied while the backend was down, restored from backup, pulled into a symlinked repo folder) raises no event and would index by **file name only**, which is indistinguishable from working search until someone searches for a phrase inside a document. A build is the one pass that visits every file. It is idempotent (mtime compare, `STALE_TOLERANCE_MS` 2s guards coarse-granularity filesystems), so after the first pass it costs one `stat` per binary doc; env kill-switch `WIKI_DERIVE_ON_INDEX=false`. **A normal boot loads the index from disk and skips the walk** — repair an existing corpus with `POST /applications/wiki/api/search/rebuild`, then read the `derived` block (`candidates`/`generated`/`failed`/`unsupported`/`withoutContent`) off `GET /applications/wiki/api/search/stats`; the same numbers are logged as a one-line summary per build (`_logDerivedSummary`). `.pptx` is permanently `unsupported` — its converter needs a browser `window`.

**The space root is itself a folder holding documents**, so `<space>/.system/` serves BOTH roles at once: the root's own artifacts (`home.md` → `.system/context/home.md`, `.system/file-order.json`, …) **and** the space-SCOPED sub-folder `useractivity/` (`SPACE_SCOPED_SYSTEM_DIRS`, `isSpaceScopedSystemPath`). Never read `<space>/.system/derived/` as a tree-mirroring namespace — it holds sidecars for the ROOT's own files only. The names can't collide.

**`templates/` is BOTH, deliberately — it is a CASCADE, and the space root is merely its last rung.** `<folder>/.system/templates/*.md` holds the document templates offered when creating a file in or below that folder; `filePolicy.templateDirsFor(folderPath)` walks the folder then every ancestor, closest first, ending at `.system/templates` — so a space-wide template reaches everywhere while a nearer folder overrides one BY NAME (`pickClosest`, case-insensitive because the content roots include Windows checkouts). It stays in `SPACE_SCOPED_SYSTEM_DIRS` because that check is anchored at position 0 and callers use it to ask "space-level, or a per-document artifact?" — at the root a template is exactly the former, and `Buy/.system/templates/` correctly answers false. The tiers differ only in **who may write**: the root's need a space admin, a folder's need only the right to write that folder (`spacePermissions.templateWriteCheck`) — gate folder templates behind space admin and the tier is unusable by the teams it exists for. Continuous Exploration templates cascade identically over `<folder>/.system/continuous-explorations/.templates/` (shared walk: `ancestorDirsFor`). **A folder template is not findable from its id alone** — its directory isn't derivable and scanning for it is the exhaustive tree walk the lazy folder-tree exists to avoid — so every id-only CE route takes the `folderPath` the client listed it from (`templateManager._locate`). Served by `GET /spaces/:id/templates?folderPath=` and `GET …/continuous-explorations/templates?folderPath=`; the Create New File chips and the Templates hub's Mine/Folder/Space scope tabs both read it. Covered by `tests/backend/components/templateCascade.test.js`.

**Cross-repo lockstep (mandatory):** `contextProcessor.js` in the sibling `noobly-app-wiki-workflows` repo resolves the same paths — `derivedDir()`/`ctxDir()` build `<baseDir>/<folder>/.system/{derived,context}`, `homeSeedPath()` builds `<baseDir>/<folder>/.system/home-seed.json` (name AND hashing rule, or a seeded home silently freezes at version one again), and its context naming (markdown keeps its name, binaries get `+.md`) must match `toContextRelPath`. Diverge and PDF/office context silently degrades to "(empty or unreadable document)" while still reporting success. Covered by `tests/backend/components/filePolicyPaths.test.js`. The naming rule is now load-bearing in a second way: that repo's `pruneOrphanContext` deletes any sidecar whose source document is gone, which is what heals deletes this backend never saw an event for. It probes BOTH candidate sources (`x.pdf.md` → `x.pdf` or `x.pdf.md`) and keeps the sidecar when either exists, so a dotted markdown name (`notes.v2.md`) is never mistaken for an orphan — the same ambiguity `fromContextRelPath` carries.

**`.system` is in the file-watcher's `IGNORED_SEGMENT` — mandatory, not cosmetic:** the watcher writes derived sidecars itself, and a sidecar is a plain `.md` whose basename is NOT dot-prefixed, so `isContextEligible()` would accept it and schedule a context rebuild — a write→event→context-rebuild feedback loop. The tree builder (`filingServiceWrapper.buildFileTree`), search indexer and watcher all skip dot-folders, keeping exactly `.home.md` and `.aicontext`, so `.system/` never surfaces as documents.

**Legacy locations, still read as a fallback but never written:** `.settings/` (pre-migration file-order/file-types — `fileOrder.js`/`folderTypes.js` and `filingRoutes.js` probe it second), per-folder `.context/` and `.system/.derived/`, and the space-root `.system/{derived,context,originals}` tree-mirroring layout. Relocate ALL of them with **`deployments/migrations/2026-07-21-artifacts-to-folder-local-system.js`** (dry run by default; `--apply`, `--prune-orphans`, refuses to run while the backend port is live). It is self-contained — no app imports — so it can be copied to a production host. **Name recovery matters:** the old per-folder derived sidecar dropped the source extension (`Report.pdf` → `.derived/Report.md`) while the new one keeps it (`.system/derived/Report.pdf.md`), so the migration matches each artifact back to a real source document and renames it; a blind move produces names nothing looks up. Superseded and now describing the WRONG direction — do not run: `scripts/migrate-context-to-system.js`, `scripts/migrate-dotfolders-to-system.js`, `deployments/migrations/2026-07-13-consolidate-dotfolders-to-system.js`. Still folder-local and NOT under `.system/`: `.aicontext/` (chat summary cache), `.home.md`.

**A seeded folder home may be REFRESHED, but only while the build can prove it wrote it.** `ensureFolderHome` (sibling repo) copies a folder's `_folder.md` roll-up into `.home.md` when the folder has no home file. That page DESCRIBES the folder, so it goes stale as documents are added — but a page on disk carries no record of its author, so the rule was create-only and every seeded page froze at version one; the only way to refresh was to delete the file, and `.home.md` is hidden from the tree, so there was nowhere to click. `<folder>/.system/home-seed.json` (`filePolicy.HOME_SEED_FILE`/`toHomeSeedRelPath`, the source of truth) records a sha1 of exactly what was written, turning the guess into a fact: **no home file** → seed + record; **`.home.md` whose hash still MATCHES** → ours, untouched, refresh it; **anything else** → hand-written, edited since, or unprovable → leave alone permanently. One human edit transfers ownership for good, and every failure mode (marker missing, corrupt JSON, unreadable page, a `home.md` sitting beside it) lands in that same branch — the build only ever overwrites content it can prove byte-for-byte is its own, so the safety property the create-only rule protected is unchanged. The hash normalises CRLF away because the content roots are symlinked git repos and an `autocrlf` checkout would otherwise read as an edit. `homesSeeded` vs `homesRefreshed` in the run summary tell the two apart. **Deleting a home page is still the reader's call**, from the folder view's Delete button beside Edit (`navigationcontroller.deleteFolderHome` — the only way out for a document the tree never shows; not routed through `handleDeleteItem`, which skips the reload at the space root where `currentFolder` is `'/'` and the parent is `''`). That delete takes the marker with it: `.home.md` is the ONE hidden path `artifactCleanup` reacts to (`isSeededHomeDelete`, which still requires a non-hidden owning folder so a `.system/.home.md` stays excluded), and it deliberately does NOT schedule a context run — re-seeding the page a reader just removed, from an unchanged roll-up, at the cost of an AI call, is the same override-the-user bug in the other direction. Covered by `tests/backend/components/homeSeedMarker.test.js` and, against the real implementation, `system-context/tests/services/ensureFolderHome.script.js` in the workflows repo.

**Context regeneration:** the wiki **auto-rebuilds context on file add/change AND on delete** — `activities/contextTrigger.js`'s `ContextTrigger` accumulates touched paths per folder, debounces, and drains one job at a time; it resolves the `system-context` group's "Context: Overwrite Context (On-Demand)" workflow by name off the datasources `workflowBridge` and runs it in space mode with a `files` / `removedFiles` list + `force:true` (TARGETED mode: `ContextProcessor.runFiles` re-summarises only the changed files + their folder roll-up, reusing siblings; input read at the TOP LEVEL, not `data.settings`); env kill-switch `CONTEXT_ON_CHANGE` / `CONTEXT_ON_CHANGE_DEBOUNCE_MS`. It lives in its own module rather than inside `fileWatcher.js` because there are now two callers — the watcher (`schedule`, on add/change) and the delete-side cleanup (`scheduleRemoval`) — and they MUST share one instance, or the serialized queue that keeps concurrent AI runs off the box is defeated. `startFileWatcher` creates it and hangs it on `services.contextTrigger`. Read by chat grounding `searchSummarizer.workflowContextPathFor` and the Context Manager UI `aichatcontroller.contextDirFor` (which lists it via `file-list` rather than the nav tree). **Known cost:** targeted mode still fetches the WHOLE space folder tree to locate one folder node, and `TreeCache` invalidates on every file event — so each rebuild pays a cold full-tree build; with a 30s `httpTimeoutMs` on a large space the client aborts and retries, triggering repeated full builds.

**Two UI-triggered rebuilds run the same workflow, both in `filingRoutes.js`, both async (202 + `executionId`, polled against `/api/workflows/executions/:id/status`, visible in the datasources executions log):** `POST /applications/wiki/api/spaces/:spaceId/context/rebuild` takes `{ folderPath }` and OMITS `files` — that is what selects the recursive bottom-up subtree walk (folder view toolbar, confirmed first, minutes of AI). `POST …/context/rebuild-file` takes `{ contextPath }` or `{ filePath }` and passes `files:[doc]` — TARGETED mode, one document + its folder roll-up, ~2 AI calls, no confirmation (AI Context Manager's per-file Regenerate). The sidecar→document mapping is `filePolicy.fromContextRelPath`, which is ambiguous for a dotted markdown name (`notes.v2.md` → `notes.v2`), so the route carries both candidates and settles them against a directory listing. The frontend (`aichatcontroller.regenerateContext`) polls the sidecar back into the editor every 2s while the run is in flight, so the summary appears as it is written — those reads MUST pass `cache: 'no-store'`, because `GET /documents/content` answers text with `Cache-Control: public, max-age=86400`.

Other sub-path sources of truth: `ROOT` (`wiki/components/userStore.js`), `EXPLORATIONS_DIR`/`USERACTIVITY_DIR` (`wiki/continuousExploration/templateManager.js`). NOTE: `.system/dashboards/<prefix>.md` is written by the sibling workflows repo — the frontend reads `.system/dashboards/` then falls back to legacy `.dashboards/`.

**Global site content is NOT under `.system/`** — the headline banner, help document and What's New announcement are app-level, admin-maintained content, unrelated to the per-document sidecar layout above. They live together in a plain visible folder, `<APP_BASE_DIR>/content/{headline.txt,help.md,whatsnew.md}`, with `shared/content/contentPaths.js` as the single source of truth (`contentPath`/`legacyContentPath`/`readContent`/`writeContent`; `headlineRoutes.js`, `helpRoutes.js`, `whatsNewRoutes.js` hold no paths of their own). Relocated 2026-07-22 from `<APP_BASE_DIR>/.system/{.headline,.help,.whatsnew}/`, which is **still read as a fallback but never written** — so an un-migrated install works and heals on the first admin save. Relocate explicitly with `scripts/migrate-system-content-to-content.js` (dry run by default; `--apply`, `--base-dir`, `--keep-legacy`; self-contained, idempotent, never overwrites an existing destination).

## Module Details

### Datasources (`src/datasources/`)
- `SpaceManager` — spaces & RBAC; `WorkflowManager` — CRUD; `WorkflowExecutor` — steps (API, Transform, Conditional, Parallel, Delay); `WorkflowScheduler` — cron
- Key files: `initialize.js`, `components/SpaceManager.js`, `routes/spacesRoutes.js`, `validation/workflowSchemas.js`, `middleware/workflowAuthMiddleware.js`
- Auth endpoint: `/api/auth/check`
- **Prompt library** — reusable system prompts authored in the datasources app (sidebar **AI → Prompts**, `public/js/screens/prompts.js`) and read back by KEY: `prompts.get("document-processing-pdf")`. Store: `src/shared/prompts/promptStore.js` → `<appBaseDir>/configuration/prompts/prompts.json` (seeded on first read). Deliberately dependency-free with **synchronous** reads and an mtime-invalidated cache so workflow steps running in isolated worker threads (no `global.*`) can require it directly, exactly like `folderExpert` reads `settings-agents.json`; a UI edit is live on the next `get()`. `get(key)` **throws** on an unknown key (an empty system prompt yields plausible-but-ungrounded output) — use `getOr(key, fallback)` to degrade. `{{placeholder}}` values are filled via `prompts.get(key, vars)`. CRUD + test bench at `/api/prompts/*` (`routes/promptRoutes.js`); the bench runs the prompt as the system prompt against an agent resolved by `shared/ai/expertResolver.js`.
  - **The sibling workflows repo is the main consumer** — it hard-codes no system prompt of its own. `noobly-app-wiki-workflows/common/prompts/prompts.js` is a delegating shim over this store (same pattern as `common/convertors/*`), exposing `prompts` plus `libraryFor(appBaseDir)`. Five load-bearing keys: `document-summary` + `folder-context-overview` (`contextProcessor.js`, both take `{{maxChars}}`), `document-cleaning` (`documentCleaner.js`), `code-documentation` + `code-documentation-renderer-rules` (`codeProcessor.js` — the latter is `rendererRules()`, which encodes the wiki markdown-parser gotchas). Each service takes the library as `settings.prompts`, defaulting to the `APP_BASE_DIR`-resolved shared instance; the steps inject `libraryFor(appBaseDir)` so prompts resolve from the same `.application` as `settings-agents.json`. USER-side prompt text stays in the services — it is per-run structure, not tunable policy.
  - Because `get()` throws, a missing key breaks a workflow at run time. `all()` only seeds when the file is ABSENT, so `store.ensureDefaults()` (called at route registration, i.e. every boot) backfills built-ins a pre-existing store predates — adding only what is missing, never touching an edited record, and refusing to write over a file it could not parse. Deleting a built-in in the UI is therefore undone at the next boot; edit it instead. Adding a `DEFAULT_PROMPTS` entry is the supported way to ship a new prompt.

### Wiki (`src/wiki/`)
- `DataManager` — doc/folder CRUD; `EventBus` — pub/sub; `FileWatcher` — monitors `.application/documents/`; `SearchIndexer` — full-text; `AIService` — LLM
- Key files: `initialize.js`, `components/dataManager.js`, `components/eventBus.js`, `activities/fileWatcher.js`
- Auth endpoint: `/auth/check` (no `/api/` prefix — different from datasources)
- **Per-user artefacts (pins, recent, starred) belong to a PATH, not a space — never stamp a `spaceName` on one.** They are already stored per CONTENT ROOT (`spaceUserStore` resolves a space to `space.path || configuration.filing.baseDir`), so the four spaces sharing `knowledge-content/engineering` share one `pins.json` / `activity.json`. Records used to carry the space's DISPLAY NAME and the UI filtered on it, which failed four ways: renaming a space silently orphaned everything it had written (observed live — 4 pins and 8 recent entries stamped `Engineering Collaboration Space`, invisible everywhere); one file pinned from two views became two records; anything derived from search got an arbitrary stamp (index entries are keyed by space-relative path with no space prefix, so the field was whichever space indexed last); and matching a label enforced nothing. `wiki/components/userArtifacts.js` is the single source of truth — `normalise()` strips legacy stamps and collapses the duplicates they caused (newest timestamp wins), `filterVisible()` scopes with the real `spaceVisibility` matcher (folders via `isFolderAccessible`, so a pass-through ancestor stays reachable). **Legacy data heals on READ**, so there is no migration step; the clean shape reaches disk on the next write, which is why the pins routes now write even on a no-op. `spaceName` survives in request bodies ONLY as "which store/content root" and is optional. `RECENT_LIMIT` is 50, not 20: every view of a root draws from one list and then filters, so a tight cap let a busy afternoon in one view evict another's history. Covered by `tests/backend/components/userArtifacts.test.js`.
- **Notifications: a subscription is still identified by the space's DISPLAY NAME, so renaming a space kills it silently.** Topics are `<spaceName>::<type>:<path>` — `_topicFor` builds them from the stored `subscription.spaceName`, `publishChange` builds them from the LIVE `event.space.name` (fileWatcher). Rename the space and the two never meet again: no history, no socket push, no badge, no error anywhere. Diagnosed 2026-08-04 with 64 subscriptions stamped `Engineering Collaboration Space` against a spaces.json that now reads `Engineering Space`. **This is the pins failure (see the per-user artefacts bullet) in a component that was never migrated to path identity** — the durable fix is `userArtifacts`-style path identity + `spaceVisibility`; until then, a rename needs the stamps rewritten. Four adjacent defects WERE fixed: (1) `initialize()` keyed users by the FOLDER name while `subscribe`/`addToHistory` key by email — `userDir()` is one-way (`admin@localhost` → `admin/`), so loaded history was filed under `admin` and read back under `admin@localhost`, i.e. empty; `resolveIdentity()` now takes the identity out of the records. (2) Those two keys both reached the writer and resolve to ONE file, so each sync wrote it twice in Set order and an empty record could land on a full one — `collapseByFile()` now keys by the RESOLVED DIRECTORY (a stale spaceName falls back to the default space, which lands on the same directory, so the space side had the same collision). (3) An unreadable `notifications.json` was never tracked, so `_saveHistoryPerSpace` never rewrote it — a zero-byte file warned on every boot forever; the key is now tracked even when the read fails. (4) Frontend: `notificationController.init()` runs BEFORE space auto-select, so its one fetch went out with no `?space=` and the server answered from `history[null]` — always empty — and nothing ever re-fetched; there is now a `refresh()` on `spaceChanged` and on panel open. The unread badge also used `d-none`/`bg-danger`/`position-absolute`, which at the time were inert — it is now `.kr-bell-badge` + the `hidden` attribute (Bootstrap's CSS is now loaded explicitly, see **Styling**, but the badge keeps its own class). Covered by `tests/backend/components/notificationIdentity.test.js`.
- **Notes — per-user jottings about a document, folder or space home, stored WITH THE CONTENT.** One plain `.txt` per note, plus any attachments, in the folder the note is ABOUT: `<content root>/<folder>/.system/useractivity/<prefix>/notes/<content-title>.txt` (a second note about the same content becomes `<title>-2.txt`; a voice recording is `<content-title>.webm` and a pasted picture `<content-title>.png`, sharing the stem so the set reads as a group). **FOLDER-LOCAL, like every other per-document artifact and for the same reason** — the content roots are directories of symlinked git repos, so an artifact inside the folder it describes is committed and cloned with that repo while a space-root one is stranded outside it. NOTES ARE CONTENT: the consequence is intended, and notes reach everyone who clones the repository. **`folderFor` is the single place the folder is decided** and a client never supplies it — a document's notes sit beside it, a folder's inside it (like its `_folder.md` roll-up), the root's at the root. Relocate pre-existing notes with `deployments/migrations/2026-09-08-notes-to-folder-local.js` (dry run by default; `--apply`, `--prune-orphans`). **A per-folder index means an id ALONE no longer locates a note**, and scanning for one is the exhaustive tree walk the lazy folder tree exists to avoid — so EVERY route carries `type` + `path`, id-addressed ones included (the rule the CE template routes already follow), and `targetVisible` therefore gates every route rather than only the listings: the path decides where bytes land. **Every writer takes `withIndexLock`** — each mutation is a read-modify-write of the whole index, and two interleaving silently drops one side's change; that stranded a real pasted picture on disk with nothing pointing at it. Atomic writes do not help, they prevent a TORN file rather than a lost update. `wiki/components/noteStore.js` owns all of this; `notesRoutes.js` (`GET|POST /applications/wiki/api/notes`, `GET …/notes/count`, `PUT|DELETE …/notes/:id`, plus `…/notes/{audio,images}` and `…/notes/:id/{audio,images}` for attachments) is thin over it. **The .txt holds the body and nothing else** — no header to parse, no metadata to corrupt — because the folder is meant to be readable and editable outside the app; the sibling `notes.json` owns the association (id → file, target type/path, timestamps). A file name cannot carry that reliably (two documents share a title, a note has no title of its own, a title re-slugs differently tomorrow), and it is also the security property: **the index is the only thing that ever names a file**, a client never does, so a crafted id cannot escape the notes folder. `normaliseIndex` additionally refuses any `file` that is not a bare `*.txt`. **Like pins, a note belongs to a PATH, not a space** — no `spaceName` stamp, scoping is `userArtifacts.filterVisible` (see the artefacts bullet above), so a note written in one view is there in every view of the same root and a rename orphans nothing. **Voice notes**: `MediaRecorder` at an explicit 32 kbps (left to itself Chrome picks ~128 kbps, near a megabyte a minute); the panel asks whether to keep going every 30 min (`RECORD_PROMPT_MS`), pausing behind the prompt, and an UNANSWERED prompt stops and SAVES after 60s. A `recorder.start(timeslice)` is what makes the live byte count possible, and the client stops itself at `MAX_RECORD_BYTES` (30 MB) — deliberately below the server's `MAX_AUDIO_BYTES` (32 MB), so the stop happens where the recording can still be saved rather than as a 413 after two hours of talking. **Pictures** are pasted (paste is intercepted only inside `#notesPanel`), scaled down rather than refused when over the limit, and open in a dialog holding a `.kr-image` canvas so the parser's own pan/zoom runtime supplies the zoom. Frontend: `modules/notesController.js` + `#notesPanel`, a docked right sidebar in **grid column 4** of `#wikiApp` (wiki.css) — a grid child, not a fixed overlay like the help drawer, so it reflows the content instead of covering it, and it stays open across navigation (localStorage `wiki:notesPanelOpen`). Any view renders `<button data-notes-toggle>` wherever it likes and ONE delegated handler drives all of them (`renderChips` re-stamps counts, which a folder view needs because it rebuilds its whole DOM on a view-mode switch). Autosaving, no Save button: 900ms debounce, flushed on blur/close/re-target/pagehide, single-flight per note with a queued coalesce. A new note is a local DRAFT until it has text. Every colour comes from the accent ramp (`var(--kr-teal-*)`), which the wiki.css theme bridge maps onto the noobly `--accent` tokens; the chip states must ALSO qualify with `.btn` (and set the border SHORTHAND, since `.btn-ghost` zeroes the width) so they outrank `.btn-ghost:hover`. `setTarget` ignores a repeat of the same path — `updateDocumentHeader` runs on every doc-tab switch and would otherwise reload the panel mid-sentence. Covered by `tests/backend/components/{noteStore,notesRoutes}.test.js`.
- **A space's root landing page comes from the SPACE CONFIG first, and the whole resolution must be pinned to one space record.** Order (`navigation-core.spaceHomeCandidates`, a pure function taking the space): `theme.home` → top-level `home` → `.home.md` → `home.md`, first that EXISTS. **Multiple spaces share one content root** — Engineering/Retail/Fintech/People are all rooted at `knowledge-content/engineering`, whose root holds `.engineering.md`, `.retail.md`, `.fintech.md`, `.people.md` side by side — so every candidate exists for every one of those spaces and **nothing 404s**. Resolving against the wrong space record therefore returns a confident WRONG page rather than a miss, and there is no fallback to catch it.
  - **Renaming a space in spaces.json breaks every OPEN TAB until it reloads.** `SpaceManager` only re-reads the file at boot, so the rename lands on restart while the client keeps the record it fetched at load and goes on posting the old `spaceName`. Every document endpoint resolves the space BY NAME and answers `{exists:false}` for one it cannot find — identical to a missing file — so `loadHomeContent` misses all four candidates and hides the home area with nothing logged. `app.refreshStaleSpace()` re-fetches the list and matches **by id** (stable across a rename), then retries once; the miss path also `console.warn`s the candidates it tried, so it is never silent again. Diagnose with `POST documents/exists` under both names.
  - Consequently `loadHomeContent` / `loadFolderHomeContent` capture the space **once** and use it for both the candidate list and every request; re-reading `app.currentSpace` between awaits let two overlapping loads mix spaces. Space loading is a long async chain (`selectSpace` → tree → home → dashboard) and several run concurrently — the boot auto-select, a deep link and a user click all route through `selectSpace` — so `app.beginSpaceSelection()` issues a generation token that every step carries and re-checks (`isSpaceCurrent`) before touching the DOM. Last selection wins instead of whichever request finished last. `loadFileTree` guards the same way on `spaceId`. Symptom when this breaks: the Engineering home renders and is then replaced by Retail's. Covered by `tests/backend/components/spaceHomeResolution.test.js`.
- **The folder tree is LAZY — `truncated: true` means NOT LISTED YET, not empty.** `GET /applications/wiki/api/spaces/:id/folder-tree` walks `WIKI_TREE_DEPTH` levels (default **2**) and flags every folder below the cut; the client fills them in as the user drills, by re-requesting the same route with `?path=<folder>`. This is not an optimisation, it is the difference between a request that returns and one that doesn't: the content roots are directories of symlinked git repositories, and an exhaustive walk of one measures in thousands of sequential `readdir`s (on this repo: 9 listings / 68ms at depth 2 vs 7,972 / 7.6s for the full tree). `?depth=all` still does the old walk and is opt-in for callers that browse in memory rather than lazily — the Chrome extension and the two Continuous Exploration folder pickers pin an explicit `depth=4` for exactly that reason. **Two is a floor**: `resolveDrill` paints two levels at the space root, and a folder overview needs one level below the folder it is showing to put an item count on each subfolder — which is why `navigationController.ensureFolderLoaded` fetches grandchildren, not just children.
  - Every reader that concludes "this folder is empty" must check the flag first, or a whole subtree silently disappears: `_folderHasContent` (hide-empty toggle), `_effectiveFolderStatus` (the muted "light" default), `_homeOnlyDocument`, `_renderDrillFolderRow`'s drill chevron, and `navigation-core.hasVisibleChildren`. The same trap exists server-side in `spaceVisibility.filterTree`, where a pass-through container is normally dropped once nothing survives beneath it — a truncated container has to be KEPT or a curated space can never reach the subtree it allows.
  - Entry points that read a node out of `fullFileTree` must `await` first — `ensurePathLoaded(path)` (walks the path, loading each truncated level) or `ensureFolderLoaded(folderPath)` (that, plus grandchildren for display). Wired into `loadFolderContent`, `navigateToTreeFolder` and `expandPathInNav`, which is what makes deep links work: the document loads by path immediately and the nav catches up behind it. `MAX_TREE_DEPTH` (`WIKI_TREE_MAX_DEPTH`, 24) caps recursion even for `depth=all`, because the walk follows symlinks and nothing resolves real paths — a link to its own ancestor would otherwise never terminate.
  - Only the ROOT tree is ETag/`TreeCache` cached per space (and the cached entry now carries the `depth` it was built at — a shallower tree is not a valid answer to a deeper request). Subtree fetches ride the shared raw-tree cache, keyed by `(content root, path, depth)`. The localStorage client cache holds the root-depth tree only, so it keeps matching its ETag; lazily loaded branches are re-fetched after a reload. A subtree walk starts mid-tree with no ancestry, so `inheritedOrderFor` re-derives the `.system/file-order.json` cascade from the nearest ancestor that has one — drop it and a lazily loaded folder silently ignores an order imposed from the space root.
- **Single-folder chains collapse in the LEFT NAV — a DISPLAY transform, never an auto-redirect.** A folder holding nothing but one subfolder (`Commercial Services` → `Technology`) is not two levels of information, it is one level written twice, so the nav draws it as ONE row — `Commercial Services › Technology` — standing for the DEEPEST folder of the run. `navigation-core.js` owns the rule: `isPassThroughRung` (exactly one visible child, and it is a folder), `collapseChain` (walks down, returns `{terminal, segments, collapsed}`, capped at `MAX_CHAIN_SEGMENTS` = 3), `collapseAncestor` (the back-row inverse). `resolveDrill` takes `options.collapseChains` — **off by default**, so an un-migrated renderer keeps the old shape — and folder rows gain a `chain` field; `row.node` becomes the TERMINAL, so the chevron, status colour, click target and drop target all describe the folder whose contents the row actually shows. Frontend: `navigationcontroller._renderDrillFolderRow(node, level, isGroup, chain)` plus the `collapseChainsToggle` checkbox (localStorage `wiki:nav:collapseChains`, defaults **ON** — note the `!== 'false'` read, the inverse of the hide-empty toggle beside it). Styles `.kr-drill-chain` / `.kr-chain-seg` / `.kr-chain-sep` in wiki.css. **Left nav only** — the folder grid/card/Feature views are deliberately untouched.
  - **Why not just auto-navigate off a thin folder** (the obvious first idea, and the one to keep saying no to): Back lands on the rung and is instantly forwarded off it again — an inescapable loop unless navigation starts tracking DIRECTION; **path is identity in this app**, so pins, deep links, notification topics and Share links would all silently re-point; and the rung's own home page becomes unopenable (`Commercial Services` HAS one, which is also why the rule can't simply be "1 item"). Collapsing keeps every real path addressable and merely stops spending a row on a name that carries no choice.
  - **A `truncated` folder is NEVER a rung.** The lazy tree stopped walking there, so "has one child" is not known and guessing would collapse a folder that turns out to hold twenty. Collapsing also never FETCHES to discover a chain — it reads only what is already in memory, so a chain lengthens as drilling fills the tree in rather than provoking the sequential subtree walks the lazy tree exists to avoid.
  - **Symmetry is load-bearing.** Drilling in past a skipped rung costs one click, so `collapseAncestor` makes backing out cost one too — otherwise the user is returned to a rung the nav never offered and the two directions disagree. The top breadcrumb still lists EVERY rung and each label segment is separately clickable (`data-chain-path`), so a skipped folder keeps two ways in and nothing becomes unreachable.
  - Two lookups must know that one row stands for SEVERAL folders, or landing on a skipped rung highlights nothing at all: `selectFolder` and `_findNavRow` match `data-chain-paths` as well as `data-folder-path` (the latter is what makes opening `<rung>/.home.md` still highlight its row). `dragDropManager.extractFolderInfo` reads `data-folder-name` because a chain row's visible text is a label, not a folder name. Drag and rename on a chain row act on the TERMINAL — a deliberate, revisitable choice.
  - Covered by `tests/backend/components/navChainCollapse.test.js` (18 tests, `vm`-evaluated like the other navigation-core suites).
- **Feature flags** (`config/featureFlags.js`) — `aiChatEnabled` (right-hand AI panel + robot toggle) and `editingEnabled` (Blocks/Markdown/Visualise editing) are served to the web AND Teams frontends by the public `GET /applications/wiki/api/config`. They live in the CORE settings service under group **`wiki`** — the encrypted grouped key/value store behind the datasources **Settings** screen — so an admin flips them at runtime and the next page load picks it up, no restart. **Not env vars**: `WIKI_AI_CHAT_ENABLED`/`WIKI_EDITING_ENABLED` were removed from `.env` and `process.env` is deliberately NOT consulted, so there is one source of truth. `ensureDefaults()` runs at route registration and writes any missing key with its `type: 'boolean'` + description — mandatory, because the admin screen cannot show a key that has never been written, so a flag written only on first change would be invisible. Existing values are never overwritten. `readFlags()` never throws (a broken store degrades to defaults rather than failing the page load) and coerces a string `"false"` typed into the admin screen instead of reading it as truthy. Reaching the wiki required threading `settings` through `app.js` `context.services` → `src/initialize.js` → `wiki/initialize.js` `routeServices`. Not every entry is a boolean — see the cache epoch below, which is why `FLAGS` entries carry a `type` and `ensureDefaults` seeds with `flag.type` rather than a literal `'boolean'`.
- **Client cache epoch — how a change on the server makes 1500 browsers drop their cached navigation trees, with nobody opening devtools.** The trees are cached per space in localStorage and revalidate with `If-None-Match` on every load, so ordinary content changes heal themselves; what they cannot heal is a **frontend** change that moves the client's expectations while the server's ETag stays put. The only fix used to be talking a user through `window.wikiClearAllCache()` (index.html), which does not scale and is destructive besides — it drops **cookies** (signing them out) and `kr_onboarding_seen::` (re-running the welcome wizard). So `clientCacheVersion`, a STRING in the same `wiki` settings group, rides the public `GET /api/config`; each browser records the value it last acted on in `kr_wiki_cache_version` and purges when the two differ. Bumped from **Profile → System → Client caches** (`POST /applications/wiki/api/admin/client-cache-version`, admin-gated, writes `String(Date.now())` — a timestamp, not an increment, because read-then-increment races two admins into writing the same value, which looks like a bump but purges nobody).
  - **`GET /api/config` MUST answer `no-store`.** It carries the stamp; a cached config answer means the bump never arrives and the purge silently never happens — the exact failure the endpoint exists to fix.
  - `public/js/modules/clientCache.js` is the single source of truth for the wiki's localStorage keyspace, in three tiers: `cache` (`wiki-tree-*`), `prefs` (`wiki:view:*`, `wiki:nav:*`, sidebar/AI-panel keys), and `STICKY` — `kr_onboarding_seen::`, `kr_whatsnew_dismissed::`, `kr_wiki_*` — which nothing here removes at any scope, re-checked at delete time by `assertSticky` so a typo'd prefix still can't eat them. A purge is deliberately an **allow-list of what to CLEAR**, never "wipe everything except": a key added later and forgotten here SURVIVES, which is the safe direction to fail. An epoch bump clears `cache` only — resetting somebody's view modes because a nav fix shipped is rude.
  - **It runs at module scope in app.js, awaited, before anything reads a tree** — a purge that lands after the tree renders fixes nothing until the next reload. index.html starts the config fetch in `<head>` and parks it on `window.__wikiConfigPromise` so the flag handling and app.js share ONE in-flight request; a 2500ms timeout means a dead config endpoint can never stop the app booting. A browser with no recorded stamp is stamped but NOT purged and NOT told anything (nothing is stale on a first visit), and the toast only fires when keys were actually removed.
  - **Do not reuse `?clearCache=all` for this.** It also POSTs `/admin/clear-tree-cache`; 1500 clients each clearing the SERVER's TreeCache means it never stays warm, and a cold full walk is seconds. The epoch purge is client-only — clear the server cache once, yourself. For the same reason the bump is manual rather than derived from the deploy version: most releases invalidate nothing, and every bump costs all users a full tree fetch. Covered by `tests/backend/components/clientCacheEpoch.test.js`.
- **PDF document tabs — Document / Extracted text.** A PDF's view carries the SAME `#docTabs` strip as a markdown doc (so both sit in the same place with the same styling), but a disjoint tab set: `pdf` (the rendered PDF, drawn by `renderPdfTab` — factored out of `showPdfViewer` so switching back re-renders it) and `derived` (the `.system/derived/<name>.pdf.md` sidecar in a raw textarea). `documentcontroller.docTabMode(doc)` picks the set; `PDF_TABS` keeps the two out of a markdown doc's strip and vice versa. Deliberately a raw textarea, not the block editor — this is machine output being repaired, not authored prose, and the block editor would normalise the very formatting being judged. **It autosaves; there is no Save button** (`DERIVED_AUTOSAVE_MS` 900ms debounce + flush on blur / tab switch / `openDocumentByPath` / `setActiveView` / `pagehide` with `keepalive`), single-flight via `_derivedSavePromise` with a queued-coalesce so a fast tab switch during a slow save can't drop keystrokes; status shows in `#docTabsStatus`. Backend: `GET|PUT /applications/wiki/api/documents/derived` + `POST …/derived/regenerate`, all addressing the sidecar by the **ORIGINAL's** path (`resolveDerivedTarget` → `needsMarkdownSidecar` guard + `getDocumentAbsolutePath` with `enforceVisibility`). **The PUT re-indexes the original itself** — `.system` is watcher-ignored, so nothing else would, and the correction would sit on disk while search answered from old text; it also drops `wiki:search:*`/`wiki:suggestions:*`. Saving makes the sidecar newer than its source, so `sidecarStatus` reports `current` and the indexer's repair pass won't clobber a hand correction. index.html's `editingEnabled === false` gate must keep `['content','pdf']` clickable — disabling `pdf` would hide the document itself.
- **Document view tabs** (markdown docs): the document view (`#documentView`) shows a tab strip — **Content / Blocks / Markdown / Visualise** (`#docTabs`, `.kr-doc-tab`) — that replaced the old header Edit + Visualise buttons (the Edit button now only shows for non-markdown editable text/code/web/data). All four views live in `.document-container`; switching tabs **saves the active editor first** (`documentController.setDocTab` → `teardownEditorTab` → `saveDocument`) so every view stays in sync. Content = rendered markdown (`renderContentTab`); Blocks = `MarkdownEditor` block editor (host id `mdTabEditor`); Markdown = raw `<textarea>` (`.md-raw-textarea`); Visualise = `visualisationController` canvas (`renderVisualiseTab` ensures a ```visualisation``` block exists). `readEditorContent()` reads whichever surface is live. Edit mode is mirrored into `documentViewerState` so file-watcher updates reload silently (view) vs raise a conflict (edit). Navigation flushes in-progress edits via `openDocumentByPath` and `app.setActiveView`. The legacy `#editorView` is now used only for text/code editing. Styles: `.kr-doc-tabs` in `src/web/wiki/public/css/wiki.css`.
- **Visualisation block** (```` ```visualisation ````): interactive canvas that lays out the document's own heading sections as movable, content-sized cards (no manual resize — cards auto-size; a legacy `width:` prop is ignored). Block body holds ONLY layout lines (`@canvas height:480 grid:20`, `@item "Heading" top:N left:N`, `@connect "A" -> "B" [label:"x"]`) — content stays in the doc; unknown/orphan lines are preserved on write-back. Parser emits a placeholder (`public/js/markdown/markdown-parser.js` → `renderVisualisation`); `src/web/wiki/public/js/modules/visualisationController.js` hydrates it (Arrange toggle, drag with snap-to-grid, port-drag connections with an inline label editor that auto-opens on create, pan/zoom) and saves layout edits via the same endpoints the editor uses. Toolbar **Visualise** button inserts an empty block on docs without one. Styles: `.kr-visualisation` in `src/web/wiki/public/css/wiki.css`. Bump the `?v=` on the markdown-parser `<script>` in wiki `index.html` when changing the parser.
- **Pane block** (```` ```pane ````): embeds another wiki document inline. Body: `source: [Space Name]/path/to/file.md` (`[Space]` optional — defaults to the host doc's space; backslashes tolerated) and `clickout: true` to add an Open button/clickable label on the rendered pane. Parser emits a placeholder (`markdown-parser.js` → `renderPane`); `src/web/wiki/public/js/modules/paneController.js` hydrates it — fetches the source via `/applications/wiki/api/documents/content`, strips comments/liked/visits/reviews blocks, renders, recurses into nested panes (depth-capped, cycle-guarded). Editor: registered block in `markdown-editor-blocks.js` (insert via slash menu → Layout → Pane) with a source field that autocompletes via the wiki search APIs (`getDocumentSuggestions` option on `MarkdownEditor`, provided by `documentcontroller.fetchPaneDocumentSuggestions`); its clickout button dispatches a `wiki:pane-open` window event that paneController handles. Styles: `.kr-pane` in `src/web/wiki/public/css/wiki.css`. **The picker MUST pass `documents=true` to `GET /search/suggestions`** — an unscoped request otherwise takes `searchIndexer.getSuggestions`'s fast path into the core token service's `suggest()`, which answers with bare index TERMS (`["idm-promo"]`) and strips `path`/`spaceName` even off the document entries, so nothing can be resolved back to a document and the dropdown silently stays empty. `documents=true` forces the container scan (path-bearing objects, `path` SPACE-RELATIVE — `storedFields.path` is the absolute file path and is never what a consumer wants), suppresses token strings, and turns on folder-path matching; `fileTypes=markdown` keeps non-embeddable hits out. The picker then falls back to `GET /search` so a document is also findable by its CONTENT, and dedupes on space+path.
- **Linked documents** (```` ```linked-documents ````): the RELATIONSHIP band — a titled row of cards, one per related wiki document **or folder**, plus the "Link documents" dialog that maintains it. Body is block-level `title:` / `across:` lines then one `- [Space Name]/space/relative/path` per link (`[Space]` optional — defaults to the host doc's space; an optional ` | Display label` overrides the derived name; backslashes tolerated). **Three implementations of one grammar**, and `tests/backend/components/linkedDocumentBlocks.test.js` asserts they agree byte-for-byte: `src/wiki/components/linkedDocumentBlocks.js` (server, pure/no-I/O — the model is `reviewBlocks.js`), `MarkdownParser.parseLinkedDocuments` (render side) and the `linked-documents` editor block in `markdown-editor-blocks.js` (edit side). Registered in `FENCE_ONLY_BLOCKS`, or a paragraph opening "Linked documents …" is swallowed whole. Unknown lines survive a round trip via `extras`.
  - **The links live in the markdown, not a sidecar index**, because path is identity here and the documents are what gets cloned, versioned and read outside the app. `documentRoutes` PUT `/documents/content` therefore carries the block across a wholesale rewrite (`preserveLinkedDocuments`, alongside annotations/user-content/reviews) — these are hand-curated relationships most often authored on a folder home, exactly the page a workflow regenerates.
  - **Routes** (`linkedDocumentsRoutes.js`): `GET|PUT /applications/wiki/api/linked-documents` read/write the block (the client never splices a fence itself, so the server owns the grammar and an empty `items` array REMOVES the block); `POST …/linked-documents/resolve` turns a whole set of references into card-ready descriptors in ONE request — kind, title, `childCount`/`size`, `modified`, `spaceId`. Resolve exists because a reference may name ANOTHER space, so two gates apply per reference: can the caller reach that space (the spaces-list rule), and does that space expose the path (`spacePaths`). Either failing answers `kind:'hidden'` with no name or date; **inside a hidden subtree `missing` also answers `hidden`**, or resolve becomes a probe. It is the ONE place that passes `enforceVisibility:false` — because the right rule depends on file-vs-folder, which is only knowable after the `stat`; both branches then check explicitly (a FILE by `isFileVisible`, whose root-level exemption keeps a curated space's own `home.md` visible; a FOLDER by the listable `container` rule). Judging a root-level file as a container hides it, which reads exactly like a broken link. Covered by `tests/backend/components/linkedDocumentsRoutes.test.js`.
  - **Frontend** `modules/linkedDocumentsController.js`, hydrated from all three render sites (document view, folder home, space home). Cards reuse the folder Grid tile markup and `navigationController.loadCoverPanels`, so a linked folder looks exactly like that folder does when browsed to — but they must **NOT** wear `folder-card-bootstrap`/`file-card-bootstrap`: those are BEHAVIOURAL hooks (`bindListEvents`, the nav updaters) and would attach a same-space click handler, which for a cross-space link navigates to a path that does not exist there. `.kr-linked-card` restates the visual. An unresolved link stays on the page as a muted card — a broken relationship is information.
  - **Entry points**: `<button data-link-documents>` anywhere, one delegated handler (the notes-chip pattern); explicit `data-link-path`/`data-link-space`, else inferred from the open document or the current folder's home file. Each hydrated band also grows its own "Edit links" control, which is what makes the feature usable on the SPACE HOME — that view deliberately has no action row. That control is appended to the SECTION and positioned over the heading, never nested in the `<h2>`: `documentOutline.build` uses a heading's whole `textContent`, so a nested button renames the "On this page" entry to "Linked documents Edit links".
  - **Content JOBS in the sibling workflows repo can emit the band too** — `common/content/linkedDocuments.js` there builds it, and `linked-documents` is in `wikiBlocks.SINGLETON_TYPES` so a regeneration carries a reader's own band instead of destroying it. The trap is that references are SPACE-ROOT relative, not relative to the job's `contentfolder`, and a wrong one renders as a muted "no longer resolves" card rather than failing; `spaceRelativeRef()` does the conversion. Guide: `.docs/Linked-Documents-for-Content-Jobs.md`. The picker offers documents from the search APIs and FOLDERS from the in-memory nav tree (`documentcontroller.collectFolderSuggestions` — one implementation, shared with the editor block). Folders are not a server call on purpose: the tree is lazy because walking these content roots costs thousands of sequential `readdir`s; a folder not yet listed is still reachable by pasting its path. `MarkdownEditor` passes the field's `data-role` as a second argument to `getDocumentSuggestions` so the same provider can stay markdown-only for a pane and widen for a link. Styles `.kr-linked-docs` / `.kr-linkdocs-*` in `src/web/wiki/public/css/wiki.css`, every rule scoped under the marker class for the same specificity reason as the landing bands.
- **Landing blocks** (```` ```landing-hero ````, ```` ```news ````, ```` ```tiles ````, ```` ```stories ````, ```` ```cta ````): the section types a space landing page (`home.md` / `.home.md`) is built from — see `knowledge-content/engineering/home.md` for a full worked page. All five share ONE source grammar: block-level `key: value` lines, then repeated items opened by `- key: value` (subsequent `key: value` lines attach to that item; a bare line continues the previous value, so long excerpts can wrap). `MarkdownParser.parseBlockItems` is the single implementation on the render side; `parseLandingFence` in `markdown-editor-blocks.js` mirrors it on the edit side — **keep the two in step or a page renders one way and edits another**, which `tests/backend/components/landingBlocks.test.js` asserts directly. All five are registered in `MarkdownParser.FENCE_ONLY_BLOCKS`: `isCustomBlockStart` matches any line merely *starting with* a block name, so without that a paragraph opening "News …" or "Stories …" is swallowed whole and silently disappears. Editor blocks are generated from a field schema by `registerLandingBlock()` (slash menu → Layout → Landing page); its click roles MUST stay namespaced per type (`news-save`, not `landing-save`) because `_handleBlockClick` resolves a role against every registered block and takes the first match. Links: `folder: <relative folder>` emits `<a data-doc-rel>` for SPA navigation (`documentcontroller.initializeDocLinks`), `link:` emits a plain href, neither emits an inert `<span>`. Grids honour `across:` via `--kr-grid-cols`. Card headings are excluded from the document outline (`documentOutline.build`) so a grid contributes one entry, not a dozen. `landing-hero`'s `search:` renders a real `<form data-landing-search>` (Enter submits natively); `searchController.initLandingSearch` delegates the submit, copies the term into `#globalSearch` and calls `performSearch()` so the results view, folder scope and layout history all behave as if the top bar were used. **Styles live in `src/web/wiki/public/css/wiki.css` (the web wiki) AND `public/css/kr-base.css` (the Chrome extension's source — see below; keep the two copies in step), and EVERY rule is scoped under `.kr-landing`** (the marker class the parser puts on all five sections) — these bands render inside `.md-doc`/`.markdown-content`, whose element rules (`.md-doc p`, `.md-doc strong`, `.md-doc a`, `.md-doc h2`, and `.markdown-content p` in the later-loading `wiki.css`) are specificity 0,1,1 and beat a bare `.kr-…` at 0,1,0; unscoped, the white-on-teal hero text silently renders as dark body ink. Palette is `--krl-*`, defined on `.kr-landing`. **The Chrome extension needs these styles too** — it vendors a byte-identical copy of `markdown-parser.js`, so it emits the same `.kr-landing` markup into the same `.md-doc` container, and shipping the parser without the stylesheet renders a landing page as unstyled body copy. `applications/chrome/wiki/build.js` (`SHARED_ASSETS`) generates `css/kr-landing.css` by extracting kr-base.css's `Landing blocks` banner section, and re-copies the parser; refresh both with `npm run sync` in that directory. The extraction fails the build loudly if the banner or `.kr-landing {` goes missing, rather than shipping an empty stylesheet.
- **Recent changes** (```` ```recent-changes ````): the ACTIVITY band — a grid of what changed most recently in one folder and everything beneath it, each card opening the document (or the folder) it names. Body is block-level `key: value` lines only, because there are no authored items — the items ARE the server's answer: `folder:` (REQUIRED, space-relative, and it may carry a `[Space Name]/` prefix, which is what the editor's folder picker writes), plus `title:`, `space:`, `days:`/`period:`, `limit:` (max 60) and `across:`. `days` accepts a bare number, a unit suffix (`14d`, `4w`, `6m`, `1y`) or `all`/`0` for no window. Registered in `FENCE_ONLY_BLOCKS`, like every other data block. **`folder:` is deliberately required** rather than defaulting to the host page's own folder: the same block gets copied between landing pages, and a scope that silently changed with its host is impossible to reason about from the source.
  - **THREE parts, and TWO of them implement the same grammar** — `MarkdownParser.parseRecentChanges`/`renderRecentChanges` (render side, emits an inert placeholder carrying the settings as `data-recent-*`) and the `recent-changes` editor block in `markdown-editor-blocks.js` (edit side). `tests/backend/components/recentChangesBlock.test.js` asserts they agree, including the round trip. The sharp edge is `days: 0` = **all time**: written back as `days: all`, because a `0` left unwritten reads as "unset" and silently narrows the block to the 30-day default on the next save. The un-hydrated markup is a readable sentence, not an inert box, because the Chrome extension side panel and folder cover previews render parser output as-is.
  - **The source of truth is the FILE SYSTEM, not the search index.** The index also carries a `modifiedTime` per document and scanning it would be free, but that stamp is only as fresh as the last time the file was INDEXED — a boot loads the index from disk without walking, so anything written while the backend was down keeps its old stamp and would never appear in a panel whose whole job is to say "this changed".
  - **The walk is RECURSIVE, which is the cost the lazy folder tree exists to avoid** — so `src/wiki/utils/recentChanges.js` bounds it two ways and reports both: `depth` (default `WIKI_TREE_MAX_DEPTH`) and a listing budget (`WIKI_RECENT_SCAN_MAX_DIRS`, 4000). Either tripping sets `truncated`, which the UI shows as a note — the grid looks identical whether the walk finished or gave up, and "nothing changed" is a very different message from "we stopped looking". Results are cached per (content root, SPACE, folder, depth) for `WIKI_RECENT_SCAN_TTL_MS` (60s) with in-flight coalescing, and — unlike the raw tree beside it — that cache is **deliberately NOT wired to `attachRawTreeInvalidation`**: the nav tree must drop on every file event because a new document has to appear in the sidebar at once, but a "what changed lately" panel has no such duty, and clearing it per event would re-walk the subtree for every reader of a space a workflow is writing into. The scan is also time-independent (`days`/`limit`/`types` are applied afterwards by `selectRecent`), so every block pointed at one folder shares one walk whatever window each asks for.
  - Curation is applied DURING the walk, not to the finished list, and the three `spaceVisibility` predicates are NOT interchangeable: a file by `isFileVisible`, a folder DESCENDED INTO when `isFolderAccessible` (so a pass-through ancestor is walked through), but LISTED only when `isFolderVisible` — a pass-through container is something you drill through, not something that meaningfully changed. Dot-prefixed names are skipped wholesale (`.system`, `.aicontext`, `.home.md`): the app writes those itself, often as a side effect of the save being reported, so listing them would mostly be reporting on itself. A folder that cannot be listed at all answers **404, the same as one this space curates away** — indistinguishable on purpose — because "nothing changed" would leave a mistyped `folder:` looking like a quiet week.
  - Route: `GET /applications/wiki/api/spaces/:spaceId/recent-changes?path=&days=&limit=&types=&depth=` (`filingRoutes.js`, beside `/folder-tree`). Frontend `modules/recentChangesController.js`, hydrated from all three render sites (document view, folder home, space home). Cards reuse the folder Grid tile markup + `navigationController.loadCoverPanels`, but must **NOT** wear `folder-card-bootstrap`/`file-card-bootstrap` — those are BEHAVIOURAL hooks that would attach a same-space click handler, which for a cross-space block navigates nowhere; `.kr-recent-card` restates the visual. Opening delegates to `linkedDocumentsController.open`, which already knows to select another space before loading a folder in it. Styles `.kr-recent*` in `src/web/wiki/public/css/wiki.css`, every rule scoped under the marker class for the same specificity reason as the landing bands.
- **Changes in your interests** (```` ```pinned-recent-changes ````): the same activity grid, scoped to whatever THE READER has pinned instead of to a folder the author named. Identical grammar minus `folder:` — that absence is the entire difference, and it makes the block PER-USER: one page shows each person different news, so it can never be cached or pre-rendered per page. Parser: `renderPinnedRecentChanges` (both blocks share `parseRecentChanges` and emit through `recentChangesPlaceholder_`; **`data-recent-source` is what tells the hydrator which one it is holding**). Editor: both are produced by `registerRecentBlock(spec)` off a `hasFolder` flag, and their input roles are deliberately SHARED (`recent-folder`, …) because `_handleInput` dispatches by block TYPE — only CLICK roles need namespacing in this editor.
  - Route `GET /applications/wiki/api/spaces/:spaceId/pinned-recent-changes` (`filingRoutes.js`). **Always requires a session, even in a public space** — there is no such thing as an anonymous reader's pins, and answering with somebody else's would be worse than answering with none. Pins are read through `spaceUserStore` + `userArtifacts.forSpace`, so the legacy space-name stamp is dropped and scoping is the space's REAL visibility rules; a pin on a curated-away path is never scanned. An unreadable pins file is an empty feed, not a 500 — a first-time reader has no file yet.
  - **`planPinnedScan` (in `utils/recentChanges.js`) is where the cost is contained**, and each of its three reductions matters: a pinned folder INSIDE another pinned folder is dropped (the outer walk already reaches it); a pinned DOCUMENT under a pinned folder likewise; and the documents left over are grouped by parent and scanned ONE level deep, then filtered back to the pinned paths — the same walk, the same visibility rules and the same cache as everything else, rather than a second way of asking the file system about one file. Nesting is compared WITH the separator (`Sell` must not swallow `Selling`). A budget of `WIKI_PINNED_SCAN_MAX_FOLDERS` (12) scans caps the fan-out, keeping FOLDERS over document groups, and the overflow is reported as `pinned.skipped` → the UI's "N more were skipped" footnote, never silently dropped. Legs run `WIKI_PINNED_SCAN_CONCURRENCY` (3) at a time — these walks are IO-bound, so more just queues and worsens the tail for whoever else is loading a folder tree — and every leg goes through the SAME `recentEntriesForSpace` cache, so a folder another block already scanned is free and two readers who pin the same folder share one walk. `mergeRecentEntries` dedupes by path, because overlapping pinned subtrees are normal and one file appearing twice in a "what changed" grid reads as a bug.
  - **Both blocks paint SKELETON cards while they wait**, not a line of text: the pinned one fans out over several subtrees and is genuinely slower, and "Loading…" makes a slow panel look like a broken one. The caption under the grid is a live `role="status"` region and the placeholder cards are `aria-hidden`, so a screen reader hears the sentence once rather than four empty articles. The pinned variant additionally fires `GET /pins` **in parallel with** the scan purely to name the count — it almost always wins the race, and when it does not the generic caption simply stands, so a cosmetic detail can never delay the data. Styles `.kr-recent-skel-*` + `@keyframes kr-recent-shimmer` in wiki.css, both dropped under `prefers-reduced-motion` (the caption carries the same information in words). The tint is `--kr-border`, NOT `--kr-surface-2` — that token is `#fbfcfc` and reads as an empty box against a white card.
- **Continuous Explorations** (`src/wiki/continuousExploration/`, routes at `/applications/wiki/api/continuous-explorations/*`): AI-drafted architecture docs. Templates live in `<space>/.system/continuous-explorations/.templates/*.json` (defaults seeded on first list). A continuous exploration project is a VISIBLE folder created where the user right-clicked: `<space>/<parent>/<Name>/` holding `.continuous-exploration.json`, `.chat.json` and generated `*.md` as normal wiki docs; the folder gets folder-type `continuous-exploration` (parent's `.settings/file-types.json`) so the nav shows an exploration icon and clicking it opens the exploration workspace. Uses the CORE `aiservice` (Ollama), not the wiki's per-user `aiService` wrapper. Frontend: Templates hub (`templatescontroller.js`), wizard (`continuousExplorationWizard.js`), workspace (`continuousExplorationController.js`); right-click → Create Continuous Exploration
  - **Grounding (`wikiContext`) is an ORDERED list, scoped to the project's OWN space.** `continuousExplorationContextPicker.js` is the single picker (wizard step 3 + the Edit wiki context modal): a search box over ONE space, an ordered selection list (drag / ↑↓), and a browse tree. Order is data — `wikiContextLoader` reads the entries in array order and spends a 60 KB budget as it goes, so what sits at the top is what the AI is guaranteed to see; nothing may sort or dedupe it. An entry names a folder OR a single file, and which one is decided by **stat'ing the path**, not by the entry's `kind` (a hint for the UI's icon that legacy records don't carry at all). A picked PDF/office file resolves through its folder-local `.system/derived/` sidecar — the same text search indexes — while still being cited under the ORIGINAL's path. Search combines two sources because neither covers the space alone: the space's `folder-tree?depth=4` (the only source of FOLDERS — there is no server-side folder search, and the tree is lazy for the reasons above) and `search/suggestions?documents=true` + `/search` scoped by `spaceId` (the only way to reach a file deeper than that walk, or one matching on CONTENT). Covered by `tests/backend/components/wikiContextLoader.test.js`.
- **`.system/context/` vs `.aicontext/` — NOT the same thing.** `.system/context/` is the curated, user-facing context layer: written by the build-context workflow (sibling `system-context` repo) and editable in the chat panel's Context view; layout mirrors the source tree under the space-root `.system/context/` namespace — `.system/context/<folder>/<SourceFile>.md` (sidecar keeps the source file's own name) + `.system/context/<folder>/_folder.md` (folder roll-up). (Relocated 2026-07-20 from the old per-folder `<folder>/.context/`; migrate legacy layouts with `scripts/migrate-context-to-system.js`.) `.aicontext/` is chat-internal plumbing that stays folder-local: `searchSummarizer` caches its on-the-fly ~150-word retrieval summaries as `<folder>/.aicontext/<SourceFile>-summary.md`; nothing else reads it and no UI shows it. Chat resolves each search hit's context in priority order: fresh `.system/context/` sidecar → fresh `.aicontext/` cache → generate fresh (cached to `.aicontext/`) → search excerpt (freshness = sidecar/cache mtime ≥ source mtime). Rule of thumb: `.system/context/` is the product, `.aicontext/` is a cache — safe to delete, it regenerates. (The legacy `aiContextGenerator.js` activity and its `POST /api/ai/generate-contexts` + `GET /api/ai/context-status` endpoints were retired 2026-07-16 — the batch `.aicontext/folder-context.md` files it wrote were read by nothing.)

### Shared (`src/shared/`)
- `auth/passport-config.js`, `auth/bearerTokenMiddleware.js`
- Processors: `docxprocessor.js`, `pdfprocessor.js`, `xlsxprocessor.js`, `pptxprocessor.js`
- Utils: `fileTypeUtils.js`, `validationMiddleware.js`

## Authentication Flow

1. Login: POST `/api/auth/login` → Passport validates → session + cookie
2. Session check: GET `/api/auth/check` (datasources) or `/auth/check` (wiki) → `{ user: { name, email, role }, authenticated }`
3. Bearer tokens: POST `/api/auth/token` → valid 24hr → `Authorization: Bearer <token>`

Both modules share `./.application/data/auth/`. Logout is global.

## Spaces System

CRUD at `/api/spaces/*`. Space fields: name, description, type (project/team/workflow/archive/documentation/temporary), visibility (public/private/team), permissions, allowedUsers, configuration, metadata.

See `src/datasources/SPACES.md` for full docs.

### Shared content roots — "inside the root" ≠ "this space may see it"

**SEVERAL SPACES SIT ON ONE DIRECTORY.** Engineering/Retail/Fintech/People are all rooted at `knowledge-content/engineering`, each exposing a curated slice via `configuration.allowedPaths` / `excludedPaths`. `shared/spaces/spaceVisibility.js` compiles the rules (PREFIX/subtree matching, exclusions win, no allowedPaths = unrestricted, an ancestor of an allowed root survives as a **pass-through container** that is listable but whose own contents are hidden). Two exemptions are load-bearing: **root-level files** always pass (else every curated space's `home.md` landing page goes blank) and **dot-segment paths** inherit their nearest visible ancestor's verdict (`<folder>/.system/...` belongs to `<folder>`) — which is not a back door, since a hidden folder's `.system` stays hidden.

**`shared/spaces/spacePaths.js` is the single resolver, and visibility is ON BY DEFAULT** (`resolveSpacePath`, `isPathVisible`, `handleSpacePathError`, `PATH_HIDDEN`). It used to be an opt-in flag on `documentRoutes.getDocumentAbsolutePath`, and the opt-in is precisely how the boundary was lost: five endpoints never opted in — including **`PUT /documents/content`** and **`POST /documents`** — and `annotationRoutes`/`commentsRoutes` each carried a private `resolveDocPath` copy doing the traversal guard alone. Since those two handlers echo the whole updated document back, commenting or annotating a path in a curated-away subtree returned its **full contents** and wrote a modified copy to disk. Pass `enforceVisibility: false` only where reaching a hidden path is the point, and say why at the call site. **A hidden path answers 404, never 403** — a 403 confirms the document exists, which is what the curation hides.

**The ONE exception is `POST /documents` (create), and only in the BODY — the status stays 404.** A read shares one contentless answer with a miss because a distinguishable error lets a caller map the hidden tree by probing. A create cannot: the user is told the document they are trying to MAKE "was not found", which is not a thing that can be true, and `handleHiddenPath` returned *before* the route's `logger.warn`, so the refusal left no trace on the server either — a live 404 was indistinguishable from a broken endpoint. The create branch therefore answers `reason:'PATH_NOT_PERMITTED'` naming the path the caller **just supplied** and the space whose config refused it, and logs `[Create] Refused (curated away)`. What that discloses is the space's own `excludedPaths`/`allowedPaths`, never whether anything exists on disk — an excluded path that IS a real file must still answer `PATH_NOT_PERMITTED`, **not** the 409 the overwrite guard would otherwise raise, or the refusal becomes an existence probe. This bites hardest at the SPACE ROOT, where a root-level file is exempt from `allowedPaths` (`owner === ''`, the landing-page rule) but deliberately **not** from `excludedPaths` — which is the only thing keeping the four spaces on `knowledge-content/engineering` out of each other's `Engineering.md`/`Fintech.md`/`People.md`/`Retail.md`. Diagnosed 2026-08-25 from a bare `POST … 404` in a production console. Covered by `tests/backend/components/createDocumentCuration.test.js`.

**Anything that WALKS beyond the path it was given must re-check every step.** The template cascade (`resolveTemplateCascade`, and `templateManager._cascadeDirs` for Continuous Exploration) climbs a folder's ancestors, so it crosses folders the caller never named and reached straight through a pass-through container into a hidden subtree — leaking each template's name, path and title line. Every tier is now checked; the ROOT tier is always kept (its owner folder is `''`, the root-level exemption) so a space-wide template still reaches everywhere. A client-supplied `folderPath` is validated with `isFolderAccessible` before the walk starts.

**A change event is raised ONCE PER SPACE that can see the path** (`fileWatcher.emitChangeForSpaces`). The watcher keys its watch list by directory, so spaces sharing a root collapse into one entry whose `spaces` array holds the group; the per-event WORK (cache invalidation, search index) stays on the primary because it is per-content-root, but the EVENT fans out. This fixes two things at once: notification topics are `<spaceName>::<type>:<path>` built from the subscription's space on subscribe and the event's space on publish, so with a single primary-stamped event **every subscription made in any other space on that root was silently dead** (no history, no push, no badge, nothing logged); and the same event was broadcast to Socket.IO carrying paths a space curates away, producing live nav entries that 404 when clicked.

**`templateManager._locate` takes a `spaceId`.** The same file on disk is reachable through every space on the root, so an unconstrained id scan returned whichever space came first in spaces.json — and the located space is what `templateRbacDenial` then evaluates admin rights against, i.e. RBAC against a space the user is not working in. The CE routes forward `spaceId` from query or body.

Search was already adapted and is the model to copy: `searchRoutes` judges each hit by the space the caller ASKED FOR, grouped by `contentRootKey`, never by the `spaceName` the indexer stamped (that stamp records which space indexed the root last). Covered by `tests/backend/components/{sharedContentRootGuards,sharedRootFanout,spaceVisibility}.test.js`.

## Real-Time Events

```javascript
// Datasources — direct Socket.IO
global.io.emit('workflow:start', { workflowId, executionId });
global.io.emit('workflow:complete', { workflowId, executionId, status });

// Wiki — via EventBus (auto-broadcasts to Socket.IO)
global.eventBus.emit('document-updated', { path, content });
global.eventBus.emit('document-created', { path, title });
global.eventBus.emit('folder-changed', { folderPath });
```

## Code Patterns

**Module init:**
```javascript
module.exports = function initializeModule(app, services, io, eventBus) {
  const { log, cache, queue, workflow, scheduling, filing, searching } = services;
  // 1. Init components  2. Register routes  3. Set up events  4. Start activities
};
```

**Route handler:**
```javascript
app.post('/api/workflows/', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, data: result });
  } catch (error) {
    log.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

**Async dependency init (UIService pattern):**
```javascript
function initializeApp() {
    if (typeof UIService === 'undefined') return;
    ui = new UIService({ containerId: 'App' });
}
if (typeof UIService !== 'undefined') {
    initializeApp();
} else {
    document.addEventListener('UIServiceLoaded', initializeApp);
}
```

**Socket.IO debounce pattern:**
```javascript
let pendingUpdates = [];
const debouncedUpdate = debounce(() => { pendingUpdates.forEach(updateUI); pendingUpdates = []; }, 300);
socket.on('document-updated', (doc) => { pendingUpdates.push(doc); debouncedUpdate(); });
```

## Debugging / Known Issues

**Installing:** one `npm install` at the repo root. There are no nested packages.

**Chrome CORS error:** Add `/^chrome-extension:\/\//` to `CORS_ORIGINS` in `.env`, restart backend, reload extension.

**Real-time not working:** Check DevTools → Network → WS. Verify FileWatcher running. Check `global.eventBus.eventNames()`. Ensure `./.application/documents/` exists.

**UIService ReferenceError:** Use event-driven init pattern above (applied in `src/web/datasources/public/js/app.js`).

**Header username display:** Both modules should call their auth check endpoint and display `email` (preferred) or `name`. Never display role in header.

**Login white space:** Set `html, body { min-height: 100vh; }` and `.modal { position: fixed; ... display: flex; align-items: center; }` in `public/styles.css`.

**Port in use:** `npm run kill` or `PORT=3000 npm start`.

**Module init fails:** Check `./.application/` exists, `digital-technologies-core` installed at sibling path, file permissions, logs at `./.application/logs/application.log`.

## Security Notes

1. Change `SESSION_SECRET` in production
2. CORS whitelist in `app-combined.js`
3. Rate limiting: 100 req/15min on `/api/*`
4. Bearer tokens: 24hr expiry, cleaned every 10min
5. Input validation via Joi schemas
6. Transform steps sandboxed via vm2

## Adding API Endpoints

**Datasources:** Create route in `src/datasources/routes/` → register in `initialize.js`
**Wiki:** Create route in `src/wiki/routes/` → register in `routes/index.js`

## Performance Notes

- FileWatcher: 300ms debounce prevents event flooding
- Search: incremental in-memory inverted index, background updates
- Services: initialized once, shared across modules — don't re-init in route handlers
- Frontend: debounce Socket.IO handlers 200–300ms; lazy-load assets

## Documentation

- `.docs/PRD.md` — requirements; `.docs/Architecture.md` — technical arch
- `.docs/API-Reference.md` — API docs; `.docs/User-Guide.md` — user docs
- `.docs/MCP-Server.md` — connecting an MCP client; `.docs/API Workflows.md` — workflow API
- `.docs/Linked-Documents-for-Content-Jobs.md` — how a workflow in the sibling workflows repo emits a ```` ```linked-documents ```` band (space-root-relative references, the three ownership models, how to verify)
- `src/datasources/SPACES.md` — Spaces system docs
