# Implementation Tasks — LLM Project Desktop

**Companion to:** [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)
**Last updated:** 2026-09-11

Phases are ordered so that each one ends at a runnable, demonstrable state. Every task
carries an ID for reference in commits and PRs.

---

## Phase 0 — Foundation

*Exit criteria: `npm start` serves a page on localhost; `npm test` runs and passes.*

- [ ] **T0.1** Install dependencies: `express`, `ejs`, `dotenv`, `marked`, `dompurify`,
      `@anthropic-ai/sdk`, `openai`, `@google/genai`. Dev: `supertest`.
- [ ] **T0.2** Add `scripts`: `start` (`node server.js`), `dev` (`node --watch server.js`),
      `test` (`node --test test/`).
- [ ] **T0.3** `src/config/index.js` — load `.env`, parse `PORT`/`HOST`/`DATA_DIR`/`LOG_LEVEL`,
      resolve `DATA_DIR` to an absolute path, apply defaults.
- [ ] **T0.4** `src/lib/logger.js` — levelled structured logger writing JSON lines to stdout.
      Redaction helper for anything key-shaped.
- [ ] **T0.5** `src/lib/errors.js` — `AppError` base plus `ValidationError`, `NotFoundError`,
      `ProviderUnavailableError`, `ProviderError`, `StorageError` with statuses and codes
      per ARCHITECTURE §11.
- [ ] **T0.6** `src/app.js` — Express assembly: JSON body parser (1 MB cap), static `public/`,
      EJS view engine, request logging, route mounting, error handler last. Export the app.
- [ ] **T0.7** `server.js` — import app, listen on `HOST:PORT`, warn loudly if `HOST` is not
      loopback, handle `SIGINT`/`SIGTERM` cleanly.
- [ ] **T0.8** `src/middleware/errorHandler.js` — map `AppError` to its status and envelope;
      map anything else to 500 with the stack logged but not returned.
- [ ] **T0.9** `.env.example` with every variable and a comment each. Confirm `.gitignore`
      covers `.env` and `data/`.
- [ ] **T0.10** Smoke test: app boots, `GET /healthz` returns 200.

## Phase 1 — Storage layer

*Exit criteria: projects and chats can be created, read, listed and deleted from a Node REPL;
storage tests pass.*

- [ ] **T1.1** `src/lib/ids.js` — `slugify(name)` and `makeId(name)` producing
      `<slug>-<4 char base36 suffix>`; enforce the `^[a-z0-9]+(?:-[a-z0-9]+)*$` shape and a
      64-char cap. Handle names that slugify to empty (fall back to `project`/`chat`).
- [ ] **T1.2** `src/storage/paths.js` — `projectDir`, `projectFile`, `chatsDir`, `chatFile`.
      Validate every ID against the regex, `path.resolve`, and assert containment within
      `DATA_DIR`. Throw `ValidationError` otherwise. **This is the only module that
      constructs paths.**
- [ ] **T1.3** Test `paths.js` against traversal attempts: `..`, `../..`, absolute paths,
      URL-encoded dots, null bytes, symlink escape.
- [ ] **T1.4** `src/storage/writeQueue.js` — per-absolute-path promise chain so writes to one
      file serialise while distinct files run in parallel. Clean up empty chains.
- [ ] **T1.5** `src/storage/fsRepository.js` — `readJson`, `writeJsonAtomic`
      (tmp → fsync → rename, via the queue), `listDirs`, `listFiles`, `remove`, `ensureDir`.
      Map `ENOENT` to `NotFoundError`, other `fs` errors to `StorageError`.
- [ ] **T1.6** Test atomic write: interrupt between write and rename, assert the original
      file is intact; assert no `.tmp-*` files survive a successful write.
- [ ] **T1.7** Test the write queue: 50 concurrent writes to one path produce a valid final
      file, no interleaving.
- [ ] **T1.8** `src/storage/index.js` — in-memory project index (id, name, description
      excerpt, chatCount, updatedAt). Build on first use, invalidate on repository writes,
      watch `data/projects` with `fs.watch`, fall back to a 5 s TTL if watching fails.
- [ ] **T1.9** Bootstrap `data/` and `data/settings.json` with defaults on first run if absent.

## Phase 2 — Project domain

*Exit criteria: the full project CRUD API works end to end via curl.*

- [ ] **T2.1** `src/services/projectService.js` — `create`, `get`, `list`, `update`, `remove`.
      Validation: name 1–100 chars required, description ≤ 20,000 chars. Stamp `createdAt`/
      `updatedAt`/`schemaVersion`. `create` also makes `chats/` and `files/`.
