# Product Requirements Document
## noobly Wiki Platform v2.0

**Version**: 2.0.0
**Status**: Production Ready
**Last Updated**: February 2026
**Product Owner**: noobly Team

---

  ```summary                                                                                                                                                                                                                  
  This is the summary of the document. It supports **markdown** formatting.
  ```


## Executive Summary

The noobly Wiki Platform v2.0 is a unified, enterprise-grade application that combines workflow automation and knowledge management into a single, seamlessly integrated system. The platform enables organizations to design and execute complex data workflows while maintaining a centralized, searchable wiki with real-time collaboration capabilities.

**Key Promise**: One unified backend serving two powerful applications—workflow automation and knowledge management—with zero data migration from v1.0.

---

## Product Vision

### Problem Statement
Organizations struggle with disconnected tools:
- Workflow automation platforms isolated from knowledge repositories
- Real-time synchronization broken across tools
- Multiple authentication systems and interfaces
- Inability to execute complex workflows while accessing related documentation

### Solution
A unified platform that:
- Combines workflow automation (datasources) with knowledge management (wiki)
- Runs on a single port with shared infrastructure
- Maintains real-time synchronization across all platforms
- Provides seamless multi-platform access (web, desktop, extensions)
- Enables AI-powered content generation and workflow assistance

---

## Product Requirements

### 1. Functional Requirements

#### 1.1 Workflow Automation Module (Datasources)

**Workflow Management**
- [ ] Create, edit, and delete workflows
- [ ] Visual workflow builder with drag-and-drop interface
- [ ] Multi-step workflow support (sequential and parallel execution)
- [ ] Conditional logic and branching (if/then/else)
- [ ] Error handling and retry mechanisms
- [ ] Workflow versioning and revision history

**Data Connections**
- [ ] Support multiple connection types:
  - [ ] Local filesystem
  - [ ] FTP/SFTP
  - [ ] AWS S3
  - [ ] Git repositories
  - [ ] REST APIs
  - [ ] Cloud storage (Google Drive, OneDrive)
- [ ] Connection testing and validation
- [ ] Secure credential storage
- [ ] Connection status monitoring

**Workflow Execution**
- [ ] On-demand workflow execution
- [ ] Scheduled execution (cron-based)
- [ ] Real-time execution monitoring
- [ ] Step-by-step execution tracking
- [ ] Execution history and logs
- [ ] Execution cancellation

**AI Integration**
- [ ] Multi-provider AI support:
  - [ ] Claude (via Anthropic API)
  - [ ] ChatGPT (via OpenAI API)
  - [ ] Ollama (local LLM)
  - [ ] Google Gemini
- [ ] AI agent configuration
- [ ] Prompt templates and customization
- [ ] AI context generation from documents

**Settings & Configuration**
- [ ] Application-wide settings management
- [ ] Agent configuration and management
- [ ] Notification preferences
- [ ] Security settings
- [ ] API key management

**Dashboard**
- [ ] Workflow execution summary
- [ ] Recent execution history
- [ ] Performance metrics
- [ ] Error rates and troubleshooting
- [ ] Quick action buttons

#### 1.2 Knowledge Management Module (Wiki)

**Document Management**
- [ ] Create, edit, and delete documents
- [ ] Markdown editor with live preview
- [ ] Document versioning
- [ ] Document metadata (author, created date, last modified)
- [ ] Document permissions and sharing
- [ ] Trash/recovery functionality

**Organization**
- [ ] Wiki spaces (organizational containers)
- [ ] Folder hierarchy within spaces
- [ ] Breadcrumb navigation
- [ ] Document sorting and filtering

**Content Import**
- [ ] Multi-format support:
  - [ ] PDF text extraction
  - [ ] DOCX (Word documents)
  - [ ] XLSX (Excel spreadsheets)
  - [ ] PPTX (PowerPoint presentations)
  - [ ] Plain text files
- [ ] Batch import capability
- [ ] Import validation and error reporting

**Search & Discovery**
- [ ] Full-text search across all documents
- [ ] Advanced search filters (date, author, space)
- [ ] Search result highlighting
- [ ] Saved searches
- [ ] Search suggestions and autocomplete
- [ ] Real-time indexing

**Collaboration**
- [ ] Multi-user access
- [ ] Real-time document synchronization
- [ ] Concurrent editing notifications
- [ ] User activity tracking

