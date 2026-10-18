# Wiki Module - Knowledge Management

The Wiki module provides collaborative knowledge management capabilities, enabling teams to create, organize, search, and share documents with real-time synchronization and AI-powered assistance.

## Module Overview

**Purpose:** Collaborative knowledge management and documentation  
**Port:** 9101 (when running unified backend)  
**Entry Point:** `src/wiki/initialize.js`  
**Primary Routes:** `/applications/wiki/api/`  
**Route Base:** All wiki routes prefixed with `/applications/wiki/api/`

## Core Components

### DataManager
Manages document and folder CRUD operations. Handles persistence, retrieval, and organization of knowledge content.

```javascript
const dataManager = new DataManager(baseDir);
const document = await dataManager.getDocument(docId);
```

### EventBus
Pub/Sub event system for real-time notifications. Events are broadcast to all connected clients via Socket.IO.

```javascript
eventBus.emit('document-updated', { path, content });
eventBus.on('document-created', (event) => {});
```

### FileWatcher
Monitors the filesystem for changes and emits events. Enables real-time synchronization across all platforms.

```javascript
const watcher = new FileWatcher(documentsDir, eventBus);
watcher.start();
```

### SearchIndexer
Full-text search engine for documents. Maintains an inverted index for fast searching.

```javascript
const results = await searchIndexer.search('query');
```

### AIService
Integrates with AI models for content assistance, generation, and analysis.

```javascript
const response = await aiService.chat(prompt, context);
```

## API Endpoints

### Documents

```
GET    /applications/wiki/api/documents/              List documents
POST   /applications/wiki/api/documents/              Create document
GET    /applications/wiki/api/documents/:id           Get document
PUT    /applications/wiki/api/documents/:id           Update document
DELETE /applications/wiki/api/documents/:id           Delete document
POST   /applications/wiki/api/documents/upload        Upload file
GET    /applications/wiki/api/documents/content       Get document content
GET    /applications/wiki/api/documents/pdf-preview   Get PDF preview
```

### Document Discovery

```
GET    /applications/wiki/api/recent                  Get recent documents
GET    /applications/wiki/api/documents/popular       Get popular documents
```

### File Management

```
GET    /applications/wiki/api/spaces/:spaceId/file-content/:path(*)     Get file content
GET    /applications/wiki/api/spaces/:spaceId/download/:path(*)         Download file
POST   /applications/wiki/api/spaces/:spaceId/file-content/:path(*)     Create/update file
DELETE /applications/wiki/api/spaces/:spaceId/file-content/:path(*)     Delete file
GET    /applications/wiki/api/spaces/:spaceId/file-list/:path(*)        List files
GET    /applications/wiki/api/spaces/:spaceId/folder-tree               Get folder structure
```

### Folder Management

```
POST   /applications/wiki/api/folders                  Create folder
PUT    /applications/wiki/api/folders/rename           Rename folder
DELETE /applications/wiki/api/folders/:path(*)         Delete folder
POST   /applications/wiki/api/move                     Move item
PUT    /applications/wiki/api/documents/:id/move       Move document
PUT    /applications/wiki/api/documents/rename         Rename document
```

### Search

```
GET    /applications/wiki/api/search                  Search documents
GET    /applications/wiki/api/search/suggestions      Get search suggestions
GET    /applications/wiki/api/search/stats            Get search statistics
POST   /applications/wiki/api/search/rebuild          Rebuild search index
```

`/search/suggestions` answers with a mix of document objects
(`{title, path, spaceName, type}`, `path` space-relative) and bare index terms.
Add `documents=true` for document suggestions only — every item then carries a
resolvable path, and the folder path is matched as well as the file name.
Without it an unscoped request takes the core token service's fast path, which
returns terms and drops the path entirely. `fileTypes=markdown` narrows by
indexer type; `spaceId` and `folderPath` scope as they do on `/search`.

### Spaces

```
GET    /applications/wiki/api/spaces                  List spaces
POST   /applications/wiki/api/spaces                  Create space
GET    /applications/wiki/api/spaces/:id              Get space details
PUT    /applications/wiki/api/spaces/:id              Update space
DELETE /applications/wiki/api/spaces/:id              Delete space
GET    /applications/wiki/api/spaces/:id/documents    Get space documents
GET    /applications/wiki/api/spaces/:id/folders      Get space folders
GET    /applications/wiki/api/spaces/:id/templates    Get space templates
```

