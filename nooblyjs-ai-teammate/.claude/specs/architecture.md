# Architecture — NooblyJS Digital Teammate

| Field   | Value                                   |
|---------|-----------------------------------------|
| Status  | Draft v0.1                              |
| Date    | 2026-10-01                              |
| Related | [prd.md](prd.md), [roadmap.md](roadmap.md) |

---

## 1. Architectural principles

1. **Files are the database.** Every entity is a folder or a Markdown file with YAML front matter. A human can read, diff, grep and `git commit` the whole system state.
2. **Front matter holds structured data; the body holds prose.** Configuration such as the model, budget and status goes in front matter. Persona, skill instructions, knowledge and memory go in the Markdown body.
3. **Append-only for facts, overwrite for configuration.** Work items and cost entries are never rewritten. Configuration files are rewritten atomically, and each change is logged.
4. **Model choice is configuration.** Code depends on a `Provider` interface and never names a specific model.
5. **No build step.** The server is CommonJS or ESM Node. The browser loads native ES modules and plain CSS.
6. **Layered and swappable.** Routes call services, services call stores and providers. The file store sits behind an interface, so a database adapter can be added later without touching services.

## 2. System context

```
 ┌──────────────┐     HTTPS (UI, session)      ┌───────────────────────────────────────┐
 │  Browser UI  │ ───────────────────────────▶ │                                       │
 └──────────────┘                              │      Digital Teammate Server          │      ┌──────────────────┐
 ┌──────────────┐  REST + SSE (API key)        │      (Node.js / Express)              │ ───▶ │ Anthropic API    │
 │ CI / bots /  │ ───────────────────────────▶ │                                       │ ───▶ │ OpenAI / Azure   │
 │ scripts      │                              │                                       │ ───▶ │ Ollama / vLLM    │
 └──────────────┘                              └───────────────┬───────────────────────┘      └──────────────────┘
                                                               │ fs (atomic writes)
                                                               ▼
                                                   ┌────────────────────────┐
                                                   │  data/  (Markdown +    │
                                                   │  folders, git-able)    │
                                                   └────────────────────────┘
```

## 3. Tech stack

| Concern | Choice | Reason |
|---------|--------|--------|
| Runtime | Node.js 20 LTS or later | Native `fetch`, `fs/promises`, `crypto`, test runner. |
| HTTP | Express 5 | Async error handling, familiar to the team. |
| Front matter | `gray-matter` (uses `js-yaml`) | The de facto standard for Markdown with front matter. |
| Markdown to HTML | `marked` with `DOMPurify` on the client (or `sanitize-html` on the server) | Safe preview of user-authored Markdown. |
| Validation | `zod` (or hand-written validators) | One schema per entity, shared by the API and the file loader. |
| Sessions | `express-session` with a file-backed store under `data/system/sessions` | No database. |
| Uploads | `multer` (memory storage, with size limits) | Knowledge uploads. |
| Provider SDKs | `@anthropic-ai/sdk`, `openai` | Official SDKs. An OpenAI-compatible base URL covers Azure, Ollama and vLLM. |
| Logging | nooblyjs-core `logging` (file provider) | Daily rotating files under `data/logs`, echoed to the console. See §17. |
| Caching, queueing, events, scheduling, metrics | nooblyjs-core | One service registry shared across the NooblyJS projects, with dashboards under `/services/`. See §17. |
| Tests | `node:test` and `supertest` | No extra test framework. |
| Config | `dotenv` | Secrets stay in the environment only. |

## 4. Repository layout

