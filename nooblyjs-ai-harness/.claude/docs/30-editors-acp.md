# Phase 30: Editors and other front-ends

**Goal:** use noobly from inside an editor, without changing the agent loop at all.

---

## One loop, many front-ends

The agent loop has produced **events** since Phase 03 (`text_delta`, `tool_start`, `tool_end`, `turn_end`…), and never cared who reads them:

| Front-end | Reads events and… |
|---|---|
| Ink UI (Phase 02) | draws them in the terminal |
| print mode / JSON (Phase 17) | writes text or JSON lines |
| library `query()` (Phase 17) | hands them to your code |
| **ACP (this phase)** | sends them to an **editor** |

## The Agent Client Protocol (`src/ui/acp.js`)

ACP is an open protocol for editors to host coding agents (Zed started it). The editor starts `noobly acp` and talks **JSON-RPC 2.0** over stdin/stdout, one JSON message per line, the same framing idea as MCP (Phase 14), with the roles reversed: here noobly is the server.

```
editor → noobly  {"id":1,"method":"initialize","params":{"protocolVersion":1}}
noobly → editor  {"id":1,"result":{"protocolVersion":1,"agentCapabilities":{…},"agentInfo":{"name":"noobly"}}}
editor → noobly  {"id":2,"method":"session/new","params":{"cwd":"/work/app"}}
noobly → editor  {"id":2,"result":{"sessionId":"sess-1"}}
editor → noobly  {"id":3,"method":"session/prompt","params":{"sessionId":"sess-1","prompt":[{"type":"text","text":"fix the test"}]}}
noobly → editor  {"method":"session/update","params":{"sessionId":"sess-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Let me"}}}}
noobly → editor  {"method":"session/update","params":{…"update":{"sessionUpdate":"tool_call","toolCallId":"toolu_1","title":"Bash(npm test)","kind":"execute","status":"in_progress"}}}
noobly → editor  {"id":"noobly-1","method":"session/request_permission","params":{…"options":[{"optionId":"allow_once"…}]}}
editor → noobly  {"id":"noobly-1","result":{"outcome":{"outcome":"selected","optionId":"allow_once"}}}
…
noobly → editor  {"id":3,"result":{"stopReason":"end_turn"}}
```

| Loop event | ACP update |
|---|---|
| `text_delta` / `thinking_delta` | `agent_message_chunk` / `agent_thought_chunk` |
| `tool_start` | `tool_call` with a **kind** (read, edit, execute, search, fetch, think) so the editor can pick an icon |
| `tool_end` | `tool_call_update` (completed / failed, with the result) |
| `tool_end` of TodoWrite | `plan` (the todo list, Phase 11) |
| `turn_end` | the prompt's result: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` or `cancelled` |

The **permission gate** (Phase 06) is unchanged: when it says "ask", the session's `requestPermission` (which the Ink UI replaces with a dialog) is replaced by a `session/request_permission` **request to the editor**. The loop now passes the tool call's id with it, so the editor can show the question next to that call. `session/cancel` aborts the running prompt the same way Esc does.

Two details:

- **stdout belongs to the protocol.** A single stray `console.log` would corrupt the stream, so warnings go to stderr.
- Messages are handled **concurrently**: while a prompt runs, the editor's permission answers and cancel notifications must still get through.

## Deviations from the plan

- **File edits don't go through the editor.** ACP lets an agent read/write files via the editor (`fs/read_text_file`, `fs/write_text_file`), which would include unsaved buffers. noobly still edits files on disk itself; the editor sees the changes when it reloads.
- **No plan approval dialog** in ACP yet (ExitPlanMode is answered "no user" as in print mode), no images in prompts, no `session/load`.
- **Not tried with a real editor.** It follows the published protocol and is tested with a scripted fake editor and a real `noobly acp` process, but no ACP-capable editor was available here. Try it in Zed: add noobly as a custom agent server with command `noobly` and args `["acp"]`.

## What we learned

- The payoff of an **event-stream core**: a whole new front-end in ~200 lines and no loop changes (one extra field in a permission request).
- The protocol is the contract: **framing, ids, and who asks whom**.
- Human-in-the-loop moves with the front-end: the gate decides, the front-end asks.
- How Claude Code does it: its own IDE extensions, plus the same idea through its SDK; other agents (Gemini CLI, Codex through adapters) speak ACP to Zed.
