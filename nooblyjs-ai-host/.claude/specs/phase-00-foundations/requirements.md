# Phase 0 — Foundations: requirements

> **Status: done 2026-10-08.** Summary: `docs/phases/phase-00-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 0. Goal: an empty NooblyJS app that boots, signs you
> in, writes and reads Markdown files safely, and runs its tests.
> Repos: `nooblyjs-ai-host`, `nooblyjs-core` (FsStore moves here).

## Decisions taken before starting

| Question | Answer |
| --- | --- |
| Default port | **11001** (changed from 11200 after review), on `HOST=127.0.0.1` by default |
| Node version | Node 24 LTS recommended, minimum 22.12 (`engines`). Developed on Node 26 |
| Seeded people | Stevie (Owner · Platform engineer), Lerato M. (Approver · Product manager), Thabo N. (Architect · Architect), Priya S. (Contributor · Developer), Naledi K. (new joiner, no profile, job title "Product Manager, Digital") |
| FsStore move | Add it to `nooblyjs-core` as a new file and use it from `nooblyjs-ai-host`. `nooblyjs-ai-teammate` keeps its own copy for now (another agent is changing that repo); switching it is noted in its `tech.md` |

## Requirements

### R1 — The app boots and stops cleanly

**User story:** As a developer, I can start NooblyJS with one command and stop it without losing data.

1. WHEN I run `npm start` THEN the server SHALL listen on `HOST:PORT` (default `127.0.0.1:11001`)
   and log the URL and the data folder.
2. WHEN the process gets SIGINT or SIGTERM THEN it SHALL stop accepting requests, close every
   hosted app, shut down the nooblyjs-core services and exit.
3. `GET /healthz` SHALL answer `{ "status": "ok", "version", "dataDir" }` without signing in.
4. The composition root `app.js` SHALL export `createApp({ config })` returning `{ app, close }`, so tests
   can run the whole app on port 0.

### R2 — Configuration is validated once

1. Settings SHALL come from environment variables (`.env` via `--env-file-if-exists`) and
   `data/config/*.yaml`, read once at start.
2. IF `NODE_ENV=production` AND `NOOBLY_DEV_LOGIN=true` THEN startup SHALL refuse with a message
   that says why.
3. `.env.example` SHALL list every variable Phase 0 reads, with safe defaults.

### R3 — Files are written safely (FsStore in nooblyjs-core)

1. Writes SHALL be atomic (temp file, then rename), so a reader never sees half a file.
2. Read-modify-write SHALL hold a per-path lock (`updateDoc`).
3. Every path segment SHALL match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, and the resolved path
   SHALL stay under the store's root. Anything else is refused.
4. YAML SHALL use `CORE_SCHEMA`, so ISO dates stay strings.
5. Appends to YAML streams (events, audit) SHALL be serialised per file.
6. The store SHALL live in `nooblyjs-core` and be imported from there by `nooblyjs-ai-host`.

### R4 — Seed data is written on first start

1. WHEN `DATA_DIR` is empty THEN NooblyJS SHALL write the seed: config, the access matrix, the
   five seeded people and the three teams.
2. `npm run seed` SHALL write missing seed files without touching existing ones, and
   `npm run seed -- --reset` SHALL wipe `data/` first.
3. Seeding SHALL be idempotent: running it twice leaves the same files.
4. Each person SHALL be readable Markdown: `data/people/<id>/PERSON.md` (name, email, access
   role, job title) and, except for Naledi, `profile.md` (work role, teams).

### R5 — Development sign-in

1. Sign-in SHALL use nooblyjs-core's authservice. Every seeded person has a core account.
2. WHEN `NOOBLY_DEV_LOGIN=true` THEN `/login` SHALL show a person picker with the five seeded
   people (name, access role, work role or "new joiner"). Picking one signs them in.
3. WHEN a signed-out person opens a page THEN they SHALL be sent to `/login`. An API call
   SHALL get 401 with the standard error shape.
4. Signing in SHALL write a `session.signed_in` record to today's audit file and emit a
   `session.signed_in` event.
5. After sign-in, `/` SHALL show a placeholder page that says who you are (name, access role,
   work role) and what apps are mounted, with **Sign out**.
6. Every non-GET request SHALL carry a CSRF token (double-submit cookie). Missing or wrong → 403.
7. (Added after review.) WHEN someone signs in to nooblyjs-core (e.g. with Microsoft Entra ID) and has no NooblyJS
   record THEN NooblyJS SHALL create `data/people/<id>/PERSON.md` with the access role `newPersonRole`
   (Viewer), or Owner when their email is in `NOOBLY_OWNERS`, and audit and emit `person.created`.
   A record that exists but is inactive SHALL NOT be replaced.

### R6 — Event and audit logs

1. Events SHALL be appended to `data/events/YYYY/MM/YYYY-MM-DD.yaml`, audit records to
   `data/audit/YYYY/MM/YYYY-MM-DD.yaml`, as multi-document YAML streams.
2. Every write request by a signed-in person SHALL produce an audit record (actor, action,
   target, status, time).
3. Refusals (401 on a write, 403 for a role or CSRF) SHALL be audited.

### R7 — Hosted-app loader

1. NooblyJS SHALL initialise the nooblyjs-core `serverManager` once with its Express 5 app, then load
   each enabled entry in `data/config/hosted-apps.yaml` by calling its
   `register(app, serverManager, options)` (`structure.md` §2a).
2. `options.host` SHALL provide `express, auth, requireRole, audit, events, store, people,
   service, frame, publicBaseUrl`. `store` is rooted at `data/<mountPath>/`.
3. WHEN `register()` throws THEN NooblyJS SHALL log which app failed, start without it, and list
   it as `unavailable`.
4. `GET /api/v1/shell` SHALL return the signed-in person and every app (name, label, icon,
   mountPath, ui, nav, state). `GET /api/v1/shell/status` SHALL return each app's `status()`,
   leaving out any that throw or take longer than 1 s.
5. `host.frame` SHALL be a placeholder page until Phase 1.
6. A stub app in `test/fixtures/hello-app/` (`index.js` + `public/js/module.js`) SHALL prove the
   contract at `/hello`: frame fallback for deep links, `public/` files served, and
   `/hello/api/v1/ping` only when signed in.

### R8 — Tests

1. `npm test` SHALL run offline on a temp `DATA_DIR`.
2. Automated checks SHALL cover: store (atomic write, lock, path escape refused), seed
   idempotency, dev-login refusal in production, and the hosted-app contract (mount, frame
   fallback, `/api/v1/shell`, auth, failure isolation).

## Done when

The ten steps of the Phase 0 test script in `roadmap.md` pass on a clean clone.
