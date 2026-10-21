# Phase 2 — Lifecycle core: design

> **Status: done, built 2026-10-09.** Summary: `.claude/phases/phase-02-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

## Pieces

```
nooblyjs-ai-host (host)                                         nooblyjs-ai-workflows (hosted at /workflows, API only)
  services/clock.js     now() + dev offset            src/stages.js       the 7 stages, labels, Product's stage names
  services/events.js    uses the clock                src/working-days.js due times (working days, hours, same day)
  services/activity.js  events → Activity rows        src/repos.js        items · approvals · handoffs (host.store)
  routes/events.js      GET /api/v1/events/stream     src/services/       items · readiness · approvals · sweep · views
  routes/home.js        overview, activity            src/routes/         /workflows/api/v1/…
  routes/dev.js         /api/v1/dev/clock             src/seed/           rules, readiness, 12 items, approvals (time-shifted)
  public/js/pages/home/ overview · lifecycle · item · approvals · activity
  public/js/pages/dev/  clock
```

`nooblyjs-ai-host` gives every hosted app `host.clock` (a `{ now() }` like `Date`). The engine never reads `Date.now()`
for business time.

## Data (`data/workflows/`)

```yaml
# items/PRD-031.md (front matter)
id: PRD-031
type: spec                    # opportunity | spec | pr
ref: PRD-031                  # how it is shown ("slots-api #482" for a PR)
title: Same-day delivery slots
system: product               # product | factory: who owns the artefacts
stage: specify                # discover | specify | architect | ux | ui | build | ship
status: active                # active | completed
owner: lerato-m
team: delivery-squad
work: { by: ada-quill, text: Ada · v4 }       # who is working on it now (agents update it later)
waitingSince: null            # set while it waits on a person with no approval open
readiness: { results: { rollout-plan: false, … } }   # stored result; Product's facts win when it runs
history:                      # one entry per stage visit; mirrors item.stage_changed
  - { stage: discover, enteredAt: …, leftAt: …, by: lerato-m }
  - { stage: specify, enteredAt: … }
