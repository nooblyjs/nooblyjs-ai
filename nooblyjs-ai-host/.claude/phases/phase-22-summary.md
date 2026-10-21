# Phase 22 — Release (new app: Operations, part 1): summary

**Status:** done (built and reviewed 2026-10-21) (started at your word, with the defaults, after Phase 21 was
committed as `6603446`). Spec: `.claude/specs/phase-22-release/` (all 8 tasks done). Root `product.md` §3.7 and roadmap
I10 are what it builds. The work is the new hosted app `nooblyjs-ai-operations` (at `/operations`, rail label Ops),
Infrastructure (I10: Production only through a release), the lifecycle engine (a release's `deploy` approval, the
feature to Operate), NooblyJS's write gate (the release's Jira fix version and Bitbucket tags) and Security (the SBOM a
release carries).

## What is there

| Area | What |
| --- | --- |
| The app | Releases, a release, Deployments, Policies; standalone with `npm start` (port 11010); passes the hosted-app checklist (`test/register.test.js`, `test/public/module.test.js`), built from Security's skeleton |
| A release | `REL-001`: one feature, once all its stories passed Test (refused otherwise, naming the story behind); what the product's Staging runs goes to Production; the evidence pack (merged pull requests with who gave their Build and Test approvals, each story's coverage and latest Build-level run, the environment runs, open and accepted findings, the SBOM); release notes by the release agent (Pip Okafor, a teammate task); the rollout (10% pilot, then everyone) and the rollback (what Production runs now) |
| The deploy approval | The lifecycle's `deploy` rule (two different people with `deploy-production`), opened by Operations on the release and decided on Home · Approvals; Operations checks each decision (deploy-production for whoever gives it, even on someone's behalf; never an agent; still no open high finding). An app's `deploy` approval moves no stage |
| The risk threshold | Asking for the approval is refused while an open high or critical finding of the item or its stories has no accepted risk, naming it; the notes are drafted again with the fresh evidence when it is asked for |
| The deployer | `OPERATIONS_DEPLOYER`, only `mock`: each step goes through Infrastructure's `deployRelease`, which checks the release's approval in the lifecycle before Production changes; the next step and rollback (with a reason) by a person with `deploy-production`. The second approval deploys the pilot, and the feature's stories go to Operate |
| Infrastructure (I10) | `deployRelease`, `rollbackRelease`, `releaseCandidate`; `POST /environments/:name/deploy` is refused and audited (`deploy.refused`): Production through a release, the others by promotion |
| Jira and Bitbucket | New write kinds `jira.fix-version` and `bitbucket.tag`, asked for by Operations only, for a release two people approved; recorded, not sent, while the gate is closed |

## The test script

Run in the real app by `test/release.test.js` (the Factory, Teammates, Infrastructure, Security and Operations
hosted), every step passing. STORY-031-1 is built, approved and merged as in Phase 16e; STORY-031-2's run fails its hold
test (Phase 20), so FEAT-031-2 is still in Build.

1. FEAT-031-2 can't be released (`feature_not_ready`). "Slots 1.0" (`REL-001`, 1.0.0) releases FEAT-031-1 to `prod`:
   its evidence has PR-031-1-1 merged by Lerato with the Build approval (Lerato) and the Test approval (Naledi),
   STORY-031-1's latest run, the open FND-001 (high) and web-storefront's SBOM; the rollout is "10% pilot, then
   Everyone" and the rollback "Return prod to web 4.11.2 in one action".
4. Asking for the deploy approval is refused: FND-001 (High) is open with no accepted risk. Thabo (Architect) can't
   accept a high risk; Stevie (Owner) accepts it for 14 days; asked again, the release waits for two approvers and its
   notes list the accepted risk.
2. Priya can't approve, even for Lerato (403, audited). Lerato's approval is one of two (pending); she can't give the
   second as well (`already_given`). Thabo's deploys the 10% pilot: Production runs Staging's versions, STORY-031-1 is
   in Operate, the web-storefront tag is recorded at the write gate, and Activity has each step (release made, approval
   asked for, both decisions, the deploy).
3. Lerato rolls it back ("Slot list p95 doubled in the pilot stores"): `prod` runs web 4.11.2 again and the release says
   who and why.
5. Applying to `prod` without a release is refused (`release_only`) and audited; a deploy with another release's or no
   approval is refused by Infrastructure itself.

## Tests

- New: `nooblyjs-ai-operations` (18 tests); the host's `test/release.test.js` (5); Infrastructure's
  `test/releases.test.js` (2).
- Changed: the devtools tests that list the write kinds (two new kinds, each a POST that makes something new).
- **Whole suites:** host 408 of 408 (403 before this phase). Factory 594 of 598, 4 skipped, none failing. Infrastructure
  52 of 52 (50). Security 21 of 21. Operations 18 of 18.

## Decisions taken while building

- **Deciding a deploy approval needs `deploy-production`**, also on someone's behalf (Phase 16b lets anyone but a
  Viewer decide for a reviewer); Operations checks it on every relayed decision.
- **The notes are drafted again** when the approval is asked for, so they say what the approvers see.
- **The feature goes to Operate at the first deploy** (the pilot), not when everyone has it.
- **The tag is named `<product>-<version>`** (`slots-1.0.0`), on each repository's merged commit.

## Open questions (defaults taken, `[CONFIRM]`)

1. Who owns releases: Operations (the default here).
2. The rollout: a 10% pilot, then everyone; the feature-flag tool is `[PLACEHOLDER]`.
3. The risk threshold: high and critical need an accepted risk.
4. Is two approvers the right friction for every product (the roadmap's guide point)?
5. The Jira fix version needs the spec's Jira project and that project in the write gate's configuration; with neither,
   only the tags are asked for.
6. Not looked at in a browser here: the four Operations pages. The tests read their APIs and check the module.