```
nooblyjs-digital-teammate/
├── package.json
├── .env.example                 # ANTHROPIC_API_KEY=, OPENAI_API_KEY=, SESSION_SECRET=, DATA_DIR=
├── server.js                    # bootstraps app, loads config, starts listener
├── src/
│   ├── app.js                   # express app factory (used by tests)
│   ├── config.js                # env + data/config/settings.md merge
│   ├── routes/
│   │   ├── api/
│   │   │   ├── teammates.routes.js
│   │   │   ├── tasks.routes.js       # invoke + work log
│   │   │   ├── skills.routes.js
│   │   │   ├── knowledge.routes.js
│   │   │   ├── memory.routes.js
│   │   │   ├── catalog.routes.js
│   │   │   ├── models.routes.js      # providers + model profiles + price list
│   │   │   ├── costs.routes.js
│   │   │   └── admin.routes.js       # api keys, settings
│   │   └── ui.routes.js              # serves views
│   ├── middleware/
│   │   ├── auth.js              # session (UI) + api-key (API)
│   │   ├── requestId.js
│   │   ├── validate.js
│   │   └── errors.js            # problem+json error mapper
│   ├── services/
│   │   ├── teammate.service.js  # hire / configure / pause / retire
│   │   ├── invocation.service.js# the task pipeline (see §7)
│   │   ├── prompt.builder.js    # persona + skills + knowledge + memory assembly
│   │   ├── skill.selector.js
│   │   ├── retrieval/
│   │   │   ├── bm25.js          # lexical index
│   │   │   └── index.manager.js # per-teammate index cache + invalidation
│   │   ├── memory.service.js    # retrieve, reflect, consolidate
│   │   ├── cost.service.js      # pricing, metering, ledgers, budgets
│   │   ├── catalog.service.js
│   │   └── audit.service.js
│   ├── providers/
│   │   ├── provider.interface.js
│   │   ├── anthropic.provider.js
│   │   ├── openai.provider.js   # also Azure / Ollama / vLLM via baseURL
│   │   ├── mock.provider.js
│   │   └── registry.js
│   ├── store/
│   │   ├── store.interface.js   # get/list/put/append/delete/watch
│   │   ├── fs.store.js          # markdown+frontmatter implementation
│   │   ├── atomic.js            # write tmp → fsync → rename
│   │   ├── locks.js             # per-path async mutex
│   │   ├── paths.js             # safe path resolution, slug validation
│   │   └── schemas/             # zod schemas per entity
│   └── util/
├── public/                      # static front end, no build
│   ├── index.html               # app shell
│   ├── css/
│   │   ├── tokens.css           # colors, spacing, light/dark
│   │   └── app.css
│   ├── js/
│   │   ├── app.js               # tiny hash router
│   │   ├── api.js               # fetch wrapper + SSE helper
│   │   ├── components/          # web components: <dt-card>, <dt-md-editor>, <dt-cost-chart>…
│   │   └── pages/               # dashboard.js, catalog.js, teammate.js, …
│   └── img/avatars/
├── seed/                        # default catalog, skills, price list copied to data/ on first run
├── data/                        # runtime state (gitignored by default, or its own repo)
└── test/
```

## 5. Data model on the file system

### 5.1 Directory layout

```
data/
├── config/
│   ├── settings.md                  # global settings: budgets, memory defaults, feature flags
│   └── providers.md                 # provider endpoints + model profiles + price list
├── catalog/                         # templates available to procure
│   ├── architect/
│   │   ├── TEMPLATE.md
│   │   └── knowledge/…              # starter knowledge copied on hire
│   └── documentor/TEMPLATE.md
├── skills/                          # shared skill library
│   ├── c4-modelling/SKILL.md
│   ├── adr-authoring/SKILL.md
│   └── plain-language-explainer/SKILL.md
├── teammates/
│   └── ada-architect/
│       ├── TEAMMATE.md              # profile + config (front matter) + persona (body)
│       ├── CHANGELOG.md             # config change history (append-only)
│       ├── skills/                  # private skills (same format as shared)
│       │   └── house-style/SKILL.md
│       ├── knowledge/
│       │   ├── _index.md            # optional curated listing
│       │   └── enterprise-standards.md
│       ├── memory/
│       │   ├── MEMORY.md            # index: one line per note
│       │   └── 2026-10-01-prefers-event-driven.md
│       ├── threads/
│       │   └── thr_01J….md          # multi-turn conversation transcripts
│       ├── work/
│       │   └── 2026/10/
│       │       └── 2026-10-01T12-30-05Z_wk_01J9….md
│       └── costs/
│           └── 2026-10.md           # monthly cost ledger (append-only table)
├── archive/
│   └── teammates/<slug>-<date>/     # retired teammates moved here
└── system/
    ├── api-keys.md                  # hashed keys + scopes
    ├── users.md                     # (if multi-user) hashed passwords + roles
    ├── audit/2026-10.md             # admin/config audit trail
    └── sessions/
```

Rules:

- **Slugs** match `^[a-z0-9][a-z0-9-]{1,62}$`. They are validated before any path is built, and `paths.js` checks that the resolved path stays inside `DATA_DIR`.
- **IDs** for work items, threads and API keys are ULIDs with prefixes (`wk_`, `thr_`, `key_`). ULIDs sort by time, which matches the file naming.
- **Timestamps** are ISO-8601 UTC. In file names, `:` is replaced with `-`.

### 5.2 Entity formats

#### `TEAMMATE.md`

```markdown
---
id: ada-architect
name: Ada
pronouns: she/her
role: Architect
template: architect@1.2.0
avatar: /img/avatars/ada.svg
status: active                 # active | paused | retired
created: 2026-10-01T09:00:00Z
updated: 2026-10-01T11:42:10Z
model:
  profile: anthropic/claude-opus-5-5   # key into providers.md
  temperature: 0.3
  maxOutputTokens: 8000
skills:
  shared: [c4-modelling, adr-authoring, tradeoff-analysis]
  private: [house-style]
  autoSelect: true             # pick relevant skills per task
  maxPerTask: 3
knowledge:
  retrieval: bm25
  topK: 6
  maxTokens: 6000
memory:
  enabled: true
  reflectWith: anthropic/claude-haiku-4-5   # cheaper model writes memory
  topK: 8
  maxNotes: 300
  scopeByProject: true
budget:
  monthlyUsd: 250
  warnAt: 0.8
  hardStop: true
---

# Persona

You are Ada, a principal software architect. You reason explicitly about trade-offs,
state assumptions, and always record decisions as ADRs. …
```

#### `SKILL.md` (shared or private)

```markdown
---
id: adr-authoring
title: Architecture Decision Record authoring
version: 1.0.0
tags: [architecture, documentation]
triggers: ["adr", "decision record", "why did we choose"]   # hints for auto-selection
inputs: [context, options considered]
outputSchema: markdown
---

## When to use
…
## Procedure
1. …
## Output template
…
```

#### `TEMPLATE.md` (catalog)

The front matter holds the template defaults: `role`, `version`, `description`, `recommendedModels` (`premium`, `standard` and `economy` tiers), `defaultSkills`, `typicalTask` (estimated input and output tokens, used for cost estimates) and `starterKnowledge`. The body holds the default persona.

#### `providers.md`

```markdown
---
currency: USD
providers:
  anthropic:
    type: anthropic
    apiKeyEnv: ANTHROPIC_API_KEY        # name of env var, never the key itself
  openai:
    type: openai
    apiKeyEnv: OPENAI_API_KEY
  local-ollama:
    type: openai
    baseUrl: http://localhost:11434/v1
  mock:
    type: mock
models:
  anthropic/claude-opus-5-5:
    provider: anthropic
    model: claude-opus-5-5
    tier: premium
    contextWindow: 200000
    pricing:                          # USD per 1M tokens — EXAMPLE VALUES, verify before use
      input: 0.00
      output: 0.00
      cacheRead: 0.00
      cacheWrite: 0.00
    effectiveFrom: 2026-10-01
  anthropic/claude-haiku-4-5:
    provider: anthropic
    model: claude-haiku-4-5-20251001
    tier: economy
    pricing: { input: 0.00, output: 0.00 }
---

Notes for administrators about price sources and review dates.
```

Price changes add a new entry with a later `effectiveFrom` date instead of overwriting the old one. Each cost entry also stores a copy of the prices it used, so historical ledgers never change.

#### Work item: `work/YYYY/MM/<ts>_<id>.md`

```markdown
---
id: wk_01J9Z…
teammate: ada-architect
thread: thr_01J9Y…
status: succeeded                # succeeded | failed | blocked
caller: key_01J8… (ci-pipeline)
requestId: req_…
skillsUsed: [adr-authoring]
knowledgeUsed: [enterprise-standards.md#messaging]
memoryUsed: [2026-10-01-prefers-event-driven]
model: anthropic/claude-opus-5-5
usage: { inputTokens: 12840, outputTokens: 2210, cacheReadTokens: 9000 }
costUsd: 0.0000
reflectionCostUsd: 0.0000
durationMs: 18342
started: 2026-10-01T12:30:05Z
rating: null
---

## Request
…

## Response
…
```

#### Cost ledger: `costs/YYYY-MM.md`

