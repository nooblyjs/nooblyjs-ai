# Phase 21: Checkpoints & rewind

**Goal:** make every change undoable. When undo is cheap, letting the agent work on its own is cheap too.

---

## Two histories

A conversation with an agent changes two things at once:

```
conversation:  you: "add a flag" → edits… → you: "now refactor" → edits… → you: "hmm, no"
files:         cli.js v1      →   cli.js v2   →      cli.js v3, parser.js v2
```

To "go back to before the refactor" you may want the **files** back, the **conversation** back (so the model forgets the refactor), or **both**. Phase 21 records enough to do all three.

## Why not just git?

Git is great for *your* history, but a bad fit for the agent's:

- Your working tree is usually **dirty**: you have uncommitted work mixed with the agent's. `git stash` or `git checkout` would throw yours away too.
- Commits after every turn would flood your history (and hooks, CI…).
- Untracked and ignored files (a new `.env.example`, build output) are invisible to `git checkout`.

So noobly keeps its own, separate record: **checkpoints**.

## What is recorded (`src/checkpoints/store.js`)

Per user turn:

| | How |
|---|---|
| where the conversation stood | the history length when the turn began (`startTurn`, in `loop.js`) |
| each file **Edit/Write** changed | its content **before the first change in that turn**, or "didn't exist" (`beforeWrite`) |
| each file a **Bash** command changed | noticed by comparing size + modification time of all project files before and after the command, but **no copy** |

Contents go into a **content-addressed** store: the file name is the SHA-256 of the content. The same content saved ten times is stored once.

```
~/.noobly/projects/<slug>/checkpoints/<conversation id>/
  index.jsonl      {"type":"turn","id":3,"prompt":"refactor…","historyLength":12}
                   {"type":"snapshot","turn":3,"file":"/work/app/parser.js","blob":"9f2c…"}
                   {"type":"bash","turn":3,"files":["/work/app/dist/out.js"]}
                   {"type":"restore","from":3}
  blobs/9f2c…      the old parser.js
```

The same append-only JSONL idea as transcripts (Phase 09), with the **same id**, so `--continue` and `/resume` bring the checkpoints back too. Loading replays the log through the same `apply()` function that updates the live state, so the two can't disagree.

## Rewinding: the oldest snapshot wins

To rewind to "before turn N", each file goes back to its **oldest snapshot from turn N or later**:

```
parser.js   snapshot in turn 3 (v1)   snapshot in turn 5 (v2)   now v3
rewind to before turn 4 → the oldest from turn ≥ 4 is turn 5's → v2 ✓ (how it looked when turn 4 began)
rewind to before turn 2 → turn 3's → v1 ✓
```

A snapshot of "didn't exist" means: delete the file.

## Bash: honest, not magic

We can't copy what a command *will* change before it runs. Copying the whole project before every command would be far too slow. So Bash changes are **detected** after the fact, and a rewind **says** what it could not undo:

```
⏪ Rewound code to before: "run the build"
  restored: src/cli.js
  ⚠ changed by commands, NOT restored: dist/cli.js, package-lock.json
```

The comparison lists the project's files the way Glob does (git's list, or a folder walk), so ignored folders like `node_modules` aren't compared. Above 20,000 files it's skipped.

## Keeping the model honest

After a **code-only** rewind, the conversation still says "I changed parser.js", but parser.js is back to v1. Two things fix the model's picture:

1. The restored files are removed from `readFiles`, so the read-before-write rule (Phase 05) makes the model **Read them again** before editing.
2. A **system reminder** (Phase 07) goes with your next message: *"The user rewound the project's files to how they were before … Restored: parser.js … Read files again before relying on them."*

After a **conversation** rewind, the history is cut back to where that turn began, and a `{"type":"history","reason":"rewind"}` line in the transcript makes `--continue` resume the rewound state. Your old message goes back into the input box, ready to edit and resend (Claude Code does the same).

## Compaction breaks conversation rewind

Compaction (Phase 08) replaces the history with a summary, so "the history had 12 messages" means nothing afterwards. Those turns can still rewind their **code**, but no longer their conversation; `/rewind` marks them `[code only: compacted]`.

## Using it

| | |
|---|---|
| **Esc Esc** on an empty prompt | pick a message, then: code and conversation · conversation only · code only |
| `/rewind` | list the turns with what changed in each |
| `/rewind 3 [code\|conversation\|both]` | rewind to before turn 3 (default: both) |
| `/diff` | a unified diff of everything noobly changed in this conversation (first snapshot vs now) |

Subagents' edits belong to the turn of the parent that started them.

## Try it

```bash
noobly --echo
❯ run echo hi > note.txt            # a Bash change (sandboxed, no question)
❯ /rewind                           # 1. run echo hi…  (1 changed by commands)
  Esc Esc → Enter → 3               # code only: note.txt is reported, not restored
```

With a real model: ask for a change across several files in accept-edits mode, look at `/diff`, then Esc Esc and rewind both. `git status` shows your tree exactly as before.

## What we learned

- **Undo is a feature of autonomy.** Accept-edits mode is only comfortable when a mistake costs one keystroke.
- Record the **before**, not the after: the snapshot is taken just before the first write of each turn.
- **Content addressing** makes repeated snapshots free.
- Be honest about limits: Bash changes are reported, never silently skipped.
- A rewind changes the world behind the model's back: **tell it** (reminder) and **make it look again** (read-before-write).
- How Claude Code appears to do it: checkpoints on its own file edits (not Bash), Esc Esc to rewind code, conversation or both, and your old message put back in the prompt.
