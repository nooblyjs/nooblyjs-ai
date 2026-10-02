# Harnesses from first principles

A short course for getting back in touch with **noobly**, starting from nothing.

The phase notes in [`../docs/`](../docs/README.md) tell you *how each piece was built*, in the order it was built. This course does something different. It starts from one question, **"what is a model actually able to do on its own?"**, and works out why every part of a harness has to exist. Once you can rebuild the reasoning yourself, the 30 phases stop being a list to remember. Each one turns out to answer a problem you can predict.

## How to use this

Read the lessons in order. Each one is short, builds on the one before, and ends with **check yourself** questions. Try to answer them out loud before you move on. If you can't, re-read; don't skip ahead.

Two lessons have **labs**: small scripts that run offline, with no API key and no cost, where *you* play the model. Run them. Seeing the loop happen teaches more than reading about it.

| # | Lesson | The one idea |
|---|---|---|
| 1 | [What is a harness?](./01-what-is-a-harness.md) | A model only turns text into text. Everything else is the harness. |
| 2 | [The model is a function](./02-the-model-is-a-function.md) | Stateless, token-based, paid by the token. Memory is something *you* fake. |
| 3 | [The agent loop](./03-the-agent-loop.md) | The model *asks*, the harness *does*, and you repeat. That's an agent. 🧪 lab |
| 4 | [Tools](./04-tools.md) | A tool is a promise in English plus a function in code. |
| 5 | [Control and safety](./05-control-and-safety.md) | The model proposes; the harness decides. Code, not prompts. 🧪 lab |
| 6 | [Context](./06-context.md) | The context window is the model's whole world. Half the harness manages it. |
| 7 | [The whole picture](./07-the-whole-picture.md) | One message's full journey through noobly, plus a map of the code. |

**Time:** about 2 hours of reading, plus the labs.

## Labs

```bash
# from the project root
node .claude/learning/labs/watch-the-loop.js     # lesson 3
node .claude/learning/labs/watch-a-denial.js     # lesson 5
```

## The whole course in five sentences

1. A language model is a function: it takes text and returns text. It has no memory, no hands and no eyes.
2. A **harness** is the program around the model that gives it memory (re-sending the conversation), hands (tools), eyes (tool results), and judgement about what it's *allowed* to do (permissions, sandbox).
3. The core of every harness is a loop: *call the model → if it asked for tools, run them and send back the results → repeat until it stops asking.*
4. The model's only view of the world is its **context window**, so a large part of the harness decides what goes into that window and what gets left out.
5. Everything else, such as hooks, subagents, MCP, skills, checkpoints and worktrees, is a variation on those four ideas.
