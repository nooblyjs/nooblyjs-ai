# Phase 4 — Team chat: requirements

> **Status: done, accepted 2026-10-09.** Summary: `docs/phases/phase-04-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

> Source: `.claude/steering/roadmap.md` Phase 4. Goal: people and agents talk in a thread next to the
> work, and agents can't take decisions there. Repos: `nooblyjs-ai-host` (chat), `nooblyjs-core` (the panel in the UI
> kit), `nooblyjs-ai-product` (the spec edit behind "Apply to spec", and the panel on Architecture).

## Decisions taken before starting

| Question | Answer |
| --- | --- |
| The chat-panel export (the brief describes it, but there is no mockup) | Built from the brief's description (`product.md` §5.9) in the kit's tokens: 380px dock, agent messages with a square avatar, an "Agent" tag and a tinted bubble. **Wants a design review** `[CONFIRM]` |
| Teams-channel mirroring (`product.md` §12 Q10) | **Not in this phase.** A thread records `teamsChannel: "[PLACEHOLDER]"` and nothing is sent to Teams |
| Agent replies | The roadmap's "mock provider with scripted answers": replies come from `data/chat/scripts.yaml`, in-process, after a short "working…" pause. No model is called. Real teammate tasks replace this in Phase 6 |
| Who may post | People with the `draft` permission (Contributor and up). Viewers read |
| "Apply to spec" | A person's action (`draft`), carried out by the Product Factory through a new service, so the spec gets a new version the normal way. The roadmap lists `nooblyjs-ai-workflows` for "item edits from threads", but the spec is the Product Factory's artefact, so the edit goes there; readiness then reads 7 of 7 from its facts `[CONFIRM]` |
| The approval card in step 5 (read access to `delivery-planner`) | Needs `change-repo-access` (Owners). Repository access itself arrives in Phase 9, so the decision is recorded (card, system line, Activity, audit) and takes effect then |
| Which pages have the panel | Every item page: the Product Factory's Spec and Architecture pages and Home's item page share the item's thread (`thr_<ITEM-ID>`). Platform · Repositories keeps its placeholder page with a repo thread |

## Requirements

### R1 — Threads and messages
1. A thread SHALL belong to an item, a repository or a channel (`data/chat/threads/<id>.md`). Messages
   SHALL be append-only daily YAML streams (`data/chat/messages/<thread-id>/YYYY-MM-DD.yaml`) with
   author, text, mentions, cards, citations and cost. A message is never edited.
2. `POST /api/v1/chat/threads/:id/messages` SHALL resolve `@mentions` of people and agent teammates.
3. Every message SHALL be emitted as an event (so it reaches the event stream, Activity and, for an
   agent's reply, today's spend) and audited.

### R2 — Agent replies
1. A mention of an agent SHALL show "<agent> is working…" to everyone on the thread, then post the
   scripted reply: text, **cards** (plan, comparison, pr-link, facts, approval), **citations** and its cost.
2. An agent's reply SHALL record actor, item, system, model route and cost (`tech.md` §2.1).

### R3 — Cards and decisions
1. An **approval card** SHALL be answered by `POST /api/v1/chat/cards/:id/decision` only by a person
   whose access role has the card's permission. Anyone else gets 403, audited. **An agent is always refused.**
2. A **plan card** with "Apply to spec" SHALL be applied only by a person with `draft`, never an agent,
   and SHALL add a **system line** ("spec v5").
3. No agent action in chat SHALL change a status, approve anything or grant a permission. There is a test for each.

### R4 — The panel (UI kit)
1. The docked panel SHALL show the thread for what is on screen, the "working…" state, cards,
   citations, system lines, quick-action chips and a composer. New messages SHALL arrive without a refresh.
2. It SHALL stay mounted when the next page is about the same thing, be usable by keyboard, announce
   new messages politely, and pass axe.
3. **Summarise thread** SHALL post a summary of what was said and what changed.

## Done when
Steps 1–7 of the Phase 4 test script pass, and no agent action in chat can change a status or
approve anything (a test for each).
