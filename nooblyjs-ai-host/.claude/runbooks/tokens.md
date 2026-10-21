# A leaked or expired token

NooblyJS's credentials are environment variables (`.env`); none is in `data/`, a backup, the outbox or the audit log.

| Token | Setting | What it can do |
| --- | --- | --- |
| Jira, read | `JIRA_API_TOKEN` | Read issues in the NooblyJS projects |
| Jira, write | `JIRA_WRITE_API_TOKEN` | Create, move and comment on issues |
| Bitbucket, read | `BITBUCKET_API_TOKEN` | Read the NooblyJS repositories |
| Bitbucket, write | `BITBUCKET_WRITE_API_TOKEN` | Push branches and open pull requests |
| Models | the provider's settings (Bedrock, Vertex, Azure) | Spend money |
| Microsoft | `TEAMS_BOT_APP_SECRET`, `MS_GRAPH_CLIENT_SECRET` | Reply as the bot; send approval emails |

## A token was exposed (pasted somewhere, committed, shown on a screen)

1. **Revoke it at the source first** (Atlassian account → Security → API tokens; the cloud console; Entra → the
   app's secrets). Revoking is what stops it; changing `.env` does not.
2. For a **write** token: Platform · Settings · Integrations → **Switch to Record only**, so NooblyJS stops trying while
   you replace it.
3. Create a new token with the same narrow scope. Put it in `.env`. Restart NooblyJS.
4. Check: Integrations says **Connected**; for a write token, **Send now** on one recorded line in the Outbox.
5. Look for misuse while it was exposed: Jira's and Bitbucket's own audit logs for that account, and NooblyJS's
   Platform · Audit log (`devtools.write_sent` lists everything NooblyJS itself sent).
6. If it was committed: removing the commit is not enough, because the token is in the history. Revoking it is.

## A token stopped working

- Integrations says **Not connected: …** with the reason Atlassian gave (expired, wrong scope).
- Writes show **Failed** in the Outbox with the reason, and are sent again with **Send now** after the fix. Nothing
  is lost: NooblyJS keeps each one until it is sent or discarded.
- A read token that expired stops the sync (statuses go stale; the item card shows when NooblyJS last read). It does not
  stop NooblyJS.

## Keep them narrow

One account for NooblyJS, not a person's. Read and write tokens separate. Each limited to the projects and repositories
NooblyJS works on. No admin scope. Rotate on a schedule `[CONFIRM how often]`.
