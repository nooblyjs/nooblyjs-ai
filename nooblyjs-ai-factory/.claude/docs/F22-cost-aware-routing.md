# Phase F22: Cost-aware routing

**Goal:** spend strong models where they change the outcome.

Since F09, each role has had one tier: triage `fast`, building `balanced`, specs `strong`. It's simple, but it pays the same for "add a subtract function" as for "fix the time-zone bug in date arithmetic", and the same for the fixer's third attempt as for its first. F22 makes the model depend on **what's happening in this run**.

```bash
factory run issue.md --repo . --routing cheap-first
factory bench --routing cheap-first --label cheap --repeat 3     # vs --routing static
factory metrics                                                  # cost and success per station AND tier
```

---

## Policies are data (`src/routing/policy.js`)

```json
"cheap-first": { "stations": {
  "build":  { "start": "fast",     "climbOn": ["retry", "low_confidence", "medium_or_large"] },
  "repair": { "start": "fast",     "climbOn": ["repair", "human_review"] },
  "spec":   { "start": "balanced", "climbOn": ["retry", "low_confidence"] } } }
```

- **start**: the tier a station begins at (default: its role's).
- **climbOn**: the signals that move it up the ladder, **fast → balanced → strong**, one step per signal (a signal can weigh more: the fixer's third attempt counts 2).
- **max** caps it (default `strong`).
- Stations a policy doesn't mention keep their **role's tier**.

| Built-in | What it does |
|---|---|
| `static` | the pre-F22 behaviour (the default) |
| `cheap-first` | build and repair start at `fast`, spec at `balanced`; each climbs on trouble |
| `escalate` | role tiers, climbing on trouble |
| `strong` | everything on the strongest tier (a ceiling for bench comparisons) |

Choose one per run (`--routing`), per factory (`routing.policy` in `~/.factory/config.json`), or define your own under `routing.policies`.

### Signals: from the run's own history

| Signal | True when | Why it predicts difficulty |
|---|---|---|
| `repair` | the fixer is on attempt N+1 (weight N) | a cheaper model already failed to fix it |
| `retry` | the station runs again because its agent failed | it ran out of turns, errored or refused |
| `low_confidence` | the triager's new `confidence` < 0.6 (`routing.lowConfidence`) | it said so up front |
| `medium_or_large` | triage sized it medium or large | more to hold in mind |
| `human_review` | a person asked for changes (F15/F18) | people's feedback deserves the better model |

`signalsFor` and `routeTier` are **pure functions**: run history in, a tier and a *reason* out. That's what makes them testable, and it makes the decisions explainable after the fact.

### Every decision is an event

`agentFor` (the one place every station makes an agent, since F12) asks the policy, sets the model, and records it:

```
route.decided { step: 'repair', role: 'fixer', policy: 'cheap-first', tier: 'balanced',
                model: 'claude-sonnet-5-5', reason: 'fast + repair → balanced', signals: ['repair'] }
```

`factory logs` shows it (`⇅ fixer: claude-sonnet-5-5 (fast + repair → balanced, policy cheap-first)`).

**Never override a person.** An explicit `--model`, or a role's own `model:`, is **pinned** (`reason: pinned (…)`). For a non-Anthropic provider, the tiers (Anthropic model ids) aren't applied, as in F09.

### The triager's confidence

The triage JSON gets an optional `confidence` (0–1): *how sure are you this is well understood and straightforward as described?* It's optional, so older scripts and models that leave it out still work (it's `null`, and no signal fires). The triager is the cheapest model; this is the cheapest possible difficulty estimate.

## Measuring it

### Per station *and tier* (`factory metrics`)

Each `route.decided` is paired with the step it chose the model for, giving cost and success by tier:

```
  station      tier        steps  succeeded   cost/step
  build        fast            2        50%     $0.1000
  repair       balanced        1       100%     $0.3000
  repair       fast            1         0%     $0.0500
```

This is the table that tells you whether a policy is working. If `build/fast` succeeds 95% of the time at a third of the price, cheap-first pays. If it succeeds 60% and the repairs then climb to `strong`, it doesn't.

### Policy against policy (`factory bench --routing`)

```bash
factory bench --routing static      --label static --repeat 3
factory bench --routing cheap-first --label cheap  --repeat 3
factory bench --compare bench/results/…-static.json --compare bench/results/…-cheap.json
```

`--compare` (F19) shows cost per resolve, resolve rate with spread, per-case flips, and whether the difference is **within noise**.

## The checkpoint, honestly

*A routing policy that lowers cost per resolve without lowering resolve rate beyond noise, or a write-up of why it didn't.*

**Not run: there's no model API key in the environment I built this in**, and routing only matters with real models. Scripted agents write the same thing on every tier. Checked offline:
- the policy flows through `factory bench --routing` (oracle, 2 cases: both resolved, decisions recorded);
- every decision and signal is covered by tests;
- in real runs, a confident item's builder gets the `fast` model and a low-confidence one gets `balanced`; `--model` pins; `static` behaves as before.

What I'd expect, and what to look for when you run it:

- On the 21 bench cases (small, clear), **cheap-first should cut cost per resolve substantially**. Most cases are one function; a fast model plus the gates (F04), the Stop hook (F07) and the fixer (F13) should resolve most of them.
- The risk is **hidden in the repairs**. A cheap builder that fails often buys `balanced` and `strong` fixer attempts, which can cost more than a `balanced` build would have. Check `repair` rows in the per-tier table.
- The cases most likely to **flip to lost**: `add-days-utc` (time zones), `csv-quotes` (quoted-field parsing), `parse-duration` (strict validation). Low triage confidence should catch those; if it doesn't, the triager's confidence is miscalibrated. That's worth a F21 learning in itself.
- If resolve rate drops beyond noise, try `escalate` (role tiers, climbing on trouble): it saves less but risks less.

Record the numbers here when you run it.

## What was built

| File | What it does |
|---|---|
| `src/routing/policy.js` | `POLICIES`, `signalsFor`, `routeTier`, `policyFor` |
| `src/line/stations/common.js` | `routeModel`: every agent step asks the policy; `route.decided` |
| `src/line/stations/triage.js`, `roles/builtin/triager.md` | the optional `confidence` |
| `src/metrics/*` | cost and success per station and tier |
| `src/commands/{run,queue,bench}.js`, `src/job/run-job.js`, `src/bench/runner.js` | `--routing` |

## What we learned

- **Buy capability when there's evidence you need it.** Start cheap; let failures, retries and the triager's doubt climb the ladder.
- **Signals from the run's own history** make routing reproducible and explainable: every decision has a reason, recorded.
- **Policies are data**, so they can be compared on the bench instead of argued about.
- **Measure per tier, not just per station**, or you can't tell a cheap success from an expensive rescue.
- **Never override a person**: pinned models stay pinned.
- How the commercial factories appear to do it: Factory.ai and Cursor route between models per task; Aider's "architect/editor" pairs a strong planner with a cheap editor; RouteLLM-style routers learn which queries need the strong model; Devin's and Codex's plans reportedly mix models by step. The common idea is to spend where it changes the outcome, and measure whether it did.
