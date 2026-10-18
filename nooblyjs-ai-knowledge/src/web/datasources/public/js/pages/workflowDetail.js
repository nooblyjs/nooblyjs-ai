/**
 * Workflow Detail Page (Task 7.2.3)
 *
 * Displays comprehensive workflow information with tabs for:
 * - Overview: Metadata, step diagram, execution statistics
 * - Execution History: Table of past executions with view/delete actions
 * - Schedules: Table of associated schedules with CRUD operations
 *
 * Features:
 * - Action buttons: Execute, Edit, Schedule, Delete
 * - Tab-based navigation with lazy loading
 * - Integration with execution detail modal and schedule management
 */

class WorkflowDetail {
  constructor(workflowId) {
    this.workflowId = workflowId;
    this.workflow = null;
    this.executions = [];
    this.schedules = [];
    this.currentTab = 'overview';
    this.executionsTable = null;
    this.schedulesTable = null;
  }

  async init() {
    try {
      await this.loadWorkflow();
      await this.loadExecutions();
      await this.loadSchedules();
      this.render();
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to initialize workflow detail:', error);
    }
  }

  async loadWorkflow() {
    const loader = showSpinner({ message: 'Loading workflow...' });
    try {
      const response = await window.apiCall(`/api/workflows/${this.workflowId}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.message);
      this.workflow = result.data;
    } catch (error) {
      ui.showToast({ message: error.message, type: 'danger' });
      document.getElementById('mainContent').innerHTML = `
        <div class="alert alert-danger m-3">
          <i class="bi bi-exclamation-triangle-fill"></i>
          Failed to load workflow: ${error.message}
        </div>
      `;
      throw error;
    } finally {
      loader.hide();
    }
  }

  async loadExecutions(date = null) {
    try {
      let url = `/api/executions?workflowId=${this.workflowId}&limit=50`;
      if (date) url += `&date=${date}`;
      const response = await window.apiCall(url);
      const result = await response.json();
      this.executions = result.success ? result.data : [];
    } catch (error) {
      console.error('Failed to load executions:', error);
      this.executions = [];
    }
  }

  async loadSchedules() {
    try {
      const response = await window.apiCall(`/api/schedules?workflowId=${this.workflowId}`);
      const result = await response.json();
      this.schedules = result.success ? result.data : [];
    } catch (error) {
      console.error('Failed to load schedules:', error);
      this.schedules = [];
    }
  }

  render() {
    if (!this.workflow) return;

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = `
      <div class="container-fluid py-3">
        <!-- Breadcrumb -->
        <nav aria-label="breadcrumb">
          <ol class="breadcrumb">
            <li class="breadcrumb-item"><a href="#" onclick="renderDashboard(); return false;"><i class="bi bi-house"></i> Dashboard</a></li>
            <li class="breadcrumb-item"><a href="#" onclick="renderWorkflowDashboard(); return false;"><i class="bi bi-diagram-3"></i> Workflows</a></li>
            <li class="breadcrumb-item active">${this.workflow.name}</li>
          </ol>
        </nav>

        <!-- Header -->
        <div class="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h2 class="mb-2">${this.workflow.name}</h2>
            <div class="text-muted">
              <span class="badge ${this.getStatusBadgeClass()}">${this.workflow.status}</span>
              <span class="ms-2"><i class="bi bi-calendar3"></i> Created: ${new Date(this.workflow.createdAt).toLocaleString()}</span>
            </div>
          </div>
          <div class="btn-group">
            <button class="btn btn-success" id="btnExecute" title="Execute this workflow">
              <i class="bi bi-play-fill"></i> Execute
            </button>
            <button class="btn btn-primary" id="btnEdit" title="Edit workflow configuration">
              <i class="bi bi-pencil"></i> Edit
            </button>
            <button class="btn btn-warning" id="btnSchedule" title="Create a schedule for this workflow">
              <i class="bi bi-calendar-plus"></i> Schedule
            </button>
            <button class="btn btn-danger" id="btnDelete" title="Delete this workflow">
              <i class="bi bi-trash"></i> Delete
            </button>
          </div>
        </div>

        <!-- Tabs -->
        <ul class="nav nav-tabs mb-3" id="workflowTabs" role="tablist">
          <li class="nav-item" role="presentation">
            <a class="nav-link active" id="tab-overview" href="#" onclick="workflowDetailInstance.switchTab('overview'); return false;" role="tab">
              <i class="bi bi-info-circle"></i> Overview
            </a>
          </li>
          <li class="nav-item" role="presentation">
            <a class="nav-link" id="tab-executions" href="#" onclick="workflowDetailInstance.switchTab('executions'); return false;" role="tab">
              <i class="bi bi-list-task"></i> Execution History
            </a>
          </li>
          <li class="nav-item" role="presentation">
            <a class="nav-link" id="tab-schedules" href="#" onclick="workflowDetailInstance.switchTab('schedules'); return false;" role="tab">
              <i class="bi bi-calendar-event"></i> Schedules
            </a>
          </li>
        </ul>

        <!-- Tab Content -->
        <div id="tabContent"></div>
      </div>
    `;

    this.renderTabContent();
  }

  switchTab(tabName) {
    if (this.currentTab === tabName) return;

    this.currentTab = tabName;

    // Update tab active states
    document.querySelectorAll('#workflowTabs .nav-link').forEach(tab => {
      tab.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Render tab content
    this.renderTabContent();
  }

  renderTabContent() {
    const container = document.getElementById('tabContent');

    switch (this.currentTab) {
      case 'overview':
        container.innerHTML = this.getOverviewHTML();
        break;
      case 'executions':
        container.innerHTML = this.getExecutionsHTML();
        setTimeout(() => {
          this.renderExecutionsTable();
          this.populateExecDateFilter();
        }, 50);
        break;
      case 'schedules':
        container.innerHTML = this.getSchedulesHTML();
        setTimeout(() => this.renderSchedulesTable(), 50);
        break;
    }
  }

  getStatusBadgeClass() {
    const statusMap = {
      'active': 'bg-success',
      'draft': 'bg-secondary',
      'archived': 'bg-dark'
    };
    return statusMap[this.workflow.status] || 'bg-secondary';
  }

  getOverviewHTML() {
    return `
      <div class="row">
        <!-- Metadata Card -->
        <div class="col-md-6 mb-3">
          <div class="card">
            <div class="card-header">
              <h5 class="mb-0"><i class="bi bi-info-circle"></i> Workflow Information</h5>
            </div>
            <div class="card-body">
              <dl class="row mb-0">
                <dt class="col-sm-4">Name:</dt>
                <dd class="col-sm-8"><strong>${this.workflow.name}</strong></dd>

                <dt class="col-sm-4">Description:</dt>
                <dd class="col-sm-8">${this.workflow.description || '<em class="text-muted">No description</em>'}</dd>

                <dt class="col-sm-4">Tags:</dt>
                <dd class="col-sm-8">
                  ${this.workflow.tags && this.workflow.tags.length > 0
                    ? this.workflow.tags.map(tag => `<span class="badge bg-info me-1">${tag}</span>`).join('')
                    : '<em class="text-muted">No tags</em>'}
                </dd>

                <dt class="col-sm-4">Status:</dt>
                <dd class="col-sm-8"><span class="badge ${this.getStatusBadgeClass()}">${this.workflow.status}</span></dd>

                <dt class="col-sm-4">Created:</dt>
                <dd class="col-sm-8">${new Date(this.workflow.createdAt).toLocaleString()}</dd>

                <dt class="col-sm-4">Modified:</dt>
                <dd class="col-sm-8">${new Date(this.workflow.updatedAt).toLocaleString()}</dd>

                <dt class="col-sm-4">Steps:</dt>
                <dd class="col-sm-8"><strong>${this.workflow.steps ? this.workflow.steps.length : 0}</strong></dd>
              </dl>
            </div>
          </div>
        </div>

        <!-- Statistics Card -->
        <div class="col-md-6 mb-3">
          <div class="card">
            <div class="card-header">
              <h5 class="mb-0"><i class="bi bi-graph-up"></i> Execution Statistics</h5>
            </div>
            <div class="card-body">
              ${this.getStatisticsHTML()}
            </div>
          </div>
        </div>

        <!-- Step Diagram Card -->
        <div class="col-12 mb-3">
          <div class="card">
            <div class="card-header">
              <h5 class="mb-0"><i class="bi bi-diagram-2"></i> Workflow Steps</h5>
            </div>
            <div class="card-body">
              ${this.getStepDiagramHTML()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  getStatisticsHTML() {
    const totalExecutions = this.executions.length;
    const successfulExecutions = this.executions.filter(e => e.outcome === 'success').length;
    const failedExecutions = this.executions.filter(e => e.outcome === 'failed').length;
    const successRate = totalExecutions > 0 ? ((successfulExecutions / totalExecutions) * 100).toFixed(1) : 0;
    const lastExecution = this.executions[0];

    return `
      <div class="row text-center mb-3">
        <div class="col-md-3">
          <div class="stat-item">
            <h3 class="mb-1 text-primary">${totalExecutions}</h3>
            <small class="text-muted">Total Executions</small>
          </div>
        </div>
        <div class="col-md-3">
          <div class="stat-item">
            <h3 class="mb-1 text-success">${successfulExecutions}</h3>
            <small class="text-muted">Successful</small>
          </div>
        </div>
        <div class="col-md-3">
          <div class="stat-item">
            <h3 class="mb-1 text-danger">${failedExecutions}</h3>
            <small class="text-muted">Failed</small>
          </div>
        </div>
        <div class="col-md-3">
          <div class="stat-item">
            <h3 class="mb-1 text-warning">${successRate}%</h3>
            <small class="text-muted">Success Rate</small>
          </div>
        </div>
      </div>
      ${lastExecution ? `
        <div class="alert alert-info mb-0">
          <strong><i class="bi bi-clock-history"></i> Last Execution:</strong> ${new Date(lastExecution.startedAt).toLocaleString()}
          <br>
          <strong>Outcome:</strong> <span class="badge ${lastExecution.outcome === 'success' ? 'bg-success' : 'bg-danger'}">${lastExecution.outcome}</span>
        </div>
      ` : '<p class="text-muted mb-0"><i class="bi bi-info-circle"></i> No executions yet</p>'}
    `;
  }

  getStepDiagramHTML() {
    if (!this.workflow.steps || this.workflow.steps.length === 0) {
      return '<p class="text-muted mb-0"><i class="bi bi-info-circle"></i> No steps configured</p>';
    }

    const stepTypeIcons = {
      'transform': 'bi-code-square',
      'api': 'bi-cloud-arrow-up',
      'conditional': 'bi-question-diamond',
      'parallel': 'bi-distribute-vertical',
      'delay': 'bi-hourglass-split',
      'identity': 'bi-arrow-right-circle'
    };

    return `
      <div class="workflow-steps">
        ${this.workflow.steps.map((step, index) => `
          <div class="step-item mb-3 p-3 border rounded" style="cursor: pointer; background-color: #f8f9fa; transition: all 0.2s;"
               onmouseover="this.style.backgroundColor='#e9ecef'" onmouseout="this.style.backgroundColor='#f8f9fa'"
               onclick="workflowDetailInstance.toggleStepDetails(${index})">
            <div class="d-flex align-items-center">
              <span class="badge bg-primary me-3" style="min-width: 30px; text-align: center;">${index + 1}</span>
              <i class="bi ${stepTypeIcons[step.config?.type || step.type] || 'bi-gear'} me-3" style="font-size: 18.2px;"></i>
              <div class="flex-grow-1">
                <strong>${step.name}</strong>
                <small class="text-muted d-block">${step.config?.type || step.type || 'unknown'}</small>
              </div>
              <i class="bi bi-chevron-down ms-auto" id="stepChevron${index}" style="transition: transform 0.2s;"></i>
            </div>
            <div id="stepDetails${index}" style="display: none;" class="mt-3 pt-3 border-top">
              <pre class="bg-light p-2 rounded mb-0" style="max-height: 300px; overflow: auto;"><code style="font-size: 11.9px;">${JSON.stringify(step, null, 2)}</code></pre>
            </div>
          </div>
          ${index < this.workflow.steps.length - 1 ? `
            <div class="text-center text-muted my-2">
              <i class="bi bi-arrow-down"></i>
            </div>
          ` : ''}
        `).join('')}
      </div>
    `;
  }

  toggleStepDetails(index) {
    const detailsDiv = document.getElementById(`stepDetails${index}`);
    const chevron = document.getElementById(`stepChevron${index}`);

    if (!detailsDiv || !chevron) return;

    if (detailsDiv.style.display === 'none') {
      detailsDiv.style.display = 'block';
      chevron.style.transform = 'rotate(180deg)';
    } else {
      detailsDiv.style.display = 'none';
      chevron.style.transform = 'rotate(0deg)';
    }
  }

  getExecutionsHTML() {
    return `
      <div class="row mb-3">
        <div class="col-md-12">
          <h5><i class="bi bi-list-task"></i> Recent Executions</h5>
        </div>
      </div>
      <div class="d-flex align-items-center mb-2 gap-2">
        <label class="small text-muted mb-0">Day:</label>
        <select id="execDateFilter" class="form-select form-select-sm" style="width:auto">
          <option value="">Today</option>
        </select>
      </div>
      <div id="executionsTableContainer"></div>
    `;
  }

  renderExecutionsTable() {
    const container = document.getElementById('executionsTableContainer');
    if (!container) return;

    this.executionsTable = new DataTable({
      container: container,
      columns: [
        {
          field: 'startedAt',
          label: 'Started At',
          sortable: true,
          render: (val) => new Date(val).toLocaleString()
        },
        {
          field: 'outcome',
          label: 'Outcome',
          sortable: true,
          render: (val) => `<span class="badge ${val === 'success' ? 'bg-success' : 'bg-danger'}">${val}</span>`
        },
        {
          field: 'completedAt',
          label: 'Duration',
          sortable: false,
          render: (val, row) => {
            if (!val) return '<em class="text-muted">Running...</em>';
            const duration = new Date(val) - new Date(row.startedAt);
            return `${(duration / 1000).toFixed(2)}s`;
          }
        },
        {
          field: 'id',
          label: 'Actions',
          sortable: false,
          render: (val, row) => `
            <button class="btn btn-sm btn-primary" onclick="workflowDetailInstance.viewExecutionDetail('${row.id}')" title="View execution details">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="workflowDetailInstance.deleteExecution('${row.id}')" title="Delete execution">
              <i class="bi bi-trash"></i>
            </button>
          `
        }
      ],
      data: this.executions,
      pageSize: 10,
      emptyMessage: 'No executions found. Click the Execute button to run this workflow.'
    });

    this.executionsTable.render(container);
  }

  async populateExecDateFilter() {
    try {
      const response = await window.apiCall('/api/executions/dates');
      const result = await response.json();
      if (!result.success) return;

      const { data: dates } = result;
      const sel = document.getElementById('execDateFilter');
      if (!sel) return;

      const today = new Date().toISOString().slice(0, 10);
      dates.slice().reverse().forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d === today ? `${d} (today)` : d;
        sel.appendChild(opt);
      });

      sel.addEventListener('change', () => {
        this.loadExecutions(sel.value || null).then(() => this.renderExecutionsTable());
      });
    } catch (error) {
      console.error('Failed to load execution dates:', error);
    }
  }

  async viewExecutionDetail(executionId) {
    try {
      const response = await window.apiCall(`/api/executions/${executionId}`);
      const result = await response.json();

      if (result.success && showExecutionDetailModal) {
        showExecutionDetailModal(result.data);
      }
    } catch (error) {
      ui.showToast({ message: `Failed to load execution: ${error.message}`, type: 'danger' });
    }
  }

  async deleteExecution(executionId) {
    showConfirmDialog({
      title: 'Delete Execution',
      message: 'Are you sure you want to delete this execution? This action cannot be undone.',
      confirmText: 'Delete',
      confirmClass: 'btn-danger',
      onConfirm: async () => {
        const loader = showSpinner({ message: 'Deleting execution...' });
        try {
          const response = await window.apiCall(`/api/executions/${executionId}`, {
            method: 'DELETE'
          });
          const result = await response.json();

          if (result.success) {
            ui.showToast({ message: 'Execution deleted', type: 'success' });
            await this.loadExecutions();
            this.renderTabContent();
          } else {
            ui.showToast({ message: result.message, type: 'danger' });
          }
        } catch (error) {
          ui.showToast({ message: `Error: ${error.message}`, type: 'danger' });
        } finally {
          loader.hide();
        }
      }
    });
  }

  getSchedulesHTML() {
    return `
      <div class="row mb-3">
        <div class="col-md-12">
          <button class="btn btn-primary" id="btnAddSchedule">
            <i class="bi bi-plus"></i> Add Schedule
          </button>
        </div>
      </div>
      <div id="schedulesTableContainer"></div>
    `;
  }

  renderSchedulesTable() {
    const container = document.getElementById('schedulesTableContainer');
    if (!container) return;

    this.schedulesTable = new DataTable({
      container: container,
      columns: [
        {
          field: 'cronExpression',
          label: 'Cron Expression',
          sortable: true
        },
        {
          field: 'nextRun',
          label: 'Next Run',
          sortable: true,
          render: (val) => val ? new Date(val).toLocaleString() : '<em class="text-muted">N/A</em>'
        },
        {
          field: 'enabled',
          label: 'Enabled',
          sortable: true,
          render: (val) => val ? '<span class="badge bg-success"><i class="bi bi-check"></i></span>' : '<span class="badge bg-danger"><i class="bi bi-x"></i></span>'
        },
        {
          field: 'id',
          label: 'Actions',
          sortable: false,
          render: (val, row) => `
            <button class="btn btn-sm btn-warning" onclick="workflowDetailInstance.toggleSchedule('${row.id}')" title="${row.enabled ? 'Disable' : 'Enable'} schedule">
              <i class="bi bi-${row.enabled ? 'pause' : 'play'}"></i>
            </button>
            <button class="btn btn-sm btn-info" onclick="workflowDetailInstance.runScheduleNow('${row.id}')" title="Run now">
              <i class="bi bi-play-fill"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="workflowDetailInstance.deleteSchedule('${row.id}')" title="Delete schedule">
              <i class="bi bi-trash"></i>
            </button>
          `
        }
      ],
      data: this.schedules,
      pageSize: 10,
      emptyMessage: 'No schedules configured. Click "Add Schedule" to create one.'
    });

    this.schedulesTable.render(container);

    // Setup add schedule button
    const addBtn = document.getElementById('btnAddSchedule');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.showCreateScheduleModal();
      });
    }
  }

  showCreateScheduleModal() {
    const modal = showFormDialog({
      title: 'Create Schedule',
      fields: [
        {
          id: 'cronExpression',
          label: 'Cron Expression',
          type: 'text',
          placeholder: '0 0 * * * (daily at midnight)',
          required: true,
          help: 'Use cron syntax: minute hour day month dayOfWeek'
        },
        {
          id: 'enabled',
          label: 'Enabled',
          type: 'checkbox'
        }
      ],
      onSubmit: async (data) => {
        const scheduleData = {
          workflowId: this.workflowId,
          cronExpression: data.cronExpression,
          enabled: data.enabled === 'on'
        };

        const loader = showSpinner({ message: 'Creating schedule...' });

        try {
          const response = await window.apiCall('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleData)
          });

          const result = await response.json();
          if (result.success) {
            ui.showToast({ message: 'Schedule created', type: 'success' });
            await this.loadSchedules();
            this.renderTabContent();
          } else {
            ui.showToast({ message: result.message, type: 'danger' });
          }
        } catch (error) {
          ui.showToast({ message: `Error: ${error.message}`, type: 'danger' });
        } finally {
          loader.hide();
        }
      }
    });
  }

  async toggleSchedule(scheduleId) {
    const loader = showSpinner({ message: 'Toggling schedule...' });
    try {
      const response = await window.apiCall(`/api/schedules/${scheduleId}/toggle`, {
        method: 'POST'
      });

      const result = await response.json();
      if (result.success) {
        ui.showToast({ message: 'Schedule toggled', type: 'success' });
        await this.loadSchedules();
        this.renderTabContent();
      } else {
        ui.showToast({ message: result.message, type: 'danger' });
      }
    } catch (error) {
      ui.showToast({ message: `Error: ${error.message}`, type: 'danger' });
    } finally {
      loader.hide();
    }
  }

  async runScheduleNow(scheduleId) {
    const loader = showSpinner({ message: 'Executing schedule...' });
    try {
      const response = await window.apiCall(`/api/schedules/${scheduleId}/run-now`, {
        method: 'POST'
      });

      const result = await response.json();
      if (result.success) {
        ui.showToast({ message: 'Schedule executed', type: 'success' });
      } else {
        ui.showToast({ message: result.message, type: 'danger' });
      }
    } catch (error) {
      ui.showToast({ message: `Error: ${error.message}`, type: 'danger' });
    } finally {
      loader.hide();
    }
  }

  async deleteSchedule(scheduleId) {
    showConfirmDialog({
      title: 'Delete Schedule',
      message: 'Are you sure you want to delete this schedule? This action cannot be undone.',
      confirmText: 'Delete',
      confirmClass: 'btn-danger',
      onConfirm: async () => {
        const loader = showSpinner({ message: 'Deleting schedule...' });
        try {
          const response = await window.apiCall(`/api/schedules/${scheduleId}`, {
            method: 'DELETE'
          });

          const result = await response.json();
          if (result.success) {
            ui.showToast({ message: 'Schedule deleted', type: 'success' });
            await this.loadSchedules();
            this.renderTabContent();
          } else {
            ui.showToast({ message: result.message, type: 'danger' });
          }
        } catch (error) {
          ui.showToast({ message: `Error: ${error.message}`, type: 'danger' });
        } finally {
          loader.hide();
        }
      }
    });
  }

  setupEventListeners() {
    // Execute button
    const btnExecute = document.getElementById('btnExecute');
    if (btnExecute) {
      btnExecute.addEventListener('click', () => this.showExecuteModal());
    }

    // Edit button
    const btnEdit = document.getElementById('btnEdit');
    if (btnEdit) {
      btnEdit.addEventListener('click', () => {
        renderWorkflowEditor(this.workflowId);
      });
    }

    // Schedule button
    const btnSchedule = document.getElementById('btnSchedule');
    if (btnSchedule) {
      btnSchedule.addEventListener('click', () => {
        this.switchTab('schedules');
        setTimeout(() => this.showCreateScheduleModal(), 100);
      });
    }

    // Delete button
    const btnDelete = document.getElementById('btnDelete');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => this.deleteWorkflow());
    }
  }

  showExecuteModal() {
    const modal = showFormDialog({
      title: 'Execute Workflow',
      fields: [
        {
          id: 'inputContext',
          label: 'Input Context (JSON)',
          type: 'textarea',
          placeholder: '{}',
          value: '{}',
          help: 'Optional: Provide JSON input data for the workflow'
        }
      ],
      onSubmit: async (data) => {
        try {
          const inputContext = JSON.parse(data.inputContext);

          const loader = showSpinner({ message: 'Executing workflow...' });

          const response = await window.apiCall(`/api/workflows/${this.workflowId}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: inputContext })
          });

          const result = await response.json();
          loader.hide();

          if (result.success) {
            ui.showToast({ message: 'Workflow executed successfully', type: 'success' });

            // Refresh executions and switch to executions tab
            await this.loadExecutions();
            this.switchTab('executions');
          } else {
            ui.showToast({ message: `Execution failed: ${result.message}`, type: 'danger' });
          }
        } catch (error) {
          ui.showToast({ message: `Invalid JSON: ${error.message}`, type: 'danger' });
        }
      }
    });
  }

  async deleteWorkflow() {
    showConfirmDialog({
      title: 'Delete Workflow',
      message: `Are you sure you want to delete "${this.workflow.name}"? This action cannot be undone and will delete all associated schedules and execution history.`,
      confirmText: 'Delete',
      confirmClass: 'btn-danger',
      onConfirm: async () => {
        const loader = showSpinner({ message: 'Deleting workflow...' });

        try {
          const response = await window.apiCall(`/api/workflows/${this.workflowId}`, {
            method: 'DELETE'
          });

          const result = await response.json();
          loader.hide();

          if (result.success) {
            ui.showToast({ message: 'Workflow deleted', type: 'success' });

            // Navigate back to workflows list
            setTimeout(() => renderWorkflowDashboard(), 500);
          } else {
            ui.showToast({ message: result.message, type: 'danger' });
          }
        } catch (error) {
          loader.hide();
          ui.showToast({ message: `Error: ${error.message}`, type: 'danger' });
        }
      }
    });
  }
}

// Global instance
let workflowDetailInstance;

/**
 * Global render function for navigation
 */
window.renderWorkflowDetail = function(workflowId) {
  if (!workflowId) {
    ui.showToast({ message: 'Invalid workflow ID', type: 'danger' });
    return;
  }
  workflowDetailInstance = new WorkflowDetail(workflowId);
  workflowDetailInstance.init();
};
