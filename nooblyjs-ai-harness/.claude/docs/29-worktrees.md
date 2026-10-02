# Phase 29: Parallel agents in worktrees

**Goal:** several subagents editing at the same time, without overwriting each other.

---

## Why editing subagents ran one at a time

Since Phase 13, read-only subagents (explore) run in parallel, but anything that could **edit** ran alone. Two agents in one folder would overwrite each other's files, and each one's "read before write" picture (Phase 05) would go stale the moment the other wrote.

## A worktree per agent (`src/agents/worktree.js`)

A **git worktree** is a second working folder of the same repository, on its own branch. Same history, separate files:

```
git worktree add -b noobly/add-logging-3f9a1c ~/.noobly/projects/<slug>/worktrees/add-logging-3f9a1c HEAD
```

`Task` gets an `isolation` option:

```json
{ "subagent_type": "general", "description": "add logging to billing", "prompt": "…", "isolation": "worktree" }
```

| When | What noobly does |
|---|---|
| before | creates the worktree + branch from **HEAD** (the last commit) |
| during | the subagent's working folder is the worktree; its system prompt says so ("use paths relative to it; don't commit") |
| after, if it changed files | commits them to its branch (as you, or as "noobly" if git has no identity), removes the folder, **keeps the branch** |
| after, if not | removes folder and branch: nothing to clean up |
| interrupted | the same, so partial work is kept on the branch, never lost |

The parent gets the report plus the branch and a `git diff --stat`. Because separate folders can't collide, worktree Tasks are **concurrency-safe**: three in one reply run at the same time.

`/merge` lists `noobly/*` branches; `/merge <branch>` merges one (`--no-ff`) and deletes it, or shows the conflicts.

## Details that mattered

- `git worktree add/remove` write shared files in `.git`, so noobly runs them **one at a time** (a small promise queue), even when the agents run in parallel.
- Worktrees start from the **last commit**. Your uncommitted changes aren't in them: commit first if the agents need them.
- Checkpoints (Phase 21) are off for worktree agents: their changes live on a branch, which is a better undo (just don't merge it).

### The sandbox, again

Each worktree agent gets its **own sandbox** (Phase 20) whose writable folder is its worktree. Trying it found two problems:

1. **git didn't work inside.** A worktree's `.git` is a *file* pointing back to the main repository's `.git`. If that's outside the sandbox's view (the main repo was under `/tmp`, which the sandbox replaces), every git command fails. Now the main `.git` is mounted **read-only** into the worktree's sandbox.
2. **Too much was visible.** Worktrees live under `~/.noobly`, a folder the sandbox hides (transcripts, trust records). The old rule "never hide a folder that contains the project" left all of `~/.noobly` readable. Now the **order** of mounts decides: a hidden folder that *contains* a writable one is hidden **first**, then the writable folder is mounted back on top, so only it reappears. A hidden folder *inside* a writable one (`~/.ssh` when the project is your home folder) is hidden **after**, or the writable mount would reveal it.

## Try it

```bash
noobly
❯ In parallel, using worktrees: add a --verbose flag to cli.js, and add a CHANGELOG entry for it.
❯ /merge
❯ /merge noobly/add-a-verbose-flag-1a2b3c
```

## What we learned

- **Isolation enables parallelism.** "Can these overlap?" becomes "they can't", by construction.
- **A branch is the natural result of agent work**: reviewable, mergeable, discardable.
- Serialize the shared parts (`.git` administration), parallelize the rest.
- Every new place code runs is a new sandbox question: here, mount **order**.
- How Claude Code appears to do it: an `isolation: "worktree"` option for its Task/Agent tool, with automatic cleanup when nothing changed.
