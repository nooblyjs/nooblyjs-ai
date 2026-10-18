# API Reference

Complete API documentation for the noobly Wiki Platform.

## Overview

The noobly Wiki Platform v2.0 provides a unified REST API for both workflow automation (Datasources) and knowledge management (Wiki) modules running on a single port.

### Base URLs

- **Datasources API**: `http://localhost:11000/api/`
- **Wiki API**: `http://localhost:11000/applications/wiki/api/`
- **Unified Backend**: `http://localhost:11000`
- **WebSocket**: `ws://localhost:11000` (Socket.IO for real-time events)

### Environment

- **Development**: http://localhost:11000 (port 11000)
- **Production**: Configure via environment variables (PORT env var)
- **Standalone Dev Servers** (optional):
  - Datasources UI: http://localhost:3001 (proxies to backend)
  - Wiki UI: http://localhost:3002 (proxies to backend)

### API Version

- **Current**: 2.0.0
- **Base Path**: `/api/` and `/applications/wiki/api/`
- **Response Format**: JSON
- **Rate Limiting**: 100 requests per minute per IP

---

## Authentication

### Supported Methods

1. **Session Cookie** - Username/password login
   ```
   POST /auth/login
   Content-Type: application/json

   {
     "username": "user@example.com",
     "password": "password"
   }
   ```

2. **OAuth2** - Google authentication
   ```
   GET /auth/google
   ```

3. **Bearer Token** - API client authentication
   ```
   Authorization: Bearer <token>
   ```
   - Token expires after 24 hours
   - Get token from login response
   - Use for programmatic access (CLI, extensions, scripts)

### Request Headers

Include these headers with API requests:

```
Content-Type: application/json
Accept: application/json
Authorization: Bearer <token>  # For token auth
```

### Session Management

- **Login**: `POST /auth/login`
- **Register**: `POST /auth/register`
- **Logout**: `POST /auth/logout`
- **Current User**: `GET /auth/me`

---

## Datasources API (Workflow Automation)

### Spaces (Organization & Access Control)

#### List Spaces
```
GET /api/spaces/
```

**Query Parameters:**
- `type` - Filter by type (project, team, workflow, etc.)
- `visibility` - Filter by visibility (public, private, team)

**Response:**
```json
[
  {
    "id": "space-1",
    "name": "Q1 Projects",
    "description": "Q1 project space",
    "type": "project",
    "visibility": "team",
    "allowedUsers": ["user1", "user2"],
    "configuration": {}
  }
]
```

#### Create Space
```
POST /api/spaces/
Content-Type: application/json

{
  "name": "Space Name",
  "description": "Space description",
  "type": "project",
  "visibility": "team",
  "allowedUsers": ["user1"],
  "configuration": {}
}
```

#### Get Space Details
```
GET /api/spaces/:id
```

#### Update Space
```
PUT /api/spaces/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Delete Space
```
DELETE /api/spaces/:id
```

#### Archive/Restore Space
```
POST /api/spaces/:id/archive
POST /api/spaces/:id/restore
```

#### Manage Space Users
```
POST /api/spaces/:id/users/:userId
DELETE /api/spaces/:id/users/:userId
```

### Workflows

#### List Workflows
```
GET /api/workflows/
```

**Response:**
```json
{
  "success": true,
  "workflows": [
    {
      "id": "workflow-1",
      "name": "Data Sync",
      "description": "Sync data from S3",
      "status": "active",
      "createdAt": "2026-02-11T00:00:00Z"
    }
  ]
}
```

#### Create Workflow
```
POST /api/workflows/
Content-Type: application/json

{
  "name": "New Workflow",
  "description": "Description",
  "steps": [
    {
      "type": "api",
      "config": { "url": "..." }
    }
  ]
}
```

#### Get Workflow
```
GET /api/workflows/:id
```

#### Update Workflow
```
PUT /api/workflows/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "steps": [...]
}
```

#### Delete Workflow
```
DELETE /api/workflows/:id
```

#### Execute Workflow
```
POST /api/workflows/:id/execute
```

**Response:**
```json
{
  "success": true,
  "executionId": "exec-12345",
  "status": "running"
}
```

#### Get Execution Status
```
GET /api/workflows/:id/executions/:executionId
```

### Data Connections

#### List Connections
```
GET /api/connections/
```

#### Create Connection
```
POST /api/connections/
Content-Type: application/json

{
  "name": "S3 Bucket",
  "type": "s3",
  "config": {
    "bucket": "my-bucket",
    "region": "us-east-1"
  }
}
```

#### Test Connection
```
POST /api/connections/:id/test
```

#### Delete Connection
```
DELETE /api/connections/:id
```

### Dashboard & Metrics

#### Dashboard Metrics
```
GET /api/workflows/dashboard
```

**Response:**
```json
{
  "totalWorkflows": 10,
  "activeWorkflows": 7,
  "totalExecutions": 150,
  "failedExecutions": 3,
  "averageExecutionTime": 2500
}
```

### Settings & Configuration

#### Get Settings
```
GET /api/settings/
```

#### Update Settings
```
PUT /api/settings/
Content-Type: application/json

