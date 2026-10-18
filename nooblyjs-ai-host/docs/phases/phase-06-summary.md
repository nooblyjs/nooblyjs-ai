# Phase 6 — Digital Teammates everywhere (and the Teams simulator): summary

**Status:** approved 2026-10-10. Spec: `.claude/specs/phase-06-digital-teammates/` (requirements, design,
tasks: all 14 done). Work is in four repos: `nooblyjs-ai-host`, `nooblyjs-ai-teammate`, `nooblyjs-ai-product` and `nooblyjs-core`.
**Nothing is committed yet** in any of them.

To see it, run `npm run seed -- --reset` (it wipes `data/`) and `npm start`, then follow the eight steps below.
With `AI_PROVIDER=mock` in `.env`, teammates answer from their scripts. With `AI_PROVIDER=anthropic` and your
key, they answer with a model.

## What is there

| Area | What |
| --- | --- |
| The teammate service | `nooblyjs-ai-teammate` returns `services` from `register()`: `roster`, `get`, `availability`, `provider`, `runTask`. Every agent action in NooblyJS is a `runTask`: it is refused for a teammate who is retired, paused, off shift or at their cap; it runs without tools; it writes a timesheet entry billed to an NooblyJS team; and it reaches the event and audit logs with actor, item, system, model route and cost |
| Scripted and real, one path | With no model configured, the task plays the caller's scripted answer. With one, the model answers. The direct Anthropic API is refused when `NODE_ENV=production` |
| Team chat | A mention of an agent is a `chat.reply` task, with the last 20 messages and the item's facts as context. A model's reply may carry one facts, plan or comparison card, rebuilt field by field; anything else is dropped. A paused teammate gets a line from NooblyJS saying why, and nothing is billed |
| Product Factory | Drafts run through the same service. With a model, the draft is read as one JSON object with only that stage's keys |
| Agents across NooblyJS | The mention list and Teams & roles ("Agent · Opus") come from Teammates. With Teammates switched off, NooblyJS still starts and says no agent can answer |
| Teams bot | `POST /api/teams/messages` and `src/teams/`: `@NooblyJS` → pick a teammate → joins (MeetingSession file) → answer card → Choose someone else. One bot, with cards that carry the teammate's name and "NooblyJS teammate" |
| Teams simulator | `/dev/teams`: two stand-in chats, drawn from the same Adaptive Card JSON that would go to Teams |
| Teammates screens | Team roster rebuilt on the UI kit's components. Every page uses the frame's `render()` and `destroy()`. The bridge, the copies of `html.js`, `icons.js`, `api.js` and `base.js`, and the app's own event stream are gone; live updates come over `ctx.sse` |
| Seed | Rhea Voss is the ninth teammate, Ada has a spec-drafting skill, and the three NooblyJS squads are cost centres |

## Test script result (roadmap Phase 6)

Run on 2026-10-10 in a real browser (`test/e2e/teams-simulator.spec.js`) and through the bot's endpoint
(`test/teams-bot.test.js`), on scripted answers. Step 2 was also run once with a real model.

| Step | Result |
| --- | --- |
| 1. Teammates on the rail → `/teammates/team` with no reload, matching the mockup | PASS, with **nine** teammates (Rhea Voss), where the mockup has eight |
| 2. With a provider, ask Ada a new question; her billed hours go up, against Delivery squad | PASS (`npm run test:live`): a real answer from `anthropic/claude-opus-5-5`, model cost $0.01, 0.1 h · $4.80 billed to Delivery squad. Checked on the timesheet; I did not open the Billing screen by eye |
| 3. Pause Sable; `@Sable` gets a clear "paused" reply, nothing billed | PASS. Sable is paused in the seed, so I did not press Pause. The line comes from NooblyJS, not from Sable |
| 4. `/dev/teams`, "Slot rollout sync", type `@NooblyJS` → the pick-a-teammate card | PASS: role, status and rate for each; **Add** only on the seven who can take work |
| 5. **Add** on Ada → "joined" line, her intro, "billed to Delivery squad" | PASS |
| 6. Lerato asks `@Ada what's still blocking the slot pilot?` → answer card | PASS: stage, readiness, waiting on, pilot stores (a placeholder), **Open in NooblyJS**, sources and the cost. **Ask Thabo to decide** opens Approvals in NooblyJS |
| 7. A message from before Ada joined is not in her context | PASS: checked in the session's files, and with an activity delivered late with an old timestamp |
| 8. **Choose someone else** swaps Ada for Rhea | PASS |

