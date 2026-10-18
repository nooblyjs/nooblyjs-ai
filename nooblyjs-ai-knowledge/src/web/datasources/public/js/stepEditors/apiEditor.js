/**
 * API Step Editor
 * Provides a professional API configuration UI with:
 * - URL input with variable interpolation preview
 * - HTTP method selector (GET, POST, PUT, DELETE, PATCH)
 * - Headers key-value editor
 * - Body editor with JSON syntax highlighting
 * - Timeout configuration
 * - Authentication options (Basic, Bearer, API Key)
 * - Request testing with response visualization
 * - Timing and status information
 */

class APIEditor {
  constructor(stepIndex, step, currentWorkflow) {
    this.stepIndex = stepIndex;
    this.step = step;
    this.currentWorkflow = currentWorkflow;
    this.codeMirrorInstance = null;
    this.lastTestResult = null;
    this.isTestRunning = false;

    // Ensure config has required fields
    if (!this.step.config) {
      this.step.config = {
        type: 'api',
        endpoint: '',
        method: 'GET',
        headers: {},
        body: {},
        timeout: 30000,
        auth: {
          type: 'none' // 'none', 'basic', 'bearer', 'api-key'
        }
      };
    }
  }

  /**
   * Initialize the API editor UI
   */
  initializeEditor(container) {
    const editorHTML = `
      <div class="api-editor-container" style="display: flex; flex-direction: column; height: 100%; gap: 12px; overflow-y: auto; padding: 0;">
        <!-- URL Section -->
        <div class="card border-primary">
          <div class="card-header bg-primary bg-opacity-10">
            <h6 class="mb-0">
              <i class="bi bi-link-45deg me-2"></i>API Endpoint
            </h6>
          </div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 10px;">
            <div>
              <label class="form-label mb-2">Endpoint URL</label>
              <input type="text" id="apiEndpoint" class="form-control"
                     value="${this.step.config.endpoint || ''}"
                     placeholder="https://api.example.com/data">
              <small class="text-muted d-block mt-1">
                Supports variable interpolation: <code>\${variableName}</code>
              </small>
            </div>

            <!-- URL Preview -->
            <div id="urlPreviewSection" style="display: none;">
              <label class="form-label mb-2" style="font-size: 0.9em;">Interpolated URL Preview:</label>
              <div class="alert alert-info mb-0" style="padding: 10px; font-size: 0.9em; word-break: break-all;">
                <code id="urlPreview" style="font-size: 0.85em;"></code>
              </div>
            </div>
          </div>
        </div>

        <!-- HTTP Method & Timeout -->
        <div class="row g-3">
          <div class="col-md-6">
            <div class="card border-success">
              <div class="card-header bg-success bg-opacity-10">
                <h6 class="mb-0">
                  <i class="bi bi-gear me-2"></i>HTTP Method
                </h6>
              </div>
              <div class="card-body">
                <select id="apiMethod" class="form-select">
                  <option value="GET" ${this.step.config.method === 'GET' ? 'selected' : ''}>GET</option>
                  <option value="POST" ${this.step.config.method === 'POST' ? 'selected' : ''}>POST</option>
                  <option value="PUT" ${this.step.config.method === 'PUT' ? 'selected' : ''}>PUT</option>
                  <option value="PATCH" ${this.step.config.method === 'PATCH' ? 'selected' : ''}>PATCH</option>
                  <option value="DELETE" ${this.step.config.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
                </select>
              </div>
            </div>
          </div>

          <div class="col-md-6">
            <div class="card border-warning">
              <div class="card-header bg-warning bg-opacity-10">
                <h6 class="mb-0">
                  <i class="bi bi-hourglass-split me-2"></i>Timeout (seconds)
                </h6>
              </div>
              <div class="card-body">
                <input type="number" id="apiTimeout" class="form-control"
                       value="${(this.step.config.timeout || 30000) / 1000}"
                       min="1" max="300">
                <small class="text-muted d-block mt-1">Max wait time for response</small>
              </div>
            </div>
          </div>
        </div>

        <!-- Authentication Section -->
        <div class="card border-secondary">
          <div class="card-header bg-secondary bg-opacity-10">
            <h6 class="mb-0">
              <i class="bi bi-shield-lock me-2"></i>Authentication
            </h6>
          </div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 10px;">
            <div>
              <label class="form-label mb-2">Auth Type</label>
              <select id="apiAuthType" class="form-select">
                <option value="none" ${this.step.config.auth?.type === 'none' || !this.step.config.auth?.type ? 'selected' : ''}>None</option>
                <option value="basic" ${this.step.config.auth?.type === 'basic' ? 'selected' : ''}>Basic Authentication</option>
                <option value="bearer" ${this.step.config.auth?.type === 'bearer' ? 'selected' : ''}>Bearer Token</option>
                <option value="api-key" ${this.step.config.auth?.type === 'api-key' ? 'selected' : ''}>API Key</option>
              </select>
            </div>

            <!-- Basic Auth -->
            <div id="basicAuthSection" style="display: none; border-top: 1px solid #dee2e6; padding-top: 10px;">
              <div class="row g-2">
                <div class="col-md-6">
                  <label class="form-label" style="font-size: 0.9em;">Username</label>
                  <input type="text" id="basicUsername" class="form-control" value="${this.step.config.auth?.username || ''}">
                </div>
                <div class="col-md-6">
                  <label class="form-label" style="font-size: 0.9em;">Password</label>
                  <input type="password" id="basicPassword" class="form-control" value="${this.step.config.auth?.password || ''}">
                </div>
              </div>
            </div>

            <!-- Bearer Token -->
            <div id="bearerAuthSection" style="display: none; border-top: 1px solid #dee2e6; padding-top: 10px;">
              <label class="form-label" style="font-size: 0.9em;">Token</label>
              <input type="text" id="bearerToken" class="form-control" value="${this.step.config.auth?.token || ''}">
              <small class="text-muted d-block mt-1">Will be sent as: <code>Authorization: Bearer &lt;token&gt;</code></small>
            </div>

            <!-- API Key -->
            <div id="apiKeyAuthSection" style="display: none; border-top: 1px solid #dee2e6; padding-top: 10px;">
              <div class="row g-2">
                <div class="col-md-6">
                  <label class="form-label" style="font-size: 0.9em;">Header Name</label>
                  <input type="text" id="apiKeyHeaderName" class="form-control" value="${this.step.config.auth?.headerName || 'X-API-Key'}">
                </div>
                <div class="col-md-6">
                  <label class="form-label" style="font-size: 0.9em;">Key Value</label>
                  <input type="password" id="apiKeyValue" class="form-control" value="${this.step.config.auth?.value || ''}">
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Headers Section -->
        <div class="card border-info">
          <div class="card-header bg-info bg-opacity-10">
            <div class="d-flex justify-content-between align-items-center">
              <h6 class="mb-0">
                <i class="bi bi-list-task me-2"></i>Headers
              </h6>
              <button type="button" class="btn btn-sm btn-info" id="addHeaderBtn">
                <i class="bi bi-plus-lg me-1"></i>Add Header
              </button>
            </div>
          </div>
          <div class="card-body">
            <div id="headersList" style="display: flex; flex-direction: column; gap: 8px;">
              <!-- Headers added here -->
            </div>
            <small class="text-muted d-block mt-2">
              Common headers: Content-Type, Accept, Authorization, User-Agent
            </small>
          </div>
        </div>

        <!-- Body Section -->
        <div class="card border-success" id="bodyCard" style="display: none;">
          <div class="card-header bg-success bg-opacity-10">
            <h6 class="mb-0">
              <i class="bi bi-file-json me-2"></i>Request Body (JSON)
            </h6>
          </div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 10px; min-height: 200px;">
            <div id="apiBodyEditor" style="flex: 1; border: 1px solid #ddd; border-radius: 4px; overflow: hidden;"></div>
            <small class="text-muted">Syntax-highlighted JSON editor. Automatically formatted.</small>
          </div>
        </div>

        <!-- Test Section -->
        <div class="card border-success">
          <div class="card-header bg-success bg-opacity-10">
            <h6 class="mb-0">
              <i class="bi bi-play-fill me-2"></i>Test Request
            </h6>
          </div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 12px;">
            <button type="button" class="btn btn-success" id="testApiBtn">
              <i class="bi bi-play-fill me-2"></i>Send Test Request
            </button>

            <!-- Test Result -->
            <div id="testResultSection" style="display: none;">
              <hr>
              <h6>Response:</h6>

              <!-- Response Status -->
              <div class="alert" id="responseStatusAlert" style="margin-bottom: 8px; padding: 8px 12px;">
                <span id="responseStatus"></span>
                <span id="responseTiming" class="float-end text-muted small"></span>
              </div>

              <!-- Response Headers -->
              <div style="margin-bottom: 12px;">
                <label class="form-label mb-2" style="font-size: 0.9em;">Response Headers:</label>
                <div id="responseHeadersList" class="small bg-light p-2 rounded"
                     style="max-height: 150px; overflow-y: auto; font-size: 0.85em;"></div>
              </div>

              <!-- Response Body -->
              <div>
                <label class="form-label mb-2" style="font-size: 0.9em;">Response Body:</label>
                <div id="responseBodyContainer" class="bg-light p-2 rounded"
                     style="max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 0.85em; white-space: pre-wrap; word-break: break-word;"></div>
              </div>

              <!-- Error Display -->
              <div id="errorAlertSection" style="display: none; margin-top: 8px;">
                <div class="alert alert-danger mb-0" style="font-size: 0.9em;">
                  <strong>Error:</strong>
                  <div id="errorMessage"></div>
                </div>
              </div>
            </div>

            <!-- Loading Indicator -->
            <div id="testLoadingSection" style="display: none; text-align: center;">
              <div class="spinner-border spinner-border-sm text-success me-2" role="status" style="width: 20px; height: 20px;">
                <span class="visually-hidden">Loading...</span>
              </div>
              <span>Sending request...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = editorHTML;
    this.setupEventListeners();
    this.renderHeaders();
    this.setupBodyEditor();
    this.updateUrlPreview();
  }

  /**
   * Setup CodeMirror for JSON body editing
   */
  setupBodyEditor() {
    const bodyContainer = document.getElementById('apiBodyEditor');

    // Only show body editor for methods that support body
    const method = this.step.config.method || 'GET';
    const bodyCard = document.getElementById('bodyCard');
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      bodyCard.style.display = 'block';
    }

    this.bodyEditorInstance = CodeMirror(bodyContainer, {
      value: JSON.stringify(this.step.config.body || {}, null, 2),
      mode: 'application/json',
      theme: 'monokai',
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      styleActiveLine: true
    });

    this.bodyEditorInstance.on('change', () => {
      try {
        const jsonStr = this.bodyEditorInstance.getValue();
        this.step.config.body = JSON.parse(jsonStr);
        isDirty = true;
      } catch (e) {
        // Invalid JSON, don't update
      }
    });
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    const endpoint = document.getElementById('apiEndpoint');
    const method = document.getElementById('apiMethod');
    const timeout = document.getElementById('apiTimeout');
    const authType = document.getElementById('apiAuthType');
    const addHeaderBtn = document.getElementById('addHeaderBtn');
    const testBtn = document.getElementById('testApiBtn');

    // URL preview on change
    endpoint.addEventListener('input', () => {
      this.step.config.endpoint = endpoint.value;
      this.updateUrlPreview();
      isDirty = true;
    });

    // Method change
    method.addEventListener('change', () => {
      this.step.config.method = method.value;
      this.updateBodyVisibility();
      isDirty = true;
    });

    // Timeout change
    timeout.addEventListener('change', () => {
      this.step.config.timeout = parseInt(timeout.value) * 1000;
      isDirty = true;
    });

    // Auth type change
    authType.addEventListener('change', (e) => {
      this.step.config.auth = { type: e.target.value };
      this.updateAuthSections();
      isDirty = true;
    });

    // Add header button
    addHeaderBtn.addEventListener('click', () => this.addHeader());

    // Test button
    testBtn.addEventListener('click', () => this.testRequest());
  }

  /**
   * Update URL preview with variable interpolation
   */
  updateUrlPreview() {
    const url = this.step.config.endpoint || '';
    const previewSection = document.getElementById('urlPreviewSection');
    const preview = document.getElementById('urlPreview');

    if (!url) {
      previewSection.style.display = 'none';
      return;
    }

    previewSection.style.display = 'block';

    // Interpolate variables
    let interpolated = url;
    const vars = this.getContextVariables();

    for (const variable of vars) {
      const pattern = new RegExp(`\\$\\{${variable}\\}`, 'g');
      if (pattern.test(interpolated)) {
        interpolated = interpolated.replace(pattern, `[${variable}]`);
      }
    }

    preview.textContent = interpolated;
  }

  /**
   * Get context variables from workflow
   */
  getContextVariables() {
    const vars = new Set(['input']);

    if (this.currentWorkflow && this.currentWorkflow.steps) {
      for (let i = 0; i < this.stepIndex; i++) {
        const step = this.currentWorkflow.steps[i];
        if (step && step.name) {
          vars.add(step.name.toLowerCase().replace(/\s+/g, '_'));
          vars.add(step.name.toLowerCase().replace(/\s+([a-z])/g, (_, char) => char.toUpperCase()));
        }
      }
    }

    return Array.from(vars).sort();
  }

  /**
   * Update body editor visibility based on HTTP method
   */
  updateBodyVisibility() {
    const method = this.step.config.method || 'GET';
    const bodyCard = document.getElementById('bodyCard');

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      bodyCard.style.display = 'block';
      setTimeout(() => this.bodyEditorInstance?.refresh(), 100);
    } else {
      bodyCard.style.display = 'none';
    }
  }

  /**
   * Update authentication sections visibility
   */
  updateAuthSections() {
    const authType = this.step.config.auth?.type || 'none';

    document.getElementById('basicAuthSection').style.display = authType === 'basic' ? 'block' : 'none';
    document.getElementById('bearerAuthSection').style.display = authType === 'bearer' ? 'block' : 'none';
    document.getElementById('apiKeyAuthSection').style.display = authType === 'api-key' ? 'block' : 'none';

    // Update auth config from inputs
    this.updateAuthConfig();
  }

  /**
   * Update authentication configuration from form inputs
   */
  updateAuthConfig() {
    const authType = document.getElementById('apiAuthType').value;

    if (authType === 'basic') {
      this.step.config.auth = {
        type: 'basic',
        username: document.getElementById('basicUsername').value,
        password: document.getElementById('basicPassword').value
      };
    } else if (authType === 'bearer') {
      this.step.config.auth = {
        type: 'bearer',
        token: document.getElementById('bearerToken').value
      };
    } else if (authType === 'api-key') {
      this.step.config.auth = {
        type: 'api-key',
        headerName: document.getElementById('apiKeyHeaderName').value,
        value: document.getElementById('apiKeyValue').value
      };
    } else {
      this.step.config.auth = { type: 'none' };
    }

    isDirty = true;
  }

  /**
   * Render headers list
   */
  renderHeaders() {
    const list = document.getElementById('headersList');
    const headers = this.step.config.headers || {};

    const entries = Object.entries(headers);

    if (entries.length === 0) {
      list.innerHTML = '<small class="text-muted">No headers added yet. Use "Add Header" button to add one.</small>';
      return;
    }

    list.innerHTML = entries.map(([key, value], idx) => `
      <div class="d-flex gap-2" style="align-items: flex-end;">
        <div style="flex: 1;">
          <label class="form-label mb-1" style="font-size: 0.85em;">Header Name</label>
          <input type="text" class="form-control form-control-sm" value="${key}"
                 onchange="window.apiEditorInstance?.updateHeader('${key}', this.value, '${value}')">
        </div>
        <div style="flex: 1.5;">
          <label class="form-label mb-1" style="font-size: 0.85em;">Value</label>
          <input type="text" class="form-control form-control-sm" value="${value}"
                 onchange="window.apiEditorInstance?.updateHeader('${key}', '${key}', this.value)">
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger"
                onclick="window.apiEditorInstance?.removeHeader('${key}')">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `).join('');
  }

  /**
   * Add new header
   */
  addHeader() {
    if (!this.step.config.headers) {
      this.step.config.headers = {};
    }

    const name = prompt('Enter header name:', 'X-Custom-Header');
    if (!name) return;

    const value = prompt('Enter header value:', '');
    if (value === null) return;

    this.step.config.headers[name] = value;
    this.renderHeaders();
    isDirty = true;
  }

  /**
   * Update header value
   */
  updateHeader(oldKey, newKey, newValue) {
    if (!this.step.config.headers) {
      this.step.config.headers = {};
    }

    if (oldKey !== newKey && oldKey in this.step.config.headers) {
      delete this.step.config.headers[oldKey];
    }

    this.step.config.headers[newKey] = newValue;
    this.renderHeaders();
    isDirty = true;
  }

  /**
   * Remove header
   */
  removeHeader(key) {
    if (this.step.config.headers && key in this.step.config.headers) {
      delete this.step.config.headers[key];
      this.renderHeaders();
      isDirty = true;
    }
  }

  /**
   * Test the API request
   */
  async testRequest() {
    if (this.isTestRunning) return;

    try {
      this.isTestRunning = true;
      const testBtn = document.getElementById('testApiBtn');
      const loadingSection = document.getElementById('testLoadingSection');
      const resultSection = document.getElementById('testResultSection');

      testBtn.disabled = true;
      loadingSection.style.display = 'block';
      resultSection.style.display = 'none';

      // Prepare request
      const url = document.getElementById('apiEndpoint').value;
      const method = document.getElementById('apiMethod').value;
      const timeout = parseInt(document.getElementById('apiTimeout').value) * 1000;

      if (!url) {
        throw new Error('Endpoint URL is required');
      }

      // Prepare headers
      const headers = { 'Content-Type': 'application/json' };
      const configHeaders = this.step.config.headers || {};
      Object.assign(headers, configHeaders);

      // Add authentication
      this.addAuthenticationHeaders(headers);

      // Prepare options
      const options = {
        method,
        headers,
        timeout
      };

      // Add body for POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyStr = this.bodyEditorInstance?.getValue() || '{}';
        try {
          options.body = bodyStr;
        } catch (e) {
          throw new Error('Invalid JSON body');
        }
      }

      // Send request and measure time
      const startTime = performance.now();
      const response = await fetch(url, options);
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(0);

      // Parse response
      const contentType = response.headers.get('content-type') || '';
      let responseBody = '';

      if (contentType.includes('application/json')) {
        const json = await response.json();
        responseBody = JSON.stringify(json, null, 2);
      } else if (contentType.includes('text/')) {
        responseBody = await response.text();
      } else {
        responseBody = await response.text();
      }

      this.displayTestResult(response, responseBody, duration);
    } catch (error) {
      this.displayTestError(error);
    } finally {
      this.isTestRunning = false;
      document.getElementById('testApiBtn').disabled = false;
      document.getElementById('testLoadingSection').style.display = 'none';
    }
  }

  /**
   * Add authentication headers
   */
  addAuthenticationHeaders(headers) {
    const authType = this.step.config.auth?.type || 'none';

    if (authType === 'basic') {
      const username = this.step.config.auth.username || '';
      const password = this.step.config.auth.password || '';
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    } else if (authType === 'bearer') {
      const token = this.step.config.auth.token || '';
      headers['Authorization'] = `Bearer ${token}`;
    } else if (authType === 'api-key') {
      const headerName = this.step.config.auth.headerName || 'X-API-Key';
      const value = this.step.config.auth.value || '';
      headers[headerName] = value;
    }
  }

  /**
   * Display test result
   */
  displayTestResult(response, body, duration) {
    const resultSection = document.getElementById('testResultSection');
    const statusAlert = document.getElementById('responseStatusAlert');
    const statusText = document.getElementById('responseStatus');
    const timingText = document.getElementById('responseTiming');
    const headersList = document.getElementById('responseHeadersList');
    const bodyContainer = document.getElementById('responseBodyContainer');
    const errorSection = document.getElementById('errorAlertSection');

    resultSection.style.display = 'block';
    errorSection.style.display = 'none';

    // Status and timing
    const statusClass = response.ok ? 'success' : 'danger';
    statusAlert.className = `alert alert-${statusClass}`;
    statusText.innerHTML = `
      <strong>${response.status} ${response.statusText}</strong>
      <span class="ms-2" style="font-size: 0.9em;">${response.headers.get('content-type') || 'unknown'}</span>
    `;
    timingText.textContent = `${duration}ms`;

    // Headers
    const headerEntries = Array.from(response.headers.entries());
    headersList.innerHTML = headerEntries.map(([key, value]) =>
      `<div><strong>${key}:</strong> ${value}</div>`
    ).join('') || '<div class="text-muted">No headers</div>';

    // Body
    try {
      const formatted = JSON.stringify(JSON.parse(body), null, 2);
      bodyContainer.textContent = formatted;
    } catch (e) {
      bodyContainer.textContent = body || '(empty)';
    }

    ui.showToast({ message: 'Request successful', type: 'success', duration: 2000 });
  }

  /**
   * Display test error
   */
  displayTestError(error) {
    const resultSection = document.getElementById('testResultSection');
    const errorSection = document.getElementById('errorAlertSection');
    const errorMessage = document.getElementById('errorMessage');

    resultSection.style.display = 'block';
    errorSection.style.display = 'block';
    errorMessage.textContent = error.message;

    ui.showToast({ message: `Request failed: ${error.message}`, type: 'danger', duration: 3000 });
  }

  /**
   * Get endpoint value
   */
  getEndpoint() {
    return this.step.config.endpoint || '';
  }

  /**
   * Set endpoint value
   */
  setEndpoint(value) {
    this.step.config.endpoint = value;
    document.getElementById('apiEndpoint').value = value;
    this.updateUrlPreview();
  }
}

/**
 * Initialize API editor modal
 */
function showAPIEditor(stepIndex, step, currentWorkflow) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('apiEditorModal');
  if (!modal) {
    const modalHTML = `
      <div class="modal fade" id="apiEditorModal" tabindex="-1">
        <div class="modal-dialog modal-lg" style="max-width: 1000px;">
          <div class="modal-content" style="max-height: 90vh; display: flex; flex-direction: column;">
            <div class="modal-header">
              <h5 class="modal-title">
                <i class="bi bi-globe me-2"></i>API Step Configuration
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" style="flex: 1; overflow-y: auto;">
              <div id="apiEditorContainer" style="display: flex; flex-direction: column; height: 100%;"></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" id="saveApiBtn">
                <i class="bi bi-check-lg me-2"></i>Save Configuration
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    modal = document.getElementById('apiEditorModal');
  }

  // Initialize editor
  const editor = new APIEditor(stepIndex, step, currentWorkflow);
  window.apiEditorInstance = editor;

  const container = document.getElementById('apiEditorContainer');
  editor.initializeEditor(container);

  // Save button
  document.getElementById('saveApiBtn').onclick = () => {
    // Update auth config before saving
    editor.updateAuthConfig();
    isDirty = true;
    const bsModal = bootstrap.Modal.getInstance(modal);
    bsModal.hide();
    ui.showToast({ message: 'API configuration saved', type: 'success' });
  };

  // Show modal
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
}

// Export for use
window.showAPIEditor = showAPIEditor;
