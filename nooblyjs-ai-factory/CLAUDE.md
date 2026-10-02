# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`factory` is an agentic software factory built on top of the `noobly` harness (`../nooblyjs-ai-harness`, linked as a `file:` dependency, so it must be checked out next to this repo). Shared AI building blocks (cost, tokens, frontmatter, SSE) come from `../nooblyjs-ai-common`, linked the same way. Issues go in; verified PRs come out. It's a learning project built one concept per phase (F00–F25). Each phase has a plain-language doc in `.claude/docs/` explaining what it adds and why. `.claude/docs/reference.md` lists every command, config key, repo file, env var, station, status, event and endpoint. The plan lives in `.claude/steering/` (PRD, Architecture, Roadmap). Architecture §20 and PRD §16 describe what was actually built.

## Commands

```bash
npm install                                   # links ../nooblyjs-ai-harness and ../nooblyjs-ai-common
npm test                                      # all tests: node --test "test/**/*.test.js" (offline)
node --test test/line.test.js                 # one test file
node --test --test-name-pattern="<regex>" test/line.test.js   # one test
npm run check:examples                        # run every documented example (examples/examples.txt) against a fresh demo repo
node bin/factory.js --help                    # the CLI (also `npm start`)
```

There is no build step and no linter. Type checking comes from `// @ts-check` plus JSDoc.

Offline end-to-end run with a scripted agent (no API key needed):
```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc
node bin/factory.js run examples/issues/add-subtract.md --repo /tmp/calc \
  --script examples/scripts/subtract-slow.json --autonomy L2 --allow-unsandboxed
```
Without bubblewrap (Linux) or `FACTORY_CONTAINER_IMAGE`, the factory refuses to run unsandboxed commands unless you pass `--allow-unsandboxed`.

One known flaky test: F05's multi-process database test fails about one full run in four. The F24 doc describes it.

## Architecture

- **The harness is the worker; the factory is the control plane.** Each agent step is a `noobly` session (in-process or subprocess driver, `src/exec/harness/`) running in its own git worktree with a per-step sandboxed harness home (`src/exec/workspace/`). The factory commits, pushes and decides. Agents never push and never see the factory's secrets (`src/security/agent-env.js`).
- **The event log is the only source of truth** (`src/store/`). Every state change is appended as an event in SQLite (`$FACTORY_HOME/factory.db`, default `~/.factory`). Tables are projections derived from the log (`projections.js`), and `factory db rebuild` replays them. The dashboard, metrics, audit, notifications, retries and the learning loop all read from this log. Events can carry an idempotency `key`, and outside-world effects go through `performEffect` (`effects.js`).
- **Lines are data** (`lines/*.json`): an ordered list of stations, each with a `kind`, an optional `when` condition (`src/line/conditions.js`) and `retries`. `src/line/engine.js` `decide(run, line)` is a pure function from the run's projected state to the next action. `executor.js` performs that action, records events, and asks again, so crash recovery just means calling `decide()` again. Station implementations live in `src/line/stations/`. In the engine's terms, a station that *throws* has failed and gets retried, while a station that returns a stop result (e.g. triage says the issue is unclear) is done.
- **Stations build agents with `agentFor`** (`src/line/stations/common.js`), which applies roles (`src/roles/builtin/*.md`, overridable per repo and by the operator), model tiers, cost-aware routing (F22) and factory MCP tools (F16). Stations that change code run agents through `stepRunnerFor`, which lets them run on remote workers (F23). The core step is `src/exec/step-runner.js`: acquire workspace → cached setup → agent (with Stop hook) → gates → release.
- **Deterministic checks decide.** The repo's gates (`.factory/config.json`), the scope guard, the test-tampering check (`src/review/tampering.js`) and the secret scan decide whether a PR is ready or draft. Model reviewers can add findings, but a model's verdict never passes a gate.
- `src/cli.js` maps command names to `src/commands/*.js`. `src/forge/` is the PR target: a local forge under `$FACTORY_HOME/forge/` or GitHub. `src/server/` holds the HTTP API, dashboard, SSE, webhooks and the workers API.

## Conventions

- Node ≥ 24, ES modules, `// @ts-check` + JSDoc types.
- **Core code uses Node built-ins only.** The harness is the only dependency. Adding a new dependency requires a line in Architecture §17.
- **Import the harness only through `src/harness.js`**, and never copy harness code. Deep imports of harness internals are listed there.
- Each file holds one concept and opens with a comment naming the phase that added it and explaining the idea in plain words. Keep modules under ~300 lines.
- Anything that depends on time or randomness takes a `clock` (`src/util/clock.js`) so tests never wait.
- A new event type needs a line in `describe()` (`src/commands/history.js`) and in the event list in `reference.md`.
- Nothing is pushed without the secret scan. New secrets go in environment variables that config names, never in files.

## Tests

- `npm test` must pass **offline**, with no network and no API key. Use the harness mock provider (`createMockProvider`), a scripted provider, a fake `noobly` (`FACTORY_NOOBLY_BIN`) or the fake GitHub (`test/fixtures/fake-github.js`).
- Tests that touch files use a temporary `FACTORY_HOME` / `NOOBLY_HOME` (see `testEnv()` and `makeRepo()` in `test/helpers.js`), never the real `~/.factory`.
- `test/redteam.test.js` lists things that must never be delivered. A change that lets one of them through is a security bug.

## Phase workflow

Work on a branch `phase-FNN-<slug>`, add `.claude/docs/FNN-<topic>.md` (template: `.claude/docs/_template.md`), merge to `main`, and tag `phase-FNN`. Then update the docs index (`.claude/docs/README.md`), the README phase table, the Roadmap status, and `reference.md` for any new command, config key, file, event or endpoint.
