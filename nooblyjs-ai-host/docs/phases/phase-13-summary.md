# Phase 13 — Writing to Bitbucket and Jira, and production readiness: summary

**Status:** built 2026-10-11, waiting for your review. Spec: `.claude/specs/phase-13-writing-and-readiness/` (all 10
tasks done). Work is in `nooblyjs-ai-host` and `nooblyjs-ai-factory` (the Bitbucket forge).

**Nothing was written to the real Jira or Bitbucket.** Every test uses a fake `fetch` and a git repository on disk,
there is no live write test, and NooblyJS itself records writes instead of sending them until you allow it.
Targetprocess is removed, as you asked.

## What is there

| Area | What |
| --- | --- |
| The write gate | One door for every write (`src/services/devtools/writes.js`). It sends only when the kind exists, the asker is NooblyJS itself (never an agent), the facts hold, the kind's rule allows it, and **three locks** are open: `DEVTOOLS_WRITES=true`, an Owner switched that system to **Send**, and a **write token** is set (separate from the read tokens). Otherwise the write is **recorded** in the outbox. Every attempt is audited |
| What NooblyJS can write | Create a Jira issue, move one, comment on one; push a `factory/…` branch, open a pull request, update one. **Nothing that merges, deletes, declines or changes a setting exists**, and a test reads the source to keep it that way |
| Jira | An approved handoff creates one issue per work item, once, and links it. NooblyJS reads the issues back every 5 minutes (and on request) and shows each work item's status. It moves an issue forward only for a run that started or a pull request that was merged, never backwards; when a person moved it back, Jira wins and NooblyJS says so |
| Bitbucket | The Software Factory's new Bitbucket forge holds no token and asks NooblyJS, which pushes the branch and opens the pull request with the repository's default reviewers, only where Platform lets agents open pull requests. NooblyJS shows each pull request's checks and reviewers |
| Ship | When **people** have merged every work item's pull request in Bitbucket, the item moves Build → Ship, recorded as "merged in Bitbucket by …". A merge by NooblyJS's own account does not count. NooblyJS never merges |
| Rules per kind | Automatic, **needs approval** (an Approver decides each one on Home · Approvals), or off. An Owner sets them |
| Screens | Platform · Settings · Integrations: Record only or Sending per system, the rule per kind, and the outbox with **Send now** and **Discard**. The item page: its work items with their Jira issue and pull request |
| Backup and restore | `npm run backup` (dated copy with a manifest of every file's hash; nightly when `BACKUP_DIR` is set). `npm run restore -- <name>` into an empty folder, verified file by file and against the audit log |
| Performance | `npm run perf`: NooblyJS on ten times the seed volume, timing the key pages' APIs |
| Security review | `docs/security/phase-13-review.md`: what was checked, one fix (`/healthz` no longer reveals the data folder's path), and what remains |
| Runbooks | `docs/runbooks/`: start and stop, backup and restore, writing to Jira and Bitbucket, a stuck sync, a leaked token, a budget that stops work |

## Test script result (roadmap Phase 13)

| Step | Result |
| --- | --- |
| 1. A handoff creates Jira issues, and moving one in Jira updates the item in NooblyJS (and the reverse) | **Pass offline**, through the real app with a fake Jira: six issues for the seed's handoff, a status change in Jira reaches the work item and Activity, a started run moves its issue to In Progress. **Not run against your Jira** |
| 2. A PR opened by the factory on a real repo shows its checks and reviewers, and merging it in Bitbucket moves the item to Ship | **Pass offline**: pushed to a git repository on disk and opened against a fake Bitbucket, with default reviewers, checks and reviewers shown, and the item moving to Ship when people merged all six. **Not run against your Bitbucket**; no real Factory run has delivered through the new forge end to end |
| 3. Restore `data/` from last night's backup into a fresh install; everything is back and the audit log is intact | **Pass, for real** on this machine: a used NooblyJS backed up, restored into an empty folder, NooblyJS started on it, the item and the audit log compared |
| 4. Load 10× the seed volume; the key pages load in under 1 s | **Pass, for real**: 14 pages, the slowest 141 ms (Home · Metrics). The seed is small (0.4 MB, 3.2 MB at 10×), so this shows there is headroom, not what a year of real use looks like |

**Done when steps 1–4 pass and the pilot squad signs off:** not yet. Steps 1 and 2 against the real systems, and
the pilot, are yours.

Tests: `npm test` 289 of 289. New: `test/services/devtools-writes.test.js` (17), `devtools-writes-closed`, `-api`
and `-approval` (7, through the real app), `test/backup.test.js` (3), two browser tests in `devtools.spec.js`
(with axe and phone width), and `nooblyjs-ai-factory/test/services/forge/bitbucket.test.js` (4).

## Decisions

Confirmed by you on 2026-10-11:

1. **NooblyJS owns the lifecycle; Jira owns each issue once it exists.** NooblyJS never overwrites a status a person set.
2. **A handoff's approval covers creating its issues.** No second approval unless you set that kind to "needs approval".
3. **A merge in Bitbucket by people moves the item to Ship** with no approval in NooblyJS: the merge is the decision.

Still for you to confirm:

4. **Jira is polled every 5 minutes**, not sent webhooks (a webhook needs a public address).
5. **Separate write tokens.** The read tokens you have are never used to write.
6. **New Jira issues are Stories** in the project of the item's linked issues, else the first configured project (`DTE`).

## To run steps 1 and 2 for real (your steps, on a test project and a scratch repository first)

1. Make two write tokens limited to those, and set `DEVTOOLS_WRITES=true`, `JIRA_WRITE_API_TOKEN` and
   `BITBUCKET_WRITE_API_TOKEN` in `.env`.
2. Leave both systems on **Record only**, approve a handoff, and read the outbox: it says exactly what would be sent.
3. Switch Jira to **Send** and press **Send now** on one line. Then Bitbucket. `docs/runbooks/writes.md` has each step.

## What is not done, and what I found

- The real-system run and the pilot's sign-off.
- **Not tested: a real Software Factory run delivering through the Bitbucket forge.** The forge, the gate and the
  intake's choice of forge are each tested; the whole chain with a real run is not.
- The exact scope names for the write tokens are not confirmed.
- Found: the old standalone wiki's `/api/auth/identity` trusts any email it is sent. NooblyJS does not serve it; the
  standalone wiki does wherever it still runs (`docs/security/phase-13-review.md`).
- Google Drive / SharePoint and Datadog were removed from Platform · Integrations on 2026-10-11, as you asked:
  nothing was built for them.
- Pre-existing, not from this phase: one Windows path failure in the Factory's local forge test, and two in Teammates.
