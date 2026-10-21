# Phase 22 — Release (new app: Operations, part 1): design

> **Status: built 2026-10-21, waiting for review.** Requirements: `requirements.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-operations/` | The new hosted app (from Security's skeleton): `index.js`, `server.js`, `src/services/releases.js` (create, approval, decide, deploy steps, advance, rollback), `evidence.js`, `notes.js`, `policies.js`, `src/deployers/` (mock), pages Releases, a release, Deployments, Policies |
| `nooblyjs-ai-infrastructure/src/services/releases.js` | I10: `deployRelease` (checks the release's approval), `rollbackRelease`, `candidate`, `refuseDirect` (`POST /environments/:name/deploy`) |
| `nooblyjs-ai-host/src/lifecycle/services/engine.js` | `deploy` may be an app's approval (`ref.app`): the app decides it first; no stage moves |
| `…/pull-requests.js` | `featureDeployed`: the feature's stories Release → Operate |
| `…/src/services/devtools/` | Kinds `jira.fix-version`, `bitbucket.tag`; their fact (an approved release); `release.record` |
| `nooblyjs-ai-security/src/services/scans.js` | The scans log keeps each SBOM; `sbomFor({ itemIds })` |

## The data

```
data/operations/releases/REL-001.md
  name, version, product, itemId, featureId, stories, deploys, previous, production, rollout { steps }, rollback,
  evidence { pullRequests, approvals, tests, findings, sbom, text }, notes { text, draftedBy },
  status: draft | waiting-approval | changes-requested | piloting | complete | rolled-back, approvalId,
  deployments [{ at, step, label, percent, environment, deployed, by } | { rolledBack, reason }], writes, history
data/infrastructure/environments/prod.md   rollout { releaseId, percent, approvalId, previous }, releases [...]
```

## Events

`release.created`, `release.approval_requested`, `release.refused`, `release.deployed`, `release.rolled_back`,
`environment.deployed`, `environment.rolled_back`, `environment.deploy_refused`, `feature.deployed`.
