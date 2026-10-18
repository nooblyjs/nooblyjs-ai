/**
 * @fileoverview Content Review Module
 * Handles JSON, Markdown viewing, and Diff comparison functionality
 *
 * @author noobly Team
 * @version 1.0.0
 */

/**
 * ContentReviewManager class
 */
class ContentReviewManager {
  constructor() {
    this.currentType = 'json'; // 'json', 'markdown', 'diff'
    this.currentPath = '';
    this.currentContent = '';
    this.fileTree = [];
  }

  /**
   * Initialize the content review interface
   */
  async init() {
    await this.renderContentReviewUI();
    this.setupEventListeners();
  }

  /**
   * Render main content review UI
   */
  async renderContentReviewUI() {
    const mainContent = document.getElementById('mainContent');
    if (!mainContent) return;

    const html = `
      <nav class="kr-breadcrumb" style="margin: 0 0 14px;">
        <a href="#"><i class="bi bi-house-door"></i></a>
        <span class="sep">›</span>
        <a href="#">Datasources</a>
        <span class="sep">›</span>
        <span class="last">Content review</span>
      </nav>
      <div class="kr-surface" style="display: flex; height: calc(100% - 40px); overflow: hidden;">
        <div style="width: 280px; overflow-y: auto; border-right: 1px solid var(--kr-border-2);">
          <div style="padding: 16px; border-bottom: 1px solid var(--kr-border-2);">
            <h6 class="mb-3" style="font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--kr-ink-400); margin: 0 0 12px;">Content review</h6>
            <div class="kr-seg" style="width: 100%;">
              <button type="button" class="content-type-btn" data-type="json" style="flex: 1;">
                <i class="bi bi-filetype-json"></i> JSON
              </button>
              <button type="button" class="content-type-btn" data-type="markdown" style="flex: 1;">
                <i class="bi bi-filetype-md"></i> Markdown
              </button>
            </div>
          </div>
          <div id="fileBrowser" style="padding: 12px;">
            <div class="text-center text-muted p-3">
              <div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>
            </div>
          </div>
        </div>

        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
          <div style="padding: 14px 18px; border-bottom: 1px solid var(--kr-border-2); background: var(--kr-surface-2);">
            <div class="d-flex justify-content-between align-items-center">
              <div style="flex: 1;">
                <div id="currentPath" style="font-size: 11px; color: var(--kr-ink-500);"></div>
              </div>
              <div class="d-flex gap-2">
                <button type="button" class="btn btn-ghost btn-sm" id="searchBtn" title="Search">
                  <i class="bi bi-search"></i> Search
                </button>
                <button type="button" class="btn btn-ghost btn-sm" id="refreshBtn" title="Refresh">
                  <i class="bi bi-arrow-clockwise"></i> Refresh
                </button>
                <button type="button" class="btn btn-ghost btn-sm" id="downloadBtn" title="Download">
                  <i class="bi bi-download"></i> Download
                </button>
              </div>
            </div>
          </div>

          <div id="contentArea" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
            <div class="text-center p-5">
              <p class="text-muted">Select a file to view</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Search Modal -->
      <div class="modal fade" id="searchModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title"><i class="bi bi-search me-2"></i>Search Content</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <input type="text" class="form-control" id="searchQuery" placeholder="Search query...">
              </div>
              <div id="searchResults"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    mainContent.innerHTML = html;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Content type switching
    document.querySelectorAll('.content-type-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchContentType(e.currentTarget.dataset.type);
      });
    });

    // Action buttons
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.loadFileList();
    });

    document.getElementById('searchBtn')?.addEventListener('click', () => {
      const modal = new bootstrap.Modal(document.getElementById('searchModal'));
      modal.show();
    });

    document.getElementById('downloadBtn')?.addEventListener('click', () => {
      this.downloadFile();
    });

    // Search functionality
    document.getElementById('searchQuery')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });

    // Initial load
    this.loadFileList();
  }

  /**
   * Switch content type
   */
  async switchContentType(type) {
    this.currentType = type;
    document.querySelectorAll('.content-type-btn').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.type === type);
      btn.classList.toggle('btn-outline-primary', btn.dataset.type !== type);
    });
    await this.loadFileList();
  }

  /**
   * Load file list
   */
  async loadFileList() {
    const browser = document.getElementById('fileBrowser');
    if (!browser) return;

    browser.innerHTML = '<div class="text-center text-muted p-3"><div class="spinner-border spinner-border-sm" role="status"></div></div>';

    try {
      const endpoint = this.currentType === 'json' ? '/api/content/json' : '/api/content/markdown';
      const response = await fetch(endpoint);
      const result = await response.json();

      if (result.success) {
        this.renderFileTree(result.data);
      }
    } catch (error) {
      browser.innerHTML = `<div class="alert alert-danger m-3 small">Error loading files: ${error.message}</div>`;
    }
  }

  /**
   * Render file tree
   */
  renderFileTree(files) {
    const browser = document.getElementById('fileBrowser');
    if (!browser) return;

    if (files.length === 0) {
      browser.innerHTML = '<div class="alert alert-info m-3 small">No files found</div>';
      return;
    }

    const fileGroups = {};
    files.forEach(file => {
      const ext = path.extname(file.name);
      const key = file.isDirectory ? 'folders' : ext;
      if (!fileGroups[key]) fileGroups[key] = [];
      fileGroups[key].push(file);
    });

    let html = '';

    // Folders first
    if (fileGroups['folders']) {
      html += '<div class="mb-3"><small class="text-muted fw-bold">Folders</small>';
      fileGroups['folders'].forEach(folder => {
        html += this.renderFileItem(folder, true);
      });
      html += '</div>';
    }

    // Files
    const ext = this.currentType === 'json' ? '.json' : '.md';
    if (fileGroups[ext]) {
      html += `<div><small class="text-muted fw-bold">Files</small>`;
      fileGroups[ext].forEach(file => {
        html += this.renderFileItem(file, false);
      });
      html += '</div>';
    }

    browser.innerHTML = html;

    // Setup file click handlers
    document.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const filePath = item.dataset.path;
        this.loadFile(filePath);
      });
    });
  }

  /**
   * Render individual file item
   */
  renderFileItem(file, isDirectory) {
    const icon = isDirectory ? 'folder' : (this.currentType === 'json' ? 'filetype-json' : 'filetype-md');
    return `
      <div class="file-item p-2 border-bottom cursor-pointer" data-path="${file.relativePath}" style="cursor: pointer; font-size: 10px;">
        <div>
          <i class="bi bi-${icon}"></i> ${file.name}
        </div>
        <div class="text-muted small" style="font-size: 8px;">
          ${file.sizeFormatted || ''}
        </div>
      </div>
    `;
  }

  /**
   * Load and display file
   */
  async loadFile(filePath) {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    contentArea.innerHTML = '<div class="text-center p-5"><div class="spinner-border" role="status"></div></div>';

    try {
      const endpoint = this.currentType === 'json' ? `/api/content/json/${filePath}` : `/api/content/markdown/${filePath}`;
      const response = await fetch(endpoint);
      const result = await response.json();

      if (!result.success) {
        contentArea.innerHTML = `<div class="alert alert-danger m-3">Error: ${result.error}</div>`;
        return;
      }

      const data = result.data;
      this.currentPath = filePath;
      this.currentContent = data.content;

      // Update path display
      const pathDisplay = document.getElementById('currentPath');
      if (pathDisplay) {
        pathDisplay.textContent = filePath;
      }

      // Render appropriate viewer
      if (this.currentType === 'json') {
        this.renderJSONViewer(data);
      } else {
        this.renderMarkdownViewer(data);
      }
    } catch (error) {
      contentArea.innerHTML = `<div class="alert alert-danger m-3">Error loading file: ${error.message}</div>`;
    }
  }

  /**
   * Render JSON viewer
   */
  renderJSONViewer(data) {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    let html = `
      <div class="p-3" style="overflow-y: auto; flex: 1;">
        <div class="d-flex gap-2 mb-3">
          <button type="button" class="btn btn-sm btn-outline-secondary json-view-btn" data-view="formatted">
            <i class="bi bi-braces"></i> Formatted
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary json-view-btn" data-view="raw">
            <i class="bi bi-code"></i> Raw
          </button>
          <button type="button" class="btn btn-sm btn-outline-primary ms-auto" id="copyJsonBtn">
            <i class="bi bi-clipboard"></i> Copy
          </button>
        </div>
        <pre id="jsonContent" style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 10px;"></pre>
      </div>
    `;

    contentArea.innerHTML = html;

    // Display formatted JSON
    const jsonContent = document.getElementById('jsonContent');
    if (data.parsed) {
      jsonContent.textContent = JSON.stringify(data.parsed, null, 2);
    } else {
      jsonContent.textContent = data.content;
    }

    // View toggle
    document.querySelectorAll('.json-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        document.querySelectorAll('.json-view-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-outline-secondary');
        });
        e.currentTarget.classList.remove('btn-outline-secondary');
        e.currentTarget.classList.add('btn-primary');

        if (view === 'raw') {
          jsonContent.textContent = data.content;
        } else {
          jsonContent.textContent = data.parsed ? JSON.stringify(data.parsed, null, 2) : data.content;
        }
      });
    });

    // Copy button
    document.getElementById('copyJsonBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(jsonContent.textContent);
      if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Copied to clipboard!',
          type: 'success',
          duration: 2000
        });
      }
    });
  }

  /**
   * Render Markdown viewer
   */
  renderMarkdownViewer(data) {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    let html = `
      <div style="overflow-y: auto; flex: 1; padding: 24px;">
        <div class="d-flex gap-2 mb-3">
          <button type="button" class="btn btn-sm btn-outline-secondary md-view-btn" data-view="preview">
            <i class="bi bi-eye"></i> Preview
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary md-view-btn" data-view="source">
            <i class="bi bi-code"></i> Source
          </button>
          <button type="button" class="btn btn-sm btn-outline-primary ms-auto" id="copyMdBtn">
            <i class="bi bi-clipboard"></i> Copy
          </button>
        </div>
        <div id="markdownContent" style="background: white; padding: 0;"></div>
      </div>
    `;

    contentArea.innerHTML = html;

    const mdContent = document.getElementById('markdownContent');

    // Simple markdown to HTML converter (basic)
    const preview = this.markdownToHTML(data.content);

    // Display preview by default
    mdContent.innerHTML = `<div class="markdown-preview">${preview}</div>`;

    // View toggle
    document.querySelectorAll('.md-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        document.querySelectorAll('.md-view-btn').forEach(b => {
          b.classList.remove('btn-primary');
          b.classList.add('btn-outline-secondary');
        });
        e.currentTarget.classList.remove('btn-outline-secondary');
        e.currentTarget.classList.add('btn-primary');

        if (view === 'source') {
          mdContent.innerHTML = `<pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 10px;">${this.escapeHtml(data.content)}</pre>`;
        } else {
          mdContent.innerHTML = `<div class="markdown-preview">${preview}</div>`;
        }
      });
    });

    // Copy button
    document.getElementById('copyMdBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(data.content);
      if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Copied to clipboard!',
          type: 'success',
          duration: 2000
        });
      }
    });
  }

  /**
   * Simple Markdown to HTML converter
   */
  markdownToHTML(markdown) {
    let html = this.escapeHtml(markdown);

    // Headers
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/__  (.*?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');

    // Lists
    html = html.replace(/^\* (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/^\- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)/s, '<ul>$1</ul>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Code blocks
    html = html.replace(/`([^`]+)`/g, '<code style="background: #f0f0f0; padding: 2px 4px; border-radius: 2px; font-family: monospace;">$1</code>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    return html;
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Perform search
   */
  async performSearch() {
    const query = document.getElementById('searchQuery')?.value;
    if (!query) return;

    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;

    resultsDiv.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm" role="status"></div></div>';

    try {
      const endpoint = this.currentType === 'json' ? '/api/content/json/search' : '/api/content/markdown/search';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query })
      });

      const result = await response.json();

      if (result.success && result.data.results.length > 0) {
        let html = `<div class="alert alert-info">Found ${result.data.count} matches</div>`;
        result.data.results.forEach(r => {
          html += `<div class="card mb-2"><div class="card-header">${r.file} (${r.matches.length})</div><div class="card-body small">`;
          r.matches.slice(0, 5).forEach(m => {
            html += `<div><small class="text-muted">Line ${m.lineNumber}:</small> ${this.escapeHtml(m.line.substring(0, 100))}</div>`;
          });
          if (r.matches.length > 5) {
            html += `<div class="text-muted">...and ${r.matches.length - 5} more</div>`;
          }
          html += `</div></div>`;
        });
        resultsDiv.innerHTML = html;
      } else {
        resultsDiv.innerHTML = '<div class="alert alert-warning">No matches found</div>';
      }
    } catch (error) {
      resultsDiv.innerHTML = `<div class="alert alert-danger">Search error: ${error.message}</div>`;
    }
  }

  /**
   * Download file
   */
  downloadFile() {
    if (!this.currentPath) {
      if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'No file selected',
          type: 'warning',
          duration: 2000
        });
      }
      return;
    }

    const endpoint = this.currentType === 'json'
      ? `/api/content/json/${this.currentPath}/download`
      : `/api/content/markdown/${this.currentPath}/download`;

    const link = document.createElement('a');
    link.href = endpoint;
    link.click();
  }
}

// Initialize content review manager
let contentReviewManager;

async function initContentReview() {
  if (!contentReviewManager) {
    contentReviewManager = new ContentReviewManager();
    await contentReviewManager.init();
  }
}
