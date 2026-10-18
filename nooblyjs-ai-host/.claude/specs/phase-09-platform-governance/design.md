# Phase 9 — Platform and governance: design

> **Status: done, signed off 2026-10-10.** Summary: `docs/phases/phase-09-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Requirements: `requirements.md`. Steering: `product.md` §3, §5.7, §6; `tech.md` §6, §9; `structure.md` §2, §4.

## What changes where

| Repo | Change |
| --- | --- |
| `nooblyjs-ai-host` | `src/services/platform/` (the service: `index.js` with secrets and environments, `files.js`, `repositories.js`, `routes.js`, `budgets.js` with the ledger, `guardrails.js`, `containers.js` (the simulated runtime), `governance.js` (members, audit query)), `src/routes/platform.js` (`/api/v1/platform/…`), members and audit-log queries, `public/js/pages/platform/*.js` replacing the placeholders, seed under `src/seed/platform/`, `read-audit` and `manage-members` in `roles.yaml`, chat threads scoped to a repository pass `repo` |
| `nooblyjs-core` | `src/aiservice/common/providers/bedrock.js`, `vertex.js`, `azure.js`, `aws-sigv4.js`, `aws-eventstream.js`, `google-auth.js`; `createProvider()` knows them; `PROVIDERS` lists them; the production refusal of direct APIs |
| `nooblyjs-ai-teammate` | `runTask` takes `repo` and `signal`, calls `platform.checkAgentWork()` before `task_started`, uses the route's model and provider, reports `modelRoute`, registers the task as a workload while it runs |
| `nooblyjs-ai-factory` | Run intake asks `platform.checkAgentWork({ system: 'factory', workType: 'implementation', repo })`; runs register as workloads; `host.service('factory')` gains `cancel(runId)` and `stopAll()`; its daily cap comes from Platform when Platform is there |
| `nooblyjs-ai-product` | A refused draft keeps the refusal's code and message and shows it |
| `nooblyjs-ai-knowledge` | Import reads `platform.guardrail('redact-on-ingest')`; the source record says whether redaction was on |
| Steering | `tech.md` §6 (routing, adapters, budgets, the Platform check), §9 (`AWS_*`, `VERTEX_*`, `GOOGLE_*`, `AZURE_AI_*`); `structure.md` §2, §4 (`spend/`, `environments.yaml`, `secrets.yaml`); `product.md` §6 (the two new permissions), §12 Q3/Q4 notes; each child's `tech.md` where it calls Platform |

## The Platform check

Every agent action already goes through one door (`runTask`), and the Factory has one more (run intake). Both
ask Platform the same question before any work or cost:

```
checkAgentWork({ system, workType, repo?, teammateId?, itemId? })
  1. provider allowed?      route.provider is a direct API and NODE_ENV=production → provider_not_allowed
  2. repository allowed?    repo given and access 'none' (or the needed toggle off) → repo_no_access
  3. budget?                pauseOnLimit and (system spend ≥ limit or month total ≥ total) → budget_reached
  → { ok: true, route: { label, model, fallback, provider } | null }
```

A refusal is returned, not thrown, so each caller keeps its own refusal path: `runTask` turns it into its usual
`HttpError` and `teammate.task_refused` (the host audits it as `agent.<workType>_refused`, as for paused
teammates today). Chat, Teams and the Product Factory already show a task's refusal message; the Product Factory
now keeps the code too.

`host.service('platform')` is optional for every child: with Platform absent the check is skipped, as before.

## Files

```
data/platform/
  repositories/acme__payments-gateway.md   front matter (R2.1), body = notes
  model-routes.yaml      routes: [{ id, label, workTypes, systems, model, fallback, provider, tier }]
  budgets.yaml           { month: { total }, systems: { teammates: 9000, product: 1500, knowledge: 500,
                           factory: { daily: 20 } }, pauseOnLimit: true }
  guardrails.yaml        agents-open-prs (locked) · prod-deploy-approval · dependency-adr · redact-on-ingest ·
                         sandbox-internet; each { on, scope, overrides? }
  spend/2026-10.yaml     { days: { '2026-10-10': { product: 12.4, teammates: 3.1 } }, reached: { product: '2026-10-10' } }
  pools.yaml · base-images.yaml · environments.yaml · secrets.yaml (references only)
  integrations/<name>.yaml   only what people set; state comes from env vars
```

All writes go through `FsStore` (atomic, per-path locks). The service caches each parsed file with its mtime and
re-reads when it changes, so an edit by hand is picked up too.

**Ledger.** Platform listens to `teammate.task_finished` and the Factory's run-finished events and adds `costUsd`
to the day's total for the event's `system` (unknown systems → `teammates`). `budget.reached` is emitted once per
system per period (`reached` remembers it) and again after a budget change that puts the system at or over.
`npm run seed` writes the mockup's October totals; `rebuildLedger(month)` recomputes from `data/events/`.

## Model routing and providers

`route(workType)` returns the first route listing the work type. In `runTask`:

```
route = check.route
model = route ? catalogue[route.model] : teammate.model
provider = route ? providers.get(route.provider) : provider for teammate.model
on provider error with route.fallback → retry once on the fallback, modelRoute names what answered
```

With no model configured the mock stays the provider and `modelRoute` is `mock/<route model id>`.

**Bedrock**: `POST https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/invoke-model-with-response-stream`,
body = the Anthropic request with `anthropic_version: 'bedrock-2023-05-31'` (no `model`, no `stream`). SigV4 with
`node:crypto` (HMAC-SHA256, the canonical request, the credential scope). The reply is AWS event-stream frames
(prelude, headers, payload, CRCs); each `chunk` payload's base64 `bytes` is an Anthropic SSE event, handed to the
same event mapping as `anthropic.js`. Credentials: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_SESSION_TOKEN`, `AWS_REGION`.

**Vertex AI**: `POST https://<region>-aiplatform.googleapis.com/v1/projects/<project>/locations/<region>/publishers/anthropic/models/<model>:streamRawPredict`,
body with `anthropic_version: 'vertex-2023-10-16'`. The reply is Anthropic SSE. The token is `GOOGLE_ACCESS_TOKEN`,
or one minted from the service-account key in `GOOGLE_APPLICATION_CREDENTIALS` (an RS256 JWT for the token
endpoint, cached until a minute before expiry). `VERTEX_PROJECT_ID`, `VERTEX_REGION`.

**Azure**: Azure AI Foundry's Anthropic-compatible Messages endpoint, `AZURE_AI_ENDPOINT` + `AZURE_AI_API_KEY`;
the reply is Anthropic SSE, so it reuses `anthropic.js` with a different base URL and auth header `[CONFIRM the
endpoint shape when a resource exists]`.

Model ids per provider come from the catalogue (`models.js` gains `bedrockId`, `vertexId`, `azureId` per Claude
model), so a route names `claude-sonnet-5-5` and the adapter maps it. All three use `withRetry` and the existing
error classes.

## Containers

```
ContainerRuntime
  pools()       [{ id, name, slots, used, queued, note, full }]
  workloads()   [{ id, kind: factory|teammate|preview|indexer, title, repo, image, cpu, memGb, startedAt,
                   sample, stop() }]
  logs(id) · stop(id, by, reason) · stopAll(by, reason) · usage() { running, queued, failed, vcpu, memGb }
```

The simulated runtime keeps workloads in memory. Teammates registers a running task
(`platform.containers.register({ kind: 'teammate', …, stop: () => abort.abort() })`) and removes it when it ends;
the Factory does the same for a running run with `stop: () => factory.cancel(runId)`. Seed sample workloads come
from `pools.yaml` (`sample: true`, shown as "Sample") and are stopped by removing them. **Stop all** calls every
workload's `stop()` and `factory.stopAll()`, so nothing new starts until the Factory is resumed from its own
screen. Logs are the task's or run's log lines (Factory: its run log; teammate: started/finished lines).

## API

```
GET  /api/v1/platform/status                    cluster words, running, queued, vCPU (the status card)
GET  /api/v1/platform/repositories              ?filter=all|factory|read-only|not-indexed, with counts
GET  /api/v1/platform/repositories/:id          POST (connect) · PATCH (access, toggles, build)   change-repo-access
GET  /api/v1/platform/containers                tiles, pools, workloads, images
GET  /api/v1/platform/containers/:id/logs       POST /:id/stop · POST /stop-all                     change-guardrails
GET  /api/v1/platform/settings                  routes (with 30-day spend), budgets (with spend), guardrails, integrations, organisation
PATCH /api/v1/platform/settings/routes/:id      change-guardrails
PATCH /api/v1/platform/settings/budgets         set-budgets
PATCH /api/v1/platform/settings/guardrails/:key change-guardrails, { on, reason } (reason required)
GET  /api/v1/platform/guardrails/history
GET  /api/v1/platform/environments · /secrets   POST/DELETE /secrets                                change-repo-access
GET  /api/v1/platform/members                   PATCH /members/:id { accessRole, reason }           manage-members
GET  /api/v1/platform/audit                     ?actor&action&from&to&cursor                       read-audit
```

Every write passes `requireRole(permission)` and refuses an agent actor outright (R8.1). Bodies are validated
(work types and ids by pattern, numbers ≥ 0, reasons 3–500 characters).

## Screens

`public/js/pages/platform/` with the kit's components, one file per screen (structure.md §3.2). Settings keeps
edits in the page until **Save changes**, which sends one request per changed section and says what was saved.
Guardrail switches open a small dialog for the reason. Repository detail is a side panel on wide screens and its
own page at phone width. The chat dock on a repository page is scoped to that repository, so a question to a
teammate there carries `repo` (test step 1).

## Tests

- `noobly/test/services/platform/*.test.js`: check order and refusals, mtime reload, ledger and `budget.reached`
  once per period, guardrail reason and lock, secrets refusal, last-Owner rule, audit query = the files.
- `noobly/test/platform.test.js`: the six test-script steps through the real apps (Teammates, Product Factory,
  Factory, wiki), offline.
- `nooblyjs-core`: SigV4 against AWS's published test vector, event-stream decoding with CRCs, the Vertex JWT, each
  adapter against a fake `fetch`, the production refusal. `test:live` per provider, skipped without credentials.
- `nooblyjs-ai-teammate`: `runTask` refused by Platform before `task_started`; route model used; workload registered
  and stopped by abort.
- `nooblyjs-ai-factory`: intake refused on `openPrs: false`; `cancel` and `stopAll` through the service.
- `noobly/test/e2e/platform.story.js` (Playwright + axe, phone width): the six steps in the browser.
