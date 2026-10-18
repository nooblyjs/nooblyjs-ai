# Datasources Module - Workflow Automation

The Datasources module provides workflow automation and orchestration capabilities, enabling teams to design and execute multi-step data pipelines with various step types, scheduling, and real-time monitoring.

## Module Overview

**Purpose:** Workflow automation and orchestration  
**Port:** 9101 (when running unified backend)  
**Entry Point:** `src/datasources/initialize.js`  
**Primary Routes:** `/api/workflows/`, `/api/connections/`, `/api/spaces/`, `/api/agents/`

## Core Components

### WorkflowManager
Manages workflow CRUD operations and persistence. Handles creation, retrieval, updating, and deletion of workflow definitions.

```javascript
const workflowManager = new WorkflowManager();
const workflow = await workflowManager.getWorkflow(workflowId);
```

### WorkflowExecutor
Executes individual workflow steps and manages the execution flow. Supports multiple step types:
- `api` - HTTP requests to external services
- `transform` - Data transformation and manipulation
- `conditional` - Branching logic
- `parallel` - Concurrent step execution
- `delay` - Timed delays

### WorkflowScheduler
Manages scheduled workflow execution using cron expressions. Executes workflows on a recurring schedule.

```javascript
const schedule = '0 2 * * *'; // 2 AM daily
await scheduler.schedule(workflowId, schedule);
```

> Live schedules are owned by `WorkflowBridge` (`lib/workflowBridge.js`), which
> registers them with the core scheduling service. `components/workflowScheduler.js`
> is not wired into the running backend.

#### Missed runs

Cron firing is edge-triggered — a workflow runs only if the backend is alive
during the exact minute its expression matches. A restart, deploy or event-loop
stall over that minute used to lose the run outright and freeze `nextRun` in the
past, which is how a nightly schedule could sit "enabled" for weeks without
running.

