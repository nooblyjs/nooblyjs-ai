# Phase 16e — Build and Test: design

> **Status: built 2026-10-21, waiting for review.** Summary: `.claude/phases/phase-16e-summary.md`. Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-factory/src/services/pull-requests/` | `evidence.js` (the required tests of a commit: present, passing, missing), `bridge.js` (a delivered run → the lifecycle's pull request; changes asked for → repair; a pushed commit → checked again; Merge), `views.js` (the route table rows: Pull requests, a pull request, decisions, Merge, Test approvals) |
| `nooblyjs-ai-factory/src/services/line/stations/deliver.js`, `evidence/bundle.js` | The required tests in the PR evidence and in the deliver result |
| `nooblyjs-ai-factory/src/services/intake/handoff.js`, `hosted.js` | The run carries its test cases; the issue asks for tests named by id |
| `nooblyjs-ai-host/src/lifecycle/services/pull-requests.js` | Pull requests as lifecycle items: record (and a new commit clears), after a decision (move, open the Test approval, send back), merge check and merged, merged outside, the story following its pull requests, a feature to Release |
| `nooblyjs-ai-host/src/lifecycle/services/engine.js`, `config.js`, `index.js` | The hooks, the `test` readiness of a pull request, the services |
| `nooblyjs-ai-host/src/services/devtools/sync.js` | A Bitbucket merge of a work item that is a lifecycle pull request |
| `nooblyjs-ai-host/src/services/metrics/` | `ask`/`decide` facts carry the approval type; the pull requests waiting on each approval, with their age |
| `nooblyjs-ai-host/src/services/for-you.js` | The Developer and Test analyst homes' pull requests |

## The data

```
data/workflows/items/PR-031-1-1.md   { id, type: pr, ref: 'web-storefront PR-031-1-1', title, system: factory, parentId: STORY-031-1,
                                       feature, stage: build | test, status: active | completed, team, owner,
                                       pr: { runId, workItemId, repo, head, sha, forge: local | bitbucket, href, draft, checking,
                                             gates: passed | failed | none, evidence: { required, present, passing, missing: [id],
                                             failing: [id], text, cases: [{ id, title, level, found: [file:line], status }],
                                             manual: [{ id, title }] } },
                                       mergedAt, mergedBy, mergedEarly }
data/workflows/approvals/<id>.md     build-approval and test-approval on the pull request, with `sha` (the commit) and
                                     `link` (its page); status cleared (an approved one a new commit cleared)
data/workflows/items/STORY-….md      passedTestAt, the history's kind: pull-requests | feature
```

## Flow

```
run delivers (run.finished, a pr, request.noobly.itemId a story)
  └─ bridge.record(run) ─► workflows.recordPullRequest(facts)
        new item, or a new sha: clear approvals; back to Build; open the Build approval (not while checking, not a draft)
Build approval: approve ─► PR to Test, open the Test approval     ask for changes ─► approval.decided
Test approval:  approve ─► ready to merge                         send back ─► PR to Build, approval.decided
approval.decided (changes-requested, a PR with a run) ─► bridge: pr.changes_requested + requeue from repair ─► new sha
pushed commit (a local PR branch moved) ─► recordPullRequest(checking) clears; repair.attempted(trigger push) + requeue
                                           from verify ─► run.finished ─► record with the evidence
Merge ─► workflows.canMerge ─► forge.merge (local) ─► workflows.pullRequestMerged ─► story follows ─► feature
```

## The story and the feature

`followPullRequests(storyId)`: Build while any pull request of the story is in Build or a run of the story without a
pull request is queued, running or parked; Test when every active pull request is in Test; done when all are merged
(`passedTestAt`; the story stays in Test). Then `releaseFeature`: when every story of the same item and feature has
passed Test, each moves to Release (history kind `feature`), `feature.in_release` is emitted, and the item follows its
stories. Nobody decided these moves: they are on record (history, audit) and emit no stage event, like 16c's.

## Readiness of a Test approval

`readiness.yaml` `pull-request` (not a stage; built in for older folders): `required-tests` (every required test present
and passing), `gates-passed` (the gates passed on this commit). Worked out from the pull request's evidence. Anything
else in Test keeps Test's own checks (or Verify's, in a folder from before), as in Phase 16b.

## Events

Lifecycle: `pr.recorded` (a pull request recorded or given a new commit), `approval.cleared`, `pr.merged` (by a person,
with who), `pr.merged_early` (a Bitbucket merge without both approvals), `story.passed_test`, `feature.in_release`.
Payloads of a pull request's item events carry `itemType: 'pr'`, which Metrics leaves out of lead time. The Factory's
log: `pr.changes_requested` and `run.merged` (existing), `repair.attempted` with `trigger: push`.
