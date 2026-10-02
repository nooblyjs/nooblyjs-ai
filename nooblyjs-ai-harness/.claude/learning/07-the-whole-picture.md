# Lesson 7: The whole picture

You now have all four jobs: **loop, control, context, interface**. This lesson puts them back together by following one message all the way through noobly, then gives you a map of the code so you can find your way around again.

## One message, start to finish

You type `noobly`, then: **"fix the failing test in parser.test.js"**.

### Startup (once per session)

```
bin/noobly.js            registers tsx (so .jsx runs), imports src/cli.js
  └─ src/cli.js          reads flags (--model, -p, --echo, acp…)
      └─ createSession() src/core/create-session.js: the one place everything is wired together
           ├─ settings     layered: defaults → ~/.noobly → project → flags        (src/config/)
           ├─ trust        project hooks/MCP stay off until you trust the repo    (src/config/trust.js)
           ├─ provider     Anthropic / OpenAI / Grok / Ollama / echo, from your key (src/providers/)
           ├─ permissions  rules + mode                                            (src/permissions/)
           ├─ context      environment, NOOBLY.md, skills, agents, memory, repo map (src/context/)
           ├─ system prompt built from sections                                    (system-prompt.js)
           ├─ hooks, MCP servers, sandbox, checkpoints, feedback
           ├─ tools        the registry                                            (src/tools/index.js)
           └─ new Session(…)                                                       (src/core/session.js)
      └─ the front-end   Ink UI (src/ui/start.jsx), or headless, or ACP
```

**A Session is just a bag of state:** the provider, the model, the system prompt, the tools, the permissions, and `history`, the array (Lesson 2). Read the constructor in `src/core/session.js`: it's mostly assignments.

### The turn

```
You press Enter
 │
 ├─ UserPromptSubmit hook                                         CONTROL
 ├─ reminders attached ("you're in default mode", changed files)  CONTEXT
 ├─ near 80% of the window? compact first                         CONTEXT
 ├─ checkpoint: start turn 7                                      CONTROL
 │
 ├─ ROUND 1  request = system + tools + history + your message    LOOP
 │    ◄ streams: "Let me run the test." + tool_use Bash {npm test parser}
 │    · validate input → PreToolUse hook → gate: sandboxed, so allow → run in bubblewrap
 │    ◄ tool_result: "✗ expected 3, got 2 … at parser.js:41"
 │
 ├─ ROUND 2  ◄ tool_use Read {parser.js}            (read-only: no question asked)
 ├─ ROUND 3  ◄ tool_use Edit {old_string…new_string}
 │    · read-before-write ✓ → gate: ASK YOU → [dialog] you press "yes"
 │    · snapshot parser.js (for /rewind) → edit → syntax check: no new problems
 ├─ ROUND 4  ◄ tool_use Bash {npm test parser}  → ✓ passes
 ├─ ROUND 5  ◄ "Fixed: the loop was off by one…"  stop_reason: end_turn
 │
 ├─ Stop hook (if you set one: "tests must pass")                 CONTROL
 ├─ commit pending → history; append to transcript                CONTEXT
 └─ turn_end event → UI shows cost, time, rounds                  INTERFACE
```

Five model calls, four tools, one permission dialog, and all of it is the loop from Lesson 3, with the control and context layers attached at fixed points.

Read `runTurn` in `src/core/loop.js` from top to bottom now. Every block in it should match a line in this diagram. If one doesn't, that's the bit to reread.

## One loop, many front-ends

Remember that `runTurn` yields **events** and doesn't care who's listening. That's why noobly has four interfaces sharing one engine:

```
                         ┌──► Ink terminal UI     src/ui/App.jsx       (you, chatting)
                         │
 Session.stream(text) ───┼──► headless -p         src/ui/headless.js   (scripts, CI: text / json / stream-json)
   (runTurn: events)     │
                         ├──► library query()     src/index.js         (your own Node code)
                         │
                         └──► ACP                 src/ui/acp.js        (editors like Zed)
```

