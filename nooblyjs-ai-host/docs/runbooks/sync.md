# A sync that is stuck or wrong

NooblyJS reads the Jira issues linked to work items and the pull requests the Software Factory opened every
`DEVTOOLS_SYNC_MINUTES` (5). Reading changes nothing in Jira or Bitbucket.

**Who owns what:** NooblyJS owns the item and its stage. Jira owns each issue's status once the issue exists. Bitbucket
owns the pull request and the merge.

## An issue's status is not coming through

1. Open the item (Home · Lifecycle → the item). The **Work items in Jira and Bitbucket** card shows each work item's
   issue and when NooblyJS last read it. Press **Read Jira and Bitbucket now**.
2. Still old? Platform · Settings · Integrations: is Jira **Connected**, and is the issue's project in the list NooblyJS
   reads? An issue moved to another project is no longer read.
3. The work item shows "No issue yet": look in the Outbox. Its issue was **recorded, not created** (writing is off),
   is **waiting for approval**, or **failed** with a reason.
4. The log has `devtools sync: Jira did not answer: …` when Jira refused or was unreachable. A 429 (rate limit)
   clears by itself at the next read.

## NooblyJS did not move an issue

NooblyJS moves an issue only forward, and only for a run that started or a pull request that was merged.

- **"left DTE-412 at … someone moved it back in Jira"** in Activity (`devtools.sync_conflict` in the audit log): a
  person moved the issue back after NooblyJS last read it. Jira wins. Move it in Jira if it should move.
- **"has no move to In progress from …"**: that project's workflow has no such transition from the issue's status.
  Move it in Jira; NooblyJS follows.

## An item did not move to Ship after a merge

An item moves Build → Ship when **every** work item of its handoff has a pull request that **a person** merged.

1. On the item's card, look at each work item's pull request. One still **Open**, or **Not opened (recorded only)**,
   holds the item in Build.
2. "This merge does not count: it was merged with NooblyJS's own Bitbucket account": NooblyJS never merges, so a merge made
   with its token's account is ignored. A person merges, or an Approver moves the item with **Approve & move**.
3. A pull request declined in Bitbucket does not move the item. Reopen or replace it, or send the item back.
4. An Approver can always move the item by hand on the item page; that is recorded as their decision.

## Start again from Jira and Bitbucket

What NooblyJS knows is `data/devtools/work.yaml` (work item → issue and pull request) and `data/devtools/links.yaml`.
Do not edit them while NooblyJS runs. Pressing **Read Jira and Bitbucket now** rebuilds the statuses from the live
systems; the links themselves come from the outbox (`devtools.write_sent` records in the audit log name each issue).
