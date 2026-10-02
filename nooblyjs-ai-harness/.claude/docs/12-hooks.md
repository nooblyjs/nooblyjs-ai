# Phase 12: Hooks

**Goal:** run **your own code** at fixed moments of the agent's work, every time, whatever the model thinks.

---

## Instructions vs. hooks

You can write "always run the tests before you finish" in NOOBLY.md. The model will *usually* do it. A **hook** is different: it's a command that noobly itself runs at a given moment. The model can't forget it, skip it or be talked out of it.

| | NOOBLY.md instruction | Hook |
|---|---|---|
| Who runs it | The model (if it decides to) | The harness (always) |
| Can be ignored | Yes | No |
| Good for | Style, preferences, context | Rules that must hold: formatting, blocking commands, "tests must pass" |

## The events

| Event | When | Can it… |
|---|---|---|
| `UserPromptSubmit` | You sent a message, before the model sees it | add context, **block** the message |
| `SessionStart` | The first message of a conversation (`startup`, `clear` or `resume`) | add context |
| `PreToolUse` | The model asked for a tool, **before** the permission check | **block** it, **change its input**, pre-approve it |
| `PostToolUse` | A tool finished successfully | give the model feedback ("lint failed…") |
| `Stop` | The model finished its reply | **send it back to work** ("the tests fail") |
| `PreCompact` | The conversation is about to be summarised | run something first (it can't stop compaction) |

## Configure them

In any settings file (`~/.noobly/settings.json`, `.noobly/settings.json`, `.noobly/settings.local.json`):

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": "Bash", "command": "node examples/hooks/block-rm-rf.js" }],
    "PostToolUse": [{ "matcher": "Edit|Write", "command": "node examples/hooks/check-syntax-after-edit.js" }],
    "Stop":        [{ "command": "node examples/hooks/tests-must-pass.js", "timeout": 180 }]
  }
}
```

| Field | Meaning |
|---|---|
| `matcher` | For the tool events: a **regular expression** on the whole tool name. `Edit\|Write`, `mcp__.*`. Empty or `*` = every tool. |
| `command` | Run with `bash -c`, in the project folder |
| `timeout` | Seconds (default 60). A hook that takes longer is killed, together with everything it started. |

Hooks from every layer **add up** (like permission rules), and each remembers which file it came from. `/hooks` lists them all. Claude Code's nested form (`{ "matcher": …, "hooks": [{ "type": "command", "command": … }] }`) works too.

## The protocol

It's deliberately tiny, so a hook can be written in any language:

```
noobly ──stdin──► your command ──exit code + stdout/stderr──► noobly
```

**Input** is JSON on stdin:

```json
{ "event": "PreToolUse", "session_id": "…", "cwd": "/work/app",
  "tool_name": "Bash", "tool_input": { "command": "rm -rf build" } }
```

Other events get `prompt` (UserPromptSubmit), `source` (SessionStart), `tool_response` (PostToolUse), `stop_hook_active` and `last_assistant_message` (Stop), and `trigger` and `custom_instructions` (PreCompact). The environment variables `NOOBLY_PROJECT_DIR`, `NOOBLY_HOOK_EVENT` and, for file tools, `NOOBLY_FILE` are set too.

**Output** is read from the exit code:

| Exit code | Meaning |
|---|---|
| `0` | Fine. If stdout is JSON, these fields count: `decision: "block" \| "allow"`, `reason`, `updatedInput`, `additionalContext`. For UserPromptSubmit/SessionStart, plain stdout is added as context. |
| `2` | **Block.** stderr is the reason, and it goes to the **model** so it can adapt. |
| anything else | The hook itself broke. **You** see a ⚠ notice; the model isn't told, and nothing is blocked. |

Why does exit code 2 go to the model while other failures go to you? A block is a *message about the task* ("don't use rm -rf, use git rm"). A crashed hook is *your* bug, and the model can't fix it.

## Where hooks sit in the loop (`src/core/loop.js`)

```
you type ─► SessionStart (first message) ─► UserPromptSubmit ─► model
                                                                  │ tool_use
      ┌───────────────────────────────────────────────────────────┘
      ▼
  validate input ─► PreToolUse ─► permission gate ─► tool.call ─► PostToolUse ─► tool_result
                    (block/change/allow)                          (feedback)
      ... model replies without tools ─► Stop ─► blocked? → "not finished: <reason>" → model again
                                                  (at most 3 times per message)
