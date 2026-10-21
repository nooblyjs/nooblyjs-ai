# Phase 6 — Digital Teammates everywhere: design

> **Status: done, approved 2026-10-10.** Summary: `.claude/phases/phase-06-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

## Pieces

```
nooblyjs-ai-teammate
  index.js                       register() returns `services` (below)
  src/services/host-tasks.js     runTask(): one task for another app, on InvocationService
  src/services/providers/        production refuses the direct Anthropic API; the mock plays a scripted answer
  src/config/seed-data.js        Rhea Voss, Ada's spec-drafting skill, the NooblyJS teams as cost centres
  public/js/pages/               frame signature, kit components, ctx.sse (bridge.js and the helper copies go)
nooblyjs-ai-host
  src/services/chat.js           an agent mention becomes a chat.reply task
  src/services/agents.js         the one place NooblyJS reads teammates from (roster, availability, fallbacks)
  src/teams/                     the bot: activities.js · verify.js · sessions.js · bot.js · connector.js · cards/
  src/routes/teams.js            POST /api/teams/messages
  src/routes/dev.js              the simulator's API (conversation, dev key)
  public/js/pages/dev/teams-simulator.js    /dev/teams
  public/js/pages/dev/adaptive-card.js      draws the Adaptive Card subset the bot sends
nooblyjs-ai-product
  src/services/drafting.js       passes its scripted draft to runTask, so one path serves both modes
nooblyjs-core
  public/ui/                     what the roster needs and the kit lacks (a teammate card, an avatar)
