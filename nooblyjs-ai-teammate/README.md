# nooblyjs-digital-teammate

**Teammates** is a people-management app for AI agents. Each digital teammate has a name, an avatar, a job title, skills, memory, a Claude model, an hourly rate and a timesheet. Every teammate is also an **HTTP endpoint** you can call with work.

- Node.js + Express backend, plain HTML/CSS/JavaScript front end (no build step)
- All data is stored as **Markdown files in folders**. There is no database.
- Specs: [`.claude/specs`](.claude/specs) (PRD, architecture, roadmap, UI design brief)

## Run it

```bash
git clone https://github.com/nooblyjs/nooblyjs-ai-common.git ../nooblyjs-ai-common   # shared model catalogue and pricing, linked as a file: dependency
npm install
npm start            # http://127.0.0.1:3000
npm test             # node:test suite (offline, mock provider)
npm run smoke:live   # one real task each on Haiku, Sonnet and Opus (needs ANTHROPIC_API_KEY; costs a few cents)
```

On first start, the app seeds `./data` with the eight teammates, skills, timesheets and invoices from the design mockups.

Without Anthropic credentials, teammates run on an **offline mock provider**. To make them do real work, set an API key:

```bash
cp .env.example .env   # then set ANTHROPIC_API_KEY=...
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Where to listen |
| `DATA_DIR` | `./data` | Root of the Markdown workspace |
| `ANTHROPIC_API_KEY` | (none) | Enables real Claude calls |
| `ANTHROPIC_AUTH_TOKEN` | (none) | A bearer token instead of an API key |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Send Claude calls through a gateway |
| `AI_PROVIDER` | (auto) | `mock` forces offline mode. `anthropic` insists on real calls and stops at startup without a key or token. |
| `OWNER_PASSWORD` | (none) | Sets the owner password on first start (only if none is set yet). Without it, see "Sign in" below. |
| `SESSION_SECRET` | (generated) | Signs session cookies. If unset, a secret is generated and kept in `data/system/session-secret.md`. |
| `COOKIE_SECURE` | `false` | `true` adds `Secure` to the session cookie (use behind HTTPS). |
| `TRUST_PROXY` | (none) | Express `trust proxy` setting when running behind a reverse proxy. |
| `ALLOW_PRIVATE_FETCH` | `false` | `true` lets the `fetch_url` tool reach private and local addresses (for intranet pages). Off by default. |

## Sign in and roles

People sign in with a username and password. There are three roles: **Owner** (everything, including billing, settings and people), **Manager** (assign and approve work, edit teammates, their tools and schedules) and **Viewer** (read-only). Owners add people under **Admin → People**; each new person gets a temporary password, shown once, and chooses their own when they first sign in (from their name in the sidebar).

The first account is the owner. On the first start the server prints a one-time **setup code** in the terminal:

```
[auth] First run: open the app and enter setup code ZEQB-GA28 to choose the owner password.
```

Open the app, enter the code and choose a password (at least 10 characters). After that, sign in with the owner's username (the owner id in `config/settings.md`, `stevie` in the seed) or leave the username empty, and the password. Alternatively set `OWNER_PASSWORD` in `.env` before the first start.

**Admin** (in the sidebar) is where you create and revoke API keys, change the password, sign out every browser, and read the audit log (`data/system/audit/YYYY-MM.md`).

## Call a teammate

Other systems call teammates with an **API key**. Create one under Admin: it is shown once, stored only as a hash, limited to the teammates you choose and to a number of calls per minute. Keys can only call teammates; they cannot read billing or memory. Every timesheet entry and work item records who made the call.

```bash
# JSON response
curl -s localhost:3000/api/teammates/ada-quill/tasks \
  -H "Authorization: Bearer dtk_…" -H 'Content-Type: application/json' \
  -d '{"task":"Summarise the three biggest risks in our Q4 competitor scan","costCentre":"Growth","project":"acme"}'

# Streamed (Server-Sent Events: start, delta, memory, done | error)
curl -N localhost:3000/api/teammates/ada-quill/tasks \
  -H "Authorization: Bearer dtk_…" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
  -d '{"task":"Draft an opening line for Acme Corp"}'

# Follow up on earlier work: pass the "thread" from the previous response
curl -s localhost:3000/api/teammates/ada-quill/tasks \
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

