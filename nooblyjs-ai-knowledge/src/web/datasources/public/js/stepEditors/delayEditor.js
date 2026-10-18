/**
 * @fileoverview Delay Step Editor
 * Provides delay configuration with human-readable duration helper
 *
 * @author noobly Team
 * @version 1.0.0
 */

/**
 * DelayEditor class for managing delay step configuration
 */
class DelayEditor {
  constructor(stepIndex, step, currentWorkflow) {
    this.stepIndex = stepIndex;
    this.step = step;
    this.currentWorkflow = currentWorkflow;
    this.modal = null;
    this.currentDuration = step.config?.duration || 5000;
  }

  /**
   * Initialize the delay editor
   */
  init() {
    const modalHTML = this.createModalHTML();
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    this.modal = document.getElementById('delayEditorModal');
    this.setupEventListeners();
    this.updateDurationDisplay();
  }

  /**
   * Create modal HTML structure
   */
  createModalHTML() {
    return `
      <div class="modal fade" id="delayEditorModal" tabindex="-1">
        <div class="modal-dialog modal-sm">
          <div class="modal-content">
            <div class="modal-header bg-warning bg-opacity-10">
              <h5 class="modal-title">
                <i class="bi bi-clock me-2"></i>Delay Step Configuration
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>

            <div class="modal-body">
              <!-- Quick Preset Buttons -->
              <div class="mb-3">
                <label class="form-label"><strong>Quick Duration Presets</strong></label>
                <div class="d-grid gap-2" style="grid-template-columns: repeat(3, 1fr);">
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="1000">
                    <i class="bi bi-lightning me-1"></i>1 second
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="5000">
                    <i class="bi bi-lightning me-1"></i>5 seconds
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="10000">
                    <i class="bi bi-lightning me-1"></i>10 seconds
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="30000">
                    <i class="bi bi-hourglass-split me-1"></i>30 seconds
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="60000">
                    <i class="bi bi-hourglass-split me-1"></i>1 minute
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="300000">
                    <i class="bi bi-hourglass me-1"></i>5 minutes
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="600000">
                    <i class="bi bi-hourglass me-1"></i>10 minutes
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="1800000">
                    <i class="bi bi-hourglass me-1"></i>30 minutes
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm duration-preset" data-ms="3600000">
                    <i class="bi bi-hourglass me-1"></i>1 hour
                  </button>
                </div>
              </div>

              <!-- Custom Duration Input -->
              <div class="mb-3">
                <label class="form-label"><strong>Custom Duration</strong></label>
                <div class="input-group">
                  <input type="number" class="form-control" id="durationInput"
                         placeholder="Enter duration in milliseconds"
                         value="${this.currentDuration}" min="100" max="86400000"
                         style="font-size: 12px;">
                  <span class="input-group-text" style="font-size: 12px;">ms</span>
                </div>
                <small class="text-muted d-block mt-2">
                  Enter duration in milliseconds (100ms - 24 hours)
                </small>
              </div>

              <!-- Duration Breakdown -->
              <div class="card bg-light">
                <div class="card-body p-3">
                  <label class="form-label"><strong>Duration Breakdown</strong></label>
                  <div id="durationBreakdown" style="font-size: 12px; font-family: monospace;">
                    <!-- Breakdown will be inserted here -->
                  </div>
                </div>
              </div>

              <!-- Duration Visualization -->
              <div class="card mt-3">
                <div class="card-header">
                  <h6 class="mb-0"><i class="bi bi-speedometer2 me-2"></i>Visual Timeline</h6>
                </div>
                <div class="card-body p-3">
                  <div id="durationTimeline">
                    <!-- Timeline will be inserted here -->
                  </div>
                </div>
              </div>

              <!-- Maximum Duration Warning -->
              <div class="alert alert-info small mb-0 mt-3">
                <i class="bi bi-info-circle me-1"></i>
                <strong>Note:</strong> Maximum delay is 24 hours (86,400,000 milliseconds).
                For workflows that need extended waits, consider using scheduled execution instead.
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="saveDelayBtn">
                <i class="bi bi-check-circle me-1"></i>Save Configuration
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Duration preset buttons
    document.querySelectorAll('.duration-preset')?.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ms = parseInt(e.currentTarget.dataset.ms);
        this.setDuration(ms);
      });
    });

    // Custom duration input
    document.getElementById('durationInput')?.addEventListener('input', (e) => {
      const ms = parseInt(e.target.value) || 0;
      this.currentDuration = ms;
      this.updateDurationDisplay();
    });

    // Save button
    document.getElementById('saveDelayBtn')?.addEventListener('click', () => {
      this.saveConfiguration();
    });

    // Modal dismiss
    this.modal?.addEventListener('hidden.bs.modal', () => {
      this.modal.remove();
      window.delayEditorInstance = null;
    });
  }

  /**
   * Set duration
   */
  setDuration(ms) {
    this.currentDuration = ms;
    document.getElementById('durationInput').value = ms;
    this.updateDurationDisplay();

    // Highlight the preset button
    document.querySelectorAll('.duration-preset').forEach(btn => {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-secondary');
      if (parseInt(btn.dataset.ms) === ms) {
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-primary');
      }
    });
  }

  /**
   * Update duration display
   */
  updateDurationDisplay() {
    this.updateDurationBreakdown();
    this.updateDurationTimeline();
    this.updatePresetButton();
  }

  /**
   * Update duration breakdown
   */
  updateDurationBreakdown() {
    const breakdown = this.calculateDurationBreakdown(this.currentDuration);
    const breakdownDiv = document.getElementById('durationBreakdown');

    if (!breakdownDiv) return;

    const lines = [
      `Milliseconds: ${breakdown.ms}`,
      `Seconds: ${breakdown.seconds}`,
      `Minutes: ${breakdown.minutes}`,
      `Hours: ${breakdown.hours}`,
      `Total: ${breakdown.total}`
    ];

    breakdownDiv.innerHTML = lines.map(line => `<div>${line}</div>`).join('');
  }

  /**
   * Calculate duration breakdown
   */
  calculateDurationBreakdown(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);

    const hours = totalHours;
    const minutes = totalMinutes % 60;
    const seconds = totalSeconds % 60;
    const milliseconds = ms % 1000;

    let total = '';
    const parts = [];

    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    if (milliseconds > 0) parts.push(`${milliseconds}ms`);

    if (parts.length === 0) {
      total = '0ms';
    } else {
      total = parts.join(' ');
    }

    return {
      ms: ms.toLocaleString(),
      seconds: totalSeconds.toLocaleString(),
      minutes: totalMinutes.toLocaleString(),
      hours: totalHours.toLocaleString(),
      total: total
    };
  }

  /**
   * Update duration timeline visualization
   */
  updateDurationTimeline() {
    const breakdown = this.calculateDurationBreakdown(this.currentDuration);
    const timelineDiv = document.getElementById('durationTimeline');

    if (!timelineDiv) return;

    // Calculate visual bar width (log scale for very large durations)
    const maxWidth = 100;
    let barWidth = maxWidth;
    if (this.currentDuration > 3600000) {
      // Over 1 hour, use log scale
      barWidth = Math.min(maxWidth, 20 + Math.log(this.currentDuration / 1000) * 3);
    }

    const timelineHTML = `
      <div style="margin-bottom: 10px;">
        <small class="text-muted">Duration Visualization (proportional for durations up to 1 hour)</small>
      </div>
      <div style="background-color: #e9ecef; border-radius: 4px; padding: 4px; margin-bottom: 10px; position: relative;">
        <div style="background-color: #ffc107; height: 24px; border-radius: 2px; width: ${Math.max(barWidth, 2)}%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px;">
          ${barWidth > 10 ? breakdown.total : ''}
        </div>
      </div>
      <div style="display: grid; grid-template-columns: auto auto; gap: 8px 16px; font-size: 11px;">
        <span class="text-muted">Time</span>
        <span>${breakdown.total}</span>
        <span class="text-muted">Seconds</span>
        <span>${breakdown.seconds}</span>
        <span class="text-muted">Minutes</span>
        <span>${breakdown.minutes}</span>
      </div>
    `;

    timelineDiv.innerHTML = timelineHTML;
  }

  /**
   * Update preset button highlighting
   */
  updatePresetButton() {
    document.querySelectorAll('.duration-preset').forEach(btn => {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-secondary');
      if (parseInt(btn.dataset.ms) === this.currentDuration) {
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-primary');
      }
    });
  }

  /**
   * Save configuration
   */
  saveConfiguration() {
    if (this.currentDuration < 100) {
      alert('Minimum delay is 100 milliseconds.');
      return;
    }

    if (this.currentDuration > 86400000) {
      alert('Maximum delay is 24 hours (86,400,000 milliseconds).');
      return;
    }

    // Update step configuration
    this.step.config.duration = this.currentDuration;

    // Update hidden input for data binding
    const input = document.querySelector(`input[data-field="config.duration"][data-step="${this.stepIndex}"]`);
    if (input) {
      input.value = this.currentDuration;
    }

    // Close modal
    const modal = bootstrap.Modal.getInstance(this.modal);
    modal?.hide();

    // Show toast notification
    if (window.ui?.showToast) {
      const breakdown = this.calculateDurationBreakdown(this.currentDuration);
      window.ui.showToast({
        message: `Delay step configured: ${breakdown.total}`,
        type: 'success',
        duration: 2000
      });
    }
  }
}

/**
 * Show delay editor modal
 * @param {number} stepIndex - Index of the step
 * @param {Object} step - Step configuration
 * @param {Object} currentWorkflow - Current workflow object
 */
function showDelayEditor(stepIndex, step, currentWorkflow) {
  // Close existing instance
  const existingModal = document.getElementById('delayEditorModal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create and initialize editor
  const editor = new DelayEditor(stepIndex, step, currentWorkflow);
  editor.init();

  // Store instance globally
  window.delayEditorInstance = editor;

  // Show modal
  const modal = new bootstrap.Modal(document.getElementById('delayEditorModal'));
  modal.show();
}
