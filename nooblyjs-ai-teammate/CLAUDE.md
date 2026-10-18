# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`nooblyjs-ai-teammate` is **Digital Teammates**: hire, configure, budget and bill named AI agents. It is the source of agents across NooblyJS. It runs **hosted** (NooblyJS AI imports `index.js` and calls `register()`) or **standalone** (`server.js`: the same `register()` on `src/services/standalone-host.js`, with nooblyjs-core's sign-in, the shell's frame and the host's CSRF check). The app's own architecture is in `.claude/steering/structure.md` (§1 onwards) and its scope in `.claude/steering/product.md`. Its phase history is `docs/roadmap-history.md`; what is open is in `../nooblyjs-ai-host/.claude/steering/roadmap.md` ("Hosted apps: open work"). Older specs and the UI design brief are in `.claude/specs/`.

## Part of NooblyJS (read first)

This repo is hosted by **NooblyJS** (`../nooblyjs-ai-host`) at `/teammates`. Before changing how it starts, serves
pages, signs people in, stores data, emits events or calls models, read
`.claude/steering/nooblyjs-ai.md` (the shared rules, imported below: nooblyjs-ai-host owns them, and the full contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a), `.claude/steering/tech.md` (this repo's values and how it differs) and
`.claude/steering/structure.md` §0 (this repo's layout as a hosted app). The source of truth is
`../nooblyjs-ai-host/.claude/steering/structure.md` §2a. Where anything below conflicts with those, they win.

This project lives in the `nooblyjs-ai` monorepo: `nooblyjs-core` is a separate repo next to the monorepo (`file:../../nooblyjs-core`), and the AI module `nooblyjs-ai-common` lives inside it (`file:../../nooblyjs-core/src/aiservice/common`).

@.claude/steering/nooblyjs-ai.md

## Commands

```bash
npm start                      # standalone on :11202 (sign in as admin@localhost; the log says where the password is)
npm test                       # node --test test/*.test.js (offline, mock provider; .env is not loaded)
node --test test/phase3.test.js                                   # one file
node --test --test-name-pattern="API keys" test/*.test.js         # tests whose name matches
npm run coverage
AI_PROVIDER=mock npm run smoke:live   # dry run of scripts/live-smoke.js; without AI_PROVIDER it makes real Claude calls (needs ANTHROPIC_API_KEY)
```

To run the app, run NooblyJS: in `../nooblyjs-ai-host`, set `enabled: true` on the `nooblyjs-ai-teammate` entry in `data/config/hosted-apps.yaml`, then `npm start` (or `npm run dev`) there. It mounts at `/teammates` on NooblyJS's port (11001 by default) and keeps its data in `../nooblyjs-ai-host/data/teammates/`. NooblyJS's `.env` supplies the environment (`ANTHROPIC_API_KEY`, `AI_PROVIDER`, `LOG_LEVEL`, …). Hosted, the app uses the host's `express`; this repo's copy is only for standalone mode and the tests.

There is no build step and no linter. On Windows, two assertions in `test/core.test.js` that check `0o600` file modes always fail. They fail on a clean checkout too.

## Where the code is against the contract

Teammates **runs inside the NooblyJS frame**. It is the first hosted app, and the worked example in
`../nooblyjs-ai-host/docs/hosted-apps/porting-an-app.md`:

- **Server.** `register()` returns `ui: { entry: 'js/module.js', styles: ['css/teammates.css'] }`, kit icon
  names and a status card in the shell shape. The router answers every page URL with `host.frame`, sets no CSP
  of its own, and leaves CSRF to the host when `host.checksCsrf` is true.
- **Browser.** `public/js/module.js` is the route table. Each page in `public/js/pages/` exports the frame's
  `render(view, { params, query, ctx, route })` and `destroy()`, and opens through `enter()` in
  `public/js/client.js`: the app's API client (the kit's `createApi`, bound to the mount path), the streamed-task
  reader, the app's meta and session, live updates as `ctx.on(kind, fn)` over the frame's `ctx.sse`, and
  `can('manager')` in the app's role names. `html` and `icon` come from the kit (`/ui/js/html.js`,
  `/ui/js/icons.js`). There is no bridge and no copy of a kit helper. Toasts and dialogs live in
  `#teammates-portal` (`ui.js`).