- [ ] **T2.2** `remove` deletes the directory recursively; guard that the resolved path sits
      under `DATA_DIR/projects` before any recursive delete.
- [ ] **T2.3** Tolerant loading: a `project.json` missing optional fields loads with defaults;
      a malformed one is skipped from listings with a warning rather than crashing the list.
- [ ] **T2.4** `src/middleware/validate.js` — small schema-check helper producing
      `ValidationError` with a field-level `details` object.
- [ ] **T2.5** `src/routes/projects.api.js` — the five endpoints from ARCHITECTURE §10.
- [ ] **T2.6** `supertest` suite for project CRUD against a temp `DATA_DIR`, covering the
      404, validation-failure and duplicate-name cases.

## Phase 3 — Provider layer

*Exit criteria: `GET /api/providers` reports accurate status, and a scripted call streams
real tokens from every configured provider.*

- [ ] **T3.1** `src/providers/types.js` — JSDoc typedefs for `ProviderAdapter`,
      `CompletionRequest`, `ModelInfo`, `StreamEvent`.
- [ ] **T3.2** `src/config/models.js` — curated model catalogue per provider with `id`,
      `label`, `contextWindow`. Include Claude Opus 5 / Sonnet 5 / Haiku 4.5 for Anthropic.
- [ ] **T3.3** `src/providers/anthropic.js` — `messages.stream()`; top-level `system`; map
      `content_block_delta` → `delta`, `message_delta` usage → `done`.
- [ ] **T3.4** `src/providers/openai.js` — export a **factory** taking
      `{id, label, envVar, baseURL, models}` so it can back both OpenAI and DeepSeek.
      `stream: true` with `stream_options: {include_usage: true}`; system as a prepended
      `system` role message.
- [ ] **T3.5** `src/providers/deepseek.js` — call the factory with
      `baseURL: 'https://api.deepseek.com'` and the DeepSeek env var and models.
- [ ] **T3.6** `src/providers/gemini.js` — `@google/genai` streaming; `systemInstruction`;
      map `assistant` → `model` roles; extract `usageMetadata` for the `done` event.
- [ ] **T3.7** Error normalisation in every adapter: 401 → "key invalid", 429 → retryable
      rate limit, 5xx → retryable upstream, network timeout → retryable. All as
      `ProviderError`, never a raw SDK exception escaping the adapter.
- [ ] **T3.8** Abort support: every adapter threads `signal` into its SDK call and ends the
      iterator cleanly on abort rather than throwing.
- [ ] **T3.9** `src/providers/registry.js` — adapter list, `listAll()` with configured status,
      `resolve({requested, projectDefaults, globalSettings})` implementing the precedence
      chain, throwing `ProviderUnavailableError` naming the missing env var.
- [ ] **T3.10** Shared contract test suite parameterised over all four adapters, driven by a
      local mock HTTP server: asserts event shape and order, usage reporting, each error
      mapping, and abort behaviour. No network in CI.
- [ ] **T3.11** `src/routes/settings.api.js` — `GET /api/providers`, `GET`/`PATCH /api/settings`.
      Assert by test that no response body ever contains a key value.
- [ ] **T3.12** `scripts/smoke-provider.js` — CLI that sends one prompt to a named provider and
      prints the stream. Manual verification only.

## Phase 4 — Chat domain and streaming

*Exit criteria: a chat can be created and messaged via curl, tokens stream back, and the
transcript persists across a restart.*

- [ ] **T4.1** `src/lib/tokens.js` — `estimate(text)` as `ceil(chars / 3.6)`, plus
      `estimateMessages(messages)` including a small per-message overhead.
- [ ] **T4.2** `src/services/contextBuilder.js` — pure function building `{system, messages,
      truncatedHistory}` per ARCHITECTURE §8. Never trim the system block; drop oldest first;
      never start the window on an assistant turn.
- [ ] **T4.3** Unit-test the builder: empty description; description-only; history well under
      budget; history far over budget; a single message larger than the whole budget
      (must fail loudly, not silently send nothing).
- [ ] **T4.4** `src/services/titleService.js` — derive a title from the first user message:
      first ~60 chars, cut at a word boundary, ellipsis if truncated, collapse whitespace,
      fall back to "New chat".
- [ ] **T4.5** `src/services/chatService.js` — `create`, `get`, `listSummaries` (metadata only,
      no message bodies), `rename`, `setModel`, `remove`, `appendUserMessage`,
      `appendAssistantMessage`.
- [ ] **T4.6** Chat filename generation `<UTC>-<slug>-<suffix>.json`; loader resolves by the
      `id` field so a hand-renamed file still works.
