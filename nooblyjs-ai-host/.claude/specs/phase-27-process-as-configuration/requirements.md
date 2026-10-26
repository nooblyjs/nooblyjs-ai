# Phase 27 — The process as configuration: requirements

> **Status: built (2026-10-26), waiting for your review.** Summary: `.claude/phases/phase-27-summary.md`. Root `roadmap.md` Phase 27 (27a and 27b); root `design.md` §13; root
> `product.md` §6 rule 17.

> Asked 2026-10-26: "Please complete phase 27".

Goal: an Owner changes the steps, the validations each gate needs and who may do each thing by editing files, with no
release. The kinds of step and the evaluators behind checks stay code.

## Decisions taken before starting (the defaults, `[CONFIRM]`)

- **Who changes the workflow:** files only, edited by whoever runs NooblyJS (an Owner). Platform · Settings ·
  **Workflow** shows the definition in words, read-only, with any error in the files. No editing in the app yet.
- **A stage that goes away** (removed, or `enabled: false`) while an active item is in it: the file is refused, naming
  the items. Move them first.
- **Lines** live in `data/factory/lines/` (and the package's built-in ones), never in a repository's `.factory/lines/`:
  a repository would otherwise change its own gates.
- **What a `when` check reads:** `item` (the item's own fields), `spec.sections.<heading>` (the spec's `## ` sections,
  heading in lower case with dashes, text or null when empty), `stories.count`, `stories.active`,
  `pullRequests.count`, `pullRequests.open`, `defects.open`.
- **Step kinds.** The code knows eight kinds of step (`discover`, `product`, `design`, `engineer`, `build`, `test`,
  `release`, `operate`), as the Factory knows its station kinds. Each built-in stage names its kind; every kind is
  there exactly once and in that order; a stage with no kind is a plain gate (a person's approval, its checks, nothing
  else). Code asks for a stage by its kind, never by its key, so a stage can be renamed, relabelled, given other checks
  or gates, and new stages can go between them.
- **Actions** name their permission in `access/roles.yaml` (`actions:`). The code says each action's default
  permission where it checks it, so a data folder from before keeps working; the file wins where it lists the action.
  An action mapped to a permission that doesn't exist refuses the file.
- **Last good:** each of `workflows/lifecycle.yaml`, `workflows/approval-rules.yaml`, `workflows/readiness.yaml` and
  `access/roles.yaml` is validated whenever it changes. A file that fails keeps the last good version running (in
  memory, else the copy in `applied/`, else the seed's), and the error is logged and shown on Platform · Settings ·
  Workflow. A change that applies is recorded as `workflow.changed` (Activity, audit), saying what changed in words.
  Who edited a file isn't known, so the actor is `system`.

## R1 — The lifecycle from one file (27a)

- `data/workflows/lifecycle.yaml`: the stages in order, each with `key`, `label`, `area`, `kind`, `exit` (a rule key,
  or `{ rule, to }`; `to` defaults to the next stage, and to `done` for the last), `checks` and `enabled`. Seeded;
  written once for a data folder from before, from the built-in eight stages, with no `checks` so that folder's
  `readiness.yaml` still says which checks each stage needs.
- `stages.js`, `MOVES` and `LEAVES_BY` come from the definition. History's stage keys (`LEGACY`) stay code.
- Re-read on every use, like `approval-rules.yaml`.

## R2 — Checks by named evaluator (27a)

- A check is an evaluator's name (`product.goals-measurable`), or `{ key, evaluator, passed?, failed? }`, or
  `{ key, passed, failed, when }` in the Factory's condition language over the facts above.
- The evaluators (`src/lifecycle/evaluators.js`): `product.*` (the idea's business case and the spec's seven checks),
  `design.*`, `engineering.*`, `pr.*`, each with its words. Product's and Design's own copies of the words go: they read
  them from the lifecycle. An app may register more (`host.service('workflows').registerEvaluators`).
- An unknown evaluator, a bad `when` or a duplicate key refuses the file.

## R3 — Validated on load, last good kept (27a)

- `lifecycle.yaml`: unique keys; every kind once, in order; an exit rule that exists and isn't retired (a rule switched
  off falls back to the plain stage approval, with a warning); `to` a later stage or `done`; no rule leaves two stages;
  no active item in a stage that is gone.
- `approval-rules.yaml`: key, a permission that exists, quorum, slots' permissions, a target; duplicate keys.
- `readiness.yaml`: `waitingTooLongDays` a positive number; each stage's checks with key and words.
- `access/roles.yaml`: roles; each permission's roles known; `newPersonRole`, `agentCap` known; each action's
  permission known.
- YAML that doesn't parse says the line.

## R4 — Built-ins are defaults (27a)

- A rule or stage listed with `enabled: false` stays off. `BUILT_IN_RULES` only fills in rules a file doesn't mention.

## R5 — Platform · Settings · Workflow (27a)

- `GET /api/v1/platform/workflow` (`read-audit`): the stages in order, each with its kind, its exit gate in words (who
  it waits on, the target), its checks in words; the actions and their permissions; each file's state (applied, or the
  error and since when, with the last good still running).

