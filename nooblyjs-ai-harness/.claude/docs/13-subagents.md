# Phase 13: Subagents

**Goal:** let the model hand a job to **another agent** with its own, empty context window, and get back only the answer.

---

## The problem: context is precious

Ask "where are settings read, and where are they written?" and the agent will Grep, then Read ten files, then Grep again. Every one of those results **stays in the conversation** and is re-sent (and paid for) on every later request, long after the answer was found. The window fills with material you'll never need again.

## The idea: delegate, and keep only the answer

A **subagent** is just another `Session`:

```
you ─► main agent ──Task("find where settings are read")──► explore subagent
                                                             fresh, EMPTY history
                                                             Grep, Read, Read, Read…  (its context fills up, not yours)
       main agent ◄──── one tool_result: "Settings are read in src/config/settings.js:62 and…" ◄──┘
```

The main conversation grows by **one tool call and one short answer**, however much work the subagent did.

## The `Task` tool (`src/tools/task.js`)

```js
Task({
  subagent_type: 'explore',
  description: 'Find settings readers',       // 3-5 words, shown to you
  prompt: 'Find every place in src/ where settings are read. Report file:line and what is read.',
})
```

The subagent knows **nothing** about your conversation, so the description tells the model to write a complete, self-contained prompt.

## The agents (`src/agents/definitions.js`)

| Agent | Tools | Instructions |
|---|---|---|
| `general` | all (except Task and ExitPlanMode) | do the task, finish with a short report |
| `explore` | Read, Glob, Grep | read-only search; reply with a *concise* report with file:line evidence |
| yours | you choose | from `.noobly/agents/<name>.md` or `~/.noobly/agents/<name>.md` |

```markdown
---
name: test-runner
description: Runs the tests and reports only what failed. Use after changes.
tools: Bash, Read, Grep, Glob
model: claude-haiku-4-5
---
Run the project's test command. Report the failures, not the full output. Don't fix anything.
```

(`examples/agents/test-runner.md` is a copy to start from.) The agents are listed in a **Subagents** section of the system prompt, so the model knows who it can call. `/agents` lists them for you.

## Running one (`src/agents/subagent.js`)

`runSubagent()` builds a child Session and runs the **same agent loop** on it:

| | Child gets | Why |
|---|---|---|
| History | **empty** (just the prompt) | the whole point |
| System prompt | the usual sections + "You are the explore subagent… only your FINAL reply is returned" | it must know its answer is all that counts |
| Tools | the parent's, filtered by the agent's `tools` (wildcards like `mcp__github__*` work) | `explore` can't edit |
| Task, ExitPlanMode | **never** | depth limit 1: subagents can't start subagents |
| Permissions | the **same object** as the parent | same rules and "don't ask again" answers; **plan mode binds it too** |
| Permission questions | forwarded to your UI, labelled "asked by the general subagent" | you're still in control |
| Hooks | PreToolUse/PostToolUse only | Stop hooks are about *your* task, not a helper's |
| Provider, settings, cwd | the parent's (the model can be overridden per agent) | |

Only the child's **last assistant message** goes back as the Task tool's result. Its history is thrown away.

## Parallel subagents

Two `Task` calls in one reply can run **at the same time**. But two `general` agents editing the same files at once would be chaos, and two permission dialogs could pop up together. So:

```js
isReadOnly: true,               // the gate never asks about Task itself (each of the child's calls is checked)
isConcurrencySafe: (input, session) => /* true only if every tool of that agent is read-only */
```

`batchTools()` in the loop now asks `isConcurrencySafe(input)` when a tool has it:

```
[Task(explore), Task(explore), Task(general), Read]  →  [explore, explore] [general] [Read]
                                                          parallel         alone     alone
```

## Seeing progress: tools can now emit events

Before this phase a tool was a black box: `tool_start`, a wait, then `tool_end`. A subagent can take a minute, so you'd see a spinner and nothing else.

The loop now gives each tool `ctx.emit(event)`. The subagent forwards its tool calls through it as `{ type: 'subagent', parentId, agent, event }`. The catch is that the loop is an async generator, and it's stuck in `await Promise.all(tools)`, so it can't `yield` those events. The fix is a tiny **channel** (`src/core/channel.js`): tools `push()` into it, the loop does `yield* channel` until the tools finish and close it. The UI shows the last few calls under the Task line:

```
⠼ Task(explore: find settings readers)
  ⎿ … 3 earlier tool uses
  ⎿ ● Grep(readSetting)
  ⎿ ● Read(src/config/settings.js)
  ⎿ … Read(src/cli.js)
```

## Cost: cheaper context, not free

The subagent's tokens are real. A Task's result carries its `usage` and `cost`, and the loop adds them to the turn, so `/cost` and the stats line include them.

| Delegation is **cheaper** when | Delegation is **more expensive** when |
|---|---|
| the work reads a lot and the answer is short (searches, "how does X work?") | a single Read/Grep would do: the child's system prompt + tools cost more than the answer |
| the main conversation is long (every extra token there is re-sent many times) | you need the details afterwards anyway (the parent will re-read the files) |
| several independent questions can run in parallel (wall-clock time too) | the task needs back-and-forth with you: a subagent can't ask you questions |

## Try it

```bash
noobly --echo
❯ task read package.json                           # an explore subagent reads it
❯ tasks read package.json | find src/mcp/*.js      # two explore subagents, in parallel
❯ /agents
```

With a real model: *"Find every place settings are read and every place they're written"*, and watch two explore subagents run side by side. Compare `/context` afterwards with doing it inline.

## What we learned

- A subagent is **just another session running the same loop**. The loop being a reusable async generator pays off again.
- **Context isolation** is the product: only the summary crosses back.
- Share the **safety** state (permissions, mode) but not the **working** state (history, todos, read files).
- Parallelism needs a rule for **what may safely overlap**: "read-only" was good enough for tools; subagents need "every tool it has is read-only".
- Long-running tools need a way to **report progress** without breaking the event stream.
