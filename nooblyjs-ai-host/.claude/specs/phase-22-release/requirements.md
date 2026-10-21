# Phase 22 — Release (new app: Operations, part 1): requirements

> **Status: built 2026-10-21, waiting for review.** Summary: `.claude/phases/phase-22-summary.md`. Root `product.md`
> §3.7, `design.md` §9; root `roadmap.md` Phase 22 (Infrastructure I10).

> Asked 2026-10-21: "Yes please commit, push and start the next phase" (Phase 21 committed as `6603446`).

Goal: production changes only through a release with evidence, two approvers, a rollout plan and a rollback.

## Decisions taken before starting (2026-10-21, the defaults)

- **Who owns releases** (root `product.md` §9 Q1): **Operations**, the new hosted app `nooblyjs-ai-operations` at
  `/operations` (rail label Ops, icon `upload`, after Security) `[CONFIRM]`. Infrastructure owns the environments and
  refuses any change to Production that isn't a release's (I10); the lifecycle engine owns the `deploy` approval.
- **The rollout strategy** `[CONFIRM]`: a pilot of 10%, then everyone (`policies.yaml`), a person moving it on. Other
  strategies (store pilot, feature flag) wait for the feature-flag tool `[PLACEHOLDER]`.
- **The deploy approval** is the lifecycle's `deploy` rule (two different people with `deploy-production`), opened by
  Operations on the release (`ref: { app: operations, id: REL-001 }`), so it is decided on Home · Approvals. Whoever
  gives one, for themselves or on someone's behalf, holds `deploy-production`; an agent never.
- **The risk threshold** `[CONFIRM]`: a release can't ask for its approval (or be approved) while an open finding of
  its item or stories is high or critical with no accepted risk.
- **What a release deploys**: what the product's Staging runs (the last environment before Production on its path);
  its rollback is what Production runs now.
- **The deployer adapter** is Operations' (`OPERATIONS_DEPLOYER`, only `mock`): it applies each step through
  Infrastructure, which checks the release's approval itself. The percentage is recorded, not enforced.
- **Release notes** are drafted by the release agent, Pip Okafor (Digital Teammates, `release-notes`), and drafted
  again with the fresh evidence when the approval is asked for.
- **Jira and Bitbucket**: the release's fix version (the spec's Jira project) and a tag per repository
  (`slots-1.0.0`) go through NooblyJS's write gate as Operations, new kinds `jira.fix-version` and `bitbucket.tag`;
  recorded, not sent, while the gate is closed.
- **The feature goes to Operate** when its release is first deployed (the lifecycle's `featureDeployed`).

## R1 — The hosted app
Releases, Deployments, Policies; passes the hosted-app checklist; standalone with `npm start` (port 11010).

## R2 — A release
One feature, once all its stories passed Test: version, evidence pack (merged pull requests with their Build and Test
approvals, tests, open and accepted findings, SBOM), release notes, rollout and rollback plans.

## R3 — The deploy approval
Two different people; an open finding at or above the threshold needs an accepted risk first.

## R4 — The deployer
Mock first, through Infrastructure; the next step; rollback in one action, with a reason.

## R5 — Jira and Bitbucket
The fix version and the tags as recorded writes through the gate.

## Test script (roadmap Phase 22)
1. Release the slot-booking feature ("Slots 1.0") once its stories have passed Test: the evidence pack lists tests,
   scans and approvals, while PRD-031's other feature is still in Build.
2. One approval isn't enough; the second deploys to a 10% pilot; Activity shows each step.
3. Roll back: the environment returns to the previous version and the release says why.
4. A release with an open high finding is refused until a risk is accepted.
5. Try to apply to `prod` without a release: refused by Infrastructure, audited.

**Done when:** steps 1–5 pass and `nooblyjs-ai-operations` passes the hosted-app checklist.
