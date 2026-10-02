# Phase 25: Editing tools shaped for the model

**Goal:** fewer failed edits, by giving each model the edit format it's best at, and forgiving the mistakes that don't matter.

---

## A tool's format is part of the prompt

Models learn tool formats in training. Claude is trained on exact-string replacement (`old_string` → `new_string`); OpenAI's models on a patch format called **apply_patch**. Aider measured it for years: the *same* model succeeds noticeably more often in the format it knows. So the edit tool isn't a detail: it's a prompt.

## Three changes

### 1. MultiEdit: several changes to one file, all or nothing (`src/tools/multi-edit.js`)

```json
{ "file_path": "src/users.js", "edits": [
  { "old_string": "function getUser(", "new_string": "function findUser(" },
  { "old_string": "getUser(id)", "new_string": "findUser(id)", "replace_all": true } ] }
```

One round trip instead of four. The edits run **in memory**, each on the result of the one before; the file is written only if **every** edit succeeded. No half-renamed files.

### 2. A forgiving fallback, never a guess (`src/tools/replace.js`)

The most common reason an Edit fails is whitespace: spaces where the file has tabs, a different indent depth. Each failure costs a round trip (error, Read again, retry). Now, when the exact text isn't found:

1. compare **whole lines**, ignoring whitespace at their start and end
2. apply it **only if exactly one** place matches (two matches = refused, as before)
3. **re-indent** the new text: each indentation the model used maps to the one the file really has at that line (`    ` → `\t`)
4. say so in the result, so the model knows to check

The same fallback helps MultiEdit. Exact matching is still tried first.

### 3. ApplyPatch for OpenAI models (`src/tools/patch.js`, `apply-patch.js`)

```
*** Begin Patch
*** Update File: src/app.js
@@ function main
 const a = 1;
-const b = 2;
+const b = 3;
*** Add File: src/new.js
+export const x = 1;
*** Delete File: src/old.js
*** Update File: src/a.js
*** Move to: src/b.js
…
*** End Patch
```

Unlike `diff -u`, there are **no line numbers** (models can't count lines reliably). Each chunk is found by its context and `-` lines, searching forward from the previous chunk, then with trailing and surrounding whitespace ignored. The whole patch is applied in memory first: all files or none.

## One tool set per conversation (`src/tools/index.js`)

| `editTools` setting | Tools |
|---|---|
| `"auto"` (default) | `ApplyPatch` for OpenAI's API, `Edit` + `MultiEdit` for everything else |
| `"edit"` | `Edit` + `MultiEdit` |
| `"patch"` | `ApplyPatch` |

`Write` is in both. The set is chosen when the session starts, and never changes mid-conversation: a different tool list breaks prompt caching (Phase 09). If you `/provider` to OpenAI mid-conversation, you keep Edit until `/clear`. The system prompt's "Using tools" section describes whichever set is active.

## Same rules for every editing tool

A shared step (`commit-changes.js`) writes every change the same way: checkpoint (Phase 21), feedback baseline and check (Phase 24), read-before-write bookkeeping (Phase 05).

The permission gate treats all four (Edit, Write, MultiEdit, ApplyPatch) as editing tools: accept-edits mode covers them, and **rules written for Edit or Write apply to all of them**, so the default `Edit(**/.env*)` deny rule also blocks a patch that touches `.env`. A patch touches several files, so the gate decides **per file** and keeps the strictest answer (any deny → deny; any ask → ask).

## Not measured yet

The roadmap's checkpoint is an eval A/B per provider. With Phase 23 (the larger eval suite) skipped, that measurement is still to do: `npm run eval -- --compare` with `"editTools": "edit"` vs `"patch"` on an OpenAI model.

## What we learned

- **Formats are prompts.** Match the model's training, not your taste.
- **Atomicity** (all or nothing) turns multi-step edits from risky into safe.
- **Forgive what's unambiguous, refuse what isn't.** A fuzzy match that could land in two places is a bug waiting to happen.
- Share **one write path** so every tool keeps every guarantee (checkpoints, feedback, freshness, permissions).
- How the others do it: Claude Code has Edit/MultiEdit-style tools; Codex CLI uses apply_patch; Aider picks an edit format per model.
