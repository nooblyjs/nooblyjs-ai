---
inclusion: always
---

# Knowledge Repository (the Wiki Platform): this repo in NooblyJS

> **Read `NOOBLY.md` first** (in this folder; generated from noobly). noobly owns everything shared, and this file does not
> repeat it: the hosted-app contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a, the cross-app services are
> `../nooblyjs-ai-host/.claude/steering/tech.md` §8b, governance and the permissions matrix are `../nooblyjs-ai-host/.claude/steering/product.md`,
> and the one roadmap is `../.claude/steering/roadmap.md` (with the hosted-app checklist this repo must pass).
> If this file and noobly disagree, **noobly wins**: follow it and fix this file in the same change.
>
> NooblyJS mounts this repo at **`/wiki`**. This file gives only this repo's values for the contract, where it
> differs from the defaults, and what it is like today.

## 1. This repo's values

| | |
| --- | --- |
| Entry | **`index.mjs`** (`"main"`, `"exports"`), ES modules; the legacy wiki is CommonJS under `src/`, hosted through an adapter (`src/hosted/`), with its UI generated into the frame. See `CLAUDE.md`, "Hosted in NooblyJS" |
| `register()` | default mount **`/wiki`** (`DEFAULT_MOUNT_PATH`), name `wiki`, `provides: ['knowledge']` so other apps find it as `host.service('knowledge')`; it uses the host's registry and maps the legacy routes under `<mountPath>/api/v1` |
| Standalone | `npm start` still runs the legacy wiki (`app.js`, port 9101). There is no `server.mjs` yet |
| Storage | Records are JSON files under `data/wiki/` (the legacy format), not Markdown + YAML: a known deviation until the legacy app is retired `[CONFIRM]` |
| Dependencies | The legacy app's (Express 4 era, Socket.IO, Passport…) stay until it is retired; hosted code must not use them |
| `agent.action` | `system: 'knowledge'`. The wiki's own AI agents still call their provider directly (not through Teammates), so their spend is not in Platform's Knowledge budget yet |
| `services`, events | `host.service('knowledge')` is in noobly `tech.md` §8b; events in `structure.md` |

## 2. Platform (NooblyJS Phase 9)

**NooblyJS Phase 9 (Platform).** An import asks `host.service('platform').guardrail('redact-on-ingest')` once: with
the guardrail off, files are stored as they are and the source record says `redaction: 'off'` (the Sources screen
says so). With no answer from Platform, or standalone, an import is redacted. The wiki's own AI agents still call
their provider directly (not through Teammates), so their spend is not in Platform's Knowledge budget yet.

## 3. What NooblyJS Phase 8 added (2026-10-10)

The decision for Phase 8 was to **extend the Wiki Platform's own modules at `/wiki`**, not to rebuild Knowledge
at `/knowledge` on new screens. So the sections of this file and of `product.md` that describe `/knowledge`,
its kit screens (Ask & search, Collections, Graph, Contributions, Access) and Markdown/YAML storage describe a
target that is **not built**. What exists is in `CLAUDE.md` under "Knowledge on top of the wiki": import with
redaction, sources, cited answers with no model, answer actions, needs review, the process model, and
`services` other apps reach as `host.service('knowledge')`. Records are JSON files under `data/wiki/knowledge/`.
The wiki's AI agents still call their provider directly (not through `nooblyjs-ai-common` or Teammates).

## 4. This repo today, and the plan it was hosted against

> **As built (2026-10-09).** The entry is `index.mjs`, mounted at **`/wiki`** (name `wiki`), and `backend/` plus
> `applications/` are now one `src/` folder with a single root `package.json`. So the table below is the plan, with
> three differences: the mount path; the legacy modules and UI are hosted as they are, through an adapter and a
> generated UI, instead of being rewritten beside the old ones (see `CLAUDE.md`, "Hosted in NooblyJS"); and `src/`
> holds the legacy CommonJS code (hosted code is in
> `src/hosted/`), with no `src/package.json`. There is no `server.mjs` yet.

