# Extra: Anthropic, OpenAI or Grok

**Goal:** let noobly use whichever AI company you have an API key for, and let you pick the model.

This wasn't a numbered phase. It's part of Phase 18 (roadmap: *"a second provider proves the abstraction"*) pulled forward because you needed it. It turned out to be a great test of the design choices we made early on.

---

## 1. Quick start

```bash
unset ANTHROPIC_API_KEY
export XAI_API_KEY=xai-...        # GROK_API_KEY=... also works

noobly                            # → uses Grok, model grok-4.7
noobly --model grok-4.3           # a different Grok model
noobly -p "What is in package.json?"
```

Inside the chat:

| Command | Does |
|---|---|
| `/provider` | Lists providers and which keys are set (● = current) |
| `/provider openai` | Switches provider. **The conversation carries on** |
| `/model` | Shows the current provider/model, and the models we know prices for |
| `/model grok-4.3` | Switches model. A model from another provider switches provider too |
| `/models` | Asks the provider's API which models your key can use |

## 2. How noobly picks a provider

| Key | Provider id | Default model |
|---|---|---|
| `ANTHROPIC_API_KEY` | `anthropic` | `claude-opus-5-5` |
| `OPENAI_API_KEY` | `openai` | `gpt-6-astra` |
| `XAI_API_KEY` or `GROK_API_KEY` | `grok` | `grok-4.7` |
| (none needed) | `echo` | `echo` (offline, free) |

Order of decisions (`chooseProvider()` in `src/providers/index.js`):

1. `--provider <id>` flag, or `--echo`
2. `NOOBLY_PROVIDER` environment variable
3. The provider a `--model` / `NOOBLY_MODEL` name belongs to (`grok-…` → grok)
4. Otherwise the **first key found**: Anthropic, then OpenAI, then Grok

The model: `--model` flag → `NOOBLY_MODEL` → the provider's default.

**To make a choice stick**, put it in your shell profile (`~/.bashrc`):

```bash
export XAI_API_KEY=xai-...
export NOOBLY_MODEL=grok-4.7
```

(Proper settings files come in Phase 10.)

## 3. The big idea: one internal format, translate at the edge

Back in Phase 01 we decided that **inside noobly, everything uses the Anthropic message format**: history, tool calls, tool results. The Session, the agent loop, the tools and the UI only know that one shape.

OpenAI and xAI speak a different dialect, **Chat Completions**. So we added a translator, `src/providers/openai-compatible.js`:

```
                 ┌───────────────────────── noobly core ─────────────────────────┐
 you ─► UI ─►    │ Session ─► agent loop ─► history (Anthropic format) ─► tools   │
                 └────────────────────────────────┬──────────────────────────────┘
                                                  │ provider.stream(request)
                  ┌───────────────────────────────┼─────────────────────────────┐
                  ▼                               ▼                             ▼
          anthropic.js                 openai-compatible.js               echo.js
      (no translation needed)     translates both ways ─► OpenAI / xAI    (fake)
```

Adding two whole providers **changed zero lines** in the agent loop, the tools or the Session's logic. That's what a good abstraction buys you.

### What gets translated

| Anthropic (ours) | OpenAI Chat Completions |
|---|---|
| `system: "…"`, a separate field | first message `{ role: "system", content: "…" }` |
| tool: `{ name, description, input_schema }` | `{ type: "function", function: { name, description, parameters } }` |
| assistant block `{ type: "tool_use", id, name, input: {…} }` | `tool_calls: [{ id, type: "function", function: { name, arguments: "<JSON as a string>" } }]` |
| one user message with several `tool_result` blocks | one `{ role: "tool", tool_call_id, content }` message **per result** |
| `is_error: true` on a result | no such flag, so we prefix the content with `Error: ` |
| `thinking` blocks | not understood, so dropped |
| `stop_reason`: `end_turn` / `tool_use` / `max_tokens` / `refusal` | `finish_reason`: `stop` / `tool_calls` / `length` / `content_filter` |
| `usage.input_tokens` / `output_tokens` | `usage.prompt_tokens` / `completion_tokens` (prompt includes cached tokens, so we subtract them) |
| streamed `content_block_delta` events | streamed `choices[0].delta` chunks, ending with `data: [DONE]` |

Look at `test/openai-compatible.test.js`: the first test shows a whole conversation before and after translation.

### Streaming is similar, but not the same

Both use SSE (Phase 03), so `sse.js` is shared. Differences:

- OpenAI-style streams end with `data: [DONE]`, which isn't JSON. `parseEvent()` now recognises it.
- Tool call arguments arrive as JSON text in pieces, like Anthropic's `input_json_delta`, but keyed by an `index`.
- Token usage arrives in one last chunk, only if you ask with `stream_options: { include_usage: true }`.

### "Compatible" isn't identical

The same bad API key gives two different error shapes:

```jsonc
// OpenAI
{ "error": { "message": "Incorrect API key provided…", "type": "invalid_request_error" } }
// xAI
{ "code": "invalid-argument", "error": "Incorrect API key provided…" }
```

