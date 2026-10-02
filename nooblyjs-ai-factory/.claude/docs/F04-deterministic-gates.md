# Phase F04: Deterministic gates

**Goal:** stop trusting what the agent *says* and check what it *did*. After every build, the factory runs the repository's own checks itself. The checks, not the agent, decide whether a PR is ready.

---

## The idea: a claim is not a fact

F03 ended with a bug where the agent confidently wrote "Added GREETING.md" while its Write had been refused. Models do this: they summarise what they *meant* to do, and they're often sure the tests pass without having run them.

A factory can't have a human re-check every claim, so it needs **facts a program can decide**:

| | Decides | Can the agent talk its way past it? |
|---|---|---|
| The agent's summary | "All tests pass!" | it *is* the agent |
| An LLM reviewer (F11) | "looks correct to me" | sometimes |
| **`npm test` exits 0** | yes or no | **no** |

That's what **deterministic** means here: same code, same result, whatever anyone thinks. PRD principle 4: *deterministic before probabilistic before human.* Cheap certain checks first, judgement later, people last.

## Gates, declared by the repo

A **gate** is a command whose exit code is the verdict. The repo lists them in `.factory/config.json` (read from the pinned base commit, F02):

```json
{
  "gates": {
    "lint": "npm run lint",
    "test": { "command": "npm test", "timeoutMs": 300000 },
    "e2e":  { "command": "npm run e2e", "fast": false }
  },
  "timeoutMs": 600000
}
```