### AI Assistance

```
GET    /applications/wiki/api/ai/chat                 Get chat history
POST   /applications/wiki/api/ai/chat                 Chat with AI
DELETE /applications/wiki/api/ai/chat/:messageId      Delete message
POST   /applications/wiki/api/ai/chat/clear           Clear chat history
GET    /applications/wiki/api/settings/ai             Get AI settings
POST   /applications/wiki/api/settings/ai             Update AI settings
POST   /applications/wiki/api/settings/ai/test        Test AI settings
```

### User Features

```
GET    /applications/wiki/api/profile                 Get user profile
PUT    /applications/wiki/api/profile                 Update profile
POST   /applications/wiki/api/profile/change-password Change password
POST   /applications/wiki/api/profile/avatar          Upload avatar
GET    /applications/wiki/api/user/activity           Get user activity
POST   /applications/wiki/api/user/star               Star item
POST   /applications/wiki/api/user/visit              Record visit
GET    /applications/wiki/api/user/folder-view-preferences Get view preferences
POST   /applications/wiki/api/user/folder-view-preference  Set view preference
GET    /applications/wiki/api/user/selected-spaces    Get selected spaces
PUT    /applications/wiki/api/user/selected-spaces    Update selected spaces
```

### Authentication

```
POST   /api/auth/register             User registration
POST   /api/auth/login                User login
POST   /api/auth/logout               User logout
GET    /api/auth/check                Check auth status
POST   /api/auth/change-password      Change password
```

### General

```
GET    /applications/wiki/api/status                  Wiki status
GET    /applications/wiki/api/activity                Get activity log
POST   /applications/wiki/api/activity                Create activity entry
GET    /applications/wiki/media/:filename             Get media file
```

## Document Structure

### Basic Document

```json
{
  "id": "doc-123",
  "title": "API Documentation",
  "content": "# API Reference\n\n## Endpoints\n\n...",
  "path": "api/reference",
  "spaceId": "tech-docs",
  "tags": ["api", "documentation"],
  "visibility": "public",
  "createdAt": "2026-03-01T10:00:00Z",
  "updatedAt": "2026-03-31T14:30:00Z",
  "author": "user@example.com",
  "lastModifiedBy": "user@example.com"
}
```

### Folder Structure

```
spaceId/
├── folder1/
│   ├── document1.md
│   └── document2.md
├── folder2/
│   ├── subfolder/
│   │   └── document3.md
│   └── document4.md
└── document5.md
```

## Real-Time Events

The Wiki module emits events via EventBus which are broadcast via Socket.IO:

```javascript
socket.on('document-created', (event) => {
  // { id, path, title, spaceId, timestamp }
});

socket.on('document-updated', (event) => {
  // { id, path, content, spaceId, timestamp }
});

socket.on('document-deleted', (event) => {
  // { id, path, spaceId, timestamp }
});

socket.on('folder-changed', (event) => {
  // { folderPath, spaceId, timestamp }
});
```

## File Support

### Supported Formats

- **Markdown** - `.md` - Primary format
- **PDF** - `.pdf` - Document storage and preview
- **DOCX** - `.docx` - Microsoft Word (converted to Markdown)
- **XLSX** - `.xlsx` - Excel spreadsheets
- **PPTX** - `.pptx` - PowerPoint presentations
- **Images** - `.png`, `.jpg`, `.jpeg`, `.gif` - Embedded media
- **JSON** - `.json` - Structured data

### File Conversion

```javascript
// Convert DOCX to Markdown
const markdownContent = await fileProcessor.convertDocxToMarkdown(docxFile);

// Convert PDF to Markdown
const markdownContent = await fileProcessor.convertPdfToMarkdown(pdfFile);
```

## Search Capabilities

### Basic Search

```javascript
const results = await fetch(
  '/applications/wiki/api/search?q=query'
).then(r => r.json());
```

### Advanced Search Filters

- **Full-text search** - Search document content and titles
- **Tag filtering** - Filter by document tags
- **Space filtering** - Search within specific spaces
- **Type filtering** - Filter by document type
- **Date range** - Filter by creation/modification date

