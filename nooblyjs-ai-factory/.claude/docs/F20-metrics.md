# Phase F20: Metrics

**Goal:** find out where the line is slow, expensive or untrusted, with numbers computed from the event log.

```bash
factory metrics                 # the last 7 days
factory metrics --since 30d --json
# and the dashboard's Metrics page (F17)
```

---

## The metrics

DORA's four keys (deployment frequency, lead time, change-failure rate, time to restore) measure a *delivery pipeline*. A factory has to answer two more questions: **is the agents' work any good**, and **what does it cost**?

| Metric | How | It tells you |
|---|---|---|
| **Throughput** | runs finished (and PRs delivered) per day | capacity |
| **Lead time → PR / → merge** | queued → delivered, queued → merged; **median and p90** | how long people wait; p90 shows the long tail an average hides |
| **Time per station** | step.started → finished/failed, every try added up; median, p90, total, cost, failures, retries | where the line is **slow** and **expensive** |
| **First-pass gate rate** | the *first* verify passed, before any repair | how often the builder gets it right on its own |
| **PR acceptance rate** | merged ÷ delivered | do people *want* what it makes? |
| **Human-edit rate** | lines people changed before merging ÷ lines the factory wrote | how finished was the work? |
| **Escalation rate** | runs that needed a person to rescue them | trust |
| **Repair rate** | runs that needed the fixer | quality of first attempts |
| **Cost per merged PR** | **all** spend in the period ÷ merged PRs | the true price: failed runs cost money too |

## How it's built

| File | What it does |
|---|---|
| `src/metrics/run-metrics.js` | `runMetrics(events)`: **one run's** numbers. A pure function: events in, numbers out |
| `src/metrics/factory-metrics.js` | `factoryMetrics(events, { since })`: every run in the period, aggregated; display-ready `kpis`; the text report |
| `src/metrics/merges.js` | `detectMerges(store)`: notices local merges and measures human edits |
| `src/commands/metrics.js` | `factory metrics` |
| `src/server/api.js` | `GET /api/metrics` for the dashboard page |

**Pure functions of the log.** No store, no git, no clock inside the maths. That's why the tests can feed it synthetic histories ("queued at 09:00, build 10 minutes, verify fails, one repair…") and check every number, and why a rebuilt log gives the same answers. Metrics are just one more projection of the event log (F05), computed on demand rather than stored.

### Merges and human edits

On GitHub, merges arrive as webhooks (F15). On the local forge a person runs `git merge factory/issue-3/main` and nothing tells the factory. So `factory metrics` first **looks**:

```
merged?        git merge-base --is-ancestor <factory head> main
factory lines  git diff --numstat <start>..<head>
edited lines   git diff --numstat <head>..main -- <only the files the factory touched>
```

It records `run.merged { by: 'detected', humanEdit: { factoryLines, editedLines } }`, an event (once, by key), so it's counted once and survives a rebuild. Changing one line counts as 2 (a deletion and an addition), the way git counts. Only the factory's files count: other work on `main` isn't "editing the factory's PR". It's an **upper bound**, because later unrelated commits to the same files also count; the sooner you look, the closer it is.

The dashboard's metrics page is read-only: it doesn't run git. `factory metrics` does (`--no-detect` to skip it).

## Tests

- **One run** (synthetic): lead times; build time; a failed try's time counted too; the *first* verify decides first-pass, not the one after the repair; repair cost included; escalation.
- **The factory** (three synthetic runs and one outside the window): throughput, median lead time, first-pass 1/3, acceptance 1/2, human edits 10%, escalations 1/3, cost per merged PR = *all* spend ÷ 1, slowest and priciest station.
- **Empty**: nulls, never `NaN`; `--since` forms (`7d`, `24h`, dates).
- **A real merge**: a factory run, a person merges and fixes one line of the factory's file and edits an unrelated one → `{ factoryLines: 4, editedLines: 2 }` (the unrelated file isn't counted); noticed only once; human-edit rate 50%.

## The checkpoint

*After a week of real use, find the slowest and most expensive station and write down why.*

That needs a week of real use, which is yours to do. Here are the F17 demo runs (scripted agents) through `factory metrics`:

```
  lead time → PR (median)      6.9s   (p90 11.7s)
  first-pass gates             100%
  PR acceptance                0%    (nobody merged the demo PRs)
  slowest / priciest station   build / build

  station      runs   median      p90     total     cost  failures  retries
  build           5     4.8s     4.9s     19.5s  $0.0013         0        1
  verify          5     0.3s     0.3s      1.4s  $0.0000         0        0
  review          5     0.3s     0.3s      1.2s  $0.0003         0        0
```

Build is slowest (the scripts sleep, to have something to watch) and priciest, and its one retry is the divide run starting again after its question was answered (F16). With real models, expect build to stay the most expensive. The interesting question is the second place: **review** (a second model reading every diff) or **repair** (paying twice when the first pass fails). The first-pass gate rate tells you which. To write it down: `factory metrics --since 7d` after a week, then add the answer here.

## What we learned

- **Metrics are a projection of the log.** They're pure functions, testable with made-up histories, and the same after a rebuild.
- **Medians and p90s, not averages.** One stuck run makes an average meaningless.
- **Price in the failures.** Cost per *merged* PR counts everything spent to get it.
- **Measure quality where people decide it.** Acceptance and human edits come from what people do with the PR, not from the factory's own gates.
- **Some facts must be looked for.** A local merge makes no event; noticing it is part of measuring.
- How the commercial factories appear to do it: DORA metrics (the four keys) in tools like Sleuth and LinearB; GitHub's Copilot metrics API (acceptance rates); Devin and Codex report task success and PR merge rates in their dashboards; the "PR acceptance / human edit" pair is how agent-coding studies (e.g. SWE-bench-style field evaluations) judge real usefulness.
