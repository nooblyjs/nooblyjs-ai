# Phase 11: Planning and task tracking

**Goal:** keep the model on track during long tasks. Two tools do it: a **todo list** the model writes for itself, and a real **plan mode**, where the model has to get your approval before it changes anything.

---

## Part A: The todo list (`TodoWrite`)

### Why would a model need a todo list?

The model "remembers" the whole conversation, since every request re-sends it. So why write things down?

Because on a long task the conversation turns into a big pile of file contents, command output and error messages, and the plan made at the start ends up buried under it. Three things go wrong:

| Problem | What you see |
|---|---|
| Steps get forgotten | "Done!", yet the docs were never updated |
| It stops too early | It fixes the first failing test and declares victory |
| You can't see progress | 40 tool calls scroll past, and you have no idea how far along it is |

A todo list fixes all three. Every time the model updates it, the **whole plan is repeated near the end of the conversation**, which is where models pay the most attention. You also get a live checklist:

```
● TodoWrite(1/3 done)
  ⎿ 1/3 done
      ☒ Read the loop
      ◐ Adding the truncation helper
      ☐ Run the tests
```

### How it works (`src/tools/todo.js`)

```js
TodoWrite({ todos: [
  { content: 'Read the loop',             status: 'completed' },
  { content: 'Add the truncation helper', status: 'in_progress', activeForm: 'Adding the truncation helper' },
  { content: 'Run the tests',             status: 'pending' },
]})
```

| Design choice | Why |
|---|---|
| The model sends the **whole list** every time | It never has to reason about "update item 2". The latest call is always the complete truth. |
| **Only one** item may be `in_progress` | Makes the model focus. Two in progress → a `ToolError` explaining why. |
| `activeForm` ("Running the tests") | Nicer to show while it happens. Optional. |
| `isReadOnly: true` | It only changes noobly's notes, never your files, so it works in plan mode too and never asks permission. |
| Stored on `session.todos` | The UI shows it above the input while the model works (`<TodoList>`), and `/todos` prints it. |

The **description** carries most of the teaching: *when* to use it (3 or more steps), *when not* to (quick questions), and the rules (mark items done straight away, never mark something completed if it's half done). There's also a short "Planning" section in the system prompt.

### Surviving compaction

When the conversation is summarised (Phase 08), the `TodoWrite` calls can disappear into the summary. So after a summary, noobly repeats the list as a **system reminder** in the next message:

```
<system-reminder>
Your todo list (kept from before the conversation was summarized). Continue from it…
☒ [completed] Read the loop
◐ [in_progress] Add the truncation helper
☐ [pending] Run the tests
</system-reminder>
```

A small bug turned up here. Auto-compaction happens at the *start* of a turn, **after** the reminders for that message have already been collected. So the reminder would have arrived one message late. Now the loop collects reminders again after compacting (`src/core/loop.js`).

When you `--continue` a session, the list is rebuilt from the last successful `TodoWrite` call in the history (`todosFromHistory`).

## Part B: Plan mode, finished (`ExitPlanMode`)

Phase 06 already had a plan mode: the permission gate blocks every tool that changes something. But there was no way *out*. The model would write "Here's my plan…" and you had to press Shift+Tab and type "go ahead".

Now the model calls a tool:

```js
ExitPlanMode({ plan: '## Plan\n1. Add `truncateMiddle` to tools/truncate.js\n2. Use it in bash.js and grep.js\n3. Run npm test' })
```

and you see:

```
╭──────────────────────────────────────────────────────────╮
│ Ready to code? Here is noobly's plan:                    │
│                                                          │
│  Plan                                                    │
│  1. Add truncateMiddle to tools/truncate.js              │
│  …                                                       │
│ ❯ 1. Yes, and auto-accept edits                          │
│   2. Yes, and ask before each edit                       │
│   3. No, keep planning (tell noobly what to change)      │
╰──────────────────────────────────────────────────────────╯
```

| You choose | What happens |
|---|---|
| 1 | Mode → `acceptEdits`. The tool result says "approved, mode is now accept edits, start now". |
| 2 | Mode → `default`: each edit still asks. |
| 3 / Esc | Mode stays `plan`. Your feedback goes back to the model as an error result, and it revises the plan. |

### Why a tool instead of "write the plan and wait"?

| Plan in plain text | Plan through a tool call |
|---|---|
| Just text: noobly can't tell it's a plan | **Structured**: noobly knows exactly when the plan is ready, and what it says |
| You type "ok go", then switch the mode yourself | One keypress; **the harness switches the mode** |
| The model might start editing anyway (the gate would refuse) | The only way out of plan mode is through your approval |

That's the answer to the roadmap question *"What does plan mode buy you that a prompt instruction doesn't?"* An instruction ("don't edit yet") is a request the model can ignore. Plan mode is **enforced in code** (the gate), and leaving it is **your decision in the UI**, not the model's.

Details:
- `ExitPlanMode` is `isReadOnly`, so the gate allows it in plan mode. Calling it outside plan mode is an error ("nothing to exit").
- Without a UI (`noobly -p … --permission-mode plan`) nobody can approve, so the model is told to give the plan as its final answer.
- After approval, noobly marks the mode change as already announced, so there's no duplicate "the mode is now…" reminder.
- Subagents (Phase 13) never get `ExitPlanMode`: only you and the main agent decide when planning ends.

## Try it

```bash
noobly --echo
❯ todo read the code; change it; run the tests      # a checklist appears
❯ /todos
# Shift+Tab twice → "⏸ plan mode on"
❯ plan 1. Do **this** 2. Then that                  # the plan dialog; press 1
```

With a real model:

```
# Shift+Tab to plan mode
❯ Refactor the tools to share a truncation helper
  … it reads files (read-only), then shows its plan …
  1. Yes, and auto-accept edits
  … watch the todos tick off …
```

## What we learned

- A todo list helps because it **re-states the plan where the model is looking** (the end of the context), not because the model can't remember.
- Tools can manage **the harness's state**, not just the outside world. `TodoWrite` and `ExitPlanMode` change nothing on disk.
- **Enforce in code, ask in the UI.** Plan mode is a gate rule plus a dialog, not a sentence in the prompt.
- Anything a summary might destroy needs a way back: here, a system reminder.
