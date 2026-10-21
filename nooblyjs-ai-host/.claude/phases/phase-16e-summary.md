# Phase 16e — Build and Test: the AI builds and tests, engineers and testers approve: summary

**Status:** built 2026-10-21, waiting for your review (started at your word, with the defaults, while 16a–16d wait for
theirs). Spec: `.claude/specs/phase-16e-build-and-test/`. The work is in `nooblyjs-ai-factory` (`src/services/pull-requests/`,
the deliver station and evidence, the intake, the pages) and `nooblyjs-ai-host` (`src/lifecycle/services/pull-requests.js`,
the engine's hooks, devtools' Bitbucket merge, the homes, Metrics, the item page). Root `product.md` §3.2c is what Build
and Test are for.

## What is there

| Area | What |
| --- | --- |
| Required tests | A run for a story carries the test cases of its repository (`request.noobly.testCases`); the work item's issue asks for each automated case as a test named by its id. The deliver station looks for each id in the commit's test files: **present and passing** (the gates passed), failing, present but not proven, or **missing**. The PR evidence has a "Required tests (from the test analysis)" section, and what a person checks: "9 of 10 required tests present (TC-031-1-4 missing)" |
| Pull requests as items | A delivered pull request for a story is a lifecycle item of its own (`PR-031-1-1`, type `pr`, the story's child), with its commit and evidence. Its **Build approval** opens at once (waiting on the people with `merge` on the story's team); approved, it moves the pull request to Test and opens its **Test approval** (`sign-off-tests`). Home · Approvals shows both, with the evidence and a link to the pull request's page |
| Asking for changes | Changes asked for at the Build approval, or a Test approval sent back (the pull request goes back to Build), send the run back to its repair station with the person's words as the brief; the new commit opens a fresh Build approval |
| Test readiness | A pull request's Test approval checks every required test present and passing and the gates passed on its commit (`readiness.yaml` `pull-request`); a person may override with a reason, audited |
| A new commit | Clears both approvals (approved ones `cleared`, open ones withdrawn, on record, audited). A commit a person pushes to the pull request's branch is noticed (on the pages and every few seconds), recorded at once, and checked again from verify before a fresh Build approval opens |
| Merge | A person with `merge` presses Merge after both approvals for the pull request's current commit and passing checks; the Factory merges it on the local forge in their name ("Merged by Lerato M. in NooblyJS … after the Build approval by … and the Test approval by … for …"). A Bitbucket pull request is merged in Bitbucket: with both approvals the merge counts, without them it is flagged on the pull request and its story and not counted |
| Stories and features | A story follows its pull requests (Build, Test) and **passes Test** when the last one is merged; work items that never started here are named, not waited on. A **feature** goes to Release when all its stories have passed Test, without waiting for the item's other features. The item page shows its features and a story's pull requests |
| Pages | Build · **Pull requests** (stage, approvals in words, evidence) and **a pull request's page** (`/factory/pull-requests/:id`: the evidence, the approvals with who gave each and for whom, Give / Ask for changes, Give / Send back, on behalf, Merge). Test · **Test approvals** (waiting with the evidence, in Test, given by whom for whom) |
| Homes and Metrics | The Test analyst's home lists the pull requests waiting on a Test approval; the Developer's pull requests link to their page and say what their evidence says. Home · Metrics shows the pull requests waiting on a Build approval and on a Test approval now, with the oldest's age, from the events |
| The seed | STORY-031-1's scripted agent writes nine of its ten required tests (TC-031-1-4 is left out), adds it when the engineer asks (`fix#1`), and strengthens TC-031-1-9 when the tester sends it back (`fix#2`) |

## The test script

