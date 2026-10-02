# Phase F08: Spec-driven development

**Goal:** for anything bigger than a small change, write down **what must be true** before anyone writes code: requirements, design and tasks, checked by a program, traced to each other, committed and reviewed with the code.

---

## The idea: most agent failures are specification failures

When an agent's PR is wrong, it's usually not because it can't code. It built something reasonable that **wasn't what was needed**, or it missed the case nobody mentioned ("what happens when you divide by zero?"). The fix isn't a better coder. It's writing down what "done" means, in a form that can be checked, **before** the expensive part.

```
triage says medium/large
        │
        ▼
spec-writer ──► .factory/specs/issue-1/{requirements,design,tasks}.md
     ▲                              │
     └── problems (fix, ≤ 2×) ◄── CHECK: format · EARS · coverage · references · cycles · scope
                                    │ ok
                                    ▼ committed on its own branch
builder ── starts FROM the spec commit, implements every task ──► verify ──► PR: spec + code + coverage table
```

This is the approach of Amazon Kiro (requirements → design → tasks, and the "steering" files), GitHub's Spec Kit, and older traditions of requirements engineering.

## What makes an acceptance criterion testable? EARS

**EARS** ("Easy Approach to Requirements Syntax", Mavin et al. at Rolls-Royce) is five sentence templates. Each forces a trigger or condition and an **observable** response:

| Form | Template |
|---|---|
| ubiquitous | THE SYSTEM SHALL … |
| event | WHEN \<trigger\> THE SYSTEM SHALL … |
| state | WHILE \<state\> THE SYSTEM SHALL … |
| unwanted | IF \<condition\> THEN THE SYSTEM SHALL … |
| optional | WHERE \<feature is included\> THE SYSTEM SHALL … |

"It should subtract" is a wish. "WHEN subtract(a, b) is called with two numbers THE SYSTEM SHALL return a minus b" is a test waiting to be written. The **unwanted** form ("IF … THEN") is the one that catches the forgotten error cases, like division by zero in the checkpoint below.

## The format (`src/specs/schema.js`)

```markdown
## R2: Divide two numbers
As a calc user, I want to divide two numbers, so that I can compute ratios.
- R2.1 WHEN divide(a, b) is called with two numbers and b is not 0 THE SYSTEM SHALL return a divided by b
- R2.2 IF divide(a, b) is called with b equal to 0 THEN THE SYSTEM SHALL throw a RangeError …
```

```markdown
- [ ] T2: Add divide()
  - Requirements: R2.1, R2.2
  - Paths: divide.js, test/divide.test.js
  - Depends on: none
```

The check is **deterministic**: the same spec always gets the same problems. And each problem is written for the agent that has to fix it:

```
R2.2 is not covered by any task ("Requirements: R2.2" on the task that implements it)
R1.6 is not in EARS form (WHEN/WHILE/IF…THEN/WHERE … THE SYSTEM SHALL …): "It should subtract"
T1 refers to R7.7, which is not an acceptance criterion in requirements.md
tasks depend on each other in a circle: T1 → T2 → T1
T1 declares no Paths (the files it may change)
```

(That's the harness's lesson "tool results are prompts" (harness Architecture principle 4), applied to a validator.)

## Traceability (`src/specs/trace.js`)

A matrix of which task implements which criterion. Two checks fall out of it for free: **uncovered** (a criterion nothing implements, so it silently won't get built) and **unknown** (a task citing a criterion that doesn't exist). `Requirements: R1` on a task means all of R1's criteria.

The same matrix goes **into the PR**, so a reviewer can go from each requirement to the task that implements it (and, from F11, to the test that proves it):

| Criterion | Acceptance criterion | Task(s) |
|---|---|---|
| R2.2 | IF divide(a, b) is called with b equal to 0 THEN THE SYSTEM SHALL throw a RangeError … | T2 |

## The spec station (`src/line/stations/spec.js`)