```markdown
---
teammate: ada-architect
month: 2026-10
currency: USD
---

| ts | workId | kind | model | in | out | cacheR | cacheW | unitIn | unitOut | costUsd | caller | skill |
|----|--------|------|-------|----|-----|--------|--------|--------|---------|---------|--------|-------|
| 2026-10-01T12:30:23Z | wk_01J9Z… | task | anthropic/claude-opus-5-5 | 12840 | 2210 | 9000 | 0 | … | … | … | ci-pipeline | adr-authoring |
| 2026-10-01T12:30:25Z | wk_01J9Z… | reflection | anthropic/claude-haiku-4-5 | 3100 | 240 | 0 | 0 | … | … | … | system | — |
```

New rows are appended with `fs.appendFile` while holding the per-file lock. The table is easy to read, renders in any Markdown viewer and is simple to parse (`|` is escaped in cell values).

#### Memory note and index

```markdown
---
id: 2026-10-01-prefers-event-driven
type: preference            # decision | preference | fact | follow-up | feedback
project: payments-platform  # optional scope
source: wk_01J9Z…
pinned: false
created: 2026-10-01T12:30:25Z
updated: 2026-10-01T12:30:25Z
---

The payments team prefers event-driven integration over synchronous REST for
cross-domain calls; cite ADR-014 when proposing alternatives.
```

`memory/MEMORY.md` holds one line per note (`- [title](file.md) — hook`). It is regenerated whenever notes change, and it is also what the UI shows as the overview.

### 5.3 Store layer

```js
// store.interface.js (conceptual)
get(path)              → { data, body, etag }
list(dir, { glob })    → [{ path, data }]            // front matter only, cached
put(path, data, body, { ifMatch })                   // atomic, optimistic concurrency
append(path, text)                                   // for ledgers/changelogs
move(from, to)                                       // archive
delete(path)
watch(dir, cb)                                       // fs.watch → cache invalidation
```

- **Atomic writes:** write to `file.tmp-<rand>`, call `fsync`, then `rename`. A crash can never leave a half-written file.
- **Concurrency:** an in-process async mutex is keyed by absolute path. Optimistic concurrency uses the `etag` (an mtime and size hash), and the UI sends `If-Match` so that two people editing at once get a `409` instead of silently losing changes.
- **Caching:** front matter for `list()` is cached in memory and invalidated by `fs.watch`, plus a periodic mtime sweep as a fallback, because `fs.watch` is unreliable on some network file systems.
- **Single writer:** v1 assumes one Node process. Running clustered needs a lock file or a move to a database adapter (see the roadmap).

## 6. Provider abstraction

```js
// provider.interface.js
class Provider {
  /** @returns {Promise<{ text, usage:{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}, stopReason, raw }>} */
  async complete({ model, system, messages, maxOutputTokens, temperature, signal }) {}
  /** async iterator of { type:'delta', text } | { type:'usage', usage } | { type:'done', stopReason } */
  async *stream(opts) {}
  async countTokens(opts) {}   // optional; used for pre-flight estimates
}
```

- The registry builds providers lazily from `providers.md` and reads secrets from `process.env[apiKeyEnv]`.
- The Anthropic provider sends the persona and skills as the `system` block and marks it for **prompt caching**, because the persona and skills are stable between calls. This makes repeat calls to the same teammate much cheaper, and cache-read tokens are metered separately.
- **Retries** use exponential backoff with jitter on 429 and 5xx responses, honor `retry-after`, and are capped at three attempts. Each attempt's usage is metered.
- The Mock provider returns deterministic text and synthetic usage, so the whole system can be tested offline and in CI.

## 7. Invocation pipeline

`POST /api/v1/teammates/:slug/tasks`

