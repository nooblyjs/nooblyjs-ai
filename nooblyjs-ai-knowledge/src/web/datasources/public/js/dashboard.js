/**
 * @fileoverview Workflow Dashboard Module
 * Comprehensive dashboard with statistics, workflows, schedules, and quick actions
 *
 * @author noobly Team
 * @version 1.0.0
 */

/**
 * WorkflowDashboard class
 */
class WorkflowDashboard {
  constructor() {
    this.dashboardData = null;
    this.workflows = [];
    this.schedules = [];
    this.executions = [];
    this.stats = {};
  }

  /**
   * Initialize the dashboard
   */
  async init() {
    try {
      await this.loadDashboardData();
      this.renderDashboard();
      this.setupEventListeners();
    } catch (error) {
      console.error('Error initializing dashboard:', error);
      throw error;
    }
  }

  /**
   * Load dashboard data from API
   */
  async loadDashboardData() {
    try {
      const response = await window.apiCall('/api/workflows/dashboard?__nocache=true');

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        this.dashboardData = result.data;
        this.workflows = result.data.workflows || [];
        this.schedules = result.data.schedules || [];
        this.executions = result.data.executions || [];
        this.stats = result.data.stats || {};
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  }

  /**
   * Render the complete dashboard
   */
  renderDashboard() {
    const mainContent = document.getElementById('mainContent');

    if (!mainContent) {
      console.error('mainContent element not found in DOM');
      return;
    }

    mainContent.innerHTML = `
      <nav class="kr-breadcrumb">
        <a href="#"><i class="bi bi-house-door"></i></a>
        <span class="sep">›</span>
        <a href="#">Datasources</a>
        <span class="sep">›</span>
        <span class="last">Dashboard</span>
      </nav>

      <div class="kr-page-hero">
        <div class="eyebrow">Datasources</div>
        <h1>Dashboard</h1>
        <p>Workflow automation and data pipeline orchestration at a glance.</p>
      </div>

      <div class="row mb-4 g-3" id="statsCardsContainer">
        <!-- Will be populated by renderStatisticsCards() -->
      </div>

      <section class="kr-surface mb-3">
        <div class="kr-surface-head">
          <h3><i class="bi bi-lightning-charge"></i> Quick actions</h3>
        </div>
        <div class="kr-surface-body" style="padding: 14px 20px;">
          <div class="d-flex gap-2 flex-wrap">
            <button type="button" class="btn btn-primary" id="createWorkflowBtn">
              <i class="bi bi-plus-circle"></i> Create workflow
            </button>
            <button type="button" class="btn btn-secondary" id="importWorkflowBtn">
              <i class="bi bi-download"></i> Import workflow
            </button>
            <button type="button" class="btn btn-ghost" id="viewExecutionsBtn">
              <i class="bi bi-clock-history"></i> View executions
            </button>
          </div>
        </div>
      </section>

      <div class="row g-3">
        <div class="col-lg-6">
          <section class="kr-surface mb-3">
            <div class="kr-surface-head">
              <h3><i class="bi bi-clock"></i> Recently edited workflows</h3>
            </div>
            <div class="kr-surface-body" id="recentlyEditedContainer" style="max-height: 400px; overflow-y: auto;">
              <!-- Will be populated by renderRecentlyEdited() -->
            </div>
          </section>

          <section class="kr-surface">
            <div class="kr-surface-head">
              <h3><i class="bi bi-star"></i> Starred workflows</h3>
            </div>
            <div class="kr-surface-body" id="starredWorkflowsContainer" style="max-height: 400px; overflow-y: auto;">
              <!-- Will be populated by renderStarredWorkflows() -->
            </div>
          </section>
        </div>

        <div class="col-lg-6">
          <section class="kr-surface mb-3">
            <div class="kr-surface-head">
              <h3><i class="bi bi-calendar-event"></i> Active schedules</h3>
            </div>
            <div class="kr-surface-body" id="activeSchedulesContainer" style="max-height: 400px; overflow-y: auto;">
              <!-- Will be populated by renderActiveSchedules() -->
            </div>
          </section>

          <section class="kr-surface">
            <div class="kr-surface-head">
              <h3><i class="bi bi-graph-up"></i> Execution statistics</h3>
            </div>
            <div class="kr-surface-body" id="executionStatsContainer">
              <!-- Will be populated by renderExecutionStats() -->
            </div>
          </section>
        </div>
      </div>
    `;

    // Render all sections
    this.renderStatisticsCards();
    this.renderRecentlyEdited();
    this.renderStarredWorkflows();
    this.renderActiveSchedules();
    this.renderExecutionStats();
  }

  /**
   * Render statistics cards
   */
  renderStatisticsCards() {
    const container = document.getElementById('statsCardsContainer');
    if (!container) return;

    const stats = [
      {
        label: 'Total Workflows',
        value: this.workflows.length,
        icon: 'bi-diagram-2',
        color: 'primary'
      },
      {
        label: 'Active Schedules',
        value: this.schedules.filter(s => s.enabled).length,
        icon: 'bi-calendar-check',
        color: 'success'
      },
      {
        label: 'Recent Executions (7d)',
        value: this.executions.filter(e => {
          const execDate = new Date(e.executedAt || e.timestamp);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          return execDate > sevenDaysAgo;
        }).length,
        icon: 'bi-play-circle',
        color: 'success'
      },
      {
        label: 'Success Rate',
        value: this.calculateSuccessRate() + '%',
        icon: 'bi-check-circle',
        color: 'success'
      }
    ];

    let html = '';
    const variantMap = { primary: 't', success: 'g', info: 'b', warning: 'o' };
    stats.forEach(stat => {
      const iconVariant = variantMap[stat.color] || 't';
      html += `
        <div class="col-md-6 col-lg-3">
          <div class="kr-stat-card">
            <div class="top">
              <div class="ico ${iconVariant}"><i class="bi ${stat.icon}"></i></div>
            </div>
            <div class="num">${stat.value}</div>
            <div class="lbl">${stat.label}</div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  /**
   * Calculate success rate
   */
  calculateSuccessRate() {
    if (this.executions.length === 0) return 0;
    const successful = this.executions.filter(e => e.status === 'success' || e.outcome === 'success').length;
    return Math.round((successful / this.executions.length) * 100);
  }

  /**
   * Render recently edited workflows
   */
  renderRecentlyEdited() {
    const container = document.getElementById('recentlyEditedContainer');
    if (!container) return;

    // Sort by modification date and get top 5
    const recent = [...this.workflows]
      .sort((a, b) => new Date(b.modifiedAt || b.updatedAt) - new Date(a.modifiedAt || a.updatedAt))
      .slice(0, 5);

    if (recent.length === 0) {
      container.innerHTML = '<div class="text-muted text-center p-3">No workflows yet</div>';
      return;
    }

    let html = '';
    recent.forEach((workflow, idx) => {
      const modDate = new Date(workflow.modifiedAt || workflow.updatedAt);
      const timeAgo = this.getTimeAgo(modDate);
      html += `
        <div class="list-group-item" style="border-bottom: 1px solid #e0e0e0; padding: 12px 0;">
          <div class="d-flex justify-content-between align-items-start">
            <div style="flex: 1;">
              <h6 class="mb-1" style="font-size: 12px; font-weight: 600;">
                <i class="bi bi-diagram-2 me-2 text-primary"></i>${workflow.name}
              </h6>
              <small class="text-muted">${workflow.description || 'No description'}</small><br>
              <small class="text-muted">Modified ${timeAgo}</small>
            </div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary edit-workflow-btn" data-workflow-id="${workflow.id}" title="Edit workflow">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-outline-danger delete-recent-btn" data-workflow-id="${workflow.id}" title="Remove from recent">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Setup event listeners
    document.querySelectorAll('.edit-workflow-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const workflowId = e.currentTarget.dataset.workflowId;
        this.editWorkflow(workflowId);
      });
    });

    document.querySelectorAll('.delete-recent-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const workflowId = e.currentTarget.dataset.workflowId;
        this.deleteRecentActivity(workflowId);
      });
    });
  }

  /**
   * Render starred workflows
   */
  renderStarredWorkflows() {
    const container = document.getElementById('starredWorkflowsContainer');
    if (!container) return;

    const starred = this.workflows.filter(w => w.starred);

    if (starred.length === 0) {
      container.innerHTML = `
        <div class="text-muted text-center p-3">
          <i class="bi bi-star" style="font-size: 22px; opacity: 0.3;"></i>
          <p class="mt-2 mb-0">No starred workflows</p>
        </div>
      `;
      return;
    }

    let html = '';
    starred.forEach(workflow => {
      html += `
        <div class="list-group-item" style="border-bottom: 1px solid #e0e0e0; padding: 12px 0;">
          <div class="d-flex justify-content-between align-items-start">
            <div style="flex: 1;">
              <h6 class="mb-1" style="font-size: 12px; font-weight: 600;">
                <i class="bi bi-star-fill me-2 text-warning"></i>${workflow.name}
              </h6>
              <small class="text-muted">${workflow.stepCount || 0} steps</small>
            </div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-success execute-workflow-btn" data-workflow-id="${workflow.id}" title="Quick execute">
                <i class="bi bi-play-circle"></i>
              </button>
              <button class="btn btn-outline-danger unstar-workflow-btn" data-workflow-id="${workflow.id}" title="Unstar">
                <i class="bi bi-star-fill"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Setup event listeners
    document.querySelectorAll('.execute-workflow-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const workflowId = e.currentTarget.dataset.workflowId;
        this.executeWorkflow(workflowId);
      });
    });

    document.querySelectorAll('.unstar-workflow-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const workflowId = e.currentTarget.dataset.workflowId;
        this.unstarWorkflow(workflowId);
      });
    });
  }

  /**
   * Render active schedules
   */
  renderActiveSchedules() {
    const container = document.getElementById('activeSchedulesContainer');
    if (!container) return;

    const active = this.schedules.filter(s => s.enabled);

    if (active.length === 0) {
      container.innerHTML = `
        <div class="text-muted text-center p-3">
          <i class="bi bi-calendar-x" style="font-size: 22px; opacity: 0.3;"></i>
          <p class="mt-2 mb-0">No active schedules</p>
        </div>
      `;
      return;
    }

    let html = '';
    active.forEach(schedule => {
      const nextRun = new Date(schedule.nextRun);
      const timeUntilNext = this.getTimeUntil(nextRun);
      html += `
        <div class="list-group-item" style="border-bottom: 1px solid #e0e0e0; padding: 12px 0;">
          <div class="d-flex justify-content-between align-items-start">
            <div style="flex: 1;">
              <h6 class="mb-1" style="font-size: 12px; font-weight: 600;">
                <i class="bi bi-calendar-event me-2" style="color: var(--accent);"></i>${schedule.workflowName}
              </h6>
              <small class="text-muted">Schedule: ${schedule.cron}</small><br>
              <small class="text-success">Next run: ${timeUntilNext}</small>
            </div>
            <button class="btn btn-sm btn-outline-danger disable-schedule-btn" data-schedule-id="${schedule.id}">
              <i class="bi bi-pause-circle"></i>
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Setup event listeners
    document.querySelectorAll('.disable-schedule-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const scheduleId = e.currentTarget.dataset.scheduleId;
        this.disableSchedule(scheduleId);
      });
    });
  }

  /**
   * Render execution statistics
   */
  renderExecutionStats() {
    const container = document.getElementById('executionStatsContainer');
    if (!container) return;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentExecs = this.executions.filter(e => {
      const execDate = new Date(e.executedAt || e.timestamp);
      return execDate > sevenDaysAgo;
    });

    const successful = recentExecs.filter(e => e.status === 'success' || e.outcome === 'success').length;
    const failed = recentExecs.filter(e => e.status === 'failed' || e.outcome === 'failed').length;
    const total = recentExecs.length;

    const avgDuration = total > 0
      ? Math.round(recentExecs.reduce((sum, e) => sum + (e.duration || 0), 0) / total)
      : 0;

    const html = `
      <div class="row g-3">
        <div class="col-6">
          <div class="text-center">
            <h4 class="mb-1">${total}</h4>
            <small class="text-muted">Executions (7d)</small>
          </div>
        </div>
        <div class="col-6">
          <div class="text-center">
            <h4 class="mb-1 text-success">${successful}</h4>
            <small class="text-muted">Successful</small>
          </div>
        </div>
        <div class="col-6">
          <div class="text-center">
            <h4 class="mb-1 text-danger">${failed}</h4>
            <small class="text-muted">Failed</small>
          </div>
        </div>
        <div class="col-6">
          <div class="text-center">
            <h4 class="mb-1 text-info">${this.formatDuration(avgDuration)}</h4>
            <small class="text-muted">Avg Duration</small>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    document.getElementById('createWorkflowBtn')?.addEventListener('click', () => {
      if (window.renderWorkflowEditDashboard) {
        window.renderWorkflowEditDashboard(null);
      } else if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Workflow editor not ready. Please try again.',
          type: 'warning'
        });
      }
    });

    document.getElementById('importWorkflowBtn')?.addEventListener('click', () => {
      if (window.renderWorkflowsListDashboard) {
        window.renderWorkflowsListDashboard();
      } else if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Workflows list not ready. Please try again.',
          type: 'warning'
        });
      }
    });

    document.getElementById('viewExecutionsBtn')?.addEventListener('click', () => {
      if (window.renderExecutionHistoryDashboard) {
        window.renderExecutionHistoryDashboard();
      } else if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Execution history not ready. Please try again.',
          type: 'warning'
        });
      }
    });
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(workflowId) {
    try {
      const response = await window.apiCall(`/api/workflows/${workflowId}/execute`, { method: 'POST' });
      const result = await response.json();

      if (window.ui?.showToast) {
        window.ui.showToast({
          message: result.message || 'Workflow execution started',
          type: 'success'
        });
      }
    } catch (error) {
      if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Failed to execute workflow',
          type: 'danger'
        });
      }
    }
  }

  /**
   * Edit a workflow
   */
  editWorkflow(workflowId) {
    if (window.renderWorkflowEditDashboard) {
      window.renderWorkflowEditDashboard(workflowId);
    } else if (window.ui?.showToast) {
      window.ui.showToast({
        message: 'Workflow editor not ready. Please try again.',
        type: 'warning'
      });
    }
  }

  /**
   * Unstar a workflow
   */
  async unstarWorkflow(workflowId) {
    try {
      const response = await window.apiCall(`/api/workflows/${workflowId}/star`, {
        method: 'POST',
        body: JSON.stringify({ starred: false })
      });

      if (!response.ok) {
        throw new Error('Failed to unstar workflow');
      }

      const result = await response.json();

      if (result.success) {
        const workflow = this.workflows.find(w => w.id === workflowId);
        if (workflow) {
          workflow.starred = false;
          this.renderStarredWorkflows();
        }
        if (window.ui?.showToast) {
          window.ui.showToast({
            message: 'Workflow unstarred',
            type: 'success'
          });
        }
      } else {
        throw new Error(result.message || 'Failed to unstar workflow');
      }
    } catch (error) {
      console.error('Error unstarring workflow:', error);
      if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Failed to unstar workflow: ' + error.message,
          type: 'danger'
        });
      }
    }
  }

  /**
   * Delete a workflow from recent activity
   */
  async deleteRecentActivity(workflowId) {
    try {
      const response = await window.apiCall(`/api/workflows/${workflowId}/recent`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to remove from recent');
      }

      const result = await response.json();

      if (result.success) {
        // Reload dashboard to reflect the change
        await this.loadDashboardData();
        this.renderRecentlyEdited();
        if (window.ui?.showToast) {
          window.ui.showToast({
            message: 'Removed from recent activity',
            type: 'success'
          });
        }
      } else {
        throw new Error(result.message || 'Failed to remove from recent');
      }
    } catch (error) {
      console.error('Error deleting recent activity:', error);
      if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Failed to remove from recent: ' + error.message,
          type: 'danger'
        });
      }
    }
  }

  /**
   * Disable a schedule
   */
  disableSchedule(scheduleId) {
    const schedule = this.schedules.find(s => s.id === scheduleId);
    if (schedule) {
      schedule.enabled = false;
      this.renderActiveSchedules();
      if (window.ui?.showToast) {
        window.ui.showToast({
          message: 'Schedule disabled',
          type: 'warning'
        });
      }
    }
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    return Math.round(ms / 60000) + 'm';
  }

  /**
   * Get time ago string
   */
  getTimeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  /**
   * Get time until string
   */
  getTimeUntil(date) {
    const now = new Date();
    const diff = date - now;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 0) return 'overdue';
    if (minutes < 1) return 'in a few seconds';
    if (minutes < 60) return `in ${minutes}m`;
    if (hours < 24) return `in ${hours}h`;
    return `in ${days}d`;
  }
}

// Initialize workflow dashboard
let workflowDashboard;

async function initWorkflowDashboard() {
  if (!workflowDashboard) {
    workflowDashboard = new WorkflowDashboard();
    await workflowDashboard.init();
  }
}
