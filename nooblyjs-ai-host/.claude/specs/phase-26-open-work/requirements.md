# Phase 26 — Open work in the apps: requirements

> **Status: in progress (started 2026-10-22).** Root `roadmap.md` Phase 26 ("Hosted apps: open work").

> Asked 2026-10-22: "Yes please push and start the next phase"; chosen: "26: Open work in the apps"; 25b reviewed.

Goal: close the hosted apps' open work that needs no outside decision.

## Decisions taken before starting (the defaults)

- **Ines Tau** is hired in Digital Teammates as sample data (Infrastructure agent, Sonnet, Delivery squad's cost
  centre), next to Rhea Voss, so the Infrastructure app's `agent.yaml` stand-in is no longer needed when Teammates runs.
- **A new design version** replaces whatever version is current: the current one is kept (`designs/<id>/versions/`)
  and the new one waits for its approvals again (the Architect's through an accepted ADR stays; the platform owner's
  waits). Nothing drafts by itself: an accepted ADR or a changed architecture only offers a new draft.
- **The scripted draft** (no model) keeps the design's resources and adds what the architecture has that the design
  lacks: a compute resource per new container, a data resource per new database or cache, alarms for latency and
  availability quality attributes. A model's draft is used only when it is a list of resources in the design's shape.
- **Live tests** are opt-in: `npm run test:live` in Product, skipped without a configured model.

## R1 — Infrastructure's drafting agent (I7)
- `POST /designs/:id/drafts` (draft, people only): Ines Tau's teammate task `infrastructure-design`, reading
  `host.service('product').designInputs(itemId)`. A new version, drafted by her, waiting for approval; `agent.action`
  with cost; the lifecycle's `infra-design` approval follows the new version.
- Refused when Ines isn't hired (409, says so), when Teammates isn't running in production (503), and for agents (403).
- `adr.accepted` and `architecture.updated` for a design's item set "A new draft is suggested: <why>" on it; a draft
  clears it.

## R2 — Teammates: red-team cases and docs
- Prompt-injection cases: instructions inside an outside task's input, and inside a memory, never change the
  teammate's permissions, budget, tools or what it may decide.
- `.claude/guides/teammates-task-api.openapi.yaml` (OpenAPI 3.1) for the outside task endpoint, checked against the
  routes by a test; `.claude/guides/teammates-admin.md`; `.claude/guides/writing-skills.md`.

## R3 — Product: opt-in live tests
- `test/drafts.live.test.js`: one draft per stage (a spec section, the container view, a journey, a screen) through a
  real model, skipped unless one is configured.

## Test script (roadmap Phase 26)

1. Thabo asks Ines Tau for a new draft of INF-031: version 3 is saved, drafted by Ines from the architecture, waiting
   for its approvals; version 2 is kept; Ines's task and its cost are on her timesheet and in Activity.
2. Thabo accepts ADR-014 for PRD-031: INF-031 says a new draft is suggested, and why; nothing drafted by itself.
3. An agent asking for a draft is refused (403).
4. Teammates' red-team cases pass.
5. The OpenAPI file validates and matches the endpoint's routes.
6. `npm run test:live` in Product, with a model configured, drafts one artefact per stage; without one it skips.

**Done when:** steps 1–6 pass.
