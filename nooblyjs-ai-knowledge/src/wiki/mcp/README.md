# Wiki MCP Server

Lets an AI client — Claude Code, Claude Desktop, Copilot, anything speaking the
Model Context Protocol — read the knowledge wiki directly.

```
GET  /applications/wiki/api/swagger/openapi.json   the description (for developers)
POST /applications/wiki/api/mcp                    the connection  (for AI clients)
GET  /applications/wiki/api/mcp/info               discovery: what this server offers
```

---

## MCP is not "Swagger for AI"

The distinction drives every decision below, so it is worth stating plainly.

|  | OpenAPI / Swagger | MCP |
|---|---|---|
| What it is | A **document** describing HTTP endpoints | A **live protocol** (JSON-RPC) a client connects to |
| Who reads it | A developer, or a codegen tool | The AI client's *host*, which injects the tool list into the model's context |
| When | Build time | Run time, every session |

A model never reads `openapi.json` and works out how to call it. This server
advertises a **tool list** — name, description, JSON schema — and the model calls
those. Both artefacts should exist: the spec is the contract for humans and
codegen, this is the runtime for models.

---

## Connecting

Setup steps, troubleshooting and the security model live in
**[`.docs/MCP-Server.md`](../../../../.docs/MCP-Server.md)** — deliberately kept
there rather than duplicated here, because a connect URL written in two places
drifts in one of them. The short version:

```bash
curl -s https://<your-host>/applications/wiki/api/mcp/info   # public; 401 = not deployed

claude mcp add --transport http knowledge \
  https://<your-host>/applications/wiki/api/mcp \
  --header "Authorization: Bearer dtk_your_token_here"
```

Tokens come from the wiki's Profile → API tokens screen, are `dtk_…`, and act as
the owning user with their live roles.

---

## Tools

Both are read-only and annotated `readOnlyHint: true`, so hosts can skip an
approval prompt.

### `search_knowledge`

The front door. Wraps `GET /applications/wiki/api/search`.

| Argument | Type | Notes |
|---|---|---|
| `query` | string, **required** | Double-quote a phrase for an exact adjacent match |
| `spaceId` | integer | Omit to search everything the caller can see |
| `fileTypes` | string | Comma-separated, e.g. `markdown,pdf` |
| `limit` | integer 1–50, default **10** | |

Two deliberate departures from the HTTP endpoint's defaults:

- **`limit` defaults to 10, not 200.** The endpoint's default is right for a UI
  that paginates and catastrophic for a context window.
- **`includeContent` is never sent.** It appends a body to *every* hit, so a
  10-result search would drop ten whole documents into the transcript before the
  model has decided any of them are relevant. Reading is `read_document`'s job.

Each hit is reduced to `title`, `spaceId`, `spaceName`, `path`, `type`,
`modifiedAt`, `snippet`. Everything dropped — facet axes, tags, relevance, size,
ids — exists for the search UI's filter rail; none of it changes what the model
does next, and all of it costs tokens on every result. `<mark>` highlighting is
stripped for the same reason.

### `read_document`

Wraps `GET /applications/wiki/api/spaces/:spaceId/file-content/:documentPath`.

| Argument | Type | Notes |
|---|---|---|
| `spaceId` | integer, **required** | From a search result |
| `path` | string, **required** | Space-relative, `/` separated |
| `offset` | integer, default 0 | Resume point for a truncated read |
| `maxChars` | integer 500–200000, default **40000** | ~10k tokens |

Behaviour depends on the file policy:

- **markdown / code / text / data** — returned as-is.
- **office (docx/xlsx)** — the endpoint already serves the derived markdown
  sidecar. Nothing extra to do.
- **PDF** — the endpoint streams raw bytes, and a PDF's text only exists in its
  derived sidecar (`<folder>/.system/derived/<name>.pdf.md`). So the tool falls
  back to `GET /applications/wiki/api/documents/derived`, which addresses the
  sidecar by the **original's** path. That endpoint keys off `spaceName` rather
  than `spaceId`, hence a small id→name resolution — done lazily, so a markdown
  read never pays for it.
