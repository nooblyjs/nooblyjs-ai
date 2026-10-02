# Phase 15: Skills and progressive disclosure

**Goal:** give the agent detailed know-how for many kinds of task, **without paying for all of it on every request**.

---

## The problem

You could put everything into NOOBLY.md: how to write release notes, how to do a database migration, how to review a PR… But NOOBLY.md goes into the system prompt, so **every request pays for every manual**, even "what does this function do?". Fifty manuals = thousands of tokens, every time. And the more text there is, the less attention each part gets.

## The idea: progressive disclosure

Show a little up front, and the rest **only when it's needed**:

| Level | What the model gets | When | Cost |
|---|---|---|---|
| 1 | a skill's **name and description** | always (system prompt) | one line per skill |
| 2 | the **SKILL.md instructions** | when it calls the `Skill` tool | only then |
| 3 | **supporting files** (templates, examples, scripts) | when the instructions say to `Read` them | only then |

The same idea shows up all over UI design: a menu shows titles, not every page.

## What a skill looks like

```
.noobly/skills/release-notes/          (or ~/.noobly/skills/… for every project)
├── SKILL.md
└── template.md
```

```markdown
---
name: release-notes
description: Use when the user asks for release notes, a changelog entry, or "what changed"
---
# Writing release notes
1. Find the range… 2. Run git log… 5. Fill in template.md from this skill's folder (Read it).

Details for this request, if any: $ARGUMENTS
```

The **description is the trigger**: it's all the model sees until it decides to load the skill, so say *when* to use it, not just what it is. `examples/skills/release-notes/` is a complete one.

## How it works

**Discovery** (`src/skills/loader.js`): every folder in `~/.noobly/skills/` and `.noobly/skills/` that contains a `SKILL.md`. Only the frontmatter is kept. A project skill replaces a personal one with the same name. Skills are found at startup, like NOOBLY.md, so the system prompt stays the same for the whole conversation (prompt caching, Phase 09).

**Level 1** (`src/context/system-prompt.js`), a "Skills" section:

```
# Skills
Skills are instructions for particular kinds of task. When a request matches a skill's description,
call the Skill tool with its name before you start, and follow what it says.
- release-notes: Use when the user asks for release notes, a changelog entry, or "what changed"
- commit-message: Use when writing a commit message
```

**Level 2** (`src/tools/skill.js`), the `Skill` tool, returns:

```
<skill name="release-notes" folder="/work/app/.noobly/skills/release-notes">
# Writing release notes
1. …
</skill>

Supporting files in the skill folder (Read them with their full path, … only when the instructions need them):
- template.md
```

The body is read **fresh on every call**, so you can edit a skill and try it again straight away. `$ARGUMENTS` is replaced by the tool's `args`.

**Level 3**: the model uses the ordinary `Read` tool. One snag: your personal skills live in `~/.noobly/skills/`, *outside* the project, and Read refuses paths outside the project (Phase 05). So `session.readableDirs` now lists your skill folders, and `resolveInsideProject()` accepts them too (still symlink-safe). Only those folders are allowed, nothing else outside the project.

## You can call a skill too

| Command | What happens |
|---|---|
| `/skills` | lists installed skills |
| `/release-notes v2.1` | **you** pick the skill: its instructions go straight to the model, with `v2.1` as `$ARGUMENTS` |

Built-in commands win over custom commands, and custom commands win over skills, if names clash.

## Skills vs. the other ways to give instructions

| | Loaded | Chosen by | Good for |
|---|---|---|---|
| NOOBLY.md (Phase 07) | always | always | facts about *this project* the agent always needs |
| Custom command (Phase 10) | when **you** type it | you | a prompt you repeat |
| **Skill** | when the **model** decides (or you type `/name`) | the model | know-how for a *kind of task*, possibly with files |
| Subagent (Phase 13) | when the model delegates | the model | work in a *separate context* |

## Try it

```bash
mkdir -p .noobly/skills && cp -r examples/skills/release-notes .noobly/skills/
noobly --echo
❯ /skills
❯ /context                 # "Skills" is a few dozen tokens
❯ skill release-notes      # the echo provider calls the Skill tool
```

The checkpoint, with a real model: *"Draft release notes for the last 10 commits"*. Check `/context` before (only the description) and watch it call `Skill`, then `Read` the template.

## What we learned

- **Progressive disclosure**: advertise cheaply, load on demand. Context is a budget, and attention is too.
- The **description does the work** of deciding when a skill is used, so write it as a trigger.
- A skill is just **files + a tool that reads them**. No new machinery in the loop.
- Keep the system prompt stable (skills are found at startup) and put changing detail in tool results.