| Rule | How |
|---|---|
| Only for medium/large items | `"when": "triage.size != 'small'"` in the line. For a small, clear change a spec costs more than it saves, so small items go straight to the builder |
| Writes only its folder | permission mode `default` (nobody to ask → no) plus one allow rule, `Edit(.factory/specs/issue-1/**)`; **and** a deterministic scope check on the changed files |
| Must pass the check | **check → fix** loop in `runStep`: the problems go back to the agent, in the same workspace, up to 2 times; still broken → the station fails (and the line retries it once) |
| Builder starts from it | the build station's base is the spec's commit, so the builder can read the spec and the PR contains spec + code (two commits) |
| No Stop hook | it writes documents; failing tests are not its business (the lesson from F07) |

### Details that mattered

- **The check → fix session is new, and new sessions haven't read anything.** The harness requires reading a file before overwriting it (harness Phase 05). The first test's scripted fixer went straight to Write, was refused, and the spec stayed broken until the retries ran out. A real model usually reads first, but the fix prompt now says so explicitly ("This is a new session: Read each file before you change it"). What would really fix it is **resuming** the spec-writer's session (harness track H34), which also saves re-reading the repo.
- **`git status --porcelain` hides files inside new folders.** It shows a brand-new folder as one line (`?? .factory/`), so the scope check couldn't see a stray `.factory/config.json` inside it. It uses `--untracked-files=all`.
- **The PR's diff must start from the original base.** The builder's workspace starts at the spec commit, so its own `--stat` showed only the code. The PR now shows everything since the original base: spec **and** code.
- **Gates still come from the original base** (the `configSha` from F07), so neither the spec-writer nor the builder can change which checks run.

## Steering (`src/knowledge/steering.js`)

```
.factory/steering/product.md     what this is, for whom, what matters, what's out of scope
.factory/steering/tech.md        languages, commands, dependencies, conventions
.factory/steering/structure.md   where things live
```

Read from the **pinned base commit** (only committed, reviewed guidance counts), and put at the top of the spec-writer's and builder's prompts. Unlike issue text, steering comes from the repo's maintainers through reviewed commits, so it's presented as guidance, not fenced as untrusted. (That's also why the learning loop in F21 may only change steering through a PR a human approves.)

## `factory init`: a first draft, as a PR (`src/knowledge/init.js`)

A **deterministic** draft, from what's in the repo at a pinned commit: same input, same output, offline, free.

| From | Becomes |
|---|---|
| `package.json` scripts `lint`, `typecheck`, `build`, `test` (in that order, cheapest first; only those that exist) | `gates` |
| a lockfile | `setup` (`npm ci` / `pnpm` / `yarn`), cached on the lockfile |
| `description`, the README's first paragraph | `product.md` |
| file extensions, `engines`, `"type"`, scripts, dependencies | `tech.md` |
| top-level folders (file counts, conventional names) | `structure.md` |
| what a program can't know (who it's for, what matters, what never to do) | `_TODO (a human): …_` |

It never overwrites a file that exists, and the result is a **draft PR** on `factory/init/main`: steering shapes every future agent, so a human edits it before it counts. `--agent` adds a pass where an agent refines the drafts by reading the code (it may only write in `.factory/steering/`).

### Critique of the checkpoint's drafts (on a clone of `nooblyjs-learn-harness`)

- **`config.json`: right.** One gate, `npm run test`. `eval` (which costs money) was correctly *not* made a gate. `npm ci` is cached on `package-lock.json`, and the network is limited to the npm registry because setup needs it.
- **`tech.md`: accurate but thin.** Languages (178 JS, 15 JSX), `node >=22`, ES modules, every script, the dependencies. It can't know the conventions that matter most in that repo (dependency-free core, one concept per file, offline tests), so those stay TODOs. That's the right call, but those are exactly what an agent most needs. That argues for `--agent`, or for a human filling them in before trusting the factory with the repo.
- **`product.md`: good.** The description and the README's one-line summary.
- **`structure.md`: the first version was noise.** It listed every top-level *file* (`.gitignore`, `package-lock.json`…), each with a "what lives here?" TODO, and misplaced the backticks. Now it lists folders only, with file counts and a description for conventional names (`src/` 106 files: source code; `test/` 110 files: tests).

