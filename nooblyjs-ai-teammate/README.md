# nooblyjs-digital-teammate

**Teammates** is a people-management app for AI agents. Each digital teammate has a name, an avatar, a job title, skills, memory, a Claude model, an hourly rate and a timesheet. Every teammate is also an **HTTP endpoint** you can call with work.

- Node.js + Express backend, plain HTML/CSS/JavaScript front end (no build step)
- All data is stored as **Markdown files in folders**. There is no database.
- Logging, caching, queueing, live events, scheduling and metrics run on [nooblyjs-core](https://github.com/nooblyjs/nooblyjs-core), with its service dashboards at `/services/`
- Specs: [`.claude/specs`](.claude/specs) (PRD, architecture, roadmap, UI design brief)

## Run it

Teammates runs two ways: **standalone** (`server.js`, on its own port) or **hosted** inside
[NooblyJS AI](../nooblyjs-ai-host), which imports `index.js` and calls `register()`. Both run the same `register()`.
It lives in the `nooblyjs-ai` monorepo; `nooblyjs-core` (which also holds the AI module, `nooblyjs-ai-common`) is a separate repo next to the monorepo:

```bash
git clone https://github.com/nooblyjs/nooblyjs-core.git ../../nooblyjs-core   # service registry (logging, caching, queueing…), sign-in, the UI kit
npm install
npm start            # standalone: http://127.0.0.1:11202/teammates (see "Sign in and roles")
npm test             # node:test suite (offline, mock provider)
npm run smoke:live   # one real task each on Haiku, Sonnet and Opus (needs ANTHROPIC_API_KEY; costs a few cents)
```

**Standalone** (`npm start`), the app is at `/teammates` and core's service dashboards at `/services/`. People sign in
with nooblyjs-core's authservice; on the first start it creates `admin@localhost`, and the log says where its
password is (`DEFAULT_ADMIN_PASSWORD`, or a generated one in `data/core/auth/INITIAL_ADMIN_PASSWORD.txt`). Core
roles become access roles: `owner`/`admin` → Owner, `manager` → Approver, `contributor` → Contributor, anything else
→ Viewer. The frame and the UI kit come from nooblyjs-core (`src/shell`, `public/ui`), and changes are checked against
the `noobly.csrf` cookie, as the host does. Settings are in `.env.example`. Data goes to `data/teammates/` (and core's
to `data/core/`). The standalone host is `src/services/standalone-host.js`; the tests run on it too.

**Hosted**, run NooblyJS AI: in `../nooblyjs-ai-host`, set `enabled: true` on the `nooblyjs-ai-teammate` entry in
`data/config/hosted-apps.yaml`, then `npm start` there. Teammates is at `/teammates` on NooblyJS's address (port 11001 by
default), and on first start it seeds `../nooblyjs-ai-host/data/teammates/` with the eight teammates, skills, timesheets and
invoices from the design mockups.

### How NooblyJS hosts it

The contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a; this repo's `.claude/steering/tech.md` restates it. NooblyJS calls
`register(app, serverManager, { mountPath: '/teammates', dataDir, host })` with its Express 5 app, its initialised
nooblyjs-core `serverManager` and what it shares (`host.express`, `host.auth`, `host.requireRole`, `host.audit`,
`host.events`, `host.people`, …). `register()` mounts one router at the mount path (`/teammates/…` for the files and
pages, `/teammates/api/v1/…` for the API), never listens, and returns the app's description for the NooblyJS rail and
sidebar (`name`, `label`, `nav`, `status()`, `seed()`, `close()`).

The tests (and `scripts/live-smoke.js`) run the app on a stand-in NooblyJS host, `test/fixtures/host.js`: an Express 5 app,
an nooblyjs-core `serverManager` and the `host` object, with nooblyjs-core's sign-in. It is the only reason `express` is a
devDependency here.

The app serves no HTML page of its own: only the files in `public/`, the API, and NooblyJS's frame for every page URL.
Its UI is a module (`public/js/module.js`) that the NooblyJS frame loads into its content area, next to the NooblyJS rail and
sidebar. Run it by starting NooblyJS (`npm start` in `../nooblyjs-ai-host`) and opening `/teammates`.

### Code layout

`index.js` is the entry point and composition root. `src/` has exactly seven folders (details in
`.claude/steering/structure.md` §4):