- [ ] **T4.7** `src/routes/chats.api.js` — chat CRUD endpoints.
- [ ] **T4.8** `src/routes/messages.api.js` — the SSE endpoint. Order matters:
      persist the user message → send SSE headers and flush → emit `meta` → resolve provider
      → stream `delta` events → persist the assistant message → emit `done`.
- [ ] **T4.9** 15 s `: ping` heartbeat; set `Cache-Control: no-cache`, `Connection: keep-alive`,
      `X-Accel-Buffering: no`; disable Nagle with `res.socket.setNoDelay(true)`.
- [ ] **T4.10** Abort handling: `req.on('close')` fires the `AbortController`; persist the
      partial assistant text with `finishReason: 'aborted'`.
- [ ] **T4.11** Error handling mid-stream: emit an SSE `error` event, and persist an assistant
      message carrying `meta.error` so the transcript matches what the user saw.
- [ ] **T4.12** Auto-title on the first turn: set the title from the first user message when
      `titleGenerated` is still true.
- [ ] **T4.13** Test with a stub provider: event ordering, persistence on success, on abort,
      and on provider error; user message survives a provider failure.

## Phase 5 — Server-rendered UI

*Exit criteria: the whole product is usable in a browser with JS disabled for navigation and
reading; JS adds streaming and inline editing.*

- [ ] **T5.1** `views/layout.ejs` — document shell, CSP meta, theme tokens, skip link.
- [ ] **T5.2** `public/css/app.css` — custom-property palette defined on bare `:root`,
      overridden under `@media (prefers-color-scheme: dark)`. Layout, cards, transcript
      bubbles, composer, buttons, modal. Responsive to 400 px.
- [ ] **T5.3** `views/projects.ejs` — project grid, empty state, "New project" modal
      (a real `<form>` POST so it works without JS).
- [ ] **T5.4** `views/project.ejs` — description panel with inline edit, default
      provider/model selector, chat list by recency, new-chat composer.
- [ ] **T5.5** `views/chat.ejs` — header with project name / chat title / provider-model
      picker, transcript, composer, truncation banner slot.
- [ ] **T5.6** `views/partials/` — `projectCard`, `chatListItem`, `message`, `modelPicker`,
      `errorBanner`.
- [ ] **T5.7** `src/routes/pages.js` — the four GET page routes, each handling not-found by
      rendering a 404 page rather than throwing.
- [ ] **T5.8** `public/js/lib/markdown.js` — `marked` + `DOMPurify`, with fenced code blocks
      kept as plain `<pre><code>` (no highlighter dependency in v1).
- [ ] **T5.9** `public/js/chat.js` — `fetch` POST, read `response.body` through
      `TextDecoderStream`, parse SSE frames, append deltas to a live bubble, render Markdown
      on `done`, handle `error` and `meta` events, auto-scroll only when already at the
      bottom, Enter to send / Shift+Enter for newline, disable the composer while streaming,
      offer a Stop button that aborts the fetch.
- [ ] **T5.10** `public/js/projects.js` — create/edit/delete without a full reload, with a
      confirmation step on delete.
- [ ] **T5.11** Escape every interpolation with `<%= %>`; the only `<%- %>` is
      client-sanitised Markdown. Add a test asserting a project named
      `<img src=x onerror=alert(1)>` renders inert.
- [ ] **T5.12** Accessibility pass: labels on all controls, visible focus rings,
      `aria-live="polite"` on the streaming region, keyboard-reachable modals with focus trap
      and Escape to close.
- [ ] **T5.13** Verify in a real browser at 400 px, 800 px and 1400 px, in both colour schemes.

## Phase 6 — Hardening and polish

*Exit criteria: ready for daily use.*

- [ ] **T6.1** Strict CSP header with no `unsafe-inline`; move any remaining inline handlers
      into the external JS files.
- [ ] **T6.2** Rate-limit the message endpoint (simple in-process token bucket) to guard
      against a runaway client loop burning credits.
- [ ] **T6.3** Truncation banner wired to `meta.truncatedHistory`, explaining which turns
      were dropped and why.
- [ ] **T6.4** Per-message footer showing provider, model and token counts; make it toggleable.
- [ ] **T6.5** Friendly first-run experience: when no provider key is configured, the home
      page links to settings and names the variables to set instead of failing on send.
- [ ] **T6.6** Graceful handling of a provider or model that has disappeared from the
      catalogue since a chat was created — fall back with a visible notice, do not 500.
- [ ] **T6.7** Performance check with 100 projects × 100 chats generated by a seed script;
      confirm the < 200 ms render target from PRD §8.
