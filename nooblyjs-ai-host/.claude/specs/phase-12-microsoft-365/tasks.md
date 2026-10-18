# Phase 12 — Microsoft 365: tasks

> **Status: built 2026-10-11, waiting for review.** Summary: `docs/phases/phase-12-summary.md`.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

- [x] 1. The Bot Framework token check (`src/teams/auth.js`), the endpoint acknowledging first, and the development Playground mode. _R1_
- [x] 2. The Bot Connector (`src/teams/connector.js`): replies to the activity's conversation with a client-credentials token, sent only to Bot Framework hosts. _R1_
- [x] 3. People: `entraId` and `jobTitle` from the Microsoft sign-in (the Entra id from the sign-in itself; the job title from Graph `/me`, which needs `User.Read` and is opt-in: `AZURE_AD_READ_PROFILE=true`); the bot finds people by `entraId`. _R2_
- [x] 4. Meeting notes: "post meeting notes to <item>". _R3_
- [x] 5. Approval notifications in Teams (personal conversations kept from installs) and Outlook (Graph `sendMail`). _R4_
- [x] 6. `apps/msteams/noobly-bot` forwards to NooblyJS; its env maps to NooblyJS's settings; Integrations shows Teams. _R5_
- [x] 7. Tests: `test/teams-real.test.js` (steps 3–6 offline, signed tokens from a test key), notifications, sign-in. _Test script_
- [x] 8. Steering, `docs/phases/phase-12-summary.md`, CLAUDE.md. _Working agreement_
