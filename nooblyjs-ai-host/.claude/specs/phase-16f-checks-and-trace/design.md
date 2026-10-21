# Phase 16f — One shape for checks, and the trace: design

> **Status: done, signed off 2026-10-21** (built 2026-10-21). Requirements: `requirements.md`. Summary: `.claude/phases/phase-16f-summary.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-host/src/services/checks.js` | Gathers an item's checks from every app's `checksFor`, gives each its id (`chk_` + a hash of its system, kind, subject and key), keeps the last results (`data/checks/<item>.yaml`) and emits `check.recorded` for new or changed ones; the override of a readiness check |
| `nooblyjs-ai-host/src/services/trace.js` | Builds an item's trace from every app's `trace`, keeps `data/trace/index.yaml`, the tree, the gaps and coverage (`shape`, pure); `rebuild()` for `npm run trace:rebuild` (`scripts/trace-rebuild.js`) |
| `nooblyjs-ai-host/src/lifecycle/services/checks.js` | The lifecycle's checks (readiness per current stage, Build and Test approvals), `overrideCheck`, its trace (stories, work items, pull requests, front-matter `links`), `familyOf` |
| `nooblyjs-ai-factory/product/src/services/checks-trace.js` | The spec's readiness and the standards check; goals, ADRs, quality attributes |
| `nooblyjs-ai-factory/design/src/services/trace.js` | Business requirements → goals, features, stories, acceptance criteria, interfaces |
| `nooblyjs-ai-factory/quality/src/services/analysis.js` `trace` | Test cases → what they verify |
| `nooblyjs-ai-factory/src/services/evidence/checks.js` | Each run's gates, the quality attributes against them, the required tests; runs → work items |
| `nooblyjs-ai-infrastructure/src/services/checks-trace.js` | The designs' policy checks per kind of environment; the designs |
| `nooblyjs-ai-host/public/js/pages/home/item.js`, `overview.js` | The item page's Checks and Trace tabs; the Learn arrow |

## The shape

```
{ id, key, kind: readiness | approval | standard | gate | test | policy, subject: { item, ref }, definedBy: { system, ref },
  verifiedBy, severity: blocking | warning, result: passed | failed | warning | not-run, text, evidence: { system, ref, summary },
  override: { by, byName, reason, at }, overridable, at }
```

`approval` is a kind the root design did not list: a Build or Test approval is a person's check of a pull request.

## Links

| From | rel | To | Kept by |
| --- | --- | --- | --- |
| GOAL-031-1 · QA-031-1 · ADR-014 | goal-of · quality-attribute-of · decides | PRD-031 | Product section |
| BR-031-01 | derives-from | the goal it quotes (else the item) | Design section |
| FEAT-031-1 · IF-031-01 | feature-of · interface-of | PRD-031 | Design section |
| STORY-031-1 | builds · serves | FEAT-031-1 · BR-031-01 … | Design section |
| STORY-031-1 | story-of | PRD-031 | lifecycle |
| AC-031-1-1 | criterion-of | STORY-031-1 | Design section |
| TC-031-1-1 | verifies | AC-031-1-1 (or IF-031-01, or the story) | Test section |
| WI-STORY-031-1-1 | implements | STORY-031-1 | lifecycle (the handoff) |
| run | runs | WI-STORY-031-1-1 | Software Factory |
| PR-031-1-1 | delivers · opened-by | WI-STORY-031-1-1 · run | lifecycle |
| slots-api-482 | delivers · for | STORY-031-2 · PRD-031 | lifecycle (its front matter `links`) |
| INF-031 | infrastructure-for | PRD-031 | Infrastructure |

The tree puts each node once, under its best parent (the order of `PARENT_RELS` in `trace.js`), children drawn goals
first. Gaps: a goal with no business requirement, a business requirement with no story, a criterion with no test, a
test case verifying nothing, a link to a node that is not there.