`WorkflowBridge.reconcileSchedules()` runs at startup and every minute after. It
recomputes any `nextRun` that is missing or already past, and replays a fire that
was missed — once, however many were missed, and never while a run for that
schedule is still in flight. The new `nextRun` is persisted before the catch-up
run is dispatched, so a restart loop cannot replay the same fire repeatedly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCHEDULE_CATCHUP` | on | Set to `off` to keep the `nextRun` repair but skip replaying missed runs. |
| `SCHEDULE_CATCHUP_GRACE_MS` | `120000` | How far past `nextRun` counts as a missed fire. |
| `SCHEDULE_CATCHUP_STAGGER_MS` | `20000` | Gap between catch-up runs dispatched in the same pass. |
| `SCHEDULER_JOB_TIMEOUT_MS` | `14400000` | Wall-clock budget for a single scheduled run, 4h (default set in `app.js`). Expiry marks the execution failed but does **not** kill the worker thread — it is a false-failure guard, not a cap. |

### SpaceManager
Manages workspaces and RBAC (Role-Based Access Control). Organizes workflows and connections into logical spaces with granular permissions.

### WorkflowBridge
Provides backward compatibility with legacy workflows and integrations.

## API Endpoints

### Workflows

```
GET    /api/workflows/              List all workflows
POST   /api/workflows/              Create new workflow
GET    /api/workflows/:id           Get workflow details
PUT    /api/workflows/:id           Update workflow
DELETE /api/workflows/:id           Delete workflow
POST   /api/workflows/:id/execute   Execute workflow
GET    /api/workflows/:id/export    Export workflow
POST   /api/workflows/import        Import workflow
```

### Workflow Search & Discovery

```
GET    /api/workflows/search        Search workflows
GET    /api/workflows/starred       Get starred workflows
GET    /api/workflows/recent        Get recent workflows
POST   /api/workflows/:id/star      Star workflow
POST   /api/workflows/:id/view      Record view
DELETE /api/workflows/:id/recent    Remove from recent
GET    /api/workflows/dashboard     Workflow dashboard
```

### Workflow Templates

```
GET    /api/workflows/templates     List workflow templates
```

### Connections (Data Sources)

```
GET    /api/connections/            List connections
POST   /api/connections/            Create connection
GET    /api/connections/:id         Get connection details
PUT    /api/connections/:id         Update connection
DELETE /api/connections/:id         Delete connection
POST   /api/connections/:id/browse  Browse connection
```

### Spaces (RBAC)

```
GET    /api/spaces/                 List spaces
POST   /api/spaces/                 Create space
GET    /api/spaces/:id              Get space details
PUT    /api/spaces/:id              Update space
DELETE /api/spaces/:id              Delete space
POST   /api/spaces/:id/archive      Archive space
POST   /api/spaces/:id/restore      Restore space
POST   /api/spaces/:id/users/:userId Add user to space
DELETE /api/spaces/:id/users/:userId Remove user from space
```

### Agents (AI Agents)

```
GET    /api/agents/                 List agents
POST   /api/agents/                 Create agent
GET    /api/agents/:id              Get agent details
PUT    /api/agents/:id              Update agent
DELETE /api/agents/:id              Delete agent
```

### Settings

```
GET    /api/settings/               Get application settings
PUT    /api/settings/               Update settings
```

## Workflow Structure

### Basic Workflow

```json
{
  "name": "Data Pipeline",
  "description": "Extract, transform, and load data",
  "steps": [
    {
      "id": "extract",
      "type": "api",
      "config": {
        "url": "https://api.example.com/data",
        "method": "GET",
        "headers": { "Authorization": "Bearer token" }
      }
    },
    {
      "id": "transform",
      "type": "transform",
      "config": {
        "code": "return input.map(item => ({ ...item, processed: true }));"
      }
    },
    {
      "id": "load",
      "type": "api",
      "config": {
        "url": "https://api.example.com/store",
        "method": "POST"
      }
    }
  ]
}
```

### Step Types

#### API Step
Makes HTTP requests to external services.

```json
{
  "type": "api",
  "config": {
    "url": "https://api.example.com/endpoint",
    "method": "GET|POST|PUT|DELETE|PATCH",
    "headers": { "key": "value" },
    "body": { "data": "value" },
    "timeout": 30000
  }
}
```

#### Transform Step
Transforms data using JavaScript code.

```json
{
  "type": "transform",
  "config": {
    "code": "return input.map(x => ({ ...x, status: 'active' }));"
  }
}
```

#### Conditional Step
Branches execution based on conditions.

```json
{
  "type": "conditional",
  "condition": "input.length > 0",
  "onTrue": { "nextStep": "process" },
  "onFalse": { "nextStep": "notify" }
}
```

#### Parallel Step
Executes multiple steps concurrently.

```json
{
  "type": "parallel",
  "steps": [
    { "id": "fetch1", "type": "api", "config": {} },
    { "id": "fetch2", "type": "api", "config": {} }
  ]
}
```

#### Delay Step
Pauses execution for a specified duration.

```json
{
  "type": "delay",
  "config": {
    "duration": 5000  // milliseconds
  }
}
```

## Configuration

### Connection Types Supported

- **HTTP/REST APIs** - Generic HTTP endpoints
- **FTP** - File Transfer Protocol servers
- **S3** - Amazon S3 buckets
- **Git** - Git repositories
- **Databases** - SQL databases (PostgreSQL, MySQL, etc.)
- **Local Filesystem** - Local file operations

### Space Types

| Type | Purpose |
|------|---------|
| `project` | Project-specific workflows |
| `team` | Team collaboration |
| `workflow` | Workflow templates |
| `archive` | Archived workflows |
| `documentation` | Workflow documentation |
| `temporary` | Temporary storage |

## RBAC Permissions

### Roles

- **admin** - Full permissions: read, write, delete, manage
- **editor** - Create/modify workflows: read, write
- **viewer** - Read-only access: read

### Space Permissions

```javascript
{
  "permissions": {
    "admin": ["read", "write", "delete", "manage"],
    "editor": ["read", "write"],
    "viewer": ["read"]
  },
  "allowedUsers": ["user@example.com"]
}
```

## Real-Time Events

Workflows emit real-time events via Socket.IO:

```javascript
socket.on('workflow:start', (event) => {
  // { workflowId, executionId, timestamp }
});

