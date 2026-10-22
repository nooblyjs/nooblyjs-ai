# Phase 25b — Objectives, roadmaps and capacity: design

> **Status: done (built and reviewed 2026-10-22).** Summary: `.claude/phases/phase-25b-summary.md`. Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-product/src/services/horizons.js` | Now · Next · Later and their dates from the business clock |
| `…/src/services/objectives.js` | Objectives, key results (monitor or typed), links, horizons, progress; outcome reviews move them |
| `…/src/services/planning.js` | The roadmap from the items: horizons, plans, days, teams, capacity, groupings, saved views; the migration from `roadmap.yaml` |
| `…/src/services/templates.js`, `documents.js` | Strategy documents: vision, positioning, persona, competitor |
| `…/src/routes/planning.js` | `/objectives…`, `/roadmap…` (replaces `GET /roadmap`), `/roadmap/views…`, `/strategy-docs…`, `/reports` |
| `…/public/js/pages/objectives.js`, `roadmap.js` | Product · Objectives, Product · Roadmap (and a saved view, read-only) |
| `nooblyjs-ai-operations` | `measure({ measure, today, target })` (the monitor); `outcome_review.closed` carries its goals |
| `nooblyjs-ai-host/src/services/teams.js`, seed teams | `capacityDays` per team; `PATCH /api/v1/home/teams/:id` (`set-budgets`) |
| `…/src/services/metrics/`, `public/js/pages/home/metrics.js` | The Product reports card, from `host.service('product').reports()` |

## The data (under `data/product/`)

```
objectives/OBJ-04.md     title, horizon, themes, links [ids], keyResults [{ id, measure, start, target, now, source,
                         readings [{ value, at, from }] }], owner, createdAt; body = what it means
specs/PRD-0NN.md         + horizon, plan { spans [{ stage, from, to }], days }, horizonChangedAt/By
ideas/IDEA-0NN.md        + horizon, plan { days }
roadmap-views.yaml       views [{ id, name, groupBy, filter { portfolio, theme, objective, team }, createdBy }]
strategy/<id>.md         a strategy document: type (vision | positioning | persona | competitor), title, sections
```

## Events

`objective.created`, `objective.updated`, `objective.moved`, `objective.key_result_measured`, `roadmap.moved`,
`roadmap.view_saved`, `strategy.document_created`, `strategy.document_updated`.
