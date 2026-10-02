# LLM Project Desktop

A self-hosted clone of the Claude Code Desktop **Projects** workflow that works with any
LLM — Anthropic Claude, OpenAI, Google Gemini, or DeepSeek.

A **project** is a named workspace with a description. That description is injected as
standing context into every chat inside it, so you never re-paste it. Chats are resumable,
and switching model is a dropdown.

Everything lives as plain files on your disk. Projects are folders, chats are JSON. No
database, no account, no React.

## Quick start

```bash
git clone https://github.com/nooblyjs/nooblyjs-ai-common.git ../nooblyjs-ai-common   # shared model catalogue, linked as a file: dependency
npm install
cp .env.example .env     # add at least one API key
npm start                # http://127.0.0.1:3000
```

The app starts with no keys configured and tells you which variables to set.

To try the interface without an API key:

```bash
npm run dev:mock         # registers a fake provider that echoes its context back
```

## Configuration

All configuration is environment variables, in `.env`:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Enables Claude |
| `OPENAI_API_KEY` | Enables OpenAI |
| `GEMINI_API_KEY` | Enables Gemini |
| `DEEPSEEK_API_KEY` | Enables DeepSeek |
| `PORT` | Default `11201`; `.env.example` sets `3000` |
| `HOST` | Default `127.0.0.1` — the app has no authentication, so keep it on loopback |
| `DATA_DIR` | Default `./data` |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |
| `NOOBLY_DIR` | Default `./.noobly-core` — nooblyjs-core service data and logs |
| `DEFAULT_ADMIN_PASSWORD` | Password for the `/services` admin created on first run |

API keys are read from the environment only. They are never written into your data folder
and never sent to the browser — the settings page shows configured/not-configured, nothing
more.

