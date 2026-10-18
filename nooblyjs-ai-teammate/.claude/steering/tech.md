---
inclusion: always
---

# Digital Teammates: this repo in NooblyJS

> **Read `NOOBLY.md` first** (in this folder; generated from noobly). noobly owns everything shared, and this file does not
> repeat it: the hosted-app contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a, the cross-app services are
> `../nooblyjs-ai-host/.claude/steering/tech.md` §8b, governance and the permissions matrix are `../nooblyjs-ai-host/.claude/steering/product.md`,
> and the one roadmap is `../nooblyjs-ai-host/.claude/steering/roadmap.md` (with the hosted-app checklist this repo must pass).
> If this file and noobly disagree, **noobly wins**: follow it and fix this file in the same change.
>
> NooblyJS mounts this repo at **`/teammates`**. This file gives only this repo's values for the contract, where it
> differs from the defaults, and what it is like today.

## 1. This repo's values

| | |
| --- | --- |
| Entry | `index.js` (`"main"`): `register()` builds everything in a private `build()`; `close()` is the old `shutdown()`. The tests reach the services through the returned `internals` |
| `register()` | default mount `/teammates`, name `teammates`, styles `css/teammates.css`, data under `data/teammates/` |
| Standalone | **None**: this repo is a library (§2). Express is only a devDependency, for the tests' stand-in host |
| `agent.action` | `system: 'teammates'`, or the calling app's system for a `runTask` on its behalf |
| `services` | `host.service('teammates')`: `roster`, `get`, `availability`, `provider`, **`runTask`**, listed in noobly `tech.md` §8b. Every agent action in NooblyJS is a `runTask`, so keep them small and stable |
| Pages | The old pages run unchanged through `public/js/bridge.js` (`legacyPage`); port them to the frame's contract one at a time (`../nooblyjs-ai-host/docs/hosted-apps/porting-an-app.md`, which uses this repo as the worked example) |

## 2. Hosted, and standalone for development

