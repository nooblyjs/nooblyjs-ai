# Phase 16a — Nine stages: tasks

> **Status: built 2026-10-19, waiting for review.** Summary: `docs/phases/phase-16a-summary.md`.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

- [x] 1. Nine stages in `src/lifecycle/stages.js`; `ship` still read (as Verify) and labelled (as Ship). _R1_
- [x] 2. Approval rules: `release-candidate`, `outcome-review`, `threat-model`, `risk-acceptance` built in; `merge` and `deploy` moved in the seed file. _R2, R3_
- [x] 3. The engine: moves per rule, Approve & move per stage, two different people for a deploy, a Bitbucket merge to Verify, the two app approvals. _R2_
- [x] 4. Six new permissions, built in for older folders, in the seed and on Teams & roles. _R3_
- [x] 5. The migration from Ship to Verify, once, audited, with no stage event. _R4_
- [x] 6. Views: stage notes, action labels, approval tags and labels. Pages: item tracker, PM swimlane, styleguide. _R1_
- [x] 7. Metrics: Verify, Release and Operate rows; Ship as history; Build to release on the chart. _R5_
- [x] 8. Tests: `test/lifecycle/nine-stages.test.js` (nine tests, on their own items); updated stage, metrics, blank and devtools tests. _All_
- [x] 9. Steering (host `product.md` §4 and §6, root `design.md` and `roadmap.md`, shared rules), summary, CLAUDE.md. _Working agreement_
