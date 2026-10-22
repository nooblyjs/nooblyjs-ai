# Phase 25b — Objectives, roadmaps and capacity: summary

**Status:** done (built and reviewed 2026-10-22). Spec: `.claude/specs/phase-25b-objectives-roadmaps/` (tasks
1–10 done). Your answers on 2026-10-22: Now is the next three months, Next the three after, Later beyond six; sample
team capacity. The work is in `nooblyjs-ai-product`, `nooblyjs-ai-host` and `nooblyjs-ai-operations`.

## What is there

| Area | What |
| --- | --- |
| Horizons | Now · Next · Later with their dates from the business clock (`horizons.js`), rolling forward |
| Product · Objectives | `OBJ-04`: horizon, themes, key results (monitor or typed; met, on the way, behind, not measured), what serves it (one objective per item), items placed earlier than their objective pointed out. `draft` sets them up; `approve` moves one between horizons; people only |
| Outcome reviews | Operations' `outcome_review.closed` now carries each goal measured; the key results with the same measure move; a short one is "behind" |
| Why on every card | "RICE 42 · serves OBJ-04 (Now) · 3 colleagues asked"; still ordered by RICE |
| Product · Roadmap | From the items (roadmap.yaml moved onto the specs once, renamed `roadmap.yaml.moved`): columns with dates and days; objective, team, days, status, release, Design's features with dependencies; grouped by portfolio, theme, objective or team; the Now timeline; items not placed; moves (audited); saved views with a read-only page |
| Capacity | `capacityDays` per NooblyJS team (sample: Delivery 50, Checkout 40, Platform 30), set by an Owner on Teams & roles; "Delivery squad: 64 of 50 days planned in Now, 14 over" |
| Strategy documents | Vision, positioning, persona, competitor from templates (Settings), on the Portfolios page; spec drafts, business-case drafts and `designInputs` read them |
| Metrics | A Product card: feedback by portfolio and month, planned days by objective and horizon, key results |

## The test script

In the real app (`nooblyjs-ai-host/test/objectives-roadmap.test.js`, 6 tests) and Product's own
(`nooblyjs-ai-product/test/routes/planning.test.js`, 7 tests, which also prove the agent and Viewer refusals).

1. Lerato sets **OBJ-04** (not OBJ-07: three sample objectives are seeded) "More same-day orders" in Now; the key
   result "Same-day slots still open at 12:00, 18% → 45%" reads 31.5% from the mock monitor, "On the way"; PRD-031 serves it.
2. PRD-031's card: "serves OBJ-04 (Now) · 3 colleagues asked"; ideas still by RICE.
3. Now has PRD-031 (Delivery squad, OBJ-04); after Slots 1.0 it shows the release (in production) and Design's
   FEAT-031-… with what each depends on. PRD-027 to Next is audited; the saved view's page is read-only.
4. Delivery squad: 64 of 50 → 54 of 50 (PRD-027 to Next) → 30 of 50 (PRD-025 to Later): over-planned, then not.
5. The outcome review 31 days on: the key result is 31.5%, "Behind"; OBJ-04 says "1 of 1 key result behind".
6. Metrics' Product card: feedback 3 notes in Digital; OBJ-04 30 planned days; KR-04-1 behind.

## Tests

Product 179 of 179; Operations 20 of 20; Design 19 of 19; NooblyJS 430, of which 429 pass after the nav test was
updated. The one failure is `test/kit.test.js`'s nav groups, the same before this phase.

## Not done or open

- Key results can't read from Metrics yet: Metrics doesn't measure named things for other apps `[CONFIRM]` (the form
  says so).
- Not checked in a browser (no Chromium libraries in this codespace); `npm run test:e2e` not run.
- Team capacity numbers are sample data `[PLACEHOLDER]`.
