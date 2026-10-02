# Lesson 1: What is a harness?

## Start with what a model *can't* do

Forget everything you know about Claude Code, Cursor or noobly. Let's just look at the raw thing.

A large language model (an **LLM**) is, from the outside, a function:

```
f(text in) → text out
```

You send it some text. It sends back more text that is likely to come next. That's it.

Here's what that means in practice. A raw model:

| It cannot… | Because… |
|---|---|
| remember your last message | each call is independent; nothing is kept between calls |
| read a file on your disk | it runs on someone else's server and has no access to your computer |
| run your tests | it can only *produce text*, not execute anything |
| know today's date, or which folder you're in | it knows only what's in its training data and in the text you send |
| stop itself from doing something dangerous | it doesn't *do* anything at all, so the question doesn't even come up yet |

So how does Claude Code "read your files, edit them, run the tests and fix the failures"? The model does none of that. **The program around the model does.**

## The definition

> A **harness** is the program that sits between a language model and the world. It turns a text-in/text-out function into something that can act: it remembers, it runs tools, it shows results, and it enforces limits.

The name comes from horses. A horse is strong, but you can't plough a field with a horse standing in it. The harness connects that strength to the plough and lets the driver steer and stop it. The model is the horse. noobly is the harness. You hold the reins.

You'll often see it written like this:

```
agent = model + harness
```

The model brings **judgement**: understanding your request, reading code, deciding what to do next. The harness brings **everything else**: memory, hands, eyes, safety and a user interface.

## The trick that makes it work

If the model can only produce text, how does it "use a tool"?

**It writes a request, and the harness carries it out.**

When the harness calls the model, it also sends a list of tools in a structured format: *"there's a tool called `Read` that takes a `file_path`"*. The model was trained to sometimes reply with a structured request instead of plain prose:

```json
{ "type": "tool_use", "name": "Read", "input": { "file_path": "package.json" } }
```

That is still only text. Nothing has happened yet. The **harness** sees this block, reads the file itself, and sends the contents back to the model in the next call. The model reads them and continues.

That's the whole secret. Everything you'll learn in this course builds on it.

## The four jobs of a harness

Every feature in noobly (or Claude Code, or any coding agent) does one of four jobs. Learn these four words and you can place any feature you meet:

| Job | The question it answers | Examples in noobly |
|---|---|---|
| **1. Loop** | How does the model get to act, see the result, and act again? | the agent loop, tools, streaming, retries |
| **2. Control** | What is the model *allowed* to do, and who decides? | permissions, plan mode, the sandbox, hooks, checkpoints |
| **3. Context** | What does the model see on each call? | system prompt, NOOBLY.md, reminders, compaction, memory, skills, repo map |
| **4. Interface** | How do people (and programs) talk to it? | the Ink terminal UI, `-p` headless mode, the `query()` library, ACP for editors |

Lessons 3–6 take these one at a time. Lesson 7 puts them back together.

## Why not just make the model smarter?

That's a fair question, and the answer explains why harnesses matter.

- **Some things simply can't be in the model.** Your files, today's date and your test output didn't exist when it was trained. Something has to fetch them and pass them in.
- **Some things *shouldn't* be up to the model.** "Never delete my home directory" has to hold even if the model is confused, or if it read a malicious file telling it to. A rule in code holds every time. A sentence in a prompt only usually holds. (Lesson 5.)
- **The same model performs very differently in different harnesses.** Better tools, better context and better feedback after each edit often help more than a bigger model does. That's why noobly's v2 phases (24–27) are about the harness, not the model.

## Where this lives in noobly

You don't need to read these yet. Just notice that the four jobs map onto folders:

```
src/core/loop.js        ← Loop: the heart. ~460 lines; the whole agent.
src/providers/          ← Loop: how to talk to Anthropic / OpenAI / Grok
src/tools/              ← Loop: the "hands"
src/permissions/        ← Control
src/sandbox/            ← Control
src/hooks/              ← Control
src/checkpoints/        ← Control
src/context/            ← Context
src/memory/, src/skills/← Context
src/ui/                 ← Interface
```

## Check yourself

1. In one sentence, what can a raw language model do?
2. When "the model reads a file", which program actually opens the file?
3. The model replies with a `tool_use` block. Has anything happened on your computer yet?
4. Name the four jobs of a harness. Which one does "plan mode" belong to? Which one does "NOOBLY.md" belong to?
5. Why is "don't run `rm -rf`" better enforced in code than written in the prompt?

<details><summary>Answers</summary>

1. Turn text into more text.
2. The harness (noobly), on your machine.
3. No. It's only a request, written as text. The harness decides whether and how to carry it out.
4. Loop, Control, Context, Interface. Plan mode → Control. NOOBLY.md → Context.
5. A prompt is a request the model usually follows; code is a rule that always holds, even if the model is wrong or was tricked by text it read.

</details>

**Next:** [Lesson 2: The model is a function](./02-the-model-is-a-function.md)
