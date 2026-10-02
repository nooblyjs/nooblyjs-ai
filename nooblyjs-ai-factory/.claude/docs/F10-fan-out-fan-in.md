# Phase F10: Fan-out, fan-in, integration

**Goal:** when a spec has several tasks, build them **at the same time**, each by its own agent in its own workspace, then merge them back into one branch, resolving conflicts, and verify the whole.

---

## The idea: decomposition *and* integration

Parallel agents only help if two things are true:

1. **Decomposition:** the work splits into parts that don't step on each other.
2. **Integration:** the parts come back together into one working whole.

F08's spec already gives the first. Every task in `tasks.md` declares what it **depends on** and which **Paths** it touches. F10 adds the second.

```
spec commit ─┬─ T1 (multiply.js) ─┐
             ├─ T2 (divide.js)  ──┼─ merge ─► wave 1 result ─┬─ T4 (depends on T1) ─┐
             └─ T3 (power.js)   ──┘                          └─ T5 (shares a path)  ─┴─ merge ─► verify
```

## Waves (`src/line/fanout.js`)

A pure function decides which tasks can start together:

```
ready  =  not done, not failed
          and every task it depends on is DONE (and merged)
          and its Paths don't overlap another task in this wave
```

| tasks | waves |
|---|---|
| T1 (a.js) · T2 (b.js) · T3 (a.js, c.js) · T4 depends on T1 | [T1 T2] → [T3 T4] |
| three independent tasks, `taskConcurrency: 1` | [T1] → [T2] → [T3] |
| T1 (`src/`) · T2 (`src/x.js`) | [T1] → [T2]: a folder overlaps the files in it |

**Overlapping paths are kept apart on purpose.** Two agents editing the same file at once is a merge conflict waiting to happen. In different waves, the second agent starts from the first one's merged code and edits *on top of* it. It's the same logic as the F06 scheduler not running two runs with overlapping paths, one level down.

**Dependencies see merged code.** Each wave starts from the previous wave's **merge**, not from the spec commit, so T4 (which depends on T1) opens a checkout where T1's code already exists. A test reads T1's file from T2's workspace to prove it.

Waves rather than a rolling pool: a task can't start until everything it depends on is *merged*, and merging happens between waves. Simple and correct, at the cost of some idle time when one task in a wave is slow. A rolling scheduler would merge as each task finishes. That's a fine next step, but it's more moving parts to learn at once.

## Fan-in: merging (`src/line/integrate.js`)

After each wave, the **control plane** merges the task branches, one at a time, into an integration workspace:

```bash
git merge --no-ff --no-edit -m "Merge T2: Add divide()" refs/heads/factory/ws/issue-1-T2-…
```

Most merges are clean, because the waves kept declared paths apart. When git can't merge a file, it's because a task touched something it **didn't declare**. That's a broken promise, but not a reason to throw the work away:

1. the **integrator** role (`src/roles/builtin/integrator.md`) gets the worktree *mid-merge*, the conflicted files, and every task's goal: "keep what both sides were trying to do; change nothing else";
2. a **deterministic check**: no `<<<<<<<` / `=======` / `>>>>>>>` left in those files;
3. the control plane commits the merge.

An integrator that leaves markers fails the build. It's never delivered half-merged. And every conflict is recorded (`conflicts: ["T2: README.md"]`): a spec whose paths keep being wrong is a spec-writer problem (and a job for F14's scope guard).

## Details that mattered

- **A part can't pass a check of the whole.** The first version gave each task builder the gates' Stop hook (F04). In a repo whose gate checks the whole feature ("the README mentions *both* one.md and two.md"), each task was told "not done" forever, because the other half is another task's job. Now task builders run **without** the Stop hook, and the gates judge the **integrated** result at verify. It's the same lesson as F07's triager ("hooks belong to roles"), in a new form: **a check belongs at the level it describes.**
- **One scripted model can't serve parallel agents.** Replies would interleave. Scripts (and tests) give one per task: `"build:T1": [...]`, `"build:T2": [...]`, plus `"integrate"`. A script with only `"build"` for a multi-task spec fails with a message saying so.
- **The budget is shared.** Each agent in a wave gets an equal share of what's left of the run's budget. Parallel agents could otherwise each spend the whole thing.
- **A failed task doesn't lose the others' work.** Tasks that succeeded are merged; tasks that depend on the failed one aren't built; the PR is a **draft** that lists each task's outcome (`T3: not built (a task it depends on failed)`).
- **`git log` in date order isn't topological.** Commits made in the same second have the same date, so a test that expected "the spec commit comes last" was flaky until it used `--topo-order`.

## Changes to the plan

- **Integration is part of the build station**, between waves, rather than a separate `integrate` station after all tasks. Dependent tasks need merged code *before* they start, so merging has to happen inside the fan-out.
- **`taskConcurrency`** (operator config, default 3) limits agents per run. The scheduler's `maxConcurrent` (F06) still limits runs.

## What was built

| File | What it does |
|---|---|
| `src/line/fanout.js` | `nextWave`, `planWaves`, `overlaps`: pure |
| `src/line/integrate.js` | Merge a wave's branches; the integrator for conflicts; the marker check |
| `src/roles/builtin/integrator.md` | The integrator role |
| `src/line/stations/build.js` | `buildWhole` / `buildTasks` (waves) / `buildOnce`; budget shares; per-task outcomes |
| `src/commands/history.js` | `factory logs` shows waves, tasks and merges |

## Try it: the checkpoint

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

# A medium feature with three independent tasks; each scripted builder takes ~2.5 s:
echo '{ "taskConcurrency": 3 }' > $FACTORY_HOME/config.json
node bin/factory.js run examples/issues/add-three-operations.md --repo /tmp/calc \
  --script examples/scripts/three-operations-fanout.json --autonomy L2 --allow-unsandboxed
node bin/factory.js logs <run>
git -C /tmp/calc log --oneline --graph main..factory/issue-1/main

# The same, one task at a time:
echo '{ "taskConcurrency": 1 }' > $FACTORY_HOME/config.json   # (and a fresh /tmp/calc)
```

What it showed:

| `taskConcurrency` | Waves | Build (from the log's timestamps) | Result |
|---|---|---|---|
| 1 | [T1] → [T2] → [T3] | ~8 s | one integrated branch, gates pass |
| 3 | [T1 T2 T3] | ~3 s | one integrated branch, gates pass |

```
*   Merge T3: Add power()
|\
| * T3: Add power()
* |   Merge T2: Add divide()
|\ \
| * | T2: Add divide()
* |   Merge T1: Add multiply()
| * T1: Add multiply()
* Spec: Add multiply, divide and power
```

> **Since later phases:** `--autonomy L2` skips F12's spec approval (at L1 the run waits in `factory inbox`), and the script includes a reviewer (F11).

## What we learned

- **Parallelism needs decomposition *and* integration.** The spec's Paths and dependencies do the first; merges and an integrator do the second.
- **Plan waves with a pure function**: dependencies done, paths disjoint.
- **Dependents start from merged code**, so merge between waves.
- **Conflicts mean a broken promise, not failure.** Resolve them with a role and a deterministic check, and record them.
- **A check belongs at the level it describes.** Whole-feature gates judge the integrated result, not a part.
- **Share the budget** between parallel agents.
- How the industry does it: Anthropic's Claude Code can run subagents in parallel git worktrees (and so can noobly since its Phase 29); Devin and Cursor run several agents on separate branches; merge queues (GitHub, Graphite) serialise integration and re-run CI on the combined result, which is what verify does here.