**AI Features**
- [ ] AI-powered content generation
- [ ] Contextual AI chat about document content
- [ ] Automatic context generation
- [ ] AI-assisted writing suggestions
- [ ] Document summarization

#### 1.3 Authentication & Security

**Authentication Methods**
- [ ] Local authentication (username/password)
- [ ] Google OAuth2 single sign-on
- [ ] Session management
- [ ] Bearer token authentication (for API clients)
- [ ] Token expiration and refresh

**Authorization**
- [ ] Role-based access control (admin, user, viewer)
- [ ] Document-level permissions
- [ ] Space-level access control
- [ ] API endpoint authentication

**Security**
- [ ] Password hashing (bcryptjs)
- [ ] CORS protection
- [ ] Rate limiting on API endpoints
- [ ] Input validation and sanitization
- [ ] Secure session cookies
- [ ] HTTPS support

#### 1.4 Real-Time Features

**Socket.IO Communication**
- [ ] Real-time document updates
- [ ] Workflow execution status updates
- [ ] User activity notifications
- [ ] Presence indicators
- [ ] Connection status management

**File Synchronization**
- [ ] Automatic file change detection
- [ ] Event broadcasting to connected clients
- [ ] Multi-client synchronization
- [ ] Conflict resolution

#### 1.5 Multi-Platform Access

**Web Application**
- [ ] Modern, responsive web UI
- [ ] All features accessible
- [ ] Cross-browser compatibility
- [ ] Mobile-friendly design

**Desktop Application (Electron)**
- [ ] Windows installer (NSIS)
- [ ] macOS installer (DMG)
- [ ] Linux installer (AppImage)
- [ ] Native file system integration
- [ ] Offline capability

**VS Code Extension**
- [ ] Document search and navigation
- [ ] In-editor document preview
- [ ] Quick reference sidebar
- [ ] Bear token authentication
- [ ] Workspace synchronization

**Chrome Extension**
- [ ] Quick reference popup
- [ ] Document search
- [ ] Read-only access
- [ ] Configurable backend URL

**Microsoft Teams Integration**
- [ ] Integrated Teams tab
- [ ] Dynamic script loading
- [ ] Full UI rendering in Teams
- [ ] Teams authentication

**File Sync Daemon**
- [ ] Background file monitoring
- [ ] Automatic synchronization
- [ ] Folder watching
- [ ] Conflict resolution

### 2. Non-Functional Requirements

#### 2.1 Performance

- [ ] **Backend Response Time**: < 200ms for API endpoints
- [ ] **Search Response Time**: < 500ms for full-text search
- [ ] **Real-Time Update Latency**: < 1s from file change to UI update
- [ ] **Concurrent Users**: Support 50+ simultaneous users
- [ ] **Document Limit**: Support 1000+ documents without performance degradation
- [ ] **Workflow Execution Time**: No timeout for workflows < 30 minutes

#### 2.2 Reliability

- [ ] **Uptime**: 99% availability
- [ ] **Data Integrity**: All data persisted to JSON files
- [ ] **Error Recovery**: Graceful error handling with user-friendly messages
- [ ] **Backup Strategy**: Backup `./.application/` directory regularly
- [ ] **Logging**: Comprehensive logging of all operations

#### 2.3 Scalability

- [ ] **Horizontal Scaling**: Can run multiple backend instances behind load balancer
- [ ] **Data Scaling**: JSON-based storage scalable to 10,000+ documents
- [ ] **Connection Pooling**: Efficient socket connection management
- [ ] **Resource Usage**: Efficient memory and CPU usage

#### 2.4 Usability

- [ ] **Intuitive Interface**: Minimal learning curve
- [ ] **Accessibility**: WCAG 2.1 Level AA compliance
- [ ] **Documentation**: Comprehensive user guides and FAQs
- [ ] **Error Messages**: Clear, actionable error messages
- [ ] **Help System**: In-app help and tooltips

#### 2.5 Security

- [ ] **Data Encryption**: Passwords hashed with bcryptjs
- [ ] **Transport Security**: HTTPS support
- [ ] **Session Security**: Secure cookie flags
- [ ] **API Security**: Rate limiting and request validation
- [ ] **Audit Logging**: Track all user actions

#### 2.6 Compatibility

- [ ] **Browser Support**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- [ ] **Node.js Version**: v14+
- [ ] **Operating Systems**: Windows, macOS, Linux
- [ ] **Package Manager**: npm or yarn

### 3. Data Requirements

