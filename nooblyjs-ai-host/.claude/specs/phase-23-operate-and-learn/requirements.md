# Phase 23 — Operate and learn (Operations, part 2): requirements

> **Status: done (built and reviewed 2026-10-21).** Summary: `.claude/phases/phase-23-summary.md`. Root `product.md`
> §3.2, §3.7, §8; root `roadmap.md` Phase 23.

> Asked 2026-10-21: "Ok please start phase 23" (Phase 22 committed as `ace8bda`).

Goal: what runs in production is watched against SLOs, incidents are handled and learned from, and every item ends with
an outcome review that feeds Discover.

## Decisions taken before starting (2026-10-21, the defaults)

- **The monitoring platform** is `[PLACEHOLDER]`: the **monitoring adapter** is Operations' (`OPERATIONS_MONITOR`, only
  `mock`). The mock watches nothing: a budget burns only when a person burns it (development), and a goal's measure
  today is halfway from where it started to its target unless one is set. Every page says so.
- **On call is through Teams first**: NooblyJS's `oncall.alert` posts to the on-call channel
  (`TEAMS_ONCALL_CONVERSATION`, `[PLACEHOLDER]`) through the bot; in development to the simulator's "On-call" channel.
- **SLOs** come from the item's quality attributes once its first release is in production: availability ("99.9%
  monthly": a budget of 43.2 minutes over 30 days) and latency ("p95 < 300 ms": 1% of the window's minutes over target,
  confirmed 2026-10-21). Alerts at half the budget and at all of it, once each.
- **Incidents** are declared by a person (`draft`, people only) or raised from an SLO; linked to the item's release in
  production. Declaring one raises a signal from production on the Product board (`signal.raised`), linked to the
  release and item. Resolving one asks the **SRE agent** (Pip Okafor, `post-incident-review`) for the review; a person
  accepts it and it is written to Knowledge ("Post-incident reviews/"). Follow-ups become ideas or defects.
- **The outcome review** is due **30 days** after the item's first release is in production (confirmed 2026-10-21; product.md §9:
  "N days after release"), on the business clock. When due it opens the lifecycle's `outcome-review` approval (a
  Product lead, `approve`), showing each goal today against its target. Approved, the item is **done**; a missed goal
  can open an idea. **Closing the item withdraws its stories never released** (not yet in Operate), with their open
  pull requests and approvals, saying why; the review lists them beforehand (confirmed 2026-10-21).
- **Metrics** gains production, the DORA way: deployment frequency (steps into production), change failure rate
  (releases rolled back or with an incident), time to restore (median incident open time), and idea → outcome.
- **The SRE** work role and home: SLOs burning, open incidents, reviews to accept, outcome reviews due.

## R1 — SLOs and the monitoring adapter
## R2 — Incidents, the SRE agent's review, Knowledge, follow-ups
## R3 — Signals from production on the Product board
## R4 — The outcome review
## R5 — Metrics: DORA, idea → outcome; the SRE home

## Test script (roadmap Phase 23)
1. After Slots 1.0, the availability SLO shows its budget. Burn it with the mock: an alert reaches Teams.
2. Declare an incident; resolve it; the agent's review draft links the release; accept it; it is a Knowledge page.
3. The Product board shows a new signal "Slot list timeouts at peak", linked to Slots 1.0.
4. Move the clock to the outcome review: the goal "slot sell-out before 14:00" shows today vs target; close the item.
5. Metrics shows deployment frequency, change failure rate (1 of 1 in the period) and time to restore.

PRD-031's goal for step 4 is "Same-day slots still open at 12:00" (18% → 45%): the seed spec's sell-out goal.

**Done when:** steps 1–5 pass.
