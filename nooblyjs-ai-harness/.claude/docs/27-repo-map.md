# Phase 27: A map of the codebase

**Goal:** in a big repo, orient the model in one glance instead of ten searches.

---

## The cost of finding your way

In an unfamiliar repo the first several rounds of every task are the same: Glob, Grep, Read, Grep again. Each round re-sends the whole conversation. A **repo map** is a compact overview: the files that matter most, and what each defines, one line per definition, no bodies:

```
src/tools/registry.js:
│ export class ToolRegistry
│ register(tool)
│ toApiSchemas()
src/core/session.js:
│ export class Session
│ async rewind(turnId, { code = true, conversation = true } = {})
│ compact(options)
```

## Three steps (`src/context/repo-map.js`)

**1. Symbols.** For each source file, its definitions: functions, classes, exported constants and types, class methods (JS/TS), `def`/`class` (Python), `func`/`type` (Go), `fn`/`struct`/`enum`/`trait` (Rust). The body is cut off, carefully: in `runTurn(session, text, { signal } = {})` the first `{` is a parameter, not the body, so the cut is after the **last** `)`.

**2. Rank.** A file matters if other files **use** what it defines. That's a graph: an edge from file A to file B when A mentions a name B defines. **PageRank** (the original Google algorithm) finds the files that many important files lean on: a random reader follows "uses" links, and the files they end up in most often rank highest. Two refinements, both learned by trying it on this repo:

| Problem seen | Fix |
|---|---|
| test helpers named `bash`, `read`, `add` ranked highest: every file "mentions" those words | only **public** definitions are targets (exported JS, non-`_` Python, capitalised Go, `pub` Rust) |
| common words still pulled in files | **IDF** weighting (from search engines): a name found in many files counts little; a rare one (`formatDate`) counts a lot |

With `focus` (files, symbol names or words from the task) the random reader jumps to those files more often (**personalised** PageRank), so the map centres on what the task is about.

**3. Fit.** Files are added in rank order until the token budget is used.

Each file's analysis is cached by size + modification time, so a second map is cheap.

## Where the model gets it

- The **`RepoMap` tool** (read-only), any time, with `focus` and `max_tokens`.
- The **system prompt**, once per conversation, when the repo has 25-5,000 source files (setting `repoMap`: `"auto"`, `"on"`, `"off"`). Smaller repos don't need it; huge ones take too long to scan at startup.

## Deviation: regular expressions, not tree-sitter

The plan was tree-sitter (real parsers compiled to WebAssembly, as Aider uses). That would be the core's first heavy dependency (a WASM runtime plus a grammar per language). Line-based patterns get top-level definitions right for the four languages covered, at zero install cost. What they miss: nested definitions, multi-line signatures, languages without a pattern, and *which* definition a name refers to (two files defining `add` both get the credit). tree-sitter is on the "Beyond v2" list.

## Known limit

The ranking is only as good as "name mentioned = name used". In this repo, an eval fixture exporting `add()` still ranks higher than it deserves, because "add" appears in many unrelated files. A real parser (which knows imports and calls) would fix that.

## Not measured yet

The roadmap's checkpoint is an eval A/B on multi-file tasks (map on vs off: rounds and tokens). Phase 23 was skipped, so that measurement is still open.

## What we learned

- A map is a **retrieval** problem: rank, then fit a budget.
- **PageRank** fits code surprisingly well: "used by important files" ≈ important.
- Try it on a real repo: the first ranking looked fine in tests and was poor on real code. **Public-only targets** and **IDF** fixed most of it.
- Know what a cheap approach misses (nested code, name collisions), and say so.
- How Aider does it: tree-sitter tags, a graph of definitions and references, personalised PageRank, fitted to a token budget. Claude Code relies on search tools instead of a map.
