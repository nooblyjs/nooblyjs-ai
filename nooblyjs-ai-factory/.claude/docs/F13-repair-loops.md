# Phase F13: Repair loops

**Goal:** when the checks fail or a review blocks a change, don't just report it: give the exact failure to a **fixer**, check again, and do that a **bounded** number of times before asking a person.

---

## The idea: failure is information

Until F12, a failing check or a blocking finding ended the run with a draft PR, and a person had to fix it. Most of those failures are *precise*:

```
Check "test" (`node --test`) failed:  AssertionError: 8 !== 2  (test/subtract.test.js:5)
Review ⛔ R1.2: divide(1, 0) returns Infinity; R1.2 requires a RangeError
```

That's exactly what an agent needs to fix it. Precise failures are cheap to fix and expensive to ignore, as long as the loop can't run forever.

```
build → verify ✗ ──► repair: FIXER gets the failure, fixes on top of the head, the factory commits
          ▲                                  │
          └────── rewind to verify ◄─────────┘   (checks, review and security review run AGAIN)
```

## The repair station (`src/line/stations/repair.js`)

```json
{ "id": "repair", "kind": "repair",
  "when": "build.agent.outcome == 'success' && (verify.passed == false || review.blocking > 0 || security.blocking > 0)" }
```

It runs only when something failed. What it does:

1. **Describe the failure**: the failing checks' excerpts, or every blocking finding (file, line, requirement, rationale, suggestion), plus the spec's acceptance criteria.
2. Run the **fixer** role (`src/roles/builtin/fixer.md`): "find the cause, make the smallest fix, never weaken a test". It works in a workspace **on top of the current head**, so the fix is a new commit and the history keeps what happened (`Fix (repair 1): check "test" failed`).
3. **Rewind to verify.** Everything after the build runs again, on the repaired code. It's F12's rewind, reused.

Later stations read the run's **current head** through `headOf(ctx)`: the build, plus any successful repairs.

## Bounded, and detecting loops

A loop that can't converge must stop and ask a person. Three brakes:

| Brake | Rule |
|---|---|
| **Attempts** | at most `repairAttempts` per run (operator config, default 2) |
| **Loop detection** | every failure gets a **signature**: which check or finding, and its most telling line (with timings and addresses normalised away). The **same signature right after a repair** means the fix didn't work, so escalate *now* rather than paying for the same attempt again |
| **No change** | a fixer that commits nothing escalates |

**Escalating** opens an inbox entry (`kind: escalation`) and lets the run continue to **deliver a draft PR**, with a Repairs section saying what was tried and why it stopped. A person gets the work *and* its history, not a blank failure.

## Repairs are history, not a station result

A rewind resets the stations after verify, including the repair station itself. If repair attempts lived only in its results, the loop would forget how many times it had tried, and never stop. So each attempt is an **event** (`repair.attempted`) kept on the run (`run.repairs`), outside the stations' results. A **new build** clears them, because those were fixes to the old build.

## Details that mattered

- **The Stop hook got there first.** In the first tests the scripted builder's bug never reached the repair loop: the builder's own Stop hook (F04) caught it and sent the builder back. That's F04 working. Bugs reach verify when the builder ignores the hook, or when the failing check is a slow one kept out of the hook (`"fast": false`). The tests use the second; the checkpoint uses the first.
- **A reducer crashed on an unknown run.** The new `step.finished` code built the updated row *before* checking the row existed. The F06 budget test, which records a step for a run it never created, caught it.
- **Tests that are about *un*-repaired outcomes** (F11's "the review blocks it", F12's "L3 doesn't merge a blocked change") now say `repairAttempts: 0`: the repair loop would otherwise (correctly) fix them. `testEnv(config)` writes an operator config for a test.
- **No session to resume.** The fixer is a fresh session with a precise brief. Resuming the builder's own session (harness track H34) would save re-reading the code. The brief is what makes a fresh session work.

## What was built

| File | What it does |
|---|---|
| `src/roles/builtin/fixer.md` | The fixer role |
| `src/line/stations/repair.js` | Describe the failure, signature, limits, fixer, commit, rewind; escalation |
| `src/line/stations/common.js` | `headOf(ctx)`: build + repairs |
| `src/store/projections.js` | `run.repairs` (kept across rewinds, cleared by a new build) |
| `src/line/stations/{verify,review,deliver,merge}.js` | Read the head, not the build alone |
| `src/line/stations/deliver.js`, `src/job/deliver.js` | The Repairs section; escalations make the PR a draft |
| `lines/default.json` | `repair` before `deliver` |

## Try it: the checkpoint

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

# The builder copies + from add() and ignores the Stop hook three times; the fixer repairs it:
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-repaired.json --allow-unsandboxed
node bin/factory.js logs <run>
git -C /tmp/calc log --topo-order --oneline main..factory/issue-1/main
```

The timeline shows both attempts:

```
│ notice: Stop hook: not done yet. … (×3, then "noobly stops here")
└ build: agent success · 1 commit(s)
└ verify: gates FAILED (clean checkout)
│ 🔧 repair 1 (checks: check "test" failed): fixed in ac7e4a21
└ repair: repaired (ac7e4a21), checking again
⏮ rewound to verify: verify, review, security, repair, deliver, merge start over
└ verify: gates passed (clean checkout)
└ review: approve
└ deliver: delivered → factory/issue-1/main
```

```
ac7e4a2 Fix (repair 1): check "test" failed
6063a1d Add a subtract function
```

## What we learned

- **A precise failure is a prompt.** Give the fixer the exact check output or finding, and the criteria.
- **Loops need brakes**: a count, a signature for "the same failure again", and "nothing changed".
- **Keep loop state outside what the loop resets.** Repairs are events on the run, not station results.
- **Fix on top, don't rewrite history.** The PR shows the build and each repair.
- **Escalate with the work**, not instead of it: a draft PR plus an inbox entry.
- How the commercial factories appear to do it: coding agents iterate on failing CI (Copilot's coding agent reacts to failing checks and review comments on its PR; Devin re-runs tests until they pass); self-healing CI tools try a bounded number of fixes and then page a human.
