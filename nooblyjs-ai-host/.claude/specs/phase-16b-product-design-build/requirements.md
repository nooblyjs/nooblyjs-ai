# Phase 16b — Eight stages, and the Factory's five groups: requirements

> **Status: built 2026-10-20, waiting for review.** Summary: `.claude/phases/phase-16b-summary.md`. Written 2026-10-20 for
> lifecycle version 3 (root `product.md` §3.2, §3.2a–c, §4; root `roadmap.md` Phase 16b). Bugs found while reviewing it
> go in `.claude/specs/bugs-and-changes/`.

> Source, 2026-10-20: "we have product pretty much nailed with Product, UI, UX. The next section should be design. In
> this section we do Business Requirements, Solution Architecture (Feature Landscape, Impacted Systems, NFRs), Functional
> Analysis (Interface requirements, Technical Requirements), Feature Generation. Then … under the software factory we
> have System/Application Architecture (application flow, objects, nfr's, etc) from the code and system. Test analysis
> (Test cases, automated testing requirements, Integration testing, E2E testing). Then all of this will then enter the
> factory and actually get built and PR's created that then get approved by the engineers and tests signed off by the
> testers." Answers the same day:
> - Engineer is a stage with its own sign-off (one approval).
> - "The ai testing is done in the build phase but I would like a human tester to verify and sign off the PR", with "a
>   Build and Test approval step": Build ends with an engineer's **Build approval**; a **Test** stage follows, where a
>   human tester verifies the pull request and gives the **Test approval**; then it merges. Test replaces Verify.
> - "The technical feature is actually the story that is used to build the feature": Design generates **stories**.
> - Stories enter the Factory one at a time; a **feature is released on its own** once all its stories pass Test.
> - Elicitation stays in Product.
> - A feature has many stories; a story belongs to exactly one feature.
> - "A tester gives the test approval. Anyone can approve for anyone else but who approved is logged." Then: "Yes I
>   meant on behalf of approval [on every approval], viewers cant approve."
> - The Factory's sidebar is Product · Design · Engineering · Build · Test.
>
> Goal: the lifecycle and the Software Factory follow how the teams work. This phase lays the stages, the handoffs and
> the sidebar; 16c builds the Design section (and stories), 16d Engineering, 16e the Build and Test approvals in full.

## Decisions taken before starting (2026-10-20)

- **Eight stages:** Discover · Product · Design · Engineer · Build · Test · Release · Operate.
- **Handoffs are per item in this phase.** Stories (16c) make Design's handoff and everything after it per story.
- **Approvals:** Product → Design by a Product lead (`approve`); Design → Engineer by a Solution Architect
  (`accept-decisions`); Engineer → Build by an Application Architect (`accept-decisions`) and a test lead
  (`sign-off-tests`) in one approval; Build → Test by an engineer (the Build approval); Test → Release by a tester (the
  Test approval), after which the pull request may merge.
- **Anyone may approve for anyone else, on every approval**, except Viewers and agents; who gave it, and for whom, is
  logged. A rule's permission says whom the approval waits on.
- **Verify is retired.** Its release candidate goes with it; the Test approval takes its place.

## R1 — Eight stages

1. `discover, product, design, engineer, build, test, release, operate`, numbered 1–8. Handoffs between them are named
   by area ("Product → Design", "Design → Engineering", "Engineering → Build", "Build → Test").
2. Older keys still land: `specify`, `ux`, `ui` → `product`; `architect` → `design`; `verify` and `ship` → `test`.
   History written before still reads with its own labels (Specify, UX design, UI design, Architect, Verify, Ship).
3. Overview, Lifecycle, the item page and the PM's home show the eight.

## R2 — The handoffs and approvals

| From | Decision | Rule | Permission | Who | Moves to |
| --- | --- | --- | --- | --- | --- |
| Product | Product handoff (spec, UX and UI) | `spec` | `approve` | a Product lead (one) | Design |
| Design | Design handoff | `design-handoff` | `accept-decisions` | a Solution Architect (one) | Engineer |
| Engineer | Engineering sign-off | `engineering-signoff` | `accept-decisions` + `sign-off-tests` | an Application Architect and a test lead, one approval | Build |
| Build | Build approval | `build-approval` | `merge` | an engineer (code owner) | Test |
| Test | Test approval | `test-approval` | `sign-off-tests` | a tester | Release (the pull request may merge) |

1. The Product handoff keeps the rule key `spec`. Its words change: "Product → Design (spec, UX and UI)", "Approve &
   hand off to Design". It needs the Product stage's readiness checks (the spec checks), as before.
2. The Design handoff replaces the UI handoff (`ui-handoff`), which is retired.
3. The Software Factory's intake starts no run for an item before its Engineering sign-off.
4. The Build approval takes over Phase 16a's `merge` rule (an item in `build` with an open merge approval keeps it,
   renamed). A merge before the Test approval is refused, saying which approval is missing.
