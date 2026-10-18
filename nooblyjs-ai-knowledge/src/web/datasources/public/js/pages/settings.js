/**
 * Settings Page (Task 7.2.9)
 *
 * Comprehensive application settings management with three main sections:
 * - General Settings: Application name, defaults, history
 * - AI Settings: Provider selection, model config, connection testing
 * - User Preferences: Theme, notifications, UI preferences
 *
 * Features:
 * - Three tabbed interface
 * - Unsaved changes tracking
 * - Persistent storage via /api/settings
 * - Theme application in real-time
 * - AI connection testing
 */

class Settings {
  constructor() {
    this.settings = null;
    this.isDirty = false;
    this.originalSettings = null;
  }

  async init() {
    await this.loadSettings();
    this.render();
    this.setupEventListeners();
  }

  async loadSettings() {
    const loader = showSpinner({ message: 'Loading settings...' });

    try {
      const response = await window.apiCall('/api/settings');
      const result = await response.json();

      if (result.success) {
        this.settings = result.data;
        this.originalSettings = JSON.parse(JSON.stringify(result.data));
      } else {
        // Use defaults if no settings exist
        this.settings = this.getDefaultSettings();
        this.originalSettings = JSON.parse(JSON.stringify(this.settings));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      ui.showToast({ message: `Failed to load settings: ${error.message}`, type: 'danger' });
      this.settings = this.getDefaultSettings();
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
    } finally {
      loader.hide();
    }
  }

  getDefaultSettings() {
    return {
      general: {
        applicationName: 'noobly Wiki',
        defaultWorkflowStatus: 'draft',
        autoSaveInterval: 30,
        maxExecutionHistory: 100,
        dateTimeFormat: 'en-US'
      },
      ai: {
        provider: 'ollama',
        model: 'tinyllama:1.1b',
        apiKey: '',
        temperature: 0.7,
        maxTokens: 2048
      },
      userPreferences: {
        theme: 'auto',
        sidebarCollapsed: false,
        notificationsEnabled: true,
        soundEffectsEnabled: false,
        itemsPerPage: 10
      }
    };
  }

  render() {
    if (!this.settings) return;

    const mainContent = document.getElementById('mainContent');

    // Create tab content elements
    const generalTab = this.createGeneralTabContent();
    const aiTab = this.createAITabContent();
    const userPrefTab = this.createUserPreferencesTabContent();

    const settingsHTML = `
      <nav class="kr-breadcrumb">
        <a href="#"><i class="bi bi-house-door"></i></a>
        <span class="sep">›</span>
        <a href="#">Datasources</a>
        <span class="sep">›</span>
        <span class="last">Settings</span>
      </nav>

      <div class="kr-page-hero">
        <div class="eyebrow">Configuration</div>
        <h1>Settings</h1>
        <p>Configure system, AI, and per-user preferences for the datasources platform.</p>
      </div>

      <div class="kr-surface">
        <div class="kr-surface-head" style="padding: 0;">
          <ul class="nav nav-tabs" id="settingsTabs" role="tablist" style="border: 0; flex-wrap: wrap;">
            <li class="nav-item" role="presentation">
              <button class="nav-link active" id="tab-general" type="button" role="tab"
                      onclick="settingsInstance.switchTab('general'); return false;">
                <i class="bi bi-gear"></i> General
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link" id="tab-ai" type="button" role="tab"
                      onclick="settingsInstance.switchTab('ai'); return false;">
                <i class="bi bi-robot"></i> AI settings
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link" id="tab-preferences" type="button" role="tab"
                      onclick="settingsInstance.switchTab('preferences'); return false;">
                <i class="bi bi-person-circle"></i> User preferences
              </button>
            </li>
          </ul>
        </div>

        <div class="kr-surface-body tab-content" id="settingsTabContent">
          <div class="tab-pane fade show active" id="general" role="tabpanel"></div>
          <div class="tab-pane fade" id="ai" role="tabpanel"></div>
          <div class="tab-pane fade" id="preferences" role="tabpanel"></div>
        </div>

        <div style="border-top: 1px solid var(--kr-border-2); padding: 16px 20px; display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn-ghost" id="btnCancelSettings">
            <i class="bi bi-x-lg"></i> Cancel
          </button>
          <button type="button" class="btn btn-secondary" id="btnResetSettings">
            <i class="bi bi-arrow-counterclockwise"></i> Reset
          </button>
          <button type="button" class="btn btn-primary" id="btnSaveSettings">
            <i class="bi bi-check-lg"></i> Save
          </button>
        </div>
      </div>
    `;

    mainContent.innerHTML = settingsHTML;

    // Add tab content
    document.getElementById('general').appendChild(generalTab);
    document.getElementById('ai').appendChild(aiTab);
    document.getElementById('preferences').appendChild(userPrefTab);
  }

  switchTab(tabName) {
    // Update active tab
    document.querySelectorAll('#settingsTabs .nav-link').forEach(link => {
      link.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Update active pane
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('show', 'active');
    });
    const tabMap = {
      'general': 'general',
      'ai': 'ai',
      'preferences': 'preferences'
    };
    const paneId = tabMap[tabName];
    if (paneId) {
      document.getElementById(paneId).classList.add('show', 'active');
    }
  }

  createGeneralTabContent() {
    const div = document.createElement('div');
    div.className = 'p-4';

    div.innerHTML = `
      <form id="generalSettingsForm">
        <div class="mb-4">
          <label class="form-label"><i class="bi bi-app-indicator"></i> <strong>Application Name</strong></label>
          <input type="text" class="form-control" id="applicationName"
                 value="${this.settings.general.applicationName}">
          <small class="text-muted">The name displayed in the application header</small>
        </div>

        <div class="mb-4">
          <label class="form-label"><i class="bi bi-diagram-3"></i> <strong>Default Workflow Status</strong></label>
          <select class="form-select" id="defaultWorkflowStatus">
            <option value="draft" ${this.settings.general.defaultWorkflowStatus === 'draft' ? 'selected' : ''}>
              Draft (Not ready for production)
            </option>
            <option value="active" ${this.settings.general.defaultWorkflowStatus === 'active' ? 'selected' : ''}>
              Active (Ready to run)
            </option>
          </select>
          <small class="text-muted">Default status for newly created workflows</small>
        </div>

        <div class="mb-4">
          <label class="form-label"><i class="bi bi-clock"></i> <strong>Auto-save Interval (seconds)</strong></label>
          <input type="number" class="form-control" id="autoSaveInterval"
                 value="${this.settings.general.autoSaveInterval}" min="10" max="300">
          <small class="text-muted">How often to automatically save workflows while editing (10-300 seconds)</small>
        </div>

        <div class="mb-4">
          <label class="form-label"><i class="bi bi-file-text"></i> <strong>Max Execution History Entries</strong></label>
          <input type="number" class="form-control" id="maxExecutionHistory"
                 value="${this.settings.general.maxExecutionHistory}" min="10" max="1000">
          <small class="text-muted">Maximum number of execution records to keep in the system</small>
        </div>

        <div class="mb-0">
          <label class="form-label"><i class="bi bi-calendar3"></i> <strong>Date/Time Format</strong></label>
          <select class="form-select" id="dateTimeFormat">
            <option value="en-US" ${this.settings.general.dateTimeFormat === 'en-US' ? 'selected' : ''}>
              MM/DD/YYYY (United States)
            </option>
            <option value="en-GB" ${this.settings.general.dateTimeFormat === 'en-GB' ? 'selected' : ''}>
              DD/MM/YYYY (United Kingdom)
            </option>
            <option value="de-DE" ${this.settings.general.dateTimeFormat === 'de-DE' ? 'selected' : ''}>
              DD.MM.YYYY (Germany)
            </option>
          </select>
          <small class="text-muted">Format for displaying dates throughout the application</small>
        </div>
      </form>
    `;

    return div;
  }

  createAITabContent() {
    const div = document.createElement('div');
    div.className = 'p-4';

    div.innerHTML = `
      <form id="aiSettingsForm">
        <div class="alert alert-info mb-4">
          <i class="bi bi-info-circle"></i>
          <strong>AI Integration:</strong> Configure the AI service used for content generation and analysis. Leave provider as "None" to disable AI features.
        </div>

        <div class="mb-4">
          <label class="form-label"><i class="bi bi-cloud-check"></i> <strong>AI Provider</strong></label>
          <select class="form-select" id="aiProvider" onchange="settingsInstance.updateAIProviderInfo()">
            <option value="none" ${this.settings.ai.provider === 'none' ? 'selected' : ''}>
              None (Disabled)
            </option>
            <option value="ollama" ${this.settings.ai.provider === 'ollama' ? 'selected' : ''}>
              Ollama (Local/Self-hosted)
            </option>
            <option value="claude" ${this.settings.ai.provider === 'claude' ? 'selected' : ''}>
              Anthropic Claude (API)
            </option>
            <option value="openai" ${this.settings.ai.provider === 'openai' ? 'selected' : ''}>
              OpenAI ChatGPT (API)
            </option>
          </select>
          <small class="text-muted d-block mt-2">Ollama runs locally and doesn't require an API key. API providers require authentication.</small>
          <small id="aiProviderInfo" class="text-muted d-block"></small>
        </div>

        <div class="mb-4">
          <label class="form-label"><i class="bi bi-cpu"></i> <strong>Model</strong></label>
          <input type="text" class="form-control" id="aiModel"
                 value="${this.settings.ai.model}" placeholder="e.g., tinyllama:1.1b or gpt-4">
          <small class="text-muted">
            <strong>Ollama:</strong> Use format like "tinyllama:1.1b" or "mistral:latest"
            <br><strong>Claude:</strong> Use "claude-3-opus" or "claude-3-sonnet"
            <br><strong>OpenAI:</strong> Use "gpt-4" or "gpt-3.5-turbo"
          </small>
        </div>

        <div class="mb-4">
          <label class="form-label"><i class="bi bi-key"></i> <strong>API Key</strong></label>
          <input type="password" class="form-control" id="aiApiKey"
                 value="${this.settings.ai.apiKey}" placeholder="Enter API key if required">
          <small class="text-muted">
            Leave blank for Ollama (local). Required for Claude and OpenAI.
            <br><strong>Security:</strong> Never share your API key. It will be stored securely in the application.
          </small>
        </div>

        <div class="row mb-4">
          <div class="col-md-6">
            <label class="form-label"><i class="bi bi-thermometer-half"></i> <strong>Temperature: <span id="temperatureValue">${this.settings.ai.temperature}</span></strong></label>
            <input type="range" class="form-range" id="aiTemperature"
                   min="0" max="1" step="0.1" value="${this.settings.ai.temperature}"
                   oninput="document.getElementById('temperatureValue').textContent = this.value">
            <small class="text-muted">Lower (0.0) = more deterministic/focused. Higher (1.0) = more creative/random.</small>
          </div>

          <div class="col-md-6">
            <label class="form-label"><i class="bi bi-bar-chart"></i> <strong>Max Tokens: <span id="maxTokensValue">${this.settings.ai.maxTokens}</span></strong></label>
            <input type="range" class="form-range" id="aiMaxTokens"
                   min="256" max="4096" step="256" value="${this.settings.ai.maxTokens}"
                   oninput="document.getElementById('maxTokensValue').textContent = this.value">
            <small class="text-muted">Maximum length of AI-generated responses. Higher values allow longer outputs.</small>
          </div>
        </div>

        <div class="mb-0">
          <button type="button" class="btn btn-primary" id="btnTestAIConnection">
            <i class="bi bi-lightning-fill"></i> Test Connection
          </button>
          <small class="text-muted d-block mt-2">Click to verify that your AI provider is correctly configured and accessible.</small>
        </div>
      </form>
    `;

    return div;
  }

  createUserPreferencesTabContent() {
    const div = document.createElement('div');
    div.className = 'p-4';

    div.innerHTML = `
      <form id="userPreferencesForm">
        <div class="mb-4">
          <label class="form-label"><i class="bi bi-palette"></i> <strong>Theme</strong></label>
          <select class="form-select" id="theme">
            <option value="auto" ${this.settings.userPreferences.theme === 'auto' ? 'selected' : ''}>
              Auto (Follow system preference)
            </option>
            <option value="light" ${this.settings.userPreferences.theme === 'light' ? 'selected' : ''}>
              Light (Always bright)
            </option>
            <option value="dark" ${this.settings.userPreferences.theme === 'dark' ? 'selected' : ''}>
              Dark (Always dark)
            </option>
          </select>
          <small class="text-muted">Select how the application should appear. Changes apply immediately.</small>
        </div>

        <div class="mb-4 border p-3 rounded bg-light">
          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="sidebarCollapsed"
                   ${this.settings.userPreferences.sidebarCollapsed ? 'checked' : ''}>
            <label class="form-check-label" for="sidebarCollapsed">
              <strong>Collapse sidebar by default</strong>
              <small class="text-muted d-block">Sidebar will start collapsed to give more space to content</small>
            </label>
          </div>
        </div>

        <div class="mb-4 border p-3 rounded bg-light">
          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="notificationsEnabled"
                   ${this.settings.userPreferences.notificationsEnabled ? 'checked' : ''}>
            <label class="form-check-label" for="notificationsEnabled">
              <strong>Enable notifications</strong>
              <small class="text-muted d-block">Show toast notifications for important events (saves, errors, completions)</small>
            </label>
          </div>
        </div>

        <div class="mb-4 border p-3 rounded bg-light">
          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="soundEffectsEnabled"
                   ${this.settings.userPreferences.soundEffectsEnabled ? 'checked' : ''}>
            <label class="form-check-label" for="soundEffectsEnabled">
              <strong>Enable sound effects</strong>
              <small class="text-muted d-block">Play audio cues for certain events (optional)</small>
            </label>
          </div>
        </div>

        <div class="mb-0">
          <label class="form-label"><i class="bi bi-list-ul"></i> <strong>Items per page (default)</strong></label>
          <input type="number" class="form-control" id="itemsPerPage"
                 value="${this.settings.userPreferences.itemsPerPage}" min="5" max="100" step="5">
          <small class="text-muted">Default number of rows displayed in table views (5-100)</small>
        </div>
      </form>
    `;

    return div;
  }

  updateAIProviderInfo() {
    const provider = document.getElementById('aiProvider').value;
    const infoSpan = document.getElementById('aiProviderInfo');

    const infos = {
      'none': 'AI features will be disabled.',
      'ollama': 'Make sure Ollama is running locally on localhost:11434',
      'claude': 'Get your API key from https://console.anthropic.com',
      'openai': 'Get your API key from https://platform.openai.com/account/api-keys'
    };

    infoSpan.textContent = infos[provider] || '';
  }

  setupEventListeners() {
    // Track changes for dirty state
    const forms = [
      document.getElementById('generalSettingsForm'),
      document.getElementById('aiSettingsForm'),
      document.getElementById('userPreferencesForm')
    ];

    forms.forEach(form => {
      if (form) {
        form.addEventListener('input', () => {
          this.isDirty = true;
        });
      }
    });

    // Save button
    const btnSave = document.getElementById('btnSaveSettings');
    if (btnSave) {
      btnSave.addEventListener('click', () => this.saveSettings());
    }

    // Cancel button
    const btnCancel = document.getElementById('btnCancelSettings');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (this.isDirty) {
          showConfirmDialog({
            title: 'Unsaved Changes',
            message: 'You have unsaved changes. Are you sure you want to discard them?',
            confirmText: 'Discard',
            confirmClass: 'btn-danger',
            onConfirm: () => {
              renderDashboard();
            }
          });
        } else {
          renderDashboard();
        }
      });
    }

    // Reset button
    const btnReset = document.getElementById('btnResetSettings');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        showConfirmDialog({
          title: 'Reset Settings',
          message: 'Reset all settings to their default values?',
          confirmText: 'Reset',
          confirmClass: 'btn-warning',
          onConfirm: () => {
            this.settings = this.getDefaultSettings();
            this.isDirty = true;
            this.render();
            this.setupEventListeners();
            ui.showToast({ message: 'Settings reset to defaults', type: 'warning' });
          }
        });
      });
    }

    // Test AI connection button
    const testBtn = document.getElementById('btnTestAIConnection');
    if (testBtn) {
      testBtn.addEventListener('click', () => {
        this.testAIConnection();
      });
    }

    // Update AI provider info on load
    this.updateAIProviderInfo();
  }

  async saveSettings() {
    // Collect form data
    const updatedSettings = {
      general: {
        applicationName: document.getElementById('applicationName').value,
        defaultWorkflowStatus: document.getElementById('defaultWorkflowStatus').value,
        autoSaveInterval: parseInt(document.getElementById('autoSaveInterval').value) || 30,
        maxExecutionHistory: parseInt(document.getElementById('maxExecutionHistory').value) || 100,
        dateTimeFormat: document.getElementById('dateTimeFormat').value
      },
      ai: {
        provider: document.getElementById('aiProvider').value,
        model: document.getElementById('aiModel').value,
        apiKey: document.getElementById('aiApiKey').value,
        temperature: parseFloat(document.getElementById('aiTemperature').value),
        maxTokens: parseInt(document.getElementById('aiMaxTokens').value)
      },
      userPreferences: {
        theme: document.getElementById('theme').value,
        sidebarCollapsed: document.getElementById('sidebarCollapsed').checked,
        notificationsEnabled: document.getElementById('notificationsEnabled').checked,
        soundEffectsEnabled: document.getElementById('soundEffectsEnabled').checked,
        itemsPerPage: parseInt(document.getElementById('itemsPerPage').value) || 10
      }
    };

    const loader = showSpinner({ message: 'Saving settings...' });

    try {
      const response = await window.apiCall('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings)
      });

      const result = await response.json();

      if (result.success) {
        this.settings = updatedSettings;
        this.originalSettings = JSON.parse(JSON.stringify(updatedSettings));
        this.isDirty = false;

        ui.showToast({ message: 'Settings saved successfully!', type: 'success' });

        // Apply theme if changed
        const oldTheme = this.originalSettings.userPreferences.theme;
        const newTheme = updatedSettings.userPreferences.theme;
        if (oldTheme !== newTheme) {
          this.applyTheme(newTheme);
        }
      } else {
        ui.showToast({ message: `Failed to save: ${result.message}`, type: 'danger' });
      }
    } catch (error) {
      ui.showToast({ message: `Error saving settings: ${error.message}`, type: 'danger' });
    } finally {
      loader.hide();
    }
  }

  applyTheme(theme) {
    const html = document.documentElement;

    if (theme === 'dark') {
      html.setAttribute('data-bs-theme', 'dark');
    } else if (theme === 'light') {
      html.setAttribute('data-bs-theme', 'light');
    } else {
      // Auto - detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      html.setAttribute('data-bs-theme', prefersDark ? 'dark' : 'light');
    }
  }

  async testAIConnection() {
    const provider = document.getElementById('aiProvider').value;
    const model = document.getElementById('aiModel').value;
    const apiKey = document.getElementById('aiApiKey').value;

    if (provider === 'none') {
      ui.showToast({ message: 'AI is disabled. Select a provider to test connection.', type: 'warning' });
      return;
    }

    if (!model) {
      ui.showToast({ message: 'Please specify a model name', type: 'warning' });
      return;
    }

    const loader = showSpinner({ message: 'Testing AI connection...' });

    try {
      const response = await window.apiCall('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, apiKey })
      });

      const result = await response.json();

      if (result.success) {
        ui.showToast({ message: 'AI connection successful! ✓', type: 'success' });
      } else {
        ui.showToast({ message: `Connection failed: ${result.message}`, type: 'danger' });
      }
    } catch (error) {
      ui.showToast({ message: `Error testing connection: ${error.message}`, type: 'danger' });
    } finally {
      loader.hide();
    }
  }
}

// Global instance
let settingsInstance;

/**
 * Global render function for navigation
 */
window.renderSettings = function() {
  settingsInstance = new Settings();
  settingsInstance.init();
};
