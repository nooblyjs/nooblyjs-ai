# Phase 5 — Product Factory: requirements

> **Status: done, approved 2026-10-10.** Summary: `.claude/phases/phase-05-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 5. Goal: PRD-031 goes from signal to **Send to Software
> Factory**, with agents drafting and a person approving each gate.
>
> The Product Factory is the hosted app `nooblyjs-ai-product`, which owns its screens, artefacts and
> drafting agents. **Its detailed spec lives in that repo**
> (`nooblyjs-ai-product/.claude/specs/phase-05-product-factory-engine/`, with its own roadmap of sub-phases
> P0–P7). This file covers what the phase means for the host, `nooblyjs-ai-host`, and how the phase is closed.

## Decisions taken before starting

| Question | Answer |
| --- | --- |
| Diagram-as-code format (`product.md` §12 Q7) | A subset of **Mermaid C4**, kept in `data/product/architecture/<PRD>/diagram.md` (the product repo's D2) `[CONFIRM]` |
| Is the Product Factory's Stage 1–4 numbering what is shown? | Yes: its screens say "Product Factory · Stage 1–4", and Home's Lifecycle uses the seven lifecycle stages (the product repo's D4) `[CONFIRM]` |
| The handoff repo count (`product.md` §11) | The preview counts what the six work items span: **4 repos**, not the mockup's 3 (the product repo's D5) `[CONFIRM]` |
| Where the screens live | In `nooblyjs-ai-product`, as a UI module in the frame, like Teammates (decided 2026-10-09; `structure.md` §2a) |

## Requirements for the host

### R1 — Hosting
1. `nooblyjs-ai-product` SHALL be listed in `hosted-apps.yaml` at `/product`, first on the rail after Home,
   and SHALL pass the hosted-app checklist.
2. Its decisions SHALL go through the lifecycle engine: spec approval (`workflows.decide`), the UI →
   Software Factory handoff (`workflows.handoff`) and send-back (`workflows.sendBack`). The Product
   Factory never approves or moves a stage itself.

### R2 — The item's gate list
1. Once an item's architecture has quality attributes, Home's item page SHALL show them as the item's
   **gates** (`GET /api/v1/home/items/:id/gates`), and SHALL say they are not final while one of its
   architecture decisions is still proposed.

### R3 — The story
1. One browser story SHALL walk the six roadmap steps on a fresh seed, in order, with axe on each
   screen it lands on (`test/e2e/product-factory.story.js`, run by `npm run test:e2e` after the specs).

## Done when
Steps 1–6 of the Phase 5 test script pass, every screen matches its mockup, and `nooblyjs-ai-product`
passes the hosted-app checklist (all steps).
