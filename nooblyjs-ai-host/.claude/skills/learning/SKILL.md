---
name: learning
description: Write a simple tutorial that explains the concepts of the repo you are in (or the whole NooblyJS suite), then end with a summary of what the person has learnt. Use when the user asks to learn, be taught or get a tutorial on a repo, or when this skill runs on its periodic schedule. Covers every repo in the NooblyJS workspace.
---

# Learning: a tutorial on the repo, in plain words

The person using this skill wants to understand the code they work in, a little at a time. Teach it. Don't
just summarise the files.

## Where the output goes

- Tutorials are written to `.claude/learning/` in the **nooblyjs-ai-host** repo (`<workspace>/noobly\.claude\learning\`).
  This is the one place for every repo's lessons, so they stay in one folder.
- One file per repo and per lesson: `.claude/learning/<repo>/<NN>-<topic>.md`, where `NN` counts up from `01`.
  Example: `.claude/learning/nooblyjs-ai-factory/03-the-event-log.md`.
- Keep `.claude/learning/PROGRESS.md` up to date: one line per lesson written (date, repo, lesson, the concepts
  it covers). Read it first, so you never teach the same concept twice unless it is being revisited on purpose.

## The repos this covers

Use the repo the person is in. If they ask for "everything", or the periodic run is on, go through them in this
order, one lesson each run, and keep going round:

| Repo | Folder | What it is |
| --- | --- | --- |
| nooblyjs-ai-host | `<workspace>/noobly` | The host app: shell, Home, Product Factory screens, chat, the Teams simulator |
| nooblyjs-core | `<workspace>/nooblyjs-core` | The shared UI kit (`public/ui/`) and the service registry |
| nooblyjs-ai-teammate | `<workspace>/nooblyjs-ai-teammate` | Digital teammates: agents, tasks, billing, timesheets |
| nooblyjs-ai-product | `<workspace>/nooblyjs-ai-product` | Product Factory engine: signals, specs, architecture, drafting |
| nooblyjs-ai-host (lifecycle engine) | `<workspace>/noobly\src\lifecycle` | Items, stages, approvals, handoffs (was the repo nooblyjs-ai-workflows until 2026-10-10) |
| nooblyjs-ai-factory | `<workspace>/nooblyjs-ai-factory` | Software Factory: runs, stations, gates, PRs |
| nooblyjs-ai-knowledge | `<workspace>/nooblyjs-ai-knowledge` | Knowledge: the Wiki Platform hosted at `/wiki` |
| nooblyjs-ai-harness | `<workspace>/nooblyjs-ai-harness` | The agent runtime library |
| nooblyjs-ai-infrastructure | `<workspace>/nooblyjs-ai-infrastructure` | Infrastructure app (early) |

## Before you write anything: read the repo

Read these first, in this order, and only as much as you need:

1. The repo's `CLAUDE.md` (its rules and its current state).
2. `README.md`, and the `.claude/steering/` files if the repo has them (`product.md`, `tech.md`, `structure.md`).
3. The entry point (`index.js`, `index.mjs`, `app.js` or `server.js`) and the folder layout (`src/`, `public/`, `test/`).
4. `PROGRESS.md`, so you know what has already been taught.

Pick **one concept** that the repo uses and that has not been taught yet. Good first concepts: what the repo is
for, how it starts, where data lives, how an API route is shaped, how the UI is loaded, how tests run, how a
hosted app plugs into NooblyJS, how governance is enforced. Go from the simple thing to the harder one over the lessons.

## How to teach it

Write for someone who is learning, not for someone who knows the code. Keep the rules of this repo in mind.

- **Plain words first.** Say what the thing is in one or two sentences, then why it exists.
- **One idea per lesson.** Keep to the one concept you chose. Mention others only as "you'll meet this later".
- **Show the real code, briefly.** Quote at most 10 to 15 lines, with the file path and line number
  (`src/services/x.js:42`). Explain each important line in a sentence. Don't paste whole files.
- **Use an analogy** where it helps, and say where the analogy stops working.
- **Name the words the repo uses** (for example "hosted app", "register()", "serverManager") and explain each one
  the first time it appears. Put them in a short glossary at the end of the lesson.
- **Try it.** End the body with one small, safe thing to do in the repo: run one test file, open one page, read
  one function. Give the exact command. Don't ask the person to change production data.
- **Check you're right.** Before you state a fact about the code, read the file. If the repo's docs and its code
  disagree, say so and trust the code. Don't invent API names, file paths or numbers. Use `[PLACEHOLDER]` for
  anything the repo doesn't say.

## The lesson's shape

Each lesson file has these sections, in this order:

```
# <Repo>: <concept>

**Lesson NN · about 10 minutes · <date>**

## What you'll learn
(three short bullets)

## The idea, in plain words
(a few short paragraphs, with the analogy if it helps)

## Where it lives in this repo
(the paths, and a short reason for each)

## A small piece of code
(10 to 15 lines at most, with the path and the line numbers, and a sentence for each important line)

## Try it
(one safe step, with the exact command)

## Words to know
(a short glossary: term, one-sentence meaning)

## Summary: what you've learnt
(a short list of what the person now knows, in their terms, not ours. Three to six bullets.)
```

The summary is required and comes last. Write it as what the person now understands ("You know that a hosted app
is mounted at a path and gets a `host` object"), not as a list of files.

## After writing

1. Add a line to `.claude/learning/PROGRESS.md`.
2. Tell the person the file path and the one-sentence summary, in chat. Don't paste the whole tutorial into chat
   unless they ask.
3. Don't commit anything. Git commits happen only when the person asks.

## When it runs on its own

The skill is meant to run periodically: once a day, or each time the person opens the workspace. The run is:

1. Choose the next repo in the table that is not yet at the lesson count the person set (default: one lesson per
   repo per week). Use `PROGRESS.md` to see where each repo is.
2. Write one lesson for it, following everything above.
3. If there is nothing new to teach in that repo (every concept is taught), say so in one line and move on to the
   next repo. Don't invent a lesson.

To set up the periodic run in a session, the person can use `/loop 1d /learning`. That loop lasts only while
the session is open. A longer-lived schedule needs the `schedule` skill, which is not set up for this workspace.

## Rules

- Use the person's plain language. They use "they" and "them"; don't guess their pronouns.
- Never paste secrets, keys or the contents of `.env` files, even if you find them.
- Don't change code while teaching. You may suggest a change, but only describe it.
- Keep each lesson short enough to read in about ten minutes.
