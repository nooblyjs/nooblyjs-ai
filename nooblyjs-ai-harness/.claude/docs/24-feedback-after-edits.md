# Phase 24: Feedback after every edit

**Goal:** the model sees a mistake in the same tool result that made it, not three calls later.

---

## The cost of finding out late

```
Edit app.js        ← a missing brace
Edit app.js        ← builds on the broken file
Bash npm test      ← SyntaxError… now: which edit did it?
```

Every round trip re-sends the whole conversation, so a late discovery costs tokens *and* confuses the model about the cause. Now:

```
Edit app.js
  Edited app.js: replaced 1 occurrence (first at line 12).

  ⚠ New problems in app.js (node --check):
  SyntaxError: Unexpected end of input
```

## How it works (`src/feedback/index.js`)

After Edit or Write, noobly runs the **checker** for that file type on that one file:

| Files | Default checker |
|---|---|
| `*.js`, `*.mjs`, `*.cjs` | `node --check "$FILE"` (parses, doesn't run) |
| `*.json` | built in (`JSON.parse`), no process at all |

Add your own in settings. `$FILE` is the edited file; exit code 0 means "fine", anything else means its output lists problems:

```json
{
  "feedback": {
    "timeout": 10,
    "checkers": {
      "*.py": "python3 -m py_compile \"$FILE\"",
      "*.ts": "npx tsc --noEmit --pretty false -p .",
      "*.sh": "bash -n \"$FILE\""
    }
  }
}
```

## Only NEW problems

A file that was already broken would otherwise repeat its old errors after every edit, and the model would start "fixing" things you didn't ask about. So:

1. The **first** time noobly edits a file, it runs the checker **before** the change too: the baseline.
2. After each change, only lines **not in the baseline** are reported.
3. Line and column numbers are ignored when comparing (`app.js:12:5` = `app.js:40:1`), because an edit above an old problem moves it.

## Never in the way

- A checker slower than `timeout` (default 10 s) is skipped with a one-line note. The edit itself has already happened.
- The tool line shows ` · ⚠ 2 new problems`, so you see it too.
- A **project's** `feedback` setting waits for trust (Phase 12 / the security fixes): checkers are commands, just like hooks.
- `"enabled": false` turns it off.

## Hooks could do this. Why build it in?

The PostToolUse hook example (`examples/hooks/check-syntax-after-edit.js`, Phase 12) already did something similar. Built in, it can do what a hook can't easily: keep a **baseline per file** across the session, and compare only new problems. And it works with no configuration for the common cases.

## Deviation: no LSP client (yet)

The plan's step 2 was a Language Server Protocol client (`typescript-language-server`, `pyright`) for type errors without a full build. It needs those servers installed and a JSON-RPC client with document sync (open/change notifications). The configured-checker step gives most of the benefit (`tsc --noEmit` catches the same type errors, only slower). LSP moves to "Beyond v2".

## What we learned

- **Feedback latency matters** as much for agents as for people.
- **Report differences, not states**: "what did *this* edit break?" is the useful question.
- Normalise before comparing (line numbers move).
- A feature that runs commands is configuration that needs **trust**.
- How Claude Code appears to do it: IDE diagnostics (via its IDE integration or LSP) shown to the model after edits; hooks for anything custom.
