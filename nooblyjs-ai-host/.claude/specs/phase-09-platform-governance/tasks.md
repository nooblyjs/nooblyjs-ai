# Phase 9 — Platform and governance: tasks

> **Status: done, signed off 2026-10-10.** Summary: `.claude/phases/phase-09-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

- [x] 1. **nooblyjs-ai-host** — Platform service skeleton: files, mtime cache, defaults, `host.service('platform')`, seed (repositories, routes, budgets, guardrails, pools, images, environments, secrets, October ledger). New permissions `read-audit`, `manage-members` in `roles.yaml` and `product.md` §6. _R1, R2.1, R2.6_
- [x] 2. **nooblyjs-ai-host** — `checkAgentWork()`, the spend ledger (events → `spend/YYYY-MM.yaml`, `budget.reached` once per period, rebuild from events), guardrails with reason, lock and history. Unit tests. _R1.1, R1.3, R2.4, R4, R5_
- [x] 3. **nooblyjs-ai-host** — `/api/v1/platform/…` routes with permissions, agent refusal, validation and audit; members and audit-log queries. API tests. _R1.2, R7_
- [x] 4. **nooblyjs-core** — Bedrock (SigV4, event-stream), Vertex (JWT token, streamRawPredict), Azure adapters; catalogue ids per provider; production refusal of direct APIs. Offline tests and `test:live` cases. _R3.4–R3.6_
- [x] 5. **nooblyjs-ai-teammate** — `runTask` asks Platform first, uses the route (model, fallback, provider), reports `modelRoute`, takes `repo`, registers a workload stoppable by abort. _R2.4, R3.2, R4.3, R6.2_
- [x] 6. **nooblyjs-ai-factory** — intake checks repository access and budget; runs register as workloads; `cancel(runId)` and `stopAll()` on the service; daily cap from Platform. _R2.5, R4.3, R6.3_
- [x] 7. **nooblyjs-ai-host** — simulated `ContainerRuntime`: pools, sample workloads, real workloads, logs, stop, stop all. _R6_
- [x] 8. **nooblyjs-ai-product** + **nooblyjs-ai-knowledge** — paused drafts say why; import honours the redaction guardrail. _R4.6, R5.4_
- [x] 9. **nooblyjs-ai-host** — screens: Repositories (+ detail, repository-scoped chat), Containers, Settings (five tabs, Save changes, reason dialog, policy history), Environments, Secrets, Members, Audit log; status card. _R2.2, R6.4, R7, R8.2_
- [x] 10. **nooblyjs-ai-host** — `test/platform.test.js` (the six steps through the real apps) and `test/e2e/platform.story.js` (browser, axe, phone width). _Test script_
- [x] 11. Steering (`tech.md`, `structure.md`, `product.md`, children's `tech.md`), roadmap note, `.claude/phases/phase-09-summary.md`, CLAUDE.md. _Working agreement_