The difference between front-ends is mostly **who answers "ask"**. The Ink UI shows a dialog. Headless and the library have nobody to ask, so "ask" means **no** (that's what you saw in the lab), unless you pass `requestPermission` or allow rules. ACP forwards the question to the editor.

## The map of the code

Grouped by job, so you can predict where something lives:

| Job | Folder / file | What's there |
|---|---|---|
| **Loop** | `src/core/loop.js` | ⭐ the agent loop. Start here, always. |
| | `src/core/session.js`, `create-session.js` | the state; the wiring |
| | `src/core/events.js` | every event type, documented |
| | `src/providers/` | one adapter per API; `sse.js` streaming; `retry.js`; `mock.js`/`echo.js` fakes |
| | `src/tools/` | one file per tool; `tool.js` (the contract); `registry.js` |
| **Control** | `src/permissions/gate.js` | ⭐ `decide()`: the 8-step order |
| | `src/permissions/rules.js` | `Tool(pattern)` rules, splitting shell commands |
| | `src/sandbox/` | `policy.js` (what's allowed, as data), `bwrap.js`/`seatbelt.js` (OS backends), `proxy.js` (network filter) |
| | `src/hooks/runner.js` | running your hook commands |
| | `src/checkpoints/` | snapshots for `/rewind`, `/diff` |
| | `src/config/trust.js` | trusting a project's settings |
| **Context** | `src/context/system-prompt.js` | ⭐ the sections of the prompt |
| | `src/context/reminders.js` | `<system-reminder>` notes |
| | `src/context/compact.js`, `tokens.js`, `cache.js` | making room; counting; prompt caching |
| | `src/context/repo-map.js` | the PageRank map |
| | `src/skills/`, `src/memory/`, `src/agents/` | progressive disclosure: skills, memory, subagents |
| | `src/session-store/transcript.js` | JSONL transcripts, resume |
| **Interface** | `src/ui/` | Ink components, `headless.js`, `acp.js`, Markdown rendering |
| | `src/commands/` | `/slash` commands, built in and your own |
| | `src/index.js` | the library API |
| **Extensions** | `src/mcp/` | other programs' tools over JSON-RPC |
| | `src/tasks/` | background processes (dev servers…) |
| | `src/feedback/` | checks after every edit |

## Placing every phase

Here's every phase in noobly, sorted by the job it does. If you can explain *why* each one is needed from what you've learned, you're back in touch.

| Job | Phases |
|---|---|
| **Loop** | 01 one API call · 02 multi-turn history · 03 streaming, interrupts, retries · 04 ⭐ the agent loop · 05 the toolset · 18 robustness (broken streams, `pause_turn`, thinking) · 22 background tasks · 25 edit tools per model · *extra*: multiple providers |
| **Control** | 06 ⭐ permissions · 11 plan mode · 12 hooks · 20 ⭐ sandbox · 21 checkpoints & rewind · 24 feedback after edits · 29 worktrees |
| **Context** | 07 ⭐ system prompt & reminders · 08 context window & compaction · 09 sessions & caching · 13 subagents · 15 skills · 16 memory · 26 big output · 27 repo map · 28 images |
| **Interface** | 02 Ink UI · 10 settings & slash commands · 14 MCP · 17 headless & library · 19 tracing & evals · 30 ACP · *extra*: Markdown |

(Some phases do two jobs. Subagents are also a tool. Feedback after edits is as much context as control. That's fine: the four jobs are a lens, not a strict taxonomy.)

## How v1 → v2 fits the story

- **v1 (phases 00–19)** is a complete *assistant*: it can do anything, but it **asks before everything risky**, so you have to sit there.
- **v2 (phases 20–30)** is about an agent you can **leave running**. That needs: limiting what can go wrong (sandbox), undoing what did go wrong (checkpoints), not blocking on slow things (background tasks), better results per attempt (feedback, edit tools, big output, repo map), and scaling out (worktrees, editors).

Each v2 feature removes a reason for a human to babysit. That is the direction the whole field is moving in.

## Where to go next

1. **Run both labs again**, and make the changes suggested in Lessons 3 and 5.
2. **Read `src/core/loop.js` end to end.** It's ~460 lines and now you know what every part is for.
3. **Try `node bin/noobly.js --echo`.** Type `read package.json`, `run ls`, `write x.txt hi`, `task read package.json`. You play nothing; echo fakes the model, and the real harness does the rest.
4. **Pick one phase** that felt fuzzy and compare its tag with the one before, e.g. `git diff phase-03 phase-04 --stat` (the agent loop: 29 files, ~1,200 lines), to see exactly what it cost in code. Then read its note in [`../docs/`](../docs/README.md). (A few early phases were built together and share a tag; `git tag` lists them all.)
5. Keep [`../docs/glossary.md`](../docs/glossary.md) open for terms.

## Final check: explain it to someone else

If you can answer these without looking, you've got it:

1. What is a harness, in one sentence?
2. Draw the agent loop.
3. Why is the model's "memory" really the harness's job?
4. "The model proposes, the harness disposes." Give three layers that do the disposing.
5. What's progressive disclosure, and name three features that use it?
6. Why can noobly have a terminal UI, a CLI mode, a library and an editor integration without four copies of the agent?

<details><summary>Answers</summary>

1. The program around a text-in/text-out model that gives it memory, tools, context and limits, turning it into an agent.
2. Call the model → `tool_use`? run the tools, append `tool_result`s, repeat → `end_turn`? done.
3. The model is stateless; the harness keeps the history (and memory files, transcripts) and re-sends what's needed on each call.
4. Any three of: hooks, the permission gate (rules + modes), the sandbox, checkpoints, read-before-write, project trust.
5. Always show a short pointer, and load the full content on demand. Skills, memory, subagents (their results), big output saved to files, the repo map.
6. The loop is an async generator that yields events; each front-end is just a different consumer of the same events.

</details>

← [Back to the course index](./README.md)