- **Two roots.** The **roster** is built on the kit's components and renders inside `.tm-kit`. The other pages
  keep their own components and render inside `.tm-root`. A page moves from one to the other by passing
  `{ kit: true }` to `enter()` and using kit components.
- **CSS.** `public/css/teammates.css` is the old `styles.css` plus `teammates.css`, scoped with
  `nooblyjs-core/scripts/scope-css.js`, with its old tokens pointing at the kit's. Its element-level rules and its
  rules for class names the kit also has (`.btn`, `.card`, `.chip`, `.stat`…) are confined to
  `:where(.tm-root)`, where the kit's rules for those names are reverted first. So the kit and the older pages
  never restyle each other. Styles for kit-built pages go under `.tm-kit` and use new class names (`tmk-…`).
  Every selector must start with `[data-module="teammates"]` (`test/public/module.test.js`).
- **Live updates.** The app has no event stream. `EventBus.publish()` (`src/services/events.js`) sends each
  one to `host.events` as `teammates.<kind>_changed` (or `teammates.alert_raised`) with its data in `live`, and
  the pages hear it through `ctx.sse`.
- **What other apps call.** `register()` returns `services` (`src/services/host-tasks.js`): `roster()`,
  `get(slug)`, `availability(slug)`, `provider()`, `runTask(…)` and `board` (`post`, `list`, `now`: the Team board). NooblyJS's team chat, the Product Factory's
  drafting and the Teams bot all run through `runTask`: it refuses a teammate who can't take work, runs the task
  without tools, bills the NooblyJS team named in `billTo`, records `itemId`, `system` and `workType` on the work
  item, and emits `teammate.task_started` / `task_finished` / `task_refused`. With the mock provider it plays
  the caller's `scripted` answer. The Anthropic API is refused when `NODE_ENV=production`.
- **Still to do.** The pages other than the roster are not on the kit's components yet.

**Permissions are rows of the NooblyJS matrix** (`src/services/auth.js` `PERMISSION_FOR_ROLE`, mirrored in
`public/js/client.js`):

| Teammates role or action | NooblyJS permission | Who has it |
| --- | --- | --- |
| viewer | `read` | everyone |
| manager (give work, approve timesheets and pending tasks) | `approve` | Approver, Architect, Owner |
| owner (settings, billing, admin) | `set-budgets` | Owner |
| hiring (`POST /teammates`) | `hire-teammates` | Owner |

`[CONFIRM]` the mapping of manager to `approve`.

## Architecture

**Layout.** `src/` has exactly seven folders: `config/`, `controllers/`, `middleware/`, `models/`, `routes/`, `services/` and `utils/` (`.claude/steering/structure.md` §4). Don't add files at the `src/` root or new top-level folders. A new endpoint is a handler in `controllers/<resource>.js` plus a line in `routes/`. Rules go in `services/`, and file access goes in `models/`.

**Entry point.** `index.js` exports `register(app, serverManager, { mountPath, dataDir, host })` (and `NAV`). Its private `build()` is the composition root: it creates the nooblyjs-core instances, the `FsStore` and models, and the services, then mounts `createRouter()` (`src/routes/index.js`). If any step throws, it stops what it had started, so a failed start leaves nothing mounted. `register()` returns the `HostedApp` (`nav`, `status()`, `seed()`, `close()`) plus `internals`, which holds the built services (`repos`, `store`, `invocation`, `scheduler`, …) for the tests. Extra options (`providers`, `now`, `log`, `core`, `sessionSecret`, `scheduleIntervalMs`, …) are test overrides; NooblyJS passes only the three. Only `server.js` listens on a port; hosted, nothing does.

