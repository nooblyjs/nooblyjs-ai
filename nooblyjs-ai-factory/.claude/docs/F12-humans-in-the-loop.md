# Phase F12: Humans in the loop

**Goal:** put people exactly where they add the most, and nowhere else. **Graduated autonomy** says how much happens without a person. Human gates **park** a run, so waiting costs nothing. And a person's "no, because…" goes back to the agent that did the work.

---

## The idea: humans are gates and oracles, and waiting must be free

A factory that asks about everything is a slow assistant. A factory that asks about nothing is a liability. The answer used across the industry is **graduated autonomy**: the operator decides, per repo, how far the factory goes alone.

| Level | Plan gate (after spec) | PR gate | Typical use |
|---|---|---|---|
| **L0** suggest | **stop**: the spec is the output | — | exploring a new repo |
| **L1** supervised *(default)* | **a person approves** | a person merges | features |
| **L2** gated | automatic | a person merges | bugs, chores in trusted repos |
| **L3** autopilot | automatic | **the factory merges**, if green, no blocking findings, no protected paths | docs, dependency bumps |

### Trust is the operator's to give (`src/humans/autonomy.js`)

```json
{ "autonomy": "L1", "repos": { "calc": { "autonomy": "L2" } } }      ← ~/.factory/config.json
```

plus `factory run … --autonomy L2` (the operator again). An **issue** may only *lower* it, with a label like `autonomy:L0`: someone filing an issue, or a repo's own files, must never give the factory more freedom than the operator did. (It's the same shape as F09's role invariants: config can narrow, not widen.)

## The approval station (`src/line/stations/approval.js`)

```
triage → spec → APPROVE → build → verify → review → deliver → MERGE (L3 only)
```

At L1, with a spec to approve:

1. the spec is pushed as its own branch, **`factory/issue-1/spec`**, so a person can read it in their own repo;
2. an **inbox** entry is opened (the criteria, the tasks, how to read the files);
3. the run **parks**.

**Parking is the point.** A parked run holds **no lease, no slot, no model session**. The scheduler counts it as neither queued nor running, and it costs nothing while a person has lunch. It's not an agent sitting in a loop asking "are you there yet?".

When someone answers, the run goes back in the queue (or carries on at once with `--now`). The executor asks `decide()` again, which runs the approval station again, and this time there's an answer:

| Answer | Then |
|---|---|
| **approved** | build |
| **rejected** `--feedback "…"` | **rewind to the spec station**, with the feedback |

Answers are tied to the **exact spec** they judged (its commit sha): approving version 1 doesn't approve version 2.

### Rejection is feedback to the producer

The revised spec doesn't start from scratch. The spec station starts **from the rejected version's commit** (so the writer edits it, reading first), and its prompt says:

```
A person reviewed an earlier version of this spec and REJECTED it. That version is in
.factory/specs/issue-1/ now (Read the files before you change them). Their feedback, newest first:
- "Also handle empty input." (sam)
Revise the spec to address the feedback. Keep what was right.
```

The revised spec comes back to the same gate for approval. The PR ends up with both spec commits, so the history shows what changed and why.

## The inbox (`src/humans/inbox.js`, `factory inbox`)

One place for everything that waits for a person, as events plus a projection (who approved what, when, is kept forever):

