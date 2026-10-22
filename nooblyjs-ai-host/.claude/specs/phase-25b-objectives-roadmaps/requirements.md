# Phase 25b — Objectives, roadmaps and capacity: requirements

> **Status: built (2026-10-22), waiting for your review.** Summary: `.claude/phases/phase-25b-summary.md`. Root `roadmap.md` Phase 25b; Phase 25a reviewed 2026-10-22.

> Asked 2026-10-22: "start phase 25b". Answers: "Now is 3 months, Next is the 3 months after that and later is after
> 6 months"; capacity: sample numbers; 25a: reviewed.

Goal: the board and the roadmap say why each item is there (the objective it serves, its RICE score, who asked) and
whether the teams can do what is in Now; a roadmap is something people edit and share, not a typed file.

## Decisions taken before starting

- **Horizons have dates** (your answer, which changes the roadmap's "Next and Later have no dates"): **Now** is today
  to three months from today, **Next** the three months after that, **Later** anything after six months, all on the
  business clock (`host.clock`), so they roll forward. The columns say their dates.
- **Capacity is checked in Now only**, as planned: each NooblyJS team's people-days in Now against the days of its
  items in Now. Next and Later show their days but aren't checked.
- **Team capacity** is `capacityDays` on each NooblyJS team, sample data: Delivery squad 50, Checkout squad 40,
  Platform team 30 (`[PLACEHOLDER]` for the real numbers). An Owner (`set-budgets`) changes it on Teams & roles.
- **An item's team** is its lifecycle item's team. **An item's days** are its business case's people-days estimate
  when it has one, else the days planned for it on the roadmap (the seed's are sample data), else it is "not estimated"
  and the capacity line says how many are.
- **Objectives** are numbered `OBJ-01`. Three sample objectives are seeded (`OBJ-01`–`OBJ-03`), so the test script's
  new objective is `OBJ-04`, not the roadmap's `OBJ-07`. An item serves at most one objective.
- **Key results** read from the monitor (Operations' monitoring adapter, the mock) or are typed in. Reading from
  Metrics waits until Metrics measures named things for other apps `[CONFIRM]` (said on the form).
- **A key result is behind** when an outcome review of an item serving its objective measured it short of its target;
  "met" when it reached the target; otherwise "on the way" or "not measured yet". Scoring stays RICE.
- **roadmap.yaml goes**: on start, its items move onto the specs themselves (`horizon: now`, the stage spans as the
  plan, the sample days), once; the file is then renamed `roadmap.yaml.moved`.
- **Saved views** are shared: a name, a grouping and filters, saved by anyone with `draft`; each has a read-only page
  anyone signed in can be sent.

## R1 — Objectives and key results
- Product · Objectives: each objective with its horizon, strategic themes, key results (measure, start, target, now,
  source, status in words), what serves it, and its progress ("1 of 1 key result behind").
- A person with `draft` creates and edits one, adds key results and links themes, epics, features, ideas and specs.
- Moving an objective between horizons takes `approve` (a Product lead), people only, audited.
- An item in Now serving an objective in Next or Later is pointed out on the objective and the roadmap.
- An outcome review's goals (Operations' `outcome_review.closed`) move the key results with the same measure.

## R2 — Why, on every card
- Board cards for ideas and specs say "RICE 42 · serves OBJ-04 (Now) · 3 colleagues asked"; the order stays RICE.

## R3 — Roadmaps from the items
- Product · Roadmap: Now · Next · Later columns (with their dates) of the specs and ideas placed there, each with its
  objective, team, days, status and release; items not placed yet are listed apart.
- A timeline for Now from each item's planned stage spans and its release (Operations).
- Group by portfolio, theme, objective or team; filter by the same.
- Design's features of an item, with what each depends on, under the item.
- A person with `draft` moves an item between horizons (audited, an event); people only.
- Saved views; a read-only page per view.

## R4 — Capacity in Now
- Per team: "Delivery squad: 64 of 50 days planned in Now", over-planned in words; the roadmap and the team's lane say so.

## R5 — Strategy documents
- Vision, positioning, personas and competitors, each made from its template (Settings), on the Portfolios page.
- The drafting agents read them: `designInputs` carries them; the spec and business-case drafts get them as context.

## R6 — Product reports in Metrics
- Home · Metrics shows, from the Product app: feedback notes by month and by portfolio, planned days by objective and
  by horizon, and each key result's progress.

## Test script (roadmap Phase 25b)

1. Lerato creates OBJ-04 "More same-day orders" in Now, with a key result "Same-day slots still open at 12:00, 18% →
   45%", read from the monitor; PRD-031 serves it.
2. The board orders by RICE as today; PRD-031's card says "serves OBJ-04 (Now) · 3 colleagues asked" (after 25a's
   notes are linked).
3. The roadmap's Now shows PRD-031 with Slots 1.0 (once released) and its features' dependencies (Design's
   FEAT-031-…); Lerato moves PRD-027 to Next; the change is audited; the saved view's page shows it read-only.
4. Capacity: the Delivery squad is over-planned in Now and the roadmap says so; moving PRD-025 to Later clears it.
5. The outcome review of PRD-031 moves the key result to 31.5%; the objective says "1 of 1 key result behind".
6. Metrics shows feedback by portfolio and planned days by objective.

**Done when:** steps 1–6 pass.
