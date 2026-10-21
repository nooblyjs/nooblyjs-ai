# Phase 13 — Writing to Bitbucket and Jira, and production readiness: requirements

> **Status: built 2026-10-11, waiting for review.** Summary: `.claude/phases/phase-13-summary.md`.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Source: `.claude/steering/roadmap.md` Phase 13, `product.md` §3 and §9, `tech.md` §8a.
> Goal: NooblyJS syncs with the systems teams already use and is ready for a pilot squad.
> Targetprocess was removed from NooblyJS's scope on 2026-10-11 (Stevie): it is taken out of the docs, the
> Integrations list and the onboarding copy, and nothing is built for it.

## The safety rule for this phase

**Jira and Bitbucket are production systems.** Until now NooblyJS could only read them: `transport.js` can only GET.
This phase builds the code that writes, and that code must not write by accident:

1. **Nothing in the build or its tests sends a write.** Every test uses a fake `fetch` and a temporary git remote on
   disk. There is no live write test. The existing live check (`npm run test:live:devtools`) stays read only.
2. **Writes are off until two people-controlled locks are open.** A deployment must set `DEVTOOLS_WRITES=true`,
   **and** an Owner must switch each system from *Record only* to *Send* in Platform · Settings · Integrations
   (audited). With either lock closed NooblyJS works in **record only**: it does everything except send, and keeps what
   it would have sent in the outbox for a person to read.
3. **One door.** Every write goes through one function (`devtools.writes.send`) that checks the kind, the mode, the
   rule and the actor, records it in the outbox and the audit log, and only then calls a writer that can send only
   the listed kinds to the listed paths. There is no kind for merging, deleting, or changing permissions.

## Where the phase starts

- **Reading works** (Phase 11): `host.service('devtools')` reads repositories, files, Jira issues and projects, and
  links Jira issues to NooblyJS items, ideas and work items (`data/devtools/links.yaml`).
- **A handoff makes work items** (`WI-PRD-031-1`, with a repository and a title) and the Software Factory turns each
  into a run on a repository from `data/factory/repos.yaml`. A finished run opens a "pull request" on the Factory's
  **local** forge (a file on disk). It has a GitHub forge from before NooblyJS; none for Bitbucket.
- **Platform decides** whether agents may open pull requests on a repository (`checkAgentWork`, needs `openPrs`).
- An item in Build moves to Ship when a person presses **Approve & move**. Nothing in Bitbucket moves it.
- `data/` has no backup, no restore, no measured performance and no runbooks.

## Decisions taken before starting

**Confirmed by Stevie on 2026-10-11:** who owns what (NooblyJS the lifecycle, Jira each issue), the handoff's approval
covering issue creation, and a person's merge in Bitbucket moving the item to Ship. The rest stay `[CONFIRM]`. None
of them needs a write to a real system to build or test.

