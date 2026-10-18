# Phase 2 — Lifecycle core: tasks

> **Status: done, built 2026-10-09.** Summary: `docs/phases/phase-02-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

- [x] 1. `nooblyjs-ai-workflows`: package, `register()`, stages, working days, repos, rules and readiness config, seed (time-shifted)
- [x] 2. Approvals: decide (quorum, permission, people only, readiness + override), reassign, withdraw; stage moves and history
- [x] 3. Send back, UI handoff (work items as files), merge completes the item, `services` for Product
- [x] 4. Sweep: remind and escalate from the host clock; timer + `clock.moved`
- [x] 5. Views: overview counts, swimlane rows and filters, stage health, where work waits, handoffs this week, approvals queue and detail
- [x] 6. `nooblyjs-ai-workflows` tests (rules, refusals, story) and standalone `server.js`; its steering docs
- [x] 7. Host: `host.clock`, dev clock (API + page), events and audit on the clock
- [x] 8. Host: SSE stream, `features.events`, activity service and API, overview API, Home status card and badge
- [x] 9. Kit: `chips()`, swimlane colours from the mockup
- [x] 10. Home pages: Overview, Lifecycle (+ item page), Approvals, Activity, with live updates
- [x] 11. `nooblyjs-ai-product`: ignore non-spec `approval.decided`, accept lifecycle stage names on `item.sent_back`, accept an ADR approved in Approvals
- [x] 12. Enable `nooblyjs-ai-workflows` in the seed `hosted-apps.yaml`; API tests for the test script; e2e + axe for the four screens
- [x] 13. Steering docs (§2a `host.clock`, §4 data layout, roadmap step 7 and the tracker), the four child repos' contract copies, the phase summary
