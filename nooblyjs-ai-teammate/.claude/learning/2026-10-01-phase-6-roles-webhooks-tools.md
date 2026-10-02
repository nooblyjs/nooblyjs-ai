# Phase 6 (in progress): Roles, Multi-Endpoint Webhooks & Teammate Tools

> Scope: uncommitted working tree on `main` after `8cc32a9 Phase 5: billing complete`.

## 1. Executive Summary

The app has moved from a single owner to **multiple signed-in people with roles** (viewer / manager / owner), so a business can let staff watch or run work without giving them billing or admin control. Teammates can now **act in the world**: read web pages, call tools on MCP servers and message the team through webhooks. Every action with side effects waits for a person to approve it, and every event can go to many signed webhook endpoints.

## 2. System Topology

**Identity & access**
- `src/services/auth.js`: users move from `system/owner.md` into `system/users.md`, and the old owner is migrated on start. Adds `ROLES`, `atLeast()`, create/update/reset-password for users, and a guard against removing the last active owner. Sessions now carry `uid`. Changing someone's role or disabling them increments their `sessionVersion`, which signs them out.
- `src/middleware/auth.js`: `req.actor` now holds the real user (`id`, `role`, `username`). New `requireRole(role)` and `requireUserWithRole(role)` guards.
- `src/routes/session.js`: login takes a username, falling back to the owner when none is given (Phase 3 behaviour). Adds `POST /api/session/password` so any user can change their own password.
- `src/routes/admin.js`: `/api/admin/users` CRUD. The whole router is mounted behind `requireUserWithRole('owner')` in `app.js`.
- `src/routes/api.js`: viewers can use any `GET`. Any change needs at least the **manager** role.
- `src/routes/billing.js`: invoices, settings, models and webhooks need **owner**. Approvals need **manager**.

**Eventing**
- `src/services/webhooks.js` (new): `WebhookService` keeps a list of endpoints in `config/webhooks.md`. Each endpoint has its own `whsec_` secret (shown once), subscribes to events from `WEBHOOK_EVENTS`, sends HMAC-signed POSTs and records its own `lastDelivery`. `init()` migrates the Phase 5 single `alerts.webhookUrl`.
- `src/services/alerts.js`: no longer does HTTP itself. It calls `webhooks.emit(...)`.
- `src/services/billing.js`: webhook settings removed, `timezone` (an IANA zone) added.

**Teammate tools (the agent loop)**
- `src/services/mcp.js` (new): a small client for the MCP Streamable HTTP transport, written without the MCP SDK. It handles `initialize`, `tools/list` (paged) and `tools/call`, and accepts replies as JSON or SSE.
- `src/services/tools.js` (new): `ToolService` provides the built-in tools (`fetch_url`, `notify`) and MCP servers added by the owner. Each teammate has an allow-list. Tool lists are cached for 60 s. `fetch_url` has an SSRF guard: it resolves DNS, blocks private ranges, re-checks every redirect hop and caps responses at 300 KB.
- `src/services/invocation.js`: `runWithTools()` runs the model and tools in a loop, capped at `MAX_TOOL_ROUNDS`. `delegate` is a tool that runs another teammate. Tools with side effects are replaced by `queueAction()`, so they wait for approval. Emits `task.completed`, `task.failed` and `approval.requested`.
- `src/providers/anthropic.js`: passes `tools` through and returns the full `content` (thinking blocks included, needed for the next round) plus `toolCalls`.
- `src/providers/mock.js`: picks tool calls by fixed rules so the loop can be tested offline.

**How it fits together**
```
request → identify (users.md) → requireRole → InvocationService.runWithTools
            ├─ read-only tool  → ToolService / McpClient → result back to model
            ├─ side-effect tool → queueAction → approval (manager) → ToolService.runAction
            └─ lifecycle events → WebhookService.emit → N signed endpoints
AlertService ─────────────────────────────────────────→ WebhookService.emit
```

> ⚠️ **Wiring gap to know about:** `app.js` creates `WebhookService` but doesn't yet create `ToolService`, and it doesn't pass `tools` or `webhooks` to `new InvocationService(...)`. Until it does, `this.tools` and `this.webhooks` are `null` in the invocation service. That means only `delegate` is offered to the model, and `task.*` and `approval.requested` webhooks are dropped without any error. Alert webhooks do work, because `AlertService` receives `webhooks`.

## 3. The Trade-Off

**Side effects are decided per tool and default to "needs approval"; there is no per-call risk check.** An MCP tool only runs straight away if its server marks it with `annotations.readOnlyHint`. Every other MCP tool, and `notify`, is queued for a manager to approve.

- *Gained:* safety by default. A teammate can't write to an outside system without a person seeing the exact input first, and the server doesn't have to be trusted to describe its tools correctly in order to stay safe.
- *Given up:* speed and autonomy. Harmless calls on servers that don't add annotations still wait in the approval queue. Results from approved actions come back after the task has finished, so the model never sees them in the same run (which is why the `notify` description tells it "you will not see a reply").

A smaller trade-off sits alongside it: writing a custom MCP client in about 80 lines (no SDK dependency, easy to audit) means only `tools` is supported. Resources, prompts, sampling and server-initiated streams over a long-lived SSE `GET` are not.

## 4. Active Recall

A manager approves a queued `mcp__crm__create_contact` action. By then the owner has **disabled that MCP server** and **removed `mcp:crm` from the teammate's allow-list**. Follow the call through `ToolService.runAction` → `runMcp`. Does the action still run? Which check stops it, if any? And what should the approval's outcome look like to the manager who clicked "Approve"?
