# Phase 16: Memory

**Goal:** let noobly carry knowledge from one session to the next: "I prefer tabs", "run tests with `npm run test:unit`", "never touch `generated/`".

---

## Why the agent forgets

The model is stateless (Phase 02), and each new session starts with an empty history. Everything the agent learned yesterday (your preferences, a corrected mistake, a decision you explained) is gone. NOOBLY.md helps, but *you* have to write it.

**Memory** is the agent writing notes to its future self.

## The surprise: memory is just files + context engineering

There's no database, no vector search, no special memory tool:

```
~/.noobly/projects/<project-slug>/memory/
├── MEMORY.md              the INDEX: one line per memory, loaded into every system prompt
├── prefers-tabs.md        one fact per file
└── test-command.md
```

```markdown
---
name: prefers-tabs
description: The user indents with tabs, never spaces
type: user
---
Use tabs for indentation in every file. The user corrected this twice.
```

1. The **system prompt** explains the conventions (`src/memory/memory.js` → `memoryPrompt()`): one fact per file, frontmatter, add a line to MEMORY.md, the four types, what *not* to save.
2. The **index** (MEMORY.md) is added to the system prompt at the start of every session. It's cheap: a line per memory.
3. The model reads a memory file with `Read` when its index line looks relevant. It writes and updates memories with the ordinary `Write` and `Edit`.

It's the same **progressive disclosure** as skills (Phase 15): an index always, details on demand.

## The four types

| Type | What | Example |
|---|---|---|
| `user` | who you are, your preferences | "prefers tabs", "is new to TypeScript" |
| `feedback` | how you want it to work: corrections *and* approaches you confirmed | "don't summarise at the end of every reply" |
| `project` | goals, decisions, constraints the code doesn't show | "the v2 API must stay backwards compatible until March" |
| `reference` | pointers to outside things | "the design doc is at …" |

And what **not** to save: things the code, git history or NOOBLY.md already record, and things that only matter for this conversation. A memory that duplicates the code will go stale and mislead.

## Why the folder is outside the project

`~/.noobly/projects/<slug>/memory/`, next to the saved transcripts (Phase 09):

- memories are **yours** (your preferences, your corrections), so they shouldn't be committed and pushed to your team by accident
- NOOBLY.md is the place for shared, reviewed project knowledge

But the file tools only work *inside* the project (Phase 05). So:

| Change | Where |
|---|---|
| `session.writableDirs` = the memory folder; `Write`/`Edit` accept it | `src/tools/paths.js`, `write.js`, `edit.js` |
| `session.readableDirs` includes it; `Read` accepts it | `src/tools/read.js` |
| The gate allows `Write`/`Edit` **inside the memory folder** without asking | `src/permissions/gate.js` (after the `acceptEdits` step) |

Deny rules and plan mode still come first. Symlinks are still resolved, so `memory/../../elsewhere` is refused. Only that one folder is opened up.

## When do new memories take effect?

The index is read **at the start of a conversation**, and after `/clear`. Not in the middle: changing the system prompt mid-conversation would break prompt caching (Phase 09) and Claude's thinking blocks (Phase 08). The model knows what it just wrote anyway: it's in the conversation.

## Commands

| Command | |
|---|---|
| "remember that …" | just ask; the model writes the file and the index line |
| "forget that …" | it deletes or edits the memory |
| `/memory` | lists memories with their type and description |
| `/context` | shows the size of the Memory section |

## Try it

```
❯ Remember that I prefer tabs over spaces
● Write(~/.noobly/projects/…/memory/prefers-tabs.md)
● Write(~/.noobly/projects/…/memory/MEMORY.md)
❯ /exit
$ noobly
❯ Write a hello-world function in hello.js      # indented with tabs, without being told
```

## What we learned

- **Memory = files + a system prompt that explains them.** The model's normal tools do the rest.
- An **index** in context, details on demand: memory scales without flooding the prompt.
- Deciding **what's worth remembering** is the real problem. The prompt spends more words on what *not* to save than on how to save.
- Opening a folder outside the project is a **permission decision**: open exactly one folder, and keep deny rules first.