{
  "aiModel": "gpt-4",
  "logLevel": "info"
}
```

#### List AI Agents
```
GET /api/agents/
```

---

## Wiki API (Knowledge Management)

### Spaces

#### List Spaces
```
GET /applications/wiki/api/spaces
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Shared Documents",
    "description": "Team documentation",
    "type": "shared",
    "permissions": "read-write"
  }
]
```

#### Create Space
```
POST /applications/wiki/api/spaces
Content-Type: application/json

{
  "name": "New Space",
  "description": "Space description",
  "type": "shared"
}
```

**Requires**: Authentication

#### Get Space
```
GET /applications/wiki/api/spaces/:id
```

#### Update Space
```
PUT /applications/wiki/api/spaces/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Delete Space
```
DELETE /applications/wiki/api/spaces/:id
```

### Documents

#### List Documents
```
GET /applications/wiki/api/documents
```

**Query Parameters:**
- `spaceId` - Filter by space ID
- `limit` - Maximum results (default: 100)
- `offset` - Pagination offset

**Response:**
```json
[
  {
    "id": 1000,
    "title": "Getting Started",
    "spaceName": "Shared Documents",
    "filePath": "getting-started.md",
    "createdAt": "2026-02-11T00:00:00Z",
    "updatedAt": "2026-02-11T00:00:00Z"
  }
]
```

#### Create Document
```
POST /applications/wiki/api/documents
Content-Type: application/json

{
  "title": "New Document",
  "spaceId": 1,
  "content": "# Document\n\nContent here",
  "filePath": "new-document.md"
}
```

#### Get Document
```
GET /applications/wiki/api/documents/:id
```

#### Update Document
```
PUT /applications/wiki/api/documents/:id
Content-Type: application/json

{
  "title": "Updated Title",
  "content": "Updated content"
}
```

#### Delete Document
```
DELETE /applications/wiki/api/documents/:id
```

### Search

#### Full-Text Search
```
GET /applications/wiki/api/search?q=<query>
```

**Query Parameters:**
- `q` - Search query (required)
- `spaceId` - Limit to space
- `limit` - Results limit (default: 20)

**Response:**
```json
{
  "total": 5,
  "results": [
    {
      "id": 1000,
      "title": "Getting Started",
      "excerpt": "Quick start guide for...",
      "relevance": 0.95
    }
  ]
}
```

### Folders & Navigation

#### Get Folder Tree
```
GET /applications/wiki/api/spaces/:spaceId/folders
```

**Response:**
```json
{
  "folder": {
    "name": "root",
    "children": [
      {
        "name": "Guides",
        "path": "Guides",
        "children": []
      }
    ],
    "files": [...]
  }
}
```

#### Create Folder
```
POST /applications/wiki/api/folders
Content-Type: application/json

{
  "spaceId": 1,
  "path": "path/to/folder",
  "name": "New Folder"
}
```

#### Delete Folder
```
DELETE /applications/wiki/api/folders/:id
```

### Templates

#### Get Space Templates
```
GET /applications/wiki/api/spaces/:spaceId/templates
```

**Response:**
```json
[
  {
    "id": "template-1",
    "name": "Blog Post",
    "content": "# Blog Post\n\n..."
  }
]
```

### AI & Content Generation

#### Chat with AI
```
POST /applications/wiki/api/ai/chat
Content-Type: application/json

{
  "message": "Explain this concept...",
  "context": "documentId: 1000"
}
```

**Response:**
```json
{
  "response": "Here's the explanation...",
  "tokens": 250
}
```

#### Generate AI Context
```
POST /applications/wiki/api/ai/generate-context
Content-Type: application/json

{
  "documentId": 1000,
  "prompt": "Summarize this document"
}
```

### File Upload

#### Upload File
```
POST /applications/wiki/api/upload
Content-Type: multipart/form-data

Field: file (binary)
Field: spaceId (1)
```

**Response:**
```json
{
  "success": true,
  "fileId": "file-12345",
  "filename": "document.pdf",
  "size": 5242880
}
```

---

## MCP Server (AI clients)

The read-only slice of the Wiki API above is also exposed over the Model Context
Protocol, so an AI client can search and read documentation directly.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /applications/wiki/api/mcp` | Bearer token | The MCP connection |
| `GET /applications/wiki/api/mcp/info` | Public | Discovery — server name, transport, tool list |

Two tools are available: `search_knowledge` and `read_document`. A token acts as its
owner, so space visibility and permissions apply exactly as they do in the browser.

See **[MCP-Server.md](MCP-Server.md)** for setup, tool arguments and troubleshooting.

---

## Error Responses

### Standard Error Format
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "status": 400
}
```

### Common Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Server Error

---

## Rate Limiting

- **Default**: 100 requests per minute
- **Header**: `X-RateLimit-Remaining`
- **Reset**: See `X-RateLimit-Reset` header

---

## WebSocket Events (Socket.IO)

### Datasources Events
- `workflow:start` - Workflow started
- `workflow:complete` - Workflow completed
- `workflow:error` - Workflow failed
- `step:start` / `step:end` - Step execution

### Wiki Events
- `document-updated` - Document changed
- `document-created` - New document
- `document-deleted` - Document removed
- `folder-changed` - Folder structure changed
- `search-indexed` - Search index updated

---

**Last Updated**: February 2026
**API Version**: 2.0.0
