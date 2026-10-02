# Phase 05: A real toolset

**Goal:** give the agent the tools it needs to do real work: **find** files, **search** inside them, **change** them, and **run commands**. That makes six tools:

| Tool | Does | Read-only? |
|---|---|---|
| `Read` | Show a file with line numbers (Phase 04) | ✅ |
| `Glob` | Find files by name pattern: `src/**/*.js` | ✅ |
| `Grep` | Search inside files with a regex | ✅ |
| `Edit` | Replace an exact piece of text in a file | ❌ |
| `Write` | Create a file, or replace one completely | ❌ |
| `Bash` | Run any shell command: tests, git, `ps`, `ls`… | ❌ |

> ✅ *Update:* when this phase was built, Edit, Write and Bash ran without asking. [Phase 06](./06-permissions.md) added the permission gate. Working in a committed git tree is still good practice.

The big lesson of this phase isn't the code. It's **tool design**: why these tools look the way they do.

---

## 1. Why not just give it Bash?

`Bash` can do everything: `cat`, `find`, `grep`, `sed`. So why have five other tools?

| With only Bash | With dedicated tools |
|---|---|
| `sed -i 's/foo/bar/' app.js` fails silently if nothing matches | `Edit` says *"old_string was not found… read the file again"* |
| `cat huge.log` floods the context window | `Read` returns 2000 lines max and says how to read more |
| `grep -r TODO .` searches `node_modules` (100,000 files) | `Grep` skips git-ignored files automatically |
| `echo "…" > file.js` overwrites your changes blindly | `Write` refuses unless the file was Read first |
| You see `Bash(sed -i …)` and have to decode it | You see `Edit(app.js)` with a red/green preview |
| Every call needs permission (Phase 06) | Read-only tools can be auto-approved |

So the **system prompt** and each tool's **description** tell the model what each tool is for. Bash's job is running programs, tests, builds and git; files are read and changed with the file tools.

