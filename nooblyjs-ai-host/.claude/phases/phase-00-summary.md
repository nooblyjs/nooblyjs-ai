# Phase 0 — Foundations: summary

**Status:** done (reviewed; ticked in the roadmap tracker). Spec:
`.claude/specs/phase-00-foundations/`.

## What was built

| Area | What |
| --- | --- |
| Boot | The composition root `app.js`: `createApp({ config })` (helmet, compression, rate limits, session and Passport, nooblyjs-core and its cache/search/queue switches, sign-in with the AUTH_METHOD switch for Entra, then NooblyJS) for tests on port 0. `node app.js` also creates the HTTP or HTTPS server, listens on `127.0.0.1:11001` (the default since review; the run below used 11200) and shuts down gracefully. `GET /healthz` |
| Settings | `src/config.js`: environment read once and validated. `NOOBLY_DEV_LOGIN=true` with `NODE_ENV=production` is refused, and so is `AI_PROVIDER=anthropic` in production. `.env.example` lists every variable |
| Store | `FsStore` moved into **nooblyjs-core** (`src/store/fs-store.js`, CommonJS): atomic writes, per-path locks, path safety, CORE_SCHEMA, mtime-checked cache, plus `readYaml`, `writeYaml`, `appendYaml` and `readYamlStream` for config and daily streams. nooblyjs-core gained `js-yaml@4` |
| Seed | `src/seed/data/` (config, access matrix, job titles, five people, three teams), written on first start. `npm run seed` writes what is missing, and `-- --reset` wipes `data/` first |
| Logs | `data/events/YYYY/MM/<day>.yaml` and `data/audit/YYYY/MM/<day>.yaml` (multi-document YAML). Every write and every 403 is audited once, when the response finishes, with the actor, action, target and status |
| Sign-in | nooblyjs-core's authservice, sessions and Passport on NooblyJS's Express 5 app. Each seeded person gets a core account (Owners get core `admin`, so they can open `/services`). `/login` is the dev person picker. `session.signed_in` is audited and emitted |
| Security | Security headers and a CSP, a double-submit CSRF cookie on every non-GET request, open-redirect-safe `next`, and pages that send a signed-out person to `/login` while APIs get 401 |
| People on first sign-in | (Added after review.) Someone who signs in (Microsoft Entra ID or a local nooblyjs-core account) with no NooblyJS record gets one: `data/people/<email-slug>/PERSON.md`, access role Viewer (`newPersonRole` in `roles.yaml`), or Owner for emails in `NOOBLY_OWNERS`. One record even under simultaneous requests, `-2` on an id clash, never replaces a switched-off record, audited and evented as `person.created`. Work role and teams come from onboarding (Phase 3) |
| Roles | `requireRole(permission)` over `data/access/roles.yaml` (the product.md §6 matrix). Unknown permissions are refused |
| Hosted apps | `src/hosted-apps.js` loads `data/config/hosted-apps.yaml` (`package:`, or `path:` in development only) and calls `register()` with the full `host` object. A failure is logged, and the app is listed as unavailable. Per-app seed runs on first start, and `close()` runs in reverse order |
| Shell API | `GET /api/v1/shell` (person plus apps, with nav filtered by permission) and `/api/v1/shell/status` (1 s cap). `host.frame` is the placeholder page until Phase 1 |
| Pages | Server-rendered with an escaping template and no scripts: the login picker, and the placeholder "Signed in as …" page with the mounted apps and Sign out |
| Fixtures | `test/fixtures/hello-app` (the stub at `/hello`) and `test/fixtures/broken-app` (its `register()` throws) |

## Test script result (roadmap Phase 0)

Run against the real server (`node --env-file-if-exists=.env app.js`, the `npm start` command) on 2026-10-08, with `PORT=11200 HTTPS_ENABLED=false AUTH_METHOD=local` overriding the local `.env`:

| Step | Result |
| --- | --- |
| 1. Start: the log prints the URL and data folder | PASS: "NooblyJS is listening on http://127.0.0.1:11200 (data: …\nooblyjs-ai-host\data)" |
| 2. `/healthz` | PASS: `{"status":"ok","version":"0.1.0","dataDir":"…"}` |
| 3. Sent to `/login`, five people, pick Lerato, see who you are | PASS: "Signed in as Lerato M." / "Approver · Product manager · delivery-squad" |
| 4. `data/people/lerato-m/PERSON.md` is readable | PASS |
| 5. `session.signed_in` in today's audit file | PASS |
| 6. Delete `data/`, restart, seed rewritten | PASS (17 files) |
| 7. `npm test` green | PASS: 28 tests, 28 pass |
| 8. Production + dev login refuses to start | PASS, with the reason |
| 9. Enable hello-app: mounted log, `/hello/` frame, ping only when signed in | PASS: 401 signed out, 200 signed in |
| 10. A throwing `register()`: NooblyJS starts and logs which app failed | PASS: "could not mount broken-app at /hello: …" (used the broken-app fixture) |

Automated checks cover the store guarantees, seed idempotency, dev-login refusal (including
`app.js` itself), sign-in, CSRF, roles, audit and events, and the hosted-app contract
(mount, frame fallback, `/api/v1/shell`, status, auth, services, per-app seed, failure isolation).

## Placeholders and assumptions

- Seeded emails use `<id>@noobly.local` until people come from Microsoft Entra ID (Phase 11).
- Naledi K. (new joiner) is a **Viewer** `[CONFIRM]`.
- `organisation.yaml`: `dataRegion: "[CONFIRM REGION]"`. Teams' Microsoft Teams channels are `[PLACEHOLDER]`.
- Permission keys: `read`, `draft`, `approve`, `accept-decisions`, `merge`, `hire-teammates`,
  `set-budgets`, `change-guardrails`, `change-repo-access`. Apps may add their own.

## Things to know

- **Sessions are in memory:** a restart signs everyone out. A persistent store comes with SSO (Phase 11).
- **Startup time:** about 2.4 s on a fresh data folder (creating five core accounts hashes five
  passwords) and about 0.5 s afterwards. nooblyjs-core itself takes about 1 s to load.
- **Graceful shutdown on Windows:** the test driver's `kill('SIGINT')` terminates the process
  outright on Windows, so the SIGINT handler itself was not exercised there. `close()` is
  exercised by every test file's teardown.
- **Contract finding:** `express.static` must get `redirect: false`, or the bare mount path
  answers 301. `structure.md` §2a and the four child repos' `tech.md` now say so.
- **`.env.example`** was legacy Knowledge's template. It was replaced. The original (Entra SSO,
  HTTPS and TLS settings worth reusing in Phase 11) is in git: `git show 2b9f9bb:.env.example`.
- **`app.js` is the composition root** (it replaced `server.js` and `src/app.js` after review). It
  uses `src/utils/createServer.js`, `src/utils/StructuredLogger.js` and `src/startup/startupRunner.js`,
  now ES modules. The other five files in `src/utils/` are unused CommonJS leftovers `[CONFIRM delete]`.
- **The local `.env`** sets `HTTPS_ENABLED=true` (certificates `./certs/server.*` don't exist yet, so
  start-up stops and says so), `AUTH_METHOD=azure`, `PORT=11001` and `NODE_TLS_REJECT_UNAUTHORIZED=0`
  (turns off TLS checks for every outbound call; `app.js` already trusts the OS certificate store).
- **`public/`** is still the Teammates reference copy. Phase 0 serves nothing from it. Phase 1 replaces it.
- **nooblyjs-ai-teammate** still has its own FsStore. Its `tech.md` now says to switch to nooblyjs-core's copy.

## Open questions for review

1. Is the data layout readable to you? Are the file names what you'd expect? This is the
   cheapest moment to change `structure.md` §4 and the `register()` contract in §2a.
2. Naledi's access role, and the default access role for new joiners.
3. What to do with the five unused files in `src/utils/`.