Today this repo is the **noobly Wiki Platform v2**, a separate application. `app.js` is its own
composition root on port 9101, using CommonJS, Express 4, Socket.IO, Passport (local, Google,
Entra), helmet, CORS and sessions. It initialises the nooblyjs-core service registry itself, stores
data as JSON in `.application/`, uses Vite front ends in `src/web/*`, and tests with Jest.
Almost none of that may run inside NooblyJS. The NooblyJS roadmap does this work in **Phase 8**.

**Strategy: build the hosted app beside the legacy one, then retire the legacy app.** Don't
convert the legacy code in place. New platform code goes in new folders, follows `tech.md`
§1, and can be tested on its own. The legacy `app.js` keeps working standalone until the hosted
app covers what people use `[CONFIRM retirement date]`.

| Today | Hosted in NooblyJS |
| --- | --- |
| `app.js` composition root (port 9101) | Root **`index.mjs`** exports `register()`. `package.json` `"main"` and `"exports"` point at it, so NooblyJS can `import { register } from 'nooblyjs-ai-knowledge'`. `app.js` stays the legacy entry (`npm start` keeps running it until retirement) |
| `"type": "commonjs"` | New code is **ESM**: `index.mjs`, `server.mjs`, and everything under `src/`, which gets its own `src/package.json` with `{ "type": "module" }`. Legacy code stays CommonJS. Hosted code may import a legacy module only if it is pure (no `app.js` wiring, no Socket.IO, no Passport, no `.application/` paths). Anything else is rewritten in `src/` |
| Express 4 routes (`/api/spaces/*`, `/api/workflows/*`, `/applications/wiki/api/*`) | An Express 5 router built with `host.express`, under `/knowledge/api/v1/…` (`structure.md` §2), with Express 5 path syntax |
| Passport (local, Google OAuth2, Entra), bearer tokens, `express-session` | `host.auth` and `host.requireRole`. Sign-in is NooblyJS's (Entra SSO). The hosted path has no Google OAuth and no sessions of its own |
| Own `serviceRegistry.initialize(app, …)` | The host's `serverManager`, never initialised here |
| Socket.IO, and FileWatcher → EventBus broadcasts | `host.events.emit()` plus the host's SSE stream (`ctx.sse` in pages). No Socket.IO |
| JSON in `.application/` (spaces, workflows, change events, config) | Markdown + YAML in `data/knowledge/` through `host.store` (`structure.md` §3). A one-off `scripts/import-application.mjs` converts existing content |
| Vite apps (`src/web/wiki`, `src/web/datasources`), and `public/index.html` | `public/js/module.js` + `public/js/pages/*.js` in plain JS with the NooblyJS kit, and `public/css/knowledge.css` scoped under `[data-module="knowledge"]`. The Vite apps serve only the legacy app. The hosted app serves `public/` with `index: false` and never serves the legacy `.html` files |
| `AIService` | `nooblyjs-ai-common`, routed by work type (`knowledge-answer`, `knowledge-ingest`, `knowledge-summarise`) |
| Datasources workflows (pipelines, schedules) | **Sources** with sync status. Connectors and indexers run as **workers** queued with `serverManager.queue()` and report through `/knowledge/internal/v1/…` |
| Jest (`tests/`) | `node:test` in `test/` for the hosted code. Jest stays for legacy until it's retired |
| `nooblyjs-core` in `CLAUDE.md` and docs | `nooblyjs-core` |
| Teams app proxy, VS Code and Chrome extensions, the wiki sync daemon | Not part of the hosted app. They stay with legacy `[CONFIRM]` |

**Must-haves the legacy app doesn't have:** PII redaction **before** a document is written
(governance), cited answers (every answer lists its sources), the "This is wrong" flag, Needs
review, and the L0 → L1 → L2 process-model viewer from the mockups.

**Dependencies for the hosted path:** `js-yaml` and `nooblyjs-ai-common` (`file:../../nooblyjs-core/src/aiservice/common`)
are added. `nooblyjs-core` is already there. Express comes from the host. Legacy dependencies stay
until the legacy app is retired. Don't use them from `src/`.