> *Update:* the first version of this guidance was phrased as warnings ("Do not use Bash for cat, grep…"), which made the model defensive about using Bash at all. See [Phase 07, §6](./07-context-engineering.md#6-wording-has-side-effects-a-real-example) for what happened and how the wording was fixed.

## 2. `Glob`: find files by name (`src/tools/glob.js`)

```
Glob { pattern: "src/**/*.test.js" }
```

| Pattern | Matches |
|---|---|
| `*.md` | Markdown files in the top folder |
| `**/*.js` | `.js` files in any folder |
| `src/**/*.jsx` | `.jsx` files anywhere under `src/` |

- Uses Node's built-in `path.matchesGlob()`.
- **Newest first:** the files you're working on right now are usually the most recently changed.
- Capped at 100 results, with a note telling the model to be more specific.

### Which files count? (`src/tools/files.js`)

Both Glob and Grep skip files that **git ignores** (`node_modules/`, `dist/`, `.env`…). The easiest way to know what git ignores is to ask git:

```bash
git ls-files --cached --others --exclude-standard
```

That lists tracked and untracked files, minus anything in `.gitignore`. Outside a git repo we walk the folders ourselves and skip `node_modules` and `.git`.

## 3. `Grep`: search inside files (`src/tools/grep.js`)

```
Grep { pattern: "maxTurns", output_mode: "content" }
→ src/config/defaults.js:12:  maxTurns: 25,
  src/core/loop.js:43:      if (totals.rounds >= session.maxTurns) {
```

| `output_mode` | Returns | Good for |
|---|---|---|
| `files_with_matches` (default) | just file paths | "which files mention X?" (cheap) |
| `content` | `path:line:text` | seeing the actual lines |
| `count` | `path:N` | "how often?" |

Plus `glob` ("only `*.js` files"), `path` ("only in `src/`"), `ignore_case`, and `head_limit` (default 200 lines).

### Two engines, one output

- If **ripgrep** (`rg`) is installed, we use it. It's extremely fast (Claude Code uses it too).
- Otherwise a **JavaScript fallback** reads each file and tests each line.

Both give *exactly* the same output, sorted the same way. `test/glob-grep.test.js` runs both on the same files and compares them (that test is skipped when `rg` isn't on your PATH). The model never knows which one ran.

> **Fun fact:** in this Codespace, `rg` in your terminal is a *shell function* that runs ripgrep bundled inside Claude Code. Node can't see shell functions, so noobly uses the JavaScript fallback here. Install ripgrep (`sudo apt install ripgrep`) to get the fast path.

## 4. `Edit`: change part of a file (`src/tools/edit.js`)

```
Edit {
  file_path: "src/app.js",
  old_string: "const answer = 41;",
  new_string: "const answer = 42;"
}
```

### Why "find exact text, replace it"?

| Approach | Problem |
|---|---|
| "Replace line 12" | Line numbers shift as soon as anything above changes |
| "Apply this diff" | Models often write diffs that don't apply |
| **Exact string replacement** ✅ | It either matches or it doesn't. No ambiguity |

### The safety rules

| Situation | Edit says |
|---|---|
| Text not found | "old_string was not found… must match exactly, including whitespace. Read the file again to check." |
| Found 3 times | "appears 3 times… include more surrounding lines to make it unique, or set replace_all" |
| Same old and new | "identical, so there is nothing to change" |
| File never Read | "You must Read src/app.js before changing it" |
| File changed since Read | "has changed since you last read it. Read it again" |

Every message tells the model **what to do next**. That's what makes the agent self-correcting.

### A sneaky JavaScript bug we avoided

`"price = 1".replace("1", "$&")` gives `"price = 1"`, **not** `"price = $&"`, because `String.replace` treats `$&`, `$1`… in the replacement as special patterns. Code is full of `$` (template strings, jQuery, shell), so Edit uses `split(old).join(new)` instead, which is always literal. There's a test for it.

## 5. `Write`: create or overwrite (`src/tools/write.js`)

- New file → just write it (and create missing folders).
- Existing file → **must have been Read first, and unchanged since**. Otherwise the model could overwrite your work with its *guess* of the file.

### The "read before write" rule (`src/tools/freshness.js`)

```
session.readFiles:  Map { "/…/src/app.js" → 1727612345678 (modification time when read) }
```

- `Read` records the file's modification time (`mtime`).
- `Edit`/`Write` check: was it read? Is the `mtime` still the same?
- After a successful change, the new `mtime` is recorded, so the model can edit the same file several times in a row.

If *you* change the file in your editor meanwhile, the `mtime` changes, and the model must Read it again before touching it.

### Staying inside the project, even for new files

`resolveForWrite()` in `paths.js` walks up to the nearest folder that **exists**, resolves symlinks there, and checks it's inside the project. So `escape/x.txt`, where `escape` is a symlink to `/tmp`, is refused even though `x.txt` doesn't exist yet.

## 6. `Bash`: run commands (`src/tools/bash.js`)

```
Bash { command: "ps aux | head -5" }
→ USER  PID %CPU %MEM …
  [exit 0]
```

This is the most powerful tool, so it has the most careful details:

| Detail | How | Why |
|---|---|---|
| **The folder persists** | After your command, a trailer runs `pwd >&3`, writing to a separate channel (file descriptor 3) | `cd src` then `ls` works like a real terminal, and the pwd never mixes into the output |
| **…but stays in the project** | If the command `cd`s outside the project, we reset it | *"Shell cwd was reset to …"*. Claude Code does exactly the same |
| **No keyboard input** | `stdin` is closed | Interactive commands (`read`, a pager, a prompt) fail at once instead of hanging forever |
| **No pagers or editors** | `PAGER=cat`, `GIT_PAGER=cat`, `GIT_EDITOR=true` | `git log` would otherwise wait for you to press `q` |
| **Timeout** | 2 minutes by default, max 10 | A server or watcher never exits |
| **Kills everything it started** | Runs in its own **process group** (`detached: true`), and we kill the group (`process.kill(-pid)`) | `npm test` starts `node`, which may start more. Killing just `bash` would leave orphans |
| **Ctrl+C / Esc works** | The abort signal kills the group too | You stay in control |
| **Long output is cut in the middle** | First 15,000 and last 15,000 characters kept | The start shows what ran; the end shows how it finished. Both matter |
| **Your API key is hidden** | `ANTHROPIC_API_KEY` is removed from the command's environment | Otherwise `echo $ANTHROPIC_API_KEY` would put your key into the conversation |
| **Exit code reported** | `[exit 1]` at the end | Non-zero isn't a tool *error*: failing tests are useful information |

## 7. Parallel tools (`src/core/loop.js`)

When the model asks for several tools in one reply, **read-only tools next to each other run at the same time**:

```
Model asks for:  [Read a.js, Read b.js, Grep TODO, Edit a.js, Read c.js]
Batches:         [Read a.js, Read b.js, Grep TODO]  [Edit a.js]  [Read c.js]
                  ───── run together ─────           alone        alone
```

- Read-only tools can't interfere with each other, so parallel is safe and much faster.
- Anything that *changes* things runs alone, in the order the model asked. Otherwise an Edit and a Bash command could race.
- Results always go back **in the model's order**, whichever finished first.

`batchTools()` does the grouping; `Promise.all` does the waiting. In the UI you'll see several spinners at once.

## 8. The UI: previews

Tools can now return `preview` lines, shown under the result:

```
● Edit(src/app.js)
  ⎿ −1 +2 lines
      - const answer = 41;
      + const answer = 42;
      + const question = '?';

● Bash(npm test)
  ⎿ exit 0 · 212 lines
      > nooblyjs-learn-harness@0.5.0 test
      > node --import tsx --test …
```

Red `-` for removed lines, green `+` for added, dim for command output. At most 8 lines, then "… N more".

## 9. Try it

**Free, with the echo provider:**

```bash
noobly --echo
❯ find src/**/*.jsx          # Glob
❯ grep maxTurns              # Grep, content mode
❯ run ps aux | head -5       # Bash: your ps example
❯ run cd src && pwd          # then:
❯ run pwd                    # still in src: the folder persisted
❯ run cd / && pwd            # reset: can't leave the project
❯ search loop                # Glob AND Grep in one reply: two spinners at once
```

**With a real key** (in a clean git tree!):

```bash
noobly -p "Which files use AbortController? Explain what each uses it for."
noobly -p "Run the tests and tell me how many pass."
noobly -p "Add a /version slash command that prints the package version, with a test. Run the tests."
git diff          # see exactly what it changed
```

The last one is a real multi-step task: Grep/Read to understand the code, Edit to change it, Bash to run tests, and Edit again if they fail.

## 10. New files

| File | Job |
|---|---|
| `src/tools/glob.js`, `grep.js`, `edit.js`, `write.js`, `bash.js` | The five new tools |
| `src/tools/files.js` | List project files (git-aware), detect binaries |
| `src/tools/freshness.js` | The read-before-write rule |
| `src/tools/truncate.js` | Keep the start and end of long output |
| `src/tools/paths.js` | + `resolveForWrite()` for files that don't exist yet |
| `test/write-edit.test.js`, `glob-grep.test.js`, `bash.test.js` | 30 new tests |

Changed: `loop.js` (parallel batches, previews), `session.js` (`shellCwd`), `defaults.js` (system prompt with tool guidance), `ToolCall.jsx` (previews), `App.jsx` (several live tools), `echo.js` (new demo commands), `Banner.jsx` (warning).

```bash
git diff phase-04 -- src/
```

## What we learned

- **Tool design is prompt design.** Descriptions say when to use a tool *and when not to*.
- **Dedicated tools beat Bash** for common jobs: safer, clearer, cheaper, and easier to approve.
- **Exact-string Edit** is robust. Refusing ambiguous edits is a feature.
- **Read before write**, and re-read if the file changed. The model must never edit blind.
- Running commands safely needs care: **process groups, timeouts, closed stdin, hidden secrets, truncated output.**
- **Read-only work can run in parallel**; changes run one at a time, in order.
- Right now anything can happen without asking, which is exactly the problem **Phase 06: Permissions** solves next.
