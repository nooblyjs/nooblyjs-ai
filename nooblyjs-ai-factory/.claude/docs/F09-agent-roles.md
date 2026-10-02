# Phase F09: Agent roles

**Goal:** stop hard-coding "who does what" in JavaScript. A **role** is a file: a prompt, a model tier, permissions and limits. Repos and operators can tune roles, but the rules that keep the line honest can't be switched off by any of them.

---

## The idea: a role = prompt + tools + model + permissions + budget

Until now each station built its prompt in a JavaScript function and set permissions inline. Adding a reviewer (F11) or a fixer (F13) would have meant more of the same, and a repo couldn't say "in this codebase, always write JSDoc".

Now a role is a Markdown file (`src/roles/builtin/`):

```markdown
---
name: spec-writer
description: Writes requirements (EARS), design and tasks for an issue, before any code. Writes only its spec folder.
tier: strong
permissionMode: default
allow: [Edit({{specDir}}/**)]
stopHook: false
maxTurns: 40
output: files
---
You are the spec-writer in a software factory. Before anyone writes code, write a spec …
```

| Field | Means |
|---|---|
| `tier` | `fast` · `balanced` · `strong`: which **model**, chosen by the operator (below) |
| `readOnly` | may look, never touch: always harness permission mode `plan` |
| `permissionMode`, `allow`, `deny` | harness permission settings; `{{vars}}` are filled per run (e.g. the spec folder) |
| `stopHook` | whether the gates' Stop hook applies (F04); only for roles that change code |
| `maxTurns`, `budgetUsd` | limits; a budget is the **lowest** of the role's, the run's and the scheduler's |
| body | the prompt: who you are, how to work, what to answer |

Built-in today: **triager** (fast, read-only), **spec-writer** (strong, writes only its folder), **builder** (balanced). Reviewers (F11), the integrator (F10) and the fixer (F13) are added as files in their phases.

## Three layers, and the rules none of them can change

```
built-in  src/roles/builtin/*.md
   ▼
repo      <repo>/.factory/roles/*.md   read at the run's BASE commit (reviewed, like steering)
   ▼
operator  ~/.factory/config.json  "roles": { "builder": { "tier": "strong", "maxTurns": 80 } }
```

A layer changes only the fields it sets, and a non-empty body replaces the prompt. `role.sources` records every layer that touched a role, so "why is the builder on Opus?" has an answer.

And **invariants**, enforced by the loader whatever the layers say:

| Invariant | Why |
|---|---|
| a built-in **read-only** role stays read-only | a reviewer must never be able to edit what it reviews; that's separation of duties |
| permission mode **`bypass`** is refused | no config file gets to turn off permissions |
| the **always-deny** rules (`git push`, `git remote`, `git config`, `gh`) are always added | only the control plane pushes (F03), whatever a role file says |
| a read-only role gets **no allow rules**, not even the run's `--allow` | `plan` mode plus allow rules would let a reviewer run commands |

Refused overrides aren't silent: they become warnings in the run's log (`⚠ role triager: … stays read-only (separation of duties)`). **Separation of duties is a permission setting, not a hope.** Telling a reviewer "please don't edit" in its prompt is a hope. Running it in `plan` mode, where the harness refuses every edit, is a setting. The end-to-end test has the triager *try* to write a file and checks that the harness refused.

## Models by tier

```json
"models": { "fast": "claude-haiku-4-5", "balanced": "claude-sonnet-5-5", "strong": "claude-opus-5-5" }
```

Roles say *how much thinking* they need; the operator decides *which model* that is, in one place. Precedence: the run's explicit `--model` > the role's own `model:` > its tier. Tier models are Anthropic ids by default, so they're skipped when the run names another provider (`--provider openai`, `--echo`). If your key is for another provider, set `models` in `~/.factory/config.json`.

Why these tiers? Triage reads and classifies (cheap, fast). A spec decides what gets built; mistakes there are the most expensive, so it gets the strongest model. Building is most of the tokens; a balanced model is the usual sweet spot, and it's the thing to measure (below).