```

A few decisions worth noticing:

- **PreToolUse runs before the permission gate.** A hook's `"decision": "allow"` skips the *question*, but **deny rules and plan mode still win**, because the gate said "deny" rather than "ask". A hook can make noobly ask less. It can't make it more dangerous.
- `updatedInput` is **validated again**, so a hook can't slip a broken input past the schema.
- **Stop hooks are bounded.** A hook that always says "not done" would otherwise loop forever (and spend money). After 3 continuations noobly stops and tells you. The hook receives `stop_hook_active: true` on continuations, so a clever hook can go easier the second time.
- Hooks for the same event run **in parallel**. One block is enough to block.
- PostToolUse feedback is added to the tool result inside `<system-reminder>` tags, so the model knows it came from the harness and not from the tool.

## Trust: hooks run code, so a cloned repo can't just add them

Your own `~/.noobly/settings.json`: you wrote it, so it's fine. But `.noobly/settings.json` **comes with the repo**. Without a check, `git clone` + `noobly` would run whatever the repo's author put there.

So hooks from the **project** (and **local**) layers only run after you say yes (`src/config/trust.js`):

```
This project (/work/app) wants noobly to run these commands:
  • hook Stop: node examples/hooks/tests-must-pass.js
  • MCP server git: uvx mcp-server-git          ← Phase 14 uses the same prompt
They come from the project's .noobly/ folder… Only trust projects you trust.
Trust them? [y/N]
```

- The answer is stored in `~/.noobly/trusted-projects.json` as a **fingerprint of the exact commands**. If the project later changes a hook, you're asked again.
- In print mode (`-p`) nobody can answer, so untrusted hooks are switched off with a warning. `noobly trust` trusts them from the shell.
- The same prompt covers the project's `env`, `baseUrl` and `permissions.allow` settings: they can run code or leak your API key just as well (see Phase 10's safety note).

## Examples (`examples/hooks/`)

| File | Event | What it shows |
|---|---|---|
| `block-rm-rf.js` | PreToolUse (Bash) | exit 2 + stderr → the model is told why and uses `git rm` instead |
| `check-syntax-after-edit.js` | PostToolUse (Edit\|Write) | JSON `{"decision":"block","reason":…}` → feedback on a broken edit |
| `tests-must-pass.js` | Stop | runs `npm test`; if it fails, the model has to keep going |
| `settings.json` | | all three wired up; copy it into `.noobly/settings.json` |

## Try it

```bash
mkdir -p .noobly && cp examples/hooks/settings.json .noobly/settings.json
noobly --echo            # asks whether to trust the project's hooks: y
❯ /hooks
❯ run rm -rf /tmp/x      # ● Bash(rm -rf /tmp/x) ⎿ Blocked by hook: rm -rf is not allowed…
```

The checkpoint: with a real model and the `tests-must-pass` Stop hook, break a test, ask for an unrelated change, and watch it get sent back to fix the test it would otherwise have left.

## What we learned

- **Deterministic beats probabilistic** for rules that must hold. Hooks are code; instructions are requests.
- A tiny protocol (JSON in, exit code out) means hooks can be written in any language, and are easy to test.
- Put the extension point **before the safety check**, and let it only *reduce* friction, never bypass deny rules.
- Anything that can make the agent continue needs **a bound**.
- Configuration that runs code is **a supply-chain risk**: ask before running a project's commands, and ask again when they change.
