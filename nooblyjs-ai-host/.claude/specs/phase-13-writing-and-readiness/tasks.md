# Phase 13 — Writing to Bitbucket and Jira, and production readiness: tasks

> **Status: built 2026-10-11, waiting for review.** Summary: `docs/phases/phase-13-summary.md`.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

- [x] 1. Remove Targetprocess: steering, Integrations, config, onboarding copy. _R5_
- [x] 2. The write gate: `writer.js` (listed kinds only), `writes.js` (modes, rules, actors, outbox, audit), `DEVTOOLS_WRITES`, the outbox API and Platform · Settings · Integrations (mode per system, rule per kind, the outbox). _R1_
- [x] 3. Jira out: issues from an approved handoff, linked once; a comment when a pull request opens; a transition for a run started and a pull request merged. _R2_
- [x] 4. Jira in: the linked issues read on a schedule into work-item statuses; conflicts; "all work items done" on the item. _R2_
- [x] 5. Bitbucket: push a `factory/…` branch and open or update a pull request with default reviewers through the gate; the Factory's Bitbucket forge (`nooblyjs-ai-factory`), which asks `host.service('devtools')`. _R3_
- [x] 6. Pull requests followed: state, reviewers and build statuses on the item and run; a person's merge moves the item to Ship. _R3_
- [x] 7. Backup and restore of `data/`, nightly, verified. _R4_
- [x] 8. The performance check at 10× the seed volume. _R4_
- [x] 9. The security review and the runbooks. _R4_
- [x] 10. Tests for every refusal, steering, `docs/phases/phase-13-summary.md`, CLAUDE.md. _Working agreement_
