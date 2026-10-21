# Phase 4 — Team chat: summary

**Status:** done, reviewed and accepted on 2026-10-09. Spec: `.claude/specs/phase-04-team-chat/`.

To see it, run `npm run seed -- --reset` (it wipes `data/`) and `npm start`, sign in as Lerato, and open
**Product → Specs → PRD-031**. The chat panel is docked on the right.

## What was built

| Area | What |
| --- | --- |
| Chat service | `src/services/chat.js`: a thread per item, repository or channel (`data/chat/threads/`), messages as append-only daily YAML streams (`data/chat/messages/<thread>/<day>.yaml`), `@mentions` of people and agent teammates, and an event plus an audit record for every message |
| Agent replies | A mention of an agent shows "<agent> is working…" to everyone on the thread, then posts the scripted reply from `data/chat/scripts.yaml` with its cards, citations, cost and model route (`mock/scripted`). No model is called. A reply can only append messages |
| Cards | plan, comparison, pr-link, facts and approval. A card that can be acted on keeps its state in `data/chat/cards/`; messages are never edited |
| Decisions | **Approval card**: only a person whose access role has the card's permission; an agent is refused first, whatever its role. **Apply to spec**: a person with `draft`, through the Product Factory, which writes a new spec version. Both add a system line to the thread |
| Quick actions | Summarise thread (what was said, what was drafted, what changed, agent cost), Find related ADRs, and Why did a gate fail? on repository threads (says it arrives with the Software Factory) |
| API | `/api/v1/chat/…`: `GET thread`, `POST threads/:id/messages`, `POST threads/:id/actions`, `POST cards/:id/decision`, `POST cards/:id/apply` |
| The panel (UI kit) | `nooblyjs-core/public/ui/js/chat.js` with `chat-panel.js` and `chat-card.js`: messages (people round, agents square with an "Agent" tag and a tinted bubble), the working line, cards, numbered sources, system lines, chips and a composer (Enter sends). It updates live from the event stream |
| Where it shows | The Product Factory's Spec and Architecture pages and Home's item page share the item's thread. A page about the same item keeps the open panel and what is typed in it; other pages hide it |
| `nooblyjs-ai-product` | `services.updateSpec()` (a person's edit from outside the app; agents refused), the panel on Architecture, and the Spec page redraws when the spec changes |
| Activity | Chat messages and card decisions appear in Activity, and an agent's reply counts towards today's spend |

## Test script result (roadmap Phase 4)

Run on 2026-10-09 at the API on PRD-031 (`test/chat.test.js`) and in a real browser (`test/e2e/team-chat.spec.js`).

| Step | Result |
| --- | --- |
| 1. Lerato types `@Ada draft a rollout plan`; "Ada is working…", then a reply with a plan card and citations | PASS |
| 2. Thabo, in a second browser, sees the message and the reply live in the same thread | PASS |
| 3. Apply to spec: system line "spec v5", the spec has a rollout plan, readiness 7 of 7 | PASS at the API on PRD-031. In the browser it is shown on PRD-029 ("spec v3"), because by then earlier browser tests have approved PRD-031's spec, and an approved spec can't be edited |
| 4. `@Rhea can we hit 300 ms without Redis?` on Architecture: a comparison card | PASS |
| 5. Rhea's approval card for read access to `delivery-planner`: Priya can't answer, Stevie can; in Activity and the audit log | PASS |
| 6. Summarise thread: a summary message with what changed | PASS |
| 7. `data/chat/messages/thr_PRD-031/<today>.yaml` has every message with author, mentions and cost | PASS |

"No agent action in chat can change a status or approve anything (there's a test for each)": PASS. Agents are
refused on answering an approval card and on applying a draft (including an agent with an Owner role), and the
test checks the item's stage, the spec version and the cards are unchanged after agent replies.

Tests: `nooblyjs-ai-host` 109 of 109, `nooblyjs-ai-workflows` 24 of 24, `nooblyjs-ai-product` 137 of 137. `npm run test:e2e`: 34 of 34,
with 0 WCAG AA violations on pages with the panel open, no sideways scroll at 375px, and 44px controls.
(Those counts include tests other work added to the repos while this phase was being built.)

## Found and fixed on the way

- **The event stream could deliver events out of order**, because each one is prepared asynchronously. Sends
  are now serialised per connection. This affected every live screen, not only chat.

## Decisions I took that need your confirmation

1. **The panel's look is mine.** There is no chat mockup, so I built it from the brief's description in the
   kit's tokens. It wants a design review.
2. **No Teams-channel mirroring.** A thread records `teamsChannel: "[PLACEHOLDER]"` and nothing is sent to Teams.
3. **Replies are scripted and run inside the NooblyJS process**, not as queued `chat.reply` worker tasks. The
   roadmap puts real teammate tasks in Phase 6; the script file is `data/chat/scripts.yaml`.
4. **Posting needs the `draft` permission.** Viewers can read a thread but not write in it.
5. **Apply to spec goes through the Product Factory**, not `nooblyjs-ai-workflows` as the roadmap's repo list suggests,
   because the spec is the Product Factory's artefact. `nooblyjs-ai-workflows` was not changed in this phase.
6. **The repo-access approval is recorded but grants nothing yet.** It needs `change-repo-access` (Owners), and
   says it takes effect when Platform manages repositories in Phase 9.
7. **Chat messages show in Activity.** That is what `product.md` asks for, but a busy thread will fill the
   timeline; you may want them grouped or filtered later.

## Not built, or different from the brief

- **Repositories** has a thread only on its Phase 9 placeholder page; there is no real repository screen yet.
- **Citations** are written in the script (the Knowledge Repository arrives in Phase 8); they are not looked up.
- **The Markdown renderer** is still not built: messages are plain text with line breaks and mentions.
- Mentioning a person does not notify them (Teams and Outlook notifications are Phase 11).
- The scripted rollout plan has a `[PLACEHOLDER: number]` of pilot stores, which goes into the spec as written.

## Guide points for your review

- Does the agent voice and the card design work? The words are all in `data/chat/scripts.yaml`.
- What quick actions are missing?