socket.on('workflow:step:start', (event) => {
  // { executionId, stepId, timestamp }
});

socket.on('workflow:step:end', (event) => {
  // { executionId, stepId, status, output, timestamp }
});

socket.on('workflow:complete', (event) => {
  // { executionId, status, output, timestamp }
});

socket.on('workflow:error', (event) => {
  // { executionId, error, timestamp }
});
```

## Execution Flow

1. **Trigger** - Workflow triggered (manual, scheduled, or webhook)
2. **Start** - Execution begins, `workflow:start` event emitted
3. **Step Execution** - Each step executes sequentially or in parallel
   - `workflow:step:start` emitted
   - Step processes input
   - `workflow:step:end` emitted
4. **Completion** - All steps complete, `workflow:complete` emitted
5. **Cleanup** - Results stored, execution logged

## Error Handling

### Step Errors

```javascript
{
  "type": "api",
  "config": {
    "url": "https://api.example.com",
    "timeout": 5000,
    "retryCount": 3,
    "retryDelay": 1000
  }
}
```

### Error Events

```javascript
socket.on('workflow:error', (event) => {
  console.error('Workflow failed:', event.error);
  // Handle error: retry, notify, rollback
});
```

## Usage Examples

### Create a Workflow

```javascript
const workflow = {
  name: "Customer Data Sync",
  description: "Sync customer data to CRM",
  steps: [
    {
      id: "extract",
      type: "api",
      config: {
        url: "https://api.example.com/customers",
        method: "GET"
      }
    },
    {
      id: "validate",
      type: "transform",
      config: {
        code: `
          return input.filter(c => c.email && c.name);
        `
      }
    },
    {
      id: "sync",
      type: "api",
      config: {
        url: "https://crm.example.com/sync",
        method: "POST"
      }
    }
  ]
};

const response = await fetch('http://localhost:9101/api/workflows/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(workflow)
});

const createdWorkflow = await response.json();
```

### Schedule a Workflow

```javascript
const schedule = {
  workflowId: "workflow-123",
  schedule: "0 2 * * *",  // Daily at 2 AM
  enabled: true,
  timezone: "UTC"
};

await fetch('http://localhost:9101/api/workflows/schedule', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(schedule)
});
```

### Monitor Execution

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:9101');

socket.on('workflow:step:start', (event) => {
  console.log(`Step ${event.stepId} started`);
});

socket.on('workflow:complete', (event) => {
  console.log(`Workflow completed:`, event);
});
```

## Testing

```bash
# Run datasources tests
npm run tests -- tests/routes/workflowRoutes.test.js

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Performance Considerations

- **Workflow Execution**: Steps execute sequentially by default; use `parallel` type for concurrency
- **Data Transfer**: Large payloads impact execution time; compress where possible
- **API Timeouts**: Default 30s; adjust per step as needed
- **Concurrent Executions**: System can handle multiple concurrent workflows; monitor resource usage

## Debugging

### Check Workflow Status

```bash
curl http://localhost:9101/api/workflows/dashboard
```

### Monitor Events

```javascript
// In Node REPL
global.eventBus.getStatistics()
global.eventBus.eventNames()
```

### Review Logs

```bash
tail -f ./.application/logs/application.log
```

## See Also

- [CLAUDE.md](../../../CLAUDE.md) - Architecture and development guidelines
- [USAGE.md](../../../USAGE.md) - Detailed usage examples
- [USAGE-CONCISE.md](../../../USAGE-CONCISE.md) - Quick reference
- [backend/README.md](../../README.md) - Backend operations