```
 request
   │
   ▼
 [1] auth            api key → scope includes :slug ? → caller identity
   │
 [2] load teammate   TEAMMATE.md (cached) → status must be active
   │
 [3] budget gate     month-to-date spend + pre-flight estimate vs budget
   │                 → 402 budget_exhausted | warn header X-Budget-Warning
   │
 [4] select skills   explicit `skill` param, else auto-select (trigger match + BM25 over skill text), cap maxPerTask
   │
 [5] retrieve        knowledge top-K (BM25, token-capped) + memory top-K (pinned first, project-filtered)
   │
 [6] build prompt    system = persona ⊕ skills ⊕ "Relevant memory" ⊕ "Reference knowledge"
   │                 messages = thread history (trimmed to context budget) ⊕ user task
   │
 [7] call provider   complete() or stream() → SSE to client
   │
 [8] meter           usage × pricing(effective at ts) → cost
   │
 [9] persist         work item .md  +  ledger row  +  thread transcript  (parallel, each atomic)
   │
[10] respond         { workId, output, usage, costUsd, budget:{ spentUsd, remainingUsd } }
   │
[11] reflect (async, after response)
                     cheap model reads request/response + current MEMORY.md
                     → JSON ops: create/update/delete notes → apply → ledger row (kind=reflection)
```

- Step 11 runs **after** the response is sent, on an in-process job queue with concurrency 1 per teammate, so memory writes never race. If reflection fails, the failure is logged and does not affect the request.
- **Consolidation:** when the number of notes exceeds `maxNotes`, a consolidation job merges related notes. Pinned notes are never removed.
- **Cancellation:** if the client disconnects mid-stream, an `AbortController` cancels the provider call. Any usage already reported is still metered.

## 8. Cost and budget service

- `estimate(teammate, inputText)` counts tokens for the input (with a provider tokenizer or a ~4 chars/token heuristic) and adds `typicalTask.outputTokens`, then multiplies by unit prices. The estimate is used for the budget pre-flight and for catalog comparisons.
- `record(entry)` appends a ledger row and updates the in-memory aggregates: per teammate per day, per month, per skill and per caller.
- On startup, the aggregates are rebuilt by parsing the current month's ledgers. Older months are parsed on demand and cached.
- The global budget in `settings.md` is checked as well as the per-teammate budget.
- `GET /api/v1/costs/export.csv?from&to&teammate` streams rows from the ledgers.

## 9. HTTP API (v1)