| Question | Answer |
| --- | --- |
| Source of truth (product.md §12 Q6) | **NooblyJS owns the lifecycle** (the item, its stage, approvals, the handoff). **Jira owns each issue once it exists**: its status, assignee and sprint. NooblyJS creates the issue and follows it; it never overwrites a status a person set in Jira |
| NooblyJS → Jira | (a) An approved handoff **creates one issue per work item** in the item's Jira project, linked to the work item. (b) NooblyJS **moves an issue forward** only for a fact it knows and Jira doesn't: a run started (→ the project's "In Progress" status), its pull request was merged (→ "Done"). (c) NooblyJS adds **a comment** with the link when a pull request opens |
| Jira → NooblyJS | NooblyJS reads the linked issues on a schedule (every 5 minutes, and on **Refresh**) and sets each **work item's status** from the issue's status category (To Do / In Progress / Done). When every work item of an item is Done in Jira the item shows "All work items done in Jira" on Home; it does **not** change stage by itself |
| When both changed | Jira wins for the issue's status. NooblyJS records `devtools.sync_conflict` in Activity and does not send its own transition |
| Approval rule per kind of write | `jira.create-issue`: covered by the **approved handoff** (no second approval). `jira.transition` and `jira.comment`: **automatic**, only from the facts above. `bitbucket.push-branch` and `bitbucket.open-pr`: only for the Software Factory, only where Platform gives agents **Read + open PRs** on that repository, only to a `factory/…` branch. An Owner can change a kind to **needs a person's approval** (an Approver decides it on Home · Approvals before it is sent) or **off** |
| Who may never write | An agent actor is refused every Jira write and anything on Bitbucket except the Factory's own branch and pull request. **No kind merges, deletes, force-pushes, or changes permissions or settings**, so NooblyJS cannot do those even with a token that could |
| Pull requests on Bitbucket | The Factory's control plane (never the agent) pushes the run's branch with NooblyJS's Bitbucket token and opens the pull request through `host.service('devtools')`, with the repository's **default reviewers**. The Factory holds no token. Record only: the branch is not pushed and the pull request is not opened; the run says so |
| Checks and reviewers | NooblyJS reads the pull request's state, its reviewers' approvals and the build statuses (Pipelines) on its head commit, and shows them on the item and the run |
| A merge in Bitbucket moves the item to Ship | When **a person** merges it in Bitbucket and every work item's pull request for the item is merged, NooblyJS moves the item Build → Ship, recorded as "merged in Bitbucket by <name>". A merge by the account NooblyJS's own token belongs to never moves an item (agents never approve) |
| Jira's webhooks | Not used: NooblyJS polls. A webhook needs a public address and a shared secret; polling needs neither `[CONFIRM later]` |
| Backup | `npm run backup` writes a dated archive of `data/` (a folder copy with a manifest of file hashes) to `BACKUP_DIR`; NooblyJS takes one each night when `BACKUP_DIR` is set, and keeps `BACKUP_KEEP` (14). `npm run restore -- <backup>` restores into an empty `DATA_DIR` and verifies every hash and the audit log's chain of days |
| Performance target | The key pages' APIs answer in under 1 s with 10× the seed volume `[CONFIRM target]`: measured by `npm run perf`, on a temporary `DATA_DIR` |
| Pilot squad and date | `[PLACEHOLDER]`: not needed to build. The pilot's sign-off is the phase's last step and is Stevie's |

## Requirements

### R1 — The write gate
1. Every write to Jira or Bitbucket SHALL go through one gate that refuses an unknown kind, a closed lock, a rule that is not met and an actor who may not, and SHALL record each attempt (sent, recorded only, waiting for approval, refused, failed) in the outbox and the audit log.
2. With `DEVTOOLS_WRITES` unset, or a system in *Record only*, nothing SHALL be sent.
3. The writer SHALL be able to send only the listed kinds, to the listed paths of the one origin, and SHALL have no way to merge, delete or change settings.
4. A kind set to *needs approval* SHALL wait for an Approver's decision in the lifecycle engine, and an agent SHALL never be able to give it.

### R2 — Jira
1. An approved handoff SHALL create one Jira issue per work item, once, and link it.
2. A change of a linked issue's status in Jira SHALL reach the work item in NooblyJS within the polling interval.
3. NooblyJS SHALL move an issue forward only for a run started or a pull request merged, and SHALL not send a transition when Jira's status has already moved on.

### R3 — Bitbucket
1. A Factory run on a Bitbucket repository SHALL push its branch and open (or update) one pull request with the default reviewers, through the gate, when Platform allows agents to open pull requests there.
2. The item and the run SHALL show the pull request's checks and reviewers.
3. A person's merge in Bitbucket SHALL move the item to Ship when all its work items' pull requests are merged. Agents SHALL never merge.

### R4 — Readiness
1. A backup SHALL restore into a fresh install with every file and the audit log intact, and say so.
2. The key pages SHALL answer inside the target at 10× the seed volume, and the check SHALL be repeatable.
3. A security review SHALL be written down with what was checked, what was fixed and what remains.
4. Runbooks SHALL cover starting and stopping, backup and restore, switching writes on and off, a stuck sync, a leaked token and a budget that stops work.

### R5 — Targetprocess
1. Targetprocess SHALL be removed from the product, the Integrations list, the configuration and the onboarding copy.

## Test script (roadmap Phase 13)

1. A handoff creates Jira issues, and moving one in Jira updates the item in NooblyJS (and the reverse).
2. A PR opened by the factory on a real repo shows its checks and reviewers, and merging it in Bitbucket moves the item to Ship.
3. Restore `data/` from last night's backup into a fresh install. Everything is back, and the audit log is intact.
4. Load 10× the seed volume. The key pages load in under 1 s `[CONFIRM target]`.

**Done when:** steps 1–4 pass and the pilot squad signs off. Offline, steps 1 and 2 pass against a fake Jira and
Bitbucket and a git remote on disk, and in record-only mode against the real ones (reads only). Steps 3 and 4 run
for real on this machine. **Sending to the real Jira and Bitbucket is Stevie's step**, on a test project and a
scratch repository first.

## Out of scope

Targetprocess. Jira webhooks. Creating Jira projects, sprints or boards. Editing an issue's description after it is
made (the Edge extension, Phase 14, lets a person do that). Merging from NooblyJS. Bitbucket Pipelines configuration.
Mirroring threads to Teams channels.