- **image / video / audio** — refused in words. No sidecar exists and never will;
  handing back a Buffer or base64 helps nobody.

**Long documents are windowed, not silently truncated.** A cut response says
where it stopped and how to resume:

```
--- Truncated at character 40000 of 91204. Call read_document again with offset=40000 to continue. ---
```

A document cut silently looks complete to the model, which then answers
confidently from half a page. That is the failure this exists to prevent.

---

## Architecture

```
AI client
   │  JSON-RPC over Streamable HTTP,  Authorization: Bearer dtk_…
   ▼
mount.js ──────────► server.js ──────────► tools/*.js
 auth gate,          McpServer,             shape + branch
 transport           instructions
                                              │
                                              ▼
                                        internalApi.js
                                     loopback HTTP, auth forwarded
                                              │
                                              ▼
                              the wiki's own public HTTP API
                          (spacePaths.js → visibility, curation, 404s)
```

| File | Role |
|---|---|
| `mount.js` | Express routes, auth gate, transport lifecycle |
| `server.js` | Builds the `McpServer`, registers tools, session instructions |
| `internalApi.js` | Loopback HTTP client |
| `tools/searchKnowledge.js` | `search_knowledge` |
| `tools/readDocument.js` | `read_document` |

### The tools call our own HTTP API. That is the point.

They do **not** reach into `DataManager` or the filing services. Going back
through HTTP means every read traverses `spacePaths.js` with visibility ON, so a
curated-away path answers **404, never 403** (a 403 confirms the document exists,
which is exactly what the curation hides), pass-through containers behave, and
shared content roots stay curated per space.

Bypassing HTTP would mean re-implementing that boundary in a second place. See
the shared-content-root guards note in `CLAUDE.md` for how that went the first
time — six access-boundary holes, including handlers that echoed hidden
documents' full contents back to the caller.

### Stateless

`sessionIdGenerator: undefined`. A fresh server and transport are built per
request and torn down with it. Building a server is object construction, not I/O,
so this is cheap — and it means there is no session table mapping MCP
connections to users, therefore nothing to leak between them, and no sticky-session
requirement when this runs on more than one node.

### Auth

MCP clients send `Authorization: Bearer`, which the global bearer middleware has
already validated by the time the handler runs. `internalApi` forwards that header
verbatim on the loopback call, so the internal request re-runs the real middleware
and acts as the real user. Nothing here elevates: an expired or revoked token gets
exactly the access an anonymous caller would.

---

## Two landmines

Both were found by testing against a booted server, not by unit tests. Neither is
discoverable from reading the code.

### 1. `https.request` is monkey-patched process-wide

`passport-azure-ad` (pulled in by the Entra SSO wiring) depends on `agent-base`,
which **replaces `https.request` globally** with a legacy signature accepting only
`(options[, callback])`.

Call the modern three-argument `(url, options, callback)` form and the patch binds
the options object as the callback, and Node throws from deep inside
`ClientRequest`:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "listener" argument must be of type function.
Received an instance of Object
```

`internalApi.js` therefore uses the **two-argument** `request(options, callback)`
form with the URL decomposed into `protocol`/`hostname`/`port`/`path`. It looks
like a pointless de-optimisation; it is not. A standalone script never loads
passport-azure-ad and works fine, so this only fails in the booted app.

### 2. The wiki API auth guard answers before we do

`initialize.js` puts a blocking guard in front of `/applications/wiki/api` that
returns `{success:false, error:'Authentication required'}` — no
`WWW-Authenticate` header, not JSON-RPC. An MCP client reads that as a malformed
response rather than a login prompt.

So **both** `/mcp` and `/mcp/info` are in `WIKI_API_PUBLIC_PATHS`. `/mcp` is *not*
actually public — `mount.js` runs its own identical `isAuthenticated()` check and
answers with a JSON-RPC error plus `WWW-Authenticate: Bearer`. Auth was not
weakened; it moved to where it can speak the protocol.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `WIKI_MCP_ENABLED` | `true` | Set `false` to unregister the routes entirely |
| `WIKI_MCP_INTERNAL_ORIGIN` | *(derived)* | Override the loopback origin |

The loopback origin is normally derived from the live request —
`req.socket.localPort` is literally the port the request arrived on and
`req.socket.encrypted` whether it was TLS. That keeps working when `PORT` changes
and under both boot paths (`app.js` binds HTTPS on `PORT` and only 301-redirects
from the HTTP port, so a hardcoded `http://127.0.0.1:9101` would silently follow
a redirect in production). Only override it where the app cannot reach its own
socket — some container topologies.