All JSON. Errors use `application/problem+json` (`type`, `title`, `status`, `detail`, `code`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/catalog` | List templates, with cost estimates per tier. |
| GET | `/api/v1/catalog/:template` | Template detail. |
| POST | `/api/v1/catalog` | Create a custom template, or save a teammate as a template. |
| GET | `/api/v1/teammates` | Roster, including status and month-to-date cost. |
| POST | `/api/v1/teammates` | **Hire** `{ template, name, slug?, modelProfile, budget }`. |
| GET / PATCH | `/api/v1/teammates/:slug` | Read or update the config. PATCH needs `If-Match`. |
| PUT | `/api/v1/teammates/:slug/persona` | Replace the persona body. |
| POST | `/api/v1/teammates/:slug/pause` · `/resume` · `/retire` | Lifecycle. |
| **POST** | **`/api/v1/teammates/:slug/tasks`** | **Invoke.** Body: `{ input, skill?, thread?, project?, stream?, maxOutputTokens? }`. |
| GET | `/api/v1/teammates/:slug/tasks` | Work log, filterable and paginated by cursor (ULID). |
| GET | `/api/v1/teammates/:slug/tasks/:workId` | Work item detail. |
| POST | `/api/v1/teammates/:slug/tasks/:workId/rating` | Rate a work item. |
| GET / POST / PUT / DELETE | `/api/v1/teammates/:slug/knowledge[/:doc]` | Knowledge documents (upload uses multipart). |
| GET / POST / PUT / DELETE | `/api/v1/teammates/:slug/memory[/:note]` | Memory notes. |
| PUT | `/api/v1/teammates/:slug/skills` | Attach or detach skills. |
| GET / POST / PUT / DELETE | `/api/v1/skills[/:id]` | Shared skill library. |
| GET / PUT | `/api/v1/models` | Providers, model profiles and price list (admin only). |
| POST | `/api/v1/models/:profile/test` | Connectivity check with a tiny prompt. |
| GET | `/api/v1/costs/summary?groupBy=teammate\|skill\|caller\|day` | Aggregates. |
| GET | `/api/v1/costs/export.csv` | CSV export. |
| GET / POST / DELETE | `/api/v1/admin/api-keys` | Manage keys. A new key is shown once, then only its hash is stored. |
| GET | `/health` | Liveness, data dir writable, providers configured. |

**Streaming:** with `stream: true` (or `Accept: text/event-stream`), the server sends the events `delta`, `usage` and `done`, where `done` carries `{ workId, costUsd }`.

**Example call:**

```bash
curl -X POST http://localhost:11202/api/v1/teammates/ada-architect/tasks \
  -H "Authorization: Bearer dtk_…" -H "Content-Type: application/json" \
  -d '{"input":"Propose an integration approach between Orders and Billing.","skill":"adr-authoring","project":"payments-platform"}'
```

## 10. Front end

A single-page shell (`public/index.html`) with a small hash router. Pages are ES modules that render into `<main>`. Reusable pieces are native **Web Components**, and there is no framework.

| Page | Route | Contents |
|------|-------|----------|
| Dashboard | `#/` | Spend this month against budget, the most active teammates, recent work, alerts. |
| Catalog | `#/catalog` | Template cards with role, skills, tier and estimated cost per task, plus a **Hire** wizard (name → model → budget → confirm). |
| Team | `#/team` | Roster table: avatar, name, role, model, status, month-to-date cost and budget bar. |
| Teammate | `#/team/:slug/{overview,persona,skills,knowledge,memory,work,costs,settings,playground}` | Tabs per concern. Markdown editor with live preview. The Playground uses SSE and shows a running cost meter. |
| Skills Library | `#/skills` | Browse and edit shared skills, and see which teammates use each one. |
| Models & Providers | `#/models` | Provider status, model profiles, price list with effective dates, and a test button. |
| Costs | `#/costs` | Charts by teammate, skill, caller and day (inline SVG, no chart library needed), plus CSV export. |
| Admin | `#/admin` | API keys, global budget, memory defaults, data directory info. |

Styling uses CSS custom properties in `tokens.css`, light and dark themes via `prefers-color-scheme` plus a manual toggle, and a responsive grid.

## 11. Security

- **Secrets:** provider keys are read only from the environment. `providers.md` stores the *name* of the environment variable.
- **API keys:** the format is `dtk_<random 32 bytes base62>`, and only a SHA-256 hash is stored in `system/api-keys.md`. Each key is scoped to `teammates: [slugs] | "*"` and `actions: [invoke, read, admin]`.
- **UI auth:** nooblyjs-core's authservice (see §17): a session cookie (`httpOnly`, `sameSite=lax`, `secure` behind TLS) and CSRF tokens on state-changing UI calls; per-IP and per-account sign-in throttling by core.
- **Path safety:** every path comes from validated slugs and IDs and is resolved, then checked to start with `DATA_DIR`.
- **Markdown rendering:** sanitized with DOMPurify. Raw HTML in knowledge and memory is never trusted.
- **Prompt injection:** knowledge and memory are wrapped in clearly delimited sections and labelled as reference data, not instructions. Memory notes written by reflection are size-limited and visible to curators. Because teammates have no tools in v1, the potential damage is limited to what they write in their output.
- **Rate limiting:** per API key, as a token bucket held in memory.
- **Uploads:** limited to 2 MB per file, `.md` and `.txt` in v1, with file names re-slugged.

## 12. Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `11202` | HTTP port. |
| `DATA_DIR` | `./data` | Root of all state. Seeded from `./seed` on first run. |
| `SESSION_SECRET` | generated | Signs the session cookie and CSRF tokens. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | optional | Provider credentials referenced by `providers.md`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`, for the log file and the console. |
| `LOG_DIR` | `$DATA_DIR/logs` | Log file folder. |
| `DEFAULT_ADMIN_PASSWORD` | generated | Password of `admin@localhost`, the first account, on first start. |
| `LOG_CONSOLE` | `all` | Console output: `all` (mirror the log file, core included), `app` or `none`. |

## 13. Testing strategy

- **Unit:** store (atomic writes, locks, path safety), cost math, BM25, prompt builder (snapshot tests), skill selector.
- **Integration:** `supertest` against `createApp({ dataDir: tmp, providers: mock })` covering hire → invoke → ledger → reflection → memory.
- **Contract:** recorded provider fixtures check the usage-mapping code for Anthropic and OpenAI.
- **UI smoke:** optional Playwright tests of the hire wizard and playground.

## 14. Key decisions (ADR summary)

| # | Decision | Alternatives considered | Rationale |
|---|----------|------------------------|-----------|
| ADR-001 | Markdown with YAML front matter on the file system as the only store. | SQLite, JSON files. | Human-readable, git-diffable, and matches the requirement. A store interface keeps the way open to a database. |
| ADR-002 | Monthly Markdown tables as append-only cost ledgers. | One file per entry, JSONL. | Readable in any viewer, cheap appends, and aggregates rebuilt quickly at startup. |
| ADR-003 | Lexical (BM25) retrieval in v1. | Embeddings with a vector index. | No extra model cost or infrastructure. Good enough for curated knowledge. Embeddings come in Phase 3. |
| ADR-004 | Reflection runs asynchronously on a configurable, cheaper model. | Synchronous, or the same model. | Keeps response times low and memory upkeep cheap. |
| ADR-005 | Vanilla JS with Web Components and no build step. | React or Vue. | Matches the requirement and is simple to host and debug. |
| ADR-006 | One OpenAI-compatible provider covers Azure, Ollama and vLLM. | One adapter per vendor. | Less code. Local models make an economy tier possible. |
| ADR-007 | Cross-cutting infrastructure (logging, caching, queueing, events, scheduling, metrics) on nooblyjs-core; the Markdown store stays. | Hand-rolled per concern (as before); core `dataservice`/`filing` for storage. | Shared, swappable providers (e.g. Redis) and dashboards across the NooblyJS projects. Files remain the database (ADR-001), so core's storage services are not used. |

## 15. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| File-system contention under concurrent load | Corrupt or lost writes | Per-path mutex, atomic rename, single-process constraint, and a database adapter path. |
| `fs.watch` unreliable on network or Docker volumes | Stale caches | Periodic mtime sweep, plus cache invalidation on every write the app makes itself. |
| Memory drift or poisoning | Bad advice persists across tasks | Curator review UI, `source` links back to work items, pinned and approved states, consolidation. |
| Price list out of date | Wrong cost reports | `effectiveFrom` versioning, a "last reviewed" warning in the UI, and prices copied into each ledger row. |
| Ledger grows large | Slow startup | Monthly files, only the current month parsed at boot, and cached aggregates. |

## 16. Build notes: reconciling with the UI design brief (2026-10-01)

The first build follows [`design/teammates-design-brief.md`](design/teammates-design-brief.md). Where the brief and the sections above disagree, the build does the following:

| Topic | Earlier spec | As built |
|---|---|---|
| Front end | Hash router, generic pages | History API routes `/team`, `/team/:id`, `/billing`, `/hire` (plus `/profiles`), and the four designed screens. Vanilla ES modules, not React as the brief suggests, because plain HTML/CSS/JS is a hard requirement. |
| Billing unit | Token cost against a budget | **Hours × rate**, as in the design. Hours = total tokens ÷ `billing.tokensPerHour` (default 300k), rounded up to 0.1 h. Each time entry also records the real API cost (`apiCost`) from list prices in `config/models.md`. |
| Cost breakdown | n/a | `computePerHour` and `toolsPerHour` per model in `models.md`. Margin is the rate minus both. |
| Cost ledger | `costs/YYYY-MM.md` | `timesheets/YYYY-MM.md`, a Markdown table with a `pending`/`approved` status per row. Invoices are stored in `invoices/`. |
| Memory | Free-form notes with a `MEMORY.md` index | One file per item with `kind: fact \| preference \| source`. Three modes: `session` (keep nothing), `personal` (`teammates/<id>/memory/`) and `team` (`team-memory/`). The reflection model is set by `reflection:` in `models.md`. |
| Status | `active \| paused \| retired` | `task \| available \| paused \| off`. A running task sets `task` and resets to `available` when the last running task finishes. |
| Knowledge retrieval, API keys, retire/archive | Phase 1 | Built in Phases 2–4: retire keeps the folder (no `archive/`); one owner with a session cookie + CSRF; API keys hashed in `system/api-keys.md`, invoke-only; BM25 retrieval over `knowledge/` passages; threads in `threads/`; optional `project` tag filtering knowledge and memory. Work items record `caller`, `thread`, `project`, `skillsUsed`, `knowledgeUsed`, `memoryUsed`. |

Anthropic adapter: `claude-opus-5-5` and `claude-sonnet-5-5` send `output_config.effort` and the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). `claude-haiku-4-5` sends neither. The persona and skills form a cached system block. Memory is sent in a second, uncached system block.

## 17. Build notes: nooblyjs-core infrastructure (2026-10-05)

The app runs on the nooblyjs-core service registry (`src/core`). The registry is a process-wide singleton bound to its own Express 4 app (core's routes use patterns Express 5 rejects); `coreRouter()` forwards `/services/*` to it. Each `createApp()` gets its own named service instances (`default` for the first), which keeps the tests, which start several apps per process, isolated. Core's internal logging is pointed at the file logger with `setDefaultProvider('logging', 'file')` before anything is created, so it never writes to stdout.

| Concern | Before | Now |
|---|---|---|
| Logging | `console` | `createLogger()` (`src/core/logger.js`): core `logging:file` (`data/logs/app.YYYY-MM-DD.log`, rotated) plus console echo at `LOG_LEVEL`. Credential-like fields are redacted. A caller-supplied `log` (tests) replaces the console echo only. |
| Document reads | YAML parsed on every `readDoc` | `FsStore` read-through cache on core `caching`, validated by mtime + size (hand edits are seen), invalidated on every write, LRU-bounded to 2,000 documents. Secret-bearing files (`system/*`, `config/webhooks.md`, `config/mcp-servers.md`) are not cached because `/services/caching/` can read cache values. |
| Webhooks | Delivered inline, no retry | `JobQueue` (`src/core/job-queue.js`) on core `queueing`. `emit()` still resolves with the first attempt. Network errors, timeouts, 429 and 5xx retry after 10 s, 1 min, 5 min with a stable `X-Teammates-Delivery` id. Waiting retries are lost on restart (memory provider). |
| Live events | `EventEmitter` | `EventBus` on core `notifying`, topic `teammates.events`. |
| Schedule check | `setInterval` | Core `scheduling` interval task `teammates-schedules` (pause/resume/run-now on its dashboard). Core runs each beat as a worker-thread activity (`src/core/activities/schedule-tick.cjs`); the check itself runs in the main process in the task callback because it needs the repos and providers. Beats are not retried. Falls back to `setInterval` when no core scheduling is passed. |
| Metrics | none | `Metrics` (`src/core/metrics.js`) on core `measuring`: `task.*`, `webhook.*`, `schedule.*`, `http.request_ms`. The memory provider is trimmed to the newest 1,000 measures per metric; lifetime totals are kept separately. |
| Ops view | none | `GET /api/admin/system` and **Admin → System**; core dashboards at `/services/`. |
| Sign-in | Teammates users (`system/users.md`, scrypt), setup code, signed `tm_session` cookie | Core `authservice` (file provider, `data/core/auth/`) for the whole app, as in core's reference `app.js`. Core's `express-session` (`nooblyjs.sid`, path `/`, SameSite=Lax; `FileSessionStore` in `data/core/sessions.json` with hashed session ids so restarts keep people signed in, or core's Redis store when `SESSION_REDIS_URL`/`REDIS_URL` is set) and `passport` run on core's Express app and, via `coreSession()`, on `/api` and `/uploads`; `req.user` (core user) becomes `req.actor` with `roleFromCore()` (`admin`/`owner` → owner, `manager` → manager, else viewer). `/login` redirects to core's login page with `returnUrl`; core calls `GET /api/auth/check`. CSRF token = HMAC(secret, session id). Sign-out: `DELETE /api/session` (Passport logout, session destroy, core token revoked). First start creates `admin@localhost` (`DEFAULT_ADMIN_PASSWORD` or `INITIAL_ADMIN_PASSWORD.txt`, mode 0600, never logged). `prepareAuth()` adds the `owner`/`manager`/`viewer` roles to core. People and roles are managed on core's Authentication dashboard; `/services` itself needs core `admin`. API keys (`dtk_`) for calling teammates are unchanged. `system/users.md` is no longer read. |

Not used: core `dataservice` and `filing` (the Markdown store is the database), `searching` (BM25 retrieval in `retrieval.js` is tuned and tested for passages and skills), `workflow` and `aiservice`.

Known core behaviours worked around here: Express 5's `req.query` getter is lost when core's Express 4 app swaps the request prototype, so `coreRouter()` pins it as an own property; core scheduling does not handle a rejected `working.start()` (e.g. a retry after shutdown), so the check is created with `retryAttempts: 0`.