**Approval thresholds.** Before a task runs it is estimated (prompt characters ÷ 4, plus `billing.estimateOutputTokens` of output, billed like real usage). If the estimate is over the teammate's approval threshold, an API-key call gets `202 Accepted` with `{ "status": "awaiting_approval", "workId": "wk_…", "estimate": … }` (streaming calls too). The task appears under **Billing → Tasks waiting for approval**; once the owner approves it, it runs in the background under that work id. Poll `GET /api/teammates/:id/tasks/:workId` with the same key for `awaiting_approval`, `declined`, `running` or `completed` (with the output). In the app, the owner sees the estimate and can approve and start straight away (`confirmCost`).

**Warnings.** When a teammate passes the warning share of their monthly cap (default 80%), or a weekly, monthly or quarterly budget does, you get one warning per period on screen, and again at 100%. Unapproved time counts towards budgets. Each warning is also sent to webhook endpoints subscribed to `cap.warning`, `cap.reached`, `budget.warning` or `budget.reached` (Settings → Webhooks), as `{ "event", "at", "data" }` signed with `X-Teammates-Signature: sha256=<HMAC of the body>`.

**Tools and handoffs.** On a profile, **Tools & handoffs** sets which tools the teammate may use and which teammates they may hand work to. Built-in tools: `fetch_url` (read public web pages) and `notify` (send a message to webhooks subscribed to `teammate.message`). The owner adds MCP servers (Streamable HTTP) under **Settings → Tools**. Tools without side effects run during the task; anything with side effects is queued under **Billing → Waiting for approval** and runs only when a manager approves it. Handing work to another teammate runs a task for them, billed to them and linked to the original. Every tool call and handoff is listed on the work item and in the **Work timeline**.

**Schedules.** On a profile, **Schedules** runs a task on chosen days at a time in the workspace time zone (Settings). Scheduled runs appear in the timeline and timesheets like any task; work over an approval threshold waits for approval.

**Webhooks.** **Settings → Webhooks** sends events (`task.completed`, `task.failed`, `approval.requested`, `action.requested`, `teammate.message`, `budget.*`, `cap.*`) to any number of endpoints, each with its own signing secret. A Phase 5 alert webhook is moved there automatically.

**Month close.** Billing → Invoices → **Close a month** turns the month's approved time into an invoice (`invoices/INV-nnnn.md`, line items in the body). Pending time blocks the close unless you choose to leave it out. An open invoice can be regenerated under the same number; a paid one is final until marked unpaid. Invoices download as PDF or CSV; the CSV uses the same columns as the billing export, so the two match row for row.

Calls without a valid key (or owner session) return `401`; a key used for another teammate returns `403`; over its rate limit, `429`. Paused and off-shift teammates return `409`. A teammate that has reached their monthly cap returns `402`.

## Data layout

```
data/
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
├── system/                     # users.md (people, roles, password hashes), api-keys.md (key hashes), audit/YYYY-MM.md, alerts.md
└── uploads/                    # uploaded avatar images (PNG/JPEG/WebP)
```

Writes are atomic (temp file, fsync, rename) and serialized per file, so the folder is safe to back up or put under git.

## API

Everything except calling a teammate (and checking on a task you started) needs a signed-in session cookie (viewers can read; changes need a manager; billing administration, settings, webhooks, MCP servers and people need an owner), plus the `X-CSRF-Token` header (from `GET /api/session` or the sign-in response) on changes.

