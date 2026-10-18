# noobly Wiki Platform - Architecture

**Document Version:** 2.0
**Last Updated:** 2026-02-11
**Status:** Active Development

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [Technology Stack](#technology-stack)
4. [Backend Architecture](#backend-architecture)
5. [Frontend Architecture](#frontend-architecture)
6. [Module Architecture](#module-architecture)
7. [Data Flow Architecture](#data-flow-architecture)
8. [Service Integration](#service-integration)
9. [Security Architecture](#security-architecture)
10. [Deployment Architecture](#deployment-architecture)

---

## Executive Summary

The noobly Wiki Platform is a unified, modular application that combines:

- **Datasources Module**: Workflow automation and data transformation engine
- **Wiki Module**: Knowledge management and collaborative documentation system

Both modules run on a **single unified backend** (port 11000) powered by **nooblyjs-core**, with multiple frontend options including web, desktop (Electron), VS Code extension, Chrome extension, and Microsoft Teams integration.

### Key Architectural Decisions

1. **Unified Backend**: Single Node.js/Express server running both modules
2. **Modular Architecture**: Completely decoupled datasources and wiki modules
3. **Event-Driven Communication**: SharedEventEmitter for inter-module communication
4. **Service-Oriented**: nooblyjs-core provides pluggable services
5. **Multi-Frontend Strategy**: Same backend serves web, desktop, extension, and Teams clients
6. **Real-Time Capabilities**: Socket.IO for live collaboration and status updates
7. **Multi-Provider Support**: Switch between in-memory and distributed storage providers

---

## System Architecture Overview

### High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Client Applications                              │
├──────────┬────────────────┬──────────────┬──────────────┬────────────────┤
│  Web UI  │  Electron App  │  VS Code Ext │ Chrome Ext   │ Teams App      │
│ :3001    │  :3002 (Viewer)│              │              │                │
└────┬─────┴────────┬───────┴──────┬───────┴──────┬───────┴────────┬───────┘
     │             │              │              │              │
     │         WebSocket          │        REST API              │
     │         HTTP Proxy         │        WebSocket             │
     │                            │                              │
     └────────────────────────────┼──────────────────────────────┘
                                  │
                 ┌────────────────▼────────────────┐
                 │   Unified Backend (Port 11000)  │
                 │                                 │
                 │  ┌─────────────────────────┐   │
                 │  │    Express.js Server    │   │
                 │  ├─────────────────────────┤   │
                 │  │ • CORS, Session, Auth   │   │
                 │  │ • Rate Limiting         │   │
                 │  │ • Socket.IO             │   │
                 │  └─────────────────────────┘   │
                 │                                 │
                 │  ┌──────────┐  ┌──────────┐   │
                 │  │Datasources│  │   Wiki   │   │
                 │  │ Module    │  │ Module   │   │
                 │  └──────────┘  └──────────┘   │
                 │                                 │
                 │  ┌─────────────────────────┐   │
                 │  │ digital-platforms-  │   │
                 │  │        core             │   │
                 │  │                         │   │
                 │  │ Services (Workflow,    │   │
                 │  │ Schedule, Filing, etc) │   │
                 │  └─────────────────────────┘   │
                 └────────────────┬────────────────┘
                                  │
                 ┌────────────────▼────────────────┐
                 │      Storage Layer              │
                 │                                 │
                 │ • JSON Files (.application/)    │
                 │ • Document Files (./data/)      │
                 │ • Output Files (./output/)      │
                 │ • In-Memory Cache               │
                 └─────────────────────────────────┘
```

### Layered Architecture

| Layer | Responsibility | Technologies | Ports |
|-------|---|---|---|
| **Client** | User interfaces | React, Vue, Vanilla JS, Electron, VS Code API | 3001-3002, Dev |
| **API Gateway** | Request routing, auth | Express.js, Passport.js, CORS | 11000 |
| **Application** | Business logic, routes | Node.js, Express | 11000 |
| **Service** | Core functionality | nooblyjs-core | 11000 |
| **Storage** | Data persistence | JSON files, Filesystem | Local/Network |

---

## Technology Stack

### Backend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Runtime** | Node.js | v18+ | JavaScript runtime |
| **Framework** | Express.js | v4.21 | HTTP server, routing |
| **Real-Time** | Socket.IO | v4.8 | WebSocket communication |
| **Authentication** | Passport.js | v0.7 | Authentication strategies |
| **Session** | express-session | v1.17 | Session management |
| **Service Core** | nooblyjs-core | Custom | Service registry pattern |
| **File Processing** | mammoth, xlsx, pptx-parser | Various | Document conversion |
| **AI Integration** | @anthropic-ai/sdk, openai | Latest | LLM services |

### Frontend

| Frontend | Technology | Port | Purpose |
|----------|-----------|------|---------|
| **Web (Datasources)** | Vanilla JS, Bootstrap, Socket.IO Client | 3001 | Workflow automation UI (dev) |
| **Web (Wiki)** | Vanilla JS, Bootstrap, Socket.IO Client | 3002 | Knowledge management UI (dev) |
| **Electron** | Electron, Node.js IPC | N/A | Desktop application |
| **VS Code** | VS Code Extension API, TypeScript | N/A | Editor integration |
| **Chrome** | Chrome Extension API, Manifest v3 | N/A | Browser integration |
| **Teams** | Microsoft Teams SDK, React | N/A | Teams integration |

### Storage

| Storage Type | Provider | Purpose | Current Config |
|---|---|---|---|
| **Workflow** | Memory, File, MongoDB | Workflow definitions | Memory |
| **Scheduling** | Memory, Cron | Scheduled tasks | Memory |
| **Queue** | Memory, Redis, RabbitMQ | Async task queue | Memory |
| **Data** | Memory, File, MongoDB | Application data | Memory |
| **Filing** | Local, S3, FTP, Git, GCP | File management | Local |
| **Cache** | Memory, Redis | Response caching | Memory |
| **Search** | Memory, Elasticsearch | Full-text search | Memory |

---

## Backend Architecture

### Unified Server Structure

```
backend/
├── app.js                    # Main entry point - unified backend (port 11000)
├── app-datasources.js       # Legacy datasources-only entry point (port 11002)
├── app-wiki.js             # Legacy wiki-only entry point (port 11003)
├── package.json             # Backend dependencies
├── configuration/           # Workflow and settings definitions
│   ├── workflows/           # Workflow definitions
│   ├── settings/            # Settings JSON files
│   └── schedules/           # Schedule definitions
├── public/                  # Static assets
│   ├── css/                 # Stylesheets
│   ├── js/                  # Frontend JS
│   └── images/              # Logos and icons
├── scripts/
│   └── kill-port.js        # Port cleanup utility
└── src/
    ├── datasources/        # Workflow automation module
    │   ├── initialize.js
    │   ├── routes/         # API endpoints
    │   ├── components/     # Business logic
    │   ├── middleware/     # Auth, validation
    │   ├── lib/           # WorkflowBridge
    │   └── validation/    # Request schemas
    ├── wiki/              # Knowledge management module
    │   ├── initialize.js
    │   ├── routes/        # API endpoints
    │   ├── components/    # DataManager, EventBus, etc.
    │   ├── activities/    # Background tasks
    │   ├── auth/          # Authentication
    │   └── views/         # Frontend HTML/JS
    └── shared/            # Shared utilities
        ├── auth/          # Shared auth config
        ├── processors/    # Document converters
        └── utils/         # Helper functions
```

### Initialization Flow

```
app.js (Unified Backend)
    │
    ├─▶ Initialize Core Services
    │   (Cache, Queue, Workflow, Filing, etc.)
    │
    ├─▶ Configure Express Middleware
    │   (CORS, BodyParser, Sessions, Passport)
    │
    ├─▶ Initialize Socket.IO
    │   │
    │   └─▶ Setup Event Broadcasting
    │
    ├─▶ Initialize Datasources Module
    │   │
    │   ├─▶ Initialize WorkflowBridge
    │   ├─▶ Register Routes (dashboardRoutes, workflowdashboard, contentRoutes)
    │   └─▶ Setup Event Listeners
    │
    ├─▶ Initialize Wiki Module
    │   │
    │   ├─▶ Initialize DataManager
    │   ├─▶ Initialize EventBus
    │   ├─▶ Register All Routes
    │   └─▶ Start Background Activities
    │
    └─▶ Start HTTP Server (Port 11000)
```

### Service Registry Pattern

```javascript
// Service initialization from nooblyjs-core
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app, eventEmitter, {
  logDir: path.join(__dirname, './.application/logs'),
  dataDir: path.join(__dirname, './.application/data')
});

// Access services
const log = serviceRegistry.logger('console');
const cache = serviceRegistry.cache('memory');
const filing = serviceRegistry.filing('local');
const queue = serviceRegistry.queue('memory');
const scheduling = serviceRegistry.scheduling('memory');
const searching = serviceRegistry.searching('memory');
const workflow = serviceRegistry.workflow('memory');
const authservice = serviceRegistry.authservice('file', {...});
const aiservice = serviceRegistry.aiservice('ollama', {...});
```

---

## Frontend Architecture

### Web Frontends

#### Datasources Frontend (Port 3001)

```
src/web/datasources/
├── index.html           # Entry HTML
├── package.json         # Dependencies (Vite dev server)
├── vite.config.js      # Vite configuration
├── src/
│   ├── Tab/
│   │   ├── App.tsx     # Main React component
│   │   └── client.tsx  # Teams client
│   └── index.ts
└── public/
    └── assets/         # Static files
```

**Features:**
- Workflow management (create, edit, execute)
- Data connection configuration
- Prompt library management
- Settings panel
- Real-time execution monitoring via Socket.IO

#### Wiki Frontend (Port 3002)

```
src/web/wiki/
├── index.html           # Entry HTML
├── package.json        # Dependencies
├── vite.config.js      # Vite configuration
├── src/
│   ├── Tab/
│   │   ├── App.tsx     # Main React component
│   │   ├── client.tsx  # Teams client
│   │   └── config.ts   # Wiki API configuration
│   └── services/
│       └── WikiAPI.ts
└── public/
    └── assets/         # Static files
```

**Features:**
- Document viewing and editing
- Folder navigation
- Search functionality
- Real-time collaboration via Socket.IO
- Comment system

### Desktop Frontends

#### Electron App

```
applications/electron/
├── datasources/         # Datasources tab (Electron app)
└── wiki/               # Wiki tab (Electron app)
```

Both web frontends are embedded in an Electron app with communication via IPC and HTTP to the backend.

### Extension Frontends

#### VS Code Extension

```
applications/vscode/wiki/
├── src/
│   ├── extension.ts     # Main extension
│   ├── api/             # Wiki API client
│   ├── providers/       # Tree providers, search, etc.
│   └── webviews/        # Document viewer, login
├── media/               # Icons and images
├── package.json         # Extension manifest
└── tsconfig.json
```

**Features:**
- File tree provider (wiki navigation)
- Search provider
- Recent files browser
- Document viewer webview

#### Chrome Extension

```
applications/chrome/wiki/
├── manifest.json        # Extension manifest v3
├── popup.html          # Popup UI
├── settings.html       # Settings page
├── background.js       # Service worker
├── config.json         # Configuration
├── js/
│   ├── api.js         # Backend API client
│   ├── popup.js       # Popup logic
│   └── settings.js    # Settings logic
└── css/
    └── style.css      # Styling
```

**Features:**
- Quick access popup
- Settings page for configuration
- API integration with backend

#### Microsoft Teams Integration

```
applications/teams/
├── datasources/         # Datasources tab app
│   ├── index.html
│   ├── src/
│   ├── appPackage/      # Teams manifest
│   └── m365agents.yml
└── wiki/                # Wiki tab app
    ├── index.html
    ├── src/
    ├── appPackage/      # Teams manifest
    └── m365agents.yml
```

**Features:**
- Datasources management in Teams context
- Wiki viewer in Teams context
- M365 agent integration

### Frontend Communication Patterns

#### REST API

```
Client → HTTP GET/POST/PUT/DELETE → Express Routes → Services → Response
```

#### WebSocket (Socket.IO)

```
Client ←→ Socket.IO ←→ Express ←→ EventEmitter ←→ Services
         (bidirectional)
```

**Example Events:**
- `file:created`, `file:updated`, `file:deleted`
- `workflow:started`, `workflow:completed`
- `search:results`
- `document:updated`

---

## Module Architecture

### Datasources Module

**Responsibility:** Workflow automation, data transformation, connection management

```
src/datasources/
├── initialize.js           # Module initialization
├── lib/
│   └── workflowBridge.js   # Workflow execution bridge
├── components/
│   ├── workflowManager.js      # CRUD operations
│   ├── workflowExecutor.js     # Execution engine
│   ├── workflowScheduler.js    # Scheduling
│   └── workflowServiceFactory.js
├── routes/
│   ├── dashboardRoutes.js      # Settings, connections, agents
│   ├── workflowdashboard.js    # Workflow CRUD and execution
│   └── contentRoutes.js        # Output review (JSON/Markdown)
├── middleware/
│   ├── validationMiddleware.js
│   └── workflowAuthMiddleware.js
└── validation/
    └── workflowSchemas.js      # Joi schemas
```

**Key Features:**
- Workflow execution engine
- Step-based processing (Transform, API, Conditional, Parallel, Delay)
- Cron-based scheduling
- Data connection management
- Content review and approval
- Settings management

**API Endpoints:**
- `/api/workflows/*` - Workflow operations
- `/api/connections/*` - Data connections
- `/api/agents/*` - AI agent configuration
- `/api/settings/*` - Application settings
- `/api/content/*` - Content review
- `/api/sources/*` - Data sources

### Wiki Module

**Responsibility:** Knowledge management, document collaboration, search

```
src/wiki/
├── initialize.js           # Module initialization
├── components/
│   ├── dataManager.js      # Document and folder management
│   ├── eventBus.js         # Event system
│   ├── aiService.js        # AI chat and context
│   └── userInitializer.js  # User initialization
├── activities/
│   ├── fileWatcher.js      # Monitors file changes
│   ├── searchIndexer.js    # Full-text indexing
│   └── taskProcessor.js    # Background task queue
├── routes/
│   ├── documentRoutes.js   # Document CRUD
│   ├── navigationRoutes.js # Folder navigation
│   ├── searchRoutes.js     # Search functionality
│   ├── spacesRoutes.js     # Space management
│   ├── aiChatRoutes.js     # AI chat endpoint
│   ├── authRoutes.js       # Authentication
│   └── ...other routes
├── auth/                   # Authentication middleware
├── views/                  # Frontend HTML/JS
└── initialisation/
    └── initialiseWikiData.js   # Data setup
```

**Key Features:**
- Document management (CRUD)
- Folder structure navigation
- Full-text search with indexing
- Real-time collaboration
- AI-powered chat and context
- Multi-space support
- User authentication

**API Endpoints:**
- `/applications/wiki/api/documents/*` - Document operations
- `/applications/wiki/api/navigation/*` - Folder navigation
- `/applications/wiki/api/search/*` - Search
- `/applications/wiki/api/spaces/*` - Space management
- `/applications/wiki/api/ai/*` - AI chat
- `/applications/wiki/api/users/*` - User management

### Module Interaction

```
┌────────────────────────────────────┐
│     Shared EventEmitter            │
│  (inter-module communication)       │
└────────────────────────────────────┘
          ▲              ▲
          │              │
    ┌─────▼──────┐  ┌────▼──────┐
    │ Datasources│  │    Wiki    │
    │  Module    │  │   Module   │
    └──────┬─────┘  └────┬───────┘
           │             │
           ▼             ▼
     ┌─────────────────────────┐
     │ digital-platforms-  │
     │        core             │
     │  (Shared Services)      │
     └─────────────────────────┘
```

**Shared Services:**
- Cache (response caching)
- Workflow (automation engine)
- Scheduling (cron jobs)
- Queue (async task processing)
- Filing (file system operations)
- Searching (full-text search)
- Logging (application logs)

---

## Data Flow Architecture

### Workflow Execution Flow (Datasources)

```
1. User Creates Workflow
   ├─▶ POST /api/workflows
   ├─▶ Validate workflow definition
   └─▶ Store in workflows.json

2. User Executes Workflow
   ├─▶ POST /api/workflows/:id/execute
   ├─▶ WorkflowExecutor processes steps
   ├─▶ Each step transforms data:
   │   ├─▶ API Step: Fetch external data
   │   ├─▶ Transform Step: Execute JS
   │   ├─▶ Conditional Step: Branch logic
   │   ├─▶ Parallel Step: Concurrent execution
   │   └─▶ Delay Step: Pause execution
   ├─▶ Intermediate JSON stored in ./output/json/
   ├─▶ Final Markdown generated
   ├─▶ Output stored in ./output/markdown/
   └─▶ Execution logged to workflowExecutions.json

3. User Reviews Content
   ├─▶ GET /api/content/json/:path
   ├─▶ GET /api/content/markdown/:path
   └─▶ Display in content review UI

4. Scheduled Execution
   ├─▶ Scheduling service triggers at cron time
   ├─▶ Workflow auto-executes
   └─▶ Output stored and logged
```

### Document Operation Flow (Wiki)

```
1. User Creates/Edits Document
   ├─▶ POST/PUT /applications/wiki/api/documents/:path
   ├─▶ DataManager updates file system
   ├─▶ FileWatcher detects change
   ├─▶ Emit file:updated event
   └─▶ Broadcast to all clients via Socket.IO

2. User Searches
   ├─▶ GET /applications/wiki/api/search?q=query
   ├─▶ SearchIndexer queries in-memory index
   └─▶ Return ranked results

3. Real-Time Collaboration
   ├─▶ Client A edits document
   ├─▶ FileWatcher detects change
   ├─▶ Emit file:updated event
   ├─▶ Socket.IO broadcasts to Client B
   └─▶ Client B updates UI automatically
```

### Data Storage Layout

```
.application/                   # Application metadata
├── workflows.json             # Workflow definitions
├── workflowExecutions.json   # Execution history
├── workflowSchedules.json    # Schedule configurations
├── settings-general.json     # General settings
├── settings-connections.json # Data connections
├── settings-agents.json      # AI agents
├── settings-security.json    # Authorized emails
└── settings-notifications.json # Notification config

data/                          # User documents
├── documents/               # Editable documents
├── documents-readonly/      # Read-only docs
└── documents-shared/        # Shared documents

output/                        # Workflow output
├── json/                    # Intermediate JSON
└── markdown/                # Final markdown

configuration/                 # Workflow configs
├── workflows/              # Workflow definitions
├── settings/              # Settings JSON
└── schedules/             # Schedule definitions
```

---

## Service Integration

### nooblyjs-core Services

| Service | Current Provider | Purpose | Used By |
|---------|---|---|---|
| **Workflow** | Memory | Workflow definitions and execution | Datasources |
| **Scheduling** | Memory | Cron-based task scheduling | Datasources |
| **Queue** | Memory | Async task queuing | Datasources, Wiki |
| **Filing** | Local | File system operations | Both modules |
| **Cache** | Memory | Response caching | Both modules |
| **Search** | Memory | Full-text search indexing | Wiki |
| **Auth** | File-based | User authentication | Both modules |
| **AI** | Ollama | LLM integration | Wiki, Datasources |
| **Logger** | Console | Application logging | Both modules |

### Event Broadcasting

```javascript
// Core workflow events
'workflow:start'
'workflow:complete'
'workflow:error'
'workflow:step:start'
'workflow:step:end'

// Scheduler events
'scheduler:started'
'scheduler:stopped'
'scheduler:taskExecuted'

// File system events
'file:created'
'file:updated'
'file:deleted'
'folder:created'
'folder:deleted'

// Wiki events
'document:updated'
'search:indexed'
```

---

## Security Architecture

### Authentication & Authorization

```
Request
  │
  ├─▶ Express Middleware
  │   ├─▶ CORS validation
  │   ├─▶ Session check
  │   └─▶ Passport authentication
  │
  ├─▶ Route Middleware
  │   ├─▶ requireAuth (authenticated users)
  │   ├─▶ requireAdmin (admin users only)
  │   └─▶ Custom auth middleware
  │
  └─▶ Handler
      ├─▶ Execute business logic
      └─▶ Return response
```

### Protected Routes

```javascript
// Datasources Module
app.get('/api/workflows', requireAuth, (req, res) => {...})
app.post('/api/workflows', requireAuth, (req, res) => {...})
app.post('/api/workflows/:id/execute', requireAuth, (req, res) => {...})

// Wiki Module
app.get('/applications/wiki/api/documents/:path', requireAuth, (req, res) => {...})
app.post('/applications/wiki/api/documents/:path', requireAuth, (req, res) => {...})
```

### Security Layers

| Layer | Protection | Implementation |
|-------|-----------|----------------|
| **Transport** | HTTPS/TLS | Node.js https module |
| **CORS** | Cross-origin control | CORS middleware whitelist |
| **Authentication** | Session-based | Passport.js + express-session |
| **Authorization** | Role-based | requireAuth, requireAdmin |
| **Password** | Hashing | bcryptjs |
| **Code Execution** | Sandboxing | VM2 for transform steps |
| **Input Validation** | Sanitization | Joi schemas, Express middleware |
| **Rate Limiting** | DoS protection | express-rate-limit |

---

## Deployment Architecture

### Development Deployment

```
Developer Machine
├── Backend (npm start)         → Port 11000
├── Web Datasources (npm dev)   → Port 3001 (proxies to 11000)
└── Web Viewer (npm dev)        → Port 3002 (proxies to 11000)
```

### Single-Server Production

```
┌────────────────────────────────────────┐
│   Production Server                    │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │  Nginx/Apache (Reverse Proxy)    │ │
│  │  • SSL/TLS termination           │ │
│  │  • Static file serving           │ │
│  │  • Load balancing                │ │
│  └────────────┬─────────────────────┘ │
│               │                        │
│  ┌────────────▼─────────────────────┐ │
│  │  Node.js Application             │ │
│  │  • Port 11000                    │ │
│  │  • Unified backend               │ │
│  │  • Both modules                  │ │
│  └────────────┬─────────────────────┘ │
│               │                        │
│  ┌────────────▼─────────────────────┐ │
│  │  Data Storage                    │ │
│  │  • .application/ (JSON)          │ │
│  │  • data/ (Documents)             │ │
│  │  • output/ (Workflow output)     │ │
│  └──────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### Scalable Production (Future)

```
                ┌─────────────────────┐
                │   Load Balancer     │
                └──────────┬──────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼────┐         ┌───▼────┐       ┌───▼────┐
    │ App 1  │         │ App 2  │       │ App N  │
    │(Node)  │         │(Node)  │       │(Node)  │
    └───┬────┘         └───┬────┘       └───┬────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼─────┐       ┌────▼────┐       ┌────▼─────┐
    │ Redis   │       │ MongoDB  │       │ S3       │
    │(Cache & │       │(Data)    │       │(Files)   │
    │ Queue)  │       │          │       │          │
    └─────────┘       └──────────┘       └──────────┘
```

**To scale to this model:**

```javascript
// Switch from in-memory to distributed providers
const cache = serviceRegistry.cache('redis', {...});
const queue = serviceRegistry.queue('redis', {...});
const workflow = serviceRegistry.workflow('mongodb', {...});
const filing = serviceRegistry.filing('s3', {...});
```

---

## Appendix A: Configuration Reference

### Environment Variables

| Variable | Purpose | Default | Example |
|----------|---------|---------|---------|
| `NODE_ENV` | Environment mode | development | production |
| `PORT` | Backend port | 11000 | 8080 |
| `SESSION_SECRET` | Session encryption | dev-secret | your-secret |
| `AI_MODEL` | Ollama model | tinyllama:1.1b | mistral |
| `REDIS_HOST` | Redis server | localhost | redis.example.com |
| `MONGODB_URI` | MongoDB connection | - | mongodb://... |
| `AWS_REGION` | AWS region | us-east-1 | eu-west-1 |
| `S3_BUCKET` | S3 bucket name | - | my-bucket |

### Port Configuration

| Component | Port | Purpose |
|-----------|------|---------|
| **Backend** | 11000 | Unified API server |
| **Web Datasources** | 3001 | Development frontend |
| **Web Viewer** | 3002 | Development frontend |
| **Electron** | N/A | Desktop app |
| **VS Code** | N/A | Extension |
| **Chrome** | N/A | Extension |
| **Teams** | N/A | Teams integration |

### Logging

Logs are written to `.application/logs/` with timestamps and severity levels:
- INFO: General information
- WARN: Warning messages
- ERROR: Error messages
- DEBUG: Debug information (development only)

---

## Appendix B: File Structure Summary

```
nooblyjs-ai-knowledge/
├── backend/                    # Unified backend
│   ├── app.js                 # Main entry point (port 11000)
│   ├── app-datasources.js     # Legacy datasources only (port 11002)
│   ├── app-wiki.js            # Legacy wiki only (port 11003)
│   ├── src/
│   │   ├── datasources/      # Workflow module
│   │   ├── wiki/            # Wiki module
│   │   └── shared/          # Shared utilities
│   ├── configuration/        # Workflow configs
│   └── public/              # Static assets
│
├── applications/             # Multi-platform applications
│   ├── web/
│   │   ├── datasources/     # Datasources UI (dev port 3001)
│   │   └── wiki/            # Wiki UI (dev port 3002)
│   ├── electron/
│   │   ├── datasources/     # Electron datasources app
│   │   └── wiki/            # Electron wiki app
│   ├── teams/               # Microsoft Teams integration
│   ├── vscode/wiki/         # VS Code extension
│   ├── chrome/wiki/         # Chrome extension
│   └── daemon/wiki/         # Background sync daemon
│
├── data/                     # User data
│   ├── documents/
│   ├── documents-readonly/
│   └── documents-shared/
│
├── docs/                     # Documentation
│   ├── Architecture.md      # This file
│   ├── API-Reference.md
│   ├── Product-Requirements-Document.md
│   └── User-Guide.md
│
└── configuration/            # Default configurations
    ├── workflows/
    ├── settings/
    └── schedules/
```

---

## Appendix C: Running the Application

### Local Development

```bash
# Install dependencies
npm install

# Optional: install frontend dev servers
cd ../src/web/datasources && npm install
cd ../src/web/wiki && npm install

# Start backend
cd ../../../backend
npm start                # Production mode (both UIs available at 11000)
# OR
npm run dev             # Development with auto-reload (both UIs available at 11000)

# Optional: In new terminal - start datasources frontend dev server
cd src/web/datasources
npm run dev             # Port 3001 (proxies to backend at 11000)

# Optional: In another terminal - start wiki frontend dev server
cd src/web/wiki
npm run dev             # Port 3002 (proxies to backend at 11000)
```

### Access Points

- **Unified Backend**: http://localhost:11000
- **Datasources UI**: http://localhost:11000/applications/datasources/ (or http://localhost:3001 if dev server running)
- **Wiki UI**: http://localhost:11000/applications/wiki/ (or http://localhost:3002 if dev server running)
- **API Server**: http://localhost:11000
- **WebSocket**: ws://localhost:11000

---

## Appendix D: Related Documentation

- [Product Requirements Document](./Product-Requirements-Document.md)
- [API Reference](./API-Reference.md)
- [User Guide](./User-Guide.md)
- [CLAUDE.md](../CLAUDE.md) - Running instructions

---

**End of Document**