#### 3.1 Data Storage
- [ ] JSON file-based storage in `./.application/` directory
- [ ] No database required
- [ ] Suitable for teams up to 100 users, 1000+ documents

#### 3.2 Data Structures
- [ ] Documents: Markdown content with metadata
- [ ] Spaces: Organization containers
- [ ] Workflows: Configuration and execution history
- [ ] Users: Authentication and profile information
- [ ] Settings: Application and user preferences

#### 3.3 Data Management
- [ ] Regular backups of `./.application/` directory
- [ ] Export functionality for documents and workflows
- [ ] Import functionality for bulk operations
- [ ] Data integrity validation

### 4. Integration Requirements

#### 4.1 External Systems
- [ ] Google OAuth2 integration (optional)
- [ ] Ollama local LLM integration
- [ ] Cloud storage providers (S3, Google Drive, OneDrive)
- [ ] Git repository integration
- [ ] REST API endpoints for custom integrations

#### 4.2 Service Registry
- [ ] `digital-technologies-core` dependency
- [ ] Service abstraction layer for:
  - [ ] Authentication
  - [ ] File I/O
  - [ ] Caching
  - [ ] Logging
  - [ ] Queuing
  - [ ] Search indexing
  - [ ] AI integration

---

## Technical Architecture

### 4.1 Unified Backend Architecture
- **Single Entry Point**: `src/initialize.js` on port 11000 (unified backend)
- **Two Modules**: Datasources + Wiki (independent but share infrastructure)
- **Shared Services**: Service registry from `digital-technologies-core`
- **Real-Time Communication**: Single Socket.IO instance for both modules
- **Authentication**: Unified Passport-based authentication
- **Legacy Support**: Legacy entry points available on ports 11002 (datasources) and 11003 (wiki)

### 4.2 Module Separation
- **Datasources Module** (`src/datasources/`)
  - Route namespace: `/api/workflows/*`
  - WorkflowBridge for execution
  - Event broadcasting for real-time updates

- **Wiki Module** (`src/wiki/`)
  - Route namespace: `/applications/wiki/api/*`
  - DataManager for file operations
  - EventBus for change notifications

### 4.3 Frontend Applications
- **src/web/datasources**: Datasources/Workflows UI (dev port 3001)
- **src/web/wiki**: Wiki/Knowledge Management UI (dev port 3002)
- **applications/teams**: Microsoft Teams integration (datasources and wiki tabs)
- **applications/vscode/wiki**: VS Code extension for wiki access
- **applications/chrome/wiki**: Chrome browser extension for quick reference
- **applications/daemon/wiki**: Background file synchronization daemon
- All UIs served from unified backend; standalone dev servers optional for UI development

### 4.4 Technology Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Real-Time**: Socket.IO
- **Authentication**: Passport.js
- **Database**: JSON files (no SQL database)
- **File Monitoring**: Chokidar
- **Document Processing**: Mammoth, pdf-parse, xlsx, pptx-parser
- **Frontend**: Vanilla JavaScript, EasyMDE, Bootstrap

---

## User Stories & Use Cases

### Workflow Automation Use Cases

**UC-1: Create and Execute Data Pipeline**
- User designs a workflow connecting FTP → Data Processing → S3
- Workflow executes on schedule (daily)
- Real-time status updates show processing progress
- Logs stored in execution history

**UC-2: Integrate AI into Workflow**
- User adds Claude AI agent to workflow for content analysis
- AI generates summaries and classifications
- Results stored in connected systems

**UC-3: Monitor Workflow Performance**
- User views dashboard with execution metrics
- Identifies bottlenecks and errors
- Receives notifications on failures

### Knowledge Management Use Cases

**UC-4: Create Team Documentation**
- User creates wiki space for project documentation
- Team members collaborate in real-time
- Documents searchable by all users
- Changes synchronized to all viewers

**UC-5: Import External Documents**
- User uploads PDF, Word, or Excel files
- Content automatically extracted and indexed
- Integrated with existing wiki
- Full-text search available immediately

**UC-6: AI-Powered Content Assistance**
- User asks Claude questions about document content
- AI generates summaries, extracts key points
- User refines and publishes improvements

### Cross-Platform Use Cases

**UC-7: Desktop App for Offline Access**
- User opens desktop app (Electron)
- All wiki documents and workflows available offline
- Syncs automatically when reconnected

**UC-8: VS Code Extension Documentation**
- Developer opens VS Code extension
- Searches wiki directly from IDE
- References documentation while coding

