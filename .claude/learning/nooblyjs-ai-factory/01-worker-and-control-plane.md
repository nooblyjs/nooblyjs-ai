# nooblyjs-ai-factory: the worker and the control plane

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- What the factory is for: an issue goes in, and a reviewable pull request comes out.
- Why the factory is split into two roles: a **worker** (the AI agent) and a **control plane** (the factory itself).
- Why the agent is never trusted to push code, report success, or see the factory's secrets.

## The idea, in plain words

The factory takes a software issue, such as "add a subtract function", and tries to produce a pull request that a person can review. The work is done by an AI agent. The factory's job is to manage that agent and decide whether its work is good enough to show anyone.

Think of a restaurant kitchen. The chef cooks at one station, with only the ingredients they need. The manager takes the plate, checks it against the order, and decides whether it goes out to the table. The chef never decides on their own that the dish is done, and they never get the cash register keys.

The repo calls these two roles the **harness** (the worker) and the **factory** (the control plane). The rule in `CLAUDE.md` is short: *the harness is the worker; the factory is the control plane.* Each agent step is a session of the harness, which the repo calls `nooblyjs-ai-host`. The factory creates the session, reads what it did, runs the checks itself, and only then commits and pushes.

Two things follow from that split:

1. **The agent's word doesn't count.** If the agent says "all tests pass", the factory runs the tests again itself. The agent's summary is shown to people, but the checks decide the outcome.
2. **The agent is kept on a short leash.** It runs in its own copy of the repo, with a scrubbed environment and with `git push` denied. Only the factory pushes.

Where the analogy stops: a kitchen manager can simply walk over and stop a chef. Here the rules are written into settings the agent process is started with, so the restriction is enforced by the program, not by good behaviour.

## Where it lives in this repo

- `src/services/exec/step-runner.js`: one agent step, start to finish. It acquires a workspace, runs the agent, runs the checks, and releases the workspace with a commit.
- `src/config/harness-settings.js`: the list of commands the agent is never allowed to run (`ALWAYS_DENY`), including `git push`.
- `src/services/exec/harness/subprocess.js`: starts the `nooblyjs-ai-host` process for the agent, with a cleaned environment.
- `src/services/job/deliver.js`: the factory's own push and pull request step. This is where the push really happens.
- `src/services/harness.js`: the one file that imports the harness. The factory never copies harness code.

## A small piece of code

The verdict. The agent may say anything, but the factory runs every gate itself (`src/services/exec/step-runner.js:109-111`):

```js
    // Phase F04: the VERDICT. Whatever the agent said, run every gate ourselves.
    // Only when the agent finished: a half-done change failing its tests tells nobody anything.
    if (step.verify !== false && result.outcome === 'success' && ws.config.gates.length) {
```

- Line 109 names the rule: the agent's report is not the verdict.
- Line 111 runs the checks only if the agent finished. A half-done change that fails its tests tells nobody anything.

The agent's restrictions (`src/config/harness-settings.js:33-35`):

```js
// Whatever a repo or a prompt says, a factory agent never does these. Only the control
// plane pushes (after checks), and the agent must not re-point or reconfigure git.
export const ALWAYS_DENY = ['Bash(git push:*)', 'Bash(git remote:*)', 'Bash(git config:*)', 'Bash(gh:*)'];
```

- Line 33 says the list applies whatever the repo or the prompt asks for.
- Line 35 is the list itself. The agent may not push, change remotes, edit git config, or call `gh`.

The agent's environment (`src/services/exec/harness/subprocess.js:66-67`):

```js
    // Phase F24: a SCRUBBED environment: the factory's own secrets never reach the agent.
    const env = { ...agentEnv(process.env), ...run.env, ...(run.harnessHome && { NOOBLY_HOME: run.harnessHome }) };
```

- The agent gets a copy of the environment with secret-looking names removed. Tokens don't reach it.

The push, done by the factory (`src/services/job/deliver.js:27-33`):

```js
  const push = await performEffect(store, {
    key: `push:${runId}:${sha}`,
    kind: 'push',
    runId,
    data: { head, sha },
    // Phase F06: check we still hold the run's lease right before touching the world.
    perform: async () => (guard(), { head, sha: await forge.pushBranch(ws.mirror, build.branch, head) }),
```

- Line 27 is the factory's own push. The `key` makes it safe to retry.
- Line 33 is the actual push, and it runs only after the factory has checked it still holds the run.

## Try it

Run the test file that checks the agent's deny list and environment rules. It runs offline and takes a second:

```bash
cd <workspace>/nooblyjs-ai-factory && node --test test/config/harness-settings.test.js
```

You should see `pass 4` and `fail 0`. The first test named in the output is "sandboxed, with the repo's network, and git push / remote / config / gh always denied".

## Words to know

- **Control plane**: the part that decides. In this repo, the factory: it creates steps, runs checks, and pushes.
- **Worker**: the part that does the work. Here, an agent running as a `nooblyjs-ai-host` session.
- **Harness**: the agent runtime library, `nooblyjs-ai-harness`. The factory uses it and never copies its code.
- **nooblyjs-ai-host**: the harness's command-line program. The factory starts one process per agent step.
- **Step**: one agent run from start to finish, in its own workspace.
- **Workspace**: a separate checkout of the repo, on its own branch, where one step works.
- **Gate**: a check the repo defines (such as its tests), which the factory runs itself.
- **Verdict**: the final yes or no on the agent's work, decided by the gates and not by the agent's summary.
- **Deny rule**: a command the agent is never allowed to run, written into its settings.
- **Scrubbed environment**: the copy of the process environment given to the agent, with secrets removed.

*You'll meet these later: the event log (every step is recorded), the line (the ordered list of stations), and `performEffect` (how a push is made safe to retry).*

## Summary: what you've learnt

- You know that the factory turns an issue into a pull request, and that an AI agent does the coding inside it.
- You know the factory is the control plane and the agent is the worker, and why the agent's own report never decides the outcome.
- You know the factory runs the repo's checks itself, after the agent finishes, to reach its verdict.
- You know the agent is stopped from pushing, changing git config or calling `gh`, and that its environment has the factory's secrets removed.
- You know the factory is the only thing that pushes a branch, and that it does so only after checks pass and it still holds the run.
- You can run `node --test test/config/harness-settings.test.js` and read which rules that test protects.