We first saw xAI's as just `Error: Bad Request` and had to look at the raw response to fix it. `describeError()` handles both. Expect small differences like this whenever an API calls itself "compatible".

## 4. Switching mid-conversation

`/provider openai` or `/model grok-4.3` swaps `session.provider` and `session.model`. The history stays. Because it's stored in our one format, the next request is simply translated for the new provider.

One thing is lost: Claude's `thinking` blocks can't be sent to OpenAI/xAI, so they're dropped *in the translation* (still kept in our history).

## 5. Prices

`src/config/defaults.js` has prices for known models (September 2026):

| Model | Input $/M | Output $/M |
|---|---|---|
| `claude-opus-5-5` | 4 | 20 |
| `gpt-6-astra` | 10 | 50 |
| `gpt-6-sol` | 2 | 10 |
| `gpt-5.6-luna` | 0.20 | 1.20 |
| `grok-4.7` | 2 | 6 |
| `grok-4.3` | 1.25 | 2.50 |
| `grok-build-0.1` | 1 | 2 |

If you use a model that isn't in the table, noobly shows **"price unknown"** instead of a misleading `$0.00`. Add it to `PRICES` to fix that. Prices change, so check the provider's page now and then.

## 6. Safety

`Bash` now hides **all** provider keys from commands (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GROK_API_KEY`). The list comes from the provider table, so a future provider is covered automatically.

## 7. Files

| File | What |
|---|---|
| `src/providers/index.js` | **New.** The provider table, `chooseProvider()`, `switchProvider()`, `providerForModel()` |
| `src/providers/openai-compatible.js` | **New.** The translator for OpenAI and xAI |
| `src/providers/errors.js` | **New.** `ApiError`, shared by every provider |
| `src/providers/sse.js` | Understands `data: [DONE]` |
| `src/providers/anthropic.js` | `listModels()` for `/models`; uses the shared `ApiError` |
| `src/core/commands.js` | `/model` (switches provider when needed), `/models`, `/provider`. Commands are now `async` |
| `src/cli.js` | `--provider`, `NOOBLY_PROVIDER`, `NOOBLY_MODEL` |
| `src/config/defaults.js`, `src/core/cost.js` | Prices for all providers; `hasPrice()` → "price unknown" |
| `test/openai-compatible.test.js`, `test/providers.test.js` | 16 new tests, including the full agent loop running through the translator |

```bash
git diff phase-05 -- src/
```

## What we learned

- **One internal format + adapters at the edge** makes new providers cheap. The core didn't change.
- "OpenAI-compatible" is a **dialect**: same idea, different details (errors, `[DONE]`, usage reporting).
- Always look at the **raw response** when an error is unhelpful.
- Be honest about unknowns: **"price unknown"** beats a wrong `$0.00`.
- Secrets policies should come from **one list**, so new keys can't be forgotten.

## Update: OpenAI now uses the Responses API

Using `gpt-6-astra` failed on every message with:

```
✗ Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions.
  To use function tools, use /v1/responses or set reasoning_effort to 'none'.
```

Newer OpenAI models **reason** before answering, and OpenAI only allows reasoning *together with tools* on its newer **Responses API** (`POST /v1/responses`). noobly sends its tools with every request, so Chat Completions was a dead end for those models. (Setting `reasoning_effort: "none"` would also have worked, but it switches off the reasoning that makes these models good at coding.)

So `openai` now has its own adapter, `src/providers/openai-responses.js`. The translation is a little different:

| Ours (Anthropic shape) | Chat Completions | Responses API |
|---|---|---|
| `system` | first message, role `system` | `instructions` |
| `tool_use` block | `tool_calls` on the assistant message | its own input item: `{ type: "function_call", call_id, name, arguments }` |
| `tool_result` block | message with role `tool` | `{ type: "function_call_output", call_id, output }` |
| tool definition | `{ type: "function", function: { name, … } }` | `{ type: "function", name, … }` (flatter) |
| streamed text | `choices[0].delta.content` | `response.output_text.delta` events |
| tool call arguments | `delta.tool_calls[i].function.arguments` pieces | `response.function_call_arguments.delta` events |
| end + usage | `finish_reason` + a final usage chunk | `response.completed` / `response.incomplete` with `usage` |

Also:
- `store: false`: OpenAI keeps nothing between requests. noobly sends the whole conversation every time anyway (Phase 02).
- The model's own reasoning items aren't sent back, so each request reasons afresh from the visible conversation.
- The `effort` setting maps to `reasoning.effort` (`minimal`, `low`, `medium`, `high`; Anthropic's `xhigh`/`max` aren't sent).
- **Grok, Ollama, and `openai` with a `baseUrl`** still use Chat Completions (`openai-compatible.js`): most "OpenAI-compatible" servers don't have `/responses`.

The lesson: "OpenAI-compatible" is a moving target. The provider abstraction held up: one new file, one line in the provider table, and nothing else in noobly changed.