The **order is the order they run in**, so put the cheapest first. (JavaScript objects keep the order keys were written in, as long as the keys aren't numbers.)

## The gate runner (`src/exec/gates/runner.js`)

```
agent stops ──► lint ✅ ──► test ❌ ──► e2e ⏭️ skipped
                (fresh sandboxed shell in the workspace, each with a time limit)
```

| Rule | Why |
|---|---|
| **Run by the factory, after the agent** | the agent can't skip, fake or misread it |
| **Fresh shell, in the sandbox** | it's the repo's code; and a clean shell means no leftover state from the agent's session |
| **Fail fast** | after the first failure, more failures rarely help, and each one costs minutes |
| **A time limit per gate** | a hung test is a *failure* (`timeout`), not a hung factory. The whole **process group** is killed, since `npm test` starts children of its own |
| **Couldn't run = failed** | "no sandbox, not allowed" is status `error`, never a pass. **Fail closed.** |
| **An excerpt of the output** | the useful part, for the PR and for the agent |

Gates only run when the agent **finished** (`success`). A half-done change failing its tests tells nobody anything.

### The excerpt

A failing test suite can print thousands of lines. What failed is almost always at the **end** (the summary, the last stack trace), with a little context at the **start**. So `excerpt.js` keeps the first 10 lines and the last 40, with a marker for the cut, and strips colour codes. It's the same shape as the harness's Phase 26 previews.

## The Stop hook: let the agent see the verdict *before* it hands in

If the factory only checks at the end, a failing change means a failed job and (from F13) a whole repair round. Cheaper: tell the agent **while it's still working**.

The harness already has the mechanism (harness Phase 12). A **Stop hook** runs when the model is about to end its turn. Exit code 2 means "not done": the hook's message goes to the model and the loop continues, at most 3 times. So every workspace with gates gets one:

```json
"hooks": { "Stop": [{ "command": "node …/src/exec/gates/stop-hook.js …/workspaces/<id>/gates.json", "timeout": 70 }] }
```

What the agent sees when it tries to stop too early:

```
Stop hook: not done yet. The factory's checks failed, so the work is not done yet.
Check "test" (`node --test`) failed:
  ✖ subtract … 8 !== 2 …
Fix the cause (not the check), then finish again. Do not weaken or skip tests to make them pass.
```

Four details matter:

1. **The hook is a hint; the gate runner is the verdict.** After the agent stops, the factory runs *all* gates again itself. The hook runs only the `fast` ones (`"fast": false` keeps a 20-minute e2e suite out of the agent's loop).
2. **The agent can't change which checks run.** The hook reads `gates.json`, which lives in the workspace folder, **outside the checkout**. And the gate runner uses the config read from the **base commit**. One test has the agent rewrite `.factory/config.json` to `{"gates":{}}`, and the check still fails.
3. **The hook is trusted because of *where* it is configured.** The harness ignores a project's own hooks until you trust the project, but it trusts its **user** layer and flags, which are exactly where the factory puts it (the per-workspace harness home from F02, or `createSession({ settings })` in-process). It's the same channel as the sandbox settings.
4. **The hook itself is not sandboxed** (harness hooks run as plain commands), so it doesn't run the gates directly. It calls the factory's gate runner, which runs each gate **in the sandbox**.

## Refuse early, before spending money

On a machine without a sandbox, the gates can't run (unless the operator passes `--allow-unsandboxed`). The first version found that out *after* the agent had run and been paid for. Now the step runner checks as soon as it has read the repo's config:

```
acquire workspace → read config → "has setup or gates, no sandbox, not allowed?" → refuse (no agent, no cost)
```

The test checks that the scripted model received **zero** requests.

## What the PR says now

| Situation | Job status | PR |
|---|---|---|
| Agent finished, all gates pass | `delivered` | **ready**, with a ✅ checks table |
| Agent finished, a gate fails | `gate_failed` | **draft**: "The checks fail. The agent's summary may say otherwise: the checks decide." + ❌ table + the failure excerpt; workspace kept |
| No gates configured | `delivered` | ready, but with a warning: **"nothing verified this change"** |

That last row is deliberate. A missing check must never look like a passing one.

The agent's claim stays in the PR, as a quote, **right next to the fact**:

```markdown
> Added subtract(a, b) in subtract.js with a test. All tests pass.     ← the claim
| ❌ test | `node --test` | failed | 0.1s |                               ← the fact
    AssertionError: 8 !== 2
```

## What was built

| File | What it does |
|---|---|
| `src/exec/workspace/repo-config.js` | `gates` and `timeoutMs` in `.factory/config.json` |
| `src/exec/gates/runner.js` | `runGates()` (ordered, fail fast, timeouts, fail closed) and `formatGates()` (the PR table) |
| `src/exec/gates/excerpt.js` | Head + tail of long output |
| `src/exec/gates/stop-hook.js` | The Stop hook script: fast gates → exit 2 with the failure |
| `src/exec/workspace/harness-settings.js` | Installs the hook; writes `gates.json` outside the checkout |
| `src/exec/step-runner.js` | Refuse early without a sandbox; gates after the agent; keep the checkout on failure |
| `src/exec/sandbox.js` | `runCommand` now reports `timedOut` and duration |
| `examples/make-demo-repo.sh` | A tiny `calc` repo with a real `node --test` gate |

## Try it

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

# THE CHECKPOINT: a buggy change (subtract copies the + from add), and an agent that insists "All tests pass":
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-buggy.json --allow-unsandboxed
#   → gate_failed; the PR is a draft with "8 !== 2" in its Checks section

# The same issue, but this agent listens to the Stop hook and fixes its bug:
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-self-fix.json --allow-unsandboxed
#   → delivered; the SAME PR is updated to ready, with a ✅ table

cat $FACTORY_HOME/forge/*/prs/issue-1.md
```

(`--allow-unsandboxed` because this machine has no bubblewrap. With it installed, leave the flag off and the gates run in the sandbox.)

> **Since later phases:** the default line now also has triage (F07), review (F11) and repair (F13). The buggy script's fixer doesn't manage the fix, so the run escalates and still ends `gate_failed`, with a Repairs section; the self-fixing script is reviewed and delivered. `npm run check:examples` runs every doc's example.

## What we learned

- **An agent's claim is not evidence.** Keep the claim, but put the fact next to it, and let the fact decide.
- **Deterministic first.** Exit codes are cheap, certain and can't be argued with. Judgement (LLM review, humans) comes after.
- **Fail fast, time-limit everything, fail closed.** A check that couldn't run is a failed check.
- **Give the agent the verdict early** (the Stop hook) so it fixes its own mistakes, but **re-check independently** at the end.
- **Keep the rules out of the agent's reach.** The gates are read from the base commit and stored outside the checkout.
- **Check the cheap preconditions before the expensive step.** Refusing after the agent ran would waste money.
- **"No checks" must never look like "checks pass".**
- How the commercial factories appear to do it: Copilot's coding agent runs the repo's CI (GitHub Actions) on its PR, but only after a human approves the workflow run. Codex and Devin run the project's tests in their environment and report the results in the task log. Kiro's agent hooks run checks on events like file saves. The common thread: **CI-style checks are the gate, not the model's own report.**
