# MCP Server

How to connect an AI client — Claude Code, Claude Desktop, Copilot, anything speaking
the Model Context Protocol — directly to the knowledge wiki, so it can search and read
documentation without anyone copy-pasting into a chat window.

Setup takes about two minutes and one API token.

**Implementation detail** — architecture, security model, known landmines and how to add
a tool — lives in [`src/wiki/mcp/README.md`](../src/wiki/mcp/README.md).
This document is the guide for people connecting to it.

---

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /applications/wiki/api/mcp` | Bearer token | The MCP connection itself |
| `GET /applications/wiki/api/mcp/info` | **Public** | Discovery — server name, transport, tool list |
| `GET /applications/wiki/api/swagger/openapi.json` | Public | The underlying REST API spec |

Production base URL:

```
https://wiki.example.com
```

### MCP is not "Swagger for AI"

Worth stating, because the two are easy to conflate:

|  | OpenAPI / Swagger | MCP |
|---|---|---|
| What it is | A **document** describing HTTP endpoints | A **live protocol** a client connects to |
| Who reads it | A developer, or a codegen tool | The AI client's host, which injects the tool list into the model's context |
| When | Build time | Run time, every session |

A model never reads `openapi.json` and works out how to call it. The MCP server advertises
a **tool list** and the model calls those tools. Both exist: the spec is the contract for
humans and codegen, MCP is the runtime for models.

---

## Before you start

**The backend must be running a build that includes the MCP server.** Step 1 below is the
check. If it fails, nobody can connect regardless of what their client reports — the
platform team needs to deploy and restart first.

---

## Setup

### 1. Check the server is up

Public endpoint, no token needed. Returns the server name, transport and the tool list.

```bash
curl -s https://wiki.example.com/applications/wiki/api/mcp/info
```

A `401` or a connection error means the wiki you are pointing at is not serving MCP yet.
Stop here.

### 2. Mint an API token

In the wiki, open **Profile → API tokens** and create one. Copy it immediately — it is
shown once and never again.

Tokens start with `dtk_` and act as you, with your roles, so an AI connected this way sees
exactly the spaces you can see and nothing more. Revoking a token from the same screen
takes effect on the very next request.

### 3. Add the server to your client

For Claude Code, one command. Swap in the token from step 2:

```bash
claude mcp add --transport http knowledge \
  https://wiki.example.com/applications/wiki/api/mcp \
  --header "Authorization: Bearer dtk_your_token_here"
```

Add `-s user` to make it available in every project rather than only the current one.

Other MCP clients need the same two things — the server URL and an
`Authorization: Bearer` header. Where those go depends on the client.

### 4. Confirm, then just ask

```bash
claude mcp list
```

`knowledge` should show as connected. After that there is no syntax to learn — ask in
plain language and the model decides when to search:

> *"search the wiki for our payment gateway standards"*
> *"what does the wiki say about the ARIS process model types?"*

---

## What it can do

Two tools, both read-only. Nothing connected this way can modify the wiki.

| Tool | What it does | Notes |
|---|---|---|
| `search_knowledge` | Full-text search across every space you can see. Returns titles, paths and a snippet showing the match. | The starting point for almost everything. Supports `"quoted phrases"` for exact matches. |
| `read_document` | Reads one document's text. PDFs and Word/Excel files return their extracted text automatically. | Long documents come back in windows; the model requests the next chunk itself. |

**Not exposed yet:** folder browsing, the folder tree, and the change feed. Images, video
and audio have no text to read and are reported as such rather than returned as bytes.

### Tool arguments

`search_knowledge`

| Argument | Type | Notes |
|---|---|---|
| `query` | string, **required** | Double-quote a phrase for an exact adjacent match |
| `spaceId` | integer | Omit to search everything the caller can see |
| `fileTypes` | string | Comma-separated, e.g. `markdown,pdf` |
| `limit` | integer 1–50, default **10** | |

`read_document`

| Argument | Type | Notes |
|---|---|---|
| `spaceId` | integer, **required** | From a search result |
| `path` | string, **required** | Space-relative, `/` separated |
| `offset` | integer, default 0 | Resume point for a truncated read |
| `maxChars` | integer 500–200000, default **40000** | Roughly 10k tokens |

---

## Security

- **A token acts as its owner.** Space visibility, curated paths and permissions apply
  exactly as they do in the browser — the MCP tools call the wiki's own HTTP API rather
  than reading disk, so they inherit the whole access boundary.
- **A path you cannot see returns "not found", never "forbidden."** A 403 would confirm a
  document exists, which is what the curation hides.
- **Read-only.** Neither tool writes, and both are annotated as read-only so hosts can
  skip an approval prompt.
- **Revocation is immediate.** Tokens are validated on every request, not cached.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `401` from `/mcp/info` | The backend is on an older build without the MCP server. | Platform team deploys and restarts. Nothing client-side fixes this. |
| A TLS or certificate error | Your client does not trust the certificate the host is serving. | Use the internal hostname rather than an IP or `localhost`, and make sure the internal CA is trusted on your machine. |
| `Internal API request timed out after 30000ms` | The search index is still building. Slow, not broken. | Wait and retry. If it persists on a long-running server, the index needs rebuilding. |
| Searches return nothing at all | Either nothing matched, or your account cannot see the space it lives in. | Try broader terms. If a colleague finds it and you cannot, it is a space permission. |
| The model cannot find a document you named | It guessed a path instead of searching. Paths are case-sensitive. | Ask it to search for the title rather than open a path directly. |

---

## Configuration

Server-side, for whoever runs the backend.

| Variable | Default | Purpose |
|---|---|---|
| `WIKI_MCP_ENABLED` | `true` | Set `false` to unregister the MCP routes entirely |
| `WIKI_MCP_INTERNAL_ORIGIN` | *(derived)* | Override the loopback origin the tools call |

The loopback origin is normally derived from the live request, so it keeps working when
`PORT` changes and under both the HTTP and HTTPS boot paths. Only override it where the
app cannot reach its own socket — some container topologies. **Never point it at the
public hostname**: that path goes back through the reverse proxy and the SSO guard, which
answers a redirect to the login page rather than data.

---

## Related

- [`src/wiki/mcp/README.md`](../src/wiki/mcp/README.md) — implementation,
  architecture and how to add a tool
- [API-Reference.md](API-Reference.md) — the REST API the MCP tools call
- **Profile → API Reference** in the wiki — live Swagger UI for the same API
