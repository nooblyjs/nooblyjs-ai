# Phase 16a — Nine stages: summary

**Status:** done, signed off 2026-10-21 (built 2026-10-19). Spec: `.claude/specs/phase-16a-nine-stages/` (all 9 tasks done).
All the work is in `nooblyjs-ai-host`.

## What is there

| Area | What |
| --- | --- |
| Stages | Nine: Discover, Specify, Architect, UX design, UI design, Build, **Verify**, **Release**, **Operate** (`src/lifecycle/stages.js`). `ship` is still understood: as a name it means Verify, and history written before still reads "Ship" |
| Leaving each stage | Build → Verify: the merge (`merge`), or people merging in Bitbucket. Verify → Release: the release candidate (`accept-release-candidate`, gated by Verify's readiness checks). Release → Operate: the production deploy (`deploy-production`, **two different people**). Operate → done: the outcome review (`approve`) |
| Two people for a deploy | **Approve & move** on an item in Release records your approval and waits on the others who may decide it (the item's team, else the Owners, else everyone with the permission). The same person can't count twice. With nobody else able to approve, it is refused and says why |
| Security approvals, ready for the app | `threat-model` and `risk-acceptance` can be opened by the Security app when it exists (Phase 19). Until then deciding one is refused, "decided by security, which is not running here", and nothing is recorded |
| Permissions | Six new ones on the existing five roles (`accept-requirement`, `accept-threat-model`, `accept-risk`, `accept-release-candidate`, `deploy-production`, `declare-incident`), in the seed's `roles.yaml`, built in for data folders made before, and on Teams & roles |
| Moving old data | On start, every active item in Ship moves to Verify, with a "migrated" history entry; open approvals that left from Ship leave from Verify. One `lifecycle.stages_migrated` audit record, no stage event (nobody decided anything, so Metrics counts no handoff). A second start changes nothing |
| Screens | Overview's strip (each stage says what waits there), Lifecycle's swimlane and stage health, the item page (tracker and the action's label), the PM's For you, and the style guide |
| Metrics | Verify, Release and Operate rows in "who does the work". Ship is kept as history ("Ship (before nine stages)"), shown only in a period with a visit to it. The chart's last part is **Build to release** (Build, Ship, Verify and Release); Operate is not lead time |

## Tests

- New: `test/lifecycle/nine-stages.test.js`, 9 tests that write their own items, so they don't need the sample story:
  the stage list and Overview; the full walk with the right permission at each step and agents refused and audited;
  a deploy refused with nobody to second it; readiness on the release candidate with an override; a Bitbucket merge to
  Verify; send-back withdrawing a waiting deploy; the security app approvals; the migration, twice; and an older data
  folder getting the new rules and permissions.
- Changed to the new meaning: stage names, the metrics chart and table, the blank folder's rule count, and the
  devtools tests where a merge in Bitbucket now lands in Verify.
- **Whole host suite:** 314 tests, 121 pass, 193 fail. **Before this phase:** 305 tests, 112 pass, 193 fail. Comparing
  the two test by test, nothing that passed before fails now. The failures are almost all one cause (below).
- `nooblyjs-ai-product` (160) and `nooblyjs-ai-infrastructure` (46) pass in full. `nooblyjs-ai-factory` has 3 failures
  that are there with this phase's changes taken out too (its sandbox and handoff tests in this codespace).
- NooblyJS starts on an empty data folder, mounts every app, and `/healthz` answers.

## Decisions taken while building

- **Ship maps to Verify, not Release** (the root `design.md` first said Release). An item entered Ship when people
  merged its pull requests (Phase 13), and it waited there before production: that waiting is Verify's in nine stages.
- **The production deploy keeps its key `deploy`**, so folders that already have the rule keep working.
- **A merge approval left open from Ship** is decided as before; it moves nothing, because the item is already past
  Build.

## Open questions

1. **The PRD-031 sample story is still missing** (BUG-006). It is why 193 host tests fail, why the lifecycle's own
   story tests fail, and why this phase's test script can't be clicked through on seeded items. Rebuilding it, now in
   nine stages, is worth doing before Phase 16b, which needs PRD-031 for its Checks and Trace demo.
2. Outcome review due 5 working days after an item enters Operate `[CONFIRM]`: or when its goal's measure has data?
3. The kit's default stage list (`nooblyjs-core/public/ui/js/components/stage-strip.js`) still has seven names. Every
   NooblyJS page passes its own stages, so only the style guide's swimlane shows it. It is in the separate
   `nooblyjs-core` repository, so it wasn't changed here.
4. Who are the QA leads? Today anyone with `accept-release-candidate` (Approver and up) can accept a release candidate.
