# CLAUDE.md

Guidance for Claude Code in this folder.

This folder is the Software Factory's **Test section** (`quality/`, Phase 16d, root `product.md` §3.2b and §4): quality,
built inside the Factory. It starts with **Test analysis**: for each story in Engineer, test cases from its acceptance
criteria (given/when/then, `TC-031-1-1`), which the AI must automate and at which level (`test-policy.yaml`), a contract
test per interface, an E2E test for its journey and what a person checks by hand, each marked ready by a test analyst.
Before the Engineering sign-off every criterion needs a ready case and every interface a ready integration test.

**Phase 20** adds what spans the stories: **test runs** (`src/services/runs.js`: each verify of a commit by the line is
`TRN-031-2-1`, Build level, with its gates, failing tests by name and each case's result, against its criterion and the
story's requirements; `hosted.js` calls `recordGates` and `recordRequired` from the Factory's log), **coverage**
(`coverage.js`: per item, feature and story, each criterion with a ready case, an automated test, a passing test, in
words), **cases kept in step** (each case remembers its criterion's words, `criterionText`; when Design changes the
criterion the case is "criterion changed", and in Build or Test only such a case may be edited or marked ready again)
and **defects** (`defects.js`: raised from a failing run or on a story; each is a lifecycle item `DEF-031-1`, the
lifecycle's `recordDefect`/`decideDefect`; a later passing run of the story marks it fixed, a person closes it).

**Phase 21** adds **testing in environments**: the test runner adapter (`src/runners/`, `TEST_RUNNER`, only `mock`: e2e
and e2e smoke from the stories' Build-level results plus the environment's baseline of journeys, load against the
item's performance NFR, accessibility, resilience) and `src/services/env-runs.js`, which runs the suites of an
environment's kind (`test-policy.yaml` `environments`), asks NooblyJS Security for DAST and the image scan, records
an environment test run (`TRN-test-slots-1`, each failing test with its case and criterion) and tells Infrastructure
(`recordTests`), where the results decide promotion. A preview's suites run when Infrastructure says it is provisioned
(`environment.provisioned`).

| | |
| --- | --- |
| Where it answers | `/factory/quality` (API at `/factory/quality/api/v1`; pages in `../public/quality/`) |
| Who mounts it | the Factory's `register()` (`../src/services/sections.js`); its row sits in the Engineering group |
| Its data | `data/factory/quality/`: `test-policy.yaml`, `test-analysis/<storyId>.md`, `test-runs/TRN-….md` |
| What other apps call | `host.service('quality')`: `readinessFacts`, `casesFor`, `summaryFor`, `stories`; Phase 20: `recordGates`, `recordRequired`, `testRuns`, `coverageOf`, `coverage`, `gaps`, `defects`, `raiseDefect`, `decideDefect` |
| What it calls | `workflows` (the story; defects), `design.designFor` (its criteria, interfaces, NFRs, requirements), `teammates.runTask` |
| Its API (Phase 20) | `/test-runs`, `/test-runs/:id`, `/test-runs/:id/defects`, `/stories/:id/defects`, `/defects`, `/defects/:id/decision`, `/coverage`, `/coverage/:itemId` |

The pages for test runs, coverage and defects are the Factory's Test group (`../public/js/pages/testing.js`, over
`/factory/api/v1/test/…`), with CHG-008's sample after the recorded rows. The shared rules are the Factory's copy:
`../.claude/steering/nooblyjs-ai.md`. The specs are `../../nooblyjs-ai-host/.claude/specs/phase-16d-engineering/` and
`phase-20-quality/`.

```bash
node --test "quality/test/**/*.test.js"   # from nooblyjs-ai-factory/: this section's tests (offline)
```