**One router per app.** Mounted once with `app.use(mountPath, router)`. Inside it, paths are relative to the mount path:
- `middleware/security.js` headers, then `middleware/static.js` (`public/`, `index: false`).
- `/api/v1`: `middleware/metrics.js`, then `/health` (public), then `authenticate()` (`middleware/auth.js`). That accepts a `dtk_` API key, or calls `host.auth`, which sets `req.person`, and then sets `req.actor` and the CSRF token. Next, `host.audit` wraps every write, then the session, admin, billing and api routers, which wire paths and role checks to `controllers/`. Unknown API paths get a JSON 404, and `middleware/errors.js` gives every error the shape `{ error: { code, message, details } }`.
- `/uploads/:file` (signed-in only).
- Route modules receive `express` as a parameter. Don't `import express` in `src/`, because the contract requires the host's copy.

**Roles.** Teammates keeps three roles internally (viewer < manager < owner). `roleFromAccess()` derives them from the person's NooblyJS access role. `requireRole(role)` hands the check to `host.requireRole(PERMISSION_FOR_ROLE[role])`, so the host decides and audits refusals. It falls back to the local check only when the host has no `requireRole`. API keys may only call `POST /api/v1/teammates/:id/tasks` and read the tasks they started.

**nooblyjs-core.** `src/services/core/index.js` `createCore()` takes the host's `serverManager` and creates this app's own named instances of logging (file), cache, queue, notifying, measuring and scheduling. `register()` names them after the mount path. Never call `serverManager.initialize()`. That belongs to the host, and the registry is a process-wide singleton bound to the first Express app. nooblyjs-core's `scheduling` is also one service per process and ignores instance names, so the schedule check's task name comes from `checkTaskName(instanceName)` (`src/services/scheduler.js`). nooblyjs-core's own Express-4-style routes (`*`, `:x?`, `:x(*)`) go through its `src/shared/utils/routePattern.js` so they work on Express 5 hosts.

**Data.** Files are the database: Markdown with YAML front matter under `dataDir`, through `src/models/fs-store.js`. It does atomic tmp-then-rename writes, per-path locks and path-segment validation, and caches parsed documents on core caching, invalidated by mtime and size. Secret-bearing files (`system/*`, `config/webhooks.md`, `config/mcp-servers.md`) are never cached, because `/services/caching/` can read cache values. There is one model (repo) per entity in `src/models/`, and services in `src/services/` hold the rules. `ensureSeeded()` (`src/services/seed.js`, data in `src/config/seed-data.js`) writes the mockup seed on first start. Teammates still uses its own `FsStore`, not `host.store`.

**Work.** `InvocationService` (`src/services/invocation.js`) runs a task. It covers the budget and approval-threshold gate (tasks over the threshold wait in `approvals`), the provider call (`src/services/providers/`: `mock` offline, `anthropic` when credentials exist, or forced with `AI_PROVIDER`), the timesheet entry (hours = tokens ÷ `billing.tokensPerHour`, plus the real API cost), and memory reflection. Webhook deliveries go through `JobQueue` (`src/services/core/job-queue.js`) on core queueing with retries. `WebhookService.emit()` also forwards each event to `host.events`. Live browser updates go over `/api/v1/events` (SSE), through `EventBus` on core notifying.

## Tests

`test/helpers.js` starts one stand-in host per test process (`test/fixtures/host.js`, which is `src/services/standalone-host.js`), listening on a random port. Each `startApp()` calls `register()` to mount another app on it and spreads its `internals` onto the returned object: the first at `/teammates`, then `/teammates-2`, and so on, each with its own temp `dataDir` and core instances. `app.base` is the host (`/services/…`, `/api/auth/check`), and `app.url` is the app's root. `app.get('/api/v1/…')` and `app.send(method, path, body)` take paths inside the app and send the owner's session cookie and CSRF header. Core users are created with core roles (`owner`, `manager`, `viewer`). The stand-in maps those to access roles (Owner, Approver, Viewer) and records the host's audit and event logs in memory (`app.host.auditLog`, `app.host.eventLog`). `test/register.test.js` checks the hosted-app contract itself.
