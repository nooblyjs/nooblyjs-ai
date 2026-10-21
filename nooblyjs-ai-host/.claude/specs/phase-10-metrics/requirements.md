# Phase 10 — Metrics: requirements

> **Status: done, signed off 2026-10-10.** Summary: `.claude/phases/phase-10-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 10 and `product.md` §5.2 item 5 and §8. Goal: Home · Metrics tells you
> how fast ideas become merged code, what it costs, and who does the work, and it reconciles with the event log.
> Repo: `nooblyjs-ai-host` (the roadmap also names `nooblyjs-core`'s measuring service; see the decisions). Mockup:
> `.claude/steering/brief/noobly-platform-metrics/`.

## Where the phase starts

- Home · Metrics is a placeholder. `structure.md` already reserves `data/metrics/rollups/YYYY-MM-DD.yaml`
  ("regenerable") and `src/services/metrics.js`.
- Every state change is an event in `data/events/YYYY/MM/<day>.yaml` (`item.created`, `item.stage_changed`,
  `item.sent_back`, `approval.requested`, `approval.decided`, `pr.opened`, `pr.merged`, `gate.failed`,
  `run.finished`, `teammate.task_finished`, …), with its actor and, for agent work, its cost.
- The seed's event history is 15 events for the Activity screen. It cannot produce the mockup's numbers (38 merged
  PRs, six weeks of lead time).
- Nothing merges a PR yet: a hosted Software Factory run stops at a ready PR, and GitHub arrives in Phase 12. The
  only `pr.merged` in the log is the seed story's PR #476.

## Decisions taken before starting

The roadmap lists no questions for this phase. These are mine, for your confirmation at review.

| Question | Answer |
| --- | --- |
| Where the numbers come from | **Only the event log.** A metric is a pure function of events. Nothing is typed into a metrics file, and no screen number is a constant |
| The seed (test step 1: "the numbers match the mockup story") | The seed writes a **sample history**: about 13 weeks of events, placed relative to the day of seeding and marked `sampleHistory: true`, built so that the metrics computed from them are the mockup's. They are events like any others, so reconcile covers them. **Activity leaves them out** (they would bury the story). It is built per metric, not as one coherent set of items: the merged PRs, the stage visits and the spend are separate sample items `[CONFIRM]` |
| Roll-ups | `data/metrics/rollups/YYYY-MM-DD.yaml`: one file per past day with that day's metric facts (the few fields of each event a metric reads). Today is always read from the events. A missing or deleted file is rebuilt from the events, so the numbers are identical |
| Reconcile | `npm run metrics:reconcile` recomputes every tile, chart and table from the raw events, ignoring the roll-ups, and compares it with what the API serves. It prints each difference and exits 1 if there is one |
| nooblyjs-core's measuring service | **Not used.** It keeps counters in memory for the `/services` dashboards; these metrics must be regenerable from files. Named in the roadmap, so say if you want it wired in anyway |
| Ranges | 7 days, 30 days, Quarter (90 days), ending now on the business clock. The trend compares with the period just before |
| Idea → merge | Per item with a PR merged in the range: from `item.created` to its latest merge in the range; the median, in days. (There is no `opportunity.accepted` event; an item is opened when its opportunity is taken up) |
| PRs merged | `pr.merged` events in the range, "from n approved specs" = the distinct items they belong to |
| First-pass gates | Merged PRs with no `gate.failed` for the same PR or run before the merge |
| Human edits | Merged agent PRs with a `pr.human_edit` before the merge. That event has no emitter until GitHub (Phase 12); the sample history has them |
| Cost per merged PR | The cost on the merge itself (`costUsd`), else the `run.finished` cost of the run behind it, averaged over merged PRs. The tile says "agent runs behind them": compute is not attributed per PR yet, so "agents + compute" (the mockup's words) would not be true `[CONFIRM]` |
| Lead time by stage, per week | The six complete weeks before this one. Per week and stage group, the mean time of the stage visits that ended that week; the label is the sum. Groups: Product (Discover, Specify), Architecture, UX & UI design, Build & ship |
| The sentence under the chart | Computed: the largest group in every week (if there is one), and whether most of its time had an approval open ("waiting for sign-off, not drafting time") |
| Spend by system | Costed `teammate.task_finished` and `run.finished` events by system, plus `compute.metered` as "Platform compute". `compute.metered` has no emitter until a real runtime; the sample history has it |
| Who does the work, by stage | Per group (Product, Architecture, UX & UI design, Build, Ship), over stage visits that ended in the range: median, p90 (nearest rank), sent back (% ended by `item.sent_back`). Share of work: events on an item while it was in that group, by an agent or by a person |
| Platform's spend ledger | Unchanged. It is the Settings mockup's month-to-date sample; Metrics' spend is the Metrics mockup's last 30 days. Real activity feeds both from the same events |
| Who may see Metrics | Everyone signed in with `read`, as the other Home screens |

## Requirements

### R1 — Metrics from events
1. `GET /api/v1/home/metrics?range=7d|30d|quarter` SHALL return the tiles, the weekly chart, spend by system and
   the stage table, each computed from metric facts, with `at` (business time) and the range's start and end.
2. A metric with nothing to count SHALL say so (null value, a "no merged PRs in this period" text), never 0 as if measured.
3. Events of an unknown type, or with missing fields, SHALL be ignored, not fail the request.

### R2 — Roll-ups
1. A past day's facts SHALL be read from its roll-up file, written the first time the day is needed.
2. Deleting `data/metrics/rollups/` SHALL change no number.
3. A roll-up SHALL be rebuilt when its day's event file changed after the roll-up was written.

### R3 — Reconcile
1. `npm run metrics:reconcile` SHALL compare, for each range, the served metrics with a recomputation from raw
   events, print "0 differences" or each difference, and exit non-zero on any.

### R4 — The screen
1. Home · Metrics SHALL match the mockup: the header with the range switch, five tiles, the stacked weekly chart
   with its legend and sentence, spend by system with bars, and the stage table with the agents/people bar.
2. Charts SHALL have a text alternative (the same numbers as a table for screen readers), pass axe, and work at 375px.
3. It SHALL update when the range changes without reloading the page, and say when it was computed.

### R5 — Seed
1. A fresh seed SHALL show the mockup's numbers at 30 days: 9.1 d (1.8 d faster), 38 from 12, 71% (27 of 38), 18%,
   the weekly totals 11.2 → 8.5 d, $3,782 with its five rows, and the stage table's medians, p90s and sent-back rates.
2. A data folder seeded before this phase SHALL get the sample history at the next start, once.
3. Sample-history events SHALL not appear in Activity or in "spent today".

## Test script (roadmap Phase 10)

1. Open Metrics (30 days) on the seeded data. The numbers match the mockup story.
2. Run `npm run metrics:reconcile`. Every tile is recomputed from raw events with **0 differences**.
3. Approve something and send something back. The relevant numbers move on refresh.
4. Delete `data/metrics/rollups/` and reload. The numbers are identical.

**Done when:** steps 1–4 pass.

## Out of scope

The Software Factory's own Metrics screen. Real merges, human edits and compute metering (Phase 12 and a real
runtime). Exporting metrics. Targets or alerts on a metric.