The spec critique the roadmap asks for (a *real model's* requirements for a feature on the harness) needs an API key, which this environment doesn't have. The checkpoint below uses a scripted spec-writer. That shows the machinery (format, check, fix, trace, build from spec), not the quality of a model's specs. That judgment is still to do, with `factory run … --model …` in a later session.

## Changes to the plan

- **No separate `plan` station.** The roadmap had a planner for small items. In practice a one-file change doesn't need a planning agent: the builder's own summary covers it, and a second agent session costs more than it saves. Small items skip straight to build.
- **The spec gate (a human approving the spec before build) is F12.** Today the spec is reviewed *with* the PR, which is already better than no spec.

## What was built

| File | What it does |
|---|---|
| `src/specs/schema.js` | Parse requirements (EARS) and tasks; check a whole spec; specific problems |
| `src/specs/trace.js` | Coverage matrix; uncovered/unknown; the PR table |
| `src/line/stations/spec.js` | The spec station: scoped writer, check → fix, commit |
| `src/exec/step-runner.js` | `check` / `fixPrompt` / `maxFixes`; `prompt` may be a function of the workspace |
| `src/line/executor.js` | Build starts from the spec commit; the PR gets the coverage table |
| `src/knowledge/steering.js` | Read steering at the base commit; the prompt section |
| `src/knowledge/init.js`, `src/commands/init.js` | `factory init`: deterministic drafts (+ optional agent), delivered as a draft PR |
| `lines/default.json` | triage → **spec** (when not small) → build → verify → deliver |

## Try it

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

# THE CHECKPOINT: a medium feature, through a spec (scripted models, offline):
node bin/factory.js run examples/issues/add-multiply-divide.md --repo /tmp/calc \
  --script examples/scripts/multiply-divide-with-spec.json --autonomy L2 --allow-unsandboxed
#   triage: feature · medium · clear
#   ▶ spec
#   check: 1 problem(s); asking the agent to fix them (1/2)      ← R2.2 (division by zero) wasn't covered
#   spec: 2 requirement(s), 3 criteria, 2 task(s), all covered
#   ▶ build · ▶ verify (clean checkout): test passed · ▶ deliver
cat $FACTORY_HOME/forge/*/prs/issue-1.md                      # spec + code + the coverage table
git -C /tmp/calc log --oneline main..factory/issue-1/main      # "Spec: …" then the code

# factory init, on a CLONE (it pushes a branch to the repo you give it):
git clone -q ../nooblyjs-learn-harness /tmp/harness
node bin/factory.js init /tmp/harness
git -C /tmp/harness diff main...factory/init/main

# With a real model (needs an API key), the part still to do:
node bin/factory.js run <a feature issue> --repo /tmp/harness --model claude-sonnet-5-5 --budget 2
```

> **Since later phases:** `--autonomy L2` skips F12's spec approval (at the default L1 the run waits in `factory inbox`); the two tasks are built in parallel (F10), and a reviewer (F11) checks the result. `npm run check:examples` runs every doc's example.

## What we learned

- **Specify before you build.** The cheapest place to catch "that's not what I meant" is before the code.
- **EARS makes criteria testable**, and its "IF … THEN" form catches the forgotten error cases.
- **A deterministic checker plus a fix loop** turns a model's draft into something checkable. Problems are prompts, so write them for the fixer.
- **Traceability is a matrix**, and it belongs in the PR.
- **Scope an agent's writes twice**: permission rules, and a check of what actually changed (listing *files*, not folders).
- **A fresh session knows nothing**, not even what it read. Resuming sessions (H34) matters for fix loops.
- **Draft deterministically, leave the judgment to people, deliver as a PR.** That applies to steering files too.
- **Not every stage earns its cost.** A plan station for small changes didn't.
- How the commercial factories appear to do it: Kiro's spec mode produces `requirements.md` (EARS), `design.md` and `tasks.md`, with steering files in `.kiro/steering/`; GitHub Spec Kit has `/specify`, `/plan`, `/tasks`; Devin and Jules show a plan before coding. The common idea: **agree on the what before paying for the how.**
