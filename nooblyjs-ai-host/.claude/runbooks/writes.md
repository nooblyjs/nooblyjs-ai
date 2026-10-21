# Writing to Jira and Bitbucket

Jira and Bitbucket are production systems. NooblyJS writes to them only when **all three** are true:

1. the deployment allows it: `DEVTOOLS_WRITES=true` in `.env`;
2. an Owner switched that system to **Send** in Platform · Settings · Integrations;
3. that system's write token is set (`JIRA_WRITE_API_TOKEN`, `BITBUCKET_WRITE_API_TOKEN`). The read tokens are never
   used to write.

Otherwise NooblyJS is in **Record only**: it does everything except send, and keeps what it would have sent in the
**Outbox** on the same screen.

## What NooblyJS can write (and nothing else)

| Write | When | Default rule |
| --- | --- | --- |
| Create a Jira issue | One per work item, when a person approves a handoff | Automatic (the handoff's approval covers it) |
| Move a Jira issue | To In Progress when a run starts; to Done when its pull request is merged. Never backwards | Automatic |
| Comment on a Jira issue | When a pull request opens for it | Automatic |
| Push a factory branch | A `factory/…` branch, where Platform · Repositories gives agents **Read + open PRs** | Automatic |
| Open or update a pull request | From that branch to the repository's main branch, with its default reviewers | Automatic |

An Owner can set any of them to **Needs approval** (an Approver decides each one on Home · Approvals) or **Off**.
NooblyJS has no write that merges, deletes, declines or changes a setting. A person merges in Bitbucket.

## Switch writing on for the first time

Do this on a **test Jira project and a scratch repository** first.

1. Create the two write tokens, each limited to the projects and repositories NooblyJS works on. Put them in `.env` with
   `DEVTOOLS_WRITES=true`. Restart NooblyJS.
2. Platform · Settings · Integrations still says **Record only** for both. Approve a handoff on a test item and read
   the Outbox: each line says what NooblyJS **would** send. Check the project, the issue titles and the repository.
3. Set the rule of each kind to **Needs approval** for the first week, if you want a person to see every write.
4. Press **Switch to Send** for Jira, read what it says, and confirm. Press **Send now** on one recorded line. Open
   the issue it made in Jira.
5. Do the same for Bitbucket with one Software Factory run on the scratch repository.
6. Platform · Audit log has `devtools.write_mode_changed` and a `devtools.write_sent` for each write.

## Switch writing off, quickly

Any one of these stops every write at once; NooblyJS goes back to recording:

- Platform · Settings · Integrations → **Switch to Record only** (per system; no restart), or
- remove `DEVTOOLS_WRITES=true` from `.env` and restart, or
- revoke the write token in Atlassian (see [tokens.md](tokens.md)).

Nothing already sent is undone: fix it in Jira or Bitbucket, where its history is.

## Read the outbox

| State | Meaning | What to do |
| --- | --- | --- |
| Recorded, not sent | A lock was closed. The line says which | **Send now** once the locks are open, or **Discard** |
| Waiting for approval | Its kind needs an Approver | Decide it on Home · Approvals |
| Sent | Done; the line links to the issue or pull request | — |
| Failed | Jira or Bitbucket refused or did not answer. The reason is on the line | Fix the cause, then **Send now** |
| Refused | NooblyJS would not send it (not a factory branch, agents may not open pull requests there, the issue is not linked) | Read the reason; change Platform · Repositories if that is what it says |
| Discarded | A person said no | — |

The same write is never sent twice: each has a key, and a retry of a sent one does nothing.
