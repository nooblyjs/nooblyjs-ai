# Phase 21 — Testing in environments: summary

**Status:** built 2026-10-21, waiting for your review (started at your word, with the defaults, after Phases 19 and 20
were committed as `4dc4af6`). Spec: `.claude/specs/phase-21-testing-in-environments/`. Root `product.md` §3.6 and
roadmap I8 are what it builds. The work is in `nooblyjs-ai-infrastructure` (previews from pull requests, results on the
environment, promotion), the Factory's Test section (the test runner adapter, environment runs), `nooblyjs-ai-security`
(DAST and the image scan in an environment) and the Factory's pull request page.

## What is there

| Area | What |
| --- | --- |
| Previews (I8) | A pull request the lifecycle records (`pr.recorded`) on a repository an infrastructure design serves (its `repos`) gets a preview (`pr-031-1-1`) from that design, provisioned by the mock provisioner; its suites run once it is live; the merge (`pr.merged`) destroys it. A repository no design serves gets none, and the event says why |
| The test runner adapter | `TEST_RUNNER`, only `mock` (anything else is refused at start). e2e and e2e smoke from the stories' Build-level results plus the environment's baseline of journeys; load: p95 against the item's performance NFR (the mock measures 240 ms); accessibility and resilience pass. Every result says it is the mock |
| Suites per environment | Preview: e2e smoke, accessibility, DAST. Test: e2e, load, image scan. Staging: e2e, resilience, DAST (`test-policy.yaml` `environments`) |
| Environment runs | `TRN-test-slots-1`, at the environment's level, each suite's result and each failing test with its case and the criterion it proves; told to Infrastructure (`recordTests`), shown on the environment and its promotion tile |
| Security's scans | `scanEnvironment`: DAST finds the missing Content-Security-Policy header on a web preview (a medium finding, owned and linked to the pull request, its story and the environment; the suite blocks at high); the image scan has no image to scan (the mock provisioner builds none) |
| Promotion | `POST /infrastructure/api/v1/promotion-paths/:product/promote`: by a person with the apply rule's permission, only when the environment's suites ran and pass; a refusal names each failing test and criterion; Production only through a release. "Promote" on Environments, "Run the suites" on an environment |
| The Test approval | The pull request page has the preview's link and the evidence in one list: the AI's required tests (Build), what a person checks, and the preview's suites |

## The test script

Run in the real app by `test/environments.test.js` (the Factory, Teammates, Infrastructure and Security hosted), every
step passing. STORY-031-1's pull request is built as in Phase 16e; test-slots tests STORY-031-2, whose hold test fails
at Build (Phase 20).

1. PR-031-1-1 gets the preview `pr-031-1-1` (`environment.preview_opened`), provisioned; e2e smoke, accessibility and
   DAST run there (`TRN-pr-031-1-1-1`); the pull request page links it ("pr-031-1-1 is live: verify the pull request
   there"). After the merge the preview is destroyed ("PR-031-1-1 merged") and leaves every list.
2. test-slots' suites for STORY-031-2: "41 of 42 e2e · 1 failing", the failing test TC-031-2-1 with AC-031-2-1; the
   Test tile says the same. A Contributor can't promote (403); Stevie is refused: "Promotion to Staging is refused: a
   test is failing in test-slots: TC-031-2-1: The slot returns to the pool within 5 seconds (AC-031-2-1)."
3. STORY-031-2's next run passes TC-031-2-1; test-slots' suites pass ("42 of 42 e2e"), load says "p95 240 ms against
   the 300 ms target", the image scan has nothing to scan; promotion puts api 0.9.4 and web 4.12.0 in Staging; Staging
   to Production is `release_only`.
4. The preview's DAST opens a medium finding: Content-Security-Policy missing, owned by Priya, linked to PR-031-1-1,
   STORY-031-1 and `pr-031-1-1`; the suite passes and names it.
5. The page's evidence has the Build tests, the checks by hand and the preview's three suites in one list; Lerato gives
   the Build approval, Naledi the Test approval (overriding the 16e script's missing TC-031-1-4, with a reason).

## Tests

- New: the host's `test/environments.test.js` (6); Infrastructure's `test/previews-and-promotion.test.js` (2); the Test
  section's `quality/test/environments.test.js` (3); one Security test (environment scans).
- **Whole suites:** host 403 of 403 (397 before this phase). Factory 594 of 598, 4 skipped, none failing (591 of 595
  before). Infrastructure 50 of 50 (48). Security 21 of 21 (20). No test that passed before fails.

## Decisions taken while building

- **The repositories a preview is for are the design's** (`INF-031`'s `repos`), not the promotion path's: the path is
  a system file every install has, and repositories are the organisation's own (the blank install's check found it).
- **A destroyed preview keeps its record** (Infrastructure's rule for any destroyed environment): its page says
  destroyed, and it leaves every list.
- **The preview is named after the pull request** (`PR-031-1-1` → `pr-031-1-1`), and gets a sample address
  (`https://pr-031-1-1.preview.slots.noobly.invalid`) until a real provisioner gives one.
- **Promoting puts what is deployed in the next environment and clears its results** ("Promoted: its suites run
  next"), so it must be tested before it can go on.
- **A test in an environment comes from the Build-level result** of its case (the mock): a case the commit doesn't name
  isn't in the suite; one it names fails there when it fails at Build.

## Open questions (defaults taken, `[CONFIRM]`)

1. Which suites run where (above), and whether DAST may run in Staging (yes, by default).
2. The DAST and image scans block at high in an environment; a medium finding is opened and owned but doesn't fail
   the suite.
3. Which stories are under test in Test and Staging: named when the suites run, else every story with a Build-level
   run on the product's repositories. Should the deployed versions name them instead (Phase 22's releases)?
4. Who may promote: the apply rule's permission for the target kind (today `change-repo-access`, an Owner).
5. The guide points: which suites are worth their run cost? Does the preview make the tester's check quicker?
6. Not looked at in a browser here: the pull request page's preview and evidence, the environment's "Run the suites"
   and the path's "Promote". The tests read their APIs.
