# Phase 2 — Lifecycle core: items, approvals, activity: summary

**Status:** done. Built 2026-10-09 and signed off. Spec: `.claude/specs/phase-02-lifecycle-core/`.

To see it on your existing `data/` folder, run `npm run seed -- --reset` (it wipes `data/`), then `npm start`.
Your current `data/config/hosted-apps.yaml` still has `nooblyjs-ai-workflows` switched off, and the seeded Activity
history is only written when there are no events yet.

## What was built

| Area | What |
| --- | --- |
| `nooblyjs-ai-workflows` (new repo, hosted at `/workflows`, API only) | Items in the seven stages, readiness per stage, approvals (named reviewers, quorum, target times, reassign), send-back, the UI → Build handoff with work items as files, and a sweep that reminds and escalates. `register()` returns `services` for the Product Factory (`decide`, `sendBack`, `handoff`, `item`, `waitingFor`, `counts`) |
| Rules as data | `data/workflows/approval-rules.yaml` is the "Who approves what" table from `product.md` §4, unchanged. `readiness.yaml` has the seven Specify checks |
| Governance | Every decision refuses an agent first (even one with an Owner role), then checks the access role against the rule's permission, then that the person is a named reviewer still waiting. The work role is never read. Each has a "refuses" test |
| Host: clock | `src/services/clock.js`. Events, the audit log and hosted apps (`host.clock`) read it. `/dev/clock` moves it by hours or working days in development |
| Host: live updates | `GET /api/v1/events/stream` (SSE, not compressed, heartbeat, replay after `Last-Event-ID`). The frame turns on its EventSource and refreshes badges after events |
| Host: Activity and Overview | `src/services/activity.js` turns events into rows (person, agent or system; system; cost). `GET /api/v1/activity` filters and pages back. `GET /api/v1/home/overview` joins the engine's counts with a card per system |
| Screens | Home · **Overview**, **Lifecycle** (plus an item page with history, readiness, "Approve & move on" and Send back), **Approvals**, **Activity** in `public/js/pages/home/`, styled by `public/css/home.css`. The Home sidebar's Approvals badge and status card are live |
| UI kit (`nooblyjs-core`) | New `chips()` (filter buttons with counts). The swimlane now matches the mockup (navy bars for passed stages, blue for now, amber for waiting too long) |
| `nooblyjs-ai-product` | Three small fixes so it reacts to the real engine: it ignores approvals that aren't the spec's, understands the lifecycle's stage names on send-back, and accepts an ADR that was approved on the Approvals screen |
| Seed | 13 items (12 in flight), 9 approvals (4 waiting on Stevie, 2 on others, 3 done this week) and 15 Activity events. Seed times are moved to the moment of seeding, so "26 h · due today" stays true |

## Test script result (roadmap Phase 2)

Run on 2026-10-09, in a real browser (`test/e2e/home.spec.js`) and at the API (`test/lifecycle.test.js`,
`nooblyjs-ai-workflows/test/story.test.js`).

| Step | Result |
| --- | --- |
| 1. Stevie's Overview: in flight, stage strip, 4 waiting on you | PASS, with **12** in flight (the seed has 12; the roadmap said 14, which is the mockup's sample number) |
| 2. Approvals → PRD-031: 6 of 7 · Rollout plan missing · Lerato approved | PASS. The 6 of 7 comes from the Product Factory's own readiness facts |
| 3. Approve is refused; override with a reason moves it to Architect | PASS (422 `readiness_failed`, then approved) |
| 4. Lerato's Activity shows it without refreshing | PASS (second browser context, no reload) |
| 5. `data/workflows/items/PRD-031.md` and the audit file | PASS: the stage, the approval, the override and its reason, and the earlier refusal are all recorded |
| 6. Priya can't approve the ADR; refusal audited | PASS: "You can't accept this: it needs the "accept-decisions" permission, and your access role is Contributor." |
| 7. Dev clock + 2 working days: reminder, then escalation, "waiting too long" | PASS **as amended**: ADR-015 is reminded only (its rule is "Remind"); PRD-029's spec approval is reminded, then escalated to Stevie. Lifecycle marks both |
| 8. Send PRD-027 back to Specify; "Sent back for changes" + 1 | PASS. Its open ADR approval is withdrawn, and the Product Factory reopens the spec |