### Search Index

The SearchIndexer maintains an inverted index for fast full-text search:
- Updated incrementally as documents change
- Rebuilt periodically for consistency
- Supports phrase searching with quotes

### Searching binary documents (PDF / office)

A PDF has no text the index can read, so `shared/utils/filePolicy.js` splits the
three jobs apart — `{ view: 'original', download: 'original', search: 'markdown' }`:

| Job | What is used |
|---|---|
| View | the PDF itself, rendered natively (`showPdfViewer`) |
| Download | the PDF itself, untouched |
| Search | `<that PDF's folder>/.system/derived/<name>.pdf.md` |

The indexer reads the sidecar but **keys the document under the PDF's own path**
(`indexFileWithWrapper`), and skips sidecars as standalone documents
(`isDerivedRelPath`). So a content hit inside a PDF returns a result whose `path`
is the PDF — clicking it opens the PDF, never the extracted markdown. Office
documents differ only in the view: their markdown becomes the visible page and
the source moves to `.system/originals/`.

**Sidecars are written from two places, both via `utils/derivedSidecar.js`:**

1. **FileWatcher**, on add/change — covers everything uploaded or dropped while
   the backend is running.
2. **SearchIndexer**, during an index build — covers everything else. The watcher
   starts with `ignoreInitial: true`, so a PDF that was already on disk at boot
   (bulk-copied while the server was down, restored from backup, pulled into a
   folder that symlinks a git repo) never raises an event and would otherwise
   index by **file name only** — indistinguishable from working search until
   someone searches for a phrase inside the document. An index build is the one
   pass that visits every file, so it repairs missing and stale sidecars as it
   goes. Wired in `initialize.js`; set `WIKI_DERIVE_ON_INDEX=false` to keep
   builds read-only.

Conversion is skipped when the sidecar is already newer than its source, so this
costs one `stat` per binary document on subsequent builds.

**Repairing an existing corpus:** a normal boot loads the index from disk and
skips the walk, so trigger it explicitly once:

```bash
curl -X POST /applications/wiki/api/search/rebuild
```

**Checking the result:** `GET /applications/wiki/api/search/stats` returns a
`derived` block from the last build — `candidates` (documents needing a sidecar),
`generated`, `failed`, `unsupported` (`.pptx` has no Node-side converter) and
`withoutContent` (still name-only). The same numbers are logged as a one-line
summary at the end of every build.

#### Correcting a bad extraction

Extraction is automatic and fallible — scanned pages, multi-column layouts and
tables come out garbled — and what it produces is what people search. A PDF's
document view therefore carries a two-tab strip above the viewer:
**Document** (the rendered PDF) and **Extracted text** (the sidecar, editable).

The editor **autosaves** — there is no Save button. Edits flush after ~900ms of
quiet, on blur, on tab switch, on navigation and on `pagehide`; the tab strip's
status span reports `Saving…` / `Saved <time>`. A **Re-extract** button discards
the sidecar and converts again from the PDF.

```
GET  /applications/wiki/api/documents/derived?path=<original>&spaceName=<space>
PUT  /applications/wiki/api/documents/derived        { path, spaceName, content }
POST /applications/wiki/api/documents/derived/regenerate  { path, spaceName }
```

All three address the sidecar by its **original document's** path — no caller
knows the `.system/derived/<name>.<ext>.md` rule, which stays owned by
`filePolicy`. They resolve through `getDocumentAbsolutePath` with
`enforceVisibility`, so a document a space curates away cannot have its extracted
text read or rewritten through the side door.

Two behaviours worth knowing:

- **The PUT re-indexes the original itself.** `.system` is in the file watcher's
  ignore list (it has to be — the watcher writes sidecars, and watching them
  would loop), so writing the sidecar raises no event and nothing else would
  notice. Without the explicit `updateFileInSpace` call the correction would sit
  on disk while search kept answering from the old text. The cached search and
  suggestion pages are dropped for the same reason.
- **A correction survives later rebuilds.** Saving makes the sidecar newer than
  its source, so `sidecarStatus` reports `current` and the repair pass leaves it
  alone. Editing the *PDF* still supersedes the correction, which is right.

## AI Features

### Document Assistance

