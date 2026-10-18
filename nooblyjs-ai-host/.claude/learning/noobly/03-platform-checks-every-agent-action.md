# nooblyjs-ai-host: Platform checks every agent action

**Lesson 03 · about 10 minutes · 2026-10-11**

## What you'll learn

- Before any agent does any work, one function in Platform decides whether it may: `checkAgentWork`.
- The three things it checks, in order: the model route, the repository, the budget.
- Why a refusal is a normal answer (with a reason a person can read), and why it is always audited.

## The idea, in plain words

An agent in NooblyJS never just "goes". A chat reply, a drafted spec, a Software Factory run: each one first asks
Platform, "may this agent do this kind of work, on this repository, right now?" Platform answers yes, or no with a
reason. Only on yes does the work start, and only then can it cost anything.

Think of it as the **badge reader at a lab door**. It doesn't care who built the lab or what experiment you plan; it
checks three things on your badge and either opens or tells you why not, and writes every refusal in a book.
(Where the analogy stops: the "badge" here is the kind of work and the repository, not the agent's name. Two agents
asking for the same thing on the same repository get the same answer.)

The three checks:

1. **The model route.** Every kind of work (`spec-drafting`, `implementation`, `chat.reply`…) has a route: which
   model, on which provider. In production a route that uses a direct consumer API (not Bedrock, Vertex or Azure)
   is refused.
2. **The repository.** If the work touches a repository, Platform · Repositories says what agents may do there:
   nothing, read only, or read and open pull requests. A repository Platform doesn't know may be read, never changed.
3. **The budget.** Each system (Teammates, Product, the Software Factory, Knowledge, cloud) has a budget. At the
   limit, new agent work is refused until an Owner raises it or the period ends.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/services/platform/index.js` | `checkAgentWork()` and `repoRefusal()` |
| `src/services/platform/routes.js` | Model routes by kind of work, and which providers are allowed |
| `src/services/platform/budgets.js` | The budgets and the spend ledger |
| `../nooblyjs-ai-teammate/src/services/host-tasks.js` | `runTask()` calls the check before a task starts |
| `data/platform/` | The settings it reads: `model-routes.yaml`, `budgets.yaml`, `repositories/` |

## A small piece of code

`src/services/platform/index.js`, lines 43 to 67, trimmed:

```js
async function checkAgentWork({ system = null, workType = null, repo = null, needs = 'read', teammateId = null, itemId = null } = {}) {
  const route = workType ? await routes.forWorkType(workType) : null;
  let refusal = null;
  if (route && !routes.allowed(route.provider)) refusal = { code: 'provider_not_allowed', message: … };
  if (!refusal && repo) refusal = repoRefusal(repo, await repositories.get(repo), needs);
  if (!refusal) { const b = await budgets.refusal(system, at()); if (b) refusal = { code: b.code, message: b.message }; }
  if (refusal) {
    await auditLog.record({ actor: teammateId ?? 'platform', action: 'agent.work_refused', code: refusal.code, reason: refusal.message, … });
    return { ok: false, ...refusal };
  }
  return { ok: true, route, repository };
}
```

- The checks run **in order** and stop at the first refusal, so the reason you see is the first thing that is wrong.
- A refusal is **returned**, not thrown: the caller decides how to say it (a 402 for a budget, a 403 for access).
- Every refusal goes in the **audit log**, with the agent, the item and the reason, even though nothing happened.
- On yes, the caller gets the **route** too: which model to use for this kind of work.

## Try it

Run Platform's tests, and read the first one: a repository set to "No agent access", and a teammate refused:

```
cd <workspace>/noobly
node --test --test-force-exit test/platform.test.js
```

## Words to know

- **Work type**: the kind of work (`spec-drafting`, `chat.reply`, `implementation`); routes and budgets are by it.
- **Model route**: which model and provider does a work type.
- **Guardrail**: a rule an Owner can switch (for example "agents may open PRs"); some are locked on.
- **Audit log**: the append-only record of every write and every refusal.

## Summary: what you've learnt

- You know no agent works without first passing `checkAgentWork`.
- You know it checks the model route, the repository and the budget, in that order.
- You know a refusal comes back with a reason a person can act on, and is always written to the audit log.
- You know an Owner changes the answer by changing the settings in Platform, not by changing code.
