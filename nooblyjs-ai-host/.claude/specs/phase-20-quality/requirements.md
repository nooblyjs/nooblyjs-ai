# Phase 20 — Quality (the Factory's Test section): requirements

> **Status: done (built and reviewed 2026-10-21).** Summary: `.claude/phases/phase-20-summary.md`. Root `product.md` §3.6, §4; `design.md` §4–§5, §7; root `roadmap.md` Phase 20.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-21: "Please consider all previous phases reviewed and Please continue with phase 20." (16a–19 marked
> done that day.)

Goal: quality is a fact across an item: coverage over all its stories and features, test runs recorded against
requirements, and defects as items of their own.

## Decisions taken before starting (2026-10-21, the defaults)

- **The defect severity scale** `[CONFIRM]`: **S1 Critical** (a requirement fails with no way round it, or data is
  wrong), **S2 Major** (it fails, with a way round it), **S3 Minor** (it works, badly), **S4 Trivial** (cosmetic). The
  seed's sample defects already use S1–S3.
- **The defect workflow** `[CONFIRM]`:

  ```
  open ──(a later passing test run of its story, or a person with a reason)──► fixed ──(a person checks it)──► closed
    │                                                                            │
    └──────────────(a person: not a defect, with a reason)──► rejected ◄─────────┘     fixed ──(a person)──► open
  ```

  Raising a defect needs `draft`, and an agent may raise one (agents propose). Closing, rejecting and reopening are a
  person's (`draft`, people only; an agent is refused and audited). "Fixed" by a run is the run's proof, not a decision.
- **A defect is a lifecycle item** (type `defect`, `DEF-031-1`: the item's number, then a count), the child of the
  story it breaks, in the stage it was found in (a Build-level run: Build). It names the requirements it breaks (the
  story's business requirements from Design, `BR-031-05`, or an elicited `REQ-…`), the criterion (`AC-031-2-1`) and the
  test run it was found in. Its owner by default is the story's owner, else whoever raised it `[CONFIRM]`. A closed
  defect is `completed`, a rejected one `withdrawn`.
- **The roadmap's "REQ-031-01"** is PRD-031's requirement as Design names it: PRD-031 has no elicited `REQ` ids (the
  seed spec predates Phase 18), so STORY-031-2's defect breaks **BR-031-05** ("A customer can hold a slot for 15 minutes
  …"). An item with elicited requirements may name a `REQ-…` instead `[CONFIRM]` (Phase 18 open question 3).
- **A test run** (`TRN-031-2-1`: the story's number, then a count) is one verify of one commit by the Software
  Factory's line, at the **Build** level, environment "Pull request branch": each gate's result, the failures, and each
  of the story's test cases (passing, failing, not proven, missing, from the commit's test files: Phase 16e's required
  tests), each case's criterion and the story's requirements. Environment runs join in Phase 21.
- **Coverage** of an item, a feature or a story is said in words, per criterion: **with a ready test case**, **with an
  automated test** (an automated case found in the latest run's commit), **with a passing test** (the latest run of the
  story passes a case of that criterion): "1 of 3 criteria have a passing test (Build)".
- **"Change a criterion in the spec"**: an approved spec can't be edited without sending the item back, and after a
  story's handoff its acceptance criteria are Design's. So a person changes **one acceptance criterion of a story** in
  Design (`draft`, with a reason) even after its handoff; nothing else of a handed-off story changes. Each test case
  remembers the criterion's words it was written for: when they differ the case is **"criterion changed"** (not ready)
  until a person edits it or marks it ready again. The sign-off's `criteria-ready` and coverage count it as not ready.
- **The Test analyst / tester's home** gains two tiles and lists: coverage gaps (criteria with no passing test, per
  story in Build or Test) and open defects, besides test analysis to finish and pull requests waiting on a Test
  approval.
- **The sample** (CHG-008's runs and defects) stays on the pages, marked as sample data, after the recorded ones.

## R1 — Coverage
Test · Coverage per item and per feature, across its stories, each criterion with a ready case, an automated test, a
passing run, in words. The item's page shows the same line.

## R2 — Test runs
Each verify of a commit by the line is a test run, recorded against the story's test cases and requirements; a
failing run names its failures. Test · Test runs lists them, newest first, with the sample after.

## R3 — Test cases kept in step
A changed criterion marks its test cases "criterion changed" for a person; Activity says so; the analyst's view shows
the old and new words.

## R4 — Defects
Raised from a failing test run (or by hand on a story): an item in Lifecycle, linked to the requirement and story it
breaks; fixed by a later passing run of the story; closed or rejected by a person. Test · Defects lists them.

## R5 — The Test analyst / tester's home
Coverage gaps and defects, beside test analysis and Test approvals.

## Test script (roadmap Phase 20)
1. PRD-031 · Coverage reads across STORY-031-1 to -3 in words.
2. Change a criterion in the spec: its test cases are marked for review.
3. Raise a defect from a failing run; it appears in Lifecycle linked to REQ-031-01 (BR-031-05, above) and STORY-031-2.

STORY-031-1 is built as in Phase 16e (its run passes); STORY-031-2's work item "Hold a slot for 15 minutes while I
finish checkout" gets a scripted agent whose hold-expiry test fails (`TC-031-2-1`), so its run is a failing test run.

**Done when:** steps 1–3 pass, and the Factory, with its Test section, still passes the hosted-app checklist.
