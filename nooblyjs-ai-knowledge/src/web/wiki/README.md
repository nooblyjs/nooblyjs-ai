# Wiki Web UI

Knowledge management and document repository user interface.

## Quick Start

```bash
# Install dependencies
npm install

# Development server (port 3002)
npm run dev

# Production serve
npm run serve
```

## API Configuration

The application automatically detects the backend URL:

```javascript
// Auto-detect from current origin
const API_BASE_URL = window.location.origin;
```

## Served From Backend

In the unified backend architecture, this frontend is served from:

```
http://localhost:11000/applications/wiki/
```

### API Endpoints

```
GET  /applications/wiki/api/spaces           - List wiki spaces
POST /applications/wiki/api/spaces           - Create space
GET  /applications/wiki/api/documents        - List documents
POST /applications/wiki/api/documents        - Create document
GET  /applications/wiki/api/documents/:id    - Get document
PUT  /applications/wiki/api/documents/:id    - Update document
DELETE /applications/wiki/api/documents/:id  - Delete document
GET  /applications/wiki/api/search           - Full-text search
GET  /applications/wiki/api/ai/chat          - AI chat endpoint
POST /applications/wiki/api/upload           - File upload
```

## Features

- **Document Management**: Create, edit, delete wiki documents
- **Real-Time Sync**: Live updates via File Watcher
- **Full-Text Search**: Index and search document content
- **AI Chat**: Claude-powered content assistance
- **Markdown Editor**: Rich markdown editing with EasyMDE
- **File Upload**: Upload and process documents (PDF, DOCX, XLSX, PPTX)
- **Space Organization**: Organize documents into wiki spaces
- **Browser Extensions**: VS Code and Chrome extension support

## File Structure

```
public/
├── index.html              # Main entry point
├── js/
│   ├── app.js             # Application bootstrap
│   ├── apiClient.js       # HTTP client
│   ├── apiConfig.js       # API configuration
│   ├── modules/           # Feature controllers
│   │   ├── documentController.js
│   │   ├── spacesController.js
│   │   ├── searchController.js
│   │   ├── aiChatController.js
│   │   ├── navigationController.js
│   │   └── ...
│   ├── services/          # Shared services
│   │   └── socketService.js
│   ├── utils/             # Utilities
│   └── wizard.js          # Onboarding wizard
├── css/
│   ├── easymde-overrides.css
│   └── tabs.css
├── images/                # Logo and icons
└── data/
    └── content.json       # Static content
```

## Development

### Starting Development Server

```bash
npm run dev
```

Server runs on `http://localhost:3002` and proxies API requests to the backend.

### Socket.IO Connection

Real-time events are received via WebSocket:

```javascript
const socket = io();
socket.on('document-updated', (data) => {
  console.log('Document updated:', data);
});
socket.on('document-created', (data) => {
  console.log('Document created:', data);
});
socket.on('folder-changed', (data) => {
  console.log('Folder structure changed:', data);
});
```

### Building

Currently, plain JavaScript files are served without a build step. For production bundling, consider adding Vite or Webpack.

## Integration with Backend

### Unified Backend (Port 11000)

The frontend is automatically served from the unified backend:

```bash
# Start backend
cd ../../backend
npm install
npm start

# Then access at
http://localhost:11000/applications/wiki/
```

### Legacy Wiki Backend (Port 11002)

For backward compatibility, the frontend can still be served from the legacy wiki backend:

```bash
cd ../../backends/viewer
npm install
npm start

# Then access at
http://localhost:9101/
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Dependencies

- **Socket.IO Client**: Real-time communication
- **EasyMDE**: Markdown editor
- **HTML5 Fetch API**: HTTP requests
- **Chokidar**: File watching (backend)

## Authentication

The wiki supports multiple authentication methods:

```javascript
// Local authentication
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password"
}

// Bearer token for API clients
Authorization: Bearer <token>

// Google OAuth20 (if configured)
GET /auth/google
GET /auth/google/callback
```

## Real-Time Features

### Document Synchronization

Changes are broadcast to all connected clients via Socket.IO:

```javascript
// Frontend listens for changes
eventBus.on('document-updated', ({ documentId, content }) => {
  updateDocumentView(documentId, content);
});

// Backend emits when file changes
eventEmitter.emit('document-updated', { documentId, content, timestamp });
```

### Search Indexing

Full-text search index is built and maintained in background:

```javascript
// Search documents
GET /applications/wiki/api/search?q=keyword

// Rebuild index
GET /applications/wiki/api/search?rebuild=true
```

## AI Features

### Claude Integration

Chat with Claude about document content:

```javascript
POST /applications/wiki/api/ai/chat
{
  "message": "Summarize this document",
  "documentId": "doc-123"
}
```

### Supported Models

- Claude (via Anthropic API)
- ChatGPT (via OpenAI API)
- Ollama (local LLM)
- Gemini (via Google API)

## Production Deployment

1. Copy `public/` contents to your web server
2. Update `API_BASE_URL` in `js/apiConfig.js` if needed:
   ```javascript
   window.API_BASE_URL = 'https://api.yourdomain.com';
   ```
3. Ensure CORS is enabled on backend
4. Configure authentication
5. Set up HTTPS for production

## Troubleshooting

**API requests failing:**
- Check backend is running: `http://localhost:11000/applications/wiki/api/spaces`
- Verify CORS is enabled
- Check browser console for network errors

**Documents not updating in real-time:**
- Check Socket.IO connection: DevTools → Network → WS tab
- Verify FileWatcher is running on backend
- Check browser console for subscription errors

**Search not working:**
- Index rebuilds every 60 seconds
- Force rebuild: `GET /applications/wiki/api/search?rebuild=true`
- Check index size: `global.searchIndexer.getIndexSize()`

**AI features not working:**
- Verify Ollama is running: `ollama serve`
- Check model exists: `ollama list`
- Verify accessible at `http://localhost:11434`

## VS Code Extension

The VS Code extension can connect to this wiki:

1. Install extension from `src-clients/vscode/`
2. Set server URL in VS Code settings:
   ```json
   {
     "noobly-knowledge-repository.serverUrl": "http://localhost:11000"
   }
   ```
3. Login with wiki credentials

## Chrome Extension

Read-only access to wiki content:

1. Load extension from `src-clients/chrome/` as unpacked
2. Configure server URL in extension settings
3. Right-click webpage → "Search in Wiki"

## Support

For issues, check the main [README](../../README.md) or consult the backend documentation.
