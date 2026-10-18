# nooblyjs-ai-teammate: every agent action is a task

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- A "teammate" is a named AI agent that can be hired, given budgets and billed.
- Every time an agent does something in NooblyJS, it is run as a **task** through one function, `runTask`.
- `runTask` checks, bills and records the work, so no agent can act unseen.

## The idea, in plain words

Think of a temp agency. Every shift a temp works is logged, checked against who is allowed to book them, and
invoiced to a department. Nobody can just send a temp to a job without a booking.

In this repo, each agent action in NooblyJS goes through `runTask`. Before the agent starts, `runTask` checks that the
teammate is hired, awake (not paused or retired) and under their budget. It then runs the work, bills the hours to a
team, and writes the record.

The analogy stops working in one place: a temp does not decide their own rate. Here the rate and the budget come from
the teammate's settings, and NooblyJS never lets the agent change them.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/services/host-tasks.js` | Holds `runTask`, the one entry point for NooblyJS to ask an agent to work. |
| `src/services/invocation.js` | The step that runs the agent once the checks pass. |
| `src/services/billing.js` | Writes the timesheet entry and the billed amount. |
| `src/services/events.js` | Turns the agent's activity into events that NooblyJS can show. |
| `index.js` | Register: it builds these services on the host and returns them to NooblyJS. |

## A small piece of code

The start of `runTask`, in `src/services/host-tasks.js`, lines 71 to 83, trimmed:

```js
// src/services/host-tasks.js:71
async runTask({ slug, workType, itemId = null, system = null, input, billTo = null, caller = null, scripted = null, signal } = {}) {
  const task = typeof input?.task === 'string' ? input.task.trim() : '';
  if (!task) throw badRequest('A task needs input.task: what the teammate is asked, in words');
  // ...
  try {
    teammate = await this.invocation.preflight(context.teammateId);
  } catch (err) {
    if (err instanceof HttpError) await this.emit('teammate.task_refused', { ...context, reason: err.message, code: err.code, costUsd: 0, modelRoute: null });
    throw err;
```

- Line 71: one function, many named inputs. The caller must say which teammate (`slug`), what kind of work (`workType`) and what to do (`input.task`).
- Line 73: an empty task is refused at once. A task must say what it is for.
- Line 80: `preflight` checks the teammate before any work starts.
- Line 82: a refusal is recorded as an event (`teammate.task_refused`), with the reason and a cost of zero. Refusals are visible, not silent.

## Try it

Run the test that checks `runTask` on its own:

```
cd <workspace>/nooblyjs-ai-teammate
node --test test/services/host-tasks.test.js
```

Look for a test whose name mentions a refusal. It shows what a refused task looks like from the outside.

## Words to know

- **Teammate**: a named agent with a role, a rate and a budget.
- **Task**: one piece of work asked of a teammate. Every agent action is one.
- **Preflight**: the checks done before work starts (hired, awake, budget left).
- **Billing**: turning hours into an amount charged to a team.
- **Scripted answer**: the canned reply a task uses when no real model is configured.

## Summary: what you've learnt

- You know a teammate is an agent with a role, a rate and a budget.
- You know every agent action is one call, `runTask`, and nothing bypasses it.
- You know `runTask` checks the teammate first and records a refusal as an event.
- You know that a task is billed and recorded, so the cost of every action can be traced.
