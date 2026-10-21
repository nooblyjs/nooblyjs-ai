# Phase 21 — Testing in environments: requirements

> **Status: built 2026-10-21, waiting for review.** Summary: `.claude/phases/phase-21-summary.md`. Root `product.md` §3.6, `design.md` §7; root `roadmap.md` Phase 21
> (Infrastructure I8). Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-21: "Yes commit and push, then start Phase 21 with the defaults" (Phases 19 and 20 committed as
> `4dc4af6`; 20 waits for review).

Goal: each pull request gets a preview environment the tester verifies it in, and the environment suites (function,
performance, accessibility, security) run there and in Test and Staging, as evidence for the Test approval.

## Decisions taken before starting (2026-10-21, the defaults)

- **Which suites run where** `[CONFIRM]` (the Test section's `test-policy.yaml`, `environments:`):

  | Environment | Suites |
  | --- | --- |
  | Preview (one per pull request) | e2e smoke, accessibility, DAST |
  | Test | e2e, load, image scan |
  | Staging | e2e, resilience, DAST |

- **DAST may run in Staging** `[CONFIRM]`: yes (above), never in Production.
- **The test runner adapter** is the Test section's (`TEST_RUNNER`, only `mock`; anything else is refused at start).
  The mock runs no browser: an e2e suite is the environment's own baseline (the journeys already there, sample data)
  plus each automated E2E or integration case of the stories under test that the latest Build-level run found in the
  commit, passing when that run passes it. Load reports a p95 against the target of the item's performance NFR
  (the mock measures 240 ms); accessibility and resilience pass. Every result says it is the mock runner.
- **Security's dynamic scan (DAST) and image scan** are Security's, through its scanner adapter (the mock): DAST finds
  a missing Content-Security-Policy header on a web preview (a medium finding: it is opened and owned, and doesn't fail
  the suite, which blocks at high); the image scan finds no image to scan (the mock provisioner builds none).
- **A preview** is made when the lifecycle records a new pull request (`pr.recorded`) on a repository an
  infrastructure design serves (the design gains `repos`), from that design, named after the pull request
  (`pr-031-1-1`); its suites run when it is provisioned; it is destroyed when the pull request merges (`pr.merged`). A
  repository no design serves gets no preview, and the pull request page says so.
- **Promotion** (`POST /infrastructure/api/v1/promotion-paths/:product/promote`, `{ from }`): what is deployed in one
  environment goes to the next on the path, by a person with the apply rule's permission, only when that environment's
  suites have run and pass; a refusal names each failing test and the criterion it proves. Production is never
  promoted to here: it changes through a release (Phase 22).
- **The stories under test** in Test or Staging are named when the suites run (or, by default, every story with a
  Build-level run on the product's repositories); in a preview, the pull request's story.

## R1 — Previews from pull requests (I8)
`pr.recorded` → a preview; provisioned → its suites; `pr.merged` → destroyed; the results on the environment.

## R2 — The test runner adapter
Mock first: e2e (and smoke), load (targets from the NFRs), accessibility, resilience; each run recorded in the Test
section as an environment test run, each failing test linked to its case and criterion.

## R3 — Security's dynamic and image scans
Suites in the preview, Test and Staging; a finding is linked to the pull request and its story.

## R4 — The Test approval's evidence; promotion
The pull request page shows the preview's link and its suite results beside the test cases, in one list; a build
moves right only when that environment's tests pass.

## Test script (roadmap Phase 21)
1. Open a PR: a preview appears; e2e smoke runs there; the tester opens it from the Test approval; merge: the preview
   goes.
2. `test-slots` shows "41 of 42 e2e · 1 failing", linked to the criterion it proves. Promotion to Staging is refused,
   naming the failing test.
3. Fix it; the run passes; promotion is allowed. The load suite reports p95 against the 300 ms target.
4. A DAST finding in the preview opens a Security finding linked to the pull request and its story.
5. As a tester, give the Test approval with the environment results and the AI's test evidence in one list.

The pull request is STORY-031-1's (built as in Phase 16e); `test-slots` tests STORY-031-2, whose hold test fails at
Build (Phase 20) and so in the environment; "fix it" is STORY-031-2's next passing run.

**Done when:** steps 1–5 pass on the mock runner and mock scanner.
