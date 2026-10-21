# Phase 0 — Foundations: design

> **Status: done 2026-10-08.** Summary: `.claude/phases/phase-00-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

## 1. Files

```
noobly/
  package.json            "type": "module"; engines node >= 22.12; deps: express@5, js-yaml@4,
                          nooblyjs-core (file:), nooblyjs-ai-teammate (file:, not enabled yet)
  app.js                  composition root: createApp({ config }) and, when run, server → listen → shutdown
  .env.example
  src/
    noobly.js               prepareData() + mountNoobly(): the NooblyJS layer app.js mounts after its infrastructure
    config.js             loadConfig(env) → frozen config; refuses dev login in production
    core.js               startCore(): nooblyjs-core serverManager on the Express 5 app, file logging,
                          sessions + Passport (core's copies), authservice (file, data/core/auth)
    hosted-apps.js        loadHostedApps(): reads hosted-apps.yaml, builds `host`, calls register()
    shell.js              createShell(): the app list, GET /api/v1/shell(/status), placeholder frame
                          (moves into nooblyjs-core as the real frame in Phase 1)
    middleware/
      security.js         headers (nosniff, referrer, CSP for NooblyJS pages)
      csrf.js             double-submit cookie
      auth.js             requireSignIn (pages → /login, API → 401), req.person
      roles.js            requireRole(permission) from data/access/roles.yaml
      audit.js            audit every write, record() for anything else
      errors.js           one error shape, 404 for unknown API routes
    routes/
      session.js          GET /healthz, GET/POST /login, POST /logout, GET /api/v1/me
    services/
      audit-log.js        appends to data/audit/YYYY/MM/<day>.yaml
      events.js           appends to data/events/YYYY/MM/<day>.yaml + an in-process bus
      people.js           PERSON.md + profile.md → person; core user ↔ person
    seed/
      index.js            seed({ store, authservice, reset }) — idempotent
      data/               the seed files, mirroring data/
    pages/
      html.js             escaping tagged template
      login.js            the person picker (and the "no dev login" message)
      placeholder.js      "who you are" page, used as host.frame and for /
    util/
      dates.js · errors.js · ids.js
  scripts/seed.js         npm run seed [-- --reset]
  test/
    fixtures/hello-app/   index.js · public/js/module.js · public/css/hello.css
    fixtures/broken-app/  index.js whose register() throws
    helpers.js            tempDataDir(), startApp(), signIn(), csrf helpers
    store.test.js · seed.test.js · config.test.js · session.test.js · hosted-apps.test.js
nooblyjs-core/
  src/store/fs-store.js   FsStore (CommonJS), ported from nooblyjs-ai-teammate with YAML stream
                          appends; tests in nooblyjs-ai-host (node:test)
  package.json            + "js-yaml": "^4.1.0"
```

`public/` (the Teammates reference copy) is left untouched. The two Phase 0 pages are rendered
by the server with an escaping template and no inline script, so no static files are needed
until the frame arrives in Phase 1.

## 2. Request pipeline

```
security headers → express.json/urlencoded → session (express-session, core's copy)
  → passport.initialize/session (core's copy) → csrf → audit (writes)
  → routes: /healthz · /login · /logout · /api/v1/me · /api/v1/shell(/status)
  → hosted apps (each under its mount path, behind host.auth inside its router)
  → nooblyjs-core /services/* (registered by serverManager.initialize)
  → placeholder frame for / → 404 → error handler
```

- The session cookie is `noobly.sid` (httpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=true`).
  The session store is express-session's memory store in Phase 0, so a restart signs people
  out. A persistent store comes with SSO (Phase 11).
- CSRF: a random token in the `noobly.csrf` cookie (readable by the page). Every non-GET
  request must send the same value in the `X-CSRF-Token` header or a `_csrf` form field.
  `/healthz` and GET requests are exempt. A failure gives 403 `csrf_failed` and is audited.

## 3. Sign-in

- The seed creates a core authservice account per seeded person (email, full name, a random
  password nobody uses, core role `admin` for Owners and `user` otherwise). NooblyJS's own record
  is `data/people/<id>/PERSON.md`, which holds the **access role**.
- `POST /login { personId }` (dev login only): load the person, find the core user by email,
  `req.login(coreUser)` through core's Passport (it serialises by email), audit
  `session.signed_in`, emit `session.signed_in`, then redirect to `/`.
- `requireSignIn`: `req.user` (from Passport) → the person with that email → `req.person =
  { id, name, email, accessRole, workRole, teams, jobTitle }`. Inactive or unknown → signed out.
- Without dev login, `/login` explains that Microsoft sign-in arrives in Phase 11 and links to
  nooblyjs-core's sign-in page.

## 4. Data written in Phase 0

```
data/config/settings.yaml          organisation name [PLACEHOLDER], publicBaseUrl
data/config/hosted-apps.yaml       the five child apps (disabled) + hello-app (disabled, path:)
data/access/roles.yaml             the access roles and the permission matrix (product.md §6)
data/access/job-title-roles.yaml   job title → work role (for Phase 3 onboarding)
data/people/<id>/PERSON.md         name, email, accessRole, jobTitle, active
data/people/<id>/profile.md        workRole, teams (not for Naledi)
data/teams/<id>.md                 delivery-squad, checkout-squad, platform-team
data/events/YYYY/MM/<day>.yaml     appended
data/audit/YYYY/MM/<day>.yaml      appended
data/logs/                         nooblyjs-core file logs
data/core/auth/                    nooblyjs-core authservice files
```

**Permission keys** (`roles.yaml`), one per row of the `product.md` §6 matrix: `read`, `draft`,
`approve`, `accept-decisions`, `merge`, `hire-teammates`, `set-budgets`, `change-guardrails`,
`change-repo-access`. Apps may add their own keys to the matrix.

`hosted-apps.yaml` entries take `package:` (imported by name) or `path:` (relative to the
`nooblyjs-ai-host` repo, for fixtures). `path:` is only allowed when `NODE_ENV` isn't `production`.

## 5. Hosted-app loader

Follows `structure.md` §2a. For each enabled entry: `appDir = data/<mountPath>`, `host` =
`{ express, auth, requireRole, audit, events, store: new FsStore(appDir), people, service,
frame, publicBaseUrl }`. Then `register()` runs. `services` are recorded, `seed()` runs when
`appDir` is empty, and the description is added to the shell. Errors are logged, and the app
is listed as `unavailable`. `close()` calls each app's `close()` in reverse order.

`host.auth` is `requireSignIn` (API: 401 JSON). `host.audit` is the audit middleware with
`record()`. `host.events` is `{ emit, on }`.

## 6. nooblyjs-core on Express 5

`serverManager` is a process-wide singleton. `startCore()` calls
`setDefaultProvider('logging', 'file', { logDir })`, then `initialize(app, emitter, {})`, then
`authservice('file', { 'express-app': app, dataDir })`, as the Teammates host does. Core's
routes rely on the uncommitted Express 5 route-pattern work in `nooblyjs-core`
(`src/shared/utils/routePattern.js`). `createApp()` refuses to start a second app in one
process. Tests use one app per test file (node:test runs each file in its own process).

## 7. Testing

- `createApp()` on port 0, with built-in `fetch` and a cookie jar helper.
- The store tests import FsStore from `nooblyjs-core`.
- Failure isolation uses `test/fixtures/broken-app` listed with `path:`.
