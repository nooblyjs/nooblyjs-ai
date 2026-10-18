# Phase 9a — Infrastructure joins NooblyJS: design

> **Status: done, signed off 2026-10-10.** Summary: `docs/phases/phase-09a-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

> Requirements: `requirements.md`. Steering: NooblyJS `structure.md` §2a, `tech.md` §6; Infrastructure's
> `.claude/steering/stack.md` §4 and `structure.md` §6.

## What changes where

| Repo | Change |
| --- | --- |
| `nooblyjs-ai-host` | Dependency and `hosted-apps.yaml` entry (seed, `data/`, `test/e2e/serve.js`), `SUITE_APPS` row, the seed calls the app's `seed()`; Platform: a `cloud` budget with an external spend source, Environments from `host.service('infrastructure').environments()`, the preview pool from its previews; `test/infrastructure.test.js` (checklist and the test script) and `test/e2e/infrastructure.story.js`; steering |
| `nooblyjs-ai-workflows` | Rule `infra-design` in `approval-rules.yaml` (seed, and added to an existing data folder); `requestApproval({ type: 'infra-design', … })` and `withdraw`/`close` for it, with no stage move; the Approvals view's label "Approve & provision <kind>" and a link; `approval.decided` carries `type`, `kind`, `designId` |
| `nooblyjs-ai-infrastructure` | `approvals.js` (open/close approvals in workflows, listen to `approval.decided`); budget from Platform; `sweep.js` (scheduled drift check on the host clock); runs: `cancel`, environments: `destroy`; run detail API and page; pages redraw on `ctx.sse` events; `services.environments()` and `services.previews()`; icon `cube`; roadmap I3–I6 ticked |

## Approvals

```
design → waiting-approval (vN asks for test, staging)
  infrastructure: for each kind → workflows.requestApproval({ type: 'infra-design', itemId, designId, version, kind,
                                     title: 'INF-031 · Approve & provision Test', href }) as the design's author
Home · Approvals: Approve → workflows decideApproval → approval.decided { type: 'infra-design', decision, designId,
                                     kind, decidedBy }
  infrastructure listens → designs.decide(designId, { decision, kind }, decidedBy, { via: 'workflows' })
Design screen: Approve → designs.decide(…) → workflows.closeApproval(approvalId, { decision, by }) (no second event)
```

Workflows checks the rule's permission and refuses agents; Infrastructure checks its own rules (policy checks, apply
rules) **before** workflows records the decision: workflows calls `host.service('infrastructure').canDecide()` for
an `infra-design` approval (built as `decideApproval`: the app decides and starts the runs, then workflows records
it), so a failing blocking policy refuses on Home exactly as on the Design screen. If Infrastructure isn't running,
Home says so and refuses.

## The cloud budget

Platform `budgets.yaml` gains `cloud: { label: 'Cloud (Infrastructure)', monthly: 6000, source: infrastructure }`.
`budgets.status()` takes that system's spend from `services.get('infrastructure').metrics().cloudSpendUsd` instead of
the ledger, and the cloud budget never counts in the agents' month total. `checkAgentWork({ system: 'cloud' })`
refuses at the limit. Infrastructure asks it before `runs.start()` for a new environment, an approval's runs and a
restore; Preview and Dev automatic applies are included (they cost money too).

## Drift sweep

A timer (every minute; `INFRA_SWEEP_CHECK_MS`) checks `host.clock.now()` against `data/infrastructure/sweep.yaml`
(`lastRunAt`), as the lifecycle engine's sweep does; when 6 business hours have passed it
checks every live environment through the provisioner's `detectDrift`, records new drift and emits
`drift.detected` and `drift.sweep_finished`. Moving the dev clock forward triggers it at the next minute; tests call
`sweep.tick()` directly.

## Cancel and destroy

`runs.cancel(id, person)`: queued → `cancelled` at once; running → the provisioner's signal aborts at the next step,
the run ends `cancelled`, the environment returns to `live` (or `absent` if it was new). `environments.destroy(name,
person, reason)`: refused while a run is going; the environment is marked `destroyed` at once (the mock has nothing
to remove; a real provisioner will need a destroy run), kept on disk for history, hidden from lists and from
Platform's pools.

## Live progress

The pages subscribe with `ctx.sse.on('*')` (the frame's single EventSource), filter `environment.`, `drift.`,
`infra_design.`, `approval.` and `budget.` prefixes, and redraw at most every 500 ms (`public/js/live.js`). The timed
refresh stays only for standalone, where `ctx.sse.enabled` is false.

## Tests

- `nooblyjs-ai-workflows`: the `infra-design` approval opens, is decided, refuses an agent and a missing permission, and
  moves no stage.
- `nooblyjs-ai-infrastructure`: approvals through a stand-in workflows; budget refusal; sweep on a moved clock; cancel
  and destroy with their refusals; run detail; no `setInterval` in `public/` (module test).
- `noobly/test/infrastructure.test.js`: the checklist (mount, shell entry, deep links, 401/403 with audit, data under
  `data/infrastructure/`, disabled → not installed) and test-script steps 2–7 through the real apps.
- `noobly/test/e2e/infrastructure.story.js`: steps 1–7 in a browser, axe and 375px on every Infrastructure screen.
