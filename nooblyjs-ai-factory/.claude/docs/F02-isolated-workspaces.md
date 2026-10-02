# Phase F02: Isolated workspaces

**Goal:** give every agent step its own place to work (folder, branch, sandbox settings, harness home) so several can run at once without touching each other, or you.

---

## The idea: isolation is what makes "unattended" and "parallel" possible

In F01 the agent worked wherever you pointed it, usually your own checkout. Fine when you're watching. Not fine for a factory:

- **Your checkout isn't the factory's to touch.** It has uncommitted work, the branch you're on, your hooks.
- **Two agents in one folder** overwrite each other's files (harness Phase 29 hit this with subagents).
- **Unattended** means nobody is there to notice a bad `rm` or a leaked secret. The damage has to be *limited by construction*.

So each step gets a **workspace**:

```
~/.factory/
├── repos/
│   └── home-me-my-app.git/         ← a bare MIRROR of the repo (one per repo, shared)
│       ├── refs/remotes/origin/*   ← upstream branches: updated by `git fetch`
│       └── refs/heads/factory/*    ← the factory's branches: one per workspace
└── workspaces/
    └── ws-mh3k2c9a-4f1a2b/         ← ONE STEP
        ├── meta.json               ← what this is (branch, base, status, result)
        ├── harness/                ← NOOBLY_HOME for this step's agent
        │   ├── settings.json       ←   written by the factory: sandbox + deny rules
        │   └── projects/…/*.jsonl  ←   written by noobly: the transcript
        └── repo/                   ← a git WORKTREE: the only folder the agent may write
```

## Three ways to isolate, and why worktrees (for now)

| | Worktree of a mirror | Full clone per step | Container |
|---|---|---|---|
| Start-up | fast: files only, history shared | slow for big repos | slowest (image, mounts) |
| Disk | files only | a whole `.git` each | image layers |
| Isolation of files | own folder and branch | own everything | own everything |
| Isolation of the *process* | **none by itself**: relies on the harness OS sandbox | same | real: own filesystem, network, users |
| When | M1: trusted repos, one machine | when steps must not share refs | F23: untrusted repos, remote workers |

A worktree only isolates *files*. What stops an agent's `cat ~/.ssh/id_rsa` is the **harness's OS sandbox** (harness Phase 20), which the factory switches on for every workspace. So the real isolation is the sum of the two: **worktree for files + sandbox for processes**.

## The mirror

Why not `git worktree add` straight from the operator's own repo? Because that would add branches and worktree records to *their* `.git`. Instead the factory keeps its own bare mirror (`src/exec/workspace/mirror.js`):

```bash
git init --bare ~/.factory/repos/<slug>.git
git remote add origin /home/me/my-app                          # or a URL
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git fetch --prune origin                                        # before every new workspace
```

That fetch refspec is the important line. Upstream branches land in `refs/remotes/origin/*`, and the factory's branches live in `refs/heads/factory/*`. A fetch, even with `--prune`, **can never overwrite or delete a factory branch**. (A `git clone --mirror` would map *everything* onto `refs/heads/*`, and pruning would happily delete our branches.)

### Pin the base

`main` is a moving target. The workspace records what `main` *was* when the step started:

```
baseRef: main
baseSha: c45ec8be9730…   ← the worktree is created from THIS, not from "main"
```

If someone pushes to `main` while the agent works, the agent's starting point doesn't move. The next workspace fetches again and starts from the new commit. The test `the base is pinned` checks both halves.

### Read the config from the pinned commit too

`.factory/config.json` is read with `git show <baseSha>:.factory/config.json` through the mirror, **not** from the operator's working copy. An uncommitted edit on your disk can't change what a factory run does. Same inputs, same run: that's what makes a run reproducible (and later, a benchmark fair).

```json
{
  "network": ["registry.npmjs.org"],
  "setup": { "command": "npm ci", "cacheKey": ["package-lock.json"], "cachePaths": ["node_modules"] }
}
```

## The trust puzzle: how do you configure the harness for a workspace?

This took the most thought. The factory must set the agent's **sandbox** (network allowlist) and **permission rules**. But the harness deliberately **ignores** a project's `sandbox` and `permissions.allow` settings until a human trusts the project (harness Phase 10/12: a cloned repo must not be able to switch the sandbox off). Writing `.noobly/settings.json` into the checkout would (a) be ignored, and (b) end up in the commit.

The way through comes from the harness's own settings layers:

```
defaults → USER ($NOOBLY_HOME/settings.json) → project → local → env → FLAGS
             ▲ trusted: "you wrote it"                               ▲ trusted
```

The harness trusts its **user** layer. And `NOOBLY_HOME` is just an environment variable. So every workspace gets **its own harness home**, and the factory writes `settings.json` there:

```json
{
  "sandbox": { "enabled": true, "network": ["registry.npmjs.org"] },
  "permissions": { "deny": ["Bash(git push:*)", "Bash(git remote:*)", "Bash(git config:*)", "Bash(gh:*)"] }
}
```

Nothing goes into the checkout. The repo can't override it. And there's a bonus: the harness writes its **transcript** into that same folder, so every step's full record sits next to its workspace (the contract test checks this).

**The in-process driver can't do this.** An environment variable belongs to the whole process, not to one session, so two in-process agents can't have two `NOOBLY_HOME`s. They get the same settings through `createSession({ settings })` (the flags layer, also trusted) instead. It's one more reason subprocess is the production driver: **per-run configuration through the environment only works with one process per run.**

## Who commits? The control plane.

When the agent is done, `releaseWorkspace()`:

1. `git add -A && git commit --no-verify` in the worktree: **the factory commits, not the agent**,
2. counts commits since the base, makes a `--stat`,
3. removes the checkout (unless `keep`),
4. if there were no commits, deletes the branch too: nothing to review, nothing left behind.

Why doesn't the agent commit? A worktree's `.git` is a *file* pointing into the mirror, which sits outside the workspace. In the sandbox the agent can only write inside its workspace, so `git commit` would fail there anyway. That's fine, because it matches the rule from the Architecture: **the control plane owns branches.** `--no-verify` skips the repo's git hooks, which are the repo's code and would run outside any sandbox.

**Failed runs keep their checkout** (`status: kept`), with the work committed, so a human can look at exactly what the agent left.

## The setup cache

Most repos need `npm ci` (or similar) before an agent can run tests. Doing that for every step wastes minutes. So `setup-cache.js` runs it once per **cache key**:

```
key = sha256( command + cachePaths + blob ids of the cacheKey files at the base commit )
```

A **blob id** is git's hash of a file's contents (`git rev-parse <sha>:package-lock.json`), so there's nothing to read or hash ourselves. Lockfile unchanged means same key, which means copy `node_modules` from `~/.factory/cache/<slug>/<key>/`. Lockfile changed means a new key, so setup runs again. It's the same idea as CI caches keyed on `hashFiles('package-lock.json')`.

Three details:

- **Single-flight:** two workspaces that miss the same key *at the same time* don't both install. The second waits for the first, then copies. (Test: two at once, `calls.length === 1`.)
- **Atomic:** the cache is built in a temp folder and *renamed* into place, with a `.complete` marker. A crash half-way never leaves a cache that looks finished.
- **Never committed:** cached folders are added to the mirror's `info/exclude` (git's private `.gitignore`, shared by all worktrees). Even if the repo forgot to ignore `node_modules`, release won't commit it.

Setup is the **repo's own code** (`npm ci` runs install scripts), so it runs in the harness sandbox too. `src/exec/sandbox.js` uses the harness's `createSandbox().spawn()`, the same policy the agent's Bash gets, with no second sandbox implementation.

## No sandbox on this machine: what then?

This machine doesn't have bubblewrap installed, which forced a careful answer:

| | No sandbox | Decision |
|---|---|---|
| Factory-run commands (setup, later gates) | would run with your full permissions | **refuse**, unless `--allow-unsandboxed` |
| Agent: read and edit files | harness file tools stay inside the project | fine |
| Agent: Bash, no allow rules | the harness *asks*, and in a factory run "ask" means **no** | fine: it just can't run commands |
| Agent: Bash **allow rules** or bypass mode | those commands would run unsandboxed | **refuse**, unless `--allow-unsandboxed` |

`isolationProblem()` encodes that table, and the check runs *before* a workspace is created. **Fail closed, with a message that says how to fix it** (`sudo apt install bubblewrap`).

## A bug the tests missed and the checkpoint found

The first checkpoint ran two `factory agent` commands at once, and one died:

```
Error: git remote failed: error: remote origin already exists.
```

Both **processes** saw "no mirror yet" and both tried to create it. The in-process queue (`serially`, the same trick as harness Phase 29) only orders work *within one process*. The unit test ran both agents in one process, so it passed.

The fix, `withRepoLock()` in `git.js`, is a **lock file**:

```js
fs.writeFileSync(`${dir}.lock`, String(process.pid), { flag: 'wx' });   // "wx": create, or fail if it exists (atomic)
… work …
fs.rmSync(`${dir}.lock`);
```

A process that crashes while holding the lock would block everyone forever, so the lock holds its **pid**, and `process.kill(pid, 0)` (signal 0 sends nothing, it only asks "does this process exist?") detects a dead owner and takes over.

The new test starts **four real processes** at once against a fresh repo. It fails with the old code (checked on purpose, by temporarily reverting) and passes with the lock. **Concurrency tests have to use the same kind of concurrency as production.**

## A bug in the plan, too

The Architecture said the item branch would be `factory/<item>` and task branches `factory/<item>/<task>`. Git refuses:

```
fatal: cannot lock ref 'refs/heads/factory/item1/task1': 'refs/heads/factory/item1' exists
```

Git stores refs as files (`refs/heads/factory/item1`), and a file can't also be a folder. The plan now uses `factory/<item>/main` for the item branch, with every branch of an item under one folder. Stand-alone workspaces use `factory/ws/<name>-<rand>`.

## What was built

| File | What it does |
|---|---|
| `src/exec/workspace/git.js` | `git()` runner; `serially()` (in-process queue); `withRepoLock()` (cross-process lock, stale-lock recovery); commit identity |
| `src/exec/workspace/mirror.js` | The bare mirror, fetch refspec, default branch, pinning a base, reading files at a commit |
| `src/exec/workspace/repo-config.js` | `.factory/config.json`: `network`, `setup`; validation and warnings |
| `src/exec/workspace/harness-settings.js` | Per-workspace harness settings and the harness home |
| `src/exec/workspace/worktree.js` | `acquire` / `release` / `list` / `clean` |
| `src/exec/workspace/provider.js` | The `WorkspaceProvider` interface (containers plug in here in F23) |
| `src/exec/workspace/setup-cache.js` | Cached, single-flight, atomic setup |
| `src/exec/sandbox.js` | Run a command in the harness sandbox; when running without one is acceptable |
| `src/exec/step-runner.js` | One step: check isolation → acquire → setup → agent → release |
| `src/commands/workspace.js` | `factory workspace create / list / release / clean` |
| `factory agent --repo …` | F01's command, now optionally in a fresh workspace |

## Try it

```bash
# A throw-away FACTORY_HOME, so nothing lands in ~/.factory:
export FACTORY_HOME=/tmp/factory-demo

# A tiny repo to work on:
mkdir -p /tmp/hello && cd /tmp/hello && git init -q -b main && echo "# hello" > README.md && git add -A && git commit -qm init && cd -

# THE CHECKPOINT: two agents at once (scripted models, offline), one repo:
node bin/factory.js agent --repo /tmp/hello --script examples/scripts/add-greeting.json  --permission-mode acceptEdits "Add a greeting" &
node bin/factory.js agent --repo /tmp/hello --script examples/scripts/add-changelog.json --permission-mode acceptEdits "Start a changelog" &
wait

node bin/factory.js workspace list
git -C $FACTORY_HOME/repos/*.git log --oneline --all --graph     # two branches from the same base
git -C /tmp/hello branch                                          # your repo: untouched, just main

# A real noobly process in a workspace (echo model), then look at its transcript:
node bin/factory.js agent --repo /tmp/hello --echo "read README.md"
find $FACTORY_HOME/workspaces -name '*.jsonl' -not -path '*checkpoints*'

# By hand:
node bin/factory.js workspace create --repo /tmp/hello --name manual
node bin/factory.js workspace release <id> --message "A note"
node bin/factory.js workspace clean

# No sandbox + Bash allowed → refused, with the fix in the message:
node bin/factory.js agent --repo /tmp/hello --echo --allow "Bash(ls:*)" "run ls"
```

What you should see from the checkpoint:

```
* dfc88c5 factory: Add a greeting
| * 4a590d8 factory: Start a changelog
|/
* c45ec8b init
```

## Harness notes (for the harness track)

- **H35:** the harness sandbox hides `~/.noobly` but not `~/.factory`, so an agent can *read* other workspaces (and later the factory's database). A `sandbox.hidden` setting would fix it. Added to the Roadmap.
- **H31:** `src/agents/worktree.js` in the harness has fixed branch names (`noobly/…`) and locations (`~/.noobly/…`). A configurable, exported version would let the factory reuse it instead of having its own.
- A per-run `NOOBLY_HOME` already gives subprocess runs trusted settings, so `--trust-workspace` (H35) matters mainly for in-process runs.

## What we learned

- **Isolation = files + processes.** A worktree separates files; only the OS sandbox limits what a process can do. You need both.
- **Keep the factory's git state away from yours**: a mirror with its own ref namespace, and a fetch refspec that can't touch it.
- **Pin inputs** (the base commit, the config at that commit). Reproducibility is a property you design in.
- **Configure through a trusted channel.** The harness's trust rules are right. The factory works *with* them via a per-run harness home instead of weakening them.
- **The control plane owns branches.** The agent edits files; the factory commits, and later pushes.
- **Cache by content, build atomically, never let two do the same work at once.**
- **Fail closed, and say how to fix it.**
- **In-process locks don't stop other processes.** Test concurrency with the same kind of concurrency production has, and check the test fails without the fix.
- How the commercial factories appear to do it: every one of them (Devin, Codex cloud, Copilot's coding agent, Jules, OpenHands) runs each task in a **fresh, isolated environment** (a VM or container) cloned from the repo, with a setup/environment script and cached dependencies, and turns the result into a **branch** for review. Ours is the same shape, one machine and one sandbox at a time.