## R6 — Who may do what (27b)

- `host.requireAction(action, defaultPermission)` and `host.canDo(accessRole, action, defaultPermission)`; every
  `requireRole` / `can` in the host and the hosted apps names an action. The seed's `roles.yaml` lists every action.
- Platform · Settings · Workflow: every action, the permission it needs (from the file or the default) and who has it.

## R7 — The Factory's lines from configuration (27b)

- Lines load from `data/factory/lines/` as well as the package's (a data line wins over a built-in of the same name).
- `data/factory/lines.yaml` (`repos.yaml` is a flat name → folder map): `repositories: { <repo>: <line> }`,
  `itemTypes: { <item type>: <line> }` and `default:`; the handoff asks for that line, else `default`. A line that
  doesn't exist or doesn't read refuses the work item when it is taken in, saying so. A run keeps the line it was
  queued with (`request.lineDef`).

## R8 — Stage kinds, not stage names (27b)

- The lifecycle's services take and return stage kinds (`stageKind` on items; `items({ kind })`); the apps compare
  kinds. A test fails the build when a stage key is compared in code outside `src/lifecycle/stages.js` and the seed.
- For you panels that list "items in Design" list items in the stages the work role's `stages` names in
  `work-roles.yaml` (default: the stage of that kind).

## Test script (roadmap Phase 27)

27a
1. With the seed, `lifecycle.yaml` describes today's eight stages and every existing test passes unchanged.
2. Add a check to the Product stage, `when: spec.sections.owner != null`, worded "An owner is named": PRD-031 shows it,
   failing, until Lerato adds an Owner section to the spec; then it passes. No restart.
3. Add a **Security review** stage between Test and Release whose exit is a new rule `security-signoff` (permission
   `accept-threat-model`): a story given its Test approval goes to Security review and waits on Thabo; once he signs off
   it goes to Release. Lifecycle, Home · Approvals and Metrics show the new stage by its label.
4. Name an evaluator that doesn't exist (`design.nope`): the file is refused, Platform · Settings · Workflow shows the
   place and the reason, and approvals keep working on the last good definition.
5. Set `enabled: false` on the `idea` rule: accepting an idea moves it with the plain stage approval; set it back.
6. As an agent (test fixture), give any approval under the new definition: refused and audited, as before.

27b
1. In `roles.yaml`, set `send-back: accept-decisions`: Lerato (Approver) can no longer send PRD-031 back and is told
   which permission it needs; Thabo (Architect) can. No restart.
2. An action mapped to a permission that doesn't exist: the file is refused, the last good stays, the log names the
   action.
3. Set `web-storefront: quick` under `repositories:` in `data/factory/lines.yaml`: the next run from a story's Engineering sign-off goes
   build → verify → deliver.
4. Put a line with a bad `when` in `data/factory/lines/`: it is refused at load with the position of the mistake; runs
   keep the line they had.
5. Rename the Design stage's label to "Solution design": every screen, Activity and Metrics say it; nothing breaks.
6. The stage-key test passes: no stage key is compared in code outside `stages.js` and the seed.
