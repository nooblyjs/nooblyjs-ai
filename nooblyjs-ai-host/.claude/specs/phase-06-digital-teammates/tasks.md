# Phase 6 — Digital Teammates everywhere: tasks

> **Status: done, approved 2026-10-10.** Summary: `docs/phases/phase-06-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

Each task is one small change with its tests. The repo is in brackets.

- [x] 1. [teammates] Seed: Rhea Voss as the ninth teammate, Ada's spec-drafting skill, the NooblyJS teams as cost centres
- [x] 2. [teammates] `services` from `register()`: `roster`, `get`, `availability`, `provider`, `runTask` with `scripted`, `billTo` and attribution on the work item and timesheet
- [x] 3. [teammates] Production refuses the direct Anthropic API; task events and audit records to the host
- [x] 4. [nooblyjs-ai-host] `agents.js`, and chat replies as `chat.reply` tasks: availability replies, scripted and real modes, the reply contract, a "refuses" test for each path
- [x] 5. [product] Drafting through `runTask` with its scripted draft; the Phase 5 story still passes
- [x] 6. [nooblyjs-ai-host] Agents from Teammates in the mention list, Teams & roles, Home and For you; NooblyJS still starts with Teammates off
- [x] 7. [nooblyjs-ai-host] Teams bot: activities, the dev key, sessions, card templates, the connector, `POST /api/teams/messages`; the flows pick → join → answer → choose someone else
- [x] 8. [nooblyjs-ai-host] Teams bot rules: `joinedAt`, decisions are links, messages into the item's thread, audit, billing to the session's team; contract tests
- [x] 9. [nooblyjs-ai-host] The simulator: `/dev/teams`, the seeded meeting, the simulator connector over the event stream, the Adaptive Card renderer
- [x] 10. [teammates, core] Team roster on kit components, matching its mockup
- [x] 11. [teammates] The other pages on the frame signature and `ctx.sse`; the bridge, the helper copies and `/api/v1/events` removed
- [x] 12. [nooblyjs-ai-host, teammates] Hosted-app checklist steps 6, 8 and 9; step 12 reworded
- [x] 13. [nooblyjs-ai-host] e2e story for the eight test steps, with axe; one live run with `AI_PROVIDER=anthropic`
- [x] 14. Steering docs here and in the child repos, `.env.example`, and the phase summary
