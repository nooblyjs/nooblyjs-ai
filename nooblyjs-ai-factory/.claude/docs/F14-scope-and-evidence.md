# Phase F14: Scope guard and the evidence bundle

**Goal:** make review fast. Prove, in one place, **what** changed, **why**, and that it stayed **within bounds**, so a reviewer can decide from the PR page instead of reconstructing the run.

---

## Part 1: the scope guard (`src/exec/gates/scope-guard.js`)

A spec's tasks declare their **Paths** (F08). That's a promise: "this task changes these files". F10 used it to plan waves, but nothing *checked* it. An agent that also tidied three other files, or edited the CI config, sailed through.

| A changed file is… | if it's… |
|---|---|
| ✅ in scope | under a task's declared path (a file, or a folder and what's in it) · any **test** file · the **spec folder** · a path a person **granted** during the run (F16's `request_scope`) |
| ⚠️ outside | anything else, when there is a spec |
| ⛔ protected | CI config, the factory's own config/roles/steering, harness settings, lockfiles, unless a task **declares it explicitly** (and even then, F12's merge station leaves it to a person) |

Without a spec (small items) nothing is declared, so only protected paths count.

**It runs as the first check in verify** (it's free and certain, and needs no sandbox), so a violation is a failure like any other: F13's fixer gets it ("README.md: outside every task's declared Paths… Revert these changes, or ask for scope"). The test has a builder that "tidies the README while it's there"; the fixer reverts it; the PR shows scope ✅.

A repo can set `"scope": "warn"` to record violations without failing. F10's merge-conflict test does, because it is *about* two tasks touching an undeclared file: since F14 that broken promise is recorded in the evidence instead of silently merged.

## Part 2: the evidence bundle (`src/evidence/bundle.js`)

The PR body **is** the evidence (`evidence.md`), and the same facts are kept as data (`evidence.json`, a run artifact) for tools, the dashboard (F17) and metrics (F20):

| Section | Answers |
|---|---|
| **At a glance** | status · checks · review · repairs · scope · **tests named** · cost, in one row |
| Summary (written by the agent) | its **claim**, as a quote |
| **Requirements → tasks → tests** | each acceptance criterion, the task(s) that implement it, and the **test lines that name it** (`test/divide.test.js:6`) |
| Checks | the gate table (now including `scope`) |
| **Scope** | ✅, or which files are outside / protected |
| Review | findings by severity, and who found them |
| Repairs | each attempt, and an escalation if there was one |
| Decisions | what agents recorded (F16's `record_decision`) |
| Changes | the diff stat since the original base (spec + code) |
| **Cost and time, by station** | including each repair attempt, adding up to the run's total |
| Review it | the commands, `factory logs <run>`, `evidence.json` |

The requirement → test link is deliberately modest: "this test line **names** R1.2", not "this test proves R1.2". Naming tests after criteria (`test('R1.2 divide by zero throws', …)`) is cheap and makes the link automatic, and a criterion with no named test shows up as ⚠️.

## The checkpoint: reading a PR cold

The roadmap asks: *read a generated PR cold, time the review, note what you still had to look up.* I generated the multiply/divide PR (a spec, two parallel tasks) and read it as a reviewer would.

**First reading, about 30 seconds: the PR was wrong, and the evidence showed it.**

```
| delivered | ✅ pass | ✅ approved | — | ✅ within declared paths | $0.0013 |
> T2 (success): T2: divide, throwing on zero.            ← reads like the START of a task, not its end
| R2.1 | … | T2 | ⚠️ none named |                        ← no test mentions R2.1 or R2.2
 multiply.js | 1 +   test/multiply.test.js | 5 +         ← no divide.js at all
```

The status said **delivered**: the gates passed (there were no divide tests to fail) and the scripted reviewer approved. But three sections, read together, told the truth in half a minute: T2's summary was odd, its criteria had no tests, and its files weren't in Changes. Two causes:

1. **A bug in my example script**: converting it to per-task replies (for F10) took T2's writes from the wrong reply, so T2's builder wrote nothing.
2. **A real factory gap**: in fan-out, **a task that changed nothing counted as done**. Now it's `no_changes`, a failure: dependents wait, and the PR is a draft that says so.

And one improvement to the evidence: **"Tests named"** is now in *At a glance* (`⚠️ none for R2.1, R2.2`), so the signal isn't only in a table further down.

**Second reading, after the fixes: about a minute**, and nothing to look up for *this* PR's questions: what was asked, what's covered, whether it passed, what it cost. What I'd still look up:

- **the code itself**: evidence says what's true about a change, not whether the code is *good*. That's still the reviewer's job, helped by the review section;
- **whether a named test really tests its criterion**: the link is a name, not a proof;
- **why** a design choice was made: the Decisions section stays empty until agents can record them (F16).

## Also found: 8 of 11 documented examples had stopped working

Before generating the checkpoint PR, I ran every `factory run --script` example from the phase docs. **Eight no longer worked.** Nothing was broken; each later phase added a station older scripts didn't know about:

| Since | Examples need |
|---|---|
| F11 (review) | a `review` reply |
| F12 (approval at L1) | `--autonomy L2` for medium items (or an approval in `factory inbox`) |
| F10 (fan-out) | one builder per task (`build:T1`, `build:T2`) |
| F13 (repair) | a fixer; for the demos whose *point* is a failure (F04, F11), a fixer that doesn't manage it, so the run escalates and still ends as the doc says |

All examples are updated, affected docs have a short "Since later phases" note, and the matrix is now a script: **`npm run check:examples`** runs every documented example against a fresh demo repo and checks its outcome. Docs are code too; they need tests.

## What was built

| File | What it does |
|---|---|
| `src/exec/gates/scope-guard.js` | `checkScope`, `scopeGate`, the protected list (shared with F12's merge station) |
| `src/line/stations/verify.js` | Scope first, then the gates, one verdict |
| `src/exec/workspace/repo-config.js` | `"scope": "strict" \| "warn"` |
| `src/store/projections.js` | `scope.granted` → `run.scopeGranted` (for F16) |
| `src/evidence/bundle.js` | `buildEvidence` (md + json), `testLinks` |
| `src/job/deliver.js`, `src/line/stations/deliver.js` | The PR body is the evidence; `evidence.json` artifact |
| `src/line/stations/build.js` | A task that changed nothing is `no_changes` |
| `scripts/check-examples.sh`, `examples/examples.txt` | `npm run check:examples` |

## Try it

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc
node bin/factory.js run examples/issues/add-multiply-divide.md --repo /tmp/calc \
  --script examples/scripts/multiply-divide-with-spec.json --autonomy L2 --allow-unsandboxed
cat $FACTORY_HOME/forge/*/prs/issue-1.md          # read it cold: how long does it take you?
node bin/factory.js logs <run>                     # 📎 evidence: evidence.json
npm run check:examples                             # every documented example, still working?
```

## What we learned

- **Declared scope is a promise; check it.** A scope guard makes "stay in your lane" a failing check with a precise message, which the fixer can act on.
- **Protected paths need a person**, even when declared.
- **The PR is the evidence**: claims and facts side by side, each fact with its source, and the same facts as data.
- **Read the output cold.** Every status was green, and the evidence still showed a missing task in 30 seconds. Summaries lie by omission; tables of facts don't.
- **"Did nothing" is not "done".**
- **Numbers must add up.** A cost table whose rows don't sum to the total is worse than none (the repair cost had vanished into a rewound station until the table took it from the run's repair history).
- **Examples rot as a system grows**: test them like code.
- How the commercial factories appear to do it: Devin and Codex attach a task log and test results to the PR; GitHub's Copilot coding agent writes a PR description with a summary and checklist; CODEOWNERS and path-based rules (branch protection, merge queues) require specific reviewers for protected paths; SLSA-style provenance attestations are evidence bundles for builds.
