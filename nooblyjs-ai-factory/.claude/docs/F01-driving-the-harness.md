# Phase F01: Driving the harness

**Goal:** run a `noobly` agent from factory code, watch it through events, stop it on demand, and never let it spend more than it's allowed.

---

## The idea: an agent is a function call

In the harness, an agent is a *conversation*: you type, it answers, you type again. To a factory, an agent is a **function call**:

```
            ┌──────────────── AgentRun ─────────────────┐
            │ cwd · prompt · model · permissions ·      │
            │ limits { maxTurns, timeoutMs, budgetUsd } │
            │ signal (the stop button) · onEvent        │
            └──────────────────┬────────────────────────┘
                               ▼
                     driver.run(agentRun)
                               │  events, as they happen ──► onEvent (the dashboard, the log…)
                               ▼
            ┌──────────────── StepResult ───────────────┐
            │ outcome · text · usage · costUsd · turns  │
            │ toolCalls · durationMs · sessionId        │
            └───────────────────────────────────────────┘
```

Everything else in the factory (stations, the scheduler, the repair loops) only ever sees this interface. It never sees Ink, transcripts, providers or the loop. That's what "the harness is the worker" means in code.

The single most important field is **`outcome`**, because the factory's next decision depends on it:

| outcome | Means | What the factory will do (later phases) |
|---|---|---|
| `success` | The agent finished its turn | Run the checks (F04) |
| `max_turns` | Hit the round limit | Retry with more room, or escalate |
| `budget` | Would cost more than allowed | Stop and escalate: never auto-retry money |
| `timeout` | Ran too long | Retry once, then escalate |
| `interrupted` | Someone pressed stop (kill switch, lost lease) | Leave it; the caller knows why |
| `refusal` / `blocked` | The model declined / a hook blocked the prompt | Escalate to a human |
| `error` | Something broke (API down, crash) | Retry with backoff |

## Two drivers, one interface

| | **in-process** (`src/exec/harness/in-process.js`) | **subprocess** (`src/exec/harness/subprocess.js`) |
|---|---|---|
| How | `createSession()` + `session.stream()` from the harness library (harness Phase 17) | `noobly -p --output-format stream-json … -- "<prompt>"` |
| Start-up | ~0 ms | ~1 s (Node + tsx + loading the harness) |
| Scripted model for tests | ✅ pass a `createMockProvider([...])` **object** | ❌ only provider ids (a fake `noobly` binary instead) |
| If the agent hangs the event loop | the factory hangs too | only that process hangs; we kill it |
| If it leaks memory / crashes | it's our memory / our crash | its own |
| Stopping it | abort an `AbortSignal` | `SIGINT`, then `SIGKILL` after a grace period |
| Moves into a container later (F23) | no | yes: it's already "a command, some env, a stream of lines" *(as built, F23 moved agent steps to remote workers; the agent inside a container still waits for the harness's H37)* |

**Rule of thumb:** tests and quick experiments use in-process; `factory serve` (F06) will default to subprocess. Commercial factories make the same choice for the same reason: the agent runs in its *own* VM or container, and the orchestrator talks to it over a narrow channel.

## Reading a stream of JSON lines (`ndjson.js`)

`noobly --output-format stream-json` (harness Phase 17) prints one JSON object per line:

```
{"type":"system","subtype":"init","session_id":"…","model":"echo","tools":[…]}   ← first
{"type":"message_start","model":"echo","usage":{"input_tokens":10}}
{"type":"text_delta","text":"I'll "}
{"type":"tool_start","id":"toolu_echo_1","name":"Read","input":{"file_path":"a.txt"}}
{"type":"tool_end", … ,"content":"     1\thello file","isError":false}
{"type":"turn_end","text":"…","usage":{…},"cost":0,"rounds":2,"toolCalls":1}
{"type":"result","subtype":"success","total_cost_usd":0,"session_id":"…"}         ← last
```

But a pipe delivers **chunks**, not lines. A chunk can end in the middle of a line, or even in the middle of a character: `é` is two bytes in UTF-8, and the chunk boundary can fall between them. The parser:

1. decodes with `TextDecoder(…, { stream: true })`, which holds on to half a character until the rest arrives,
2. keeps the unfinished last line in a buffer,
3. parses only complete lines, and reports (but doesn't crash on) a line that isn't JSON.

It's the same problem the harness solved for server-sent events in its Phase 03, one level up. The test cuts the input every 3 bytes on purpose, and the fake `noobly` has a `split` mode that writes 7 bytes at a time.

## Stopping a run: three reasons, one button (`limits.js`)

```
caller's signal (kill switch, Ctrl+C) ──┐
timeoutMs timer ────────────────────────┼──► one AbortController ──► the harness stops
budget watchdog (every event) ──────────┘      + we remember WHICH one fired
```

The harness only knows "I was interrupted". The factory needs to know **why**: a timeout might be retried, while a budget stop must not be. So `createLimits()` records the reason, and `outcomeOf(end, stopped)` lets our reason win over the harness's.

Stopping a subprocess is **polite first**: `SIGINT` makes the harness abort its turn cleanly and still print a `result` line (exit code 130). If it hasn't exited after `graceMs` (5 s), `SIGKILL`. The fake `noobly` has a `stubborn` mode that ignores SIGINT, to prove the second step works.

## The budget problem: you only know the price at the end

This was the most interesting part. The harness reports the **exact** cost only in `turn_end`, at the *end* of the turn. A runaway agent can make 25 model requests before that. So the factory has to **estimate while it runs**, from the events it can see:

| Event | What it tells us | How good |
|---|---|---|
| `message_start` | `usage.input_tokens` of this request (the whole conversation so far) | **exact**, and usually most of the cost |
| `text_delta`, `thinking_delta` | output text | ≈ 4 characters per token |
| `tool_start` | the tool's input JSON (also output tokens) | ≈ 4 characters per token |
| `turn_end` | `cost` | exact… mostly (see below) |

The nice property: **input tokens are known at `message_start`, before the model writes anything.** Each request re-sends the whole history (harness Phase 02: "why turn 20 costs more than turn 1"), so input dominates. That means the watchdog usually stops a runaway **before the next expensive request**, which is what the budget test checks: the second request is never made.

Why estimate at all? Because the harness doesn't pass on its per-request `message` event (which has the exact output tokens) to consumers. The proper fix is for the harness to enforce a budget itself: **harness track H32** (`--max-budget-usd`). Until then, the watchdog works from outside.

### A surprise: "exact" cost after an interrupt is too low

The first version trusted `turn_end.cost` whenever it arrived. The budget test failed: after stopping an expensive run, the reported cost was **$0**. The harness adds up only requests that *finished*, and the one we cut off never finished. But a real API bills the input tokens of a request you abort mid-stream. So now, for an interrupted turn, `limits.js` keeps whichever is **larger**, the harness's number or our running estimate, and marks the result `costIsEstimate`. **Money numbers should err high.**

## A fake `noobly` and a real one (`test/fixtures/fake-noobly.js`)

To test the subprocess driver offline and fast, `$FACTORY_NOOBLY_BIN` points at a fake that **replays a recorded run**. `test/fixtures/noobly-echo-read.ndjson` is real output, captured from `noobly --echo`, not typed by hand. The fake has modes for everything that's awkward to cause on purpose: `split` chunks, `noise` (a stray non-JSON line), `crash` (exit 3 with no result), `hang`, `stubborn`.

Fakes drift from reality, though. So one test is a **contract test**: it runs the *real* `noobly` with its offline echo model and checks that the events we depend on still arrive (`message_start`, `text_delta`, `tool_start`, `tool_end`, `turn_end`, then a `result`). If a harness change breaks the format, this test fails here, in the factory, first. (A versioned event schema, harness track H31, will make this explicit.)

It also checks one more thing: with `harnessHome` set, the harness writes its transcript to **our** folder (`NOOBLY_HOME`), not `~/.noobly`. F02 builds on that.

## What was built

| File | What it does |
|---|---|
| `src/exec/harness/driver.js` | `AgentRun`, `Limits`, `StepResult` types; `createDriver(name)`; `outcomeOf()` |
| `src/exec/harness/in-process.js` | The harness as a library |
| `src/exec/harness/subprocess.js` | The harness as a process: arguments, NDJSON, SIGINT → SIGKILL, result → StepResult |
| `src/exec/harness/ndjson.js` | Chunk-safe JSON-lines parser |
| `src/exec/harness/limits.js` | Caller stop, timeout, and the budget watchdog |
| `src/commands/agent.js` | `factory agent`: run one agent by hand |
| `test/fixtures/fake-noobly.js` + `noobly-echo-read.ndjson` | A fake harness replaying a recorded real run |

## Try it

```bash
# Offline, through a real noobly process (the echo model):
node bin/factory.js agent --echo "read package.json"

# Offline, in-process, with a SCRIPTED model (see the JSON file):
node bin/factory.js agent --script examples/scripts/read-and-summarise.json --model claude-sonnet-5-5 "what is this?"

# The result object a station will get:
node bin/factory.js agent --echo --json "hello"

# With a real model (set ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY):
node bin/factory.js agent --cwd ../nooblyjs-learn-harness "What does src/core/loop.js do?"
node bin/factory.js agent --cwd ../nooblyjs-learn-harness --budget 0.001 "Explain the whole codebase"   # → budget
node bin/factory.js agent --timeout 5 "Write a long essay about rivers"                               # → timeout
```

Press **Ctrl+C** during a run: the outcome is `interrupted`, and the child `noobly` is stopped too.

## Harness notes (for the harness track)

- **H32:** a budget inside the harness would be exact and simpler. The factory's watchdog is an estimate from outside.
- The per-request `message` event (exact usage per request) isn't forwarded to library/stream-json consumers. Forwarding it, or adding usage to a per-request event, would make outside budgets exact too.
- `turn_end.cost` after an interrupt leaves out the aborted request's input tokens, which were billed.

## What we learned

- **A factory sees an agent as a function**: prompt + limits in, events + one outcome out. Keep that seam narrow and everything else gets simpler.
- **In-process vs subprocess is a failure-isolation choice**, not a performance one.
- **Chunks aren't lines, bytes aren't characters.** Every stream parser has to handle both.
- **Know *why* you stopped.** One abort signal, but three reasons, and each leads to a different next step.
- **Budgets must be enforced while running, and should err high.** Input tokens are known before the output is generated, so you can stop before the next expensive request.
- **Record real output for fakes, and keep one contract test against the real thing.**
- How the commercial factories appear to do it: an orchestrator runs each agent in its own VM or container and streams its events back (Devin's and Codex's live task logs); spending is capped per task (e.g. Devin's per-session ACU limits). Anthropic's Claude Agent SDK appears to take our "subprocess" route: it starts Claude Code as a child process and talks to it in stream-json, much like our subprocess driver talks to `noobly`.
