# Phase F25: Fleet campaigns

**Goal:** one change, many repositories. Templated items, rate-limited delivery, and tracking the batch as one thing.

```bash
factory campaign create --name node24 --spec examples/campaigns/node24.md --repos ../a,../b,../c   # or --repos-file repos.txt
factory serve                                   # runs them, like any queued items
factory campaign status                         # done / open / failed, per repo (and the dashboard's Campaigns page)
```

---

## What a campaign is (`src/campaign/campaign.js`)

```
campaign.created { campaignId, name, title, repos }
  ├─ campaign.item_submitted { repo, runId }   ─► an ORDINARY item: its own run, its own PR
  ├─ campaign.item_submitted { repo, runId }      (each tagged request.campaign)
  └─ campaign.item_failed    { repo, reason }  ─► recorded; the others go ahead
```

A campaign is **not a new kind of run**. It's a batch of ordinary items with a shared spec and a tag. Everything built so far applies to each one unchanged: triage, spec, gates, review, repair, the security hold, evidence, autonomy, routing, notifications, metrics.

Four things make it more than "submit the same issue N times":

| | |
|---|---|
| **One spec** | `campaign.md` is the issue every repo gets. **Each repo's own steering** (F08, and F21's learned conventions) makes the same instruction fit each repo: "upgrade to Node 24" in a repo whose `tech.md` says "we use pnpm" becomes a pnpm change there. |
| **Isolation** | A repo that can't even be submitted (not a git repo, a typo) is recorded as failed and the rest go ahead. A run that fails later is that repo's problem only. |
| **A rate limit** | At most **N campaign PRs per repo per day** (`campaigns.maxPrsPerRepoPerDay`). A fleet change must not bury one team's reviewers under five campaign PRs on a Monday. It's enforced by the scheduler (`pickRuns`), with the reason visible in `factory status`: *campaign limit: 1 per repo per day (repo-a); tomorrow*. Non-campaign work isn't held back. |
| **Batch tracking** | `factory campaign status` and the dashboard's Campaigns page: per repo ✅ done / ⌛ open / ❌ failed, the PR, the cost. |

## Scheduled items (`src/campaign/schedule.js`)

Recurring work on a clock (`~/.factory/config.json`):

```json
"schedules": [
  { "name": "deps-weekly", "cron": "0 9 * * 1", "repos": ["../a", "../b"], "spec": "schedules/deps.md" }
]
```

Every Monday at 09:00 UTC, a campaign from `deps.md` across those repos.

- **Cron, small**: five fields (minute hour day month weekday); `*`, numbers, lists, ranges and `*/n` steps; UTC. When both day-of-month and weekday are restricted, *either* matches, as in real cron (a classic surprise).
- **Once per minute, however often serve checks**: the campaign is created with the idempotency key `schedule:<name>:<minute>` (F05's keys, again).
- **No catch-up.** A `serve` that was down at 09:00 doesn't fire at 11:00. A missed weekly chore waits for next week rather than piling up.

## Tests

- **Fan-out**: one item per repo, tagged; a non-repo is recorded as failed and the other three are queued; status 0 done / 3 open / 1 failed.
- **Rate limit** (pure `pickRuns`): one campaign run per repo per tick and per day; a non-campaign run in the same repo is not held; starts earlier today count.
- **Cron**: steps, ranges, lists, day-OR-weekday, clear errors for wrong fields.
- **Schedules**: a matching minute makes one campaign, however often it's checked; other minutes nothing.
- **End to end through the scheduler**: a campaign across two repos (one listed twice: still one item) delivers one PR each, with each repo's own gates. A second campaign on the same repo the same day is held by the limit.

That last test found a bug. With a repo listed twice, `campaign status` found the *first* run both times and counted it twice. Repos are now de-duplicated when the campaign is created. The rate-limit test then became the realistic case: **two campaigns, one repo, one day**.

## Checkpoint: "Upgrade to Node 24" across the `nooblyjs-*` repos, one PR each

On **clones** of the two real repositories (the originals untouched, nothing pushed), plus a deliberately missing third, with a scripted agent that pins Node 24 in `.nvmrc`. The full upgrade (engines, fixing failing tests) needs a model.

```
campaign …: "Upgrade to Node 24" across 3 repo(s)
  ⌛ nooblyjs-learn-harness  queued run-…
  ⌛ nooblyjs-learn-factory  queued run-…
  ✗ nooblyjs-missing         nooblyjs-missing is not a git repository

factory serve --until-idle; factory campaign status
  node24: "Upgrade to Node 24"  ·  2 done · 0 open · 1 failed
  ✅ delivered       nooblyjs-learn-harness  …/prs/issue-1.md
  ✅ delivered       nooblyjs-learn-factory  …/prs/issue-1.md
  ❌ not submitted   nooblyjs-missing  (not a git repository)

nooblyjs-learn-harness: .nvmrc = 24     nooblyjs-learn-factory: .nvmrc = 24
```

With a model: `factory campaign create --spec examples/campaigns/node24.md --repos … --routing cheap-first` (F22). On GitHub repos, the items are ordinary GitHub-forge runs (F15), so each PR arrives in its own repo.

## What was built

| File | What it does |
|---|---|
| `src/campaign/campaign.js` | `createCampaign`, `campaignStatus`, `campaignStartsToday` |
| `src/campaign/schedule.js` | `parseCron`, `cronMatches`, `runSchedules` |
| `src/scheduler/pick.js`, `scheduler.js` | the per-repo, per-day campaign limit |
| `src/commands/campaign.js` | `factory campaign create \| status \| list` |
| `src/commands/queue.js` | `serve` runs schedules |
| `src/server/api.js`, `dashboard/` | `/api/campaigns` and the Campaigns page |
| `examples/campaigns/node24.md`, `examples/scripts/pin-node24.json` | the checkpoint |

## What we learned

- **A campaign is a batch of ordinary items.** Reusing the item keeps every control from F00–F24 on every repo, for free.
- **Per-repo context makes one spec fit many repos.** Steering does the adapting, not the campaign.
- **Isolate failures** at submission and at run time: one bad repo is a line in a report, not a stopped campaign.
- **Rate-limit for people**: the bottleneck of a fleet change is reviewers, not agents.
- **Schedules need idempotency and a no-catch-up rule**, or a restart turns one chore into five.
- How the commercial factories appear to do it: Sourcegraph Batch Changes (one spec → a changeset per repo, tracked together), Dependabot and Renovate (scheduled, rate-limited PRs per repo: `open-pull-requests-limit`, schedules), Google's Rosie (large-scale changes split per owner, reviewed locally), and Moderne/OpenRewrite recipes run across thousands of repos. The shared lessons: split per owner, limit the flow, track the batch.
