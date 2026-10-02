# nooblyjs-learn-factory

`factory`: an **agentic software factory**, built one concept at a time on top of the [`noobly`](../nooblyjs-ai-harness) harness. Issues go in; verified, reviewable pull requests come out.

It's a learning project. Each of its 26 phases (F00–F25) adds one idea from the industry's agentic factories (Devin, GitHub's Copilot coding agent, Codex, Jules, Factory.ai, Kiro, Sourcegraph Batch Changes…) and explains it in a plain-language doc. It's also a working tool: 235 offline tests, no dependencies beyond the harness, no build step.

## Try it in five minutes (no model, no key)

Every example has a scripted agent, so the whole line runs offline, for free:

```bash
git clone https://github.com/nooblyjs/nooblyjs-ai-common.git && git clone https://github.com/nooblyjs/nooblyjs-ai-harness.git && git clone https://github.com/nooblyjs/nooblyjs-learn-factory.git   # side by side
cd nooblyjs-learn-factory && npm install

export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc                          # a tiny repo with tests
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-slow.json --autonomy L2 --allow-unsandboxed
cat $FACTORY_HOME/forge/*/prs/issue-1.md                      # the PR: its evidence, checks, review, cost
node bin/factory.js logs <run>                                 # the run's whole story
node bin/factory.js dashboard                                  # the same, in a browser
```

With a model: `export ANTHROPIC_API_KEY=…` and drop `--script`. On Linux, install **bubblewrap** (`sudo apt install bubblewrap`) so agents and the repo's commands run sandboxed, or set `FACTORY_CONTAINER_IMAGE=node:24-slim` to run the repo's commands in Docker. Without either, the factory refuses to run anything unsandboxed unless you pass `--allow-unsandboxed`.

## How it works

```
 issue (file, GitHub label, @factory run, campaign, schedule)
   │
   ▼
 queue ─► scheduler (priority, fairness, budgets, leases) ─► a LINE of stations, as data:
   triage ─► spec ─► approve ─► build ─► verify ─► review ─► repair ─► deliver ─► merge
   (asks)   (EARS)  (a person) (fan-out, (scope,   (tamper,  (fixer,  (secret    (L3,
                               workers) gates)    reviewer) loops)   scan, PR)  green)
   │
   └─ every step is an EVENT in SQLite: the dashboard, metrics, audit, notifications,
      retries and the learning loop are all read from that one log
```

- The **harness is the worker**: each agent step is a `noobly` session in an isolated git worktree with its own sandboxed settings. The **factory is the control plane**: it commits, pushes and decides. Agents never push, and never see the factory's secrets.
- **Deterministic checks decide**, not the agent's summary: the repo's gates, a scope guard, a test-tampering check, a secret scan. Models review; programs verify.
- **People stay in charge**: autonomy levels L0–L3, an inbox for approvals and questions, and draft PRs whenever anything is doubtful.

## Read more

| | |
|---|---|
| 📘 [The phase docs](.claude/docs/README.md) | what was built, phase by phase, and **why**: start here to learn |
| 📖 [Reference](.claude/docs/reference.md) | every command, config key, repo file, environment variable, station, status, event and endpoint |
| 🗺️ [PRD](.claude/steering/PRD.md) · [Architecture](.claude/steering/Architecture.md) · [Roadmap](.claude/steering/Roadmap.md) | the plan, and what changed while building it |

## Status

**All 26 phases (F00–F25) are built.** 235 tests pass offline (`npm test`), and `npm run check:examples` runs every example in the docs against a fresh repo.

Verified here: everything offline with scripted agents, a real Docker run, real `noobly` subprocesses, two remote worker processes sharing a queue, and a campaign across clones of the `nooblyjs-*` repos.

**Still to do with real models and real use** (there was no API key where this was built):
- the bench baseline (F19);
- the routing comparison (F22);
- a week of metrics (F20);
- the GitHub checkpoint against a real repository (F15);
- the chat checkpoint with `factory mcp --operator` (F16).

The docs give the exact commands. One known flaky test (F05's multi-process database test, about one full run in four) is described in the F24 doc.

| Phase | Feature |
|---|---|
| F00 | Scaffold: the harness as a linked dependency, `src/harness.js`, ids, clock |
| F01 | **Driving the harness**: in-process and subprocess drivers, limits (timeout, USD budget, stop), `factory agent` |
| F02 | **Isolated workspaces**: a mirror per repo, a worktree + branch per step, sandboxed settings via a per-step harness home, cached setup, `factory workspace`, `factory agent --repo` |
| F03 | **Issue in, PR out**: `factory run issue.md --repo …` → a branch in your repo + a PR file (local forge); untrusted issue text fenced |
| F04 | **Deterministic gates**: the repo's checks (`gates` in `.factory/config.json`) decide ready vs draft; a Stop hook shows the agent failures before it stops; `examples/make-demo-repo.sh` |
| F05 | **Durable state**: every step is an event in SQLite (`~/.factory/factory.db`); crash-safe PRs and pushes; `factory runs`, `logs`, `events`, `db rebuild`, `run retry` |
| F06 | **Scheduler**: `factory submit` → `factory serve` runs the queue (priority, fairness, `maxConcurrent`, daily budgets, leases); `status`, `stop-all`, `resume-all`, `cancel`; operator settings in `~/.factory/config.json` |
| F07 | **Lines**: stations as data (`lines/default.json`: triage → build → verify → deliver); a vague issue stops at triage with questions on it; verify runs on a clean checkout; `run retry --from`, `pause`, `resume` |
| F08 | **Specs**: medium/large items get `.factory/specs/<item>/{requirements,design,tasks}.md` (EARS, checked, traced) before the builder starts from them; steering files in every prompt; `factory init <repo>` drafts steering + config as a PR |
| F09 | **Roles**: `src/roles/builtin/*.md` (triager, spec-writer, builder), overridable per repo (`.factory/roles/`) and operator (`"roles"`), with invariants; models by tier (`"models"`) |
| F10 | **Fan-out**: a multi-task spec builds in parallel waves (`taskConcurrency`), each wave merged into one branch; an integrator resolves conflicts; verify checks the whole |
| F11 | **Review**: test-tampering check (deterministic), a read-only reviewer with structured findings against the spec, a security reviewer for sensitive paths/dependencies; blocking findings → draft PR, `changes_requested` |
| F12 | **Humans in the loop**: autonomy L0–L3 (`"autonomy"`, `--autonomy`); the spec parks for approval at L1; `factory inbox`, `approve`, `reject --feedback`, `answer` (`--now`); policy gaps; L3 merges green, clean changes |
| F13 | **Repair loops**: failing checks or blocking findings go to a fixer (`repairAttempts`, loop detection), then verify and review run again; escalations open an inbox entry and a draft PR |
| F14 | **Scope and evidence**: a scope guard in verify (declared paths, protected paths, `"scope": "warn"`); the PR body is an evidence bundle (+ `evidence.json`); `npm run check:examples` keeps the docs' examples working |
| F15 | **GitHub**: issues labelled `factory` become runs (webhooks via `factory serve --webhooks`, or `factory github poll`); PRs, comments and a commit status on GitHub; "changes requested" goes back to the fixer; merges are recorded |
| F16 | **Factory tools (MCP)**: agents get `mcp__factory__*` tools (read the spec, ask a person, record decisions, ask for scope…); `factory mcp --operator` lets your own `noobly` chat file items and answer the inbox |
| F17 | **Dashboard**: `factory dashboard` (or `factory serve --dashboard`): the line, runs, live agent output, evidence, the inbox with answer forms, spend, stop-all |
| F18 | **Notifications and chatops**: escalations, questions, PRs and budget stops sent to Slack/Discord (batched); `@factory run\|fix\|stop\|explain` in GitHub comments |
| F19 | **Bench**: `factory bench` runs 21 cases end to end, scored by hidden tests (`--verify`, `--repeat`, `--compare`, `--agent oracle\|null`, `bench mine`) |
| F20 | **Metrics**: `factory metrics --since 7d` (and the dashboard page): lead time, station times and costs, first-pass gates, acceptance, human-edit rate, escalations, cost per merged PR |
| F21 | **Learning loop**: `factory learn [--propose --bench]`: review feedback that recurs across runs becomes a proposed rule in `.factory/steering/conventions.md`, as a draft PR with evidence and bench numbers |
| F22 | **Cost-aware routing**: `--routing cheap-first` starts agents on cheaper models and climbs on trouble; `factory metrics` shows cost and success per station and tier; compare policies with `factory bench --routing` |
| F23 | **Workers and containers**: `factory serve --workers` + `factory worker --server … --enroll …` run build and repair steps on other machines; `FACTORY_CONTAINER_IMAGE` runs setup and gates in Docker/Podman |
| F24 | **Security**: nothing is pushed with a secret or risky change in any commit (held for a person); agents never see the factory's secrets; `factory audit export\|verify`; a red-team suite |
| F25 | **Campaigns**: `factory campaign create --spec … --repos …` opens one PR per repo (rate-limited per repo per day) and tracks them together; `schedules` in config run recurring campaigns |

## Working on it

```bash
npm test                  # offline: no network, no API key
npm run check:examples    # every documented example still works
```

Conventions (Node ≥ 24, ES modules, `// @ts-check`, one concept per file, the harness imported only through `src/harness.js`, a clock for anything time-based) are in [CLAUDE.md](CLAUDE.md).