| Kind | Example | Commands |
|---|---|---|
| ✋ approval | "Approve the spec for local#1: Add parse" | `factory approve <id> [--now]` · `factory reject <id> --feedback "…" [--now]` |
| ❓ question | (from F16's `ask_human` tool) | `factory answer <id> "…" [--now]` |
| 🔐 policy | "The builder was refused Bash(npm install left-pad)" | `factory approve <id>`: adds the rule to the role |

A rejection **requires** feedback ("the agent redoing the work has to know what to change"), and an entry can be answered only once.

### Policy gaps: a permission bridge that doesn't lie

When nobody is at the keyboard, the harness answers "ask" with **no** and tells the agent which rule would allow it (`--allow "Bash(npm install:*)"`). Silently no helps nobody, so the factory reads that refusal from the event stream and turns it into a 🔐 **policy** entry, with the rule the harness suggested. `factory approve` on it adds the rule to that **role** in *your* config (`roles.builder.allow`), for the next run. Rules add up across layers, so it can't drop the built-in ones.

It doesn't pause the agent mid-session to ask. That would need the harness to resume a session after a person answers (harness track H34). What it does is make every refusal visible and one command away from being fixed.

## L3: the factory merges (`src/line/stations/merge.js`)

Only at L3, and only when **all** hold: the run was delivered (gates green, no blocking findings), the change touches **no protected path** (`.github/`, the factory's own config, roles and steering, harness settings, lockfiles), and merging is safe in the checkout (the base branch is checked out and clean). Otherwise it says why, and the PR waits for a person like at L2.

## Bugs found on the way

- **The scope check ate a dot.** F08's spec scope check parsed `git status --porcelain` by column (`line.slice(3)`). Our `git()` helper trims its output, and a *modified* file's line starts with a space (` M .factory/…`), so the first line lost its space and then its `.`. F08's tests only ever *created* spec files (`?? …`, no leading space). The revised spec in F12 was the first to *modify* one. It now asks git for file names directly (`diff --name-only`, `ls-files --others`).
- **Scripted demos need per-attempt replies.** Each `factory` command is a new process that reloads the script, so a spec station that runs again after a rejection replayed its *first* answer. Scripts may now say `"spec#2"` for a station's second run.
- **…and an off-by-one in that.** The station's context holds the run as read *before* the new `step.started` was recorded, so "this attempt" is `tries + 1`. The first version used `tries`, and try 2 replayed attempt 1's spec (unchanged → "wrote nothing" → failed → try 3 worked). `factory logs` showed the wasted try; the story is clean now.
- **Nothing was said about check problems.** "check: 1 problem(s)" didn't say which. It names them now, which is how the dot bug above was found in one step.

## Changes to the plan

- There's **one approval gate** (the plan gate). At L1/L2 the **PR gate is the PR itself**: a person merges it. At L3 it's the merge station.
- **Questions from agents mid-run** (`ask_human`) arrive with F16's tools; the inbox and `factory answer` are ready for them. *(Built in F16: the run parks until a person answers, then the step starts again with the answer.)*
- **Harness permission asks** become visible policy gaps rather than parking the agent mid-session (that needs H34).

## What was built

| File | What it does |
|---|---|
| `src/humans/autonomy.js` | L0–L3, the gate table, `autonomyFor` (operator gives, issue may only lower) |
| `src/humans/inbox.js` | Open, answer, list; the `inbox` projection (migration 3) |
| `src/line/stations/approval.js` | The plan gate: stop / auto / park; approved / rejected (rewind) |
| `src/line/stations/merge.js` | The L3 merge, with protected paths |
| `src/forge/local.js` | `merge` (only when safe), idempotent |
| `src/line/executor.js` | Autonomy for the run and for `when`; **park**; **rewind** with feedback |
| `src/line/stations/spec.js` | Revise from the rejected version, with the feedback |
| `src/line/stations/common.js` | Policy gaps from the event stream |
| `src/commands/inbox.js` | `inbox`, `approve`, `reject`, `answer`, with `--now` |
| `src/exec/harness/script.js` | Per-attempt script replies (`"spec#2"`) |

## Try it: the checkpoint

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

node bin/factory.js run examples/issues/add-parse.md --repo /tmp/calc \
  --script examples/scripts/parse-with-approval.json --allow-unsandboxed
#   autonomy L1 (default) … parked · run run-…

node bin/factory.js inbox
#   ✋ ask-…  Approve the spec for local#1: Add parse
#       R1.1 WHEN parse(s) is called with a numeric string THE SYSTEM SHALL return that number
#       Read it: git -C /tmp/calc show factory/issue-1/spec:.factory/specs/issue-1/requirements.md

node bin/factory.js reject <id> --feedback "Also handle empty input." --now
#   rewound to spec: "Also handle empty input." … parked (the revised spec, for approval)

node bin/factory.js inbox
#       R1.2 IF parse(s) is called with an empty string (or only spaces) THEN THE SYSTEM SHALL throw a TypeError …

node bin/factory.js approve <id> --now
#   plan approved by you · build · verify: test passed · review · delivered
node bin/factory.js logs <run>
```

The story, from `factory logs`:

```
└ spec: 1 requirement(s), 1 criteria, 1 task(s)
│ ✋ asked a person: Approve the spec for local#1: Add parse
⏸ parked: waiting for a person
│ ✍ hello: rejected — "Also handle empty input."
⏮ rewound to spec: … (feedback: "Also handle empty input.")
└ spec: 1 requirement(s), 2 criteria, 1 task(s)
│ ✋ asked a person …
⏸ parked
│ ✍ hello: approved
└ build: agent success · 1 commit(s)
└ verify: gates passed (clean checkout)
└ review: approve
■ finished: delivered
```

## What we learned

- **Graduated autonomy**: the operator decides how far the factory goes alone, per repo; nothing else can raise it.
- **Waiting must be free.** Park the run: no lease, no slot, no session. Resume on an answer.
- **Tie answers to exactly what was judged** (a commit sha).
- **A "no" carries its reason back** to the agent that produced the work, which revises rather than restarts.
- **Make refusals visible.** A policy gap in the inbox beats a silent "denied".
- **Auto-merge needs more than green**: no blocking findings, no protected paths, a safe checkout.
- **Log what a check found, not just that it found something.**
- How the commercial factories appear to do it: Kiro has "supervised" vs "autopilot" modes; GitHub's Copilot coding agent opens draft PRs and a human approves CI and merges; Devin asks for confirmation on consequential steps and waits for answers in Slack; merge bots (Mergify, GitHub auto-merge) merge only when required checks and reviews pass and protected paths have owners' approval.