| Folder | Holds |
|---|---|
| `config/` | Fixed settings (mount path, CSP, public folder) and the seed data |
| `controllers/` | Request handlers, one file per resource |
| `middleware/` | Auth and roles, security headers, static files, request metrics, the error shape |
| `models/` | `FsStore` and one repo per entity, over the Markdown files |
| `routes/` | Paths and role checks, wired to controllers; `routes/index.js` builds the one router |
| `services/` | The rules (tasks, billing, approvals, webhooks, tools, schedules…), model providers and the nooblyjs-core adapters |
| `utils/` | Small helpers (dates, ids, CSV, PDF, errors, rate limiting) |

### Settings

The process is NooblyJS's, so these are read from NooblyJS's environment (`../nooblyjs-ai-host/.env`). Without Anthropic credentials,
teammates run on an **offline mock provider**.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | Enables real Claude calls |
| `ANTHROPIC_AUTH_TOKEN` | (none) | A bearer token instead of an API key |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Send Claude calls through a gateway |
| `AI_PROVIDER` | (auto) | `mock` forces offline mode. `anthropic` insists on real calls and stops at startup without a key or token. |
| `SESSION_SECRET` | (generated) | Signs CSRF tokens. If unset, a secret is generated and kept in `data/teammates/system/session-secret.md`. |
| `ALLOW_PRIVATE_FETCH` | `false` | `true` lets the `fetch_url` tool reach private and local addresses (for intranet pages). Off by default. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`, for the log file and the console. `debug` adds one line per API request. |
| `LOG_CONSOLE` | `all` | What the console shows: `all` (every log file line, nooblyjs-core's services included), `app` (only the app's own messages) or `none`. |
| `LOG_DIR` | `<dataDir>/logs` | Where the daily log files go (`app.YYYY-MM-DD.log`, rotated at 10 MB, 5 kept). |

The port, the data folder and the mount path aren't settings here: NooblyJS listens, and passes `mountPath` and `dataDir`.

## Sign in and roles

Signing in is NooblyJS's. A person's NooblyJS **access role** (Viewer, Contributor, Approver, Architect, Owner) decides what they can do: Owners are owners here, Approvers and Architects are managers, and everyone else is a viewer `[CONFIRM]`. The API asks the host (`host.requireRole`) for the NooblyJS permission behind each role: `read` (viewer), `approve` (manager), `set-budgets` (owner), and `hire-teammates` to hire.

| Teammates role | Can |
|---|---|
| **Owner** | Everything, including billing, settings, people and API keys |
| **Manager** | Assign and approve work, edit teammates, their tools and schedules |
| **Viewer** | Read-only |

**Admin → People** lists everyone who can sign in and their role. (The tests' stand-in host signs people in with nooblyjs-core's authservice and maps core roles `owner` / `manager` / `viewer` to Owner / Approver / Viewer.)

**Admin** (in the sidebar) is also where you create and revoke API keys and read the audit log (`data/system/audit/YYYY-MM.md`, which records sign-ins and sign-outs too).

## Call a teammate

Other systems call teammates with an **API key**. Create one under Admin: it is shown once, stored only as a hash, limited to the teammates you choose and to a number of calls per minute. Keys can only call teammates; they cannot read billing or memory. Every timesheet entry and work item records who made the call.

```bash
# JSON response
curl -s localhost:11001/teammates/api/v1/teammates/ada-quill/tasks \
  -H "Authorization: Bearer dtk_…" -H 'Content-Type: application/json' \
  -d '{"task":"Summarise the three biggest risks in our Q4 competitor scan","costCentre":"Growth","project":"acme"}'

# Streamed (Server-Sent Events: start, delta, memory, done | error)
curl -N localhost:11001/teammates/api/v1/teammates/ada-quill/tasks \
  -H "Authorization: Bearer dtk_…" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
  -d '{"task":"Draft an opening line for Acme Corp"}'

# Follow up on earlier work: pass the "thread" from the previous response
curl -s localhost:11001/teammates/api/v1/teammates/ada-quill/tasks \
  -H "Authorization: Bearer dtk_…" -H 'Content-Type: application/json' \
  -d '{"task":"Now cut it to three bullets","thread":"thr_…"}'
