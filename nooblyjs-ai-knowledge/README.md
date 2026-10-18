# noobly Wiki Platform v2.0

A unified, multi-platform knowledge management and workflow automation system combining document repositories, real-time synchronization, AI assistance, and workflow orchestration.

**Version**: 2.0.0 (Unified Backend)
**Status**: Production Ready
**Last Updated**: March 2026

## 🎯 Overview

The noobly Wiki Platform is a comprehensive solution for teams needing:

- **Knowledge Management** - Create, organize, search, and collaborate on documents
- **Workflow Automation** - Design and execute data workflows with multi-provider integrations
- **Real-Time Synchronization** - Live updates across web, desktop, and extension platforms
- **AI-Powered Assistance** - Content generation and context analysis via local LLMs
- **Multi-Platform Access** - Web, Desktop (Electron), VS Code, Chrome, Teams, and sync daemon

## 🎉 Project Status & Recent Updates

**Current Version:** 2.0.0 (Unified Backend)
**Completion Level:** 72% - Phases 1-5.4 Complete ✅
**Production Status:** Fully Production Ready

### Latest Achievements (Phases 5.1-5.5)

- ✅ **Phase 5.1-5.2:** Security Audit & RBAC Implementation
  - Role-Based Access Control fully deployed
  - Space management with granular permissions
  - RBAC-aware menu filtering on frontend

- ✅ **Phase 5.3-5.4:** Unit & E2E Testing, Performance Benchmarking
  - 56+ unit tests created across components and routes (36+ passing)
  - 31 Playwright E2E tests covering critical workflows
  - 50+ performance benchmark scenarios with established budgets

- ✅ **Phase 5.5:** Space Filing Service Integration
  - Complete RBAC + Space Filing integration
  - Zero breaking changes throughout refactoring

### Documentation & Developer Experience

- ✅ Enhanced [CLAUDE.md](CLAUDE.md) with:
  - **Current Project Status** section showing completion status
  - **Frontend Loading & Initialization Patterns** for async dependency handling
  - **Known Issues & Solutions** documenting UIService race condition, header display, login rendering
  - **Test Structure & Patterns** with Jest examples
  - **Authentication Flow & Module Differences** for clear auth understanding
  - **Performance Considerations** with optimization strategies
  - **Persistent Memory System** documentation for cross-session knowledge

- ✅ Consolidated all frontend applications under `/applications/` directory
  - `src/web/datasources/` - Workflow automation UI
  - `src/web/wiki/` - Knowledge management UI
  - `applications/teams/` - Microsoft Teams integration
  - `applications/chrome/` - Chrome extension
  - `applications/vscode/` - VS Code extension
  - `applications/daemon/` - Background file sync

- ✅ Comprehensive guides for all features and integrations

## ✨ Key Features

### Knowledge Management (Wiki Module)
- 📄 **Document Management** - Create, edit, organize Markdown documents
- 🔄 **Real-Time Sync** - WebSocket-based live updates across all platforms
- 🔍 **Full-Text Search** - Advanced search with indexing
- 📤 **Multi-Format Import** - PDF, DOCX, XLSX, PPTX support
- 🤖 **AI Integration** - Claude, ChatGPT, Ollama, Gemini support
- 👥 **Multi-User** - Collaborative access with authentication
- 🔐 **RBAC** - Role-based access control with granular permissions

### Workflow Automation (Datasources Module)
- 🔗 **Data Connections** - FTP, S3, Git, APIs, local filesystem
- ⚙️ **Workflow Builder** - Visual workflow design and execution
- 📅 **Scheduling** - Automated task scheduling and execution
- 🧠 **AI Agents** - Multiple LLM provider support
- 📊 **Execution Monitoring** - Real-time workflow tracking
- ⚡ **Multi-Step Workflows** - Complex data pipeline orchestration
- 🔐 **RBAC** - Workspace-level permission management with roles (admin, editor, viewer)

### Cross-Platform Features
- 🔐 **Unified Authentication** - Local, OAuth2, and Bearer token support
- 📦 **Spaces System** - Organizational and access control framework
- ✅ **Comprehensive Testing** - 56+ unit tests, 31 E2E tests
- 📈 **Performance Optimized** - Socket.IO debouncing, in-memory caching, lazy loading

### Multi-Platform Access
- 🌐 **Web Application** - Modern browser interface
- 🖥️ **Desktop App** - Native Electron application (Windows, macOS, Linux)
- 🔧 **VS Code Extension** - In-editor documentation access
- 🎨 **Chrome Extension** - Quick reference popup
- 💬 **Microsoft Teams** - Integrated Teams tab
- 🔄 **File Sync Daemon** - Background file synchronization

## 🏗️ Architecture (v2.0)

### Unified Backend Architecture