| Method | Path | |
|---|---|---|
| GET / POST / DELETE | `/api/session` | Session state (`authenticated`, `setupRequired`, `csrf`) / sign in `{ password }` / sign out |
| POST | `/api/session/setup` | First run: `{ code, password }` |
| GET / POST / PATCH | `/api/admin/users[/:id]` | People: list / add `{ username, name, role }` (returns a temporary password once) / change `{ name, role, disabled }` |
| POST | `/api/admin/users/:id/reset-password`, `/api/session/password` | New temporary password for someone / change your own `{ current, next }` |
| GET / POST / DELETE | `/api/admin/keys[/:id]` | List / create `{ name, teammates: "*" \| [ids], rateLimit }` / revoke API keys |
| GET | `/api/admin/audit` | Audit log (latest first) |
| POST | `/api/admin/password`, `/api/admin/sign-out-everywhere` | Change the password / end every session |
| GET | `/api/meta` | Owner, models, cost centres, skill library, projects in use, sidebar budget |
| GET / POST | `/api/teammates/:id/knowledge` | Knowledge documents / add `{ title, content, project?, filename? }` (.md/.txt text) |
| GET / PATCH / DELETE | `/api/teammates/:id/knowledge/:docId` | One document with its text / edit / delete |
| PATCH | `/api/teammates/:id/memory/:memoryId` | Pin or unpin `{ pinned: true }` |
| GET | `/api/team-memory` | Shared team memory, with who contributed each item |
| PATCH / DELETE | `/api/team-memory/:memoryId` | Pin or delete a shared item |
| GET / POST | `/api/teammates` | Roster with derived totals (active teammates only) / hire |
| GET / PATCH | `/api/teammates/:id` | Profile view model / update config (status, model, rate, cap, memory mode…) |
| POST | `/api/teammates/:id/tasks` | **Call the teammate** (JSON or SSE; `202` when waiting for approval) |
| GET | `/api/teammates/:id/tasks/:workId` | Status and output of a task (API keys: only tasks they started) |
| POST | `/api/teammates/:id/retire`, `/reinstate` | Retire (hidden from the roster, billing kept) or bring back |
| POST | `/api/teammates/:id/persona/reset` | Reset the persona to the generated default |
| PATCH | `/api/teammates/:id/skills/:skillId` | Change a skill level (`{ level: 1–3 }`) |
| GET / PATCH | `/api/skills/:id` | Library skill and who uses it / edit its description and instructions |
| GET | `/api/events` | Live updates (SSE): `teammate` status, `timesheet` entries, `alert` and `approval` |
| GET | `/api/teammates/:id/work/:workId` | A logged work item |
| POST / DELETE | `/api/teammates/:id/skills[/:skillId]` | Add or remove a skill |
| GET / DELETE | `/api/teammates/:id/memory[/:memoryId]` | Review, delete or reset memory |
| POST | `/api/teammates/:id/timesheet/:entryId/approve` | Approve a time entry |
| GET | `/api/billing?period=week\|month\|quarter&offset=-1` | Billing view model |
| GET | `/api/billing/export.csv` | Timesheet CSV for a period |
| GET | `/api/billing/tokens?period&offset` | Token view: tokens, API cost, billed and margin by teammate, model and cost centre |
| GET | `/api/alerts` | Caps and budgets currently over the warning share |
| GET / POST | `/api/invoices/close-preview?month=YYYY-MM`, `/api/invoices` | What closing a month would do / close it `{ month, excludePending? }` |
| GET / PATCH | `/api/invoices/:id` | Invoice with breakdowns / mark `{ status: "paid" \| "open" }` |
| GET | `/api/invoices/:id/pdf`, `/api/invoices/:id/csv` | Invoice downloads |
| GET / POST | `/api/approvals?status=pending`, `/api/approvals/:id/approve`, `/api/approvals/:id/decline` | Tasks over an approval threshold |
| GET / PATCH | `/api/settings` | Budgets, cost centres, owner, time zone, billing conversion and the warning share |
| GET / POST / PATCH / DELETE | `/api/webhooks[/:id]` | Webhook endpoints `{ name, url, events }` (secret returned once); `POST …/:id/test` |
| GET | `/api/timeline?teammate&days` | Work timeline: tasks with callers, tools, handoffs and costs; waiting approvals; upcoming runs |
| GET / POST / PATCH / DELETE | `/api/schedules[/:id]` | Scheduled tasks `{ teammateId, name, task, cadence: { days: [1–7], time: "HH:MM" }, project?, costCentre?, enabled? }`; `POST …/:id/run` runs one now |
| GET | `/api/tools` | Tools a teammate can be allowed (built-ins and MCP servers) |
| GET / POST / PATCH / DELETE | `/api/mcp-servers[/:id]` | MCP servers `{ id, name, url, authorization? }`; `POST …/:id/check` lists their tools |
| GET / PATCH | `/api/models[/:id]` | Models: rate card and list prices (`{ reviewed: true }` records a price review) |
| POST | `/api/skills`, `/api/drafts`, `/api/uploads` | Skill packs, hire drafts, avatar images |
