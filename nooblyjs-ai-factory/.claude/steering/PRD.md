# PRD — Noobly Learn Factory

| Field | Value |
|---|---|
| Product | `factory` — a learning-first **agentic software factory** |
| Repo | `nooblyjs/nooblyjs-learn-factory` |
| Depends on | [`nooblyjs-learn-harness`](../../../nooblyjs-learn-harness) (`noobly`, v2.0.0) as its agent runtime |
| Status | v1 · **F00–F25 built** (2026-09-30). [§16](#16-requirements-status-as-built) says which requirements are met, partly met or not built |
| Date | 2026-09-30 |
| Related | [Architecture.md](./Architecture.md) · [Roadmap.md](./Roadmap.md) |

---

## 1. Summary

A **harness** runs *one* agent, in *one* conversation, with a human at the keyboard. A **software factory** runs *many* agents, on *many* pieces of work, mostly without a human at the keyboard, and turns a stream of requests (issues, tickets, specs, alerts) into a stream of **verified, reviewable changes** (pull requests with evidence).

`factory` is that second thing, built the same way the harness was: **progressively, one concept per phase**, in small readable code, with a runnable checkpoint at the end of every phase. It does **not** re-implement an agent. Every agent the factory runs is a `noobly` session; the factory is the **control plane** around it: intake, specs, scheduling, isolation, verification, review, human gates, integration, measurement and learning.

The product has the same two equal goals as the harness:

1. **Learning**: understand how industry-leading agentic software factories work by building one from first principles.
2. **Utility**: by the end of the roadmap, the factory can take real issues in the `nooblyjs-*` repos (including its own and the harness) and produce PRs a human is happy to merge.

## 2. Problem statement

Coding agents are now good enough that the bottleneck has moved. It is no longer "can the model write this function?" but:

- **Throughput**: one human babysitting one agent in one terminal does not scale.
- **Trust**: unattended changes need proof (tests, checks, review), not promises.
- **Specification**: agents fail most often because the request was vague, not because the code was hard.
- **Coordination**: several agents on one repo collide unless their work is isolated and integrated deliberately.
- **Cost & control**: unattended loops can burn money, touch secrets or push to `main` unless a control plane bounds them.
- **Learning**: the same mistakes recur unless review feedback flows back into the instructions agents run with.

Commercial factories (below) solve these behind closed doors. We want a codebase where each solution is visible and small.

## 3. What "industry-leading" means here

We model the factory on the **public patterns** shared by the leading products, not on any one product's internals.

| Pattern | Seen in (publicly) | What we take |
|---|---|---|
| **Asynchronous agents that return PRs** | Devin, GitHub Copilot coding agent, OpenAI Codex (cloud), Google Jules, Cursor background agents | Work is *assigned*, not chatted; output is a branch + PR + summary |
| **Specialised agent roles ("droids")** | Factory.ai Droids, MetaGPT, BMAD method | Named roles (spec writer, builder, reviewer, …) with their own prompts, tools and models |
| **Spec-driven development** | Amazon Kiro (requirements → design → tasks, *steering* files), GitHub Spec Kit, Tessl | A written, reviewable spec *before* code; tasks traceable to requirements |
| **Isolated, reproducible workspaces** | OpenHands, Codex cloud, Devin VMs, Copilot Actions runners | Each run gets its own worktree / container, sandbox and budget |
| **Deterministic gates before AI review before human review** | Every serious CI + AI-review setup (CodeRabbit, Graphite, Copilot review) | Cheap, certain checks first; LLM judgment second; humans last and least |
| **Graduated autonomy** | Copilot "draft PR only", Kiro autopilot vs supervised, Devin approvals | Per-repo autonomy levels with explicit human gates |
| **Evidence-carrying output** | Devin / Codex task logs, Jules plans | Every PR ships with the spec, plan, test results, cost and a trace link |
| **Measured continuously** | SWE-bench, Terminal-Bench, internal factory dashboards | A factory benchmark + DORA-style metrics drive changes |
| **Self-improving instructions** | Kiro steering, AGENTS.md / CLAUDE.md conventions, Factory "memories" | Review feedback becomes proposed steering updates, approved by a human |

## 4. Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Teach each factory concept in isolation | Every roadmap phase has a concept, a runnable checkpoint and a doc in `.claude/docs/` |
| G2 | Reuse the harness, don't fork it | Zero copies of harness code; the factory drives `noobly` through its library API or headless CLI |
| G3 | Always runnable, testable offline | `npm test` passes with no network and no API key, using the harness mock/echo providers |
| G4 | Issue in, reviewable PR out | By M3, a labelled issue in a local repo becomes a branch + PR-ready bundle with passing gates, unattended |
| G5 | Safe to leave running | Hard budgets (money, time, turns), sandboxed execution, no direct writes to protected branches, a kill switch |
| G6 | Measurably good | By M5, the factory benchmark reports resolve rate, cost/merged PR and human-intervention rate, and changes are A/B tested against it |
| G7 | Learns from its humans | By M5, accepted review feedback updates steering files through a human-approved PR |

## 5. Non-goals

- Competing with commercial factories on scale, polish or breadth of integrations.
- A multi-tenant SaaS: no user accounts, billing, org RBAC. (One trusted operator; see §8.)
- Re-implementing the agent loop, tools, permissions, sandbox or providers (the harness owns these).
- Auto-deploying to production. The factory stops at a **merge-ready PR**; release automation is a stretch (§9.12).
- Supporting every forge. GitHub first; a **local "forge"** (plain git + folders) for offline learning and tests.
- Heavy infrastructure (Kubernetes, Temporal, Kafka, Postgres). We implement *the ideas* (durable workflows, queues, leases) in small code on SQLite.

## 6. Target users

| Persona | Need |
|---|---|
| **The learner** (primary, the repo owner) | Understand how an agentic software factory works by building one |
| **The operator** | Point the factory at repos, set autonomy and budgets, watch the line, approve gates |
| **The requester** | File an issue (or write a spec) and get back a PR with evidence, without talking to an agent |
| **The reviewer** | Review factory PRs quickly because they arrive with a spec, a plan, green gates and a clear diff |
| **The harness** (a user too) | Gets a demanding, real client whose needs drive harness improvements (§11) |

## 7. Core concepts the product must teach

| # | Concept | What the learner should come away understanding |
|---|---|---|
| K1 | **Harness vs factory** | The agent is a worker; the factory is the control plane: queue, state, policy, verification, integration |
| K2 | **Driving an agent programmatically** | Library vs subprocess, event streams, structured results, exit codes, budgets, interrupts |
| K3 | **Isolated workspaces** | Worktrees → containers; clean clones, reproducible setup, cleanup, why isolation enables parallelism |
| K4 | **Durable workflows** | Event-sourced job state, idempotent steps, leases, retries, resuming after a crash |
| K5 | **Scheduling & budgets** | Priority queues, concurrency limits, per-run cost/time caps, back-pressure, fairness across repos |
| K6 | **Assembly lines (stations)** | A pipeline of stages, each with inputs, outputs, an owner role and exit criteria |
| K7 | **Spec-driven development** | Requirements (EARS) → design → tasks; traceability; why specs reduce rework |
| K8 | **Agent roles** | Role = prompt + tools + model + permissions; separation of duties (the builder never approves its own work) |
| K9 | **Decomposition & integration** | Splitting a spec into parallel tasks, merging branches, resolving conflicts, re-verifying |
| K10 | **Verification gates** | Deterministic checks, test generation, LLM review, security review, the evidence bundle |
| K11 | **Repair loops** | Feeding failures (tests, CI, review comments) back to an agent with a bounded number of attempts |
| K12 | **Human-in-the-loop** | Autonomy levels, approval gates, asking a human mid-run without blocking the whole line |
| K13 | **Forge integration** | Webhooks, issues → work items, branches/PRs/checks/comments, scoped tokens |
| K14 | **Factory tools for agents** | Giving agents factory-aware tools (MCP): report progress, ask a human, read the spec, submit artifacts |
| K15 | **Knowledge & steering** | Steering files, repo maps and memory as shared context; keeping them true |
| K16 | **Observability** | Run ledger, traces, cost accounting, a live dashboard, DORA-style and agent-specific metrics |
| K17 | **Factory evals** | End-to-end benchmarks (issue + repo + hidden tests), variance, A/B testing line changes |
| K18 | **Learning loops** | Turning review feedback and failures into better steering, skills and routing |
| K19 | **Security for unattended agents** | Untrusted input (prompt injection via issues), secrets brokering, egress control, least-privilege tokens, kill switch |
| K20 | **Fleet work** | Campaigns across many repos (dependency bumps, migrations), rate limiting, batching PRs |

## 8. Functional requirements

Priority: **P0** = one job end-to-end and the line (M1–M2), **P1** = quality, humans, forge (M3–M4), **P2** = learning and scale (M5–M6).

### 8.1 Intake & work items

| ID | Requirement | Pri |
|---|---|---|
| F-IN-1 | A **work item** can be created from the CLI (`factory submit "…"`), a markdown file, or a forge issue | P0 |
| F-IN-2 | Each work item records source, repo, requester, title, body, labels, priority, autonomy level and budget | P0 |
| F-IN-3 | **Triage** classifies items (bug / feature / chore / question / out-of-scope), estimates size, and rejects or asks for clarification when the request is too vague to spec | P1 |
| F-IN-4 | Duplicate detection against open work items (same repo, similar title/body) | P2 |
| F-IN-5 | Text from issues, comments and linked pages is marked **untrusted** everywhere it reaches a prompt | P0 |

### 8.2 Specs (spec-driven development)

| ID | Requirement | Pri |
|---|---|---|
| F-SPEC-1 | For feature-sized items, a spec agent writes `requirements.md` (user stories + EARS acceptance criteria), `design.md` and `tasks.md` into `.factory/specs/<item>/` | P0 |
| F-SPEC-2 | Every task in `tasks.md` references the requirement IDs it satisfies; every requirement is covered by at least one task | P0 |
| F-SPEC-3 | Small items (bug, chore) may skip straight to a one-page plan | P0 |
| F-SPEC-4 | A spec can be approved, edited or rejected by a human before build (gate per autonomy level) | P1 |
| F-SPEC-5 | Acceptance criteria are turned into **tests first** where possible (test-writer role) | P1 |

### 8.3 Orchestration

| ID | Requirement | Pri |
|---|---|---|
| F-ORC-1 | A **line** (pipeline) is declared in config as ordered **stations**; each station names a role, inputs, outputs, exit criteria and retry policy | P0 |
| F-ORC-2 | Job state is **durable**: an append-only event log in SQLite; killing the daemon and restarting resumes every run from its last completed step | P0 |
| F-ORC-3 | Steps are **idempotent**: re-running a completed step is a no-op; external side effects (push, PR, comment) carry idempotency keys | P0 |
| F-ORC-4 | A **scheduler** runs jobs by priority with global, per-repo and per-role concurrency limits | P0 |
| F-ORC-5 | Workers take jobs under a **lease** with heartbeat; an expired lease returns the job to the queue | P1 |
| F-ORC-6 | A spec's tasks can **fan out** to parallel build jobs and **fan in** to an integration step | P1 |
| F-ORC-7 | Runs can be paused, resumed, cancelled and retried from any failed station (`factory run retry <id> --from build`) | P1 |
| F-ORC-8 | A global and per-repo **kill switch** stops new work and interrupts running agents within 10 s | P0 |

### 8.4 Agents & roles

| ID | Requirement | Pri |
|---|---|---|
| F-ROLE-1 | Roles are markdown files with frontmatter (`name`, `description`, `model`, `tools`, `permissionMode`, `maxTurns`, `budgetUsd`), compatible with harness agent definitions | P0 |
| F-ROLE-2 | Built-in roles: `triager`, `spec-writer`, `planner`, `test-writer`, `builder`, `integrator`, `reviewer`, `security-reviewer`, `fixer`, `docs-writer`, `retro` | P0 (builder, reviewer) / P1 (rest) |
| F-ROLE-3 | **Separation of duties**: a role that produced an artifact never approves it; reviewers run with read-only permissions | P0 |
| F-ROLE-4 | Model per role (e.g. Opus for spec/design, Sonnet for build, Haiku for triage), overridable per repo | P1 |
| F-ROLE-5 | Cost-aware routing: escalate to a stronger model only after a cheaper one fails a gate | P2 |

### 8.5 Execution (workspaces & harness)

| ID | Requirement | Pri |
|---|---|---|
| F-EXE-1 | Every agent session runs in an **isolated workspace**: a git worktree (M1) or a container (M6) on its own branch (`factory/<item>/<task>`; stand-alone: `factory/ws/<name>-<rand>`) | P0 |
| F-EXE-2 | Agents are run through a **HarnessDriver** interface with two implementations: in-process (`createSession()`/`query()`) and subprocess (`noobly -p --output-format stream-json`) | P0 |
| F-EXE-3 | The harness **OS sandbox** is always on for factory runs; network egress is limited to an allowlist per repo | P0 |
| F-EXE-4 | Each session has hard limits: `maxTurns`, wall-clock timeout, and a USD budget; exceeding any one interrupts the session and fails the step with a clear reason | P0 |
| F-EXE-5 | Workspace **setup** (install deps, warm caches) is declared per repo and cached between runs | P1 |
| F-EXE-6 | Every harness event is captured to the run's trace; the transcript is kept as an artifact | P0 |
| F-EXE-7 | Remote/container workers can register with the control plane and pull jobs (same lease protocol) | P2 |

### 8.6 Verification & review

| ID | Requirement | Pri |
|---|---|---|
| F-VER-1 | **Deterministic gates** declared per repo (install, build, lint, typecheck, test, coverage delta, secret scan) run *outside* the agent, in the sandbox, after build | P0 |
| F-VER-2 | Gates are cheap-first and fail fast; results are structured (pass/fail, duration, excerpt of failures) | P0 |
| F-VER-3 | **Reviewer agent** reviews the diff against the spec's acceptance criteria and returns structured findings (severity, file, line, rationale) | P1 |
| F-VER-4 | **Security reviewer** agent runs for diffs touching configured sensitive paths or dependencies | P1 |
| F-VER-5 | **Repair loop**: failed gates or blocking findings go to the `fixer` role, at most N attempts (default 3), then the run escalates to a human | P0 |
| F-VER-6 | Diff **scope guard**: changes outside the paths the plan declared are flagged; changes to protected paths (CI config, `.factory/`, lockfiles unless allowed) fail the gate | P1 |
| F-VER-7 | An **evidence bundle** is produced per run: spec, plan, diff stat, gate results, review findings, cost, duration, trace link | P0 |

### 8.7 Integration & delivery

| ID | Requirement | Pri |
|---|---|---|
| F-INT-1 | Parallel task branches are merged into an item branch by the `integrator`; conflicts go to the integrator agent, then gates re-run | P1 |
| F-INT-2 | Output is a PR (forge) or a ready branch + `PR.md` (local forge), with the evidence bundle as its description | P0 |
| F-INT-3 | The factory **never pushes to protected branches**; merging is a human action unless the repo's autonomy level allows auto-merge after all gates | P0 |
| F-INT-4 | PR review comments and failing CI checks re-open the run at the `fixer` station (`@factory fix` or automatically) | P1 |
| F-INT-5 | After merge, the run is closed and the work item linked to the merge commit | P1 |

### 8.8 Humans in the loop

| ID | Requirement | Pri |
|---|---|---|
| F-HUM-1 | **Autonomy levels** per repo and per item: `L0 suggest` (spec only) · `L1 supervised` (approve spec and PR) · `L2 gated` (approve PR only) · `L3 autopilot` (auto-merge on green, protected paths excepted) | P1 |
| F-HUM-2 | An **approval inbox** lists pending gates, questions from agents and escalations; each can be approved, rejected with feedback, or answered | P1 |
| F-HUM-3 | An agent can **ask a human** mid-run (via a factory tool); the run parks (no tokens spent) until answered, others keep going | P1 |
| F-HUM-4 | Harness permission prompts ("ask") in factory runs are routed to the inbox, never silently allowed | P1 |

### 8.9 Knowledge & learning

| ID | Requirement | Pri |
|---|---|---|
| F-KNOW-1 | **Steering files** per repo (`.factory/steering/product.md`, `tech.md`, `structure.md`) are injected into every agent's context (as harness project instructions) | P0 |
| F-KNOW-2 | Steering and roles can be bootstrapped by an agent from an existing repo (`factory init`) | P1 |
| F-KNOW-3 | The `retro` role summarises each finished run (what failed, what the human changed) into a learning record | P2 |
| F-KNOW-4 | Recurring learnings become **proposed steering/skill edits**, delivered as a PR a human must approve | P2 |

### 8.10 Forge & integrations

| ID | Requirement | Pri |
|---|---|---|
| F-FRG-1 | **Local forge**: a folder of markdown issues + local git repos; branches and `PR.md` files stand in for PRs. Used by all offline tests | P0 |
| F-FRG-2 | **GitHub**: webhook receiver (issues, issue_comment, pull_request_review, check_run) with signature verification; polling fallback | P1 |
| F-FRG-3 | GitHub writes: branch push, PR open/update, issue/PR comments, a `factory` check run with the gate summary | P1 |
| F-FRG-4 | Commands in comments: `@factory run`, `@factory fix`, `@factory stop`, `@factory explain` (only from allowed users) | P1 |
| F-FRG-5 | Notifications (webhook out: Slack/Discord-compatible) on escalation, PR ready, run failed | P2 |

### 8.11 Operator surfaces

| ID | Requirement | Pri |
|---|---|---|
| F-OPS-1 | CLI: `factory init · submit · status · runs · logs <run> · approve · reject · retry · cancel · stop-all · bench · metrics` | P0 |
| F-OPS-2 | `factory serve`: the daemon (scheduler + workers + HTTP API + webhooks + dashboard) | P0 |
| F-OPS-3 | **Dashboard** (plain HTML + SSE, no framework): line view (items per station), run detail (live agent events, gates, evidence), inbox, metrics, cost | P1 |
| F-OPS-4 | HTTP API (JSON) mirrors the CLI so other tools can drive the factory | P1 |
| F-OPS-5 | The factory is itself available to agents as an **MCP server** (`factory mcp`), so a `noobly` chat can submit and inspect work | P2 |

### 8.12 Measurement & evals

| ID | Requirement | Pri |
|---|---|---|
| F-MEAS-1 | Per run: tokens, cost, wall time, time per station, turns, tool calls, attempts, gates passed first time, human touches | P0 |
| F-MEAS-2 | Factory metrics: throughput, lead time (item → PR, item → merge), first-pass gate rate, PR acceptance rate, human-edit rate, cost per merged PR, escalation rate | P1 |
| F-MEAS-3 | **Factory bench**: cases = (repo snapshot, issue text, hidden acceptance tests); runs the full line; reports resolve rate with repeats and variance | P1 |
| F-MEAS-4 | A/B compare two line configurations (roles, models, prompts, stations) on the bench | P2 |

### 8.13 Fleet (stretch)

| ID | Requirement | Pri |
|---|---|---|
| F-FLT-1 | **Campaigns**: one change description applied across N repos (e.g. "bump Node to 24"), one PR per repo, rate-limited | P2 |
| F-FLT-2 | Scheduled work: recurring items (weekly dependency updates, flaky-test hunts) | P2 |

## 9. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-1 | **Runtime**: Node.js ≥ 24 (for stable `node:sqlite`), ES modules, `// @ts-check` + JSDoc, same conventions as the harness |
| NF-2 | **Dependencies**: core uses Node built-ins only (`node:sqlite`, `node:http`, `child_process`, `fetch`, `node:test`). The harness is the one required dependency. Every other dependency needs a one-line justification in Architecture §17 |
| NF-3 | **Readability**: each module < ~300 lines; each concept in its own file; the scheduler loop < ~150 lines |
| NF-4 | **Offline tests**: every station, the scheduler and the full line run in tests with the harness mock provider and the local forge. No test touches the network or spends tokens |
| NF-5 | **Crash safety**: `kill -9` of the daemon at any moment loses at most the in-flight agent turn, never job state or artifacts |
| NF-6 | **Safety**: secrets never in prompts, transcripts or logs; untrusted text fenced and labelled; sandbox mandatory for agent runs; default autonomy is `L1` |
| NF-7 | **Cost control**: no run can exceed its budget by more than one model request; a daily global spend cap stops the scheduler |
| NF-8 | **Observability**: every state change is an event; every event is visible in the dashboard and queryable via CLI |
| NF-9 | **Portability**: Linux first (bubblewrap sandbox, like the harness); macOS best effort; containers optional (M6) |

## 10. User stories (end state)

1. *As a requester,* I label a GitHub issue `factory` and, within the hour, get a PR that links a spec, lists the acceptance criteria it meets, shows green gates and costs under $2.
2. *As an operator,* I run `factory serve` and open the dashboard: I see six items moving through stations, one parked waiting for my answer, and today's spend.
3. *As a reviewer,* I leave "use the existing logger instead" on a factory PR; minutes later the fixer pushes a revision, and a week later that preference appears in a proposed `tech.md` change.
4. *As a learner,* I `git diff phase-F05 phase-F06` and see exactly what a scheduler with leases costs in code.
5. *As an operator,* I hit `factory stop-all`; every agent is interrupted, workspaces are kept for inspection, nothing is pushed.
6. *As the learner,* I change the builder's model and run `factory bench --compare`; the report tells me whether resolve rate or cost per resolve changed beyond noise.
7. *As a harness user,* I ask `noobly` "file this as factory work" and it submits a work item through the factory MCP server.

## 11. Harness integration requirements

The factory is the harness's most demanding client. These are the capabilities it needs from `noobly`. Items marked **exists** are already in harness v2; the rest are proposed harness phases (see [Roadmap § Harness track](./Roadmap.md#harness-track-work-the-factory-needs-from-noobly)).

| ID | Need | Harness today | Status |
|---|---|---|---|
| H-1 | Programmatic sessions with an event stream | `createSession()`, `query()`, `session.stream()` (Phase 17) | **exists** |
| H-2 | Headless subprocess with machine-readable events and exit codes | `noobly -p --output-format stream-json` (Phase 17) | **exists** |
| H-3 | Per-session tool allow/deny and permission modes | `allowedTools`, `disallowedTools`, `permissionMode` | **exists** |
| H-4 | Route "ask" to an external approver | `requestPermission` callback (library only) | **exists** (library); needs a headless equivalent |
| H-5 | OS sandbox with network allowlist | Phase 20 `sandbox` settings | **exists** |
| H-6 | Custom agent roles | `.noobly/agents/*.md` (Phase 13) | **exists**; needs a way to load roles from an extra directory |
| H-7 | Factory tools inside the agent | `tools` option (library), MCP servers (Phase 14) | **exists** |
| H-8 | Project instructions from steering files | `NOOBLY.md` / `AGENTS.md` loading (Phase 07) | **exists**; needs extra instruction file paths |
| H-9 | Worktree create/finish | `src/agents/worktree.js` (Phase 29) | **exists**, but not exported from the library |
| H-10 | Trace, usage and cost per turn | `turn_end` event, `/stats` (Phase 19) | **exists** |
| H-11 | **USD budget cap** per session (interrupt when exceeded) | only `maxTurns` | **proposed** |
| H-12 | **Structured final output** (JSON-schema-validated result, e.g. review findings) | free text only | **proposed** |
| H-13 | Resume a saved session by id from the library / headless (for repair loops that keep context) | `--resume` interactive; library unclear | **proposed** |
| H-14 | Stable, versioned event schema (`schemaVersion` in `init` and each event) | unversioned | **proposed** |
| H-15 | Non-interactive trust for factory-managed workspaces (the factory vouches for the checkout) | trust prompt / `noobly trust` | **proposed** |
| H-16 | Eval suite v2 (Phase 23, skipped) | skipped | **proposed**; the factory bench builds on it |
| H-17 | Container sandbox backend (Docker/Podman) | "Beyond v2" | **proposed** for M6 |

## 12. Success metrics

| Metric | Target (end of M5) |
|---|---|
| Factory bench resolve rate (≥ 20 cases from `nooblyjs-*` history, 3 repeats) | ≥ 60% |
| First-pass deterministic gate rate | ≥ 50% |
| PRs merged without human code edits (real use, 4 weeks) | ≥ 50% |
| Median cost per merged PR | ≤ $3 |
| Median lead time, item → PR ready (small items) | ≤ 30 min |
| Runs exceeding budget by more than one request | 0 |
| Pushes to protected branches by the factory | 0 |
| Offline test suite runtime | ≤ 60 s |

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Prompt injection through issue text makes an agent exfiltrate secrets or push malicious code | Untrusted fencing (F-IN-5); sandbox with no secrets inside; egress allowlist; forge tokens held by the control plane, never the agent; human gate on PRs by default |
| Runaway cost from loops or repair cycles | Per-session USD cap (H-11), per-run and daily caps (NF-7), bounded repair attempts (F-VER-5) |
| Agents "pass" by weakening tests | Scope guard on test files; reviewer checks tests against acceptance criteria; hidden tests in the bench |
| Specs become ceremony that slows small work | Size-based routing: bugs/chores skip to a plan (F-SPEC-3) |
| Merge conflicts from parallel tasks | Tasks declare touched paths; scheduler serialises overlapping tasks; integrator re-runs gates |
| Harness changes break the factory | Versioned event schema (H-14), a contract test suite run against the harness in CI |
| Too much infrastructure to learn anything | Everything on SQLite + Node built-ins; no queues, orchestrators or frameworks |
| Model variance makes A/B results noise | Repeats, confidence intervals, fixed seeds of repo state, report variance with every number |

## 14. Open questions

1. In-process vs subprocess as the default driver? *(Proposed: subprocess in `serve`, in-process in tests; see Architecture §7.)*
2. Should specs live in the target repo (`.factory/specs/`) or in the factory's own store? *(Proposed: in the repo, committed on the item branch, so reviewers see them in the PR.)*
3. EARS for acceptance criteria, or plain Given/When/Then? *(Proposed: EARS for requirements, Given/When/Then allowed in tests.)*
4. How far should auto-merge (`L3`) go in a learning project? *(Proposed: only for the factory's own docs/chore items until the bench target is met.)*

## 15. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-30 | The factory **drives** the harness; it never embeds a second agent loop | One agent runtime to learn and improve; the factory teaches *orchestration* |
| 2026-09-30 | SQLite (`node:sqlite`) event log as the only store | Durable workflows without infrastructure; the concept is event sourcing, not the database |
| 2026-09-30 | Local forge first, GitHub second | Offline, free, deterministic tests; GitHub is an adapter on a stable interface |
| 2026-09-30 | Spec-driven stations modelled on Kiro-style requirements → design → tasks | Specs are the biggest lever on agent success and make PRs reviewable |
| 2026-09-30 | Deterministic gates run outside the agent | An agent cannot talk its way past `npm test` |
| 2026-09-30 | Default autonomy `L1 supervised` | Earn trust with measurements before removing humans |

---

## 16. Requirements status (as built)

✅ met · ◐ partly (the gap is named) · ⬜ not built. "Pending a model" means built and tested offline, with the real-world checkpoint needing an API key.

### Functional

| Area | Status |
|---|---|
| **Intake** | ✅ F-IN-1 (issue files, GitHub labels, `@factory run`, `factory mcp` `submit_item`, campaigns, schedules) · ✅ F-IN-2 · ✅ F-IN-3 (plus a `confidence`, F22) · ⬜ **F-IN-4 duplicate detection** (only the same issue is de-duplicated) · ✅ F-IN-5 |
| **Specs** | ✅ F-SPEC-1…4 · ⬜ **F-SPEC-5 tests-first** (no test-writer role; criteria are traced to test names instead, F14) |
| **Orchestration** | ✅ F-ORC-1, 2, 3, 5, 6, 7 · ◐ F-ORC-4 (global and per-repo limits; no per-role limit) · ◐ F-ORC-8 (a global stop-all and per-run cancel; no per-repo switch) |
| **Roles** | ✅ F-ROLE-1, 3, 4 · ✅ F-ROLE-5 (routing policies, F22) · ◐ F-ROLE-2 (triager, spec-writer, builder, integrator, reviewer, security-reviewer, fixer, retro; no planner, test-writer or docs-writer) |
| **Execution** | ✅ F-EXE-2, 4, 5, 6 · ✅ F-EXE-7 (workers pull agent *steps*, F23) · ◐ F-EXE-1 (worktrees; the agent in a container waits for H37) · ◐ F-EXE-3 (the sandbox needs bubblewrap; `--allow-unsandboxed` is an explicit escape; the repo's commands can use containers) |
| **Verification** | ✅ F-VER-2…7 · ◐ F-VER-1 (gates, scope and a secret scan; no coverage-delta gate) |
| **Integration** | ✅ F-INT-1, 2, 3, 5 · ◐ F-INT-4 (review comments and `@factory fix` reopen the fixer; failing *CI* checks don't yet) |
| **Humans** | ✅ F-HUM-1, 2, 3 · ◐ F-HUM-4 (refused permission asks become inbox *policy gaps* after the fact; live routing needs H34) |
| **Knowledge** | ✅ F-KNOW-1…4 (learned rules go to steering, not skills) |
| **Forges** | ✅ F-FRG-1, 2, 4, 5 · ◐ F-FRG-3 (a commit *status*, not a check run: check runs need a GitHub App) · GitHub end to end pending a real repository |
| **Operations** | ✅ F-OPS-1, 2, 3, 5 · ◐ F-OPS-4 (the API reads and acts, but doesn't submit items: use the CLI or MCP) |
| **Measurement** | ✅ F-MEAS-1, 2 · ✅ F-MEAS-3 (21 cases; the model baseline is pending a model) · ◐ F-MEAS-4 (compares routing policies and steering overlays, not arbitrary line configurations) |
| **Fleet** | ✅ F-FLT-1, 2 |

### Non-functional

| | |
|---|---|
| ✅ NF-1, NF-2 | Node ≥ 24, ES modules, `// @ts-check`; the harness is still the only dependency |
| ✅ NF-3 | every module is under 300 lines; the scheduler is 120 |
| ✅ NF-4 | 235 tests, offline, with the mock provider, the local forge and a fake GitHub; `npm run check:examples` for the docs |
| ✅ NF-5 | tested with `kill -9` (F05) and lost leases (F06, F23) |
| ✅ NF-6 | since F24: secrets scrubbed from agents, every commit scanned before a push, the red-team suite |
| ✅ NF-7, NF-8 | budgets reserve and cap; every state change is an event, visible in `factory logs`, the dashboard and the audit export |
| ◐ NF-9 | Linux (bubblewrap, or containers for the repo's commands); macOS untested |

### What the harness still needs (§11)

H-11 (budget) and H-12 (structured output) are worked around in the factory (its own USD watchdog; JSON validated by the factory). **H-13** (resume a session: `ask_human` and repairs restart a step today), **H-15** (trusted workspaces for the in-process driver) and **H-17** (container backend: the agent in a container) are the ones that would change the factory's behaviour.
