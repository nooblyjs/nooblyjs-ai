# Phase 4 — Team chat: design

> **Status: done, accepted 2026-10-09.** Summary: `.claude/phases/phase-04-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

## Pieces

```
nooblyjs-ai-host
  src/services/chat.js        threads, messages, mentions, cards, scripted agent replies, quick actions
  src/routes/chat.js          /api/v1/chat/…
  src/seed/data/chat/scripts.yaml   the scripted replies (sample data)
nooblyjs-core (UI kit)
  public/ui/js/chat.js                    the panel's controller: load, post, live updates, card actions
  public/ui/js/components/chat-panel.js   messages, working line, chips, composer (pure, tested in Node)
  public/ui/js/components/chat-card.js    plan · comparison · pr-link · facts · approval
  frame.js                                mounts the panel for ctx.chat.scope(), keeps it across pages
nooblyjs-ai-product
  services.updateSpec()       a person's edit of a spec's sections from outside the app (Apply to spec)
  pages                       Architecture scopes the item's thread; Spec redraws on spec.updated
```

## Data (`data/chat/`)

```yaml
# threads/thr_PRD-031.md
id: thr_PRD-031
scope: { kind: item, id: PRD-031 }     # item | repo | channel
title: PRD-031 · Same-day delivery slots
participants: [lerato-m, ada-quill]
teamsChannel: "[PLACEHOLDER]"          # mirroring is not built (product.md §12 Q10)
```

```yaml
# messages/thr_PRD-031/2026-10-09.yaml (one record per message, appended)
id: msg_x92k…
threadId: thr_PRD-031
at: …
author: { id: ada-quill, name: Ada Quill, kind: agent }     # person | agent | system
text: Here is a rollout plan…
mentions: [{ id: lerato-m, name: Lerato M., kind: person }]
cards: [{ id: card_a71…, type: plan, title: Rollout plan, steps: […], apply: { label: Apply to spec } }]
citations: [{ n: 1, title: Slot capacity model, type: Runbook, where: delivery-planner, freshness: reviewed 3 weeks ago }]
costUsd: 0.42
modelRoute: mock/scripted
replyTo: msg_…
```

`cards/<card-id>.md` holds the state of a card that can be acted on (an approval's decision, a plan
that was applied). Messages stay immutable; a card's current state is merged in when a thread is read.

## Threads from what is on screen

`ctx.chat.scope({ kind, id })`: `item`, `spec`, `architecture`, `ux`, `ui` → `thr_<id>`;
`repository` → `thr_repo-<id>`; `channel` → `thr_channel-<id>`. Other kinds have no thread.

## API (`/api/v1/chat`, signed in)

| Route | What | Who |
| --- | --- | --- |
| `GET thread?kind=&id=` | the thread, its last 100 messages (cards with their state), chips, who can be mentioned, who is working | read |
| `POST threads/:id/messages` `{ text }` | post; mentions resolved; agent mentions queue a reply | draft |
| `POST threads/:id/actions` `{ action }` | `summarise` · `related-adrs` · `gate-failed` | read |
| `POST cards/:id/decision` `{ decision: approve \| decline }` | answer an approval card | the card's permission, people only |
| `POST cards/:id/apply` | apply a plan card to the spec | draft, people only |

## Events

`chat.message_posted` `{ threadId, messageId, itemId, system, authorKind, costUsd?, modelRoute?, summary }`,
`chat.agent_working` `{ threadId, agentId, agentName }` (not shown in Activity),
`chat.card_decided` and `chat.card_applied` `{ cardId, threadId, itemId, system, decision?, summary }`.

## Scripted replies

`data/chat/scripts.yaml`: `replies: [{ agent, match (regular expression), text, cards, citations, costUsd, then: [more messages] }]`,
first match wins, plus a `fallback`. The reply runs in the NooblyJS process: emit `chat.agent_working`, wait
`CHAT_MOCK_REPLY_MS` (default 1500), append the message(s). It can only append messages: there is no
code path from a reply to an item, an approval or a permission.

## The panel

`frame.js` calls `mountChat()` when a page scopes the dock. Moving to another page about the same
thing keeps the mounted panel (and what is typed in it); a page that doesn't scope the dock hides it.
The log is `role="log"` (polite), messages are a list, the composer is a labelled textarea (Enter
sends, Shift+Enter breaks the line), and every card action is a real button. At narrow widths the
dock goes under the content, as it already did.