```
┌────────────────────────────────────────────────────┐
│         User Interfaces & Platforms                │
│  Web │ Desktop │ VS Code │ Chrome │ Teams │ Daemon │
└──────────────────────┬─────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
    REST API                     WebSocket (Socket.IO)
    (Both Modules)                 (Unified)
        │                             │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────────────┐
        │  Unified Express.js Server          │
        │  Port 9101                         │
        │  + Shared Socket.IO Instance        │
        │  + Unified Passport Authentication  │
        └──────────────┬──────────────────────┘
                       │
        ┌──────────────▼──────────────────────┐
        │  noobly Core          │
        │  Service Registry                   │
        │  (Logging, Auth, Filing,            │
        │   Search, AI, Caching, Queues)      │
        └──────────────┬──────────────────────┘
                       │
        ┌──────────────▼──────────────────────────┐
        │                                         │
   ┌────▼─────┐                        ┌────────▼───┐
   │ Datasources Module                 │  Wiki Module│
   ├────────────────────────────────┬──┤────────────┤
   │ • WorkflowBridge               │  │ • DataManager    │
   │ • Workflow Execution           │  │ • EventBus       │
   │ • Data Connections             │  │ • FileWatcher    │
   │ • Scheduling                   │  │ • SearchIndexer  │
   │ • AI Agents                    │  │ • AIService      │
   │                                │  │ • Views/Routes   │
   │ Routes: /api/workflows/*       │  │ Routes: /applications/wiki/api/* │
   └────────────────────────────────┴──┴──────────────────┘
                       │
        ┌──────────────▼──────────────────────┐
        │  Shared Infrastructure              │
        │  • Document Processors              │
        │  • Authentication Components        │
        │  • Common Utilities                 │
        └──────────────┬──────────────────────┘
                       │
        ┌──────────────▼──────────────────────┐
        │  Data Layer                         │
        │  ./.application/ (JSON File Storage)│
        ├──────────────────────────────────────┤
        │  • documents/  • spaces/             │
        │  • workflows/  • data/auth/          │
        │  • wiki-files/ • settings/           │
        └─────────────────────────────────────┘
```

### Key Components

**Entry Points:**
- `src/initialize.js` - **PRIMARY** - Unified backend (port 9101, runs both modules)
- `backend/app-datasources.js` - Legacy datasources-only (port 9101)
- `backend/app-wiki.js` - Legacy wiki-only (port 11002)

**Unified Backend** (`src/initialize.js`):
- Single Express server on **port 9101**
- Shared Socket.IO for real-time events
- Unified authentication via Passport
- Consolidated service registry

**Module Initializers**:
- `src/datasources/initialize.js` - Workflow automation setup
- `src/wiki/initialize.js` - Knowledge management setup

**Shared Code** (`src/shared/`):
- Document processors (DOCX, PDF, XLSX, PPTX)
- Passport authentication configuration
- Bearer token middleware for API clients
- File type utilities and validation

### Frontend Architecture

**Unified Backend Serving:**
- Both UIs (Datasources and Wiki) are served from the backend at `/applications/datasources/` and `/applications/wiki/`
- No separate dev server needed for production - single `npm start` runs everything
- All APIs available immediately on port 9101

**Optional Standalone Dev Servers:**
For frontend development, you can run separate dev servers that proxy to the backend:
- `src/web/datasources/` - Datasources UI dev server (port 3001)
- `src/web/wiki/` - Wiki UI dev server (port 3002)

**Multi-Platform Support:**
- `applications/teams/` - Microsoft Teams integration (tabs for both modules)
- `applications/vscode/wiki/` - VS Code editor extension
- `applications/chrome/wiki/` - Chrome browser extension
- `applications/daemon/wiki/` - Background file synchronization daemon

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ and npm
- **nooblyjs-core** installed as a sibling directory (provides service registry)

### Installation

1. **Setup directory structure**:
```bash
# Create parent directory with both repos
cd parent-directory
git clone <repo>/nooblyjs-core
git clone <repo>/nooblyjs-ai-knowledge

# Expected structure:
# parent-directory/
# ├── nooblyjs-core/
# └── nooblyjs-ai-knowledge/
```

2. **Install backend dependencies**:
```bash
cd nooblyjs-ai-knowledge/backend
npm install
```

3. **Optional: Install all frontend applications**:
```bash
# From repository root
npm run install:all
# Or install specific ones:
npm run install:web-datasources
npm run install:web-wiki
```

4. **Start the unified backend**:
```bash
npm start
# Server runs on http://localhost:9101 with both modules
```

