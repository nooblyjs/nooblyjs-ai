# Phase 17 — Strategy and the business case: design

> **Status: built 2026-10-21, waiting for review.** Requirements: `requirements.md`. Summary: `.claude/phases/phase-17-summary.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-factory/product/src/services/hierarchy.js` | Portfolio epics, epics and features in `catalogue.yaml` (`epics`, `features`), where each may sit, `placeOf` |
| `…/product/src/services/business-cases.js`, `estimate.js` | Business cases (`business-cases/<owner>.md`): fields, completeness, the agent's draft, the Discover facts; the estimate from similar items |
| `…/product/src/routes/business.js`, `strategy.js`, `board.js` | `/hierarchy`, `/catalogue/epics`, `/catalogue/features`, `/business-cases/:id(/draft)`, `/ideas/:id/accept`; the documents of the new kinds; the board's `epic` and `feature` filters |
| `…/product/src/services/{documents,templates,ideas,views,board,catalogue}.js` | The three new document kinds and their templates; an idea's `feature`; cards with their feature; the catalogue keeps the hierarchy |
| `nooblyjs-ai-host/src/lifecycle/` | The `idea` rule (Discover → Product), the Discover check `business-case-complete`, `acceptIdea` |
| `nooblyjs-ai-host/src/services/metrics/places.js` | Spend by value stream and per item; facts' `spend` carries its item (roll-up version 3) |
| `nooblyjs-ai-host/src/services/platform/budgets.js`, `src/routes/platform.js` | `portfolios` in `budgets.yaml`; `PUT /api/v1/platform/settings/budgets/portfolios/:name` |
| `nooblyjs-ai-infrastructure/src/services/cost.js` | `byItem(month)`, `monthlyFor(itemId)` |
| `nooblyjs-ai-host/src/services/for-you.js`, `work-roles.yaml` | The Business owner |

## The data

```
data/factory/product/catalogue.yaml        epics: [{ id: PEPIC-001 | EPIC-001, kind, name, portfolio, valueStream?, parent? }]
                                           features: [{ id: FEAT-001, name, epic }]
data/factory/product/{portfolio-epics,epics,features}/<id>.md    the documents, from templates/<kind>.md
data/factory/product/business-cases/<IDEA-018|EPIC-001>.md       { valueHypothesis, beneficiaries, measure { what, today, target },
                                           estimate { agentUsd, cloudUsdMonth, peopleDays, basis [{ part, text, from }], like, similar },
                                           horizonMonths, risks, draftedBy, editedBy, version }
data/factory/product/ideas/<id>.md         feature?, status open | accepted | closed
data/platform/budgets.yaml                 portfolios: { Digital: { monthly: 5000 } }
```

## Accepting an idea

The Product section's Accept → `workflows.acceptIdea`: the idea's item is created in Discover when it has none, then
`advance` gives the `idea` approval (`approve`; `needsReadiness`). The Discover readiness asks the Product section's
`readinessFacts(IDEA-…)`, which is the business case's completeness; an item in Discover that is not an idea has no checks.
