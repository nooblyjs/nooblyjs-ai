# Phase 26 — Open work in the apps: summary

**Status:** built (2026-10-22), waiting for your review. Spec: `.claude/specs/phase-26-open-work/` (tasks 1–8 done).
Chosen on 2026-10-22 from "Hosted apps: open work": the items that need no outside decision. The work is in
`nooblyjs-ai-infrastructure`, `nooblyjs-ai-teammate` and `nooblyjs-ai-host`.

## What is there

| Area | What |
| --- | --- |
| Ines Tau (I7) | Hired in Teammates' seed (Infrastructure agent, Sonnet, $38/hr, Delivery squad's cost centre), with two new library skills: Infrastructure as code, Cost estimation |
| Drafting a design | `POST /infrastructure/api/v1/designs/:id/drafts` and "Ask Ines for a new draft" on the design page: her teammate task `infrastructure-design` reads Product's `designInputs`; the new version waits for approvals again (the Architect's through an ADR stays), the one it replaces is kept, the lifecycle's approval follows it; `agent.action` and an audit record with the cost. The scripted draft adds new containers, data stores and alarms; a model's draft is used only as a list of resources in the design's shape |
| The offer | `adr.accepted` and `architecture.updated` set "A new draft is suggested: <why>" on the item's designs; a draft clears it; nothing drafts by itself |
| Teammates red-team | Instructions in an outside task or a memory change no setting, approve nothing, reach no other teammate, and can't confirm a cost waiting for the owner (`test/controllers/red-team.test.js`) |
| Teammates docs | `.claude/guides/task-api.openapi.yaml` (OpenAPI 3.1, checked against the routes and the controller's fields by `test/guides/openapi.test.js`), `admin.md`, `writing-skills.md` |
| Live tests | `npm run test:live:product` in NooblyJS (`test/live/product-drafts.live.js`): a spec, architecture, UX and UI draft through a real model; skipped without a key |

## The test script

1. In the real app (`nooblyjs-ai-host/test/infrastructure-drafts.test.js`): Ines is on the roster; Thabo's request
   makes INF-031 v3, drafted by her, waiting for approval, v2 kept; her timesheet has the work; Activity has
   `agent.action` and "drafted by Ines Tau"; Stevie is asked for "INF-031 v3 · Approve & provision Test".
2. Accepting ADR-014 on Home · Approvals: INF-031 says "A new draft is suggested: ADR-014 was accepted…", still v2.
3. A Viewer is refused (real app); an agent and a Viewer are refused, and "isn't hired here" is said
   (`nooblyjs-ai-infrastructure/test/drafts.test.js`).
4. Teammates' red-team cases pass.
5. The OpenAPI file's check passes.
6. `npm run test:live:product` skips its four tests without a key. **Not run with a model**: there is no key here.

## Tests

Infrastructure 57 of 57; Teammates 148 of 148; NooblyJS 434, of which 433 pass after the roster counts were updated
for Ines (two tests); the one failure is `test/kit.test.js`'s nav groups, as before.

## Still open (in "Hosted apps: open work")

Which stages draft automatically (D3, yours); an agent's spec edit from chat (`[CONFIRM]`); CI (GitHub here, the plan
said Bitbucket Pipelines); the Teammates accessibility audit (needs a browser); I2 and I5 (mockups); I3 (`[CONFIRM]`);
I9 (blocked on the cloud).
