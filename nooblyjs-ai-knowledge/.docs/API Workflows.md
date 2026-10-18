# Workflow API

Programmatic, integration-friendly endpoints for **triggering workflows by name**, **polling their execution status**, listing available workflows, and scheduling recurring runs.

These are backed by the `WorkflowBridge` service and registered by `src/datasources/routes/workflowApiRoutes.js` (start/status/schedule) and `workflowdashboard.js` (list).

---

## Base URL & authentication

| | |
|---|---|
| **Base URL** | `http://localhost:11001` (or `https://…` when `HTTPS_ENABLED=true`) |
| **Content-Type** | `application/json` |
| **Auth** | Session cookie **or** `Authorization: Bearer <token>` |

All `/api/*` routes accept a logged-in **session cookie** or a **Bearer token** (used by programmatic clients — daemon, extensions, CI). Obtain a token (valid 24h):

```bash
curl -X POST http://localhost:11001/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{ "email": "you@example.com", "password": "••••••" }'
# → { "token": "<bearer-token>" }
```

Then send it on every call:

```
Authorization: Bearer <bearer-token>
```

**Rate limits** (per 15 min window): anonymous 100, authenticated 500, admin 2000.

---

## Quick start: run a workflow and poll for completion

```bash
TOKEN="<bearer-token>"
BASE="http://localhost:11001"

# 1. Start the workflow by name → returns an executionId
EXEC=$(curl -s -X POST "$BASE/api/workflows/start" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "workflowName": "design-solution", "payload": { "model": "1234" } }' \
  | jq -r '.executionId')

# 2. Poll status until it is no longer "running"
while :; do
  RES=$(curl -s "$BASE/api/workflows/executions/$EXEC/status" -H "Authorization: Bearer $TOKEN")
  echo "$RES" | jq -c '{status,outcome}'
  [ "$(echo "$RES" | jq -r '.status')" = "running" ] || break
  sleep 2
done
```

Execution is **asynchronous**: `start` returns immediately with an `executionId`; the workflow runs in the background and you poll the status endpoint for progress. A 2–5s poll interval is recommended.

---

## Endpoints

### 1. Start a workflow

`POST /api/workflows/start`

Starts a workflow by name (or id) in the background.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `workflowName` | string | yes | Name (or id) of the workflow to run |
| `payload` | object | no | JSON object passed as input to the workflow |

```json
{
  "workflowName": "design-solution",
  "payload": { "model": "1234", "ignoreCache": false }
}
```

**Response — `202 Accepted`**

```json
{
  "success": true,
  "message": "Workflow execution started",
  "executionId": "exec_a1b2c3…",
  "workflowId": "wf_…",
  "workflowName": "design-solution",
  "status": "running",
  "startedAt": "2026-05-30T20:40:00.000Z",
  "timestamp": "2026-05-30T20:40:00.001Z"
}
```

Keep the `executionId` — it's how you poll status.

**Errors**

| Status | When |
|---|---|
| `400` | `workflowName` missing/empty, or `payload` is not a JSON object |
| `404` | No workflow matches that name/id |
| `500` | Bridge not initialized or internal error |

---

### 2. Get execution status

`GET /api/workflows/executions/:executionId/status`

Polls the status of a single execution.

**Response — `200 OK`**

```json
{
  "success": true,
  "executionId": "exec_a1b2c3…",
  "workflowId": "wf_…",
  "workflowName": "design-solution",
  "status": "completed",
  "outcome": "success",
  "startedAt": "2026-05-30T20:40:00.000Z",
  "completedAt": "2026-05-30T20:41:12.000Z",
  "duration": 72000,
  "error": null,
  "result": { "…": "workflow output, if any" },
  "timestamp": "2026-05-30T20:41:15.000Z"
}
```

| Field | Values | Meaning |
|---|---|---|
| `status` | `running` \| `completed` \| `failed` | Lifecycle state |
| `outcome` | `success` \| `failed` \| `null` | Final result; `null` while still `running` |
| `duration` | number (ms) | Wall-clock run time once finished |
| `error` | string \| null | Failure message when `status` is `failed` |
| `result` | object \| null | Workflow output payload, if the workflow returns one |

**Errors**

| Status | When |
|---|---|
| `404` | No execution with that id |
| `500` | Internal error |

---

### 3. List workflows

`GET /api/workflows/list`

Lists available workflows (use this to discover valid `workflowName` values). Cached for 5 minutes.

**Query parameters** (all optional)

| Param | Type | Description |
|---|---|---|
| `starred` | `true` | Only starred workflows |
| `tags` | string | Comma-separated tag filter, e.g. `tags=design,nightly` |
| `status` | string | Filter by status |
| `limit` | number | Page size |
| `offset` | number | Page offset |

**Response — `200 OK`**

```json
{
  "success": true,
  "data": [
    {
      "id": "wf_…",
      "name": "design-solution",
      "description": "…",
      "tags": ["design"],
      "status": "active"
    }
  ],
  "timestamp": "2026-05-30T20:40:00.000Z"
}
```

`status` here reflects the workflow's **schedule** state: `"active"` (has an enabled schedule), `"inactive"` (only disabled schedules), or `null` (no schedule).

---

### 4. Schedule a workflow (recurring)

`POST /api/workflows/schedule`

Registers a workflow to run on a cron schedule.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `workflowName` | string | yes | Name (or id) of the workflow |
| `cron` | string | yes | Cron expression, e.g. `0 9 * * *` (daily 09:00) |
| `payload` | object | no | Input passed on each run |
| `name` | string | no | Schedule name (auto-generated if omitted) |

**Response — `201 Created`**

```json
{
  "success": true,
  "message": "Workflow scheduled",
  "scheduleId": "sch_…",
  "workflowId": "wf_…",
  "scheduleName": "design-solution-nightly",
  "cron": "0 9 * * *",
  "nextRun": "2026-05-31T09:00:00.000Z",
  "enabled": true,
  "timestamp": "2026-05-30T20:40:00.000Z"
}
```

**Errors**

| Status | When |
|---|---|
| `400` | `workflowName` or `cron` missing/empty, or `payload` not a JSON object |
| `404` | No workflow matches that name/id |
| `500` | Internal error |

---

## Notes

- **Asynchronous by design:** `start` never blocks; always poll `…/status` with the returned `executionId`.
- **Names vs ids:** `workflowName` accepts the workflow's display name or its id. Use `GET /api/workflows/list` to find valid names.
- **Idempotency:** each `start` creates a new execution with a fresh `executionId`; there is no built-in de-duplication.
- **Errors** follow a consistent shape: `{ "success": false, "error": "<message>" }`.
