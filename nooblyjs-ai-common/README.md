# nooblyjs-ai-common

The AI building blocks shared by the nooblyjs AI projects, so each one stops carrying its own copy:

| Project | What it is |
|---|---|
| [nooblyjs-ai-harness](https://github.com/nooblyjs/nooblyjs-ai-harness) | `noobly`, an AI coding CLI harness |
| [nooblyjs-ai-factory](https://github.com/nooblyjs/nooblyjs-ai-factory) | an agentic software factory built on the harness |
| [nooblyjs-ai-teammate](https://github.com/nooblyjs/nooblyjs-ai-teammate) | hire, configure and pay for AI digital teammates |
| [nooblyjs-ai-desktop](https://github.com/nooblyjs/nooblyjs-ai-desktop) | projects, documents and chat for any LLM |

Like the harness, it's written to be read: plain JavaScript, no build step, no dependencies, and comments that explain the *why*.

## Use it

Check it out next to the project that uses it and link it as a `file:` dependency:

```bash
git clone https://github.com/nooblyjs/nooblyjs-ai-common.git
```

```json
"dependencies": { "nooblyjs-ai-common": "file:../nooblyjs-ai-common" }
```

Import everything from the package, or one area at a time:

```js
import { costOf, formatCost } from 'nooblyjs-ai-common/cost';
import { openSSE } from 'nooblyjs-ai-common/sse';
```

It's ESM. CommonJS projects can `require()` it on Node 22.12 or later.

## What's in it

| Import | What it does | Came from |
|---|---|---|
| `nooblyjs-ai-common/providers` | One way to call every model: `createProvider(id)` builds an adapter for any catalogue provider (Anthropic Messages, OpenAI Responses, or Chat Completions for Grok, Gemini, DeepSeek, Ollama and compatible servers); `complete()` waits for the whole reply, with retries; Anthropic also signs in with a bearer token (`ANTHROPIC_AUTH_TOKEN`) and can cache only the system prompt (`caching: 'system'`); `createMockProvider` for tests and offline use; `findApiKey`, `addCacheBreakpoints`, `EVENT` | harness `providers/` and `context/cache.js` |
| `nooblyjs-ai-common/models` | The model catalogue: `MODELS` (label, context window, price, aliases, request quirks), `PROVIDERS` (key variables, default and small model, name prefixes, API style and address), `getModel`, `modelsFor`, `providerForModel`, and the derived `PRICES` and `CONTEXT_WINDOWS` | harness `config/defaults.js` and `providers/index.js`, desktop `config/models.js`, teammate seed prices |
| `nooblyjs-ai-common/tokens` | `estimateTokens` (images count as a flat 1,600), `contextWindowFor` | harness `context/tokens.js` |
| `nooblyjs-ai-common/cost` | `costOf`, `hasPrice` (with an optional custom price table), `priceUsage` (price usage at a given pricing), `normalizeUsage` (accepts `input_tokens` or `inputTokens`), `addUsage`, `emptyUsage`, `formatCost` | harness `core/cost.js`, teammate `apiCost` |
| `nooblyjs-ai-common/errors` | `ApiError`, `retryAfterMs`, `explainError` (any provider failure as a readable message, an HTTP status and whether to retry; null for a cancelled request) | harness `providers/errors.js`, desktop `providers/errorMapping.js` |
| `nooblyjs-ai-common/retry` | `withRetry`, `isRetryable`, `backoffDelay`, `sleep` (exponential backoff with jitter, abortable) | harness `providers/retry.js` |
| `nooblyjs-ai-common/sse` | reading: `parseSSE`, `parseEvent`; writing: `openSSE`, `formatSSE`, `SSE_HEADERS` | harness `providers/sse.js`; the writer replaces the factory's hand-written one (teammate and desktop still write their own) |
| `nooblyjs-ai-common/frontmatter` | `parseFrontmatter`, `formatFrontmatter` (the tiny `key: value` / `[a, b]` format) | harness and factory `util/frontmatter.js` |

## Roadmap

| Phase | What moves here | Status |
|---|---|---|
| 0 | Package scaffold: ESM, subpath exports, `node:test`, `// @ts-check` | done |
| 1 | Leaf utilities: frontmatter, tokens, cost, retry, errors, SSE. Harness and factory use them | done |
| 2 | One model catalogue: labels, context windows, prices, aliases, request quirks, provider facts. Harness, desktop and teammate use it (thinking style moves in Phase 3, with the request code) | done |
| 3a | One provider layer in common: `stream()` and `complete()`, adapters for every catalogue provider (Gemini through its OpenAI-compatible endpoint), the mock, and a contract test suite every provider passes | done |
| 3b | Desktop calls models through common (text streaming) and drops its three SDKs | done |
| 3c | Teammate calls models through common (tools, caching, fallbacks, effort) and drops the Anthropic SDK | done |
| 3d | The harness calls models through common: its adapters become re-exports | done |
| 4 | MCP: a JSON-RPC core with stdio client (harness), Streamable HTTP client (teammate) and stdio server (factory) | next |
| 5 | BM25 retrieval and markdown chunking (teammate, desktop), a safe web fetch with a private-address guard (teammate, harness), tool definitions with an input-schema check | |
| 6 | Optional: a minimal tool-use loop and markdown loaders for skills, memory and roles | |

Not planned here: agent-CLI parts (harness UI, permissions, sandbox, checkpoints, hooks), each app's own domain code, and generic web utilities (errors, ids, logging, rate limits), which belong in `nooblyjs-core`.

## Develop

```bash
npm test        # node --test, offline, no dependencies
npm run check   # type-check the // @ts-check files
```

`test/providers.contract.test.js` points every provider at one local fake server that speaks all three API styles. A new provider or adapter has to pass it too.
