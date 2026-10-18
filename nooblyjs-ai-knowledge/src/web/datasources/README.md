# Datasources Web UI

Workflow automation and data integration user interface.

## Quick Start

```bash
# Install dependencies
npm install

# Development server (port 3001)
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
http://localhost:11000/applications/datasources/
```

### API Endpoints

```
GET  /api/workflows/               - List workflows
POST /api/workflows/               - Create workflow
GET  /api/workflows/:id            - Get workflow details
PUT  /api/workflows/:id            - Update workflow
DELETE /api/workflows/:id          - Delete workflow
POST /api/workflows/:id/execute    - Execute workflow

GET  /api/settings/                - Get settings
PUT  /api/settings/                - Update settings
GET  /api/connections/             - List data connections
POST /api/connections/             - Create connection
GET  /api/agents/                  - List AI agents
```

## Features

- **Workflow Builder**: Create and configure data workflows
- **Step Editor**: Visual workflow step configuration
- **Execution Monitor**: Real-time workflow execution tracking
- **Schedule Manager**: Configure workflow schedules
- **Settings Panel**: Application settings and configuration
- **Data Connections**: Manage external data sources (FTP, S3, Git, etc.)
- **AI Integration**: Claude, ChatGPT, Ollama, Gemini support

## File Structure

```
public/
├── index.html              # Main entry point
├── js/
│   ├── apiClient.js       # HTTP client
│   ├── apiConfig.js       # API configuration
│   ├── app.js             # Application bootstrap
│   ├── dashboard.js       # Dashboard controller
│   ├── modal.js           # Modal dialogs
│   ├── dataTable.js       # Data table component
│   ├── loading.js         # Loading indicators
│   ├── scheduleManager.js # Schedule configuration
│   ├── pages/             # Page controllers
│   └── stepEditors/       # Workflow step editors
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

Server runs on `http://localhost:3001` and proxies API requests to the backend.

### Socket.IO Connection

Real-time events are received via WebSocket:

```javascript
const socket = io();
socket.on('workflow:start', (data) => {
  console.log('Workflow execution started:', data);
});
socket.on('workflow:complete', (data) => {
  console.log('Workflow execution completed:', data);
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
http://localhost:11000/applications/datasources/
```

### Legacy Datasources Backend (Port 9101)

For backward compatibility, the frontend can still be served from the legacy datasources backend:

```bash
cd ../../backends/datasources
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
- **EasyMDE**: Markdown editor (optional)
- **HTML5 Fetch API**: HTTP requests

## Production Deployment

1. Copy `public/` contents to your web server
2. Update `API_BASE_URL` in `js/apiConfig.js` if needed:
   ```javascript
   window.API_BASE_URL = 'https://api.yourdomain.com';
   ```
3. Ensure CORS is enabled on backend
4. Configure authentication if required

## Troubleshooting

**API requests failing:**
- Check backend is running: `http://localhost:11000/api/workflows/dashboard`
- Verify CORS is enabled
- Check browser console for network errors

**Socket.IO not connecting:**
- Check WebSocket is enabled in browser
- Verify Socket.IO server is running
- Check `https://github.com/socketio/socket.io-client` for client compatibility

**Workflows not executing:**
- Verify backend has workflow engines initialized
- Check agent configuration
- Review backend logs for errors

## Support

For issues, check the main [README](../../README.md) or consult the backend documentation.