```javascript
// Ask AI about a document
const response = await fetch('/applications/wiki/api/ai/chat', {
  method: 'POST',
  body: JSON.stringify({
    documentId: 'doc-123',
    spaceId: 'tech-docs',
    message: 'Summarize this document'
  })
});
```

### Content Generation

```javascript
// Generate content based on context
const response = await fetch('/applications/wiki/api/ai/chat', {
  method: 'POST',
  body: JSON.stringify({
    message: 'Create a user guide for our API',
    context: documentContent
  })
});
```

### Supported AI Models

- **Ollama** - Local open-source models
- **OpenAI** - GPT models
- **Azure OpenAI** - Enterprise AI
- **Anthropic Claude** - Via API

## Spaces System

### Space Types

| Type | Purpose |
|------|---------|
| `documentation` | Team documentation |
| `knowledge-base` | Shared wiki |
| `project` | Project-specific docs |
| `team` | Team collaboration |
| `personal` | Personal documents |
| `archive` | Archived documents |

### Space Permissions

```javascript
{
  "visibility": "private",  // private, team, public
  "permissions": {
    "admin": ["read", "write", "delete", "manage"],
    "editor": ["read", "write"],
    "viewer": ["read"]
  },
  "allowedUsers": ["user@example.com"]
}
```

## Usage Examples

### Create a Document

```javascript
const document = {
  title: "Getting Started",
  content: "# Getting Started\n\nStep 1: Install...",
  spaceId: "documentation",
  path: "guides/getting-started",
  tags: ["guide", "onboarding"],
  visibility: "public"
};

const response = await fetch('/applications/wiki/api/documents/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(document)
});
```

### Upload a File

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('spaceId', 'documentation');
formData.append('path', '/uploads');

const response = await fetch(
  '/applications/wiki/api/documents/upload',
  { method: 'POST', body: formData }
);
```

### Search Documents

```javascript
const query = 'API documentation';
const results = await fetch(
  `/applications/wiki/api/search?q=${encodeURIComponent(query)}`
).then(r => r.json());

results.forEach(doc => {
  console.log(`${doc.title}: ${doc.path}`);
});
```

### Monitor Real-Time Changes

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:9101');

socket.on('document-created', (event) => {
  console.log(`New document: ${event.title}`);
  // Update UI
});

socket.on('document-updated', (event) => {
  console.log(`Document updated: ${event.path}`);
  // Refresh document
});
```

## Performance Optimizations

- **FileWatcher Debouncing** - 300ms debounce prevents event flooding
- **Search Index** - In-memory inverted index for fast searching
- **Lazy Loading** - Assets loaded on demand
- **Socket.IO Debouncing** - Client-side event batching (200-300ms)
- **Caching** - Frequently accessed documents cached in memory

## Storage

All documents stored in `./.application/documents/`:

```
.application/
├── documents/
│   ├── space1/
│   │   ├── document1.md
│   │   └── folder/
│   │       └── document2.md
│   └── space2/
│       └── document3.md
├── spaces/                  # Space definitions
└── wiki-files/             # Uploaded files
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Document not found | ID doesn't exist | Verify document ID, check if deleted |
| Permission denied | No read/write access | Check space permissions |
| Invalid markdown | Syntax error | Validate markdown format |
| File too large | Exceeds size limit | Compress or split file |
| Conflict | Document modified | Refresh and retry with latest version |

## Testing

```bash
# Run wiki tests
npm run tests -- tests/routes/wikiRoutes.test.js

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Debugging

### Check Index Status

```javascript
// In Node REPL
global.searchIndexer.getIndexSize()
global.searchIndexer.getStatistics()
```

### Monitor Events

```javascript
// In Node REPL
global.eventBus.eventNames()
global.eventBus.getStatistics()
```

### View Logs

```bash
tail -f ./.application/logs/application.log
```

## See Also

- [CLAUDE.md](../../../CLAUDE.md) - Architecture and development guidelines
- [USAGE.md](../../../USAGE.md) - Detailed usage examples
- [USAGE-CONCISE.md](../../../USAGE-CONCISE.md) - Quick reference
- [backend/README.md](../../README.md) - Backend operations
- [Spaces Documentation](../../../docs/Spaces.md) - Detailed Spaces system documentation
