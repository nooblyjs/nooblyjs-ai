# Phase 11 — Development tools: tasks

> **Status: done, signed off 2026-10-10.** Summary: `docs/phases/phase-11-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

- [x] 1. The read-only transport and the Jira and Bitbucket connectors (`src/services/devtools/`), with offline tests and the test that it cannot write. `npm run test:live:devtools`. _R1_
- [x] 2. `host.service('devtools')`, `data/config/devtools.yaml`, `/api/v1/devtools/…`, and Platform · Settings · Integrations showing both tools and what the token can read. _R1, R2_
- [x] 3. Platform · Repositories from Bitbucket, starting with `nooblyjs-ai-harness`; "GitHub" leaves the screen. _R3_
- [x] 4. A product's default repositories and Jira project; opportunities and specs start with them (`nooblyjs-ai-product`). _R4_
- [x] 5. Architecture's Repositories card; the handoff and the Software Factory use the item's list (`nooblyjs-ai-product`, `nooblyjs-ai-factory`). _R4_
- [x] 6. Jira: search and link issues, linked issues on the item and next to a run. _R5_
- [x] 7. The reads as agent tools, checked by Platform and audited. _R6_
- [x] 8. Dogfood: the product entry "Slash-command autocomplete in the harness" (linked to its DTE issue), and the Software Factory working on a local clone of `nooblyjs-ai-harness`, on a branch that is never pushed. _R7_
- [x] 9. `test/devtools.test.js` (steps 1, 2 and 7 are in; the rest) and `test/e2e/devtools.spec.js`. _Test script_
- [x] 10. Steering, the child repos' steering, `docs/phases/phase-11-summary.md`, CLAUDE.md. _Working agreement_
