# Phase 9a — Infrastructure joins NooblyJS: summary

**Status:** done. Built 2026-10-10 and signed off the same day. Spec: `.claude/specs/phase-09a-infrastructure/` (requirements,
design, tasks: all 9 done). Work is in four repos: `nooblyjs-ai-infrastructure` (most of it), `nooblyjs-ai-host`,
`nooblyjs-ai-workflows`, and one line in `nooblyjs-core` (the frame tells a page whether an event stream exists).

To see it: `npm start` in `nooblyjs-ai-host`. Your existing `data/` gets Infrastructure's seed story (INF-031) on the first start,
because `data/infrastructure/` is empty; **Infra** is on the rail between Factory and Teammates.

## Before you started (your answers)

- Scope: Infrastructure's roadmap **I6 (join NooblyJS)** plus the open **I3–I5** items that need no cloud decision.
- **Infrastructure owns environments and previews**; Platform lists them and keeps Secrets.
- Order: after Phase 9. I numbered it **9a** so Phases 10–12 keep their numbers.

## What is there

| Area | What |
| --- | --- |
| Hosted | `/infrastructure`, rail label **Infra** (icon `cube`), its nine screens plus a new run page, its status card ("1 drift detected", live environments, cloud spend) and runs badge. Switched off, it shows as not installed |
| Approvals on Home | A new approval type in `nooblyjs-ai-workflows`, `infra-design`. A design version waiting for Test or Staging has one open approval per kind on **Home · Approvals** ("INF-031 v2 · Approve & provision Test", with a link to the design). Deciding it on Home asks Infrastructure to carry the decision out first, so its refusals (not the platform owner, a failing policy, a paused budget) read the same there as on the Design screen. Deciding on the Design screen closes the approval on Home. Asking for changes withdraws what is left. No lifecycle stage moves |
| Cloud budget | **Cloud (Infrastructure)** in Platform · Settings · Budgets (sample $6,000). Its spend is Infrastructure's cost ledger, and it is kept out of the agents' month total. At the budget, new provisioning (a new environment, an approval's runs, a drift restore) is refused before anything is recorded, in Platform's words, and Activity shows `budget.reached`. Infrastructure's own card shows Platform's limit |
| Drift sweep | Every 6 business hours on NooblyJS's clock, each live environment is compared with its design; new drift is recorded and shown, never repaired |
| Cancel and destroy | **Cancel run** (a queued run ends at once, a running one at its next step) and **Destroy** an environment (Preview and Dev with `draft`; Test and Staging need the platform owner and a reason; Production is refused). Both audited; an agent is refused |
| Live progress | Infrastructure's pages follow NooblyJS's event stream: a run's progress moves with no refresh and no polling. Standalone (no stream) they still refresh on a timer |
| Run page | `/infrastructure/runs/<id>`: what it applies where, the plan, who asked and who approved, and a log of each step |
| Platform | **Platform · Environments** is Infrastructure's list, each linking to it. The Preview environments pool on Containers counts Infrastructure's previews |
| Activity | Infrastructure's events have their own system name and a sentence each ("provisioned test-slots from INF-031 v2"). Progress ticks are left out |

## Test script result (roadmap Phase 9a)

Run 2026-10-10 through the real apps (`test/infrastructure.test.js`) and in a browser
(`test/e2e/infrastructure.story.js`, with axe and a 375px check on every Infrastructure screen). The provisioner is the mock.

| Step | Result |
| --- | --- |
| 1. Infra on the rail between Factory and Teammates, "1 drift detected"; opening it doesn't reload the page | PASS |
| 2. Home · Approvals shows INF-031 for Test; Priya is refused; Stevie approves there and `test-slots` gets a run | PASS. It also brings the Preview `pr-485` up to v2, because Previews apply automatically |
| 3. Provisioning runs move with no refresh; the run's page shows plan, approver and log | PASS |
| 4. Cloud budget below this month's cloud spend: New environment refused with the reason; `budget.reached` in Activity | PASS |
| 5. Dev clock +6 hours: the drift sweep ran; Restore `dev-slots` from its design | PASS |
| 6. Cancel a queued run and destroy `pr-485`: audited, and gone from Platform · Environments and the pool | PASS |
| 7. Platform · Environments lists Infrastructure's environments, each linking to it | PASS |

**Hosted-app checklist** for `nooblyjs-ai-infrastructure`: steps 1, 2, 4, 5, 7 and 8 in `test/infrastructure.test.js` and
`test/agents.test.js`; 3 and 4 again in the browser story; 6, 9, 10 and 11 by its own `register.test.js` and
`module.test.js` and NooblyJS's loader tests, as for the other apps; 12 (standalone) was already true.

Tests on the last run: `nooblyjs-ai-host` 184 of 184, `nooblyjs-ai-infrastructure` 46 of 46, `nooblyjs-ai-workflows` 28 of 28, the
Infrastructure browser story 8 of 8. **Not rerun since Infrastructure joined:** the full browser suite. It was
stopped part-way (15 specs passed; one stale count in the Home spec was then fixed, unverified), and the Product,
Software Factory, Knowledge and Platform stories did not run.

## Decisions that need your confirmation

1. **An infrastructure design is an artefact with its own approval, not a lifecycle stage.** NooblyJS keeps seven
   stages. (Infrastructure's product.md asked this.)
2. **The "platform owner" who approves a design is `change-repo-access`, so an Owner.** Lerato (Approver) and
   Thabo (Architect) cannot.
3. **Stevie now has six approvals waiting, not four**, when Infrastructure is hosted: the two new ones are INF-031
   for Test and for Staging. The Phase 2 test script and the mockup say four. The Phase 2 browser specs still
   count four because, like the Factory and the wiki, Infrastructure is only hosted in its own story's run.
4. **The cloud budget is separate from the agents' month total**, and pauses new provisioning only. Nothing running
   is stopped or destroyed by a budget.
5. **Preview and Dev runs also wait at the cloud budget** (they cost money too).
6. **The sweep is every 6 business hours.** A minute timer checks whether it is due (not `serverManager.scheduling()`,
   which the spec named: a timer on the host clock was simpler and is what the lifecycle engine does).
7. **Destroy has no provisioning run** of its own: the mock has nothing to remove, so the environment is marked
   destroyed at once and kept on disk for its history. A real provisioner (I9) will need a destroy run.
8. **Who may cancel or destroy:** as in the table above.

## Not built, or left for later

- **A real provisioner** (Infrastructure I9): still the mock. Cloud, region and the IaC tool are undecided.
- **The drafting agent, Ines Tau** (I7), and **previews from pull requests, test results from Factory runs** (I8).
- **Releases to Production** with two approvers (I10).
- The side-by-side check of the two mocked screens at 1440px, and designs for the screens with no mockup.
- Home's "For you" pages and Lifecycle do not show infrastructure designs on an item yet (only Approvals does).

## Things to know

- The first status request after a start opens the approvals on Home (the lifecycle engine mounts after
  Infrastructure), so they appear as soon as anyone loads a page.
- A seeded run on `pr-486` sits at 70% until the next start, then finishes, as its own roadmap says.
- I found and fixed a loop while building: Platform asked Infrastructure for its spend, and Infrastructure asked
  Platform for its budget, each calling the other. Platform now asks for the spend alone (`cloudSpend()`).

## Guide points for your review

- Is an infrastructure design an artefact with its own approval, or should it be a lifecycle stage?
- Who is the "platform owner" who approves designs?
