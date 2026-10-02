# Lesson 4: Tools

The loop gives the model a way to act. Tools decide *how well* it can act. A surprising amount of a harness's quality comes from tool design.

## A tool is two halves

Every tool has a half the **model** reads and a half the **harness** runs:

```js
// src/tools/read.js (trimmed)
export const readTool = defineTool({
  // ── For the MODEL: sent in every request, in `tools` ──────────────────
  name: 'Read',
  description: 'Read a text file from the project and return its contents with line numbers…\n'
             + 'Use this whenever you need to see what is in a file instead of guessing.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to read' },
      offset:    { type: 'integer', description: 'Line number to start from (1-based)…' },
    },
    required: ['file_path'],
  },

  // ── For the HARNESS: never seen by the model ───────────────────────────
  isReadOnly: true,                       // used by permissions and parallel batching
  async call({ file_path, offset }, ctx) {
    // …really open the file, add line numbers…
    return { content: numbered, display: '18 lines' };
  },
});
```

The model never sees the code. It sees only the **name, description and input schema** (`toApiSchemas()` in `src/tools/registry.js`). So:

> **A tool description is a prompt.** It's the only manual the model gets. If it doesn't say when to use the tool, the model has to guess.

That's why noobly's descriptions read like advice to a colleague: *"Use this whenever you need to see what is in a file instead of guessing."*

## The output has two audiences too

Look at what `call()` returns:

```js
{ content: '     1\t{\n     2\t  "name": …', display: '18 lines' }
```

- `content` is **for the model**: complete, precise, with line numbers so it can say "line 42" and edit accurately.
- `display` is **for you**: a short summary for the UI ("18 lines"), because you don't want 2,000 lines scrolling past.

The same split applies to errors. A `ToolError`'s message goes to the model, so it's written to help the model **recover**:

```
✗ "ENOENT"
✓ "offset 900 is past the end of the file, which has 214 lines."
✓ "There is no tool called "Teleport". Available tools: Read, Glob, Grep, …"
```

A good error message tells the model what went wrong *and what to do instead*. The model reads it in the next round and adjusts.

## noobly's toolset, by purpose

`src/tools/index.js` registers these. Group them by the question they answer:

| Purpose | Tools | Notes |
|---|---|---|
| **Find** | `Glob` (by filename), `Grep` (by content), `RepoMap` (overview) | read-only, run in parallel |
| **Look** | `Read`, `WebFetch`, `WebSearch` | Read also shows images (Phase 28) |
| **Change** | `Edit`, `MultiEdit`, `Write` (or `ApplyPatch` for OpenAI models) | need permission; checked after each edit (Phase 24) |
| **Run** | `Bash`, plus `TaskOutput` / `TaskStop` for background commands | sandboxed (Phase 20) |
| **Organise** | `TodoWrite`, `ExitPlanMode` | tools whose "effect" is on the conversation itself |
| **Delegate / extend** | `Task` (subagents), `Skill`, MCP tools | Lessons 6–7 |

Why so few? Each tool's description is sent on **every** request (costing tokens), and more choices mean more chances to pick the wrong one. A small set of sharp tools beats a big set of vague ones. `Bash` covers the long tail.

## Design rules you can see in the code

These rules are small, but each one fixes a real failure.

**Read before you write.** `Edit` and `Write` refuse to change a file the model hasn't `Read` in this session, or that changed on disk since it read it (`session.readFiles`, `src/tools/freshness.js`). Without this, the model happily "edits" a file it is *imagining*, and overwrites your changes.

**Edit by exact text, not by line number.** `Edit` takes `old_string` → `new_string`, and `old_string` must match **exactly once**. Line numbers go stale after the first edit, but text doesn't. If the match isn't unique, the tool says so and the model adds more surrounding text. (Phase 25 adds a whitespace-forgiving fallback, because models often get indentation slightly wrong.)

**Pick the tool's shape for the model.** OpenAI models were trained on a patch format, so for them noobly offers `ApplyPatch` instead of `Edit` (Phase 25). Same job, different shape, chosen per model.

**Never flood the context.** A `Grep` could return 50,000 lines. Every tool's output passes through one size limit; anything too long is **saved to a file** and the model gets the start, the end and the path, so it can `Read` or `Grep` the rest (`src/tools/truncate.js`, Phase 26). Nothing is lost, and nothing overflows.

**Tell the model what changed.** After every `Edit`/`Write`, a quick checker (syntax check for JS/JSON, or your own command) runs, and reports only the problems *this edit introduced* (Phase 24, `src/feedback/`). The model finds out it broke something straight away, not 10 rounds later.

**Validate input before running anything.** The model sometimes sends malformed input. `validateInput()` in `src/tools/tool.js` checks it against the schema first and returns a clear error.

## Where tools come from

Not all tools are written in `src/tools/`:

- **MCP tools** (Phase 14): other programs can offer tools over a standard protocol (JSON-RPC). noobly starts them, asks what tools they have, and wraps each one so the loop sees an ordinary tool named like `mcp__github__create_issue`. The loop doesn't know the difference.
- **Library tools**: `query({ tools: [...] })` lets your own code add tools with `defineTool`.
- **Subagents** are a tool too: `Task` (Lesson 6).

That's the strength of having one interface: anything that can describe itself (name, description, schema) and run (`call`) can be a tool.

## Check yourself

1. What three parts of a tool does the model see? What part does it never see?
2. Why does `Read` return line numbers?
3. Why does `Edit` use `old_string`/`new_string` instead of "replace line 42"?
4. The model tries to `Write` over `src/cli.js` without reading it first. What happens, and what problem does that prevent?
5. A `Grep` returns 3 MB of matches. What does the model receive?

<details><summary>Answers</summary>

1. Name, description, input schema. It never sees the code (`call`), nor `isReadOnly`.
2. So the model can refer to exact places and edit precisely.
3. Line numbers shift after any edit; a unique text match stays correct and also proves the model knows what's there.
4. The tool refuses with an error telling it to Read first. It prevents overwriting a file the model has only imagined, or one the user changed.
5. A preview (start and end) and the path of a file holding the full output, which it can page through with Read/Grep.

</details>

**Next:** [Lesson 5: Control and safety](./05-control-and-safety.md)
