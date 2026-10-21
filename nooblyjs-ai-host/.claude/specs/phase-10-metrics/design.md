# Phase 10 — Metrics: design

> **Status: done, signed off 2026-10-10.** Summary: `.claude/phases/phase-10-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Requirements: `requirements.md`. Steering: `product.md` §8, `tech.md` §3.3, `structure.md` §2 and §4.

## Shape

```
data/events/…/<day>.yaml ──► facts(day)  ──► data/metrics/rollups/<day>.yaml   (past days, regenerable)
                                  │
                 facts of [start − 120 days, now] ──► compute(facts, range, now) ──► tiles · weeks · spend · stages
```

| File | What |
| --- | --- |
| `src/services/metrics/facts.js` | An event → a metric fact, or nothing: `{ t, k, item, from, to, key, cost, system, who, … }`. The only place that knows event types |
| `src/services/metrics/compute.js` | Pure: facts + range + now → the metrics. No I/O, so reconcile and the tests call it directly |
| `src/services/metrics/index.js` | Reads facts (roll-ups for past days, events for today), caches roll-ups by modification time, serves `get(range)`; `fromEvents(range)` skips the roll-ups (reconcile) |
| `src/seed/metrics-history.js` | The sample history: tables of durations and counts, placed on the calendar relative to "now" |
| `scripts/metrics-reconcile.js` | `npm run metrics:reconcile` |
| `public/js/pages/home/metrics.js` | The screen; charts are HTML and CSS (no chart library), each with a visually hidden table |

## Facts

`k` is the kind: `created` (item, stage) · `stage` (item, from, to; `back: true` for a sent-back) · `ask` and
`decide` (an approval opened and decided, for waiting time) · `open`, `gate`, `edit`, `merge` (a PR, by `key` =
`repo#number`, else the run id, else the item) · `run` (key, cost) · `spend` (system, cost) · `work` (item, who:
agent or person). A stage visit is from entering a group to leaving it; a visit whose entry is not in the facts is
not counted (its length is unknown).

Lookback: 120 days before the range's start, so a visit or an item that began earlier still has its beginning.

## The sample history

Placed so that no boundary depends on the weekday of seeding. With M the Monday of the current week: the range
"30 days" always contains [M − 23 d, now) and never [.., M − 30 d). So sample facts that must be in the range end in
weeks 3 to 6 of the six charted weeks (from the Saturday of week 3), those that must not end on a Monday of weeks
0 to 2, and nothing ends in between. The durations are tables (found once with a small solver, then written down):
per stage group, the visits of weeks 3–6 with the wanted median and p90 and with weekly means that add up to the
chart's totals.

## The screen

Tiles are the kit's `statCard`. The weekly chart is a row of six stacked columns (flex, heights from the data, a
legend in words); spend is a list of labelled `meter`s; the stage table is the kit's `dataTable` with a two-part bar
whose parts are labelled in text ("72% agents · 28% people").

## Tests

- `test/services/metrics.test.js`: facts from each event type; compute on small hand-made histories (medians,
  p90, first pass, sent back, unknown entries ignored, empty range says so).
- `test/metrics.test.js`: the four test-script steps through the API on a fresh seed, with the real lifecycle
  engine for step 3; roll-ups rebuilt after deletion and after a day's events change; reconcile exits 0, and 1
  when a roll-up is tampered with.
- `test/e2e/home.spec.js`: the Metrics screen against the mockup's numbers, the range switch, axe and 375px.