**Never point it at the public hostname.** That path goes back through the reverse
proxy and the Entra SSO guard, which answers a 302 to the login page rather than
data — the same failure the workflow bridge hit before it moved to file IPC.

---

## Adding a tool

1. Create `tools/<name>.js` exporting `{ name, config, handler }`. `config` takes
   `title`, `description`, `inputSchema` (a plain object of zod schemas), and
   `annotations`.
2. Add it to `TOOLS` in `server.js`.
3. Add cases to `tests/backend/components/mcpServer.test.js`.

**The description is a prompt.** It is the highest-leverage text in the module —
the model chooses tools by reading it and nothing else. Say when *not* to use the
tool, not just what it does.

**Do not auto-generate tools from `openapi.json`.** Generators exist; the output
is bad for models. The spec has no `operationId` on any operation, so names fall
back to paths (`get_applications_wiki_api_spaces_spaceId_folder_tree`); the tools
mirror HTTP verbs rather than tasks; and the lazy folder tree's `truncated: true`
(meaning *not listed yet*, not *empty*) reaches the model as a raw boolean it will
confidently misread, silently dropping whole subtrees from its answers.

### Response shaping is where MCP servers live or die

The API returns what a browser needs. A model needs something different, and the
failure is silent — it fills its context with structure and has no room left for
content.

- **Never return the full folder tree.** Measured on this repo: 9 listings / 68ms
  at depth 2 vs **7,972 listings / 7.6s** unbounded.
- **Cap content and page it**, with an explicit resume offset.
- **Search returns snippets, not documents.**
- **Flatten.** Strip every field the model cannot act on.

---

## Testing

```bash
npm run tests -- tests/backend/components/mcpServer.test.js
```

23 tests covering path encoding, origin derivation, result shaping, the
404/403 equivalence, windowing, the PDF sidecar fallback, schema generation and
error containment. The tools are exercised against a stub API client — these
assert shaping and branch decisions, which is where the silent failures live.

For a live check, boot on a spare port and drive it with `curl`:

```bash
PORT=11055 WORKFLOW_API_TOKEN=probe-token node app.js

curl -sk -X POST https://127.0.0.1:11055/applications/wiki/api/mcp \
  -H "Authorization: Bearer probe-token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

`Accept` must list **both** `application/json` and `text/event-stream`, or the
transport rejects the request.

---

## Known rough edges

- **First search on a cold index** can exceed the 30s internal timeout and surface
  as `Internal API request timed out after 30000ms`. The index is building, not
  broken — but the model sees a failure. A warm instance is fine.
- **Self-signed certs** fail at TLS with an error that is not MCP-shaped, so the
  client reports a connection failure rather than anything diagnostic.
- **Only two tools.** No browsing, no folder tree, no change feed yet — see below.

## Not built yet

`browse_folder`, `get_folder_tree` (with `truncated` rendered as prose the model
can act on), `changes_since` over the cursor feed, MCP **resources** (documents as
addressable URIs, so they are @-mentionable in a client's picker), MCP **prompts**
(canned workflows as slash commands), and a stdio shim for clients that cannot do
remote HTTP.
