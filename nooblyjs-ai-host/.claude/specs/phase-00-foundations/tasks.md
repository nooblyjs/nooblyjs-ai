# Phase 0 — Foundations: tasks

> **Status: done 2026-10-08.** Summary: `docs/phases/phase-00-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

- [x] 1. FsStore in nooblyjs-core
  - [x] 1.1 Port `fs-store.js` to `nooblyjs-core/src/store/fs-store.js` (CommonJS) with `readYaml`,
        `writeYaml`, `appendYaml`, `readYamlStream`; add `js-yaml@4` to nooblyjs-core
  - [x] 1.2 `test/store.test.js`: atomic write, lock, path escape refused, CORE_SCHEMA dates, serialised appends
- [x] 2. Project skeleton
  - [x] 2.1 `package.json` (ESM, express 5, js-yaml 4, file: links), `.gitignore` (data/, .env), `.env.example`
  - [x] 2.2 `src/config.js` + `test/config.test.js` (dev login refused in production)
- [x] 3. Seed
  - [x] 3.1 `src/seed/data/` (config, access, people, teams) and `src/seed/index.js`
  - [x] 3.2 `scripts/seed.js` (`--reset`) + `test/seed.test.js` (idempotent)
- [x] 4. Logs and people
  - [x] 4.1 `services/events.js`, `services/audit-log.js` (daily YAML streams)
  - [x] 4.2 `services/people.js`
- [x] 5. Core and sign-in
  - [x] 5.1 `src/core.js` (serverManager on Express 5, sessions, Passport, authservice)
  - [x] 5.2 middleware: security, csrf, auth, roles, audit, errors
  - [x] 5.3 pages (login picker, placeholder) and `routes/session.js` (including `/healthz`)
  - [x] 5.4 `test/session.test.js`
- [x] 6. Hosted apps
  - [x] 6.1 `src/shell.js` (`/api/v1/shell`, `/status`, placeholder frame)
  - [x] 6.2 `src/hosted-apps.js` (loader, host object, failure isolation)
  - [x] 6.3 fixtures `hello-app`, `broken-app` + `test/hosted-apps.test.js`
- [x] 7. `app.js` composition root (createApp, server, listen, graceful shutdown)
- [x] 8. Run the Phase 0 test script (steps 1–10) and write `docs/phases/phase-00-summary.md`
- [x] 9. Note in `nooblyjs-ai-teammate/.claude/steering/tech.md` that FsStore now lives in nooblyjs-core