```

| Body field | |
|---|---|
| `task` (or `input`) | The work, up to 20,000 characters. Required. |
| `costCentre` | Which cost centre to bill. Defaults to the teammate's. |
| `project` | Optional tag. Only documents and memories with this project (or none) are used, and new memories get the tag. |
| `thread` | Continue a conversation. The earlier turns are sent as history and the thread's project is kept. |
| `skill` | Use this one skill instead of automatic selection. |
| `stream` | `true` for Server-Sent Events (or send `Accept: text/event-stream`). |
| `confirmCost` | Owner only: go ahead with a task estimated over the teammate's approval threshold. |

Each call goes through these steps:

1. Pick the skills relevant to the task (all of them if the teammate has four or fewer, otherwise BM25 over the skill text).
2. Find the best passages in the teammate's knowledge documents (BM25, up to ~1,500 tokens) and the memories for the project, pinned ones first.
3. Build the prompt: persona and skills (prompt-cached), then memory and the passages as reference material, then the thread's earlier turns and the task.
4. Call the teammate's model and stream the response. The teammate cites documents by title, e.g. `[Pricing policy]`.
5. Write memory: a cheaper model records up to three things worth remembering. Over the memory cap, the oldest unpinned items are merged instead of deleted.
6. Log the time as a **pending** timesheet entry. Hours are tokens ÷ `tokensPerHour`, rounded up to 6-minute increments, then multiplied by the teammate's rate. The work item records the caller, project, thread, skills, documents and memories used.

**Approval thresholds.** Before a task runs it is estimated (prompt characters ÷ 4, plus `billing.estimateOutputTokens` of output, billed like real usage). If the estimate is over the teammate's approval threshold, an API-key call gets `202 Accepted` with `{ "status": "awaiting_approval", "workId": "wk_…", "estimate": … }` (streaming calls too). The task appears under **Billing → Tasks waiting for approval**; once the owner approves it, it runs in the background under that work id. Poll `GET /api/v1/teammates/:id/tasks/:workId` with the same key for `awaiting_approval`, `declined`, `running` or `completed` (with the output). In the app, the owner sees the estimate and can approve and start straight away (`confirmCost`).

**Warnings.** When a teammate passes the warning share of their monthly cap (default 80%), or a weekly, monthly or quarterly budget does, you get one warning per period on screen, and again at 100%. Unapproved time counts towards budgets. Each warning is also sent to webhook endpoints subscribed to `cap.warning`, `cap.reached`, `budget.warning` or `budget.reached` (Settings → Webhooks), as `{ "event", "at", "data" }` signed with `X-Teammates-Signature: sha256=<HMAC of the body>`.

**Tools and handoffs.** On a profile, **Tools & handoffs** sets which tools the teammate may use and which teammates they may hand work to. Built-in tools: `fetch_url` (read public web pages) and `notify` (send a message to webhooks subscribed to `teammate.message`). The owner adds MCP servers (Streamable HTTP) under **Settings → Tools**. Tools without side effects run during the task; anything with side effects is queued under **Billing → Waiting for approval** and runs only when a manager approves it. Handing work to another teammate runs a task for them, billed to them and linked to the original. Every tool call and handoff is listed on the work item and in the **Work timeline**.

**Schedules.** On a profile, **Schedules** runs a task on chosen days at a time in the workspace time zone (Settings). Scheduled runs appear in the timeline and timesheets like any task; work over an approval threshold waits for approval.

**Webhooks.** **Settings → Webhooks** sends events (`task.completed`, `task.failed`, `approval.requested`, `action.requested`, `teammate.message`, `budget.*`, `cap.*`) to any number of endpoints, each with its own signing secret. A Phase 5 alert webhook is moved there automatically. Deliveries are queued; one that fails with a network error, a timeout, `429` or a `5xx` is retried after 10 seconds, 1 minute and 5 minutes (a `4xx` is not retried). Retries carry the same body and the same `X-Teammates-Delivery` id, plus `X-Teammates-Attempt`, so receivers can drop duplicates. Retries still waiting when the server stops are not kept.

**Month close.** Billing → Invoices → **Close a month** turns the month's approved time into an invoice (`invoices/INV-nnnn.md`, line items in the body). Pending time blocks the close unless you choose to leave it out. An open invoice can be regenerated under the same number; a paid one is final until marked unpaid. Invoices download as PDF or CSV; the CSV uses the same columns as the billing export, so the two match row for row.

Calls without a valid key (or owner session) return `401`; a key used for another teammate returns `403`; over its rate limit, `429`. Paused and off-shift teammates return `409`. A teammate that has reached their monthly cap returns `402`.

## Data layout

NooblyJS's `dataDir` for this app (`../nooblyjs-ai-host/data/teammates/`). People and sign-in sessions are NooblyJS's, not kept here.

```
data/teammates/
├── config/settings.md          # owner, budgets, cost centres, billing conversion
├── config/models.md            # Haiku / Sonnet / Opus: model ids, base rates, cost breakdown, list prices
├── skills/<skill>.md           # shared skill library (front matter + instructions)
├── teammates/<id>/
│   ├── TEAMMATE.md             # profile + config (front matter), persona prompt (body)
│   ├── knowledge/<doc>.md      # reference documents (title, optional project) used for retrieval
│   ├── memory/<mem>.md         # personal memory items (fact | preference | source, pinned, project)
│   ├── threads/<thr>.md        # conversations: the work items in each thread, in order
│   ├── timesheets/YYYY-MM.md   # monthly Markdown table of time entries (with who asked)
│   │                           # TEAMMATE.md also holds `tools` (allow-list) and `delegatesTo`
│   └── work/YYYY-MM/<wk>.md    # request, response, usage, caller and what was used for each task
├── team-memory/<mem>.md        # shared memory for teammates in "team" memory mode
├── invoices/INV-0009.md        # totals in front matter, line items (approved entries) in the body
├── approvals/<id>.md           # waiting for (or decided) approval: tasks over a threshold (wk_…), tool actions (act_…)
├── schedules/<sch>.md          # scheduled tasks: teammate, days, time, next and last run (body = the task)
├── config/webhooks.md          # webhook endpoints, their events and signing secrets
├── config/mcp-servers.md       # MCP servers teammates may be allowed to use (header values are secrets)
├── drafts/<draft>.md           # saved hire drafts
├── system/                     # api-keys.md (key hashes), session-secret.md, audit/YYYY-MM.md, alerts.md
├── uploads/                    # uploaded avatar images (PNG/JPEG/WebP)
└── logs/                       # app.YYYY-MM-DD.log (unless LOG_DIR is set; not workspace data, leave it out of git)
```

Writes are atomic (temp file, fsync, rename) and serialized per file, so the folder is safe to back up or put under git.

## Infrastructure (nooblyjs-core)

The app runs on the [nooblyjs-core](https://github.com/nooblyjs/nooblyjs-core) service registry ([`src/services/core`](src/services/core)):

| Service | Used for |
|---|---|
| Logging (`file`) | Every log line, including core's own service messages, goes to `data/teammates/logs/app.YYYY-MM-DD.log` (unless `LOG_DIR` is set). The console shows the same lines (`LOG_CONSOLE=app` limits it to the app's own messages). Credentials in logged fields are redacted. |
| Caching (`memory`) | Parsed Markdown documents. A cached copy is used while the file's modification time and size are unchanged, so files you edit by hand are picked up on the next read. Files holding secrets (`system/`, `config/webhooks.md`, `config/mcp-servers.md`) are never cached. |
| Queueing (`memory`) | Webhook deliveries and their retries. |
| Notifying (`memory`) | Live events for open browser tabs (`/api/v1/events`), on the `teammates.events` topic. |
| Scheduling (`memory`) | The schedule check, every 30 seconds, as the `teammates-schedules` task. It can be paused, resumed or run on demand from its dashboard; while it is paused, schedules don't run. |
| Measuring (`memory`) | Task counts, durations, tokens and amounts; webhook deliveries and retries; API request times. |

Each service has a dashboard and REST API under **`/services/`** (also linked from **Admin → System → Service dashboards**). They need a signed-in core `admin` (see [Sign in and roles](#sign-in-and-roles)); only `…/status` health checks are public.

**Admin → System** summarises the cache, the webhook queue, the schedule check and the metrics since the server started.

Core's memory providers keep their state in the server process, so the cache, queue, metrics, event history and the Logging dashboard's counts start empty after a restart (the log files keep everything); the workspace itself is always the Markdown files.

## API

All paths below are under the app's mount path: `/api/v1/teammates` is `/teammates/api/v1/teammates` on the site. `GET /api/v1/health` is public. Everything else except calling a teammate (and checking on a task you started) needs a person signed in with NooblyJS (`host.auth`) (viewers can read; changes need a manager; billing administration, settings, webhooks, MCP servers and people need an owner), plus the `X-CSRF-Token` header (from `GET /api/v1/session`) on changes. Every write also goes past the host's audit (`host.audit`), and refusals are audited by the host. Sessions come from signing in to NooblyJS.

| Method | Path | |
|---|---|---|
| GET / DELETE | `/api/v1/session` | Who is signed in (`authenticated`, `user`, `csrf`, `links` to core's sign-in, profile and people pages) / sign out (`{ token? }`: core's bearer token, also revoked) |
| GET | `/api/auth/check` (site root, not under the mount path) | `{ authenticated }`: served by the host (NooblyJS, or the tests' stand-in), not this app |
| GET | `/api/v1/admin/users` | People who can sign in (the host's `people`) with their access role and Teammates role |
| GET / POST / DELETE | `/api/v1/admin/keys[/:id]` | List / create `{ name, teammates: "*" \| [ids], rateLimit }` / revoke API keys |
| GET | `/api/v1/admin/audit` | Audit log (latest first) |
| GET | `/api/v1/admin/system` | nooblyjs-core status: document cache, webhook queue, schedule check, metrics |
| GET | `/api/v1/meta` | Owner, models, cost centres, skill library, projects in use, sidebar budget |
| GET / POST | `/api/v1/teammates/:id/knowledge` | Knowledge documents / add `{ title, content, project?, filename? }` (.md/.txt text) |
| GET / PATCH / DELETE | `/api/v1/teammates/:id/knowledge/:docId` | One document with its text / edit / delete |
| PATCH | `/api/v1/teammates/:id/memory/:memoryId` | Pin or unpin `{ pinned: true }` |
| GET | `/api/v1/team-memory` | Shared team memory, with who contributed each item |
| PATCH / DELETE | `/api/v1/team-memory/:memoryId` | Pin or delete a shared item |
| GET / POST | `/api/v1/teammates` | Roster with derived totals (active teammates only) / hire |
| GET / PATCH | `/api/v1/teammates/:id` | Profile view model / update config (status, model, rate, cap, memory mode…) |
| POST | `/api/v1/teammates/:id/tasks` | **Call the teammate** (JSON or SSE; `202` when waiting for approval) |
| GET | `/api/v1/teammates/:id/tasks/:workId` | Status and output of a task (API keys: only tasks they started) |
| POST | `/api/v1/teammates/:id/retire`, `/reinstate` | Retire (hidden from the roster, billing kept) or bring back |
| POST | `/api/v1/teammates/:id/persona/reset` | Reset the persona to the generated default |
| PATCH | `/api/v1/teammates/:id/skills/:skillId` | Change a skill level (`{ level: 1–3 }`) |
| GET / PATCH | `/api/v1/skills/:id` | Library skill and who uses it / edit its description and instructions |
| GET | `/api/v1/events` | Live updates (SSE): `teammate` status, `timesheet` entries, `alert` and `approval` |
| GET | `/api/v1/teammates/:id/work/:workId` | A logged work item |
| POST / DELETE | `/api/v1/teammates/:id/skills[/:skillId]` | Add or remove a skill |
| GET / DELETE | `/api/v1/teammates/:id/memory[/:memoryId]` | Review, delete or reset memory |
| POST | `/api/v1/teammates/:id/timesheet/:entryId/approve` | Approve a time entry |
| GET | `/api/v1/billing?period=week\|month\|quarter&offset=-1` | Billing view model |
| GET | `/api/v1/billing/export.csv` | Timesheet CSV for a period |
| GET | `/api/v1/billing/tokens?period&offset` | Token view: tokens, API cost, billed and margin by teammate, model and cost centre |
| GET | `/api/v1/alerts` | Caps and budgets currently over the warning share |
| GET / POST | `/api/v1/invoices/close-preview?month=YYYY-MM`, `/api/v1/invoices` | What closing a month would do / close it `{ month, excludePending? }` |
| GET / PATCH | `/api/v1/invoices/:id` | Invoice with breakdowns / mark `{ status: "paid" \| "open" }` |
| GET | `/api/v1/invoices/:id/pdf`, `/api/v1/invoices/:id/csv` | Invoice downloads |
| GET / POST | `/api/v1/approvals?status=pending`, `/api/v1/approvals/:id/approve`, `/api/v1/approvals/:id/decline` | Tasks over an approval threshold |
| GET / PATCH | `/api/v1/settings` | Budgets, cost centres, owner, time zone, billing conversion and the warning share |
| GET / POST / PATCH / DELETE | `/api/v1/webhooks[/:id]` | Webhook endpoints `{ name, url, events }` (secret returned once); `POST …/:id/test` |
| GET | `/api/v1/timeline?teammate&days` | Work timeline: tasks with callers, tools, handoffs and costs; waiting approvals; upcoming runs |
| GET / POST / PATCH / DELETE | `/api/v1/schedules[/:id]` | Scheduled tasks `{ teammateId, name, task, cadence: { days: [1–7], time: "HH:MM" }, project?, costCentre?, enabled? }`; `POST …/:id/run` runs one now |
| GET | `/api/v1/tools` | Tools a teammate can be allowed (built-ins and MCP servers) |
| GET / POST / PATCH / DELETE | `/api/v1/mcp-servers[/:id]` | MCP servers `{ id, name, url, authorization? }`; `POST …/:id/check` lists their tools |
| GET / PATCH | `/api/v1/models[/:id]` | Models: rate card and list prices (`{ reviewed: true }` records a price review) |
| POST | `/api/v1/skills`, `/api/v1/drafts`, `/api/v1/uploads` | Skill packs, hire drafts, avatar images |