- [ ] **T6.8** `README.md`: what it is, install, `.env` setup, run, data layout, how to add a
      provider.
- [ ] **T6.9** Final security review: traversal, XSS, key leakage into logs or responses,
      the loopback bind default.
- [ ] **T6.10** Full manual pass over every user story in PRD §6.

## Phase 7 — Documents and retrieval

*Exit criteria: markdown documents can be organised in folders by drag-and-drop, and chats
answer from them both by explicit reference and by automatic retrieval.*

- [x] **T7.1** `paths.js` — `documentsDir`, `documentPath`, `splitRelPath`, plus
      `assertSegment` (safety, applies to every operation) and `assertCreatableSegment`
      (portability, applies only to create/rename).
- [x] **T7.2** Test traversal, absolute paths, leading dots, control characters, depth
      limits, and reserved names; assert an existing awkward filename stays deletable.
- [x] **T7.3** `documentService.js` — `tree`, `listDocuments`, `readDocument`,
      `writeDocument`, `createDocument`, `createFolder`, `remove`, `move`.
- [x] **T7.4** Atomic document writes (tmp → fsync → rename) through the same write queue
      as the JSON store.
- [x] **T7.5** `assertRealPathContained` — `fs.realpath` guard so a symlink inside the tree
      cannot read outside it; omit symlinks from listings.
- [x] **T7.6** Move semantics: reject moving a folder into its own descendant, reject
      overwriting an existing entry, require documents to keep `.md`.
- [x] **T7.7** `documents.api.js` — tree, list, read, write, create, move, delete.
- [x] **T7.8** `lib/textIndex.js` — `tokenize`, `chunkMarkdown` (split on headings, pack
      oversized sections), `buildIndex`, `search` (BM25).
- [x] **T7.9** `retrievalService.js` — per-project index keyed by a filesystem fingerprint
      so external edits are picked up; `parseMentions`; `buildDocumentContext`.
- [x] **T7.10** `contextBuilder` — accept a documents block and expose `documentBudget`
      (40% share); the project description is never displaced.
- [x] **T7.11** `messages.api.js` — parse mentions, retrieve, pass the block through, emit
      `sources` on the `meta` event, and persist them on the assistant message.
- [x] **T7.12** Retrieval failures are logged and non-fatal.
- [x] **T7.13** `views/documents.ejs` + page route — tree, editor, preview toggle.
- [x] **T7.14** `public/js/lib/docTree.js` — tree rendering, collapse state in
      `localStorage`, HTML5 drag-and-drop with illegal-drop rejection and a root drop zone.
- [x] **T7.15** `public/js/documents.js` — open, autosave, Ctrl/Cmd+S, create, rename,
      delete, move, unsaved-changes guard.
- [x] **T7.16** `public/js/lib/mentions.js` — `@` autocomplete over the project's documents,
      keyboard navigation, quoting for paths with spaces.
- [x] **T7.17** Source chips on assistant messages, both live and server-rendered on reload.
- [x] **T7.18** Tests: documents CRUD/move/traversal/symlink; chunking, BM25 ranking,
      mention parsing, budget adherence, and index refresh after an edit.
- [ ] **T7.19** Browser verification of drag-and-drop, the editor, and the `@` menu.

---

## Dependency graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──┐
                │                 ├──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6
                └──▶ Phase 3 ─────┘
```

Phases 2 and 3 are independent once storage exists and can be built in either order.

## Milestones

| Milestone | Phases | Demonstrates |
|-----------|--------|--------------|
| **M1 — Data works** | 0–2 | Projects persist as folders; CRUD via curl |
| **M2 — Models answer** | 3 | All four providers stream through one interface |
| **M3 — End to end** | 4 | A full chat turn with project context, persisted |
| **M4 — Usable product** | 5 | The browser UI does everything in PRD §6 |
| **M5 — Daily driver** | 6 | Hardened, documented, performance-checked |

## Definition of done (per task)

1. Code follows the layering in ARCHITECTURE §3 — routes do no I/O, services speak no HTTP,
   adapters touch no disk.
2. Tests exist at the level named in ARCHITECTURE §13 and pass.
3. No new dependency beyond those listed in ARCHITECTURE §2 without a note explaining why.
4. Errors go through the `AppError` taxonomy, never a bare `throw new Error`.
5. Manually exercised in a browser where the task touches the UI.

## Deferred to v2

Attached project files as context · regenerate a turn with a different model ·
cross-chat search · Markdown export · cost tracking · Ollama adapter ·
per-chat system-prompt overrides.
