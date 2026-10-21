# Phase 16b — Eight stages, and the Factory's five groups: summary

**Status:** done, signed off 2026-10-21 (built 2026-10-20). Spec: `.claude/specs/phase-16b-product-design-build/`. The work
is in `nooblyjs-ai-host` (the lifecycle engine, Home, Metrics, roles) and `nooblyjs-ai-factory` (the sidebar and the
Design section). Lifecycle v3 is root `product.md` §3.2, §3.2a–c and §4.

## What is there

| Area | What |
| --- | --- |
| Stages | Eight: Discover, **Product**, **Design**, **Engineer**, Build, **Test**, Release, Operate (`src/lifecycle/stages.js`). The keys from before still land: Specify, UX and UI in Product, Architect in Design, Verify and Ship in Test; history written before still reads with its own labels. Handoffs are named by area: Product → Design, Design → Engineering, Engineering → Build, Build → Test |
| Leaving each stage | Product → Design: the **Product handoff** (rule `spec`, new words). Design → Engineer: the **Design handoff** (`design-handoff`, a Solution Architect, `accept-decisions`), which carries the planned work items. Engineer → Build: the **Engineering sign-off** (`engineering-signoff`, one approval with two places: an Application Architect and a test lead). Build → Test: the **Build approval** (`build-approval`, the code owner). Test → Release: the **Test approval** (`test-approval`, a tester, `sign-off-tests`), after which the pull request may merge. Release and Operate as in Phase 16a |
| Nothing built before Engineering signs off | The Design handoff moves the item to Engineer and keeps its work items; `handoff.created`, which the Software Factory's intake turns into runs, is emitted only by the Engineering sign-off |
| Approving on someone's behalf | Every approval waits on the people its rule's permission names, and any person but a Viewer may give it, for themselves or for one of them (`for`; when only one is waiting it is for them). The approval records `by`, the event says "…, for Stevie", and the audit log has `approval.on_behalf`. Viewers and agents are refused and audited. The production deploy still needs two different people giving it, so one person can't give both, even on someone's behalf. Home · Approvals says "You are deciding on behalf of …", or offers a choice when several are waiting |
| A merge in Bitbucket | Since the approvals move the item, a person's merge moves nothing: one made in Build or Test, before the Build and Test approvals, is flagged on the item (`mergedEarly`, `item.merged`, audit `item.merged_before_approval`); an agent's is refused |
| Rules and permissions | The seed's `approval-rules.yaml` has the four new rules; a data folder from before gets them built in, its unedited spec rule takes the new words, and its `ui-handoff` and `merge` rules are retired (kept for history, not in the table). `sign-off-tests` is new (Approver and up), built in for older folders and on Teams & roles. The release candidate and `accept-release-candidate` went with Verify. Readiness checks under `specify`, `architect` or `verify` count for Product, Design and Test until the new key is there |
| Moving old data | On start, active items in a stage from before move to where it belongs now, with a "migrated" history entry. Open approvals follow; an open UI handoff or release candidate is withdrawn, saying why; an open merge becomes the Build approval. One `lifecycle.stages_migrated` audit record, no stage event. A second start changes nothing |
| The Factory's sidebar | Five groups, Product · Design · Engineering · Build · Test, each with an icon and a line. **Design** (`/factory/design`) shows the Product section's Architecture pages (its API, links and stylesheet), so `/factory/product/architecture/…` moves on to `/factory/design/architecture/…` with its id. **Engineering** (Application architecture, Test analysis, Engineering sign-off) and **Test** (Test approvals, Test runs, Coverage, Defects) and Build's new **Pull requests** say in words what comes and in which phase. A section may put its rows in another's group (`factoryGroup`) and show another's pages (`scope`) |
| Screens | Overview's strip says what waits in each of the eight; the item page's tracker and its action (Approve & hand off to Design, Sign off & send to Build, Give the Build approval, Give the Test approval …); the PM's For you; the Architect home reads Design; links to architecture go to `/factory/design/architecture` |
| Work roles | Solution Architect, Functional Analyst, Application Architect and Test analyst, in onboarding and in the job-title suggestions. Their homes come with Phases 16c–16e |
| Metrics | Groups Product (with history's Specify, UX and UI), Design (with Architect), Engineer, Build, Test (with Verify), Release, Operate, and Ship for history. The chart: Product, Design, Engineer, Build and Test to release |

## Tests

- New: `test/lifecycle/eight-stages.test.js` (Phase 16a's `nine-stages.test.js`, moved), 11 tests that write their own
  items: the stages, names and Overview; the whole walk, each step a person's, with a Viewer and an agent refused and
  audited, the Design handoff given on the Owner's behalf, the Engineering sign-off's two places and its handoff, and
  the deploy's second giver; approving for someone (asking whom, refusing someone it doesn't wait on, the record, the
  event, the audit, the panel); a deploy with nobody to second it; the Design handoff's work reaching the Factory only
  on the sign-off; Test readiness (and Verify's checks counting) with an override; a Bitbucket merge flagged; send-back;
  the security app approvals; the migration of every old stage and approval, twice; an older data folder's rules,
  words, readiness and permissions.
- Factory: the five groups, the Design section in the server and browser tables, its pages in the Product scope under
  `/design`, the old Architecture addresses moving on, and the new pages (`test/sections.test.js`, `register.test.js`,
  `module.test.js`).
- Changed to the new meaning: the Metrics grouping and chart (`test/services/metrics.test.js`), the blank folder's rule
  count, the Product section's handoff text.
- **Whole host suite:** 319 tests, 125 pass. **Before this phase** (the same tree at CHG-007): 317 tests, 122 pass.
  Comparing the two test by test, the only tests that passed before and not now are Phase 16a's five nine-stage tests
  and the weekly chart's, each replaced by a passing lifecycle v3 test under a new name. The failures are the missing
  sample story (BUG-006).
- **Factory package:** 536 tests, 529 pass; the 3 that fail are the line's known ones (`redteam` RT4, `intake/handoff`
  steps 2–3), the same before. **Infrastructure:** 46 of 46.

## Decisions taken while building

- **Who an approval waits on stays the rule's permission**; "anyone may approve for anyone else" is who may give it.
  So reminders, escalation and Waiting on you still go to the people it waits on.
- **The production deploy keeps two different givers.** With on-behalf approvals, one person could otherwise give both.
- **The Engineering sign-off is one approval with two places** (`slots`): one person who holds both permissions (an
  Architect, an Owner) fills both with one click; anyone else fills the place that is theirs, or one on behalf.
- **The Design handoff keeps the Product section's Send** (its handoff page) until 16c gives Design its own Handoff
  page; it now needs the item in Design, and its words say the work goes to Engineering.
- **A merge in Bitbucket no longer moves the item**: the Build and Test approvals do. One made before them is flagged,
  as the roadmap's 16e asks (`[CONFIRM]` there).

## Open questions

1. **The PRD-031 sample story is still missing** (BUG-006), now to be rebuilt in eight stages. It is why most host tests
   fail, why the lifecycle's story tests and `test/lifecycle.test.js`, `app-approval`, `metrics.test.js` and the e2e
   specs still name the old stages (they can't run until it is back), and why this phase's test script can't be
   clicked through on seeded items.
2. **Viewers can't approve; everyone else can, on anyone's behalf.** The Product section's own Accept on an ADR still
   checks `accept-decisions` itself (its screen, not the lifecycle's). Should it follow the on-behalf rule too?
3. **Work roles in an existing data folder**: the four new roles are in the seed's `work-roles.yaml`; a folder made
   before keeps its own file, so they appear there only when someone adds them.
4. Not looked at in a browser here (no Chromium libraries in this codespace): the sidebar's five groups, the Design
   section's Architecture pages, and the Approvals panel's "on behalf of".
