# Phase 16a — Nine stages: requirements

> **Status: done, signed off 2026-10-21** (built 2026-10-19). Summary: `.claude/phases/phase-16a-summary.md`.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Source: the root roadmap (`../.claude/steering/roadmap.md`) Phase 16, split into 16a (this) and 16b (one shape for
> checks, and the trace); the root `product.md` §3.2 and §5, `design.md` §3.
> Goal: the lifecycle has nine stages. Ship is replaced by Verify, Release and Operate, each with a person's decision
> to leave it, and the new decisions have their own permissions.

## Decisions taken before starting (2026-10-19)

- **Nine stages:** `discover, specify, architect, ux, ui, build, verify, release, operate`. Stages 1–6 keep their keys
  and numbers.
- **`ship` maps to `verify`, not `release`.** The root `design.md` first said "read as release". In the code an item
  enters Ship when people merge its pull requests in Bitbucket (Phase 13), and it waits there before going to
  production. In nine stages that waiting is Verify. So an active item in `ship` moves to `verify`.
- **Merge is Build's exit.** The merge decision (code owner) now moves an item from Build to Verify, as a person's
  merge in Bitbucket does. It no longer completes the item.
- **The production-deploy approval keeps its key `deploy`**, so data folders that already have the rule keep working.
  It now moves the item from Release to Operate.
- **New approval types:** `release-candidate` (Verify → Release), `outcome-review` (Operate → completed), and two app
  approvals for the Security app to come, `threat-model` and `risk-acceptance`.
- **New permissions** on the existing five access roles; no new roles.

## R1 — Nine stages

1. The lifecycle has nine stages, in order, each with a number, a label and an area. A handoff between areas is named
   by area ("Software Factory → Verify").
2. `stageKey('ship')` answers `verify`, so an older caller or link that names Ship still lands somewhere real.
   `stageLabel('ship')` still answers "Ship", so history written before this phase reads as it happened.
3. Overview, Lifecycle, an item's page and the PM's For you show all nine stages.
4. Each stage's note on Overview says what is waiting there in words: Build "on the line · n PRs awaiting merge",
   Verify "n release candidates in review", Release "n deploys awaiting approval", Operate "n outcome reviews due".

## R2 — Leaving each new stage is a person's decision

| From | Decision | Rule | Permission | Approvers | Moves to |
| --- | --- | --- | --- | --- | --- |
| Build | Merge to main | `merge` | `merge` | one | Verify |
| Verify | Release candidate accepted | `release-candidate` | `accept-release-candidate` | one | Release |
| Release | Production deploy | `deploy` | `deploy-production` | **two different people** | Operate |
| Operate | Outcome review | `outcome-review` | `approve` | one | the item is completed |

1. **Approve & move** on an item in Build, Verify, Release or Operate opens that stage's approval.
2. A rule that needs more than one approver opens with the person who pressed it plus everyone else who may decide
   it on the item's team (else the Owners). The first approval is recorded and the item waits for the second. The
   same person can't count twice.
3. `release-candidate` needs readiness: it is refused while the Verify checks in `readiness.yaml` fail, unless a person
   overrides with a reason. Verify has no checks yet (Phase 16b and 21 bring them).
4. A person's merge in Bitbucket moves an item from Build to Verify (it moved Build → Ship before).
5. **Agents are refused every one of these decisions**, whatever their access role, and the refusal is audited.

## R3 — The new approval types and permissions are always there

1. A data folder made before this phase gets the new rules (`release-candidate`, `outcome-review`, `threat-model`,
   `risk-acceptance`) and the new permissions without anyone editing a file. A rule or permission the folder already
   has, edited or not, wins.
2. New permissions and who holds them:

   | Permission | Viewer | Contributor | Approver | Architect | Owner |
   | --- | :-: | :-: | :-: | :-: | :-: |
   | `accept-requirement` | — | — | ✓ | ✓ | ✓ |
   | `accept-threat-model` | — | — | — | ✓ | ✓ |
   | `accept-risk` | — | — | — | ✓ | ✓ |
   | `accept-release-candidate` | — | — | ✓ | ✓ | ✓ |
   | `deploy-production` | — | — | ✓ | ✓ | ✓ |
   | `declare-incident` | — | ✓ | ✓ | ✓ | ✓ |

3. Teams & roles shows the new rows of the matrix in words.
4. `threat-model` and `risk-acceptance` are **app approvals**: the Security app carries them out. Until it exists, deciding
   one is refused with "decided by security, which is not running here", and nothing is recorded.

## R4 — Existing data moves once, on record

1. When the lifecycle engine starts, every active item in `ship` moves to `verify`. Its history gets a closing time for
   the Ship visit and a new Verify entry marked `migrated`. Open approvals that left from `ship` now leave from
   `verify`.
2. It runs once per item (an item already in `verify` is not touched), writes one audit record listing what moved
   (`lifecycle.stages_migrated`), and emits no `item.stage_changed` (nobody decided anything, so Metrics and Activity
   count no handoff).
3. Completed items keep `ship` in their history.

## R5 — Metrics

1. The "who does the work" table has a row for Verify, Release and Operate. The old Ship row shows only when a visit
   to Ship ended in the period, labelled "Ship (before nine stages)".
2. The lead-time chart's last part covers Build, Ship (history), Verify and Release: "Build to release". Operate is not
   lead time and is left out of the chart.

## Out of scope (Phase 16b and later)

One shape for every check, the trace, the Checks panel and Trace tab, the Learn arrow on Overview, and the screens of
the Quality, Security and Operations apps.