---

## Success Metrics

### User Adoption
- [ ] 80%+ user activation within 30 days
- [ ] 60%+ daily active users
- [ ] 40%+ weekly feature usage

### Performance
- [ ] API response time < 200ms (95th percentile)
- [ ] Search response time < 500ms
- [ ] Real-time update latency < 1 second

### Reliability
- [ ] 99%+ uptime
- [ ] Zero data loss incidents
- [ ] < 0.1% API error rate

### User Satisfaction
- [ ] > 4.0/5.0 user satisfaction rating
- [ ] < 5% churn rate
- [ ] > 80% feature discoverability

---

## Release Strategy

### v2.0 (Current)
- [x] Unified backend consolidation
- [x] Module initialization pattern
- [x] Frontend extraction
- [x] Teams integration with dynamic loading
- [x] 100% backward compatibility

### v2.1 (Planned)
- [ ] Document versioning
- [ ] Enhanced AI integrations
- [ ] Advanced workflow templates
- [ ] Performance optimizations

### v3.0 (Future)
- [ ] Database backend option
- [ ] Collaborative editing
- [ ] React migration for frontends
- [ ] Docker containerization

---

## Constraints & Assumptions

### Constraints
- [ ] No external database required (JSON-based)
- [ ] Single-server deployment (no clustering)
- [ ] Local LLM integration (Ollama)
- [ ] File-based authentication (no LDAP/Active Directory)

### Assumptions
- [ ] Teams have < 100 users
- [ ] Document count < 1000
- [ ] File system available and writable
- [ ] Network connectivity available
- [ ] HTTPS can be configured via reverse proxy

### Dependencies
- [ ] `digital-technologies-core` package (sibling)
- [ ] Node.js v14+
- [ ] Ollama (for AI features)

---

## Risk Assessment

### High Priority Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Data Loss | Critical | Low | Regular backups, file versioning |
| Real-time Sync Failure | High | Low | Comprehensive testing, fallback polling |
| Auth Bypass | High | Very Low | Security audit, rate limiting |
| Performance Degradation | Medium | Medium | Load testing, optimization |

### Medium Priority Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| User Interface Confusion | Medium | Medium | User testing, documentation |
| Workflow Timeout | Medium | Low | Timeout configuration, queueing |
| File Lock Conflicts | Low | Low | File watcher debouncing |

---

## Acceptance Criteria

### For v2.0 Release

- [x] All features from v1.0 available on unified backend
- [x] Zero data migration required from v1.0
- [x] Datasources module initializes without errors
- [x] Wiki module initializes without errors
- [x] Both modules accessible on port 11000
- [x] Real-time events broadcast to both module clients
- [x] Authentication works across both modules
- [x] Frontend packages extracted and serving correctly
- [x] Teams app loads datasources UI dynamically
- [x] All legacy entry points (11001, 11002) functional
- [x] Comprehensive documentation (CLAUDE.md, README.md, API docs)
- [x] Test suite passes

### For User Acceptance

- [ ] Workflow creation and execution functional
- [ ] Document search returns accurate results
- [ ] Real-time updates visible within 1 second
- [ ] No data loss during extended usage
- [ ] Authentication methods working (local + OAuth)
- [ ] Multi-platform access functional (web, desktop, extensions)
- [ ] Performance acceptable (< 200ms response times)
- [ ] Error messages clear and actionable

---

## Glossary

| Term | Definition |
|------|-----------|
| Datasources Module | Workflow automation and data integration module |
| Wiki Module | Knowledge management and document repository module |
| Service Registry | Dependency injection container from digital-technologies-core |
| EventBus | Pub/Sub system for real-time change notifications |
| FileWatcher | Chokidar-based file system change detector |
| Socket.IO | WebSocket library for real-time communication |
| Passport | Authentication middleware |
| DataManager | JSON file abstraction layer |
| Unified Backend | Single Express server on port 11000 running both modules |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.0.0 | Feb 2026 | noobly Team | Unified backend consolidation |
| 1.0.0 | Jan 2026 | noobly Team | Initial product requirements |

---

## Sign-Off

**Product Owner**: _________________________
**Engineering Lead**: _________________________
**QA Lead**: _________________________
**Release Manager**: _________________________

---

**Document Status**: ✅ APPROVED FOR PRODUCTION
**Last Review Date**: February 2026
**Next Review Date**: May 2026
