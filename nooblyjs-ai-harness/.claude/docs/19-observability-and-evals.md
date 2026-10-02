# Phase 19: Observability and evals

**Goal:** *measure* the agent. Without numbers, every change to a prompt or a tool is a guess.

---

## Part A: Tracing: where does the time (and money) go?

Every turn now records a **trace** (`src/core/trace.js`, filled in by the loop):

```js
trace = {
  requests: [ { model, ttftMs, durationMs, restarts, usage, cost, stopReason }, … ],  // one per model call
  tools:    [ { name, durationMs, isError, cost? }, … ],                               // one per tool call
}
```

| Measure | Why it matters |
|---|---|
| **TTFT** (time to first token) | the latency you *feel*: how long before anything appears |
| request duration | total model time; long ones are usually long outputs, or deep thinking at high effort |
| tokens incl. cache read/write | cost, and whether prompt caching (Phase 09) actually works |
| tool durations and errors | slow tools (a test suite?) and flaky ones |
| restarts | how often the connection broke mid-reply (Phase 18) |

The trace rides on the `turn_end` event, is saved in the transcript (so `--continue` keeps it), and `/stats` summarises it:

```
❯ /stats
Turns: 4 · model requests: 11
Time to first token:  p50 1.2s · p90 2.8s · max 3.1s
Model request time:   p50 4.0s · p90 9.7s · max 12.4s
Tokens: in 3,120 · out 2,840 · cache read 118,400 · cache write 21,300
Cache hit rate: 83% of input tokens · cost $0.1340

Tools             calls  errors   total    avg
Bash                  3       1   14.2s   4.7s
Read                  9       0    41ms    5ms
Task                  1       0    8.3s   8.3s
```

**p50 and p90** (percentiles) are more honest than averages: "half the requests start within 1.2 s, 9 in 10 within 2.8 s". One very slow request can drag an average up.

## Part B: Evals: does the agent actually do the job?

An **eval** is a test for the *agent*, not the code: a task, a starting point, and an automatic check of the result.

```
test/evals/
├── cases/<name>/
│   ├── case.json    { description, prompt, tags }
│   ├── repo/        the starter project (copied to a temp folder for every run)
│   ├── solution/    what "done" looks like (used only to verify the checker)
│   └── check.js     ({ dir, answer }) => ({ pass, message })
├── checks.js        helpers: run(), fileUnchanged(), grepFiles(), changedFiles()…
├── lib.js           prepare, run, check, summarise, compare
├── run.js           npm run eval
├── variants/        ready-made A/B variants
└── results/         saved runs (git-ignored)
```

### The 10 cases

| Case | Task | The checker verifies |
|---|---|---|
| `fix-failing-test` | tests fail; fix the code, not the tests | tests pass **and** the test file is unchanged |
| `rename-function` | rename `getUsr` → `getUser` everywhere | no `getUsr` left; the program's output is unchanged |
| `add-cli-flag` | add `--shout` | 4 invocations, including "no flag = same output as before" |
| `fix-crash` | `node index.js` crashes (a missing brace) | it runs and prints the right line |
| `implement-function` | `isPalindrome` from a README spec | 8 inputs + a `TypeError` for non-strings |
| `update-json-config` | change one value, add one, keep the rest | the exact resulting object |
| `answer-question` | "which function computes shipping?" (named `computeFreightCharge`, with a decoy) | the reply names the function and file; **no files changed** |
| `create-gitignore` | ignore node_modules, logs, dist | real paths are (and aren't) ignored |
| `remove-dead-code` | delete an unused function | it's gone, the other file is untouched, output is the same |
| `list-todos` | write TODOS.md with file:line of every TODO | the three locations (and no extras) |

**Checkers test results, not steps.** They run the program and look at files. They never ask "did it use Edit?", so any correct approach passes. Checking steps rewards one way of working and punishes others that are just as good.

### Verifying the checkers (offline, in `npm test`)

A checker can be wrong in two ways: it passes when nothing was done, or it fails a correct solution. So every case has a `solution/`, and

```bash
npm run eval -- --verify
✓ add-cli-flag   starter: fails (node greet.js Sam --shout printed "Hello, Sam!", …) · solution: passes
…
```

checks both: **fails on the starter, passes on the solution**. `test/evals.test.js` does the same in `npm test`, and also runs one case end to end with a scripted mock model, so the whole pipeline is tested without an API key.

### Running them for real

```bash
export ANTHROPIC_API_KEY=…
npm run eval                                   # all cases, default model
npm run eval -- --case fix-crash --case add-cli-flag
npm run eval -- --model claude-sonnet-5-5 --label sonnet
npm run eval -- --repeat 3 --label baseline    # models vary between runs
```

Each case runs in a **throwaway copy** in bypass mode (nothing asks; deny rules still apply), with up to 30 rounds. The output is a table (✓/✗, time, tool calls, cost), a summary (pass rate, cost, tokens), and a JSON file in `test/evals/results/`.

## Part C: An A/B experiment

The point of evals is to **compare**: change one thing, run both, look at the numbers.

```bash
npm run eval -- --repeat 3 --label baseline
npm run eval -- --repeat 3 --label verify --append-system test/evals/variants/verify-before-done.md
npm run eval -- --compare test/evals/results/<…>-baseline.json --compare test/evals/results/<…>-verify.json

            baseline             verify               change
pass rate   80%                  90%                  10 points
cost        $0.4210              $0.5120              +22%
input tok.  …
Cases that changed:
  add-cli-flag: fail → pass
```

(Those numbers illustrate the output format. They are **not measured results**.)

Ready-made variants:
- `variants/verify-before-done.md` (`--append-system`): tells the model to check its work before finishing. Hypothesis: a higher pass rate for a little more cost.
- `variants/lower-compact-threshold.json` (`--settings`): a tiny context window with early compaction. Does summarising hurt multi-step tasks?

> **Status of the checkpoint:** everything above is built and tested offline. The roadmap's checkpoint (an 80%+ pass rate and a documented A/B result) needs real API runs, which cost money and need a key, so they haven't been run yet. When you run them, add the comparison table and what you conclude here.

### Reading results honestly

- **10 cases is a small sample.** One case flipping is 10 points. Use `--repeat` and look at *which* cases changed.
- **Models are not deterministic.** A single run can't separate a real effect from luck.
- **Cost and pass rate trade off.** "+10 points for +22% cost" might or might not be worth it. Decide what you're optimising before you look.
- **Don't tune the prompt to the eval.** If you keep changing things until these 10 pass, you've learned about these 10 cases. Add new cases as you find real failures.

## What we learned

- **Trace everything that's cheap to trace.** TTFT, durations, tokens and cache hits answer most "why is it slow/expensive?" questions.
- An eval is **task + starting state + checker of the outcome**.
- **Test the tests:** a checker must fail on the starter and pass on a known solution.
- Evals turn prompt changes from opinions into **measurements**, but only with enough runs, and a question decided in advance.