Tests: `nooblyjs-ai-host` 137 of 137 · `nooblyjs-ai-product` 140 of 140 · `nooblyjs-ai-teammate` 108 of 110 · `npm run test:e2e`
37 specs and the 8-test Phase 5 story, all passing, with 0 WCAG AA violations on the screens they land on.
The two Teammates failures are the Windows file-mode checks its `CLAUDE.md` already documents. The third
failure that was there before this phase (a kit class collision on `.chip`) is fixed.

## Hosted-app checklist for `nooblyjs-ai-teammate`

| Step | Result |
| --- | --- |
| 1–5, 7, 10, 11 | PASS, as before this phase (`test/teammates.test.js`, `test/e2e/shell.spec.js`) |
| 6 | PASS: its nooblyjs-core services are instances on the host's registry named `teammates`, and it logs at the host's `LOG_LEVEL` (new: `host.logLevel`). Not checked on `/services/` by eye |
| 8 | PASS: `enabled: false` → NooblyJS starts, the shell lists it as `not-installed`, its pages get the frame (`test/agents.test.js`) |
| 9 | PASS for the loader with a fixture whose `register()` throws, in the same test. Teammates' own failed start leaves nothing mounted (its `test/index.test.js`) |
| 12 | Does not apply: Teammates is a library with no `server.js`. The checklist now says so |

## Decisions that need your confirmation

1. **`costUsd` is the model cost** of an action (the "$0.06" on an answer). The timesheet carries billed hours
   × rate. Because hours round up to 0.1, one short answer bills $4.80 at Ada's rate.
2. **A task asked for from NooblyJS skips the teammate's approval threshold and runs without tools**, because a
   person asked for it and the answer can only be text.
3. **`nooblyjs-ai-harness` is not used in this phase.** Tasks keep Teammates' own loop; sandboxed runs wait for Phase 7.
4. **Work type is recorded, not routed.** A task runs on the teammate's own model until Platform's routes (Phase 9).
5. **With Teammates switched off, a mention gets "not running here"**, not a scripted reply.
6. **The pick list shows all nine teammates**, the meeting's team first. The mockup shows four.
7. **Ada's introduction no longer promises a summary to the spec when the meeting ends**, because that isn't built.
8. **The answer card's pilot stores row is a placeholder**, and Rhea's, Juno's and Otis's scripted answers use
   placeholders where the mockups had sample numbers.

## Not built, or left for later phases

- **The real Teams bot** (Phase 11): the Bot Framework token check, the Bot Connector, the Entra registration.
  The endpoint also handles an activity before it answers 200, which a real bot must not do.
- **Bedrock, Vertex and Azure adapters.** Only the Anthropic API (development) and the mock exist.
- **The Design and UI agents** (`design-agent`, `ui-agent`) are not hired in Teammates, so UX and UI drafts
  still come from the Product Factory's own script and are not billed. They need hiring, or mapping to teammates.
- **Teammates pages other than the roster** are on the frame's contract but not on the kit's components.
  They keep their own look inside `.tm-root`.
- **Meeting notes back to the item, and mirroring threads to Teams channels** (`product.md` §12 Q10).
- **Linking a real meeting to a team and an item** is a file (`data/teams/links.yaml`) `[PLACEHOLDER]`.
- **Knowledge context and citations** for real answers (Phase 8).

## Things to know

- **A teammate's status moves when they work.** After any task they become "Available", so the seeded "On a
  task" for Ada and Rhea lasts only until their first answer. A fresh seed opens with five of nine on a task.
- **Teammates' live updates are in the NooblyJS event log** (`teammates.*_changed`), a few per task. Activity
  leaves them out. Its older `task.completed` and `budget.warning` events also still reach the log.
- **Your `.env` sets `NODE_TLS_REJECT_UNAUTHORIZED=0`** (Node warned about it during the live run). It turns
  off certificate checks for every outgoing call, including the one to the model provider.
- **The other steering drift** found on 2026-10-09 (`.agents/tasks/noobly-steering-drift-2026-10-09/report.md`:
  the built-in Product app, `/wiki`, the planned folders in `structure.md` §2) is not fixed by this phase.

## Guide points for your review

- Are teammate personalities, rates and answers right?
- Are you happy with the bot's identity approach (one NooblyJS bot, teammate-branded cards) before going near a real tenant?
