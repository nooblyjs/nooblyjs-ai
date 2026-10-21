# Phase 9a — Infrastructure joins NooblyJS: tasks

> **Status: done, signed off 2026-10-10.** Summary: `.claude/phases/phase-09a-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

- [x] 1. **nooblyjs-ai-host** — Host it: dependency, `hosted-apps.yaml` (seed, `data/`, e2e), `SUITE_APPS`, icon, seed through the app's `seed()`; it starts in NooblyJS and is on the rail. **nooblyjs-ai-infrastructure** — icon `cube`, host-clock times verified. _R1.1–R1.4_
- [x] 2. **nooblyjs-ai-workflows** — the `infra-design` approval type and rule (seed and existing data), request, decide, close, `canDecide` hook, the Approvals label; tests. _R2.1, R2.4_
- [x] 3. **nooblyjs-ai-infrastructure** — approvals through workflows both ways (open per kind, decide from Home, close from the Design screen); fallback when workflows is missing; tests. _R2.2–R2.5_
- [x] 4. **nooblyjs-ai-host** + **nooblyjs-ai-infrastructure** — the `cloud` budget in Platform with Infrastructure's spend; runs refused at the limit; tests. _R3_
- [x] 5. **nooblyjs-ai-infrastructure** — drift sweep on the host clock; cancel a run; destroy an environment; tests. _R4.1–R4.3_
- [x] 6. **nooblyjs-ai-infrastructure** — live progress from `ctx.sse` (no polling); the run detail page and API; tests. _R4.4, R5_
- [x] 7. **nooblyjs-ai-host** — Platform · Environments from Infrastructure; the preview pool counts its previews. _R6_
- [x] 8. **nooblyjs-ai-host** — `test/infrastructure.test.js` (checklist, steps 2–7) and `test/e2e/infrastructure.story.js` (steps 1–7, axe, 375px). _Test script, R7_
- [x] 9. Steering in `nooblyjs-ai-host` (`product.md`, `structure.md`, `tech.md`, `roadmap.md`), Infrastructure's roadmap (I3–I6), `nooblyjs-ai-workflows`' steering, `.claude/phases/phase-09a-summary.md`, CLAUDE.md. _R1.5_