5. The Test approval may be refused with a reason, which sends the item back to Build.
6. **Anyone may approve for anyone else**, on every approval in the lifecycle engine. The "Permission" column says whom
   an approval **waits on** (its reviewers). Any person whose access role is not Viewer may give it, for themselves
   when they are a reviewer still waiting, or on behalf of one (`for`; when only one reviewer is waiting, it is for
   them). The approval records `by` (who gave it) and `for` (whom it waited on); so do the audit log and Activity
   ("Lerato for Naledi"). The engineer and the tester may be the same person. Viewers and agents are refused, and the
   refusal is audited. A rule with a quorum above one (the production deploy) needs that many different givers.
7. `sign-off-tests` is a new permission (Approver and up `[CONFIRM]`), built in for older data folders and shown on
   Teams & roles: the testers and test leads that the Test approval and the test part of the Engineering sign-off wait
   on.
8. The release candidate (`release-candidate`, `accept-release-candidate`) is retired: an open one is withdrawn, with
   the reason said; the permission is no longer shown.
9. Agents are refused every one of these decisions, and the refusal is audited.

## R3 — Existing data moves once, on record

1. On start, active items move: `specify`/`ux`/`ui` → `product`, `architect` → `design`, `verify`/`ship` → `test`.
   Their open approvals follow; an open UI handoff or release candidate is withdrawn, with the reason said.
2. A data folder's `spec` rule that still has the old default words takes the new ones; an edited rule is left as it
   is. `readiness.yaml` checks under `specify` count for `product`, under `architect` for `design`, and under `verify`
   for `test`, when the new key is missing.
3. One audit record (`lifecycle.stages_migrated`); no stage event.

## R4 — The Factory's sidebar

1. Five groups, in order: **Product · Design · Engineering · Build · Test**, each with an icon and a one-line hint
   (CHG-006's `groups`).
2. The Design section (`design/`, `/factory/design`, data in `data/factory/design/`) starts with **Architecture**, moved
   from `/factory/product/architecture` (the old address redirects; links other apps hand out follow). Its other rows
   (Business requirements, Solution architecture, Functional analysis, Stories, Handoff) come in 16c.
3. Engineering (Application architecture, Test analysis, Engineering sign-off) and Test (Test approvals, Test runs,
   Coverage, Defects) show their rows, each page saying in words which phase brings it. Build gains Pull requests
   (waiting on the Build approval).
4. `src/services/sections.js` and `public/js/sections.js` let one section put rows in more than one group (Test puts
   Test analysis in Engineering).

## R5 — Work roles

Solution Architect, Functional Analyst, Application Architect and Test analyst join the work roles (onboarding). They
shape a person's home only; permissions still come from the access role. Their homes come with 16c–16e.

## R6 — Metrics

Stage groups: Product (Discover, Product, and history's Specify, UX and UI), Design (Design, and history's Architect),
Engineer, Build, Test (and history's Verify), Release, Operate. The lead-time chart: Product, Design, Engineer, Build
and Test to release.

## Out of scope

Stories and the Design section's content (16c), application architecture and test analysis (16d), the PR evidence of
required tests and the Test approval screens (16e), preview environments for the tester (Phase 21).

## First draft (2026-10-19), superseded

Seven stages (Discover, Product, Design, Build, Verify, Release, Operate); a Design section with Architecture, Test
cases and Handoff to Build; test cases written in Design; one Design handoff by an Architect creating the work items.
Lifecycle version 3 splits that Design: solution architecture and the stories stay in Design; application architecture
and test analysis move to a new Engineer stage inside the Software Factory; Build ends with an engineer's approval and a
Test stage, where a human tester verifies each pull request, replaces Verify.
