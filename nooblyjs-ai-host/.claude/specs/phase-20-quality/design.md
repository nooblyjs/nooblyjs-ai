# Phase 20 — Quality (the Factory's Test section): design

> **Status: built 2026-10-21, waiting for review.** Summary: `.claude/phases/phase-20-summary.md`. Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-factory/quality/src/services/runs.js` | Test runs: recorded from the line (`recordGates`, `recordRequired`), listed, one by id; marks a story's defects fixed on its next passing run |
| `…/quality/src/services/coverage.js` | Coverage of an item, its features and stories, in words |
| `…/quality/src/services/defects.js` | Raising a defect from a test run (or a story), and its decisions, over the lifecycle's defect items |
| `…/quality/src/services/analysis.js` | Each case remembers its criterion's words (`criterionText`); "criterion changed" when they differ |
| `…/quality/src/routes.js`, `index.js` | The new routes and services |
| `nooblyjs-ai-factory/src/services/hosted.js` | The log → the Test section: a verify step is a test run, a deliver step adds the required tests |
| `nooblyjs-ai-factory/src/services/engineering/views.js` | `/api/test/runs`, `/coverage`, `/defects`: the recorded ones, then the sample |
| `nooblyjs-ai-factory/public/js/pages/testing.js`, `public/quality/js/pages/analysis.js` | The pages |
| `nooblyjs-ai-factory/design/src/services/design.js`, `routes.js` | Changing one criterion of a story, also after its handoff |
| `nooblyjs-ai-factory/examples/noobly/hold-a-slot-for-15-minutes-whi.json` | STORY-031-2's scripted agent (its test fails) |
| `nooblyjs-ai-host/src/lifecycle/services/defects.js` | Defect items: record, decide, list; the item view's `defect` and a story's `defects` |
| `nooblyjs-ai-host/src/lifecycle/services/checks.js` | Defects in an item's family and its trace (`breaks`) |
| `nooblyjs-ai-host/src/services/for-you.js` | The Test analyst's coverage gaps and defects |
| `nooblyjs-ai-host/src/services/trace.js` | `defect` nodes and the `breaks` relation |

## The data

```
data/factory/quality/test-runs/TRN-031-2-1.md
  id, storyId, itemId, runId, repo, sha, at, level: build, environment: Pull request branch
  status: passed | failed | error, gates: [{ name, status, excerpt }], failures: [line]
  cases: [{ id, title, level, criterion (index), criterionRef (AC-031-2-1), status: passing | failing | unproven | missing | manual }]
  requirements: [BR-031-05], defects: [DEF-031-1]
data/factory/quality/test-analysis/STORY-031-2.md     each case gains criterionText (the words it was written for)
data/workflows/items/DEF-031-1.md                     type: defect, parentId: STORY-031-2, stage: build
  defect: { severity: S1–S4, state: open | fixed | closed | rejected, breaks: { requirements, story, criterion },
            foundIn: { testRunId, runId, stage }, raisedBy, history: [{ at, by, what }], fixedBy?: { testRunId } }
```

## The API

| Route | Permission | What |
| --- | --- | --- |
| `GET /factory/quality/api/v1/test-runs?storyId&itemId` | `read` | Test runs, newest first |
| `GET /factory/quality/api/v1/test-runs/:id` | `read` | One |
| `POST /factory/quality/api/v1/test-runs/:id/defects` | `draft` | Raise a defect from it: `{ title, severity, caseId?, requirementId? }` |
| `POST /factory/quality/api/v1/stories/:id/defects` | `draft` | Raise one on a story by hand |
| `GET /factory/quality/api/v1/defects?itemId&state` | `read` | Defects |
| `POST /factory/quality/api/v1/defects/:id/decision` | `draft` | `{ decision: fixed | close | reject | reopen, reason }` (people only, except a run's proof) |
| `GET /factory/quality/api/v1/coverage/:itemId` | `read` | Coverage of an item (or a story) |
| `PATCH /factory/design/api/v1/items/:id/stories/:storyId/criteria/:n` | `draft` | Change one criterion, with a reason |

## Services and events

- `host.service('quality')` gains `recordGates`, `recordRequired`, `testRuns`, `coverageOf`, `defects`, `gapsFor`.
- `host.service('workflows')` gains `recordDefect`, `decideDefect`, `defects`.
- Events: `test_run.recorded`, `defect.raised`, `defect.fixed`, `defect.closed`, `defect.rejected`, `defect.reopened`,
  `design.criterion_changed`, `quality.cases_flagged` (each with the sentence Activity shows).
