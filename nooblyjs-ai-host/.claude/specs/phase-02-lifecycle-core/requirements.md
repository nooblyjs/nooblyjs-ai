# Phase 2 — Lifecycle core: items, approvals, activity: requirements

> **Status: done, built 2026-10-09.** Summary: `docs/phases/phase-02-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

> Source: `.claude/steering/roadmap.md` Phase 2. Goal: PRD-031 can move through every stage with a
> person approving each gate, and every move shows up in Activity and the audit log. Repos:
> `nooblyjs-ai-workflows` (new, hosted API at `/workflows`), `nooblyjs-ai-host`, plus two small fixes in
> `nooblyjs-ai-product` so it reacts correctly to the real engine.

## Decisions taken before starting

| Question | Answer |
| --- | --- |
| Approval rules table (`product.md` §4) | **Kept exactly as written**, as data in `data/workflows/approval-rules.yaml`. Spec → Architecture needs **every** named reviewer (Product lead + Engineering); an ADR, a UI handoff and a merge need **one** of the named reviewers; production deploy needs **two**. "1 working day" skips Saturday and Sunday; "4 hours" is clock hours; "Same day" is the end of that UTC day |
| Readiness checks per stage | Specify has the seven checks from `product.md` §4 (problem evidence … rollout plan), in `data/workflows/readiness.yaml`. The facts come from `nooblyjs-ai-product`'s `readinessFacts(itemId)` when it runs, else from the result stored on the item. Other stages have no checks yet |
| SSE + POST instead of WebSockets (`tech.md` §4.2) | **Confirmed.** `GET /api/v1/events/stream` (Server-Sent Events) carries every event; writes are plain `POST` |
| Where the lifecycle files live | `data/workflows/` (items, approvals, handoffs, rules), because a hosted app writes only under `data/<mountPath>/` (checklist step 7). `structure.md` §4 said `data/lifecycle/` and `data/access/approval-rules.yaml`; both are corrected |
| Roadmap step 7 says ADR-014 is reminded **then escalated**, but its rule says "Remind" only | The rule wins. Step 7 now checks ADR-014 gets a reminder only, and PRD-029's spec approval (rule: remind, then escalate) gets a reminder and then an escalation to the Owners `[CONFIRM]` |
| Noobly-core scheduling for reminders | Not used: it runs script files in worker threads, and workers must not write `data/` (`tech.md` §2.1). The engine sweeps in-process every 60 s and straight after the dev clock moves `[CONFIRM]` |
| Seed times | Written relative to the moment of seeding (the story's "now" is 2026-10-09 10:00 UTC, shifted), so "26 h · due today" stays true whenever you reset |
| The fourth approval, "Slot picker screens · UI handoff" | PRD-031 can't be in spec review and in UI handoff at once, so the UI handoff is on its own sample item, **PRD-028 · Slot picker screens** (sample data, not in the Product Factory) `[CONFIRM]` |

## Requirements

### R1 — Items and stages (`nooblyjs-ai-workflows`)
1. An **item** (`data/workflows/items/<ID>.md`) SHALL have an id, type (opportunity, spec, pr), title,
   owning system, stage (one of the seven), status (active, completed), owner, team, its stage
   history, and the current work on it (who is drafting, progress).
2. Every stage change SHALL be written to the item's history and emitted as `item.stage_changed`
   `{ itemId, system, from, to }` in the same operation.
3. A person with the `approve` permission SHALL be able to **send an item back** to an earlier
   stage with a reason. It SHALL emit `item.sent_back`, withdraw the item's open approvals for
   later gates, and count in "Sent back for changes". Agents SHALL be refused.

### R2 — Readiness
1. Readiness SHALL be evaluated per stage from the rules in `readiness.yaml` (n of m, failing checks named).
2. A gate whose rule needs readiness SHALL refuse approval (422 `readiness_failed`) unless the person
   **overrides with a reason**. The override SHALL be audited and emitted as `readiness.overridden`.

### R3 — Approvals
1. An **approval** (`data/workflows/approvals/<id>.md`) SHALL have its type (spec, adr, ui-handoff,
   merge, deploy), item, rule, requester, requested time, **due time** (from the rule), named
   reviewers and their decisions, and the outcome.
2. `POST /workflows/api/v1/approvals/:id/decision` SHALL accept **approve** or **request-changes**
   (with an optional comment; a reason is required for request-changes) only from a named reviewer
   whose access role has the rule's permission. Anyone else SHALL get 403 and an audit record.
   **Agents SHALL always be refused**, whatever their role.
3. When the quorum is met, the approval SHALL close and the item SHALL move to the next stage
   (`approval.decided` with `outcome: approved`, then `item.stage_changed`). A UI handoff SHALL also
   create the handoff and its work items as files (`handoff.created`). A merge SHALL complete the item.
4. **Reassign** SHALL hand the person's reviewer slot to someone else whose role has the permission.
5. Approvals past their due time SHALL be **reminded** (`approval.reminded`), and those whose rule
   escalates SHALL be **escalated** to the Owners one working day later (`approval.escalated`).
   The time SHALL come from the host's clock, so the dev clock can move it.
6. `services.decide()`, `sendBack()` and `handoff()` SHALL give `nooblyjs-ai-product` the same rules as the HTTP API.

### R4 — Host: clock, events stream, activity
1. A **dev clock** (`/dev/clock`, development sign-in only) SHALL move "now" forward by hours or
   working days and reset. Events, audit records and the engine SHALL use it (`host.clock`).
2. `GET /api/v1/events/stream` SHALL stream every event to signed-in people (SSE), with replay of the
   day's events after `Last-Event-ID`, and the frame SHALL turn on `features.events`.
3. `GET /api/v1/activity` SHALL turn events into Activity rows (actor, kind, action, item, system,
   time, cost, outcome), grouped by day, filterable (people, agents, system) and paged back.

### R5 — Screens (Home)
1. **Overview**: summary in words, the seven-stage strip with counts, the Knowledge and Platform
   bands, one card per system, **Waiting on you** and **Recent activity**.
2. **Lifecycle**: filters with counts (All / Mine / Waiting 3+ days), per-stage count and median with
   the slowest highlighted, the item × stage swimlane, **Where work waits**, **Handoffs this week**,
   and an item page with its history and **Send back**.
3. **Approvals**: summary in words, tabs with counts, the queue, the detail panel (readiness, other
   reviewers, agent cost, what happens next, comment, Approve / Request changes / Reassign, override),
   and the **Who approves what** table.
4. **Activity**: filters, the timeline by day, **Live now**, **Today so far**, **Load earlier**, and
   new events appearing without a refresh.
5. Every number SHALL come from files and events. The Home Approvals badge SHALL count what waits on
   the person.

### R6 — Hosted-app checklist
`nooblyjs-ai-workflows` SHALL pass the hosted-app checklist (API-only: steps 3, 10 and 11 apply to apps with
a UI, so they are checked as "not applicable" with the reason).

## Done when
Steps 1–8 of the Phase 2 test script pass, `npm test` is green in `nooblyjs-ai-host`, `nooblyjs-ai-workflows` and
`nooblyjs-ai-product`, and `npm run test:e2e` reports 0 AA violations on the four screens.
