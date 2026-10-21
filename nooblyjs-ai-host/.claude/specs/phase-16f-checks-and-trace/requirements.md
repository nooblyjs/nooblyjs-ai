# Phase 16f — One shape for checks, and the trace: requirements

> **Status: done, signed off 2026-10-21** (built 2026-10-21). Summary: `.claude/phases/phase-16f-summary.md`. Root `design.md` §4 (the trace), §5 (checks); root `roadmap.md` Phase
> 16f. Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-21: "Start Phase 16f" (16a–16e still waiting for review).

Goal: every artefact can be traced, and every kind of check looks and behaves the same.

## Decided before it starts (2026-10-19)

The id prefixes (root `design.md` §4) and the check shape (§5), as written.

## Decisions taken at the start (2026-10-21, the defaults)

- **Which checks there are.** Readiness (the lifecycle's, for each item's current stage: Design's and Engineering's
  are worked out by those sections, as before) and the Build and Test approvals (kind `approval`, a person's) come from
  the lifecycle; the spec's readiness and the standards check from the Product section; each run's gates, the item's
  quality attributes against them and each pull request's required tests from the Software Factory; the policy checks
  of the item's infrastructure design (INF-031), per kind of environment, from Infrastructure. Each app maps its own
  checks to the shape in a `checksFor(itemId)` service; NooblyJS gathers them for an item and its stories and pull
  requests.
- **`check.recorded`** is emitted by NooblyJS when it gathers a check that is new or whose result changed (it keeps the
  last result per check in `data/checks/`). Activity leaves it out (one line per check would drown it).
- **Overriding one check** with a reason is a person's, on a readiness check (the lifecycle's): it holds for that stage,
  the check shows it, the audit log has it, and the stage's decision no longer waits on it. Other kinds are overridden,
  or not, by the app that owns them, and say so. Agents are refused, audited.
- **Ids.** A goal of the spec is `GOAL-031-1` (its row in the Goals table); a story's acceptance criterion is
  `AC-031-1-1` (story 1's first criterion); a quality attribute `QA-031-1`; the others are as decided.
- **The trace index** is `data/trace/index.yaml`, built from each app's `trace(itemId)` and the links in items' front
  matter; it is rebuilt when anything changed since (or when it is missing), and `npm run trace:rebuild` compares it
  with a fresh build.

## R1 — The check shape

`{ id, key, kind: readiness | approval | gate | standard | policy | test, subject: { item, ref }, definedBy: { system,
ref }, verifiedBy, severity: blocking | warning, result: passed | failed | warning | not-run, text, evidence: { system,
ref, summary }, override, at }`. `text` says it in words; a check never passes on a model's word.

## R2 — Checks of an item

`GET /api/v1/home/items/:id/checks`: the item's, its stories' and their pull requests' checks in one list, each with
its source and evidence, said in words, with how many pass. The item page's **Checks** panel shows them; a failing
readiness check offers Override (a reason).

## R3 — The trace

Each app's `trace(itemId)` returns its nodes and links; NooblyJS keeps the index; `GET /api/v1/home/items/:id/trace`
gives the tree from the item (goals → business requirements → stories → criteria → test cases; stories → work items →
runs → pull requests; ADRs, quality attributes, infrastructure) and the missing links named in words ("AC-031-2-1 has
no test"). The item page's **Trace** tab draws it.

## R4 — Home · Overview: the Learn arrow

Below the line: incidents, SLO breaches and goal results come back to Discover as signals.

## Test script (roadmap Phase 16f)

1. Open PRD-031 · Checks: readiness, Design's and Engineering's checks, quality-attribute gates, the standards check,
   Build and Test approvals and INF-031's policy checks are in one list, each with its source and evidence, said in words.
2. Override a failing readiness check with a reason; the override shows on the check and in the audit log.
3. Open PRD-031 · Trace: from a goal through business requirements, stories and test cases down to `slots-api#482`,
   with the missing links named.
4. Delete `data/trace/` and reload: the Trace tab is identical. `npm run trace:rebuild` reports 0 differences.
5. As an agent (test fixture), try to override a check: refused and audited.

**Done when:** steps 1–5 pass, and no test that passed before fails.

## Out of scope

Requirements (`REQ-…`) and elicitation (Phase 18), threats (19), test runs and defects for real (20), releases,
deployments and incidents (22–23): the trace has their place but nothing yet to link.
