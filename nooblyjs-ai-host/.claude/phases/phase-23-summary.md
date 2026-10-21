# Phase 23 — Operate and learn (Operations, part 2): summary

**Status:** done (built and reviewed 2026-10-21) (started at your word, with the defaults, after Phase 22 was
committed as `ace8bda`). Spec: `.claude/specs/phase-23-operate-and-learn/` (all 8 tasks done). Root `product.md` §3.2,
§3.7 and §8 are what it builds. The work is in `nooblyjs-ai-operations` (SLOs, incidents, outcome reviews, the
monitoring adapter), `nooblyjs-ai-host` (on-call alerts in Teams, the outcome review closing the item, DORA in Metrics,
the SRE), the Factory's Product section (signals from production, ideas from other apps) and Knowledge (a page another app
writes). This is the last phase of the roadmap.

## What is there

| Area | What |
| --- | --- |
| SLOs | An item's quality attributes become SLOs when its first release is in production: availability ("99.9% monthly", a budget of 43.2 minutes over 30 days) and latency ("p95 < 300 ms", 1% of the window's minutes). Operations · SLOs shows each budget in words |
| The monitoring adapter | `OPERATIONS_MONITOR`, only `mock` (the platform is `[PLACEHOLDER]`): a budget burns only when a person burns it (development), and a goal's measure today is halfway to its target unless set. Said on every page that uses it |
| On call in Teams | Half a budget burned, and all of it, alert once each through NooblyJS's `oncall`: the on-call channel through the bot (`TEAMS_ONCALL_CONVERSATION`), the simulator's "On-call" channel in development; audited |
| Incidents | `INC-001`: declared by a person or raised from an SLO, linked to the item's release in production; a timeline; resolved, the SRE agent (Pip Okafor, a teammate task) drafts the post-incident review; a person accepts it and it is written to Knowledge ("Post-incident reviews/"); follow-ups become ideas or defects |
| Signals from production | Declaring an incident puts a signal on the Product board ("Slot list timeouts at peak", source Production), linked to the release and item |
| The outcome review | `OR-031`, due 30 days after the item's first release (the business clock): the lifecycle's `outcome-review` approval opens, the spec's goals today against where they started and their target, and what is still under way; approved (a person with `approve`), the item is done; a missed goal can open an idea |
| Metrics | Production, the DORA way: deployment frequency, change failure rate (releases rolled back or with an incident), time to restore (median), idea → outcome |
| The SRE | The work role and home: SLOs burning, open incidents, reviews to accept, outcome reviews due |

## The test script

Run in the real app by `test/operate.test.js` (the Factory, Teammates, Infrastructure, Security, Operations and
Knowledge hosted), every step passing. Slots 1.0 is released first, as in Phase 22 (the pilot, then everyone).

1. PRD-031 has SLO-031-1 (latency) and SLO-031-2 (availability, "43.2 of 43.2 minutes of error budget left").
   Burning 25 minutes with the mock: "burning", and the alert is in the simulator's On-call channel ("Availability SLO
   of PRD-031: half its error budget is burned"), audited; burned out, a second alert; burning more, none.
2. Thabo declares INC-001 "Slot list timeouts at peak" on PRD-031: linked to REL-001 · Slots 1.0. He adds a line and
   resolves it; Pip Okafor's review draft names the release and has the timeline. Lerato accepts it: written to
   Knowledge as "Post-incident reviews/INC-001 Slot list timeouts at peak.md". A follow-up becomes an idea.
3. The Product board has the signal "Slot list timeouts at peak", source Production, linked to REL-001 · Slots 1.0 and
   PRD-031.
4. 31 days on by the dev clock, OR-031 is due: "Same-day slots still open at 12:00" is 31.5% now, from 18%, target 45%,
   not met ("0 of 3 goals met"); the review says "Closing PRD-031 withdraws STORY-031-2, STORY-031-3, never released." Priya can't
   decide it, even for Lerato (403); Lerato approves: PRD-031 is completed, STORY-031-2 and -3 are withdrawn ("PRD-031 closed
   with its outcome review"), STORY-031-1 stays in Operate, and the review is closed.
5. Metrics over the quarter: "2 deploys to production in 90 days (1 release)", "1 of 1 (100%) rolled back or had an
   incident", a time to restore, and one item closed with its outcome review.

And Thabo as an SRE: his home's tiles are SLOs burning, open incidents, reviews and outcome reviews; SLO-031-2 is
listed.

## Tests

- New: the host's `test/operate.test.js` (5); Operations' `test/operate.test.js` (2).
- Changed: the people test lists the SRE; the Teams simulator test lists the On-call channel.
- **Whole suites:** host 413 of 413 (408 before this phase). Factory 594 of 598, 4 skipped, none failing.
  Infrastructure 52 of 52. Security 21 of 21. Operations 20 of 20 (18). Knowledge 34 of 34.

## Decisions taken while building

- **Deciding an outcome review needs `approve`**, also on someone's behalf, as a deploy needs `deploy-production`.
- **An app's outcome-review approval completes the item** when approved (the only app approval that moves the item).
- **The mock compares times in milliseconds** ("1.8 s" against "300 ms").
- **The Metrics roll-ups were rebuilt** (version 4): past days get the new facts.
- **Closing an item withdraws its unfinished stories** (your answer, 2026-10-21): every story not yet in Operate, with
  its open pull requests and approvals; the review lists them before anyone decides.

## Answered (2026-10-21)

- Closing an item withdraws its unfinished stories (built so); the review is due 30 days after the first release; a
  latency SLO's budget is 1% of the window's minutes over target; the measures you run the factory by are the ones
  built (deployment frequency, change failure rate, time to restore, idea → outcome).

## Open questions

1. The monitoring platform (`[PLACEHOLDER]`) and the on-call channel in Teams (`TEAMS_ONCALL_CONVERSATION`).
2. The SRE agent is Pip Okafor (Operations Coordinator) until an SRE teammate is hired.
3. Not looked at in a browser here: the five new Operations pages, the Metrics page's Production card and the SRE's
   home. The tests read their APIs and check the module.