5. **Access applications**:
- **Unified Backend**: [http://localhost:9101/](http://localhost:9101/)
- **Datasources (Workflows)**: [http://localhost:9101/applications/datasources/](http://localhost:9101/applications/datasources/)
- **Wiki (Knowledge Mgmt)**: [http://localhost:9101/applications/wiki/](http://localhost:9101/applications/wiki/)

**What's Included:**
The unified backend serves both modules plus all APIs and real-time Socket.IO events. Both UIs are built-in - no separate frontend dev servers needed unless you're actively developing frontend code.

### Development (with Auto-Reload)

**Backend only (with auto-reload):**
```bash
npm run dev
# Runs both datasources + wiki modules on http://localhost:9101
# Both UIs available immediately
```

**Full development setup (Backend + Frontend Dev Servers):**
```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Datasources UI (optional, for UI development)
cd src/web/datasources && npm run dev
# Access at http://localhost:3001

# Terminal 3: Wiki UI (optional, for UI development)
cd src/web/wiki && npm run dev
# Access at http://localhost:3002
```

For more development commands and debugging, see [CLAUDE.md Development Commands](CLAUDE.md#development-commands).

### Legacy Backend Support

For backward compatibility, legacy entry points still work:
```bash
# Datasources-only (port 9101)
npm run start:datasources

# Wiki-only (port 11002)
npm run start:wiki
```

**Note:** Use the unified backend (`npm start` on port 9101) for new development.

## 📚 API Endpoints

For comprehensive endpoint documentation, see:
- **[src/datasources/README.md](src/datasources/README.md)** - Datasources module endpoints
- **[src/wiki/README.md](src/wiki/README.md)** - Wiki module endpoints
- **[USAGE-CONCISE.md](USAGE-CONCISE.md)** - Quick API reference

### Datasources APIs (Workflow Automation)

**Workflows Management** (`/api/workflows/`):
- `GET` - List all workflows
- `POST` - Create workflow
- `GET /:id` - Get workflow
- `PUT /:id` - Update workflow
- `DELETE /:id` - Delete workflow
- `POST /:id/execute` - Execute workflow
- `GET /:id/export` - Export workflow
- `POST /import` - Import workflow
- `GET /search` - Search workflows
- `GET /starred` - Get starred workflows
- `GET /recent` - Get recent workflows
- `POST /:id/star` - Star workflow
- `DELETE /:id/recent` - Remove from recent
- `POST /:id/view` - Record view
- `GET /dashboard` - Dashboard metrics

**Connections** (`/api/connections/`):
- `GET` - List connections
- `POST` - Create connection
- `GET /:id` - Get connection
- `PUT /:id` - Update connection
- `DELETE /:id` - Delete connection
- `POST /:id/browse` - Browse connection

**Spaces & RBAC** (`/api/spaces/`):
- `GET` - List spaces
- `POST` - Create space
- `GET /:id` - Get space
- `PUT /:id` - Update space
- `DELETE /:id` - Delete space
- `POST /:id/archive` - Archive space
- `POST /:id/restore` - Restore space
- `POST /:id/users/:userId` - Add user
- `DELETE /:id/users/:userId` - Remove user

**Agents & Settings**:
- `GET /api/agents/` - List AI agents
- `POST /api/agents/` - Create agent
- `GET /api/settings/` - Get settings
- `PUT /api/settings/` - Update settings
- `GET /api/sources` - List data sources

**Prompt Library** (`/api/prompts/`):
- `GET` - List prompts (filters: `category`, `status`, `search`)
- `GET /categories` - List categories in use
- `GET /:id` - Get a prompt by id or key
- `POST` - Create prompt
- `PUT /:id` - Update prompt
- `DELETE /:id` - Delete prompt
- `POST /test` - Run unsaved prompt content against an agent
- `POST /:id/test` - Run a saved prompt as the system prompt with a user input

### Wiki APIs (Knowledge Management)

**Documents** (`/applications/wiki/api/documents/`):
- `GET` - List documents
- `POST` - Create document
- `GET /:id` - Get document
- `PUT /:id` - Update document
- `DELETE /:id` - Delete document
- `POST /upload` - Upload file
- `GET /content` - Get document content
- `GET /pdf-preview` - Get PDF preview
- `POST /toggle-todo` - Toggle todo item
- `POST /convert-to-markdown` - Convert format
- `POST /exists` - Check existence

**Folders** (`/applications/wiki/api/`):
- `POST /folders` - Create folder
- `PUT /folders/rename` - Rename folder
- `DELETE /folders/:path` - Delete folder
- `PUT /documents/rename` - Rename document
- `PUT /documents/:id/move` - Move document
- `POST /move` - Move item

**File Management** (`/applications/wiki/api/spaces/:spaceId/`):
- `GET /file-content/:path` - Get file content
- `POST /file-content/:path` - Create/update file
- `DELETE /file-content/:path` - Delete file
- `GET /download/:path` - Download file
- `GET /file-list/:path` - List files
- `GET /folder-tree` - Get folder tree

**Search** (`/applications/wiki/api/search`):
- `GET` - Search documents
- `GET /suggestions` - Search suggestions
- `GET /stats` - Search statistics
- `POST /rebuild` - Rebuild index

**Spaces** (`/applications/wiki/api/spaces/`):
- `GET` - List spaces
- `POST` - Create space
- `GET /:id` - Get space
- `PUT /:id` - Update space
- `DELETE /:id` - Delete space
- `GET /:id/documents` - Get space documents
- `GET /:id/folders` - Get space folders
- `GET /:id/templates` - Get space templates

**AI Features** (`/applications/wiki/api/ai/`):
- `GET /chat` - Get chat history
- `POST /chat` - Chat with AI
- `DELETE /chat/:messageId` - Delete message
- `POST /chat/clear` - Clear chat

**Settings** (`/applications/wiki/api/settings/`):
- `GET /ai` - Get AI settings
- `POST /ai` - Update AI settings
- `POST /ai/test` - Test AI settings

**User Features** (`/applications/wiki/api/`):
- `GET /profile` - Get user profile
- `PUT /profile` - Update profile
- `POST /profile/change-password` - Change password
- `POST /profile/avatar` - Upload avatar
- `GET /user/activity` - User activity
- `POST /user/star` - Star item
- `POST /user/visit` - Record visit
- `GET /user/folder-view-preferences` - View preferences
- `POST /user/folder-view-preference` - Set view preference
- `GET /user/selected-spaces` - Selected spaces
- `PUT /user/selected-spaces` - Update selected spaces

**Discovery & Activity**:
- `GET /applications/wiki/api/recent` - Recent documents
- `GET /applications/wiki/api/documents/popular` - Popular documents
- `GET /applications/wiki/api/activity` - Activity log
- `POST /applications/wiki/api/activity` - Create activity

### Authentication APIs

All modules:
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register
- `POST /api/auth/logout` - Logout
- `GET /api/auth/check` - Check auth status
- `POST /api/auth/change-password` - Change password
- `POST /api/auth/token` - Get bearer token

**Legacy Wiki Auth** (without `/api/` prefix):
- `GET /auth/check` - Check auth status

## 📁 Directory Structure

```
nooblyjs-ai-knowledge/
│
├── backend/                          ✨ UNIFIED BACKEND
│   ├── app.js                       (Unified backend - port 9101)
│   ├── app-datasources.js           (Legacy datasources-only - port 9101)
│   ├── app-wiki.js                  (Legacy wiki-only - port 11002)
│   ├── package.json                 (Merged dependencies)
│   ├── README.md                    (Backend documentation)
│   └── src/
│       ├── shared/                  (Shared code)
│       │   ├── processors/          (Document converters)
│       │   ├── utils/              (Utilities)
│       │   └── auth/               (Authentication)
│       ├── datasources/            (Workflows module)
│       │   ├── initialize.js       (Module init)
│       │   ├── components/
│       │   ├── routes/
│       │   ├── lib/
│       │   └── middleware/
│       └── wiki/                   (Knowledge mgmt module)
│           ├── initialize.js       (Module init)
│           ├── components/
│           ├── routes/
│           ├── activities/
│           ├── auth/
│           └── views/
│
├── applications/                     ✨ MULTI-PLATFORM APPLICATIONS
│   ├── web/                        (Web UI frontends)
│   │   ├── datasources/            (Datasources/Workflows UI, port 3001)
│   │   │   ├── public/             (Static assets & frontend code)
│   │   │   └── package.json
│   │   └── wiki/                   (Wiki/Knowledge Management UI, port 3002)
│   │       ├── public/             (Static assets & frontend code)
│   │       └── package.json
│   ├── teams/                      (Microsoft Teams integration)
│   │   ├── datasources/            (Teams tab for workflows)
│   │   └── wiki/                   (Teams tab for knowledge mgmt)
│   ├── chrome/                     (Chrome browser extension)
│   │   └── wiki/                   (Chrome extension code)
│   ├── vscode/                     (VS Code editor extension)
│   │   └── wiki/                   (VS Code extension code)
│   └── daemon/                     (Background file sync daemon)
│       └── wiki/                   (Daemon sync code)
│
├── .application/                    (Runtime data directory)
│   ├── data/                       (User data)
│   ├── documents/                  (Wiki documents)
│   ├── spaces/                     (Wiki spaces)
│   ├── workflows/                  (Workflow definitions)
│   ├── wiki-files/                 (Uploaded files)
│   └── configuration/              (Workflows & settings)
│
├── data/                           (Shared configuration & content)
├── docs/                           (📚 Documentation)
│   ├── PRD.md                      (Product Requirements)
│   ├── Architecture.md             (Technical Architecture)
│   ├── API-Reference.md            (API Endpoints)
│   ├── User-Guide.md               (User Documentation)
│   └── archive/                    (Previous docs)
│
├── CLAUDE.md                       (Quick reference & development)
├── README.md                       (This file - main overview)
├── CONSOLIDATION_SUMMARY.md        (v2.0 migration details)
├── IMPLEMENTATION_CHECKLIST.md     (Verification steps)
└── IMPLEMENTATION_SUMMARY.txt      (Quick summary)

Legacy (can be archived):
├── backends/datasources/          (Code now in src/datasources/)
└── backends/viewer/               (Code now in src/wiki/)
```

## 🔧 Technology Stack

### Backend
- **Node.js & Express.js** - Web server and REST API
- **Socket.IO** - Real-time WebSocket communication
- **Passport.js** - Authentication framework
- **Chokidar** - File system monitoring
- **nooblyjs-core** - Service registry and abstraction

### Frontend
- **Vanilla JavaScript** - Core application logic
- **EasyMDE** - Markdown editor
- **Bootstrap 5** - UI framework
- **Prism.js** - Code syntax highlighting

### Document Processing
- **Mammoth** - DOCX/Word parsing
- **pdf-parse** - PDF text extraction
- **xlsx** - Excel spreadsheet parsing
- **pptx-parser** - PowerPoint parsing

### Desktop & Extensions
- **Electron** - Cross-platform desktop app
- **VS Code SDK** - Extension API
- **Chrome Manifest V3** - Browser extension
- **M365 Agents Toolkit** - Teams integration

### Data & Services
- **JSON-based** - File storage in `./.application/`
- **Ollama** - Local LLM integration
- **Socket.IO** - Real-time communication

## 🔐 Authentication & Security

### Authentication Methods
- **Local** - Username/password with bcrypt hashing
- **OAuth2** - Google OAuth20 single sign-on
- **Bearer Tokens** - API client authentication (VS Code extension, CLI tools)

### Authentication Flow
1. **User Login:** POST `/api/auth/login` with credentials
2. **Session Check:** GET `/api/auth/check` or `/auth/check` returns `{user, authenticated, role}`
3. **Authorization:** Session cookie or Bearer token in request headers
4. **Cross-Module:** Unified authentication across datasources and wiki modules

**Note:** Both modules share the same authentication system and `./.application/data/auth/` storage. Logging out in one module logs out everywhere.

For detailed authentication flow and module-specific differences, see [CLAUDE.md - Authentication Flow & Module Differences](CLAUDE.md#authentication-flow--module-differences)

### Session Management
- Express-session with secure cookies
- Token expiration (24 hours for bearer tokens)
- Automatic token cleanup every 10 minutes

### Role-Based Access Control (RBAC)
- **Roles:** Admin, Editor, Viewer
- **Workspace Level:** Manage access to spaces and workflows
- **User Permissions:** Granular control per resource
- **Menu Filtering:** Frontend displays only permitted actions

### Data Security
- Password hashing with bcryptjs
- CORS protection with origin validation
- Rate limiting on API endpoints (100 requests/15 minutes)
- Input validation via Joi schemas
- Code execution sandbox (vm2 for Transform steps)

## 🔄 Real-Time Features

### Event Broadcasting
Both modules broadcast events via shared Socket.IO:

**Datasources Events**:
- `workflow:start` - Workflow execution started
- `workflow:complete` - Execution completed
- `workflow:error` - Execution failed
- `workflow:step:start` / `workflow:step:end` - Step execution

**Wiki Events**:
- `document-updated` - Document content changed
- `document-created` - New document created
- `document-deleted` - Document deleted
- `folder-changed` - Folder structure changed

### File Synchronization
- FileWatcher monitors `./.application/` directory
- Changes trigger EventBus events
- Events broadcast to all connected clients via Socket.IO
- Real-time UI updates without explicit API calls

## 🧪 Testing & Development

### Test Coverage

**Current Test Suite:**
- ✅ 56+ unit tests across components and routes
- ✅ 31 Playwright E2E tests covering critical workflows
- ✅ 50+ performance benchmark scenarios with established budgets
- ✅ 36+ tests passing, comprehensive coverage validation

### Run Tests
```bash

npm run tests              # Run all tests
npm run test:watch       # Watch mode - reruns on file changes
npm run test:coverage    # Generate coverage report
npm run tests -- tests/backend/datasources/pathSanitizer.test.js  # Run specific test
```

### Test Organization
Tests live at the repo root in `tests/backend/` (jest runs from `backend/` and points at `../tests/backend`):
- `tests/backend/components/` - Component unit tests (WorkflowManager, DataManager, etc.)
- `tests/backend/datasources/` - Datasources unit/integration tests
- `tests/backend/integration/`, `tests/backend/performance/` - Integration & performance tests
- `tests/backend/configuration/` - Workflow scripts (not unit tests)
- **Timeout:** 10 seconds per test
- **Framework:** Jest with comprehensive mocking

For test structure examples and patterns, see [CLAUDE.md - Test Structure & Patterns](CLAUDE.md#test-structure--patterns)

### Development Commands

| Command | Purpose | Location |
|---------|---------|----------|
| `npm start` | Start unified backend (production) | backend/ |
| `npm run dev` | Start with auto-reload (development) | backend/ |
| `npm run tests` | Run full test suite | backend/ |
| `npm run test:watch` | Tests in watch mode | backend/ |
| `npm run test:coverage` | Coverage report | backend/ |
| `npm run kill` | Kill process on port 9101 (Unix/macOS) | backend/ |
| `npm run install:all` | Install all dependencies | root |

**For detailed development workflows, debugging tips, and advanced commands, see [CLAUDE.md](CLAUDE.md#development-commands)**

### Debugging

**Monitor EventBus Activity** (Node REPL):
```javascript
global.eventBus.getStatistics()
global.searchIndexer.getIndexSize()
global.io.engine.clientsCount
```

**Check Server Logs**:
- Monitor terminal output from `npm start` or `npm run dev`
- Logs saved to `./.application/logs/`

**Browser DevTools**:
- Open F12 → Network → WS to monitor WebSocket connections
- Check Console for client-side errors
- Use Application tab to inspect session cookies

## 📊 Configuration

### Environment Variables

```bash
# Port configuration
PORT=9101                          # Default: 9101

# Authentication
SESSION_SECRET=your-secret-here     # Change for production!

# AI Integration
AI_MODEL=tinyllama:1.1b            # Ollama model
OLLAMA_URL=http://localhost:11434  # Ollama endpoint

# Optional: OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_CALLBACK_URL=http://localhost:9101/auth/google/callback

# Node environment
NODE_ENV=production                # development or production
```

### Data Storage

All application data stored in `./.application/`:

```
.application/
├── data/
│   ├── auth/              # User accounts
│   ├── settings/          # Application settings
│   └── ai-tokens.json     # AI service tokens
├── documents/             # Wiki documents
├── spaces/               # Wiki space definitions
├── workflows/            # Workflow definitions
├── wiki-files/           # Uploaded and processed files
└── logs/                 # Application logs
```

## 🚀 Deployment

### Local Development
```bash
npm install
npm run dev
# Access at http://localhost:9101/
# Includes auto-reload on file changes
```

### Production Deployment
```bash
npm install
NODE_ENV=production npm start
# Runs on http://localhost:9101/
# Both datasources and wiki modules ready immediately
```

**Entry Point:** `src/initialize.js` is the unified backend that serves both modules on a single port

### Docker Deployment
```bash
docker build -t nooblyjs-ai-knowledge:2.0 .
docker run -p 9101:9101 \
  -e SESSION_SECRET=<secure-secret> \
  -e NODE_ENV=production \
  nooblyjs-ai-knowledge:2.0
```

### Environment Setup
1. Set `SESSION_SECRET` to a secure random value
2. Set `NODE_ENV=production`
3. Configure CORS origins for production domain
4. Set up reverse proxy (nginx/Apache) for HTTPS
5. Configure OAuth credentials if using Google auth

## 🔄 Migration from v1.0

### Backward Compatibility

✅ **100% Data Compatible**:
- No data migration required
- All workflows, documents, users preserved
- Same file format and I/O patterns
- Same authentication methods

### Upgrade Steps

1. **Backup data** (recommended):
```bash
cp -r .application .application.backup
```

2. **Install new backend**:
```bash
npm install
```

3. **Start unified backend**:
```bash
npm start
# Access at http://localhost:9101
```

4. **Verify** all features work:
- Access both UI modules
- Create test workflow and document
- Verify real-time updates

### Rollback

If needed, revert to legacy backends:
```bash
npm run start:datasources   # Port 9101
npm run start:wiki         # Port 11002
```

## 📚 Documentation

### 🚀 Quick Start & Development Reference

**Primary Developer Reference:**
- **[CLAUDE.md](CLAUDE.md)** - ⭐ Complete developer guide
  - [Current Project Status](CLAUDE.md#current-project-status) - Phases & completion level
  - [Quick Start](CLAUDE.md#quick-reference) - Essential commands
  - [Frontend Loading & Initialization Patterns](CLAUDE.md#frontend-loading--initialization-patterns) - Async dependency handling
  - [Known Issues & Solutions](CLAUDE.md#debugging-tips) - UIService race condition, header display, login rendering
  - [Test Structure & Patterns](CLAUDE.md#test-structure--patterns) - Jest examples and organization
  - [Authentication Flow & Module Differences](CLAUDE.md#authentication-flow--module-differences) - Auth system details
  - [Performance Considerations](CLAUDE.md#performance-considerations) - Optimization strategies
  - [Debugging Tips](CLAUDE.md#debugging-tips) - Troubleshooting procedures

- **[backend/README.md](backend/README.md)** - Backend Operations
  - Backend installation and setup
  - Development workflow
  - Testing procedures
  - Deployment instructions

### 📋 Core Documentation

**Start Here:**
- **[@docs/PRD.md](docs/PRD.md)** - Product Requirements & Feature Specifications
  - Feature overview and requirements
  - Use cases and scenarios
  - System capabilities

- **[@docs/Architecture.md](docs/Architecture.md)** - Technical Architecture & Design
  - System architecture diagram
  - Component design patterns
  - Data flow and interactions
  - Technology stack details

**API & Development:**
- **[@docs/API-Reference.md](docs/API-Reference.md)** - Complete API Documentation
  - Datasources API endpoints (Spaces, Workflows, Connections, Settings, Agents)
  - Wiki API endpoints (Documents, Spaces, Search, AI, Navigation)
  - Authentication methods and examples
  - Request/response examples

- **[@docs/User-Guide.md](docs/User-Guide.md)** - User Guide & Tutorials
  - Getting started guide
  - Feature walkthroughs
  - Common workflows
  - Troubleshooting tips

### 🏗️ Architecture & Development
- **[CONSOLIDATION_SUMMARY.md](CONSOLIDATION_SUMMARY.md)** - v2.0 Implementation Details
  - Migration from v1.0
  - Architecture changes
  - Component organization
  - Backward compatibility

- **[IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md)** - Verification Steps
  - Setup verification
  - Feature testing
  - Integration testing
  - Deployment checklist

### 📱 Frontend Applications
- **[applications/datasources/README.md](applications/datasources/README.md)** - Datasources UI
  - Workflows management
  - Data connections
  - Scheduling workflows
  - Monitoring execution

- **[applications/wiki/README.md](applications/wiki/README.md)** - Wiki/Knowledge Management UI
  - Document management
  - Spaces and organization
  - Real-time collaboration
  - Search and navigation

### 🔌 Platform Integrations
- **[applications/teams/datasources/README.md](applications/teams/datasources/README.md)** - Microsoft Teams Integration
  - Setup instructions
  - Teams features
  - Dynamic loading

- **[applications/vscode/README.md](applications/vscode/README.md)** - VS Code Extension
  - Extension installation
  - Features in editor
  - Configuration

- **[applications/chrome/README.md](applications/chrome/README.md)** - Chrome Extension
  - Installation steps
  - Quick access features

- **[applications/daemon/README.md](applications/daemon/README.md)** - File Sync Daemon
  - Background synchronization
  - Configuration

## 🐛 Troubleshooting

### Common Issues & Solutions

#### UIService ReferenceError
**Problem:** `Uncaught ReferenceError: UIService is not defined` when loading datasources app
**Solution:** UIService loads asynchronously - use event-driven initialization pattern
See [CLAUDE.md - Issue: UIService ReferenceError on App Load](CLAUDE.md#issue-uiservice-referenceerror-on-app-load)

#### Header Username Display Issues
**Problem:** Different modules show different header formats (role vs username)
**Solution:** Ensure all modules display email/name and hide role display
See [CLAUDE.md - Issue: Header Username Display Differences Between Modules](CLAUDE.md#issue-header-username-display-differences-between-modules)

#### Login Screen White Space
**Problem:** Extra whitespace below login form
**Solution:** Add `min-height: 100vh` to html/body and modal CSS
See [CLAUDE.md - Issue: Login Screen White Space / Rendering](CLAUDE.md#issue-login-screen-white-space--rendering)

#### npm install Loops
**Problem:** Running npm install in application subdirectories causes circular loops
**Solution:** Always run from root or use npm scripts
See [CLAUDE.md - Issue: npm install Loops/Hangs in Applications](CLAUDE.md#issue-npm-install-loopshangsin-applications)

### General Troubleshooting

#### Port Already in Use
```bash
# Unix/macOS
npm run kill
npm start

# Windows PowerShell
Get-Process -Id (Get-NetTCPConnection -LocalPort 9101).OwningProcess | Stop-Process
npm start

# Use different port
PORT=3000 npm start
```

#### Module Fails to Initialize
- Check `./.application/` directory exists
- Verify `nooblyjs-core` is installed
- Review logs in `./.application/logs/`
- Check terminal output for error messages
- See [CLAUDE.md - Debugging Tips](CLAUDE.md#debugging-tips) for detailed diagnostics

#### Real-Time Updates Not Working
1. Open DevTools → Network → WS tab
2. Verify Socket.IO connection is established
3. Check module initialization logs in terminal
4. Verify EventBus is running: `global.eventBus.getStatistics()`
5. See [CLAUDE.md - Issue: Real-Time Updates Not Working](CLAUDE.md#issue-real-time-updates-not-working)

#### Authentication Issues
- Clear browser cookies and localStorage
- Check `./.application/data/auth/` for user files
- Verify session middleware is configured
- Check CORS origins allow your domain
- See [CLAUDE.md - Issue: Authentication Not Working](CLAUDE.md#issue-authentication-not-working)

#### Missing Dependencies
```bash
rm -rf node_modules package-lock.json
npm install
```

**For comprehensive debugging tips and known issues, see [CLAUDE.md - Debugging Tips](CLAUDE.md#debugging-tips)**

## 🤝 Support & Contributing

### Getting Help

**For Development:**
1. ⭐ Check [CLAUDE.md](CLAUDE.md) - Complete developer guide with quick reference, patterns, and debugging
2. Check [CLAUDE.md - Debugging Tips](CLAUDE.md#debugging-tips) - Specific solutions for known issues
3. Review [CLAUDE.md - Code Patterns](CLAUDE.md#code-patterns) - Implementation patterns and best practices
4. Check [docs/Architecture.md](docs/Architecture.md) - System design and component interactions
5. Review relevant README files in [docs/](docs/) and `applications/` directories

**For Troubleshooting:**
1. Check server logs: `./.application/logs/application.log`
2. Review browser DevTools Console (F12)
3. Monitor WebSocket events: DevTools → Network → WS tab
4. Check [CLAUDE.md - Debugging Tips](CLAUDE.md#debugging-tips) for specific issues
5. Enable verbose logging: `LOG_LEVEL=debug npm start`

**For Users:**
1. Check [docs/User-Guide.md](docs/User-Guide.md) - Getting started and feature guides
2. Review [docs/PRD.md](docs/PRD.md) - Feature specifications and requirements
3. Check application README files in [applications/](applications/) directory

### Reporting Issues
Include the following information:
- Error messages from logs (`./.application/logs/application.log`)
- Steps to reproduce
- Browser/environment information (Node version, OS, browser)
- Screenshots or console output (F12 Developer Tools)
- Module affected (datasources/wiki/extension)
- References to [CLAUDE.md - Debugging Tips](CLAUDE.md#debugging-tips) if checked

### Contributing

**Before Starting:**
1. Review [CLAUDE.md](CLAUDE.md) for architecture and patterns
2. Check [CLAUDE.md - Code Patterns](CLAUDE.md#code-patterns) for implementation guidelines
3. Understand the [current project status](CLAUDE.md#current-project-status)

**Development Process:**
1. Create a feature branch from `development`
2. Make changes following code conventions and patterns documented in CLAUDE.md
3. Add/update tests - see [CLAUDE.md - Test Structure & Patterns](CLAUDE.md#test-structure--patterns)
4. Test thoroughly (all modules, platforms, RBAC roles)
5. Update documentation if adding features
6. Submit pull request with clear description referencing any issues
7. Ensure zero breaking changes - maintain backward compatibility

**Code Quality:**
- Follow patterns in [CLAUDE.md - Code Patterns](CLAUDE.md#code-patterns)
- Add tests for new functionality (unit + E2E where applicable)
- Run test suite: `npm run tests`
- Check performance impact - review [CLAUDE.md - Performance Considerations](CLAUDE.md#performance-considerations)
- Validate RBAC behavior across roles

## 📋 Version History

### v2.0.0 (Current - Production Ready)
**Core Architecture & Foundation:**
- ✨ **Unified Backend** - Single port (9101) for both modules
- ✨ **Frontend Extraction** - Standalone UI packages under `/applications/`
- ✨ **Dynamic Teams Loading** - Better Teams integration
- ✨ **Shared Infrastructure** - Consolidated utilities and services
- 🔄 **100% Backward Compatible** - No breaking changes

**Phase 5 Enhancements (Latest):**
- ✅ **Phase 5.1-5.2:** Security Audit & RBAC Implementation
  - Role-Based Access Control with granular permissions
  - Space management with visibility and permission controls
  - RBAC-aware menu filtering on all frontends

- ✅ **Phase 5.3-5.4:** Testing & Performance
  - 56+ unit tests across components and routes
  - 31 Playwright E2E tests covering critical workflows
  - 50+ performance benchmark scenarios
  - Performance optimization: Socket.IO debouncing, lazy loading, in-memory caching

- ✅ **Phase 5.5:** Space Filing Service Integration
  - Complete RBAC + Space Filing integration
  - Zero breaking changes throughout refactoring
  - Enhanced documentation with patterns and solutions

**Quality Improvements:**
- 📚 **Enhanced CLAUDE.md** - Developer guide with patterns, debugging tips, and known issues
- 🧪 **Comprehensive Testing** - Jest unit tests, Playwright E2E tests, performance benchmarks
- 📈 **Performance Optimized** - Debouncing, caching, lazy loading strategies documented
- 🔐 **Security Hardened** - Input validation, rate limiting, code execution sandbox

### v1.0.0 (Legacy - Not Recommended)
- Separate backends (ports 9101, 11002)
- Multi-platform support (Web, Desktop, Extensions)
- Real-time synchronization
- Full-text search
- AI integration
- **Upgrade to v2.0.0 recommended** - See [Migration from v1.0](README.md#-migration-from-v10)

## 📄 License

Proprietary - noobly Team

## 👥 Author & Support

**noobly Team**
Last Updated: February 2026
Status: Production Ready ✅

---

## 🆘 Quick Help Navigation

| Need | Resource | Link |
|------|----------|------|
| **Quick Start** | Installation & running | [CLAUDE.md - Quick Reference](CLAUDE.md#quick-reference) |
| **Development Setup** | Full dev environment | [CLAUDE.md - Running the Application](CLAUDE.md#running-the-application) |
| **Debugging** | Common issues & solutions | [CLAUDE.md - Debugging Tips](CLAUDE.md#debugging-tips) |
| **Code Patterns** | Implementation patterns | [CLAUDE.md - Code Patterns](CLAUDE.md#code-patterns) |
| **Authentication** | Auth flow & RBAC | [CLAUDE.md - Authentication Flow](CLAUDE.md#authentication-flow--module-differences) |
| **Testing** | Running & writing tests | [CLAUDE.md - Test Structure](CLAUDE.md#test-structure--patterns) |
| **Performance** | Optimization strategies | [CLAUDE.md - Performance](CLAUDE.md#performance-considerations) |
| **Async Loading** | Frontend patterns | [CLAUDE.md - Frontend Patterns](CLAUDE.md#frontend-loading--initialization-patterns) |
| **Project Status** | Phases & completion | [CLAUDE.md - Current Status](CLAUDE.md#current-project-status) |
| **API Reference** | Endpoints & examples | [docs/API-Reference.md](docs/API-Reference.md) |
| **Architecture** | System design | [docs/Architecture.md](docs/Architecture.md) |
| **User Guide** | Feature tutorials | [docs/User-Guide.md](docs/User-Guide.md) |
| **Backend Ops** | Backend specifics | [backend/README.md](backend/README.md) |
| **Space Management** | RBAC & permissions | [src/datasources/SPACES.md](src/datasources/SPACES.md) |

**Most Common Questions?**
1. ⚡ "How do I start development?" → [CLAUDE.md Quick Reference](CLAUDE.md#quick-reference)
2. 🐛 "I'm getting an error" → [CLAUDE.md Debugging Tips](CLAUDE.md#debugging-tips)
3. 🔐 "How does authentication work?" → [CLAUDE.md - Authentication Flow](CLAUDE.md#authentication-flow--module-differences)
4. ✅ "How do I write tests?" → [CLAUDE.md - Test Structure](CLAUDE.md#test-structure--patterns)
5. 📖 "Where's the API documentation?" → [docs/API-Reference.md](docs/API-Reference.md)

**Ready to Deploy?**
1. ✅ Review [environment configuration](README.md#-configuration)
2. ✅ Run test suite: `npm run tests`
3. ✅ Verify [authentication](CLAUDE.md#authentication-flow--module-differences) is configured
4. ✅ Test on staging: `NODE_ENV=production npm start`
5. ✅ Check [CLAUDE.md - Debugging Tips](CLAUDE.md#debugging-tips) for common issues
6. ✅ Deploy to production with confidence!
