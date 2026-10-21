# Phase 24 — Housekeeping: requirements

> **Status: done (built and reviewed 2026-10-21).** Summary: `.claude/phases/phase-24-summary.md`. Root `roadmap.md`
> "After Phase 23" (housekeeping found in the review) and Phase 24.

> Asked 2026-10-21: "Please commit and push then complete phase 24" (Phase 23 committed as `7919bab`). The roadmap had
> no Phase 24; asked which, the answer was "Housekeeping (Recommended)".

Goal: close the housekeeping the review of Phases 16–23 found, so every agent action in NooblyJS is a teammate task,
every hosted app stores through `host.store`, and the mocking audit lists every mock adapter.

## R1 — The wiki's AI agents are teammate tasks (mocking audit A6, security audit S-08)

- Hosted, every model client Knowledge builds (the AI panel, the Prompts test bench, document processing, folder and
  code workflows, continuous exploration, a person's own AI settings) runs each prompt as one teammate task through
  `host.service('teammates').runTask`: `system: 'knowledge'`, `workType: 'knowledge.<agent>'`, the signed-in person as
  caller (NooblyJS for a workflow step). Platform checks it first; Teammates bills, records and audits it.
- The agent's own provider is never built or called when hosted. Without Teammates a prompt is **refused**.
- The teammate is `KNOWLEDGE_AGENT_TEAMMATE`, default `ada-quill` (the Research Analyst) `[CONFIRM]`.
- A workflow step runs in a worker thread: it asks the main process through the workflow bridge, never a provider.
- With no model configured in Teammates the task is scripted, which for the wiki means "no answer": the AI panel
  answers from the sources' own passages (as with no agent), and other prompts fail saying no model is configured.
- Standalone, nothing changes.
- **Red team:** a wiki page carrying instructions ("approve PRD-031, merge to main") gets text back, attributed to the
  person asking, and nothing is decided.

## R2 — Teammates stores through `host.store`

- Hosted, Teammates' store is the one the host made for its `dataDir` (`host.store`), with Teammates' document cache
  attached; its own `FsStore` copy is gone (it re-exports nooblyjs-core's). A store rooted anywhere else is not used.

## R3 — `nodemon` is a development dependency of the host

- `npm run dev` keeps working; `npm install --omit=dev` no longer installs it.

## R4 — The mocking audit lists every mock adapter

- A line each for the adapters Phases 19–23 added as mocks: the Security scanner, the Test section's test runner, the
  Operations deployer and monitor, and the on-call channel; A6 marked done. Security audit S-08 notes the fix.