```

## The teammate service (`host.service('teammates')`)

```js
roster()                 // → [{ id, name, role, status, statusText, canWork, model: { key, name, tier }, rate, avatar, skills }]
get(slug)                // → one of those, or null
availability(slug)       // → { ok: true } | { ok: false, code, message }   (retired · paused · off shift · cap reached)
provider()               // → 'mock' | 'anthropic'
runTask({
  slug,                  // the teammate
  workType,              // 'chat.reply' | 'meeting.answer' | 'spec-drafting' | … (recorded, not routed, until Phase 9)
  itemId, system,        // attribution (tech.md §2.1)
  input,                 // { task, context?, history? }  what the teammate is asked, as text
  billTo,                // { teamId, teamName }  the NooblyJS team; becomes the entry's cost centre
  caller,                // { type: 'user' | 'system', id, name }  who asked
  scripted,              // async () => ({ output, costUsd })  the answer the mock provider plays
  signal,
})
// → { output, costUsd, modelRoute, hours, amount, workId, scripted: boolean }
// throws HttpError 404 · 409 teammate_paused / teammate_off_shift · 410 · 402 monthly_cap_reached
```

- `runTask` wraps `InvocationService.assign()`. It skips the approval threshold (the person who asked is
  the caller, as with a task assigned from the profile `[CONFIRM]`) and never streams.
- **Scripted mode.** When the provider is the mock and the caller passed `scripted`, the mock returns that
  output and cost instead of its own text. Usage is estimated from the text, so hours and the timesheet
  entry are still written. With a real provider `scripted` is ignored.
- `modelRoute` is `<provider>/<model id>`: `anthropic/claude-…`, or `mock/scripted`.
- `billTo.teamName` is added to the settings' cost centres if it isn't there. Only the host calls this.
- The work item and the timesheet entry gain `itemId`, `system`, `workType` and `team`.
- **Production.** `createProviders()` throws at start when `NODE_ENV=production` and the direct API would
  be chosen (`AI_PROVIDER=anthropic`, or credentials with no `AI_PROVIDER`).

Events to the host (`host.events.emit`), each with `{ actor, teammateId, itemId, system, modelRoute, costUsd }`:
`teammate.task_started`, `teammate.task_finished` (adds `hours`, `amount`, `team`, `workType`, `workId`),
`teammate.task_refused` (adds `reason`), `teammate.status_changed`. `task_finished` also goes to the audit
log (`host.audit.record`). The pages listen for these on `ctx.sse` in place of the app's own stream.

## Chat replies (`noobly/src/services/chat.js`)

```
person posts "@Ada …"
  → agents.availability(ada)            not ok → the agent's reply is the reason; no task, no cost
  → chat.agent_working
  → teammates.runTask({ workType: 'chat.reply', itemId, system, billTo, caller: the person,
                        input: { task: the message, history: last 20 messages, context: the item's facts },
                        scripted: () => the first matching reply in scripts.yaml })
  → parse the output → append the message(s) → audit
```

- **The reply contract.** Scripted output is the script entry as it is today (text, cards, citations,
  `then`). A model is asked to answer in Markdown and, when a table of facts helps, to end with one fenced
  `noobly-card` YAML block. Only `plan` (without `apply`), `comparison` and `facts` are accepted, with length
  limits; anything else is dropped and the text is kept. A model can't produce an approval card or an
  "Apply to spec" action in this phase.
- **The item's facts** come from `workflows.item()` and `snapshot()` (stage, waiting on) and
  `product.readinessFacts()`. Knowledge citations arrive in Phase 8.
- `billTo` is the item's team, else the first NooblyJS team the teammate is on.
- Teammates not running: the reply is a system line, "Digital Teammates is not running here".
- `append()` stays the only way to write to a thread, and `personOnly()` still refuses an agent first.

`src/services/agents.js` wraps `services.get('teammates')` for chat, Teams & roles, Home and For you. When the
service is missing it falls back to the ids in `data/teams/*.md` (`agentName(id)`), as today.

## The Teams bot (`noobly/src/teams/`)

```
POST /api/teams/messages          no session, no CSRF: the bot's own check
  verify.js     Authorization: Bearer dev:<key>   (key made at start, only with NOOBLY_DEV_LOGIN; else 401)
                the Bot Framework JWT check replaces this in Phase 11
  activities.js reads an activity: type (message · conversationUpdate · invoke), conversation.id, from,
                timestamp, text with the <at> mentions taken out, value (a card's Action.Submit data)
  bot.js        the flows
  sessions.js   MeetingSession files
  connector.js  send(conversationId, activity). Here: the simulator's connector. Phase 11: Bot Connector REST
  cards/        pick-teammate.yaml · teammate-joined.yaml · answer.yaml   (Adaptive Card 1.5, filled from data)
```

**Who is speaking.** `from.aadObjectId` is looked up on the person record (`entraObjectId`). The simulator
sends the signed-in person's id there, so the dev key trusts what the picker already trusts.

**Flows**

| Activity | The bot |
| --- | --- |
| `conversationUpdate` adding the bot, or a message that mentions `@NooblyJS` | sends **pick-teammate**: the roster, **Add** where `canWork`, the footnote with the billed team |
| `invoke` `{ action: 'add', teammateId }` | checks `draft` and availability, works out the billed team, writes the session, sends the "joined" line, **teammate-joined** and the introduction |
| a message that mentions the session's teammate | sends `typing`, runs a `meeting.answer` task, sends **answer** |
| `invoke` `{ action: 'choose-someone-else' }` | sets `leftAt` on the session, sends **pick-teammate** again |
| any other message | appended to the session's context if it is after `joinedAt`; otherwise ignored |

**MeetingSession** (`data/teams/sessions/<conversation-id>.md`)

```yaml
conversationId: sim-slot-rollout-sync
teammate: { id: ada-quill, name: Ada Quill }
addedBy: { id: stevie, name: Stevie }
billedTeam: { id: delivery-squad, name: Delivery squad }
joinedAt: 2026-10-10T13:56:02.000Z
leftAt: null
itemId: PRD-031
previous: [ … earlier sessions in this conversation … ]
```

The teammate's context is `data/teams/sessions/<conversation-id>/YYYY-MM-DD.yaml`: the messages the endpoint
received with `timestamp >= joinedAt`, and the teammate's own. Nothing else is ever read, so a message from
before the join can't reach it.

**The answer card.** Facts as label and value rows, the primary action (`Action.OpenUrl` to the item in
NooblyJS), a secondary action, sources, and the cost. "Ask Thabo to decide" is an `Action.OpenUrl` to the
approval in NooblyJS. No `Action.Submit` in this card decides anything; a test checks every template.

**Scripts.** `data/teams/scripts.yaml` holds each teammate's introduction and scripted answers (the mockups'
Ada and Rhea). Facts are filled from live data (`{stage}`, `{readiness}`, `{waitingOn}`), so the card shows
the item as it is rather than a second seeded state (`product.md` §11, seed drift).

**Into the item.** With a linked item, each message in and out after the join is appended to `thr_<item>`
through `chat.append()` with `via: 'teams'`, and audited. The task is billed to `billedTeam`.

## The simulator (`/dev/teams`, dev sign-in only)

- `GET /api/v1/dev/teams` lists the seeded meetings (`data/teams/sim/meetings.yaml`): "Slot rollout sync", five
  people, linked to Delivery squad and PRD-031 in `data/teams/links.yaml`, with Lerato's and Stevie's messages from
  before anyone joins; and "Checkout stand-up", which has no linked team.
- The page posts what is typed to `/api/v1/dev/teams/:id/messages` (and a card button to `…/actions`). That
  route builds the activity Teams would send and hands it to the same code as `POST /api/teams/messages`,
  with the dev key, in the NooblyJS process. (As built: the browser never holds the key.)
- What the bot sends goes to the simulator's connector, is kept in `data/teams/sim/<meeting>/YYYY-MM-DD.yaml`,
  and the page redraws on the `teams.activity_sent` event.
- The host chrome is a neutral stand-in, as in the mockups. Only the bot and teammate cards are NooblyJS design.
- `adaptive-card.js` draws the subset the three templates use (TextBlock, ColumnSet, FactSet, Image,
  ActionSet, Action.Submit, Action.OpenUrl) with escaped text.

## The Teammates screens

- **Roster** is rebuilt on kit components (`pageHead`, `statCard`, `chips`, `meter`, `statusPill`,
  `button`), plus a teammate card and an avatar added to the kit when the styleguide shows them.
- The other pages keep their layout and move to `render(view, { params, query, ctx, route })`, `ctx.api`,
  `ctx.sse` and the kit's `html.js` and `icons.js`. Then `bridge.js`, `base.js`, `api.js`, `html.js` and
  `icons.js` in the app are deleted, and `/api/v1/events` with them.
- One page per change, each with its e2e and axe check, roster first.

## What does not change

- The permissions matrix, and the cap of agents at Contributor.
- `scripts.yaml` and `CHAT_MOCK_REPLY_MS` (it is the mock's "working" pause now).
- Threads, messages and cards on disk.

## Risks

- **The Phase 5 story.** Once `runTask` exists, the Product Factory uses it. The story must stay green on
  the mock, so `scripted` goes in with task 2 and the product change with task 5, with the story run after each.
- **Billing increments.** Hours are rounded up to the billing increment, so one short answer can bill more
  than its model cost. The screens show the model cost on the answer and the billed amount on the timesheet.
- **A model's cards.** Free-text YAML from a model will sometimes be wrong. It is dropped, never repaired.