version: 3
```

```yaml
# approvals/apr_prd031spec.md
id: apr_prd031spec
type: spec                    # spec | adr | ui-handoff | merge | deploy (the rule key)
itemId: PRD-031
subject: null                 # ADR-014 for an ADR, the PR for a merge
title: Same-day delivery slots
from: specify                 # the move it unlocks (an ADR has from = to)
to: architect
requestedBy: { id: ada-quill, name: Ada Quill, kind: agent }
requestedAt: …
dueAt: …                      # from the rule's target, at request time
artefactVersion: 4
reviewers: [{ id: lerato-m, role: Product lead, status: approved, at: … }, { id: stevie, role: Engineering, status: waiting }]
status: open                  # open | approved | changes-requested | withdrawn
cost: { usd: 7.40, note: Research + 4 drafts }
next: Rhea Voss (Architect agent) starts the container view and decisions. …
reminders: [{ at, to: [stevie] }]
escalated: { at, to: [stevie] }
override: { by, reason, at, failing: [rollout-plan] }
```

`approval-rules.yaml` holds the five rules (label, approver text, permission, quorum, target, if-late,
remind, escalate, needs readiness, transition label). `readiness.yaml` holds the checks per stage.
`handoffs/<hof_id>.md` holds a UI → Build handoff and its work items (`WI-<n>`).

## Rules in code

- **Permission per rule:** spec and ui-handoff → `approve`; adr → `accept-decisions`; merge → `merge`;
  deploy → `approve`. The person must also be a named reviewer still waiting. Agents (`kind: agent`) are
  refused before any check, with an audit record.
- **Quorum:** `all` (spec), `any` (adr, ui-handoff, merge), `2` (deploy).
- **Readiness gate:** only rules with `needsReadiness: true` (spec). Without an override reason, a
  failing check is a 422 `readiness_failed` listing the failing checks.
- **Sweep** (`sweep(now)`): open approvals with `now ≥ dueAt` and no reminder → remind the waiting
  reviewers; rules with `escalate` and `now ≥ dueAt + 1 working day` → escalate to the Owners. Runs
  every 60 s (unref'd timer) and on `clock.moved`.
- **Waiting too long:** an open approval past its due time, or `waitingSince` 3+ days ago.

## Events (all through `host.events.emit`, actor = the person or agent id)

| Event | Payload |
| --- | --- |
| `approval.requested` | `{ approvalId, itemId, type, system, summary }` |
| `approval.decided` | `{ approvalId, itemId, type, subject, system, decision, outcome, role, reason, summary }` (`outcome`: approved · changes-requested · pending) |
| `approval.reminded` / `approval.escalated` | `{ approvalId, itemId, type, to, summary }` (actor `system`) |
| `approval.reassigned` / `approval.withdrawn` | `{ approvalId, itemId, from, to, reason }` |
| `readiness.overridden` | `{ itemId, approvalId, failing, reason }` |
| `item.stage_changed` | `{ itemId, system, from, to, summary }` |
| `item.sent_back` | `{ itemId, system, from, to, reason, summary }` |
| `item.completed` | `{ itemId, system, summary }` |
| `handoff.created` | `{ handoffId, itemId, system, from, to, workItemIds, summary }` |

`summary` is the Activity sentence without the actor ("approved PRD-031 · Same-day delivery slots").

## API (`/workflows/api/v1`, signed in; writes need CSRF and are audited by the host)

| Route | What |
| --- | --- |
| `GET overview?person` | stage counts and notes, in-flight count, waiting-on-you rows |
| `GET items?filter=all\|mine\|waiting` | the swimlane rows, counts per filter, stage health |
| `GET items/:id` | one item with its history, readiness and approvals |
| `POST items/:id/send-back` | `{ to, reason }` (approve permission, people only) |
| `GET approvals?tab=mine\|others\|done` | the queue with the tab counts |
| `GET approvals/:id` | the detail panel |
| `POST approvals/:id/decision` | `{ decision, comment?, reason?, override? }` |
| `POST approvals/:id/reassign` | `{ to, reason? }` |
| `GET rules` | the Who approves what table |
| `GET flow` | where work waits, handoffs this week |
| `GET about` | name, version, mount path |

`services` (for `host.service('workflows')`): `decide`, `sendBack`, `handoff`, `item`, `waitingFor(person)`,
`counts()`, `sweep(now)`.

## Host

- `GET /api/v1/events/stream`: `text/event-stream` with `Cache-Control: no-transform` (so compression
  doesn't buffer it), a heartbeat every 25 s, `id:` = event id, `event: nooblyjs-ai-host`, data
  `{ id, type, topic, at, actor, summary, itemId }`. Replays today's events after `Last-Event-ID`.
- `GET /api/v1/activity?filter=&q=&before=&limit=`: rows from the event files, newest first, scanning
  back up to 30 days; plus `today` (agent actions, human decisions, PRs opened, spend) and `live`
  (agents working now, from the engine's items).
- `GET /api/v1/home/overview`: the engine's counts and waiting-on-you rows, the recent activity, and a
  card per system built from that app's status card (honest zeros or "not installed").
- Dev clock: `GET/POST /api/v1/dev/clock` (`{ hours }`, `{ workingDays }`, `{ reset: true }`), only with
  `NOOBLY_DEV_LOGIN=true`; the offset is kept in `data/dev/clock.yaml`. Moving it emits `clock.moved`.

## Screens

Pages in `public/js/pages/home/`, styles in `public/css/home.css` (every selector under
`[data-module="home"]`). The kit gains `chips()` (filter buttons with counts and `aria-pressed`), and its
swimlane takes the mockup's colours (done navy, now blue, waiting amber). Pages subscribe to the event
stream through `ctx.sse` and refetch, so a second browser sees changes without refreshing.