## One prompt order for every role (`src/roles/prompts.js`)

```
1. steering      the maintainers' guidance (trusted: reviewed commits)
2. role body     who you are, how to work, what to answer
3. context       what earlier stations found (triage, the spec, the task…)
4. the issue     FENCED as untrusted, with the standing rule, last
```

One function for all roles means the untrusted-text rule (F03) can't be forgotten by the next role someone writes. A role file only says what's special about it.

## The checkpoint: the same item, three builder tiers

`calc` + "Add a subtract function", with a scripted model that reports token usage (6k–15k input tokens per request):

| Builder tier | Model | Triage | Build | Outcome |
|---|---|---|---|---|
| fast | claude-haiku-4-5 | $0.0057 | **$0.0930** | delivered, gates pass |
| balanced | claude-sonnet-5-5 | $0.0057 | **$0.1860** | delivered, gates pass |
| strong | claude-opus-5-5 | $0.0057 | **$0.3720** | delivered, gates pass |

What this shows: the cost side is exact. Same tokens, prices 1/5, 2/10, 4/20 dollars per million, so each tier doubles the build. Triage stays on the fast tier whatever the builder uses.

What it **can't** show: whether the cheaper builder passes the gates as often. With a scripted model the outcome is the same by construction. That comparison needs real models, several runs each (models vary), and a set of issues. That's the factory bench (F19), and until then it's an open question, not a result. The number that will matter is **cost per *delivered* run**: a builder that's half the price but fails the gates twice as often (and needs repairs, F13) isn't cheaper.

## What was built

| File | What it does |
|---|---|
| `src/roles/builtin/{triager,spec-writer,builder}.md` | The built-in roles (their prompts moved here from JavaScript) |
| `src/roles/loader.js` | Load and layer roles; invariants; `render({{vars}})`; `agentOptionsFor` (role → harness options) |
| `src/roles/prompts.js` | `rolePrompt`: steering → body → context → fenced issue |
| `src/line/stations/common.js` | `agentFor(ctx, role, …)`: a role's agent, ready for `runStep` |
| `src/line/executor.js` | Loads the run's roles once (built-in → repo at base → operator) |
| `src/config/factory-config.js` | `models` (tiers) and `roles` (overrides) |

## Try it

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

# Change the builder's tier and compare (scripted model with token usage):
echo '{ "roles": { "builder": { "tier": "fast" } } }' > $FACTORY_HOME/config.json
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc --script examples/scripts/subtract-priced.json --allow-unsandboxed
node bin/factory.js logs <run>          # └ build: … $0.0930

# A repo's own role tuning (committed, so read at the base commit):
mkdir -p /tmp/calc/.factory/roles && printf -- '---\nname: builder\nmaxTurns: 30\n---\nYou are the builder. In this repo, every new function gets a JSDoc comment.\n' > /tmp/calc/.factory/roles/builder.md
git -C /tmp/calc add -A && git -C /tmp/calc commit -qm "Tune the builder"

# Try to break the rules: the log says what was refused.
echo '{ "roles": { "triager": { "readOnly": false }, "builder": { "permissionMode": "bypass" } } }' > $FACTORY_HOME/config.json
```

## What we learned

- **Roles are data.** Prompts, models, permissions and limits in one readable file per role, tunable per repo and per operator.
- **Separation of duties is enforced, not requested.** Invariants in the loader, permission modes in the harness.
- **Choose models by tier, centrally.** Roles say how much capability they need; the operator maps that to models and prices.
- **One prompt assembly for everyone** keeps the safety rules in every prompt.
- **Cost is easy to measure; quality isn't.** Compare tiers on cost per delivered run, over real runs (F19).
- How the commercial factories appear to do it: Factory.ai's "Droids" are specialised agents per job (code, review, knowledge…); Claude Code and noobly have subagent definition files with tools and models (`.claude/agents/*.md`, `.noobly/agents/*.md`), the format these role files follow; MetaGPT and the BMAD method model software teams as roles (PM, architect, engineer, QA) with separate prompts and outputs.
