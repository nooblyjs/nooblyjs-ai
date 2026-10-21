# Phase 20 — Quality (the Factory's Test section): summary

**Status:** built 2026-10-21, waiting for your review (started at your word, with the defaults, once 16a–19 were marked
reviewed). Spec: `.claude/specs/phase-20-quality/`. Root `product.md` §3.6 is what it builds. The work is in
`nooblyjs-ai-factory/quality` (test runs, coverage, defects, cases kept in step), the Factory (the log → test runs, the
Test group's pages, STORY-031-2's scripted agent), `nooblyjs-ai-factory/design` (changing one criterion after handoff)
and `nooblyjs-ai-host` (defects as lifecycle items, their trace, the item page, the tester's home).

## What is there

| Area | What |
| --- | --- |
| Test runs | Each verify of a commit by the line is a test run (`TRN-031-2-1`), Build level, "Pull request branch": each gate (the repository's and Security's), the failing tests by name, and each of the story's test cases against its criterion (`AC-031-2-1`) and the story's requirements (`BR-031-05`). Deliver's look for each required test (Phase 16e) gives each case its result. Test · Test runs lists them, newest first, then CHG-008's sample |
| Coverage | Per item, per feature and per story, each criterion with a ready test case, an automated test (found in the latest run's commit) and a passing test, in words: "1 of 3 criteria have a passing test (Build), across STORY-031-1 to -3". Test · Coverage |
| Cases kept in step | Each case remembers the words of its criterion. A person changes one criterion of a story in Design (with a reason), also after its handoff; its cases are "criterion changed" (not ready, Activity says so, the analysis page shows the old and new words) until a person edits them or marks them ready again, which they may do in Build or Test for such a case only |
| Defects | Lifecycle items (`DEF-031-1`), the child of the story they break, in the stage they were found in, linked (`breaks`) to the story, its requirements and the criterion, so they are in the item's trace under the criterion. Raised from a failing test run (its failing case, criterion and requirements come with it) or on a story by hand; a later passing run of the story is the proof that marks one fixed; a person closes, rejects (with a reason) or reopens it. They don't move through the stages. Test · Defects; the story's and the defect's Lifecycle pages |
| The tester's home | Two more tiles and lists: criteria with no passing test (per story in Build or Test) and open defects |

## The test script

Run in the real app by `test/quality.test.js` (the Software Factory and Digital Teammates hosted), every step passing.
STORY-031-1 is built as in Phase 16e (its run passes); STORY-031-2's work item "Hold a slot for 15 minutes while I
finish checkout" has a new scripted agent whose own test for TC-031-2-1 fails, so its run fails the test gate.

1. PRD-031's coverage: STORY-031-1 to -3, "1 of 3 criteria have a passing test (Build), across STORY-031-1 to -3", "3
   with a ready test case · 2 with an automated test · 1 with a passing test", per feature and per story.
2. Priya changes AC-031-1-1 in Design ("…within 50 ms", with a reason; without one: 400): TC-031-1-1 is "criterion
   changed", the criterion is not ready, `quality.cases_flagged` is in Activity; another case of the story in Build is
   refused (409); she marks TC-031-1-1 ready again and the flag clears.
3. Priya raises a defect from TRN-031-2-1: DEF-031-1, "TC-031-2-1 fails: The slot returns to the pool within 5
   seconds", S2 Major, breaks STORY-031-2 · BR-031-05 · AC-031-2-1; in Lifecycle under STORY-031-2, which lists it; in
   the trace PRD-031 → BR-031-05 → STORY-031-2 → AC-031-2-1 → DEF-031-1. Advancing it is refused (`per_defect`); an agent
   rejecting it is refused and audited; rejecting needs a reason; closing an open one is refused.

And: each test run carries the story's cases and requirements, and names its failures; Naledi as the tester sees the
gap and DEF-031-1 on her home; a later passing run of STORY-031-2 marks DEF-031-1 fixed (its proof), and Naledi closes
it (the item is completed).

## Tests

- New: the host's `test/quality.test.js` (6); the Test section's `quality/test/quality.test.js` (4); one Design test
  (changing a criterion after handoff).
- Changed: the Factory's seed test lists the new script; the Test runs page marks a sample row in its last column.
- **Whole suites:** host 397 of 397 (391 before this phase). Factory 591 of 595, 4 skipped, none failing (586 of 590
  before). Security 20 of 20. No test that passed before fails.

## Decisions taken while building

- **A re-verify of the same commit keeps what was found for a case** (deliver's look, a failure): the same run and commit
  is one test run.
- **A case's status at verify is "not checked yet"** until deliver looks for it, so coverage never counts a test as
  present before it is looked for.
- **In the trace a defect hangs under the criterion it breaks** (then the story, then the requirement).
- **The pages talk to the Test section through the Factory's API** (`POST /factory/api/v1/test/runs/:id/defects`,
  `/test/defects/:id/decision`, `draft`): the Factory's pages are bound to its own API.

## Open questions (defaults taken, `[CONFIRM]`)

1. The severity scale: S1 Critical, S2 Major, S3 Minor, S4 Trivial.
2. The defect workflow: open → fixed (a passing run, or a person with a reason) → closed (a person); rejected with a
   reason; reopened by a person. An agent may raise one, never decide one.
3. A defect's owner: the story's owner, else whoever raised it.
4. "REQ-031-01" in the roadmap: PRD-031 has no elicited requirements, so its defect breaks Design's BR-031-05 (Phase 18
   open question 3, linking BR and REQ, is still open).
5. "Change a criterion in the spec" is a story's criterion in Design (an approved spec can't be edited without sending
   the item back). Should a spec edit after Design flow into its stories' criteria?
6. What should a test lead see first (the roadmap's guide point)? Today the tester's home leads with criteria with no
   ready case (Engineer), then Test approvals, coverage gaps and defects.
7. Not looked at in a browser here: Test runs, Coverage, Defects, the analysis page's flags and the item page's
   defects. The tests read their APIs.
