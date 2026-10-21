# NooblyJS runbooks

What to do, step by step, when NooblyJS is running for a team. Each one says what you will see, what to do, and how to
check it worked. Commands run from the `nooblyjs-ai-host` folder. Settings are in `.env` (see `.env.example`).

| Runbook | When |
| --- | --- |
| [Start, stop and check NooblyJS](start-stop.md) | Every day; after a server restart |
| [Back up and restore](backup-restore.md) | Nightly (automatic); before an upgrade; after data is lost or damaged |
| [Writing to Jira and Bitbucket](writes.md) | Switching writes on for the first time; switching them off quickly; reading the outbox |
| [A sync that is stuck or wrong](sync.md) | An issue's status is not coming through; an item did not move to Ship after a merge |
| [A leaked or expired token](tokens.md) | A Jira, Bitbucket or model credential was exposed, or stopped working |
| [A budget stopped the agents](budget.md) | "Budget reached" in Platform; drafts and runs are refused |

Who can do what: changing settings, budgets and whether NooblyJS writes is an **Owner's**. Everything here is recorded
in Platform · Audit log.
