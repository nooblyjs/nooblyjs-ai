# Phase 16e — Build and Test: the AI builds and tests, engineers and testers approve: requirements

> **Status: done, signed off 2026-10-21** (built 2026-10-21). Summary: `.claude/phases/phase-16e-summary.md`. Root `product.md` §3.2, §3.2c, §5; root `roadmap.md` Phase 16e. Bugs
> found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-21: "Start Phase 16e" (16a–16d still waiting for review).

Goal: the AI writes the code and the automated tests the test analysis asked for; an engineer gives the Build approval;
a human tester verifies the pull request and gives the Test approval; only then does it merge. A feature goes to
Release on its own once all its stories have passed Test.

## Decisions taken before starting (2026-10-21, the defaults)

- **A merge made in Bitbucket without both approvals** is flagged on the story and its pull request, in the audit log
  and Activity, and not counted as done (the roadmap's default). `[CONFIRM]`
- **Each pull request is a lifecycle item of its own** (type `pr`, as the seed's are), a child of its story: its Build
  and Test approvals are ordinary lifecycle approvals, so Home · Approvals, reminders, the audit log and approving on
  someone's behalf (Phase 16b) work for them unchanged. Items handed to the Factory before 16e (not stories) keep their
  item-level Build and Test approvals.
- **A person merges.** After both approvals, for the commit they were given on, a person with the `merge` permission
  presses Merge on the pull request. On the local forge (the demo repository) the Factory merges for them, on record as
  theirs; a Bitbucket pull request is merged in Bitbucket (NooblyJS still has no write that merges), and the merge is
  counted when both approvals are there. The roadmap's step 3 says "it merges"; here it is the next click.
- **What "required" means.** The test cases of the story's test analysis that run against the work item's repository
  and that the AI automates (`automate: true`). A test is **present** when a test file of the pull request's commit
  names its id (`TC-031-1-4`); **passing** when it is present and the repository's gates passed on that commit.
- **Missing tests don't make the pull request a draft.** The evidence says what is missing, the engineer decides
  (Build approval or ask for changes), and the Test approval's readiness checks refuse while a required test is missing
  or failing (a person may override with a reason, audited).
- **The tester** in the script is Naledi, made an Approver (so she has `sign-off-tests`) and a test analyst on the
  Delivery squad by Stevie, an Owner, in the script itself: the seed keeps her as the new-joiner Viewer other tests use.

## R1 — The line builds against the test cases

1. A work item's issue asks for each automated test case by id, named in the test (16d gave the cases).
2. The run carries its required test cases (`request.noobly.testCases`).
3. The PR evidence lists each required test by id: present (where) and passing, or missing, or failing; and the cases a
   person checks. In words: "9 of 10 required tests present (TC-031-1-4 missing)", "10 of 10 required tests present,
   all passing".

## R2 — The Build approval

1. A delivered pull request for a story becomes a lifecycle pull request (type `pr`, its story's child, in Build) and
   opens its **Build approval**, waiting on the people with `merge` on the story's team; Home · Approvals and Build ·
   Pull requests show it with the evidence.
2. An engineer approves (the pull request moves to Test and its Test approval opens) or asks for changes with a reason:
   the line repairs it with the reason as the brief, and the new commit opens a fresh Build approval.

## R3 — The Test approval

1. It waits on the people with `sign-off-tests` on the story's team. Test · Test approvals and Home · Approvals show
   the AI's test evidence beside the test cases, and what to check by hand.
2. The tester (or anyone but a Viewer, on their behalf, recorded) approves, or sends it back to Build with a reason:
   the pull request is in Build again, the line repairs it, and the engineer approves again.
3. Readiness: every required test present and passing, the gates passed on this commit; an override needs a reason.

## R4 — Merge, and a new commit

1. Merge only after both approvals, for the pull request's current commit, and the gates. Refused otherwise, saying
   what is missing; an agent is refused.
2. **A new commit clears both approvals** (approved ones are cleared, open ones withdrawn, on record), wherever it comes
   from: a repair, or a commit a person pushes to the pull request's branch, which the Factory checks again (gates,
   review, the required tests) before a fresh Build approval opens.
3. A Bitbucket merge without both approvals is flagged on the story and the pull request, not counted.

## R5 — Stories and features

1. A story follows its pull requests: in Build while any is in Build (or a work item is still being built), in Test
   when all are in Test, **done** when its last pull request is merged. Work items that never started (no repository set
   up here) don't hold it, and the story says so.
2. A **feature** moves to Release when all its stories are done, without waiting for the other features of its item.
   The item's page shows each feature's stage.

## R6 — Pages, homes and metrics

1. Build · Pull requests: every pull request with its stage, approvals in words, evidence; a pull request's page with
   the evidence, the approvals (who gave each, for whom), and Give the Build approval / Ask for changes, Give the Test
   approval / Send back to Build, Merge.
2. Test · Test approvals: those waiting on a tester, in Test, given (by whom, for whom), each linking to its page.
3. The Developer home: pull requests waiting on a Build approval; the Test analyst home: those waiting on a Test
   approval.
4. Home · Metrics: pull requests waiting on a Build approval, and on a Test approval, with their age.

## Test script (roadmap Phase 16e)

After the 16d script (STORY-031-1 signed off, its web-storefront run queued):

1. The run delivers a pull request for STORY-031-1; its evidence says "9 of 10 required tests present (TC-031-1-4
   missing)". Its Build approval waits on Lerato.
2. As Lerato (engineer), ask for changes naming TC-031-1-4; the line repairs it; the evidence says 10 of 10. Lerato
   gives the Build approval: the pull request is in Test, and can't merge yet.
3. As Naledi (tester), send it back with a reason: it is in Build again. After the repair and Lerato's approval, Naledi
   gives the Test approval: it can merge.
4. An agent is refused both approvals, and audited. Lerato gives both, the Test approval on Naledi's behalf: allowed,
   and the pull request's page and the audit log say who gave each and for whom.
5. When the last story of the feature has passed Test (here the feature has one story, STORY-031-1), the feature is in
   Release while PRD-031's other feature (STORY-031-2's) is still being built.
6. Push a commit to an approved pull request: both approvals are cleared.

The roadmap's step 1 says "3 of 4"; the test analysis gives web-storefront ten automated cases (one criterion, seven
contracts, the journey, a load test), so the script counts those. Steps run in the order 1, 2, 3, 6, 4, then the merge
and 5, so that step 6's cleared approvals are what Lerato gives again in step 4.

**Done when:** steps 1–6 pass, and no test that passed before fails.

## Out of scope

Preview environments for the tester (Phase 21); test runs, coverage and defects recorded for real (Phase 20); a
Bitbucket pull request's approvals sent to Bitbucket; checks on a commit pushed to a Bitbucket pull request (only the
local forge is watched for pushes here).
