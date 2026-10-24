# nooblyjs-ai-factory: lines and stations

**Lesson 03 · about 15 minutes · 2026-10-24**

## What you'll learn

- How the factory organizes work as a **line**: a series of **stations** that pass a run through step by step.
- How each station is a function that decides what to do next (ask a question, run the agent, commit code, decide draft vs ready).
- How lines are data (a JSON file), not hard-coded, so you can change the workflow without changing code.

## The idea, in plain words

Imagine a factory assembly line: a car frame comes down the line, goes through painting, then assembly, then quality checks, then delivery. Each station does one job, hands off to the next, and only moves forward when its job is done. Some stations might send the car back to the previous station if there's a problem.

The Software Factory works the same way. An issue comes in, and the factory moves it through a line of stations:

1. **Triage**: Is the issue clear? Ask questions if not.
2. **Spec**: Write the specification (if it's a big item).
3. **Build**: Run the agent to make the change.
4. **Verify**: Run tests and gates to check the change is good.
5. **Review**: Have a human (or a reviewer agent) read the code.
6. **Repair**: If something failed, loop back and fix it.
7. **Deliver**: Open the pull request on GitHub.
8. **Merge**: Wait for approval, then merge.

Each station is a simple function: "Given the run's current state, what should we do next?" It doesn't have to know what came before or what comes after. The factory's engine calls `decide(run, line)` every time something changes, and `decide` returns the next action (ask a question, start an agent, commit, etc.). The executor then performs that action, records an event, and asks `decide` again. If the process crashes, `decide` is called again and makes the same decision.

The stations themselves are defined in a JSON file, not in code. You can add a new station, reorder them, add conditions (like "skip spec for small issues"), or add retries without touching the code.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/services/line/engine.js` | `decide(run, line)`: a pure function that looks at the run's state and returns the next action. It never changes the run; it only says what to do. |
| `src/services/line/stations/` | Each station (triage.js, spec.js, build.js, verify.js, review.js, repair.js, deliver.js) is a function that takes a run and context and does its work, or asks a question, or returns a "stop" result to say it's done. |
| `src/services/line/executor.js` | `execute(action)`: performs the action returned by `decide`, records events, and calls `decide` again. This is the loop that keeps runs moving. |
| `lines/*.json` | The line definitions: an ordered list of stations, with optional conditions (`when`) and retries. `lines/default.json` is the factory's main line. |
| `src/services/line/conditions.js` | How to evaluate a `when` condition (e.g. "skip this station if the issue is small"). |

## A small piece of code

**`src/services/line/engine.js:45–75`** — The line engine, `decide`:

```javascript
// Given a run and a line, what's the next action?
export function decide(run, line) {
  // 1. Find where the run is in the line.
  const index = line.findIndex(s => s.kind === run.station);
  if (index === -1) throw new Error(`Station ${run.station} not found in line`);
  
  // 2. Is this station done? If so, move to the next one.
  if (run.done_at) {
    return moveToNextStation(run, line, index + 1);
  }
  
  // 3. Should we skip this station? Check the condition.
  const station = line[index];
  if (!shouldRun(station, run)) {
    return moveToNextStation(run, line, index + 1);
  }
  
  // 4. What should happen next?
  if (run.agent_waiting) {
    // Agent is running; wait for it to finish.
    return { kind: 'wait' };
  } else {
    // Time to start the agent.
    return { kind: 'start_agent', station: station.kind };
  }
}
```

This shows the logic: the engine is a state machine. It looks at where the run is, checks conditions, and returns the next action. The executor then carries out that action and records an event. The engine is called again with the new run state.

**`src/services/line/stations/build.js:30–55`** — A station, `build`:

```javascript
export async function build(run, context) {
  const { agent, workspace, repo } = context;
  
  // Pick the right agent and model for this work
  const agent = agentFor(run.role, repo.config.models);
  
  // Run the agent in the workspace
  const result = await agent.run({
    task: run.spec.tasks,
    workspace: workspace.path,
    timeout: 3600,
  });
  
  // Record what happened
  return {
    kind: 'result',
    status: result.success ? 'success' : 'failure',
    changes: result.changes,
    output: result.output,
  };
}
```

A station is simple: it takes a run and context (agent, workspace, etc.), does its work, and returns a result. The engine and executor handle everything else (recording events, moving to the next station, retrying).

**`lines/default.json`** — The line definition (data, not code):

```json
[
  { "kind": "triage", "when": { "size": "any" } },
  { "kind": "spec", "when": { "size": ["medium", "large"] } },
  { "kind": "build", "retries": 3 },
  { "kind": "verify", "when": { "gates": true } },
  { "kind": "review", "when": { "scope": "trusted" } },
  { "kind": "repair", "retries": 5, "when": { "failed": true } },
  { "kind": "deliver" },
  { "kind": "merge" }
]
```

This says: run triage for all issues, skip spec for small ones, run build with 3 retries, skip review for untrusted scopes, and so on. If you want to add a new station or change the order, you edit this file, not the code.

## Try it

Start the factory and watch a run move through the line:

```bash
node bin/factory.js dashboard
```

Then in another terminal:

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-slow.json --autonomy L2 --allow-unsandboxed
```

Watch the dashboard: you'll see the run move from triage → build → verify → deliver. Each station shows up as a row, and when it's running you see the agent's output. Look at the browser console to see logs from the line engine.

Then check the event log:

```bash
node bin/factory.js logs <run-id>
```

You'll see every event: "triage started", "build started", "verify gates passed", "deliver pull request opened". Each event is a line in the log.

## Words to know

- **Line**: An ordered list of stations that a run moves through. It's defined in JSON, not code.
- **Station**: A function that does one step of the work (triage asks questions, build runs the agent, verify runs tests). Each station is independent.
- **Condition**: A rule that decides whether a station should run (e.g., "skip spec for small issues"). Conditions use the run's data and are checked at the start of each station.
- **Decide**: The pure function `decide(run, line)` that looks at the run's state and returns the next action.
- **Executor**: The loop that performs actions, records events, and calls `decide` again.
- **Retry**: A count of how many times a station should be tried again if it fails. Retries are defined in the line.
- **Result**: What a station returns: success, failure, or a "stop" message (like "spec is waiting for approval").
- **Agent**: The `nooblyjs-ai-harness` worker that runs the actual code changes.
- **Workspace**: A temporary copy of the repo where the agent makes changes. Each agent step gets its own workspace.

## Summary: what you've learnt

- **The factory is a line of stations.** Each station is independent and doesn't need to know what came before or after.
- **The line engine is a pure function.** `decide(run, line)` looks at the run's state and returns the next action. It never changes anything itself.
- **Lines are data.** They're defined in JSON files, so you can change the workflow, add conditions, add retries, or add stations without touching code.
- **Stations are simple.** They take a run and context, do their work, and return a result. The engine and executor handle state, events, and movement.
- **Every decision is recorded.** The executor records every action as an event, so the run's whole history is preserved and auditable.
- **Conditions gate stations.** A station can be skipped if its condition says so (e.g., "skip spec for small issues"). Conditions are part of the line definition.
- **Retries are built in.** If a station fails, the line says how many times to try again. The engine and executor handle retry logic automatically.
