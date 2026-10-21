# Phase 21 — Testing in environments: design

> **Status: done (built and reviewed 2026-10-21).** Summary: `.claude/phases/phase-21-summary.md`. Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-factory/quality/src/runners/` | The test runner adapter: `index.js` (by `TEST_RUNNER`), `mock.js` (`run(suite, input)`) |
| `…/quality/src/services/env-runs.js` | Runs an environment's suites (the policy's for its kind), records the environment test run, tells Infrastructure and Security |
| `…/quality/src/seed/data/test-policy.yaml` | `environments:` the suites per kind |
| `nooblyjs-ai-infrastructure/src/services/previews.js` | `pr.recorded` → a preview, `pr.merged` → destroyed; after provisioning, the suites |
| `…/src/services/environments.js` | `recordTests`, `promote` |
| `…/src/seed/data/designs/INF-031.md`, `environments/test-slots.md` | The repositories the design serves (`repos`); the baseline of journeys |
| `nooblyjs-ai-security/src/services/scans.js`, `src/scanners/mock.js` | `scanEnvironment` (DAST, image) |
| `nooblyjs-ai-factory/src/services/pull-requests/views.js`, `public/js/pages/testing.js` | The preview, its suites and the evidence in one list on the pull request page |

## The data

```
data/factory/quality/test-runs/TRN-test-slots-1.md
  level: test | staging | preview, environment, kind: environment, storyIds, prId?, runner: mock
  suites: [{ suite, passed, total, failing: [{ name, caseId?, criterionRef? }], text, measured? }]
data/infrastructure/environments/pr-031-1-1.md     kind: preview, repo, prId, storyId, product, designId …
  tests: [{ suite, passed, total, failing: [names], failingDetail }], testRunId, testedAt
```

## Services and events

- `quality`: `runEnvironment({ environment, storyIds?, actor? })`, `environmentRuns({ environment?, prId? })`.
- `infrastructure`: `previewForPr(prId)`, `recordTests({ environment, suites, testRunId })`, `environment(name)`.
- `security`: `scanEnvironment({ kind: dast | image, environment, envKind, repo, itemId, prId })`.
- Events: `environment.preview_opened`, `environment.tested`, `environment.promoted`, `environment.promotion_refused`,
  `test_run.recorded` (environment level).
