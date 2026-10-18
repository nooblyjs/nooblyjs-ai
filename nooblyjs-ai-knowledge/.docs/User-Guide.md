# User Guide - noobly Wiki Platform v2.0

Complete guide to using the noobly Wiki Platform.

**Last Updated**: February 2026
**Version**: 2.0.0

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Wiki Application](#wiki-application-knowledge-management)
3. [Datasources Application](#datasources-application-workflow-automation)
4. [Multi-Platform Access](#multi-platform-access)
5. [Collaboration & Real-Time Features](#collaboration--real-time-features)
6. [Tips & Best Practices](#tips--best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Getting Started

### System Requirements

- **Browser**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ (or any modern browser)
- **For Installation**: Node.js 16+ and npm (for server setup)
- **Disk Space**: 1GB minimum for application and document data
- **Memory**: 2GB RAM recommended for optimal performance

### Quick Start

1. **Start the Unified Backend**
   ```bash
   npm start
   ```
   The backend starts on `http://localhost:11000` and serves both applications.

2. **Access Applications**
   - **Datasources (Workflows)**: `http://localhost:11000/applications/datasources/`
   - **Wiki (Knowledge Management)**: `http://localhost:11000/applications/wiki/`

3. **Create Your Account**
   - Click "Sign Up" on the login page
   - Enter your email and password
   - Click "Register" to create account
   - You're ready to use the platform!

### First Time Login

- **Default User**: Create one during registration
- **Multiple Users**: Each user can register separately
- **Password Reset**: Available if needed
- **Optional OAuth**: Connect with Google account for SSO

---

## Wiki Application (Knowledge Management)

### 📄 Creating Documents

1. **Navigate to a Space**
   - Select a space from the left sidebar
   - Spaces organize documents by topic or team

2. **Create New Document**
   - Click "New Document" button
   - Enter title and select location
   - Start typing in Markdown editor

3. **Document Format**
   - Supports Markdown syntax
   - Headers: `# H1`, `## H2`, etc.
   - **Bold**: `**text**`
   - *Italic*: `*text*`
   - Lists: `- item` or `1. item`
   - Code: `` `inline` `` or ` ``` blocks ```

### 🗂️ Organizing Documents

1. **Create Folders**
   - Right-click in file tree
   - Select "New Folder"
   - Move documents by dragging

2. **Manage Spaces**
   - Each space is a top-level container
   - Types: Shared, Read-Only, Personal
   - Create new spaces in settings

3. **Document Metadata**
   - Tags: Add searchable keywords
   - Author: Automatic from login
   - Timestamps: Auto-tracked

### 🔍 Finding Documents

1. **Full-Text Search**
   - Use search bar at top
   - Search across all spaces (if permitted)
   - Filter by space or tags

2. **Browse Structure**
   - Left sidebar shows folder tree
   - Expand folders to view files
   - Recent documents shown at top

### 📤 Importing Files

1. **Upload Documents**
   - Click "Upload" button
   - Select file (PDF, DOCX, XLSX, PPTX)
   - Choose destination folder

2. **Supported Formats**
   - **PDF** - Text extraction, maintains layout
   - **Word (DOCX)** - Full formatting conversion
   - **Excel (XLSX)** - Tables preserved
   - **PowerPoint (PPTX)** - Slide content extracted
   - **Markdown (MD)** - Direct import

---

## Datasources Application (Workflow Automation)

### 🔗 Data Connections

1. **Create Connection**
   - Settings > Connections
   - Click "Add Connection"
   - Choose provider (S3, FTP, Git, API, etc.)

2. **Connection Types**
   - **S3** - Amazon S3 buckets
   - **FTP** - FTP/SFTP servers
   - **Git** - GitHub/GitLab repositories
   - **API** - REST endpoints
   - **Local** - Server filesystem
   - **Database** - SQL/NoSQL databases

3. **Test Connection**
   - After configuration, click "Test"
   - Confirms credentials and access
   - Shows connection status

### ⚙️ Creating Workflows

1. **New Workflow**
   - Click "Create Workflow" button
   - Enter workflow name and description
   - Click "Create" to start designing
   - Design workflow steps using the visual editor

2. **Available Workflow Steps**
   - **API Call** - Fetch data from external REST APIs
   - **Transform** - Process data with JavaScript code
   - **Conditional** - Branch logic (if/then/else)
   - **Parallel** - Execute multiple steps simultaneously
   - **Delay** - Pause execution for specified duration
   - **Connect** - Use data connections (S3, FTP, Git, etc.)

3. **Scheduling Workflows**
   - Set cron-based execution schedules
   - Run daily, weekly, monthly automatically
   - Monitor execution history
   - View logs and execution results

### 📊 Monitoring Workflows

1. **Dashboard**
   - View total workflows count
   - See recent executions
   - Monitor success/failure rates
   - Check execution times

2. **Execution History**
   - View past execution logs
   - Download output files (JSON, Markdown)
   - Review step-by-step execution details
   - Rerun previous workflows

---

## Multi-Platform Access

### 🌐 Web Application
The primary way to access both modules:
- Accessible from any modern browser
- Full feature access
- Real-time synchronization
- Works on desktop and tablet devices

### 🖥️ Desktop Application (Electron)
Run the application as a native desktop app:
- Available for Windows, macOS, and Linux
- All web features plus offline capability
- System tray integration
- File system integration

### 🔧 VS Code Extension
Access your wiki directly from your code editor:
- Search wiki documents
- Quick preview in editor
- Sidebar navigation
- Requires bearer token authentication

**Installation**: Open VS Code → Extensions → Search "noobly Wiki" → Install

### 🎨 Chrome Extension
Quick reference popup in your browser:
- Search documents
- Read-only access
- Configurable backend URL
- Access from any webpage

**Installation**: [Chrome Web Store](https://chrome.google.com/webstore) → Search "noobly Wiki"

### 💬 Microsoft Teams
Use the platform within Microsoft Teams:
- Datasources tab for workflow management
- Wiki tab for knowledge access
- Teams authentication
- Integrated with Teams workflow

---

## Collaboration & Real-Time Features

### 👥 Real-Time Collaboration

Both applications support live collaboration:
- **Live Editing**: Changes visible to all users instantly
- **Presence Indicators**: See who else is viewing documents
- **Conflict Resolution**: System handles simultaneous edits
- **Activity Tracking**: View document edit history

### 🔄 Real-Time Synchronization

Changes sync automatically across all platforms:
- Edit in web, see changes in desktop app immediately
- Workflow execution status updates live
- Document changes broadcast to all viewers
- No manual refresh needed

### 📱 Cross-Platform Sync

Data syncs seamlessly across all platforms:
- Desktop app stays in sync with web
- VS Code extension reflects latest documents
- Chrome extension shows current content
- Teams tab displays live data

---

## Tips & Best Practices

### 📚 Wiki Best Practices

1. **Use Consistent Naming**
   - Follow a naming convention for documents
   - Use folders to organize by topic
   - Tag related documents

2. **Leverage Spaces**
   - Separate documentation by team/project
   - Use different spaces for public vs. internal docs
   - Control access at space level

3. **Search Effectively**
   - Use specific keywords
   - Filter by space or date
   - Save common searches

4. **Keep Documents Updated**
   - Review regularly
   - Update when information changes
   - Archive outdated docs

### ⚙️ Workflow Best Practices

1. **Design Workflows**
   - Start with a single goal per workflow
   - Use meaningful names and descriptions
   - Document complex workflows

2. **Test Thoroughly**
   - Test with sample data first
   - Monitor execution logs
   - Set up error notifications

3. **Schedule Wisely**
   - Don't schedule too frequently
   - Monitor resource usage
   - Set up notifications for failures

4. **Document Steps**
   - Add descriptions to complex steps
   - Use clear variable names
   - Comment JavaScript code

### 🔐 Security Tips

1. **Password Security**
   - Use strong passwords
   - Change passwords periodically
   - Don't share credentials

2. **API Keys**
   - Store safely in connections
   - Rotate API keys regularly
   - Never commit keys to version control

3. **Access Control**
   - Use appropriate space permissions
   - Limit admin access
   - Review user access regularly

---

## Troubleshooting

### Common Issues

#### I can't log in
- Verify username/password are correct
- Check if account is created
- Clear browser cookies and try again
- Try a different browser

#### Documents not syncing
- Check internet connection
- Verify backend is running
- Reload page (F5)
- Check browser console for errors

#### Workflow not executing
- Verify all data connections are active
- Check workflow syntax for errors
- Review execution logs
- Try with simpler workflow first

#### Real-time updates not working
- Refresh page (F5)
- Check WebSocket connection in DevTools (Network → WS)
- Restart backend
- Check browser firewall/extensions

### Getting Help

1. **Check Documentation**
   - Review relevant guides
   - Check CLAUDE.md for development setup

2. **Review Logs**
   - Backend logs: `.application/logs/`
   - Browser console: F12 → Console
   - Network tab for API issues

3. **Contact Support**
   - Include error messages
   - Describe steps to reproduce
   - Provide browser/OS information

---

## Advanced Features

### 🤖 AI Integration

The platform supports multiple AI providers:
- **Claude**: Via Anthropic API
- **ChatGPT**: Via OpenAI API
- **Ollama**: Local LLM option
- **Google Gemini**: Via Google API

**Configure in Settings** → **AI Configuration**

### 📊 Import & Export

#### Import Documents
- Drag & drop files into wiki
- Supported: PDF, Word, Excel, PowerPoint, Markdown
- Documents indexed automatically
- Full-text search available immediately

#### Export Data
- Download individual documents
- Export workflow definitions
- Backup application data
- Archive old documents

---

**Need Help?**
- Read [CLAUDE.md](../CLAUDE.md) for setup and development
- Check [API-Reference.md](./API-Reference.md) for API details
- Review [Architecture.md](./Architecture.md) for technical details
- See [PRD.md](./PRD.md) for feature specifications
