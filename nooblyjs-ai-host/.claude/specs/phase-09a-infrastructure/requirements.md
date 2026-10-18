# Phase 9a — Infrastructure joins NooblyJS: requirements

> **Status: done, signed off 2026-10-10.** Summary: `docs/phases/phase-09a-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

> Source: `.claude/steering/roadmap.md` Phase 9a, asked for by Stevie on 2026-10-10. Goal: NooblyJS **Infrastructure**
> (`nooblyjs-ai-infrastructure`, designs → environments → provisioning runs → drift → cloud cost) is on the NooblyJS rail,
> passes the hosted-app checklist, and works with the rest of NooblyJS: approvals on Home, environments in Platform,
> budgets from Platform, live progress.
> Repos: `nooblyjs-ai-infrastructure` (most of the work), `nooblyjs-ai-host` (hosting, Platform, steering, tests), `nooblyjs-ai-workflows`
> (the infrastructure design approval).
>
> This one spec covers all three repos. Each task in `tasks.md` names its repo. The app's own design is in its
> `.claude/steering/` (product, stack, structure) and its roadmap phases I0–I10. This phase is its **I6 (Join NooblyJS)**
> plus the open items of **I3, I4 and I5** that need no cloud decision.

## Where the phase starts

`nooblyjs-ai-infrastructure` already runs standalone (`npm start`, port 11008) with its own tests (35 of 35):

- `register(app, serverManager, options)` in `index.js`, the API under `/infrastructure/api/v1`, a UI module with
  nine screens (Environments, Design and Designs, Provisioning runs, Environment detail, Testing in environments,
  Blueprints, Cost, Policies), the INF-031 seed story, a **mock provisioner**, drift with Restore and Keep.
- Approve & provision with apply rules by environment kind; the decision is recorded on the design itself.
- Its open items: approvals in `nooblyjs-ai-workflows`; the cloud budget from Platform; a drift sweep on a schedule;
  cancelling a run and destroying an environment; live progress over the host's event stream instead of a
  2-second refresh; a run detail page with its log.

NooblyJS doesn't know it: it isn't a dependency, isn't in `hosted-apps.yaml`, and isn't in the steering docs. Platform ·
Environments shows Platform's own list.

## Decisions taken before starting

Answered by Stevie on 2026-10-10 unless marked (mine).

| Question | Answer |
| --- | --- |
| Scope | **I6 (join NooblyJS) plus the open I3–I5 items that need no cloud decision.** Not I7 (the drafting agent Ines Tau), I8 (previews and tests from the Factory), I9 (a real provisioner, blocked on cloud, region and IaC tool) or I10 (releases) |
| Who owns environments and previews | **Infrastructure.** Platform · Environments lists Infrastructure's environments and links there. Platform keeps Secrets |
| Order | After Phase 9, which is done |
| Phase number (mine) | **9a**, so Phases 10–12 keep their numbers, which the code and docs refer to |
| Mount path, name, rail (mine) | `/infrastructure`, name `infrastructure`, rail label **Infra**, between Factory and Teammates (the mockups). Icon `cube` (Platform already uses `layers`) |
| Where an infrastructure design sits in the lifecycle (mine) | **An artefact on the item with its own approval**, not a new stage. NooblyJS keeps its seven stages. The approval moves no stage `[CONFIRM]` |
| Approvals (mine) | `nooblyjs-ai-workflows` gets an approval type **`infra-design`** (rule: `change-repo-access`, any one person, 1 working day, remind). A design waiting for approval opens one approval per environment kind it asks for (Test, Staging). It shows on Home · Approvals; deciding it there or on the Design screen is the same decision, and either closes the other. Agents are refused, as for every approval |
| Who approves an infrastructure design (mine) | The "platform owner" is **`change-repo-access` (Owner)**, as the app does today `[CONFIRM]` |
| The cloud budget (mine) | A **Cloud (Infrastructure)** budget in Platform · Settings · Budgets (`cloud`, monthly, sample $6,000). Its spend is Infrastructure's cost ledger, not the model-spend ledger. At the budget, with Pause on limit on, **new provisioning** is refused (`budget_reached`); runs already going finish, and nothing running is destroyed (destroying is a person's action) |
| Drift sweep (mine) | Every **6 business hours** on the host's clock, through `serverManager.scheduling()`; a person can still press Check for drift. It only finds and records drift, never repairs it |
| Cancel and destroy (mine) | **Cancel** a queued or running run: `draft` for kinds that apply automatically, the apply rule's permission otherwise. **Destroy** an environment: Preview and Dev with `draft`, Test and Staging with `change-repo-access` and a reason, Production refused (a release). Both audited; agents refused |
| Live progress (mine) | The pages listen to the frame's event stream (`ctx.sse`) for `environment.*`, `drift.*` and `infra_design.*` and redraw; the 2-second polling goes |
| Seed (mine) | NooblyJS's seed writes Infrastructure's INF-031 story on first start through the app's `seed()`, as it does for the Factory. Its numbers stay `[PLACEHOLDER]` cloud and region |

## Requirements

### R1 — Hosted in NooblyJS (I6)
1. `nooblyjs-ai-host` SHALL depend on `nooblyjs-ai-infrastructure` (`file:../nooblyjs-ai-infrastructure`) and list it in
   `hosted-apps.yaml` (seed and the live `data/` copy) after the Factory, enabled.
2. It SHALL appear on the rail as **Infra** with its nav, status card ("1 drift detected", live environments, cloud
   spend) and runs badge, and when switched off it SHALL show as not installed, like the other suite apps.
3. It SHALL pass the **hosted-app checklist** (roadmap): steps 1–12, with step 12 (standalone) already true.
4. Every time a page shows SHALL come from the host's clock (`host.clock`), so `/dev/clock` moves it.
5. NooblyJS's steering (`product.md` §1, §5, §10; `structure.md` §1, §2a; `tech.md` §8; `roadmap.md`) SHALL name it.

### R2 — Approvals through nooblyjs-ai-workflows (I3)
1. `nooblyjs-ai-workflows` SHALL have an `infra-design` approval type and rule, opened by a service call from
   Infrastructure, deciding nothing about stages.
2. When a design version is waiting for approval, Infrastructure SHALL open one `infra-design` approval per kind
   it waits on; Home · Approvals SHALL show it with "Approve & provision <kind>" and a link to the design.
3. Deciding it on Home SHALL approve (or send back) the design in Infrastructure and start the runs, exactly as the
   Design screen does; deciding on the Design screen SHALL close the open approval in `nooblyjs-ai-workflows`.
4. A refusal (agent, missing permission, failing blocking policy) SHALL be the same wherever it is decided.
5. With `nooblyjs-ai-workflows` missing, the decision SHALL be recorded on the design as today.

### R3 — The cloud budget from Platform (I3)
1. Platform SHALL have a `cloud` budget whose spend comes from `host.service('infrastructure').metrics()`.
2. Infrastructure SHALL read the limit through `host.service('platform')` and refuse a new run at the limit
   (with Pause on limit on) with `budget_reached` and Platform's words; Platform emits `budget.reached` once.
3. Standalone, Infrastructure's own `budget.yaml` SHALL apply as today.

### R4 — Runs and drift (I4)
1. A **drift sweep** SHALL run every 6 business hours (host clock) over every live environment, recording drift
   and emitting `drift.detected`; it SHALL never apply anything.
2. A queued or running run SHALL be cancellable (rules above); the environment goes back to its previous state.
3. An environment SHALL be destroyable (rules above): its status becomes Destroyed, `environment.destroyed` is
   emitted, and its cost stops.
4. Pages SHALL update from the host's event stream; no page polls on a timer.

### R5 — Run detail (I5)
1. Each run SHALL have a page `/infrastructure/runs/:id`: environment, design version, plan, who asked and who
   approved, progress, and a log of its steps (from the provisioner and the run's events).

### R6 — Platform shows Infrastructure
1. Platform · Environments SHALL list Infrastructure's environments when it is hosted, with a link to each.
2. The Preview environments pool on Platform · Containers SHALL count Infrastructure's live previews.

### R7 — Quality
1. Every Infrastructure screen SHALL pass axe and work at 375px in NooblyJS's frame (an e2e story).
2. All writes audited; agents refused every approval and every apply that needs one; tests prove each refusal.

## Test script (roadmap Phase 9a)

1. `npm start`. **Infra** is on the rail between Factory and Teammates; its status card says "1 drift detected".
   Open it from the rail: the page doesn't reload, and the chat stays open.
2. Home · Approvals shows **INF-031 · Approve & provision Test**. Priya can't approve it (refused and audited).
   Stevie approves it there: a run for `test-slots` starts, and the Design screen says approved.
3. Watch Provisioning runs: progress moves with no page refresh. Open the run: plan, who approved, and its log.
4. Lower the Cloud budget in Platform · Settings below this month's cloud spend. **New environment** is refused
   with the reason; Activity shows `budget.reached`.
5. Move the dev clock 6 hours. The drift sweep has run (Activity); on `dev-slots` **Restore from design** starts a run.
6. Cancel a queued run; destroy `pr-485`. Both are in the audit log, and `pr-485` is gone from Platform ·
   Environments and from the Preview environments pool.
7. Platform · Environments lists Infrastructure's environments and links to each.

**Done when:** steps 1–7 pass, and Infrastructure passes the hosted-app checklist.

## Out of scope

I7 (Ines Tau drafting), I8 (previews from PRs, test results from runs), I9 (a real provisioner), I10 (releases to
Production with two approvers). The mockups' exports for screens with no design.
