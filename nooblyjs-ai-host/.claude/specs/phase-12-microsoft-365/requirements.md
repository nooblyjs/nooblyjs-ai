# Phase 12 — Microsoft 365: SSO, notifications, the real Teams bot: requirements

> **Status: built 2026-10-11, waiting for review.** Summary: `docs/phases/phase-12-summary.md`.
> Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Source: `.claude/steering/roadmap.md` Phase 12, `product.md` §5.10 and §9, `tech.md` §7.3.
> Goal: people sign in with Microsoft, get approvals in Teams and Outlook, and can bring teammates into real Teams
> chats and meetings. Repos: `nooblyjs-ai-host` (most of it), `nooblyjs-core` (the Entra sign-in reads the job title).
> The Teams app project is `noobly/apps/msteams/noobly-bot` (Microsoft 365 Agents Toolkit, added by Stevie 2026-10-11).

## Where the phase starts

- **The bot's flows are built** (Phase 6, `src/teams/`): ask who to add, add a teammate, answer with a card that
  carries facts, links, sources and cost, log to the item, bill the team. Their only channel is the `/dev/teams`
  simulator: `POST /api/teams/messages` accepts the simulator's dev key and nothing else.
- **Microsoft sign-in works** (nooblyjs-core `authAzure`, `AUTH_METHOD=azure`), and a person record is made on first
  sign-in, but the record has no Entra object id (so a Teams message can't be matched to a person) and no job
  title (the sign-in asks only for `openid profile email`).
- **`apps/msteams/noobly-bot`** is the toolkit's echo-bot template: an app manifest (now NooblyJS's), a package builder, and a
  Teams SDK server on port 3978 that echoes. Stevie tests with the Microsoft 365 Agents Playground (local, no
  registration); no bot is registered in the tenant yet.
- Approvals emit `approval.requested` with the reviewers; nothing tells a reviewer outside NooblyJS.

## Decisions taken before starting

`[CONFIRM]` at review; none of them needs the tenant to build or test.

| Question | Answer |
| --- | --- |
| Who may add a teammate to a meeting (product.md §12 Q10) | **A person NooblyJS knows with the `draft` permission** (Contributor and up), as Phase 6 built it and as decided on 2026-10-10. Viewers and people NooblyJS doesn't know are refused, and the refusal is audited |
| Where the bot runs | **In NooblyJS** (`/api/teams/messages`), as tech.md says. `apps/msteams/noobly-bot` stops being an echo bot: its server on 3978 only **forwards** each activity, with its Authorization header untouched, to NooblyJS. The toolkit's F5, dev tunnel and Playground keep working unchanged |
| Token check | Bot Framework JWT, verified with `node:crypto`: signing keys from the Bot Framework OpenID metadata (cached a day, refetched on an unknown key id), RS256, issuer `https://api.botframework.com`, audience = the bot's app id, not expired (5 minutes' skew), and the token's `serviceUrl` = the activity's. No `botbuilder` dependency |
| Local testing | The Agents Playground sends no token. With `TEAMS_BOT_DEV_UNSIGNED=true`, which is refused in production and needs `NOOBLY_DEV_LOGIN`, NooblyJS accepts unsigned activities whose `serviceUrl` is on localhost, and acts for the Playground's mock user as `TEAMS_BOT_DEV_PERSON` (default `stevie`) |
| Replies | Bot Connector REST (`POST {serviceUrl}/v3/conversations/{id}/activities`) with a client-credentials token for `https://api.botframework.com/.default`, cached until it expires. The token is only ever sent to Microsoft's Bot Framework hosts; a reply to the Playground (localhost) carries none |
| Acknowledge first | The endpoint verifies, answers 200 at once, then handles the activity (Teams wants an answer within 15 seconds; a teammate's answer can take longer) |
| Matching a Teams person to NooblyJS | A person record gains `entraId` (the Entra object id), written when they sign in with Microsoft. The bot finds people by it. The simulator keeps using NooblyJS ids |
| Job title | **Opt-in since 2026-10-11** (`AZURE_AD_READ_PROFILE=true`): `User.Read` needs admin consent in the tenant, and asking for it by default stopped every sign-in. When on, the Entra sign-in also asks for `User.Read` and reads `jobTitle` from Microsoft Graph `/me` after sign-in; NooblyJS writes it on the person record, which onboarding already uses to pre-select the work role |
| Meeting notes | "post meeting notes to PRD-031" (with NooblyJS mentioned and a teammate in the chat) asks the teammate to summarise what was said since it joined (a teammate task, billed like an answer; scripted with no model) and posts the notes to the item's thread as a **meeting notes** message, with an event and an audit record. The chat gets a short confirmation with a link |
| Approval notifications | On `approval.requested`, each reviewer gets **a Teams message** (when they chose "approvals in Teams" and have the NooblyJS app installed, so NooblyJS holds their personal conversation) and **an email** (Microsoft Graph `sendMail`, app-only, from `MS_GRAPH_SENDER`). Both carry a link to the approval; neither can decide it |
| Email sending | `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_SENDER`. Without them nothing is sent and Platform · Integrations says so. The Graph app needs `Mail.Send` (application) with admin consent: that is the tenant's step |

## Requirements

### R1 — The real bot endpoint
1. `POST /api/teams/messages` SHALL accept an activity only with a valid Bot Framework token for NooblyJS's bot (or the simulator's key, or, in development, an unsigned Playground activity) and SHALL answer 401 to anything else, audited with the reason.
2. A valid activity SHALL be acknowledged with 200 before it is handled.
3. The bot SHALL reply through the Bot Connector to the conversation the activity came from, as NooblyJS's bot, and never send its token anywhere but Microsoft's Bot Framework hosts.

### R2 — People
1. Signing in with Microsoft SHALL record the person's Entra object id and job title.
2. The bot SHALL know a Teams user by their Entra object id; someone NooblyJS doesn't know is told to sign in to NooblyJS once.

### R3 — Meeting notes
1. "post meeting notes to <item>" SHALL post a summary of what was said since the teammate joined to that item's thread, logged and billed, and say so in the chat.

### R4 — Approvals in Teams and Outlook
1. A requested approval SHALL reach each reviewer in Teams (if chosen and installed) and by email (if configured), each with a link that opens that approval. Nothing in either can approve.

### R5 — The Teams app project
1. `apps/msteams/noobly-bot` SHALL forward activities to NooblyJS, build the app package, and work with F5 in Teams and in the Playground.

## Test script (roadmap Phase 12)

1. Sign in with your Microsoft account. Onboarding pre-selects the role from your real job title.
2. Request an approval from you. A Teams message and an Outlook email arrive, and the link opens the right approval.
3. Sideload the NooblyJS app into a test meeting chat and @mention it. You get the same pick-a-teammate card as the simulator.
4. Add Ada, ask her a question, and get an answer card with sources and cost. The message is in the item's Activity and the audit log.
5. Ask "post meeting notes to PRD-031". A notes entry appears on the item.
6. Send a request with a forged token to `/api/teams/messages`. You get **401**, and it's logged.

**Done when:** steps 1–6 pass in the test tenant. Offline, each step has a test; steps 3–5 also run in the Agents Playground.

## Out of scope

Proactive meeting joining or reading chat history (never). Teams tabs and message extensions. Graph change
notifications. Mirroring NooblyJS threads to Teams channels (Phase 13, if in scope).
