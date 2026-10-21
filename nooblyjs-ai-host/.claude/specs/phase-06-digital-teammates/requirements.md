# Phase 6 — Digital Teammates everywhere (and the Teams simulator): requirements

> **Status: done, approved 2026-10-10.** Summary: `.claude/phases/phase-06-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 6. Goal: teammates from `nooblyjs-ai-teammate` do the real
> drafting and chatting, and every action shows the teammate, time and cost. Repos: `nooblyjs-ai-host` (chat, the
> Teams bot and its simulator), `nooblyjs-ai-teammate` (the teammate service, seed, screens), `nooblyjs-core`
> (UI kit pieces the roster needs, and its AI module in `src/aiservice/common`), `nooblyjs-ai-product`
> (drafting through the teammate service).
>
> This one spec covers all four repos, because the work is one story. Each task in `tasks.md` names its repo.

## Where the phase starts

Teammates is already hosted in the frame at `/teammates` (done early, 2026-10-09): `register()`, its rail
item, nav and status card, a UI module that runs the old pages through a bridge, scoped CSS, NooblyJS
permissions, CSRF and audit. Hosted-app checklist steps 1–5, 7, 10 and 11 pass.

Not there yet: `register()` returns no `services`, so nothing in NooblyJS can ask a teammate to work. Chat
replies are scripted in the NooblyJS process. The Product Factory drafts on its own mock. There is no Teams
bot code (`src/teams/`, `/api/teams/messages`, `/dev/teams`). The Teammates pages still use their own
helpers, tokens and EventSource.

## Decisions taken before starting

Answered by Stevie on 2026-10-10 unless marked.

| Question | Answer |
| --- | --- |
| Model provider for dev and test (`product.md` §12 Q4) | **The Anthropic API, in development only.** The mock stays the default when no credentials are set. The direct API is refused when `NODE_ENV=production`. Bedrock, Vertex and Azure stay open (Q4) |
| Teammate identity in Teams (`tech.md` §7.3) | **One NooblyJS bot.** Its cards carry the teammate's name, avatar and an "NooblyJS teammate" label. No app per teammate |
| Rhea Voss, who the story needs but the Teammates seed lacks | **Added as a ninth teammate** (Architect, $52/hr, Delivery squad). The roster says nine, where the mockup says eight |
| Who may add a teammate to a meeting, and who is billed (`product.md` §12 Q10) | Anyone with the **`draft`** permission (Contributor and up). Billed to the meeting's linked team, else the first team of the person who added them. With neither, the bot refuses and says why |
| Mirroring item threads to Teams channels (Q10) | Still not in scope. A thread keeps `teamsChannel: "[PLACEHOLDER]"` |
| What "no provider configured" means | One path for both modes: every agent action is a teammate task. On the mock provider the task plays the caller's **scripted answer**; with a real provider the model answers. Availability, timesheets and attribution work the same in both `[CONFIRM]` |
| What "cost" means on a message, card or event | `costUsd` is the **model cost** of that action (the mockup's "this answer cost $0.06"). The timesheet entry carries the billed hours and amount (hours × the teammate's rate) `[CONFIRM]` |
| Which team a task is billed to | The NooblyJS team passed by the caller: the item's team for chat and drafting, the session's team for a meeting. Teammates records it as the entry's cost centre `[CONFIRM]` |
| `nooblyjs-ai-harness` (listed for this phase) | **Not adopted in this phase.** Teammate tasks keep the invocation loop Teammates already has. Sandboxed harness runs arrive with the tools that touch repos (Phase 7) `[CONFIRM]` |
| Model routing by work type (`tech.md` §6) | A task records its work type (`chat.reply`, `spec-drafting`, `meeting.answer`…) and runs on the teammate's own model. The routes file is Platform's (Phase 9) |
| Standalone mode (checklist step 12) | Teammates is a library with no `server.js`. Step 12 applies only to apps that have one; the checklist and `structure.md` §2a are reworded |
| `nooblyjs-ai-common` | It is nooblyjs-core's AI module now (`nooblyjs-core/src/aiservice/common`). The steering docs are brought in line |

## Requirements

### R1 — The teammate service
1. `nooblyjs-ai-teammate` SHALL return `services` from `register()`: `roster()`, `get(slug)`, `availability(slug)`
   and `runTask(…)`. Other apps reach teammates only through these (`host.service('teammates')`).
2. `runTask` SHALL refuse a teammate who is retired, paused, off shift or at their monthly cap, with a
   reason a person can read. A refused task SHALL bill nothing.
3. A finished task SHALL write a timesheet entry (hours, amount, model cost, the billed team) and a work
   item that record the caller, the item, the system and the work type.
4. Every task SHALL emit an event and an audit record with actor, teammate, item, system, model route and
   cost (`tech.md` §2.1).
5. The direct Anthropic API SHALL be refused when `NODE_ENV=production`. There is a test that proves it.
6. The seed SHALL have Rhea Voss, a spec-drafting skill for Ada Quill, and the NooblyJS teams as cost centres.

### R2 — Chat and drafting are teammate tasks
1. A mention of an agent in team chat SHALL run a `chat.reply` task as that teammate, with the thread's
   recent messages and the item's facts as context. "<agent> is working…" SHALL show while it runs.
2. With a provider configured the reply SHALL be the model's answer. Without one it SHALL be the scripted
   answer from `data/chat/scripts.yaml`, through the same task.
3. A mention of an unavailable teammate SHALL get a clear reply that says why (e.g. "Sable Reyes is
   paused") and SHALL bill nothing.
4. A model's reply MAY carry `plan`, `comparison` and `facts` cards. Anything else it returns is dropped.
   A reply can still only append messages.
5. Product Factory drafts SHALL run through `runTask`. The Phase 5 story SHALL still pass on the mock.
6. No agent action in chat, drafting or Teams SHALL change a status, approve anything or grant a
   permission. The Phase 4 "refuses" tests stay, and each new path gets its own.

### R3 — Agents come from Teammates
1. Wherever NooblyJS names an agent (the mention list, Teams & roles, Home, For you), the name, role, status
   and model SHALL come from the teammate service, not from the id.
2. When Teammates is switched off, NooblyJS SHALL still start. Agents are then shown by id, and a mention
   gets "Digital Teammates is not running here".

### R4 — The Teams bot, in the simulator
1. `POST /api/teams/messages` SHALL accept Bot Framework–shaped activities. In this phase a caller is
   trusted only with the dev key, which exists only with `NOOBLY_DEV_LOGIN=true`. Anything else gets 401.
2. `@NooblyJS`, or adding the bot, SHALL post the **pick a teammate** card: each teammate's name, role, status
   and rate, **Add** on those who can take work, and the footnote naming the billed team.
3. **Add** SHALL create a MeetingSession (`data/teams/sessions/<conversation-id>.md`: teammate, added by,
   billed team, `joinedAt`, linked item), post the "joined" line and card, and the teammate's introduction.
4. A message to the teammate SHALL be answered with an **answer card**: facts, a primary action that opens
   NooblyJS, a secondary action, sources and the cost. A "listening" indicator SHALL show while it works.
5. Messages with a timestamp before `joinedAt` SHALL never reach the teammate. The bot SHALL never fetch
   chat history.
6. **Choose someone else** SHALL end the session and offer the list again.
7. Every card action that decides something SHALL be a link into NooblyJS (`Action.OpenUrl`). Nothing is
   approved in Teams.
8. Every message in and out of a session SHALL go to the linked item's thread and the audit log, and its
   cost SHALL be billed to the session's team.
9. `/dev/teams` SHALL show a stand-in meeting chat ("Slot rollout sync") that sends these activities and
   draws the cards. It exists only with `NOOBLY_DEV_LOGIN=true`.

### R5 — The Teammates screens
1. **Team roster** SHALL be built from the UI kit's components and match its mockup: summary tiles,
   filters, teammate cards, the hire card and the budget card.
2. Every Teammates page SHALL use the frame's `render(view, { params, query, ctx, route })` and the kit's
   helpers. The bridge, the app's own copies of the helpers and its own EventSource are removed; live
   updates come over `ctx.sse`.
3. Every selector SHALL still start with `[data-module="teammates"]`, and every page SHALL pass axe.

### R6 — Hosting
1. `nooblyjs-ai-teammate` SHALL pass hosted-app checklist steps 6, 8 and 9, which were still open.

## Done when
Steps 1–8 of the Phase 6 test script pass, everything still works on scripted answers with no provider
configured, and `nooblyjs-ai-teammate` passes the hosted-app checklist.
