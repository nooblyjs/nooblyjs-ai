# Phase F19: The factory bench

**Goal:** unit tests prove code; only end-to-end benchmarks prove a factory. Measure the whole line (issue in, branch out), scored by tests the factory never saw, and treat variance as part of the answer.

It builds on the harness's evals (harness phase 19): *a task, a starting point, an automatic checker, and a check of the checker.* The difference is scale: a harness eval tests one agent in a folder; a bench case tests **triage → build → verify → review → deliver → merge**.

---

## A case

```
bench/cases/csv-quotes/
  case.json    { id, title, tags, budgetUsd }
  issue.md     "parseCsvLine('a,\"b,c\",d') returns 4 fields; it should return …"
  repo/        the starting snapshot: package.json, src/csv.js, a visible test, .factory/config.json (gates)
  hidden/      test/hidden/csv.test.js: the checker, NEVER shown to the factory
  solution/    src/csv.js: a reference solution, only to check the checker
```

**Why hidden tests?** The factory's own gates run *its* tests, which it may have written to fit its own code. The hidden tests ask what the issue's author would: *does it do what I asked?*

**Resolved** = the hidden tests pass on the branch the factory produced **and** no protected path changed (F14's list).

The Roadmap imagined `repo.bundle`; a plain folder is easier to read, review and diff, and becomes a one-commit repo in milliseconds.

### 21 cases

| Kind | Cases |
|---|---|
| features | add-subtract, slugify, parse-duration, deep-merge, roman-numerals, retry-async, temperature, format-cents, unique-by, validate-email, todo-remove-toggle, cli-json-flag |
| bugs | fix-range-off-by-one, fix-clamp, word-count, csv-quotes, leap-year, chunk-validate (an infinite loop), config-no-mutate, add-days-utc (time zones: its hidden test runs in three `TZ`s) |
| refactor | rename-with-alias (every caller renamed, the old name kept as an alias, output unchanged) |

They're deliberately small. They measure the *line* first; harder cases come from real history (the miner, below).

## Check the checker: `factory bench --verify`

A checker can be wrong in two ways, and both are silent:
- it **passes on the start**, so the case measures nothing;
- it **fails the reference solution**, so nobody could pass it.

`--verify` builds each case twice (start, and start + solution), checks the repo's own tests are green at the start (the factory starts from green), and runs the hidden tests on both: **must fail, then pass**. **21/21 are sound.** The test suite runs this for every case, plus a deliberately broken case that `--verify` must catch.

## Running it

```bash
factory bench --verify
factory bench --label baseline --repeat 3 --provider anthropic --allow-unsandboxed   # real models: costs money
factory bench --agent oracle --label oracle                                          # the ceiling, no model
factory bench --agent null   --label null                                            # the floor, no model
factory bench --compare bench/results/a.json --compare bench/results/b.json
```

Each run gets a **fresh repo and a fresh `FACTORY_HOME`**, so no run sees another's state. It uses autonomy **L3** (the line runs to the end, including the merge), the local forge, and the case's budget. Cases run one after another, so timings are comparable. Results go to `bench/results/<date>-<label>.json`: every run's status, resolved, cost, time, and the hidden tests' failures.

### The oracle and the null agent

Two scripted "agents" that need no model:

| Agent | Does | Should score | If it doesn't… |
|---|---|---|---|
| **oracle** | writes the reference solution | **100%** | the *pipeline* loses correct work (a station, the scope guard, delivery) |
| **null** | writes nothing | **0%** | a case resolves without work: it measures nothing |

The results, committed as `bench/results/reference-*.json`:

```
oracle: 21 cases × 1 repeat(s) = 21 runs          null: 21 cases × 1 repeat(s) = 21 runs
  resolved     100%   21/21                         resolved     0%   0/21
  median time  0.9s per run                         outcomes     21 no_changes
  outcomes     21 merged
```

The oracle found a real rule on its first try: it scored `no_changes` because the harness's Write tool **refuses to overwrite a file the agent hasn't read**. The oracle has to read before it writes, like any agent. The null agent's runs end as `no_changes`, the rule F14 added.

## Reading results honestly (`src/bench/compare.js`)

A model isn't deterministic, so one bench run is **one sample**.

- **Repeats → a spread.** `--repeat 3` gives three resolve rates (say 60%, 70%, 65%): the mean is 65%, the spread 60–70%.
- **Noise.** If two setups' spreads overlap, the difference is **within noise**, and `--compare` says so instead of declaring a winner.
- **Flips.** The headline hides movement: B can gain two cases and lose two others. So compare **per case**: *gained* (resolved in most of B's repeats, not A's) and *lost*.
- **Cost per resolve** counts failed runs too: they cost money.

## The case miner (`factory bench mine`)

Real history makes the best cases. A commit that changed code **and** tests is a finished task with a checker:

| Part of the case | Where it comes from |
|---|---|
| `repo/` | the parent commit's tree, minus the tests the commit touched |
| `hidden/` | those tests, as the commit left them |
| `solution/` | the code files, as the commit left them |
| `issue.md` | a **draft** from the commit message, marked for a person to rewrite |

It **proposes; a person curates**. A commit message says *how* ("use reduce with 0"); an issue must say *what* ("sum([]) throws"), or the case hands over the answer. Every mined case must also pass `--verify` before it counts. It skips merges, deletions, renames, and commits over 8 files.

On this project's repos it proposed only **3** cases (2 from the harness, 1 from the factory). Nearly every commit here is a whole *phase*: dozens of files, far past the size limit. That's a finding: **mining needs small commits**. Real product repos with one-change-per-PR histories are where it shines. I didn't verify or curate those 3 proposals; that's the next step (`factory bench --verify --cases bench/proposed`).

## The checkpoint: a first baseline

*Resolve rate, cost per resolve, median time, with spread.* **No model API key is set in the environment I built this in**, so the real baseline is yours to run:

```bash
export ANTHROPIC_API_KEY=…
factory bench --label baseline --repeat 3 --allow-unsandboxed      # 63 runs; with small cases, roughly $5–15
```

Then record in this doc: resolve rate (mean and spread), cost per resolve and median time. What's recorded so far is the **pipeline's** baseline: oracle 100%, null 0%, 21/21 checkers sound. Any model result sits between those bounds, and anything under 100% is the model's (or the prompt's, or the roles') doing, not the line's.

## What was built

| File | What it does |
|---|---|
| `bench/cases/` | 21 cases |
| `src/bench/cases.js` | load cases, `materialise`, `runHidden`, `verifyCase` |
| `src/bench/runner.js` | `runCase` (a fresh repo and home, the whole line, scored), `runBench`; oracle and null agents |
| `src/bench/compare.js` | `summarise` (mean, spread, cost per resolve, median), `compare` (flips, noise) |
| `src/bench/miner.js` | `mineCases`: propose cases from git history |
| `src/commands/bench.js` | `factory bench …` |

## What we learned

- **Score with hidden tests.** The factory's own green checks are its opinion of its work.
- **Check the checker**: it must fail the start and pass the solution. Both mistakes are silent.
- **Bound the pipeline before measuring the model.** The oracle (100%) and null (0%) runs separate "the line lost it" from "the model couldn't".
- **Variance is part of the answer.** Repeats, spreads, per-case flips, and saying "noise" out loud.
- **Real history makes real cases**, but only small commits, and only after a person rewrites the issue.
- How the commercial factories appear to do it: SWE-bench (issues from real repos, hidden tests from the fixing PR; "Verified" is the human-curated subset), SWE-bench Multimodal and Live, Aider's leaderboards and OpenHands' evaluation harness. The miner is SWE-bench's recipe in miniature, and Verified is why curation matters.
