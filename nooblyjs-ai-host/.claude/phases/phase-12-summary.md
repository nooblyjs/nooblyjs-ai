# Phase 12 — Microsoft 365: SSO, notifications, the real Teams bot: summary

**Status:** built 2026-10-11, waiting for your review. Spec: `.claude/specs/phase-12-microsoft-365/` (all 8 tasks
done). Work is in `nooblyjs-ai-host` (most of it, including the Teams app project `apps/msteams/noobly-bot`) and one line in
`nooblyjs-core`.

> **Corrected 2026-10-11.** The Entra sign-in first asked for Microsoft Graph's `User.Read` for everyone. In the
> Acme Retail tenant that permission needs admin consent on this app registration, so every sign-in stopped at
> "Approval required". The sign-in asks for `openid profile email` again. Reading the job title is now opt-in
> (`AZURE_AD_READ_PROFILE=true`), for after an admin grants `User.Read`; until then onboarding does not pre-select a
> role from the job title. The Entra id, which the Teams bot uses to know people, comes from the sign-in itself and
> is not affected.

## What is there

| Area | What |
| --- | --- |
| The real bot endpoint | `POST /api/teams/messages` checks Microsoft's Bot Framework token with `node:crypto` (signing keys from the Bot Framework's metadata, RS256, issuer, audience = NooblyJS's bot, expiry, and the token's service address = the activity's). A forged, expired, misaddressed or missing token gets **401** and an audit record. A valid activity is answered 200 at once and handled after |
| Replies | Through the Bot Connector, as NooblyJS's bot, with a client-credentials token that only ever goes to Microsoft's Bot Connector hosts |
| People | Signing in with Microsoft writes the person's **Entra id** (how the bot knows them in Teams) and **job title** from Microsoft Graph (onboarding suggests the work role from it). Someone NooblyJS doesn't know is told to sign in once |
| Meeting notes | "@NooblyJS post meeting notes to PRD-031" (with a teammate in the chat): the teammate writes notes of what was said since it joined (billed to the meeting's team) and they go to the item's thread as meeting notes; the chat gets a link |
| Approvals in Teams and Outlook | When an approval is requested, each reviewer gets a card in their personal chat with the NooblyJS app (if they chose approvals in Teams and have the app) and an email through Microsoft Graph (unless they turn it off). Both link to the approval; neither can decide it. Each is audited |
| Playground mode | `TEAMS_BOT_DEV_UNSIGNED=true` (development only, refused in production) lets the Microsoft 365 Agents Playground in: unsigned, from this machine, acting as `TEAMS_BOT_DEV_PERSON` |
| The Teams app project | `apps/msteams/noobly-bot` is no longer the template's echo bot: its server on 3978 forwards each activity to NooblyJS unchanged, so the Agents Toolkit's F5, tunnel and Playground keep working. It also holds the NooblyJS manifest, icons and `npm run package`. Its README says how to run it in the Playground and in Teams, and which NooblyJS settings take the toolkit's values |
| Platform | Settings · Integrations shows Microsoft Teams / Outlook: the bot and approval emails, set up or not, and the Playground warning in development |

## Test script result (roadmap Phase 12)

| Step | Result |
| --- | --- |
| 1. Sign in with Microsoft; onboarding pre-selects the role from your job title | Pass offline: Graph `/me` (faked) gives "Solution Architect", the person gets their Entra id and title, onboarding suggests Architect. Not yet with your tenant |
| 2. An approval request arrives in Teams and Outlook, linking to the approval | Pass offline: a Teams card in the reviewer's personal chat and a Graph email, both linking to `/home/approvals?id=…` |
| 3. @NooblyJS in a meeting chat gives the pick-a-teammate card | Pass offline (signed token) and **in the Agents Playground on your machine** |
| 4. Add Ada, ask her, get an answer card with sources and cost; it is in Activity and the audit log | Pass offline and in the Playground (Ada answered from your Anthropic key: a real model call) |
| 5. "post meeting notes to PRD-031" puts notes on the item | Pass offline and in the Playground (the notes landed on PRD-031's thread) |
| 6. A forged token gets 401 and is logged | Pass: eight kinds of bad token, each refused and audited |

**Done when steps 1–6 pass in the test tenant:** not yet. That needs the bot registered (Provision in the Agents
Toolkit) and, for emails, a Graph app with `Mail.Send`. See `apps/msteams/noobly-bot/README.md`.

Tests: `test/teams-real.test.js` (7: the six steps with Microsoft played by a fake fetch and a test signing key, plus
unknown people and Viewers), `test/teams-playground.test.js` (3), the Phase 6 Teams tests (14) and
`teams-simulator.spec.js` in the browser. `npm test`: 257 of 257. nooblyjs-core's sign-in tests: 216 of 216.

## Decisions I took, for you to confirm

1. **The bot runs in NooblyJS**, and `apps/msteams/noobly-bot` only forwards (no second bot to keep in step).
2. **No `botbuilder`**: the token check and the Bot Connector are `node:crypto` and `fetch`, as tech.md said.
3. **Approval emails are on by default** (a profile can turn them off); Teams messages stay opt-in, as onboarding had them.
4. **The Playground acts as one NooblyJS person** (`TEAMS_BOT_DEV_PERSON`), because its mock user is no one NooblyJS knows.
5. **Meeting notes need a teammate in the chat**: the notes are written from what was said since it joined, and
   nothing earlier is ever read.

## What is not done yet

- The tenant run: register the bot and grant `Mail.Send` (your steps), then steps 1–6 in Teams.
- Linking a real meeting to an item and team from NooblyJS's UI (`data/teams/links.yaml` is edited by hand).
- A personal chat for approval messages needs the person to have the NooblyJS app; NooblyJS doesn't install it for them.
