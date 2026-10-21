# Phase 10 — Metrics: summary

**Status:** done. Built 2026-10-10 and signed off. Spec: `.claude/specs/phase-10-metrics/` (requirements, design,
tasks: all 7 done). All of it is in `nooblyjs-ai-host`.

To see it: `npm start` (or `npm run electron`), then **Home · Metrics**. Your existing `data/` gets the sample
history on the first start (once: `data/metrics/sample-history.yaml` records it).

## What is there

| Area | What |
| --- | --- |
| The screen | Home · Metrics as in the mockup: the period switch (7 days, 30 days, Quarter), five tiles, lead time by stage per week as stacked columns with its sentence, spend by system, and "Who does the work, by stage". It changes period without reloading, follows live events, and says when it was computed |
| Where numbers come from | Only the event log. An event becomes facts (`src/services/metrics/facts.js`), facts become the metrics (`compute.js`, a pure function). No number on the screen is a constant, including the sentence under the chart |
| Roll-ups | `data/metrics/rollups/YYYY-MM-DD.yaml`: one file per past day with that day's facts. Rebuilt when missing or when the day's event file changed. Today is always read from the events |
| Reconcile | `npm run metrics:reconcile` recomputes every range from the raw events, compares it with what is served, prints each difference and exits 1 if there is one |
| API | `GET /api/v1/home/metrics?range=7d|30d|quarter` (anyone signed in with `read`) |
| Sample history | The seed writes about 1,170 events over seven weeks, marked `sampleHistory: true`, from which the service computes the mockup's numbers. They are placed relative to the Monday of the week of seeding, so the numbers are the same whichever weekday you seed on. Activity, "spent today", the approvals count on Teams & roles and Platform's ledger rebuild leave them out |

## Test script result (roadmap Phase 10)

| Step | Result |
| --- | --- |
| 1. Metrics (30 days) on the seed matches the mockup story | Pass. 9.1 d (1.8 d faster), 38 from 12, 71% (27 of 38), 18%, $6.10, weekly 11.2 → 8.5 d with every column part, $3,782 with its five rows, and all five stage rows |
| 2. `npm run metrics:reconcile` gives 0 differences | Pass, for all three ranges. It exits 1 and names the tile when a roll-up is tampered with |
| 3. Approve something and send something back; the numbers move | Pass. Approving PRD-031's spec ends its Product visit (50 → 51 visits); sending PRD-027 back takes Architecture's sent-back from 12% to 14% |
| 4. Delete `data/metrics/rollups/` and reload; identical | Pass, and the roll-ups are written again |

Tests: `test/services/metrics.test.js` (10), `test/metrics.test.js` (7, the four steps through the API), and the Metrics
part of `test/e2e/home.spec.js` (numbers, charts as tables, axe, 375px, period switch). `npm test`: 229 of 229. Of the
browser suite I ran `home.spec.js` and `shell.spec.js` (23 of 23); the five stories were not rerun.

## What each number means

| Metric | Definition |
| --- | --- |
| Idea → merge | Per item with a PR merged in the period: from `item.created` to its last merge there. The median. Compared with the period just before |
| PRs merged | `pr.merged` in the period, each PR once; "from n approved specs" is the distinct items they belong to |
| First-pass gates | Merged PRs with no `gate.failed` for the same run or PR before the merge |
| Human edits | Merged PRs with a `pr.human_edit` before the merge |
| Cost per merged PR | The cost on the merge, else the cost of the run behind it, averaged |
| Lead time by stage, per week | The six complete weeks before this one. Per week and stage group, the mean length of the visits that ended that week. "Build & ship" is the mean Build visit plus the mean Ship visit |
| Stage table | Over the visits that ended in the period: median, p90 (nearest rank), the share during which the item was sent back from that stage, and how the events during those visits split between agents and people |
| Spend by system | Costed `teammate.task_finished` and `run.finished` by system, plus `compute.metered` as Platform compute |

A stage visit is the time an item spends in one group (Product is Discover and Specify; UX and UI are one). A visit
whose beginning is not in the event log is left out, because its length is unknown.

## Decisions I took, for you to confirm

1. **The sample history is built per metric**, not as one coherent set of items: stage visits, pull requests and
   spend are separate sample items (`SMP-…`). The mockup's numbers cannot come from one consistent story: for
   example its Product median is 1.4 d with a weekly mean of about 2.5 d, which needs a few visits of 12 days or more.
2. **"Sent back" counts visits in which the item was sent back from that stage**, including Specify → Discover
   inside Product. The mockup has a rate for both the first and the last stage, which no other reading allows.
3. **Cost per merged PR says "agent runs behind them"**, not the mockup's "agents + compute": compute is not
   attributed to a PR yet.
4. **Share of work is counted over the visits that ended in the period**, like the rest of the row. Work on an item
   still in a stage shows when it leaves.
5. **The stage table shows the number of visits** under each stage name (not in the mockup), so a median over two
   visits is not read like one over fifty.
6. **nooblyjs-core's measuring service is not used**, although the roadmap names it: it keeps counters in memory, and
   these numbers have to be regenerable from files.
7. **Each in-flight item got one sample event saying when it entered its current stage**, so the visit has a
   beginning when you approve it or send it back (step 3). Seed items are files with no events behind them.

## What is not real yet

- `pr.merged`, `pr.human_edit` and `compute.metered` have no emitter: a hosted Software Factory run stops at a ready
  PR, and merges arrive with the source-control integration. Until then those tiles move only with the sample history.
- The numbers drift from the mockup as days pass, because the 30 days move on and the sample history does not.
- A fact records whether its actor was an agent or a person when the roll-up was written. If someone is added to a
  team's agents afterwards, reconcile reports the difference; deleting that day's roll-up fixes it.
- `public/js/pages/placeholder.js` is no longer used by any screen. I left the file.
