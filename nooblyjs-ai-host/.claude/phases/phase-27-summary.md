# Phase 27 — The process as configuration: summary

**Status:** built (2026-10-26), waiting for your review. Spec: `.claude/specs/phase-27-process-as-configuration/` (tasks
1–13 done). Asked: "Please complete phase 27". The design is root `design.md` §13 (13.3 says what was built); the
principle is root `product.md` §6 rule 17.

## Decisions taken as defaults (each `[CONFIRM]`)

- The workflow is changed by editing files; Platform · Settings · **Workflow** shows it, read-only.
- A stage that goes away while an item is in it refuses the file, naming the items.
- Lines live in `data/factory/lines/`, never in a repository's `.factory/lines/`.
- A `when` check reads `item`, `spec.sections.<heading>`, `stories.count|active`, `pullRequests.count|open`, `defects.open`.
- **Stage kinds**: the code knows eight kinds of step; each stage names one (or none, a plain gate). Code compares
  kinds, never keys. This replaces the planned `owner` / `perStory` / `releasable` properties.
- An action the file doesn't list needs the default permission its code names; one mapped to a permission that doesn't
  exist refuses the whole file.

## What is there

| Area | What |
| --- | --- |
| The lifecycle from one file | `data/workflows/lifecycle.yaml` (seeded; written for a folder from before, with no checks so its `readiness.yaml` still counts): stages in order with key, label, area, kind, exit, checks, `pullRequestChecks`. `src/lifecycle/workflow.js` reads it with `approval-rules.yaml` and `readiness.yaml`; `stages.js` holds the stages in use (`stageOfKind`, `kindOf`, `isKind`). The engine's moves and exits, pull requests' "passed Test", Home's views, the item tracker, the PM swimlane and Metrics' stage table follow it |
| Checks by evaluator | `src/lifecycle/evaluators.js`: 16 named evaluators (`product.*`, `design.*`, `engineering.*`, `pr.*`), `when` checks in the Factory's condition language (exported as `nooblyjs-ai-factory/conditions`), `registerEvaluators` for apps. Product (`specSections`, the spec page's list) and Design read the words from the lifecycle |
| Checked, last good kept | Every workflow file and `access/roles.yaml`: unknown stage, kind, rule, permission, evaluator, a bad `when`, a stage with no way out, a bound gate switched off, YAML that doesn't read (with its line). Refused → last good (process, `applied/`, built-in or seed), `workflow.refused` in the audit log. Applied change → `workflow.changed` in Activity, in words. `enabled: false` switches a rule or a plain-gate stage off |
| Platform · Settings · Workflow | `GET /api/v1/platform/workflow` (`read-audit`) and a Workflow tab: files and their state, the stages with gate, who decides, target and checks, every action with its permission and who has it |
| Actions | `host.requireAction` / `canDo` / `permissionFor` (`src/middleware/roles.js`); 113 actions in NooblyJS and the seven apps, all listed in the seed's `access/roles.yaml` (`actions:`), found by scanning the code |
| The Factory's lines | `data/factory/lines/*.json` (win over a built-in of the same name); `data/factory/lines.yaml` picks by repository, then item type, then `default`; an unknown line refuses the work item with the reason; a run keeps the line it was queued with (`request.lineDef`) |
| Stage kinds in the apps | Items from the lifecycle carry `stageKind` and `stageLabel`; Design, the Factory, Quality, Operations, Security, Product and Home compare kinds. `test/stage-keys.test.js` fails on a stage-key comparison in any project. For you homes list the work role's `stages` (work-roles.yaml), else the stage of that kind |

## The test script

27a (`test/lifecycle/workflow.test.js`): 1. the seeded file is today's eight stages and every lifecycle test passes
(two tests that copy a pre-27 folder now delete `lifecycle.yaml` first, and three file listings name `lifecycle.yaml`
and `applied/`). 2. "An owner is named" fails, then passes when the Owner section is there, no restart; the change is in
Activity. 3. A Security review stage with `security-signoff`: a Test approval leads there, Thabo's sign-off to Release;
a merged story's feature goes there too; the page shows its label and "Sign off security". 4. `design.nope` refuses the
file, with the place and reason; approvals keep working. 5. `idea` switched off: the plain stage approval, then the idea
rule again. 6. An agent is refused and audited.

27b: 1. `send-back: accept-decisions`: Lerato is told she needs it, Thabo sends PRD-031 back (`test/workflow-config.test.js`).
2. An action mapped to `run-everything` refuses `roles.yaml`, the last good keeps running. 3. `web-storefront: quick`
→ build, verify, deliver; a defect's work by item type (`nooblyjs-ai-factory/test/services/intake/lines.test.js`).
4. A data line wins over the built-in; a bad `when` is refused with its position; a queued run keeps its line.
5. "Solution design" on Home, the item page, Metrics and in Activity. 6. The stage-key test passes.

**Not checked in a browser:** this codespace has no Chromium (Playwright would download one), so the Workflow tab and the
tracker were checked through their API and by syntax only.

## Tests

NooblyJS 444 + 6 new (the last full run: 442 of 444, then the two fixed: an assertion that named `readiness.yaml#…`
now names `lifecycle.yaml#…`; the one failure left is `test/kit.test.js`'s nav groups, as before, which comes from
nooblyjs-core). Product 179/179, Design 19/19, Operations 20/20, Security 21/21, Infrastructure 57/57, Teammates
148/148, Knowledge 41/41, Factory 414 of 418 with 4 skipped for this machine (no Docker; a sandbox is here), 0 failing.

## Still open

- The four defaults above `[CONFIRM]`.
- The browser's `ctx.can()` hints still name permissions: when `roles.yaml` moves an action to another permission, a
  button may show and then be refused (the API enforces the action's permission). A `ctx.canDo(action)` would close it.
- Editing the workflow in the app, with a preview of what changes (the guide point).
- `BUG-011` (the browser suite) is unchanged by this phase.