Run in the real app by `test/build-and-test.test.js`, every step passing, after the 16c and 16d scripts (STORY-031-1
signed off; STORY-031-2 signed off with an override; Stevie makes Naledi an Approver and she onboards as the Delivery
squad's test analyst):

1. The run delivers PR-031-1-1 for STORY-031-1: "9 of 10 required tests present (TC-031-1-4 missing)", the gates
   passed, TC-031-1-11 is for a person; its Build approval waits on Lerato, with the evidence in Home · Approvals and in
   the PR file. Merge is refused.
2. Lerato asks for changes naming TC-031-1-4: the run is repaired with her words, "10 of 10 required tests present, all
   passing". Her Build approval moves it to Test (the story follows); Merge is refused: it needs the Test approval.
3. Naledi sends it back with a reason: it is in Build. After the repair and Lerato's approval, Naledi gives the Test
   approval: "may merge now".
6. A commit pushed to the approved pull request's branch: both approvals are cleared (audited), it is in Build, and the
   Factory checks the pushed commit again (10 of 10, all passing) before a fresh Build approval opens.
4. An agent is refused both approvals (audited twice). Lerato gives both, the Test approval on Naledi's behalf: the
   pull request's page says "Test approval given by Lerato M. for Naledi K.", and the audit log has `approval.on_behalf`.
5. Priya (Contributor) can't merge; Lerato merges: main has the change, the merge commit is Lerato's. STORY-031-1 passed
   Test (slots-api and stores-service were not built here, and it says so); FEAT-031-1 is in Release while FEAT-031-2
   (STORY-031-2) is in Build, and PRD-031 stays in Design for its stories still there.

The roadmap's step 1 said "3 of 4"; the test analysis gives web-storefront ten automated cases (one criterion, seven
contracts, the journey, a load test), so the script counts those. Step 6 runs before step 4, so that the approvals the
commit cleared are what Lerato gives again; the merge comes after step 4, and step 5 after it. The roadmap's step 3 says
"it merges": here it may merge, and a person presses Merge.

## Tests

- New in the Factory: `test/services/pull-requests/evidence.test.js` (2: present, missing, failing, not proven, the
  words and the PR section), `test/services/pull-requests/bridge.test.js` (4: recorded for a story only, repair on
  changes asked for once, a pushed commit checked again, Merge on the local forge and refused for Bitbucket), and a
  repair test (a person's request is not counted against `repairAttempts`).
- New in the host: `test/lifecycle/pull-requests.test.js` (6: the item and its Build approval, to Test and the Test
  readiness, sent back and a new commit, the merge check, the story and features, a Bitbucket merge) and
  `test/build-and-test.test.js` (6: the test script).
- Changed: the Factory's `pages.test.js` and `engineering/views.test.js` read the Pull requests and Test approvals from
  their new routes.
- **Whole suites:** host 359 of 359 pass (347 before this phase, all passing). Factory 576 of 580 pass, 4 skipped, none
  failing (569 of 573 before). No test that passed before fails.

## Decisions taken while building

- **The Test approval's checks are a pull request's own** (`readiness.yaml` `pull-request`, not a stage), so an item in
  Test that is not a pull request keeps Test's (or Verify's) checks, as in 16b.
- **Missing tests don't make a draft**: the evidence says what is missing, the engineer decides, and the Test approval's
  checks refuse until it is fixed or overridden with a reason.
- **The repair limit counts only the Factory's own repairs** (its checks, its review). A person asking for changes, or a
  commit a person pushed, is not the Factory trying again.
- **A pushed commit is checked again by the same run** (back to verify at that commit), so the evidence and the gates are
  for the commit that would merge. Only local pull request branches are watched here.
- **A pull request's moves are its story's work in Metrics**: its item events carry `itemType: 'pr'` and are left out
  of lead time; its approvals count as waiting. Roll-ups are version 2 (the approval type in `ask`/`decide`).
- **A story's moves (Build ↔ Test, passed Test) and a feature's (to Release) are nobody's decision**: on record (history,
  audit, `story.passed_test`, `feature.in_release`), no stage event, like 16c's item following its stories.

## Open questions

1. **A Bitbucket merge without both approvals** is flagged and not counted (the roadmap's default). `[CONFIRM]`
2. **Work items that never started** (no repository set up here) don't hold their story's Test: the story passes when
   its last pull request merges, and names them. Should they hold it instead?
3. **Who the Test approval waits on**: the people with `sign-off-tests` on the story's team, so Approvers and Architects
   as well as the testers (permissions come from the access role). Lerato and Thabo are waited on beside Naledi.
4. **The merge on the local forge is the Factory's git merge in the person's name**; Bitbucket's stays a person's in
   Bitbucket (NooblyJS has no write that merges).
5. Not looked at in a browser here: the Pull requests page, a pull request's page, Test approvals, the item page's
   features and pull requests, the Test analyst home's list and the Metrics card. The tests read their APIs, and the
   Factory's Pull requests and Test approvals lists are drawn in Node; a pull request's own page is not. The e2e specs
   were not run.

## Guide points (roadmap)

Does a human Test approval on every PR slow the line too much? Should small PRs need it?
