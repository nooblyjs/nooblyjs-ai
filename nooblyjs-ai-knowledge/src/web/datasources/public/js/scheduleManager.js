/**
 * Schedule Manager Component (Task 5.3)
 *
 * Provides comprehensive schedule management with:
 * - List view with sortable columns and pagination
 * - Enable/disable toggles
 * - Edit, delete, and run-now actions
 * - Schedule history with success/failure tracking
 * - Modal-based schedule creation/editing
 */

class ScheduleManager {
  constructor() {
    this.schedules = [];
    this.selectedSchedule = null;
    this.sortColumn = 'name';
    this.sortDirection = 'asc';
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.filterStatus = 'all'; // all, enabled, disabled
    this.scheduleHistory = {};
    this.editingScheduleId = null;
    this.currentView = 'list'; // 'list' or 'form'
  }

  /**
   * Initialize schedule manager
   */
  async init() {
    await this.loadSchedules();
    this.loadScheduleHistory();
  }

  /**
   * Load schedules from API
   */
  async loadSchedules() {
    try {
      // Load workflows first to populate cache for group information
      try {
        const workflowsResponse = await window.apiCall('/api/workflows/list?limit=10000', {
          headers: { 'Content-Type': 'application/json' }
        });
        if (workflowsResponse.ok) {
          const workflowsResult = await workflowsResponse.json();
          window.workflowsCache = workflowsResult.data || [];
        }
      } catch (err) {
        console.warn('Failed to cache workflows:', err);
      }

      const response = await window.apiCall('/api/schedules', {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error(`Failed to load schedules: ${response.statusText}`);

      const result = await response.json();
      this.schedules = result.data || [];

      // Enhance with computed properties
      this.schedules = this.schedules.map(schedule => ({
        ...schedule,
        nextRunTime: new Date(schedule.nextRun),
        lastRunTime: schedule.lastRun ? new Date(schedule.lastRun) : null
      }));

      this.render();
    } catch (error) {
      console.error('Error loading schedules:', error);
      this.showError('Failed to load schedules: ' + error.message);
    }
  }

  /**
   * Load schedule execution history
   */
  async loadScheduleHistory() {
    try {
      // Fetch execution history from /api/executions with filter by schedule
      const response = await window.apiCall('/api/executions?limit=1000', {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to load execution history');

      const result = await response.json();
      const executions = result.data || [];

      // Group executions by schedule
      this.scheduleHistory = {};
      executions.forEach(exec => {
        const scheduleId = exec.scheduleId;
        if (scheduleId) {
          if (!this.scheduleHistory[scheduleId]) {
            this.scheduleHistory[scheduleId] = [];
          }
          this.scheduleHistory[scheduleId].push(exec);
        }
      });
    } catch (error) {
      console.error('Error loading schedule history:', error);
    }
  }

  /**
   * Main render function
   */
  render() {
    const container = document.getElementById('scheduleManagerContainer');
    if (!container) return;

    // Render based on current view
    if (this.currentView === 'form') {
      this.renderFormView();
    } else {
      this.renderListView();
    }
  }

  /**
   * Render list view
   */
  renderListView() {
    const container = document.getElementById('scheduleManagerContainer');
    if (!container) return;

    // Get filtered and sorted schedules
    const filtered = this.getFilteredSchedules();
    const sorted = this.getSortedSchedules(filtered);
    const paginated = this.getPaginatedSchedules(sorted);

    const html = `
      <div class="schedule-manager">
        <nav class="kr-breadcrumb">
          <a href="#"><i class="bi bi-house-door"></i></a>
          <span class="sep">›</span>
          <a href="#">Datasources</a>
          <span class="sep">›</span>
          <span class="last">Schedules</span>
        </nav>

        <div class="d-flex align-items-end justify-content-between flex-wrap gap-3 mb-3">
          <div>
            <h2 style="font-size: 24px; font-weight: 800; letter-spacing: -.01em; margin: 0;">Schedule workflows</h2>
            <div style="color: var(--kr-ink-500); font-size: 12px;">Manage cron schedules for automated workflow execution.</div>
          </div>
          <button class="btn btn-primary" onclick="scheduleManager.showCreateScheduleModal()">
            <i class="bi bi-plus-circle"></i> New schedule
          </button>
        </div>

        <div class="kr-filterbar">
          <div class="field">
            <i class="bi bi-search"></i>
            <input type="text" placeholder="Search schedules…" onchange="scheduleManager.setSearchFilter(this.value)">
          </div>
          <select class="pill" style="min-width: 180px;" onchange="scheduleManager.setFilterStatus(this.value)">
            <option value="all" ${this.filterStatus === 'all' ? 'selected' : ''}>All schedules</option>
            <option value="enabled" ${this.filterStatus === 'enabled' ? 'selected' : ''}>Enabled only</option>
            <option value="disabled" ${this.filterStatus === 'disabled' ? 'selected' : ''}>Disabled only</option>
          </select>
          <button class="pill" onclick="scheduleManager.loadSchedules()">
            <i class="bi bi-arrow-clockwise"></i> Refresh
          </button>
        </div>

        ${this.schedules.length === 0
          ? this.renderEmptyState()
          : `<div class="kr-surface"><div class="kr-surface-body" style="padding: 0;">${this.renderSchedulesTable(paginated, sorted)}</div></div>`
        }
      </div>
    `;

    container.innerHTML = html;

  }

  /**
   * Render form view
   */
  renderFormView() {
    const container = document.getElementById('scheduleManagerContainer');
    if (!container) return;

    const isEdit = this.editingScheduleId !== null;
    const schedule = this.selectedSchedule || { name: '', cronExpression: '0 0 * * *', description: '', enabled: true };

    // Determine initial schedule type
    const hasInterval = schedule.interval && !schedule.cronExpression;
    const scheduleType = hasInterval ? 'interval' : 'cron';
    const intervalValue = schedule.interval || 300;

    const html = `
      <div class="schedule-manager">
        <!-- Header with Back Button -->
        <div class="d-flex justify-content-between align-items-center mb-4">
          <div class="d-flex align-items-center gap-3">
            <button class="btn btn-outline-secondary" onclick="scheduleManager.backToList()">
              <i class="bi bi-arrow-left me-1"></i>Back to List
            </button>
            <h2 class="mb-0"><i class="bi bi-${isEdit ? 'pencil' : 'plus-circle'} me-2"></i>${isEdit ? 'Edit Schedule' : 'Create New Schedule'}</h2>
          </div>
        </div>

        <!-- Form Card -->
        <div class="card border-0 shadow-sm">
          <div class="card-body">
            <form id="scheduleForm">
              <div class="mb-3">
                <label class="form-label">Schedule Name</label>
                <input type="text" class="form-control" id="scheduleName" value="${schedule.name || ''}"
                       placeholder="e.g., Daily Data Import" required>
              </div>

              <div class="mb-3">
                <label class="form-label">Workflow</label>
                <select class="form-select" id="scheduleWorkflow" required>
                  <option value="">Loading workflows...</option>
                </select>
                <small class="text-muted">Select the workflow to run on this schedule</small>
              </div>

              <!-- Schedule Type Toggle -->
              <div class="mb-3">
                <label class="form-label">Schedule Type</label>
                <div class="btn-group w-100" role="group">
                  <input type="radio" class="btn-check" name="scheduleType" id="scheduleTypeCron" value="cron"
                         ${scheduleType === 'cron' ? 'checked' : ''} onchange="scheduleManager.toggleScheduleType()">
                  <label class="btn btn-outline-primary" for="scheduleTypeCron">
                    <i class="bi bi-clock me-1"></i>Cron Expression
                  </label>
                  <input type="radio" class="btn-check" name="scheduleType" id="scheduleTypeInterval" value="interval"
                         ${scheduleType === 'interval' ? 'checked' : ''} onchange="scheduleManager.toggleScheduleType()">
                  <label class="btn btn-outline-primary" for="scheduleTypeInterval">
                    <i class="bi bi-arrow-repeat me-1"></i>Interval
                  </label>
                </div>
              </div>

              <!-- Cron Expression Section -->
              <div class="mb-3" id="cronSection" style="display: ${scheduleType === 'cron' ? 'block' : 'none'};">
                <label class="form-label">Cron Expression</label>
                <input type="text" class="form-control" id="scheduleCron" value="${schedule.cronExpression || '0 0 * * *'}"
                       placeholder="0 0 * * *">
                <small class="text-muted d-block mt-2">
                  <strong>Cron Format:</strong> Minute Hour Day Month DayOfWeek<br>
                  Examples:
                  <ul class="mb-0 mt-1">
                    <li><code>0 0 * * *</code> - Daily at midnight</li>
                    <li><code>0 */6 * * *</code> - Every 6 hours</li>
                    <li><code>0 8 * * MON-FRI</code> - Weekdays at 8 AM</li>
                    <li><code>0 0 1 * *</code> - First day of month</li>
                  </ul>
                </small>
              </div>

              <!-- Interval Section -->
              <div class="mb-3" id="intervalSection" style="display: ${scheduleType === 'interval' ? 'block' : 'none'};">
                <label class="form-label">Run Every (milliseconds)</label>
                <input type="number" class="form-control" id="scheduleIntervalValue"
                       value="${intervalValue}" min="1" placeholder="e.g. 300000 for 5 minutes">
                <div class="mt-1 small text-muted">Examples: 60000 = 1 min, 300000 = 5 min, 3600000 = 1 hour</div>
              </div>

              <div class="mb-3">
                <label class="form-label">Description (Optional)</label>
                <textarea class="form-control" id="scheduleDescription" rows="3"
                          placeholder="Add notes about this schedule...">${schedule.description || ''}</textarea>
              </div>

              <div class="form-check mb-4">
                <input class="form-check-input" type="checkbox" id="scheduleEnabled"
                       ${schedule.enabled !== false ? 'checked' : ''}>
                <label class="form-check-label" for="scheduleEnabled">
                  Enable this schedule
                </label>
              </div>

              <div class="alert alert-info small" id="previewSection">
                <strong>Next Run Preview:</strong>
                <div id="cronPreview" class="mt-2">
                  Enter or modify schedule to see next run times...
                </div>
              </div>

              <div class="d-flex gap-2">
                <button type="button" class="btn btn-primary flex-grow-1" onclick="scheduleManager.saveSchedule()">
                  <i class="bi bi-check-circle me-1"></i>${isEdit ? 'Update' : 'Create'} Schedule
                </button>
                <button type="button" class="btn btn-secondary" onclick="scheduleManager.backToList()">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Setup form after rendering
    setTimeout(async () => {
      // Load workflows
      await this.populateWorkflowDropdown();

      // Setup cron preview
      const cronInput = document.getElementById('scheduleCron');
      if (cronInput) {
        cronInput.addEventListener('input', () => this.updateCronPreview());
        this.updateCronPreview();
      }

      // Setup interval preview
      // No additional interval setup needed - plain milliseconds input
    }, 0);
  }

  /**
   * Populate workflow dropdown with available workflows
   */
  async populateWorkflowDropdown() {
    try {
      const response = await window.apiCall('/api/workflows/list');
      const result = await response.json();

      const workflows = result.data || [];
      const dropdown = document.getElementById('scheduleWorkflow');

      if (!dropdown) return;

      // Clear and rebuild options
      dropdown.innerHTML = '<option value="">Select a workflow...</option>';

      workflows.forEach(workflow => {
        const option = document.createElement('option');
        option.value = workflow.id;
        option.textContent = workflow.name;

        // Select this workflow if it matches the currently selected one
        if (this.selectedSchedule && this.selectedSchedule.workflowId === workflow.id) {
          option.selected = true;
        }

        dropdown.appendChild(option);
      });

      // If no workflows, show message
      if (workflows.length === 0) {
        dropdown.innerHTML = '<option value="">No workflows available. Create a workflow first.</option>';
        dropdown.disabled = true;
      }
    } catch (error) {
      console.error('Error loading workflows:', error);
      const dropdown = document.getElementById('scheduleWorkflow');
      if (dropdown) {
        dropdown.innerHTML = '<option value="">Error loading workflows</option>';
      }
    }
  }

  /**
   * Render empty state
   */
  renderEmptyState() {
    return `
      <div class="kr-empty-tile">
        <div class="ico"><i class="bi bi-calendar-x"></i></div>
        <h4>No schedules created yet</h4>
        <p>Click "New schedule" to create your first workflow schedule.</p>
      </div>
    `;
  }

  /**
   * F5.3.1 - Render schedules table
   */
  renderSchedulesTable(paginatedSchedules, sortedSchedules) {
    const totalPages = Math.ceil(sortedSchedules.length / this.itemsPerPage);

    return `
      <div class="table-responsive">
        <table class="kr-table mb-0">
          <thead>
            <tr>
              <th style="cursor: pointer;" onclick="scheduleManager.setSortColumn('name')">
                Schedule name
                ${this.sortColumn === 'name' ? ` <small>(${this.sortDirection})</small>` : ''}
              </th>
              <th style="cursor: pointer;" onclick="scheduleManager.setSortColumn('workflow')">
                Workflow
                ${this.sortColumn === 'workflow' ? ` <small>(${this.sortDirection})</small>` : ''}
              </th>
              <th style="cursor: pointer;" onclick="scheduleManager.setSortColumn('cron')">
                Schedule (cron)
                ${this.sortColumn === 'cron' ? ` <small>(${this.sortDirection})</small>` : ''}
              </th>
              <th style="cursor: pointer;" onclick="scheduleManager.setSortColumn('nextRun')">
                Next run
                ${this.sortColumn === 'nextRun' ? ` <small>(${this.sortDirection})</small>` : ''}
              </th>
              <th style="text-align: center;">Status</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${paginatedSchedules.map(schedule => this.renderScheduleRow(schedule)).join('')}
          </tbody>
        </table>
      </div>

      ${totalPages > 1 ? this.renderPagination(totalPages, sortedSchedules.length) : ''}
    `;
  }

  /**
   * F5.3.1 - Render schedule row
   */
  renderScheduleRow(schedule) {
    const nextRun = schedule.nextRunTime ? this.getTimeUntil(schedule.nextRunTime) : 'Never';
    const statusBadgeClass = schedule.enabled ? 'bg-success' : 'bg-secondary';
    const history = this.scheduleHistory[schedule.id] || [];
    const successCount = history.filter(h => h.outcome === 'success').length;
    const failureCount = history.filter(h => h.outcome === 'failed').length;
    const totalRuns = successCount + failureCount;

    // Get workflow group
    const workflow = window.workflowsCache?.find(w => w.id === schedule.workflowId);
    const group = workflow?.group || workflow?.directoryName || 'Unknown';

    // Determine schedule expression to display
    const cronExpr = schedule.cronExpression || null;
    const intervalVal = schedule.interval || null;
    let scheduleDisplay = '';
    let scheduleDescription = '';

    if (cronExpr) {
      scheduleDisplay = `<code>${cronExpr}</code>`;
      scheduleDescription = this.describeCron(cronExpr);
    } else if (intervalVal) {
      scheduleDisplay = `<span class="badge bg-info text-dark">Every ${this.describeInterval(intervalVal)}</span>`;
      scheduleDescription = `Runs every ${this.describeInterval(intervalVal)}`;
    } else {
      scheduleDisplay = '<span class="text-muted">Not configured</span>';
      scheduleDescription = '';
    }

    return `
      <tr>
        <td>
          <div>
            <strong>${schedule.name || 'Unnamed'}</strong>
            ${schedule.description ? `<br><small class="text-muted">${schedule.description}</small>` : ''}
          </div>
        </td>
        <td>
          <div>
            <span class="badge bg-light text-dark border mb-2">
              <i class="bi bi-folder me-1"></i>${group}
            </span>
            <br>
            <code class="text-muted small">${schedule.workflowName || schedule.workflowId || 'N/A'}</code>
          </div>
        </td>
        <td>
          ${scheduleDisplay}
          ${scheduleDescription ? `<br><small class="text-muted">${scheduleDescription}</small>` : ''}
        </td>
        <td>
          <i class="bi bi-arrow-right"></i> ${nextRun}
          ${schedule.lastRun ? `<br><small class="text-muted">Last: ${this.getTimeAgo(schedule.lastRunTime)}</small>` : ''}
        </td>
        <td style="text-align: center;">
          <span class="badge ${statusBadgeClass}">${schedule.enabled ? 'Enabled' : 'Disabled'}</span>
        </td>
        <td style="text-align: center;">
          <div class="btn-group btn-group-sm" role="group">
            <!-- F5.3.2 - Run now button -->
            <button class="btn btn-outline-success" onclick="event.stopPropagation(); scheduleManager.runNow('${schedule.id}')"
                    title="Run this schedule immediately">
              <i class="bi bi-play-fill"></i>
            </button>
            <!-- F5.3.2 - Edit button -->
            <button class="btn btn-outline-primary" onclick="event.stopPropagation(); scheduleManager.showEditScheduleModal('${schedule.id}')"
                    title="Edit schedule">
              <i class="bi bi-pencil"></i>
            </button>
            <!-- F5.3.2 - Toggle enable/disable -->
            <button class="btn btn-outline-warning" onclick="event.stopPropagation(); scheduleManager.toggleSchedule('${schedule.id}')"
                    title="${schedule.enabled ? 'Disable' : 'Enable'} schedule">
              <i class="bi bi-${schedule.enabled ? 'pause' : 'play'}-circle"></i>
            </button>
            <!-- F5.3.2 - Delete button -->
            <button class="btn btn-outline-danger" onclick="event.stopPropagation(); scheduleManager.deleteSchedule('${schedule.id}')"
                    title="Delete schedule">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  /**
   * Render pagination controls
   */
  renderPagination(totalPages, totalItems) {
    const pages = [];
    const maxButtons = 7;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    return `
      <div class="card-footer bg-light d-flex justify-content-between align-items-center">
        <small class="text-muted">
          Showing ${(this.currentPage - 1) * this.itemsPerPage + 1} to
          ${Math.min(this.currentPage * this.itemsPerPage, totalItems)} of ${totalItems} schedules
        </small>
        <nav>
          <ul class="pagination mb-0 pagination-sm">
            <li class="page-item ${this.currentPage === 1 ? 'disabled' : ''}">
              <button class="page-link" onclick="scheduleManager.goToPage(1)">First</button>
            </li>
            ${Array.from({length: endPage - startPage + 1}, (_, i) => startPage + i).map(page => `
              <li class="page-item ${page === this.currentPage ? 'active' : ''}">
                <button class="page-link" onclick="scheduleManager.goToPage(${page})">${page}</button>
              </li>
            `).join('')}
            <li class="page-item ${this.currentPage === totalPages ? 'disabled' : ''}">
              <button class="page-link" onclick="scheduleManager.goToPage(${totalPages})">Last</button>
            </li>
          </ul>
        </nav>
      </div>
    `;
  }


  /**
   * Show create schedule form
   */
  showCreateScheduleModal() {
    this.editingScheduleId = null;
    this.selectedSchedule = {
      id: null,
      name: '',
      workflowId: '',
      cronExpression: '0 0 * * *',
      interval: null,
      description: '',
      enabled: true
    };
    this.currentView = 'form';
    this.render();
  }

  /**
   * Show edit schedule form
   */
  showEditScheduleModal(scheduleId) {
    const schedule = this.schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    this.editingScheduleId = scheduleId;
    this.selectedSchedule = schedule;
    this.currentView = 'form';
    this.render();
  }

  /**
   * Back to list view
   */
  backToList() {
    this.currentView = 'list';
    this.editingScheduleId = null;
    this.selectedSchedule = null;
    this.render();
  }

  /**
   * Show schedule inline panel (create or edit) - kept for compatibility
   */
  showScheduleModal(schedule) {
    const isEdit = this.editingScheduleId !== null;
    const title = isEdit ? 'Edit Schedule' : 'Create New Schedule';

    // Determine initial schedule type
    const hasInterval = schedule.interval && !schedule.cronExpression;
    const scheduleType = hasInterval ? 'interval' : 'cron';
    const intervalValue = schedule.interval || 300;

    // Create inline panel instead of modal
    const html = `
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
          <h5 class="mb-0"><i class="bi bi-calendar-plus me-2"></i>${title}</h5>
          <button type="button" class="btn btn-sm btn-close btn-close-white" onclick="scheduleManager.closeScheduleModal()"></button>
        </div>
        <div class="card-body">
          <form id="scheduleForm">
            <div class="mb-3">
              <label class="form-label">Schedule Name</label>
              <input type="text" class="form-control" id="scheduleName" value="${schedule.name || ''}"
                     placeholder="e.g., Daily Data Import" required>
            </div>

            <div class="mb-3">
              <label class="form-label">Workflow</label>
              <select class="form-select" id="scheduleWorkflow" required>
                <option value="">Select a workflow...</option>
                <option value="${schedule.workflowId || schedule.workflowName}" selected>${schedule.workflowName}</option>
              </select>
              <small class="text-muted">Select the workflow to run on this schedule</small>
            </div>

            <!-- Schedule Type Toggle -->
            <div class="mb-3">
              <label class="form-label">Schedule Type</label>
              <div class="btn-group w-100" role="group">
                <input type="radio" class="btn-check" name="scheduleType" id="scheduleTypeCron" value="cron"
                       ${scheduleType === 'cron' ? 'checked' : ''} onchange="scheduleManager.toggleScheduleType()">
                <label class="btn btn-outline-primary" for="scheduleTypeCron">
                  <i class="bi bi-clock me-1"></i>Cron Expression
                </label>
                <input type="radio" class="btn-check" name="scheduleType" id="scheduleTypeInterval" value="interval"
                       ${scheduleType === 'interval' ? 'checked' : ''} onchange="scheduleManager.toggleScheduleType()">
                <label class="btn btn-outline-primary" for="scheduleTypeInterval">
                  <i class="bi bi-arrow-repeat me-1"></i>Interval
                </label>
              </div>
            </div>

            <!-- Cron Expression Section -->
            <div class="mb-3" id="cronSection" style="display: ${scheduleType === 'cron' ? 'block' : 'none'};">
              <label class="form-label">Cron Expression</label>
              <input type="text" class="form-control" id="scheduleCron" value="${schedule.cronExpression || '0 0 * * *'}"
                     placeholder="0 0 * * *">
              <small class="text-muted d-block mt-2">
                <strong>Cron Format:</strong> Minute Hour Day Month DayOfWeek<br>
                Examples:
                <ul class="mb-0 mt-1">
                  <li><code>0 0 * * *</code> - Daily at midnight</li>
                  <li><code>0 */6 * * *</code> - Every 6 hours</li>
                  <li><code>0 8 * * MON-FRI</code> - Weekdays at 8 AM</li>
                  <li><code>0 0 1 * *</code> - First day of month</li>
                </ul>
              </small>
            </div>

            <!-- Interval Section -->
            <div class="mb-3" id="intervalSection" style="display: ${scheduleType === 'interval' ? 'block' : 'none'};">
              <label class="form-label">Run Every (milliseconds)</label>
              <input type="number" class="form-control" id="scheduleIntervalValue"
                     value="${intervalValue}" min="1" placeholder="e.g. 300000 for 5 minutes">
              <div class="mt-1 small text-muted">Examples: 60000 = 1 min, 300000 = 5 min, 3600000 = 1 hour</div>
            </div>

            <div class="mb-3">
              <label class="form-label">Description (Optional)</label>
              <textarea class="form-control" id="scheduleDescription" rows="3"
                        placeholder="Add notes about this schedule...">${schedule.description || ''}</textarea>
            </div>

            <div class="form-check mb-3">
              <input class="form-check-input" type="checkbox" id="scheduleEnabled"
                     ${schedule.enabled ? 'checked' : ''}>
              <label class="form-check-label" for="scheduleEnabled">
                Enable this schedule
              </label>
            </div>

            <div class="alert alert-info small">
              <strong>Next Run Preview:</strong>
              <div id="cronPreview" class="mt-2">
                Enter or modify schedule to see next run times...
              </div>
            </div>

            <div class="d-flex gap-2">
              <button type="button" class="btn btn-primary flex-grow-1" onclick="scheduleManager.saveSchedule()">
                <i class="bi bi-check-circle me-1"></i>${isEdit ? 'Update' : 'Create'} Schedule
              </button>
              <button type="button" class="btn btn-secondary" onclick="scheduleManager.closeScheduleModal()">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    const container = document.getElementById('scheduleManagerContainer');
    let panelDiv = document.getElementById('scheduleFormPanel');

    if (!panelDiv) {
      panelDiv = document.createElement('div');
      panelDiv.id = 'scheduleFormPanel';
      container.insertBefore(panelDiv, container.firstChild);
    }

    panelDiv.innerHTML = html;
    panelDiv.style.display = 'block';

    // Scroll to top of panel
    panelDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Setup preview
    document.getElementById('scheduleCron')?.addEventListener('input', () => {
      this.updateCronPreview();
    });
    document.getElementById('scheduleIntervalValue')?.addEventListener('input', () => {
      this.updateIntervalPreview();
    });

    if (scheduleType === 'cron') {
      this.updateCronPreview();
    } else {
      this.updateIntervalPreview();
    }
  }

  /**
   * Update cron preview
   */
  updateCronPreview() {
    const cronInput = document.getElementById('scheduleCron');
    const preview = document.getElementById('cronPreview');

    if (!cronInput || !preview) return;

    const cron = cronInput.value;
    const description = this.describeCron(cron);

    preview.innerHTML = `
      <p class="mb-0"><strong>Expression:</strong> <code>${cron}</code></p>
      <p class="mb-0"><strong>Description:</strong> ${description}</p>
      <p class="mb-0 mt-2 text-muted small">Next runs:</p>
      <ul class="small text-muted mb-0">
        <li>${new Date().toLocaleString()}</li>
        <li>${new Date(Date.now() + 86400000).toLocaleString()}</li>
        <li>${new Date(Date.now() + 172800000).toLocaleString()}</li>
      </ul>
    `;
  }

  /**
   * Toggle between cron and interval schedule type in the form
   */
  toggleScheduleType() {
    const scheduleType = document.querySelector('input[name="scheduleType"]:checked')?.value || 'cron';
    const cronSection = document.getElementById('cronSection');
    const intervalSection = document.getElementById('intervalSection');

    if (cronSection) cronSection.style.display = scheduleType === 'cron' ? 'block' : 'none';
    if (intervalSection) intervalSection.style.display = scheduleType === 'interval' ? 'block' : 'none';

    // Update preview
    if (scheduleType === 'cron') {
      this.updateCronPreview();
    }
  }

  /**
   * Describe an interval in milliseconds as human-readable text
   */
  describeInterval(ms) {
    if (!ms || ms <= 0) return 'N/A';
    if (ms >= 3600000 && ms % 3600000 === 0) {
      const h = ms / 3600000;
      return `${h} hour${h !== 1 ? 's' : ''}`;
    }
    if (ms >= 60000 && ms % 60000 === 0) {
      const m = ms / 60000;
      return `${m} minute${m !== 1 ? 's' : ''}`;
    }
    if (ms >= 1000 && ms % 1000 === 0) {
      const s = ms / 1000;
      return `${s} second${s !== 1 ? 's' : ''}`;
    }
    return `${ms}ms`;
  }

  /**
   * Save schedule
   */
  async saveSchedule() {
    const name = document.getElementById('scheduleName')?.value;
    const workflow = document.getElementById('scheduleWorkflow')?.value;
    const description = document.getElementById('scheduleDescription')?.value;
    const enabled = document.getElementById('scheduleEnabled')?.checked;
    const scheduleType = document.querySelector('input[name="scheduleType"]:checked')?.value || 'cron';

    // Validate based on type
    const cron = document.getElementById('scheduleCron')?.value;
    const intervalValue = parseInt(document.getElementById('scheduleIntervalValue')?.value || '0');

    if (!name || !workflow) {
      this.showError('Please fill in all required fields');
      return;
    }

    if (scheduleType === 'cron' && !cron) {
      this.showError('Please enter a cron expression');
      return;
    }

    if (scheduleType === 'interval' && (!intervalValue || intervalValue < 1)) {
      this.showError('Please enter a valid interval');
      return;
    }

    // Build payload based on schedule type
    const payload = {
      name: name,
      workflowId: workflow,
      description: description,
      enabled: enabled
    };

    if (scheduleType === 'cron') {
      payload.cronExpression = cron;
      payload.interval = null;
    } else {
      payload.interval = intervalValue;
      payload.cronExpression = null;
    }

    try {
      const method = this.editingScheduleId ? 'PUT' : 'POST';
      const url = this.editingScheduleId
        ? `/api/schedules/${this.editingScheduleId}`
        : '/api/schedules';

      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`Failed to save schedule: ${response.statusText}`);

      await this.loadSchedules();

      const action = this.editingScheduleId ? 'updated' : 'created';
      if (window.ui && window.ui.showToast) {
        window.ui.showToast({
          message: `Schedule ${action} successfully!`,
          type: 'success',
          duration: 3000
        });
      }

      // Return to list view
      setTimeout(() => this.backToList(), 500);
    } catch (error) {
      console.error('Error saving schedule:', error);
      this.showError('Failed to save schedule: ' + error.message);
    }
  }

  /**
   * Close schedule form - legacy compatibility
   */
  closeScheduleModal() {
    this.backToList();
  }

  /**
   * F5.3.2 - Toggle schedule enable/disable
   */
  async toggleSchedule(scheduleId) {
    const schedule = this.schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    try {
      const response = await window.apiCall(`/api/schedules/${scheduleId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !schedule.enabled })
      });

      if (!response.ok) throw new Error(`Failed to toggle schedule: ${response.statusText}`);

      await this.loadSchedules();

      if (window.ui && window.ui.showToast) {
        window.ui.showToast({
          message: `Schedule ${schedule.enabled ? 'disabled' : 'enabled'} successfully!`,
          type: 'success',
          duration: 2000
        });
      }
    } catch (error) {
      console.error('Error toggling schedule:', error);
      this.showError('Failed to toggle schedule: ' + error.message);
    }
  }

  /**
   * F5.3.2 - Delete schedule
   */
  async deleteSchedule(scheduleId) {
    const schedule = this.schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    if (!confirm(`Are you sure you want to delete the schedule "${schedule.workflowName}"?`)) {
      return;
    }

    try {
      const response = await window.apiCall(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error(`Failed to delete schedule: ${response.statusText}`);

      await this.loadSchedules();

      if (window.ui && window.ui.showToast) {
        window.ui.showToast({
          message: 'Schedule deleted successfully!',
          type: 'success',
          duration: 2000
        });
      }
    } catch (error) {
      console.error('Error deleting schedule:', error);
      this.showError('Failed to delete schedule: ' + error.message);
    }
  }

  /**
   * F5.3.2 - Run schedule now
   */
  async runNow(scheduleId) {
    const schedule = this.schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    try {
      const response = await window.apiCall(`/api/schedules/${scheduleId}/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error(`Failed to run schedule: ${response.statusText}`);

      const result = await response.json();

      if (window.ui && window.ui.showToast) {
        window.ui.showToast({
          message: `Workflow execution started: ${result.message || 'Check Execution Monitor for status'}`,
          type: 'success',
          duration: 3000
        });
      }
    } catch (error) {
      console.error('Error running schedule:', error);
      this.showError('Failed to run schedule: ' + error.message);
    }
  }

  /**
   * Select schedule for details view
   */
  /**
   * Get filtered schedules
   */
  getFilteredSchedules() {
    return this.schedules.filter(schedule => {
      if (this.filterStatus === 'enabled' && !schedule.enabled) return false;
      if (this.filterStatus === 'disabled' && schedule.enabled) return false;
      return true;
    });
  }

  /**
   * Get sorted schedules
   */
  getSortedSchedules(schedules) {
    const sorted = [...schedules];
    const multiplier = this.sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let aVal, bVal;

      if (this.sortColumn === 'name') {
        aVal = a.name || '';
        bVal = b.name || '';
      } else if (this.sortColumn === 'workflow') {
        aVal = a.workflowName || '';
        bVal = b.workflowName || '';
      } else if (this.sortColumn === 'cron') {
        aVal = a.cronExpression || '';
        bVal = b.cronExpression || '';
      } else if (this.sortColumn === 'nextRun') {
        aVal = new Date(a.nextRun || 0).getTime();
        bVal = new Date(b.nextRun || 0).getTime();
      }

      if (aVal < bVal) return -1 * multiplier;
      if (aVal > bVal) return 1 * multiplier;
      return 0;
    });

    return sorted;
  }

  /**
   * Get paginated schedules
   */
  getPaginatedSchedules(schedules) {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    const end = start + this.itemsPerPage;
    return schedules.slice(start, end);
  }

  /**
   * Set sort column
   */
  setSortColumn(column) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.currentPage = 1;
    this.render();
  }

  /**
   * Set filter status
   */
  setFilterStatus(status) {
    this.filterStatus = status;
    this.currentPage = 1;
    this.render();
  }

  /**
   * Set search filter
   */
  setSearchFilter(text) {
    // For demo, we'll filter by name
    if (!text) {
      this.render();
      return;
    }

    const filtered = this.schedules.filter(s =>
      (s.workflowName || '').toLowerCase().includes(text.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(text.toLowerCase())
    );

    // Temporarily replace schedules for filtering
    const temp = this.schedules;
    this.schedules = filtered;
    this.render();
    this.schedules = temp;
  }

  /**
   * Go to page
   */
  goToPage(pageNumber) {
    this.currentPage = pageNumber;
    this.render();
  }

  /**
   * Utility: Describe cron expression
   */
  describeCron(cron) {
    if (!cron) return 'Invalid cron expression';

    const parts = cron.split(' ');
    if (parts.length !== 5) return 'Invalid cron format';

    const [minute, hour, day, month, dayOfWeek] = parts;

    let description = 'Every';

    if (minute !== '*' && hour !== '*') {
      return `Daily at ${hour}:${minute.padStart(2, '0')}`;
    }

    if (minute !== '*') {
      description += ` minute ${minute}`;
    } else if (hour !== '*') {
      description += ` hour at minute ${minute === '*' ? '0' : minute}`;
    }

    if (day !== '*' && month === '*') {
      description += ` day ${day}`;
    }

    if (dayOfWeek !== '*' && dayOfWeek !== '?') {
      const days = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
      description = `Every ${dayOfWeek} at ${hour}:${minute.padStart(2, '0')}`;
    }

    return description;
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
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else if (seconds > 0) {
      return `${seconds}s`;
    } else {
      return `${ms}ms`;
    }
  }

  /**
   * Utility: Get time ago
   */
  getTimeAgo(date) {
    if (!date) return 'Never';

    const now = new Date();
    const diff = now - new Date(date);
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }

  /**
   * Utility: Get time until
   */
  getTimeUntil(date) {
    if (!date) return 'Never';

    const now = new Date();
    const diff = new Date(date) - now;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `in ${days}d`;
    if (hours > 0) return `in ${hours}h`;
    if (minutes > 0) return `in ${minutes}m`;
    if (seconds > 0) return `in ${seconds}s`;
    return 'Now';
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
    // Cleanup if needed
  }
}

/**
 * Global instance
 */
let scheduleManager;

/**
 * Initialize schedule manager when called
 */
async function initScheduleManager() {
  scheduleManager = new ScheduleManager();
  await scheduleManager.init();
  return scheduleManager;
}

/**
 * Render schedule manager dashboard
 */
function renderScheduleManagerDashboard() {
  const container = document.getElementById('mainContent');
  if (!container) return;

  container.innerHTML = `
    <div class="container-fluid py-4">
      <div id="scheduleManagerContainer"></div>
    </div>
  `;

  initScheduleManager().catch(error => {
    console.error('Failed to initialize schedule manager:', error);
    if (window.ui && window.ui.showToast) {
      window.ui.showToast({
        message: 'Failed to load schedule manager: ' + error.message,
        type: 'danger',
        duration: 5000
      });
    }
  });
}