Teammates is a package that NooblyJS AI imports (`"main": "index.js"`), and it also runs on its own
(NooblyJS's `structure.md` §2a, standalone mode). Both run the same `register()`.

- **Hosted**, run NooblyJS AI: in `../nooblyjs-ai-host`, set `enabled: true` on the `nooblyjs-ai-teammate` entry in
  `data/config/hosted-apps.yaml` and run `npm start` (or `npm run dev`) there. The app is at
  `/teammates` on the host's port (11001 by default), with its data in `../nooblyjs-ai-host/data/teammates/`.
  The host's `.env` supplies the environment (`ANTHROPIC_API_KEY`, `AI_PROVIDER`, `LOG_LEVEL`, …).
- **Standalone**, `npm start` here runs `server.js` on `PORT` (11202) with `DATA_DIR` (`./data`). It builds the host
  side itself with `src/services/standalone-host.js`: an Express 5 app, the nooblyjs-core `serverManager`, people
  signing in through core's authservice (core roles → access roles), the shell's frame and `/ui/` kit from
  nooblyjs-core, and the host's double-submit CSRF check (`host.checksCsrf`). Settings are in `.env.example`.
- **The tests** mount the app on the same host (`test/fixtures/host.js` re-exports it), without the frame and with the
  app's own CSRF check; `test/standalone.test.js` runs `server.js` itself.
- `host.service()` returns `undefined` for apps the host hasn't loaded (standalone: all of them), so handle that.
- `register()` itself never listens or reads env vars for the port, host, data folder or mount path: the host (or
  `server.js`) passes `mountPath` and `dataDir`.

## 3. Platform (NooblyJS Phase 9)

**NooblyJS Phase 9 (Platform).** `runTask` asks `host.service('platform').checkAgentWork({ system, workType, repo,
teammateId, itemId })` before `teammate.task_started`: a refusal (`repo_no_access` 403, `budget_reached` 402,
`provider_not_allowed` 403) emits `teammate.task_refused` and bills nothing. The route Platform returns replaces the
teammate's model for that work type (`InvocationService.routedModel`, priced from the catalogue), its fallback answers
once if the provider fails, and `modelRoute` is `<provider>/<model>` (`mock/<model>` when scripted). A route on
`bedrock`, `vertex` or `azure` uses that host when its credentials are set (`providers/index.js`), else the
Anthropic API in development, else the mock. While a task runs it is registered on Platform's container runtime;
Stop there aborts it. With no Platform (standalone), nothing changes.

## 4. This repo today, and what changed when it joined NooblyJS

Teammates is closest to the platform already: ESM, Express 5, `js-yaml`, `nooblyjs-core` and
`nooblyjs-ai-common` linked with `file:`, the Markdown FsStore, and pages that render into a view
they're given. Work in progress has hosted it with a **different contract**:
`serveStatic` / `initialize(context)` / `serveSpaFallback` / `shutdown`, with its own
`index.html`. That contract was written for the legacy Knowledge container. NooblyJS uses
**`register()` plus a UI module** instead, so reshape that work rather than extending it. The
NooblyJS roadmap does this in **Phase 6**.

| Today (incl. uncommitted work) | Hosted in NooblyJS |
| --- | --- |
| `index.js` exports `name`, `basePath`, `dataDir`, `serveStatic`, `initialize`, `serveSpaFallback`, `shutdown` | `index.js` exports **`register(app, serverManager, { mountPath, dataDir, host })`** and returns the `HostedApp` (`structure.md` §0). Done. There is no `createApp()` or `src/app.js`: `index.js` builds everything in its private `build()`, and `shutdown()` is the returned `close()`. The tests call `register()` and reach the services through the returned `internals` |
| `TEAMMATES_BASE_PATH`, `DATA_DIR` env vars | `options.mountPath` and `options.dataDir` (NooblyJS passes `data/teammates/`). Done: no env vars are read for them |
| `src/web.js`: `serveStatic` plus `serveSpaFallback`, which serves `index.html` with `{{base}}` filled in. `public/js/base.js` | Done. `src/middleware/static.js` serves `public/` (`index: false`). Every other page URL (no file extension) answers with `host.frame`. `base.js` works out the mount path from its own URL |
| `public/index.html` plus `public/js/app.js` (NAV, ROUTES, sidebar, sign-in state, its own EventSource) | Done. **`public/js/module.js`** is the route table, and `register()` returns `ui` and the `nav`. `app.js` and `pages/login.js` are gone. The pages run unchanged through `public/js/bridge.js` (`legacyPage`), which gives them their old `render(view, { params: [..], query, ctx, isCurrent })` contract on top of the frame's. Port them to the frame's contract and the kit's components one at a time |
| `ctx.on(type, fn)` on its own `/api/events` stream | Done (NooblyJS Phase 6). The app has no stream: `EventBus.publish()` emits `teammates.<kind>_changed` through `host.events.emit()` with the data in `live`, and `client.js` maps `ctx.on(kind, fn)` onto `ctx.sse.on()` |
| `ctx.session.user.role` (`viewer` / `manager` / `owner`), `can(role)` | Done. The roles map to NooblyJS permissions: viewer → `read`, manager → `approve`, owner → `set-budgets`, plus hiring → `hire-teammates` (`PERMISSION_FOR_ROLE`, server and bridge). `ctx.can(role)` asks the frame for the mapped permission. `[CONFIRM]` manager → `approve` |
| `public/css/styles.css` plus `teammates.css`, global | Done. One `public/css/teammates.css`, scoped with `nooblyjs-core/scripts/scope-css.js`. The old tokens point at the kit's, and kit class names Teammates also uses are reverted inside its pages (`test/public/module.test.js`) |
| `src/core/` builds its own nooblyjs-core registry on a separate Express 4 app (`coreRouter()`, `coreSession()`), plus `src/middleware/auth.js` and `src/routes/session.js` | Hosted: the host's `serverManager`, `host.auth` and the host's CSRF. None of `src/core/index.js`'s registry, session or Passport setup runs. Done: `src/services/core/` only creates this app's named service instances. The registry, session and Passport setup live in the host (NooblyJS, or `test/fixtures/host.js` in the tests) |
| API under `<base>/api/…` (`/api/meta`, `/api/session`, `/api/admin`, …) | `/teammates/api/v1/…`. `/api/session` and `/login` go, because the host owns sign-in |
| `server.js`, `.env.example`, `npm start` / `npm run dev` | **Back as standalone mode** (§2): `server.js` runs `register()` on `src/services/standalone-host.js`, which the tests use too |
| Model profiles and prices in `data/config/models.md` | Model calls go through `nooblyjs-ai-common` and the platform's routing (`data/platform/model-routes.yaml`, Bedrock / Vertex / Azure in production). `models.md` keeps only teammate billing settings (rate, `tokensPerHour`) `[CONFIRM in Phase 9]` |
| API keys (`dtk_…`) for outside callers | Kept, for `POST /teammates/api/v1/teammates/:slug/tasks` only. The key's caller is the audited actor. An agent acting for a key is still capped at Contributor |
| `data/system/users.md`, `data/core/` (auth, sessions) | Not used when hosted. People and sign-in belong to NooblyJS |
| Its own `src/models/fs-store.js` (was `src/store/`) | **FsStore now lives in nooblyjs-core** (NooblyJS Phase 0): `require('nooblyjs-core/src/store/fs-store.js')` (CommonJS; import it with `createRequire` or a default import). Same API and guarantees, plus `readYaml`, `writeYaml`, `appendYaml` and `readYamlStream`. When hosted, use `host.store`. Switch the imports to the shared copy and delete this one; its tests must still pass |

**Teammates is the source of agents across NooblyJS** (chat, the Teams bot, Product Factory
drafting). The `services` in `structure.md` §0 are how the others reach it, so keep them small
and stable. Every task records `{ actor, teammateId, itemId, system, modelRoute, costUsd, at }`
and bills to the right team's timesheet.