`*_BASE_URL` variables (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GEMINI_BASE_URL`,
`DEEPSEEK_BASE_URL`) move a provider's address if you route through a gateway.

The app calls every provider over plain HTTP through
[nooblyjs-ai-common](https://github.com/nooblyjs/nooblyjs-ai-common)'s provider layer — no vendor
SDKs. Gemini is reached through its OpenAI-compatible endpoint.

## Your data

```
data/
├── settings.json
└── projects/
    └── nmea-parser-a3f9/
        ├── project.json
        ├── chats/
        │   └── 20260911t0912-parse-rmc-k2m8.json
        └── documents/
            ├── Roadmap.md
            └── Specs/
                └── Protocols/
                    └── NMEA checksum.md
```

Chat files are pretty-printed JSON, one per chat, named so a directory listing reads
chronologically. Writes are atomic (temp file, then rename), so a crash never leaves a
half-written chat.

The folder is yours: grep it, back it up, commit it, sync it. Dropping a well-formed
project directory in by hand works — it is picked up on the next page load.

`data/` is gitignored by default.

## Documents

Each project has a `documents/` folder holding markdown files in whatever folder
structure you like. Open it from **Documents** on the project page.

You can create, edit, rename, delete and drag items between folders. Everything is a
real file on disk, so editing `documents/Specs/Notes.md` in your own editor works
exactly as well — the app picks the change up on the next read, no restart.

Only `.md` files are shown. Symlinks are ignored, and nothing outside the project's
`documents/` folder is reachable.

## How chats use your documents

Two mechanisms, both feeding the same system prompt:

**Explicit references.** Type `@` in the composer to pick a document. The whole file is
included in that turn's context. Paths with spaces are quoted: `@"Specs/NMEA checksum.md"`.

**Automatic retrieval (RAG).** Every message is also used as a search query across all
the project's documents. Documents are split into chunks along their markdown headings,
ranked with BM25, and the best-matching chunks are added to the context.

Each answer shows which documents it drew on, and whether each was referenced explicitly
or retrieved automatically.

Retrieval is **lexical, not vector-based**. That is a deliberate trade: Anthropic has no
embeddings endpoint, so an embedding index would force an OpenAI dependency on every user
regardless of which model they actually chat with — and it would add per-document API cost
and a vector store. BM25 needs none of that and works offline. The cost is that it matches
on words rather than meaning, so a question phrased with entirely different vocabulary than
the document may not retrieve it. Use an `@` reference when you want to be certain.

Documents get up to 40% of the context window. Explicit references are filled first,
retrieved chunks fill whatever is left, and the project description is never displaced.

## How context works

Every request to a provider is composed as:

```
system   = app preamble
         + project name + project description
         + referenced documents, then retrieved document chunks
messages = prior turns of this chat (oldest dropped first if the window is tight)
         + your new message
```

The description is read from disk **at send time**, not copied into the chat when it is
created. Editing a project description therefore changes the context of chats you started
last week, not just new ones.

When history outgrows the model's context window, the oldest turns are dropped and a banner
says so. The project description is never dropped.

## Choosing a model

Precedence, most specific first:

```
the chat's own picker  →  the project default  →  the global default  →  first configured provider
```

Switching provider mid-chat sends the existing conversation to the new model as-is.

The models the app offers are listed in [`src/config/models.js`](src/config/models.js) — one
line of model ids per provider. Add or remove ids there; no adapter change is needed. The facts
about each model (label, context window, request quirks) come from the shared catalogue in
[nooblyjs-ai-common](https://github.com/nooblyjs/nooblyjs-ai-common), so a new model is added there first.

## Adding a provider

1. Add the provider and its models to the nooblyjs-ai-common catalogue. If it speaks one of
   common's API styles (Anthropic, OpenAI Responses, or OpenAI-compatible Chat Completions),
   that's all common needs.
2. List the models the app offers in `src/config/models.js`.
3. Add `createAdapter({ id, label })` to `src/providers/registry.js`.

Nothing in the routes, storage, or UI needs to change. Every adapter keeps the contract in
[`src/providers/types.js`](src/providers/types.js): `id`, `label`, `apiKeyEnvVar`,
`isConfigured()`, `listModels()`, and `streamCompletion(request)` returning an
`AsyncIterable<StreamEvent>`. A provider that needs something else can implement that
contract directly and be registered the same way.

## Infrastructure services (nooblyjs-core)

The app runs the [nooblyjs-core](../../nooblyjs-core) service registry, wired up in
[`src/core.js`](src/core.js): logging, caching, data, filing, queueing, scheduling,
searching, measuring, notifying, working, workflow and auth. Use them from server code with
`getCore()`, e.g. `getCore().cache.put(key, value)`.

Each service exposes a REST API and dashboard under **`/services/`**, protected by core's
auth service. On first start it creates `admin@localhost`, with `DEFAULT_ADMIN_PASSWORD` or a
generated password written to `.noobly-core/data/INITIAL_ADMIN_PASSWORD.txt` — log in,
then delete that file.

Core is built on Express 4 and this app on Express 5, whose router rejects core's route
patterns. Core therefore gets its own Express 4 app, and the main app forwards `/services`
requests to it. Those pages also get core's looser CSP (inline scripts, jsDelivr/unpkg);
everything else keeps the strict policy below.

## Styling

The UI is Bootstrap 5 with Bootstrap Icons, both served from `node_modules` (no CDN), and
shares the Noobly theme with the other nooblyjs apps. Stylesheets load in this order:

1. `bootstrap.min.css` and `bootstrap-icons.min.css`
2. [`public/css/styles.css`](public/css/styles.css) — the shared Noobly theme, copied from
   `nooblyjs/styling/styles.css`. Don't edit it here; re-copy it when the theme changes.
3. [`public/css/desktop.css`](public/css/desktop.css) — styles specific to this app, using the
   theme's tokens (`--accent`, `--ink`, `--border`, …).

## Development

```bash
npm run dev        # node --watch
npm run dev:mock   # with a fake provider, no API key needed
npm test           # node:test, no network
```

The test suite runs a single contract suite against all four adapters using a local fake
HTTP server, so provider behaviour is verified without spending anything.

## Design notes

See [`spec/`](spec/) for the PRD, architecture, and task breakdown.

Four decisions worth knowing:

- **The filesystem is the database.** No SQLite. This costs efficient querying and buys
  grep, git, and trivial backup.
- **The description is read at send time.** Edits propagate to existing chats. The trade-off
  is that you cannot exactly reproduce a past turn's context.
- **Token budgeting uses a character-ratio estimate**, not a real tokeniser — a conservative
  estimate plus a safety margin, instead of four per-provider tokeniser dependencies.
- **Retrieval is lexical (BM25), not vector-based** — it keeps the app provider-agnostic and
  dependency-free, at the cost of matching words rather than meaning.

## Security

Single-user and local by design. It binds to loopback and the app itself has **no
authentication** (only the `/services` dashboards require a login) — do not expose it to a
network. Project and chat IDs are strictly validated and every resolved path
is asserted to sit inside `DATA_DIR`, so traversal is structurally impossible. Rendered
Markdown is sanitised with DOMPurify, and a strict CSP with no `unsafe-inline` is set. The
only third-party origins it allows are Google Fonts, which the shared theme imports.
