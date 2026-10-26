# Phase 27 — The process as configuration: tasks

> **Status: built (2026-10-26), waiting for your review.** Summary: `.claude/phases/phase-27-summary.md`.

27a
- [x] 1. `src/lifecycle/workflow.js`: the built-in definition, `lifecycle.yaml` read, validated, last good kept, the
      applied copy, `workflow.changed`. `stages.js` reads the definition. _R1, R3_
- [x] 2. `approval-rules.yaml` and `readiness.yaml` through the same validation; `enabled: false`. _R3, R4_
- [x] 3. `src/lifecycle/evaluators.js`: the evaluators by name, the `when` checks and their facts; the engine's
      readiness by evaluator, not by stage name; Product's `specSections`. _R2_
- [x] 4. The engine's moves and exits, and pull requests' "passed Test", from the definition. _R1_
- [x] 5. Views, Metrics and the item page's tracker from the definition. _R1_
- [x] 6. `access/roles.yaml` validated, last good kept. _R3_
- [x] 7. Platform · Settings · Workflow. _R5_
- [x] 8. The seed: `lifecycle.yaml`; a data folder from before gets one. _R1_

27b
- [x] 9. Actions: `host.requireAction` / `host.canDo`, `actions:` in `roles.yaml`, every check in the host and the apps
      names its action; Platform · Settings · Workflow lists them. _R6_
- [x] 10. The Factory's lines from `data/factory/lines/`, chosen by repository and item type. _R7_
- [x] 11. Stage kinds in the lifecycle's services and the apps; the stage-key test; For you by `stages`. _R8_

- [x] 12. The test script; each app's own tests. _All_
- [x] 13. Steering, the summary, CLAUDE.md, the tracker. _Working agreement_
