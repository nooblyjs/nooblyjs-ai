/**
 * Execution Monitor Component (Task 5.2)
 *
 * Provides real-time monitoring of workflow executions with:
 * - Live execution list with progress tracking
 * - Step-by-step progress visualization
 * - Execution log viewer
 * - Failure alerts and notifications
 * - WebSocket event integration
 */

class ExecutionMonitor {
  constructor() {
    this.liveExecutions = new Map(); // Map of executionId -> execution data
    this.selectedExecution = null;
    this.logs = {};
    this.logFilters = {
      level: 'all', // all, debug, info, warn, error
      searchText: ''
    };
    this.soundEnabled = true;
    this.webSocketConnected = false;
    this.updateInterval = null;
  }

  /**
   * Initialize execution monitor
   */
  async init() {
    await this.loadLiveExecutions();
    this.setupWebSocketListeners();
    this.startPeriodicUpdates();
  }

  /**
   * Load currently running executions
   */
  async loadLiveExecutions() {
    try {
      // Fetch executions with "running" status
      const response = await window.apiCall('/api/executions?status=running', {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error(`Failed to load executions: ${response.statusText}`);

      const result = await response.json();
      const executions = result.data || [];

      // Clear and repopulate live executions
      this.liveExecutions.clear();
      executions.forEach(exec => {
        this.liveExecutions.set(exec.id, {
          ...exec,
          startedAt: new Date(exec.executedAt),
          elapsedMs: Date.now() - new Date(exec.executedAt).getTime()
        });
      });

      this.render();
    } catch (error) {
      console.error('Error loading live executions:', error);
      this.showError('Failed to load live executions: ' + error.message);
    }
  }

  /**
   * Setup WebSocket event listeners for real-time updates
   */
  setupWebSocketListeners() {
    // Check if socket.io is available
    if (typeof io !== 'undefined') {
      const socket = io();

      socket.on('workflow:started', (data) => {
        this.handleWorkflowStarted(data);
      });

      socket.on('workflow:step:started', (data) => {
        this.handleStepStarted(data);
      });

      socket.on('workflow:step:completed', (data) => {
        this.handleStepCompleted(data);
      });

      socket.on('workflow:completed', (data) => {
        this.handleWorkflowCompleted(data);
      });

      socket.on('workflow:failed', (data) => {
        this.handleWorkflowFailed(data);
      });

      this.webSocketConnected = true;
    } else {
      console.warn('Socket.IO not available - real-time updates disabled');
    }
  }

  /**
   * F5.2.5.1 - Handle workflow:started event
   */
  handleWorkflowStarted(data) {
    const exec = {
      id: data.executionId || data.id,
      workflowId: data.workflowId,
      workflowName: data.workflowName,
      status: 'running',
      progress: 0,
      currentStep: 0,
      totalSteps: data.totalSteps || 0,
      startedAt: new Date(),
      elapsedMs: 0,
      steps: [],
      logs: []
    };

    this.liveExecutions.set(exec.id, exec);
    this.addLog(exec.id, 'info', `Workflow started: ${exec.workflowName}`);
    this.render();
  }

  /**
   * F5.2.5.2 - Handle workflow:step:started event
   */
  handleStepStarted(data) {
    const exec = this.liveExecutions.get(data.executionId);
    if (!exec) return;

    const stepIndex = data.stepIndex || 0;
    if (!exec.steps[stepIndex]) {
      exec.steps[stepIndex] = {};
    }

    exec.steps[stepIndex] = {
      ...exec.steps[stepIndex],
      name: data.stepName,
      status: 'running',
      startedAt: new Date(),
      icon: this.getStepIcon('running')
    };

    exec.currentStep = stepIndex;
    this.addLog(data.executionId, 'info', `Step started: ${data.stepName}`);
    this.render();
  }

  /**
   * F5.2.5.3 - Handle workflow:step:completed event
   */
  handleStepCompleted(data) {
    const exec = this.liveExecutions.get(data.executionId);
    if (!exec) return;

    const stepIndex = data.stepIndex || 0;
    const startTime = exec.steps[stepIndex]?.startedAt || new Date();
    const duration = Date.now() - new Date(startTime).getTime();

    exec.steps[stepIndex] = {
      ...exec.steps[stepIndex],
      status: 'completed',
      duration,
      icon: this.getStepIcon('completed')
    };

    const completedCount = exec.steps.filter(s => s && (s.status === 'completed' || s.status === 'failed')).length;
    exec.progress = Math.round((completedCount / exec.totalSteps) * 100);

    this.addLog(data.executionId, 'info', `Step completed: ${data.stepName} (${this.formatDuration(duration)})`);
    this.render();
  }

  /**
   * F5.2.5.4 - Handle workflow:completed event
   */
  handleWorkflowCompleted(data) {
    const exec = this.liveExecutions.get(data.executionId);
    if (!exec) return;

    exec.status = 'completed';
    exec.progress = 100;
    exec.completedAt = new Date();
    exec.duration = Date.now() - new Date(exec.startedAt).getTime();

    // Mark all steps as completed if not already
    exec.steps.forEach((step, idx) => {
      if (step && !step.status) {
        exec.steps[idx].status = 'completed';
        exec.steps[idx].icon = this.getStepIcon('completed');
      }
    });

    this.addLog(data.executionId, 'info', `Workflow completed successfully in ${this.formatDuration(exec.duration)}`);

    // Show success notification
    if (window.ui && window.ui.showToast) {
      window.ui.showToast({
        message: `Workflow execution completed: ${exec.workflowName}`,
        type: 'success',
        duration: 5000
      });
    }

    this.render();
  }

  /**
   * F5.2.5.5 - Handle workflow:failed event
   */
  handleWorkflowFailed(data) {
    const exec = this.liveExecutions.get(data.executionId);
    if (!exec) return;

    exec.status = 'failed';
    exec.error = data.error || 'Unknown error';
    exec.completedAt = new Date();
    exec.duration = Date.now() - new Date(exec.startedAt).getTime();

    const currentStepIdx = exec.currentStep || 0;
    if (exec.steps[currentStepIdx]) {
      exec.steps[currentStepIdx].status = 'failed';
      exec.steps[currentStepIdx].icon = this.getStepIcon('failed');
      exec.steps[currentStepIdx].error = data.error;
    }

    this.addLog(data.executionId, 'error', `Workflow failed: ${data.error}`);

    // F5.2.4 - Show failure alert with toast notification
    this.showFailureAlert(exec);

    this.render();
  }

  /**
   * F5.2.4.1 - Show failure alert notification
   */
  showFailureAlert(execution) {
    // Toast notification
    if (window.ui && window.ui.showToast) {
      window.ui.showToast({
        message: `❌ Workflow failed: ${execution.workflowName} - ${execution.error}`,
        type: 'danger',
        duration: 7000
      });
    }

    // F5.2.4.2 - Play sound alert if enabled
    if (this.soundEnabled) {
      this.playFailureSound();
    }
  }

  /**
   * F5.2.4.2 - Play failure sound
   */
  playFailureSound() {
    // Create a simple beep using Web Audio API
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Frequency in Hz
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.warn('Failed to play failure sound:', error);
    }
  }

  /**
   * Add log entry
   */
  addLog(executionId, level, message) {
    if (!this.logs[executionId]) {
      this.logs[executionId] = [];
    }

    this.logs[executionId].push({
      timestamp: new Date(),
      level, // debug, info, warn, error
      message
    });
  }

  /**
   * F5.2.3 - Get filtered logs for execution
   */
  getFilteredLogs(executionId) {
    const allLogs = this.logs[executionId] || [];

    return allLogs.filter(log => {
      const levelMatch = this.logFilters.level === 'all' || log.level === this.logFilters.level;
      const textMatch = !this.logFilters.searchText ||
        log.message.toLowerCase().includes(this.logFilters.searchText.toLowerCase());
      return levelMatch && textMatch;
    });
  }

  /**
   * Main render function
   */
  render() {
    const container = document.getElementById('executionMonitorContainer');
    if (!container) return;

    const html = `
      <div class="execution-monitor">
        <nav class="kr-breadcrumb">
          <a href="#"><i class="bi bi-house-door"></i></a>
          <span class="sep">›</span>
          <a href="#">Datasources</a>
          <span class="sep">›</span>
          <span class="last">Execution history</span>
        </nav>

        <div class="d-flex align-items-end justify-content-between flex-wrap gap-3 mb-3">
          <div>
            <h2 style="font-size: 24px; font-weight: 800; letter-spacing: -.01em; margin: 0;">
              <i class="bi bi-activity" style="color: var(--kr-teal-600);"></i> Live execution monitor
            </h2>
            <div style="color: var(--kr-ink-500); font-size: 12px;">Real-time view of running and recent workflow executions.</div>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-ghost" onclick="executionMonitor.toggleSoundAlert()">
              <i class="bi ${this.soundEnabled ? 'bi-volume-up' : 'bi-volume-mute'}"></i>
              ${this.soundEnabled ? 'Sound on' : 'Sound off'}
            </button>
            <button class="btn btn-secondary" onclick="executionMonitor.loadLiveExecutions()">
              <i class="bi bi-arrow-clockwise"></i> Refresh
            </button>
          </div>
        </div>

        ${this.liveExecutions.size === 0
          ? this.renderEmptyState()
          : this.renderExecutionsList()
        }
      </div>
    `;

    container.innerHTML = html;

    // Render selected execution details if one is selected
    if (this.selectedExecution) {
      this.renderExecutionDetails();
    }
  }

  /**
   * Render empty state
   */
  renderEmptyState() {
    return `
      <div class="kr-empty-tile">
        <div class="ico"><i class="bi bi-hourglass-split"></i></div>
        <h4>No executions running</h4>
        <p>Workflow executions will appear here as they run.</p>
      </div>
    `;
  }

  /**
   * F5.2.1 - Render live executions list
   */
  renderExecutionsList() {
    const executions = Array.from(this.liveExecutions.values());

    return `
      <div class="row">
        <div class="col-lg-6">
          <div class="card">
            <div class="card-header bg-light">
              <h6 class="mb-0">
                <i class="bi bi-list-check"></i> Running Executions (${executions.length})
              </h6>
            </div>
            <div class="card-body" style="max-height: 600px; overflow-y: auto;">
              ${executions.map(exec => this.renderExecutionCard(exec)).join('')}
            </div>
          </div>
        </div>

        <div class="col-lg-6">
          ${this.selectedExecution ? this.renderSelectedExecutionPanel() : this.renderNoSelectionPanel()}
        </div>
      </div>
    `;
  }

  /**
   * F5.2.1.1 - Render individual execution card
   */
  renderExecutionCard(exec) {
    const elapsedTime = this.formatDuration(exec.elapsedMs || (Date.now() - new Date(exec.startedAt).getTime()));
    const statusBadgeClass = exec.status === 'running' ? 'bg-primary' :
                             exec.status === 'completed' ? 'bg-success' :
                             exec.status === 'failed' ? 'bg-danger' : 'bg-secondary';

    return `
      <div class="card mb-3 border-left-4 border-left-${exec.status === 'failed' ? 'danger' : 'primary'} cursor-pointer"
           onclick="executionMonitor.selectExecution('${exec.id}')"
           style="border-left: 4px solid ${exec.status === 'failed' ? '#dc3545' : 'var(--accent)'};">
        <div class="card-body pb-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <h6 class="mb-0 fw-bold">${exec.workflowName || 'Unknown'}</h6>
              <small class="text-muted">${exec.id}</small>
            </div>
            <span class="badge ${statusBadgeClass}">${exec.status}</span>
          </div>

          <!-- F5.2.1.2 - Progress indicator -->
          <div class="mb-2">
            <div class="progress" style="height: 8px;">
              <div class="progress-bar ${exec.status === 'failed' ? 'bg-danger' : 'bg-success'}"
                   role="progressbar" style="width: ${exec.progress || 0}%"
                   aria-valuenow="${exec.progress || 0}" aria-valuemin="0" aria-valuemax="100"></div>
            </div>
            <small class="text-muted">${exec.progress || 0}% complete</small>
          </div>

          <!-- F5.2.1.3 - Current step and elapsed time -->
          <div class="row small text-muted">
            <div class="col-6">
              <i class="bi bi-play-circle"></i>
              Step ${(exec.currentStep || 0) + 1} of ${exec.totalSteps || '?'}
            </div>
            <div class="col-6 text-end">
              <i class="bi bi-clock-history"></i>
              ${elapsedTime}
            </div>
          </div>

          ${exec.error ? `
            <div class="alert alert-danger alert-sm mt-2 mb-0" style="padding: 7px;">
              <small>${exec.error}</small>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Render selected execution details panel
   */
  renderSelectedExecutionPanel() {
    const exec = this.selectedExecution;

    return `
      <div class="card">
        <div class="card-header bg-light d-flex justify-content-between align-items-center">
          <h6 class="mb-0">Execution Details</h6>
          <button class="btn btn-sm btn-outline-secondary" onclick="executionMonitor.deselectExecution()">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="card-body" style="max-height: 600px; overflow-y: auto;">
          ${this.renderStepTimeline()}
          ${this.renderLogViewer()}
        </div>
      </div>
    `;
  }

  /**
   * F5.2.2 - Render step-by-step timeline
   */
  renderStepTimeline() {
    const exec = this.selectedExecution;
    const steps = exec.steps || [];

    return `
      <div class="mb-4">
        <h6 class="mb-3">
          <i class="bi bi-diagram-3"></i> Step Timeline
        </h6>
        <div class="timeline">
          ${steps.length === 0 ? '<p class="text-muted small">No step data yet</p>' : ''}
          ${steps.map((step, idx) => `
            <div class="timeline-item ${step ? `timeline-${step.status}` : 'timeline-pending'}">
              <div class="timeline-marker">
                ${step ? `<i class="bi ${step.icon}"></i>` : '<i class="bi bi-circle"></i>'}
              </div>
              <div class="timeline-content">
                <div class="d-flex justify-content-between align-items-start">
                  <div>
                    <h6 class="mb-1">${step ? step.name : `Step ${idx + 1}`}</h6>
                    <small class="text-muted">${step ? step.status : 'pending'}</small>
                  </div>
                  ${step && step.duration ? `
                    <small class="text-muted fw-bold">${this.formatDuration(step.duration)}</small>
                  ` : ''}
                </div>
                ${step && step.error ? `
                  <small class="text-danger mt-1">${step.error}</small>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <style>
        .timeline {
          position: relative;
          padding: 10px 0;
        }
        .timeline-item {
          display: flex;
          margin-bottom: 20px;
          position: relative;
        }
        .timeline-marker {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 15px;
          flex-shrink: 0;
          font-size: 12px;
        }
        .timeline-running .timeline-marker {
          background-color: var(--accent);
          color: white;
          animation: pulse 1.5s infinite;
        }
        .timeline-completed .timeline-marker {
          background-color: #198754;
          color: white;
        }
        .timeline-failed .timeline-marker {
          background-color: #dc3545;
          color: white;
        }
        .timeline-pending .timeline-marker {
          background-color: #e9ecef;
          color: #6c757d;
        }
        .timeline-content {
          flex: 1;
          padding-bottom: 10px;
          border-bottom: 1px solid #e9ecef;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      </style>
    `;
  }

  /**
   * F5.2.3 - Render execution log viewer
   */
  renderLogViewer() {
    const exec = this.selectedExecution;
    const logs = this.getFilteredLogs(exec.id);

    return `
      <div class="mb-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h6 class="mb-0">
            <i class="bi bi-file-text"></i> Execution Logs
          </h6>
          <button class="btn btn-sm btn-outline-secondary" onclick="executionMonitor.copyLogs('${exec.id}')">
            <i class="bi bi-clipboard"></i> Copy
          </button>
        </div>

        <!-- Log Filters -->
        <div class="row g-2 mb-3">
          <div class="col-auto">
            <select class="form-select form-select-sm" onchange="executionMonitor.setLogFilter('level', this.value)">
              <option value="all" ${this.logFilters.level === 'all' ? 'selected' : ''}>All Levels</option>
              <option value="debug" ${this.logFilters.level === 'debug' ? 'selected' : ''}>Debug</option>
              <option value="info" ${this.logFilters.level === 'info' ? 'selected' : ''}>Info</option>
              <option value="warn" ${this.logFilters.level === 'warn' ? 'selected' : ''}>Warnings</option>
              <option value="error" ${this.logFilters.level === 'error' ? 'selected' : ''}>Errors</option>
            </select>
          </div>
          <div class="col">
            <input type="text" class="form-control form-control-sm" placeholder="Search logs..."
                   onchange="executionMonitor.setLogFilter('search', this.value)"
                   value="${this.logFilters.searchText}">
          </div>
        </div>

        <!-- Log Viewer -->
        <div class="log-viewer bg-dark text-light p-3 rounded" style="max-height: 250px; overflow-y: auto; font-family: monospace; font-size: 10px;">
          ${logs.length === 0
            ? '<div class="text-muted">No logs matching filters</div>'
            : logs.map(log => `
              <div class="log-entry log-${log.level}">
                <span class="log-time">${log.timestamp.toLocaleTimeString()}</span>
                <span class="badge badge-${this.getLogLevelBadgeColor(log.level)} ms-2">${log.level.toUpperCase()}</span>
                <span class="ms-2">${log.message}</span>
              </div>
            `).join('')
          }
        </div>
      </div>

      <style>
        .log-viewer {
          background-color: #1e1e1e;
          border: 1px solid #333;
        }
        .log-entry {
          margin-bottom: 4px;
          line-height: 1.5;
        }
        .log-debug { color: #7dd3fc; }
        .log-info { color: #86efac; }
        .log-warn { color: #fbbf24; }
        .log-error { color: #f87171; }
        .log-time { color: #9ca3af; }
      </style>
    `;
  }

  /**
   * Render no selection panel
   */
  renderNoSelectionPanel() {
    return `
      <div class="card">
        <div class="card-body text-center py-5 text-muted">
          <i class="bi bi-arrow-left" style="font-size: 28px;"></i>
          <p class="mt-3">Select an execution to view details</p>
        </div>
      </div>
    `;
  }

  /**
   * F5.2.2.4 - Click step for details (future enhancement)
   */
  selectExecution(executionId) {
    this.selectedExecution = this.liveExecutions.get(executionId);
    this.render();
  }

  /**
   * Deselect execution
   */
  deselectExecution() {
    this.selectedExecution = null;
    this.render();
  }

  /**
   * Render details for selected execution
   */
  renderExecutionDetails() {
    // Details are already rendered inline in the panel
  }

  /**
   * Copy logs to clipboard
   */
  copyLogs(executionId) {
    const logs = this.getFilteredLogs(executionId);
    const text = logs.map(log =>
      `[${log.timestamp.toLocaleTimeString()}] ${log.level.toUpperCase()}: ${log.message}`
    ).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      if (window.ui && window.ui.showToast) {
        window.ui.showToast({
          message: 'Logs copied to clipboard',
          type: 'success',
          duration: 2000
        });
      }
    });
  }

  /**
   * Set log filter
   */
  setLogFilter(filterType, value) {
    if (filterType === 'level') {
      this.logFilters.level = value;
    } else if (filterType === 'search') {
      this.logFilters.searchText = value;
    }
    this.render();
  }

  /**
   * Toggle sound alert
   */
  toggleSoundAlert() {
    this.soundEnabled = !this.soundEnabled;
    this.render();
  }

  /**
   * Start periodic updates
   */
  startPeriodicUpdates() {
    // Update elapsed time every second
    this.updateInterval = setInterval(() => {
      if (this.liveExecutions.size > 0) {
        this.liveExecutions.forEach(exec => {
          if (exec.status === 'running') {
            exec.elapsedMs = Date.now() - new Date(exec.startedAt).getTime();
          }
        });
        this.render();
      }
    }, 1000);
  }

  /**
   * Stop periodic updates
   */
  stopPeriodicUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Utility: Format duration
   */
  formatDuration(ms) {
    if (!ms || ms < 0) return '0ms';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else if (seconds > 0) {
      return `${seconds}s`;
    } else {
      return `${ms}ms`;
    }
  }

  /**
   * Utility: Get step icon based on status
   */
  getStepIcon(status) {
    const icons = {
      'pending': 'bi-circle',
      'running': 'bi-arrow-repeat',
      'completed': 'bi-check-circle-fill',
      'failed': 'bi-x-circle-fill'
    };
    return icons[status] || icons.pending;
  }

  /**
   * Utility: Get log level badge color
   */
  getLogLevelBadgeColor(level) {
    const colors = {
      'debug': 'bg-info',
      'info': 'bg-success',
      'warn': 'bg-warning',
      'error': 'bg-danger'
    };
    return colors[level] || 'bg-secondary';
  }

  /**
   * Show error message
   */
  showError(message) {
    if (window.ui && window.ui.showToast) {
      window.ui.showToast({
        message: message,
        type: 'danger',
        duration: 5000
      });
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopPeriodicUpdates();
  }
}

/**
 * Global instance
 */
let executionMonitor;

/**
 * Initialize execution monitor when called
 */
async function initExecutionMonitor() {
  executionMonitor = new ExecutionMonitor();
  await executionMonitor.init();
  return executionMonitor;
}

/**
 * Render execution monitor dashboard
 */
function renderExecutionMonitorDashboard() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  container.innerHTML = `
    <div class="container-fluid py-4">
      <div id="executionMonitorContainer"></div>
    </div>
  `;

  initExecutionMonitor().catch(error => {
    console.error('Failed to initialize execution monitor:', error);
    if (window.ui && window.ui.showToast) {
      window.ui.showToast({
        message: 'Failed to load execution monitor: ' + error.message,
        type: 'danger',
        duration: 5000
      });
    }
  });
}
