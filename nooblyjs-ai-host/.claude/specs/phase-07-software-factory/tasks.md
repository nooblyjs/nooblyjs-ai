# Phase 7 — Software Factory integration: tasks

> **Status: done, approved 2026-10-10 (the real-model run to a PR and the decisions in the summary are still open).** Summary: `docs/phases/phase-07-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

Each task is one small change with its tests. The repo is in brackets.

- [x] 1. [factory] The file store behind `openStore()`: daily YAML streams, in-memory projections, keys, transactions, the cross-process lock; `node:sqlite` removed
- [x] 2. [factory] Leases, budgets and history on the store; the whole factory suite green on files
- [x] 3. [factory] Hosted: the scheduler starts and stops with `register()`; unsandboxed only when the host says development
- [x] 4. [factory] `seed()`: the demo repo (a tiny `web-storefront`), `repos.yaml`, and the two scripts for PRD-028's work items
- [x] 5. [workflows, factory] Handoff intake: work items → issues and queued runs, once; unmapped repos wait with a reason
- [x] 6. [product, factory] Quality attributes → gates; what no gate checks goes on the PR
- [x] 7. [factory, nooblyjs-ai-host] Runs, PRs and gate results report to the item: events, `runsForItem`, the item page's runs panel
- [x] 8. [factory, nooblyjs-ai-host] A parked run asks: Developer home "Runs asking you", a line in the item's thread, answering with `draft`
- [x] 9. [factory] Hosted runs never merge; a merging line is refused and audited
- [x] 10. [factory] Line, Runs, Run, Inbox, Campaigns and Metrics on kit components (page head, pills, stat tiles, notices; buttons, tables and cards are still the Factory's own); Metrics' empty state
- [x] 11. [nooblyjs-ai-host, factory] Hosted-app checklist for the Factory
- [x] 12. [nooblyjs-ai-host] e2e story for the five test steps, with axe; one live run with `AI_PROVIDER=anthropic` (ran 2026-10-10: the model's triage found the work item unclear and the run stopped at "Needs information"; see the summary)
- [x] 13. Steering docs here and in the child repos, and the phase summary
