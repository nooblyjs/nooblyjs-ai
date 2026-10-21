# Phase 16a — Nine stages: design

> **Status: done, signed off 2026-10-21** (built 2026-10-19). Requirements: `requirements.md`.

## Where the stages are written down

| Place | Change |
| --- | --- |
| `src/lifecycle/stages.js` | The nine stages. `LEGACY = { ship: 'verify' }` for `stageKey`; `stageLabel('ship')` is "Ship" |
| `src/lifecycle/config.js` | `BUILT_IN_RULES` gains `release-candidate`, `outcome-review`, `threat-model`, `risk-acceptance` |
| `src/lifecycle/seed/data/approval-rules.yaml` | `merge` moves to Verify (comment); `deploy` takes `deploy-production` |
| `src/lifecycle/services/engine.js` | `MOVES`, `APP_TYPES`, `DECIDED_WORDS`, `advance()` per stage, multi-approver opening, `movedByMerge` to Verify, `migrateShip()` |
| `src/lifecycle/index.js` | Runs `migrateShip()` once at start, before the sweep timer |
| `src/lifecycle/services/views.js` | Stage notes, the next stage and the action label for the four later stages |
| `src/middleware/roles.js` | `BUILT_IN_PERMISSIONS`, used when `roles.yaml` lacks one |
| `src/seed/data/access/roles.yaml` | The six new permissions |
| `src/services/teams.js` | Matrix rows for them |
| `src/services/chat.js` | Stage labels |
| `src/services/metrics/compute.js` | Groups and chart parts |
| `public/js/pages/home/item.js`, `for-you-pm.js`, `styleguide.js` | Nine stages in the tracker and swimlane |

## Moves

```
build ──merge──► verify ──release-candidate──► release ──deploy (2)──► operate ──outcome-review──► completed
  ▲  movedByMerge (a person's merge in Bitbucket)
```

`MOVES = { spec: 'architect', 'ui-handoff': 'build', merge: 'verify', 'release-candidate': 'release', deploy: 'operate',
'outcome-review': 'complete', stage: null }`. A move to the stage the item is already in is skipped, so a `merge`
approval opened before the migration, now leaving from Verify, records the merge and moves nothing.

`advance()` picks the approval by stage: `specify → spec`, `ui → ui-handoff`, `build → merge`, `verify →
release-candidate`, `release → deploy`, `operate → outcome-review`, any other → `stage`.

## Approvals that need more than one person

`openAndDecide()` used to open an approval with only the person who pressed the button and decide it at once. For a
rule whose `quorum` is a number above 1, the reviewers are that person plus `reviewersFor(rule, team, person)`, without
duplicates. The person's decision is then recorded like any other: the approval stays open, the item stays where it
is, and the other reviewers see it on Home · Approvals. `quorumMet()` counts distinct reviewers, so one person can't
make two.

## Permissions for older data folders

`createRoles().matrix()` returns `roles.yaml`'s permissions with `BUILT_IN_PERMISSIONS` filled in for any key the file
does not have. The same rule as `BUILT_IN_RULES`: the file wins where it speaks.

## The migration

`engine.migrateShip()`:

1. Lists items; for each `status: active, stage: ship`, under the item's lock: closes the open history entry, pushes
   `{ stage: 'verify', enteredAt: now, kind: 'migrated', from: 'ship' }`, sets `stage: verify` and `stageEnteredAt`.
2. Lists open approvals with `from: ship`; sets `from: verify`.
3. When anything moved, writes one audit record `lifecycle.stages_migrated` with the item and approval ids. No event.

It is idempotent because it only looks at `stage: ship`. It runs in `register()` before the API is mounted, inside a
try/catch that logs and carries on, so a broken file can't stop NooblyJS starting.

## Metrics

```
GROUPS:      product · architecture · design · build · verify · release · operate · ship (legacy)
CHART_PARTS: Product · Architecture · UX & UI design · Build to release (build, ship, verify, release)
```

The chart part keeps its key `buildShip`, so its colour class in the stylesheet still applies. The stage table drops
the legacy Ship row when it has no visit in the period.

## Tests

`test/lifecycle/nine-stages.test.js` runs the engine on the stand-in host with items it writes itself (it does not need
the PRD-031 story, which BUG-006 left unbuilt): the stage list and legacy names; Build → Verify → Release → Operate →
completed with the right permission at each step; two different people for a deploy; agents and the wrong roles
refused and audited; a Bitbucket merge to Verify; the new app approvals refused while Security isn't running; the
migration, run twice; and a data folder with the old rules and roles.
