# Phase 16f — One shape for checks, and the trace: summary

**Status:** built 2026-10-21, waiting for your review (started at your word, while 16a–16e wait for theirs). Spec:
`.claude/specs/phase-16f-checks-and-trace/`. Root `design.md` §4 (the trace) and §5 (checks) are what it builds. The
work is in `nooblyjs-ai-host` (the checks and trace services, the lifecycle's checks and override, the item page,
Overview), `nooblyjs-ai-factory` (the line's checks and runs; the Product, Design and Test sections' checks and links)
and `nooblyjs-ai-infrastructure` (the designs' policy checks and links).

## What is there

| Area | What |
| --- | --- |
| One shape | `{ id, key, kind, subject: { item, ref }, definedBy: { system, ref }, verifiedBy, severity, result, text, evidence: { system, ref, summary }, override, at }`. Kinds: `readiness`, `approval` (a Build or Test approval, a person's: new beside the root design's list), `standard`, `gate`, `test`, `policy`. Results: passed, failed, warning, not run. `verifiedBy` is always a tool, a gate or a person |
| Who reports what | Each app maps its own checks in a `checksFor` service. The lifecycle: each item's readiness for its current stage (Design's and Engineering's, worked out by those sections) and the Build and Test approvals. The Product section: the spec's seven readiness checks and the standards check. The Software Factory: each run's gates, the item's quality attributes against them (`QA-031-1`; one no gate checks is "not run", for a person) and each pull request's required tests. Infrastructure: INF-031's policy checks for Test, Staging and Production |
| Gathering | `src/services/checks.js` lists an item's checks with its stories' and pull requests', gives each a stable id, keeps the last results (`data/checks/<item>.yaml`) and emits `check.recorded` for new or changed ones (Activity leaves those out). An app that isn't running, or fails, is named |
| Overriding one check | A failing readiness check can be overridden by a person with a reason (any access role but Viewer): it holds for that stage, the check and the readiness show "overridden by Thabo N.: …", the stage's decision no longer waits on it, `check.overridden` is emitted and audited. Other kinds are their own app's to decide, and say so. An agent is refused, audited |
| The trace | Each app's `trace` service gives its nodes and links: the Product section goals (`GOAL-031-1`), ADRs, quality attributes; the Design section business requirements (to the goal they quote), features, stories, acceptance criteria (`AC-031-1-1`), interfaces; the Test section test cases (to what they verify); the lifecycle stories, work items, pull requests and the `links` items keep in their front matter (the seed's `slots-api-482` now says it delivers STORY-031-2); the Factory runs; Infrastructure designs. `src/services/trace.js` keeps the index (`data/trace/index.yaml`), built again when anything changed since or when it is missing; `npm run trace:rebuild` compares it with a fresh build |
| The item page | Tabs **Overview · Checks · Trace**. Checks: grouped by kind, each check in words with its subject, source, what verifies it and its evidence (a link where there is one), and Override (a reason) on a failing readiness check. Trace: the missing links, coverage in words, and the tree from the item down to the pull requests |
| Overview | The **Learn** arrow under the line: incidents, SLO breaches, failing synthetic checks, support tickets and goal results come back to Discover as signals |

## The test script

Run in the real app by `test/checks-and-trace.test.js`, every step passing, with the Factory and Infrastructure hosted
(STORY-031-1 through Engineer and Build to Lerato's Build approval; STORY-031-2 handed to Engineer):

1. PRD-031 · Checks: 6 kinds in one list, every check in the one shape with a source and evidence: the spec's
   "Rollout plan missing" (Product section), Design's checks (PRD-031), Engineering's (STORY-031-2's "criteria-ready",
   failing), the standards check, QA-031-1 "Latency (p95 < 300 ms): no gate checks it …", the `test` gate on the run,
   the required tests ("9 of 10 required tests present (TC-031-1-4 missing)"), "Build approval given by Lerato M.", the
   Test approval waiting, INF-031's "Cache tier above Test default" (a warning). `check.recorded` for each.
2. Thabo overrides STORY-031-2's failing "criteria-ready" with a reason: the check passes, "overridden by Thabo N.: …",
   the sign-off's readiness no longer lists it, the audit log has `check.overridden`. A policy check can't be
   overridden here (`not_overridable`).
3. PRD-031 · Trace: PRD-031 → GOAL-031-1 → BR-031-01 → STORY-031-1 → AC-031-1-1 → TC-031-1-1; STORY-031-1 → its work
   item → its run → PR-031-1-1; PRD-031 → BR-031-05 → STORY-031-2 → `slots-api-482`; INF-031, ADR-014, QA-031-1 there
   too. Missing: "AC-031-2-1 has no test"; "1 of 3 acceptance criteria has a test".
4. `data/trace/` deleted: the Trace tab is identical, and the index is written again. `npm run trace:rebuild` (run on
   the test's data folder) prints "0 differences" and exits 0.
5. An agent is refused an override (`people_only`), audited; the check is unchanged.

The roadmap's step 3 named "AC-031-04-2 has no test" (a criterion of a requirement): there are no requirements
(`REQ-…`) until Phase 18, so criteria are the stories' (`AC-031-2-1`).

## Tests

- New in the host: `test/checks-and-trace.test.js` (5: the test script), `test/services/checks-trace.test.js` (3: the
  gathering, `check.recorded` and the override rules; the trace index deleted and stale; the tree and gaps),
  `test/lifecycle/checks.test.js` (2: readiness checks and one override, refusals; the lifecycle's trace).
- New in the Factory: `test/services/evidence/checks.test.js`, `product/test/services/checks-trace.test.js`,
  `design/test/trace.test.js`, and a test in `quality/test/analysis.test.js`. In Infrastructure:
  `test/checks-trace.test.js`.
- **Whole suites:** host 369 of 369 pass (359 before this phase). Factory 580 of 584 pass, 4 skipped, none failing
  (576 of 580 before). Infrastructure 47 of 47. No test that passed before fails.

## Decisions taken while building

- **Which readiness a check is.** The lifecycle reports each item's readiness for its current stage, except the spec's,
  which the Product section reports itself (the same facts), so a check is never listed twice.
- **The trace's tree** puts each node once, under its best parent (a story under the requirement it serves, not under
  the item); other links are said beside it ("also serves BR-031-02").
- **The index** is rebuilt when any event (but noise: `check.recorded`, the clock, sessions) has happened since; after a
  restart, the first view builds it again.
- **`FACTORY_SCHEDULE=off`** keeps a Factory that `npm run trace:rebuild` starts from working the queue; the script can
  run while NooblyJS runs on the same data folder.
- **Errors from another module keep their own code** in NooblyJS's error answers (`people_only`, `not_overridable`).

## Open questions

1. **`check.recorded` is emitted by NooblyJS when it gathers checks** (on reading an item's checks), not by each app as
   its checks run. Should the apps emit it themselves (they'd need to keep their checks as records)?
2. **Only readiness checks can be overridden here.** Should a quality-attribute gate, or a warning policy, be
   overridable from the item too (it would be the owning app's decision)?
3. **Approvals as checks** (`approval`) is a kind the root design did not list. Keep it?
4. Not looked at in a browser here: the Checks and Trace tabs and the Learn arrow. The test reads their APIs; the e2e
   specs were not run.

## Guide points (roadmap)

Is the Trace tab something people will open?
