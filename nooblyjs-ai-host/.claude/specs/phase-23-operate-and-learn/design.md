# Phase 23 — Operate and learn (Operations, part 2): design

> **Status: done (built and reviewed 2026-10-21).** Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-operations/src/monitors/` | The monitoring adapter (`OPERATIONS_MONITOR`, only `mock`): `burned(sloId)`, `burn`, `measure(goal)` |
| `…/src/services/slos.js` | SLOs from quality attributes at the first deploy; budgets; alerts to on call |
| `…/src/services/incidents.js` | Declare, notes, resolve (the SRE agent's review), accept (Knowledge), follow-ups; the signal |
| `…/src/services/outcomes.js` | Scheduled at the first deploy; due → the lifecycle's `outcome-review` approval; goals today; closed |
| `…/public/js/pages/` | SLOs, Incidents, an incident, Outcome reviews, an outcome review |
| `nooblyjs-ai-host/src/services/notify.js`, `noobly.js` | `oncall.alert`: the on-call channel in Teams (the simulator's in development) |
| `…/src/lifecycle/services/engine.js` | `outcome-review` may be an app's approval; approved, it completes the item |
| `…/src/services/metrics/` | Facts `deploy`, `fail`, `restore`, `outcome`; `production` in the computed metrics; the Metrics page |
| `…/src/services/for-you.js`, `work-roles.yaml` | The SRE |
| `nooblyjs-ai-factory/product/index.js` | `raiseSignal`, `createIdea`; signals show their release |
| `nooblyjs-ai-knowledge` | `writePage` |

## The data

```
data/operations/slos/SLO-031-2.md          kind, target, objective, budgetMinutes, itemId, releaseId, alerts [{ level, teams }]
data/operations/incidents/INC-001.md       severity, status, itemId, releaseId, sloId, signalId, timeline, review { text, status, page }, followUps
data/operations/outcome-reviews/OR-031.md  itemId, releaseId, dueAt, status, approvalId, goals
data/operations/monitor.yaml               the mock's burned minutes and measures
```

## Events

`slo.created`, `slo.alert`, `oncall.alerted`, `incident.declared`, `incident.resolved`, `incident.review_drafted`,
`incident.review_accepted`, `signal.raised`, `knowledge.page_written`, `outcome_review.scheduled`, `outcome_review.due`,
`outcome_review.closed`, `outcome_review.idea_opened`.