Tests: `nooblyjs-ai-host` 79 of 79, `nooblyjs-ai-workflows` 21 of 21, `nooblyjs-ai-product` 135 of 135. `npm run test:e2e`: 22 of 22, with
0 WCAG AA violations on the four screens, the item page and the dev clock, and no sideways scroll at 375px.

## Hosted-app checklist for `nooblyjs-ai-workflows`

| Step | Result |
| --- | --- |
| 1, 2 | PASS: `register()` only; listed in the seed `hosted-apps.yaml`; `/api/v1/shell` lists it as API-only with no rail item |
| 3, 10, 11 | Not applicable: it has no UI module, pages or CSS |
| 4 | Not applicable to the app (no pages). The Home deep links (`/home/lifecycle/PRD-031`, `/home/approvals?id=…`) load directly |
| 5 | PASS: signed in only; a Contributor is refused and the refusal is audited |
| 6 | PASS by construction: its logger is the host's provider with instance name `workflows`. Not checked on `/services/` by eye |
| 7 | PASS: it writes only `data/workflows/` |
| 8, 9 | PASS through the loader's existing tests. With it disabled, the Home screens say the lifecycle engine isn't running |
| 12 | PASS: `npm start` in the repo serves the API on port 11006 with a header-based dev sign-in |

## Decisions I took that need your confirmation

1. **Step 7 was changed.** The roadmap said ADR-014 is reminded and then escalated, but the rules table gives
   ADRs "Remind" only. I kept the table and changed the step.
2. **Lifecycle files live in `data/workflows/`**, not `data/lifecycle/`, because a hosted app writes only under
   its mount path. `approval-rules.yaml` moved there from `data/access/`.
3. **"1 working day" means by the end of the next working day.** That is what makes a 26-hour-old request
   "due today". Working days are Monday to Friday, UTC, with no holidays `[PLACEHOLDER]`.
4. **Quorum:** a spec needs every named reviewer; an ADR, UI handoff or merge needs one.
5. **Escalation** goes to people with the Owner access role, one working day after the target.
6. **PRD-028 "Slot picker screens"** is a sample item I added so the fourth approval (the UI handoff) has
   something to move. The Product Factory doesn't know it.
7. **A `stage` rule** lets an Approver move an item on from a stage the table doesn't cover. It isn't shown in
   the "Who approves what" table.
8. **Reminders run in-process** (every 60 s and when the dev clock moves), not through nooblyjs-core scheduling,
   which runs scripts in worker threads that must not write `data/`.
9. **`host.can` and `host.clock`** were added to the hosted-app contract (`structure.md` §2a and the child
   repos' copies).
10. **`API_RATE_LIMIT` and `SIGN_IN_RATE_LIMIT`** are new settings (defaults unchanged: 500 and 20 per 15
    minutes). The browser tests hit both limits. Pages refetch after events at most once every 2 s.

## Not built, or different from the mockups

- **Median idea → merge** on Overview: left for Phase 10 (Metrics). The card says how many are in flight.
- **Search** on Overview: not built (no phase owns it yet).
- **The "adding a second approver would cut two days" insight**: replaced by a plain computed sentence.
- **Requesting an approval** through the API (the Product Factory will need it in Phase 5). Today approvals
  come from the seed, from "Approve & move on", and from the handoff service.
- **Notifications** for reminders and escalations are events and audit records only until Phase 11.
- **The Markdown renderer** `tech.md` listed for Phase 2 wasn't needed by any screen, so it isn't built.
- **Spend against a daily cap** in the status card: the cap arrives with budgets in Phase 9.
- The seeded Product Factory dates are fixed (2026-10-09) while the lifecycle seed moves with the day you seed,
  so the two will drift apart in what "3 h ago" means.

## Guide points for your review

- Are the approval rules and readiness checks the ones you want (decisions 1, 3, 4, 5, 7)?
- Is the Activity wording right? Each event carries its own sentence (`payload.summary`).
- Compare the four screens with `brief/noobly-platform-{home,lifecycle,approvals,activity}`.
