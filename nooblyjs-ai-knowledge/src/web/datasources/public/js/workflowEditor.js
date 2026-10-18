/**
 * @fileoverview Workflow Editor UI Module
 * Handles workflow creation and editing with step management
 *
 * @author noobly Team
 * @version 1.0.0
 */

// Step type configurations
const STEP_TYPES = {
  identity: { label: 'Identity', icon: 'bi-arrow-right', description: 'Pass-through step' },
  delay: { label: 'Delay', icon: 'bi-clock', description: 'Pause execution' },
  transform: { label: 'Transform', icon: 'bi-code-square', description: 'Transform data with JavaScript' },
  conditional: { label: 'Conditional', icon: 'bi-question-circle', description: 'Conditional branching' },
  api: { label: 'API Call', icon: 'bi-cloud-arrow-up', description: 'Call external HTTP API' },
  parallel: { label: 'Parallel', icon: 'bi-distribute-vertical', description: 'Execute steps in parallel' }
};

// Global state for current workflow
let currentWorkflow = {
  name: '',
  description: '',
  steps: [],
  tags: [],
  defaultInput: {}
};
let autoSaveInterval = null;
let isDirty = false;

/**
 * Render workflow creation editor
 */
async function renderWorkflowCreateEditor() {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = '<div class="d-flex justify-content-center align-items-center" style="height: 100px;"><div class="spinner-border"></div></div>';

  // Reset state
  currentWorkflow = { name: '', description: '', steps: [], tags: [], defaultInput: {} };
  isDirty = false;

  // Create editor UI
  const editor = createWorkflowEditorUI(false);

  mainContent.innerHTML = '';
  mainContent.appendChild(editor);

  // Setup auto-save
  setupAutoSave();
}

/**
 * Render workflow edit editor
 */
async function renderWorkflowEditEditor(workflowId) {
  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = '<div class="d-flex justify-content-center align-items-center" style="height: 100px;"><div class="spinner-border"></div></div>';

  try {
    // Fetch workflow data
    const response = await window.apiCall(`/api/workflows/${workflowId}`);
    const result = await response.json();

    if (!result.success) {
      ui.showToast({ message: result.error || 'Failed to load workflow', type: 'danger' });
      renderWorkflowsListDashboard();
      return;
    }

    // Mark workflow as viewed
    window.apiCall(`/api/workflows/${workflowId}/view`, { method: 'POST' }).catch(() => {});

    // Fetch detailed steps (with file content)
    let detailedSteps = [];
    try {
      const stepsResponse = await window.apiCall(`/api/workflows/${workflowId}/steps`);
      if (stepsResponse.ok) {
        const stepsResult = await stepsResponse.json();
        if (stepsResult.success) {
          detailedSteps = stepsResult.data || [];
        }
      }
    } catch (error) {
      console.warn('Failed to fetch detailed steps:', error);
    }

    // Set current workflow
    currentWorkflow = result.data;
    // Store detailed steps for later use
    currentWorkflow._detailedSteps = detailedSteps;
    isDirty = false;

    // Create editor UI
    const editor = createWorkflowEditorUI(true, workflowId);

    mainContent.innerHTML = '';
    mainContent.appendChild(editor);

    // Setup auto-save
    setupAutoSave();
  } catch (error) {
    ui.showToast({ message: 'Error loading workflow: ' + error.message, type: 'danger' });
    renderWorkflowsListDashboard();
  }
}

/**
 * Create workflow editor UI
 */
function createWorkflowEditorUI(isEditing, workflowId = null) {
  const container = document.createElement('div');
  container.className = 'workflow-editor';

  // Breadcrumb + KR-style title bar
  const header = document.createElement('div');
  header.innerHTML = `
    <nav class="kr-breadcrumb">
      <a href="#"><i class="bi bi-house-door"></i></a>
      <span class="sep">›</span>
      <a href="#" onclick="renderWorkflowsListDashboard(); return false;">Workflows</a>
      <span class="sep">›</span>
      <span class="last">${isEditing ? 'Edit' : 'Create'}</span>
    </nav>
    <div class="d-flex align-items-end justify-content-between flex-wrap gap-3 mb-3">
      <div>
        <h2 style="font-size: 24px; font-weight: 800; letter-spacing: -.01em; margin: 0;">${isEditing ? 'Edit workflow' : 'Create workflow'}</h2>
        <div style="color: var(--kr-ink-500); font-size: 12px;">${isEditing ? 'Modify workflow configuration and steps.' : 'Configure a new workflow with custom steps.'}</div>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-ghost" id="cancelWorkflowBtn">
          <i class="bi bi-x-lg"></i> Cancel
        </button>
        ${isEditing ? `
          <button class="btn btn-secondary" id="exportWorkflowBtn" data-workflow-id="${workflowId}">
            <i class="bi bi-download"></i> Export
          </button>
          <button class="btn btn-secondary" id="scheduleWorkflowBtn" data-workflow-id="${workflowId}">
            <i class="bi bi-clock"></i> Schedule
          </button>
          <button class="btn btn-secondary" id="executeWorkflowBtn" data-workflow-id="${workflowId}" style="background: #fff5e6; color: #c98019; border-color: #ffe1b3;">
            <i class="bi bi-play-fill"></i> Execute
          </button>
        ` : ''}
        <button class="btn btn-primary" id="saveWorkflowBtn">
          <i class="bi bi-check-lg"></i> ${isEditing ? 'Update' : 'Create'} workflow
        </button>
      </div>
    </div>
  `;
  container.appendChild(header);

  // Main form (KR surface)
  const formCard = document.createElement('div');
  formCard.className = 'kr-surface mb-3';
  formCard.innerHTML = `
    <div class="kr-surface-head">
      <h3><i class="bi bi-info-circle"></i> Workflow details</h3>
    </div>
    <div class="kr-surface-body" style="padding: 20px 24px;">
      <h5 class="card-title mb-3" style="display: none;">Workflow Details</h5>

      <!-- Workflow Name -->
      <div class="mb-3">
        <label class="form-label">Name <span class="text-danger">*</span></label>
        <input type="text" class="form-control" id="workflowName"
               placeholder="Enter workflow name"
               value="${currentWorkflow.name || ''}"
               maxlength="100" required>
        <small class="text-muted">Maximum 100 characters</small>
      </div>

      <!-- Group (Folder) -->
      <div class="mb-3">
        <label class="form-label">Group (Folder) <span class="text-danger">*</span></label>
        <select class="form-select" id="workflowGroup" required>
          <option value="">Select existing group or create new...</option>
        </select>
        <div id="newGroupContainer" style="display: none;" class="mt-2">
          <input type="text" class="form-control" id="workflowGroupNew"
                 placeholder="Enter new group name (letters, numbers, hyphens only)">
          <small class="text-muted">Group name will be used as the folder name</small>
        </div>
        <small class="text-muted d-block mt-2">Groups organize related workflows together</small>
      </div>

      <!-- Description -->
      <div class="mb-3">
        <label class="form-label">Description</label>
        <textarea class="form-control" id="workflowDescription"
                  rows="3" placeholder="Describe what this workflow does"
                  maxlength="500">${currentWorkflow.description || ''}</textarea>
        <small class="text-muted">Maximum 500 characters</small>
      </div>

      <!-- Tags -->
      <div class="mb-3">
        <label class="form-label">Tags</label>
        <input type="text" class="form-control" id="workflowTags"
               placeholder="Enter tags separated by commas"
               value="${(currentWorkflow.tags || []).join(', ')}">
        <small class="text-muted">Separate multiple tags with commas</small>
      </div>

      <!-- Default Input JSON -->
      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <label class="form-label mb-0">Default Input (JSON)</label>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="formatJsonBtn">
            <i class="bi bi-code me-1"></i> Format JSON
          </button>
        </div>
        <textarea class="form-control" id="workflowDefaultInput"
                  rows="6" placeholder='{"key": "value"}'
                  style="font-family: 'Monaco', 'Courier New', monospace; font-size: 10px;">${currentWorkflow.defaultInput ? JSON.stringify(currentWorkflow.defaultInput, null, 2) : '{}'}</textarea>
        <small class="text-muted">Valid JSON object that will be passed as input when executing the workflow</small>
        <div id="jsonValidationStatus" class="mt-2"></div>
      </div>
    </div>
  `;
  container.appendChild(formCard);

  // Steps section - different UI for editing vs creating
  const stepsCard = document.createElement('div');
  stepsCard.className = 'card border-0 shadow-sm';

  if (isEditing && currentWorkflow._detailedSteps && currentWorkflow._detailedSteps.length > 0) {
    // Show file-based steps editor for existing workflows
    stepsCard.innerHTML = `
      <div class="card-body p-4">
        <h5 class="card-title mb-3">Workflow Steps <span class="text-danger">*</span></h5>
        <div id="stepsFileEditor"></div>
      </div>
    `;
  } else {
    // Show traditional step builder for new workflows
    stepsCard.innerHTML = `
      <div class="card-body p-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="card-title mb-0">Workflow Steps <span class="text-danger">*</span></h5>
          <div class="dropdown">
            <button class="btn btn-sm btn-primary dropdown-toggle" type="button"
                    id="addStepDropdown" data-bs-toggle="dropdown">
              <i class="bi bi-plus-lg"></i> Add Step
            </button>
            <ul class="dropdown-menu" id="stepTypeMenu">
              ${Object.entries(STEP_TYPES).map(([type, config]) => `
                <li>
                  <a class="dropdown-item" href="#" data-step-type="${type}">
                    <i class="${config.icon} me-2"></i>${config.label}
                    <br><small class="text-muted">${config.description}</small>
                  </a>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>

        <div id="stepsContainer">
          <!-- Steps will be rendered here -->
        </div>

        <div id="noStepsMessage" class="text-center text-muted py-5"
             style="${(currentWorkflow.steps || []).length > 0 ? 'display: none;' : ''}">
          <i class="bi bi-inbox" style="font-size: 42px;"></i>
          <p class="mt-3">No steps added yet. Click "Add Step" to get started.</p>
        </div>
      </div>
    `;
  }

  container.appendChild(stepsCard);

  // Event listeners
  setTimeout(() => {
    // Cancel button
    document.getElementById('cancelWorkflowBtn').addEventListener('click', () => {
      if (isDirty && !confirm('You have unsaved changes. Are you sure you want to cancel?')) {
        return;
      }
      clearAutoSave();
      renderWorkflowsListDashboard();
    });

    // Populate groups dropdown
    populateGroupsDropdown(isEditing ? currentWorkflow.group : null);

    // Group selection change handler
    document.getElementById('workflowGroup').addEventListener('change', (e) => {
      const newGroupContainer = document.getElementById('newGroupContainer');
      const newGroupInput = document.getElementById('workflowGroupNew');

      if (e.target.value === '__CREATE_NEW__') {
        newGroupContainer.style.display = 'block';
        newGroupInput.required = true;
      } else {
        newGroupContainer.style.display = 'none';
        newGroupInput.required = false;
        newGroupInput.value = '';
      }
      isDirty = true;
    });

    // Save button
    document.getElementById('saveWorkflowBtn').addEventListener('click', () => {
      saveWorkflow(isEditing, workflowId);
    });

    // Export button (only exists when editing)
    const exportBtn = document.getElementById('exportWorkflowBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const workflowIdToExport = exportBtn.dataset.workflowId;
        exportWorkflow(workflowIdToExport);
      });
    }

    // Execute button (only exists when editing)
    const executeBtn = document.getElementById('executeWorkflowBtn');
    if (executeBtn) {
      executeBtn.addEventListener('click', () => {
        const workflowIdToExecute = executeBtn.dataset.workflowId;
        executeWorkflowDirectly(workflowIdToExecute);
      });
    }

    // Schedule button (only exists when editing)
    const scheduleBtn = document.getElementById('scheduleWorkflowBtn');
    if (scheduleBtn) {
      scheduleBtn.addEventListener('click', () => {
        const workflowIdToSchedule = scheduleBtn.dataset.workflowId;
        showScheduleModal(workflowIdToSchedule);
      });
    }

    // Input change tracking
    ['workflowName', 'workflowDescription', 'workflowTags'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        isDirty = true;
      });
    });

    // JSON input validation and tracking
    const jsonInput = document.getElementById('workflowDefaultInput');
    if (jsonInput) {
      jsonInput.addEventListener('input', () => {
        isDirty = true;
        validateWorkflowJSON();
      });

      const formatBtn = document.getElementById('formatJsonBtn');
      if (formatBtn) {
        formatBtn.addEventListener('click', formatWorkflowJSON);
      }

      // Initial validation
      validateWorkflowJSON();
    }

    // Add step menu items
    document.querySelectorAll('#stepTypeMenu .dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const stepType = item.dataset.stepType;
        addStep(stepType);
      });
    });

    // Render existing steps or file-based editor
    if (isEditing && currentWorkflow._detailedSteps && currentWorkflow._detailedSteps.length > 0) {
      // Render file-based steps editor for existing workflows
      renderFileBasedStepsEditor(workflowId);
    } else {
      // Render traditional step builder for new workflows
      renderSteps();
    }
  }, 0);

  return container;
}

/**
 * Validate workflow default input JSON
 */
function validateWorkflowJSON() {
  const jsonInput = document.getElementById('workflowDefaultInput');
  const statusDiv = document.getElementById('jsonValidationStatus');

  if (!jsonInput || !statusDiv) return;

  try {
    const jsonText = jsonInput.value.trim();
    if (!jsonText) {
      // Empty is allowed (will default to {})
      statusDiv.innerHTML = '';
      jsonInput.classList.remove('is-invalid', 'is-valid');
      return;
    }

    JSON.parse(jsonText);
    // Valid JSON
    statusDiv.innerHTML = '<small class="text-success"><i class="bi bi-check-circle me-1"></i>Valid JSON</small>';
    jsonInput.classList.remove('is-invalid');
    jsonInput.classList.add('is-valid');
  } catch (error) {
    // Invalid JSON
    statusDiv.innerHTML = `<small class="text-danger"><i class="bi bi-exclamation-circle me-1"></i>Invalid JSON: ${error.message}</small>`;
    jsonInput.classList.remove('is-valid');
    jsonInput.classList.add('is-invalid');
  }
}

/**
 * Format workflow default input JSON
 */
function formatWorkflowJSON() {
  const jsonInput = document.getElementById('workflowDefaultInput');
  if (!jsonInput) return;

  try {
    const jsonText = jsonInput.value.trim();
    if (!jsonText) {
      jsonInput.value = '{}';
      return;
    }

    const parsed = JSON.parse(jsonText);
    jsonInput.value = JSON.stringify(parsed, null, 2);
    validateWorkflowJSON();
    ui.showToast({ message: 'JSON formatted successfully', type: 'success' });
  } catch (error) {
    ui.showToast({ message: 'Cannot format invalid JSON: ' + error.message, type: 'danger' });
  }
}

/**
 * Add a new step
 */
function addStep(stepType) {
  const newStep = {
    id: `step-${Date.now()}`,
    name: `${STEP_TYPES[stepType].label} Step`,
    config: { type: stepType },
    timeout: 30
  };

  // Add type-specific defaults
  switch (stepType) {
    case 'delay':
      newStep.config.duration = 5000;
      break;
    case 'transform':
      newStep.config.script = '// Transform function\n({ ...input, transformed: true })';
      break;
    case 'conditional':
      newStep.config.condition = 'input.value > 0';
      break;
    case 'api':
      newStep.config.endpoint = 'https://api.example.com/data';
      newStep.config.method = 'GET';
      newStep.config.headers = {};
      break;
    case 'parallel':
      newStep.config.steps = [];
      break;
  }

  currentWorkflow.steps.push(newStep);
  isDirty = true;
  renderSteps();
}

/**
 * Render all steps
 */
function renderSteps() {
  const container = document.getElementById('stepsContainer');
  const noStepsMsg = document.getElementById('noStepsMessage');

  if (currentWorkflow.steps.length === 0) {
    container.innerHTML = '';
    noStepsMsg.style.display = 'block';
    return;
  }

  noStepsMsg.style.display = 'none';
  container.innerHTML = '';

  currentWorkflow.steps.forEach((step, index) => {
    const stepCard = createStepCard(step, index);
    container.appendChild(stepCard);
  });

  // Initialize drag-and-drop
  setTimeout(() => initializeSortable(), 0);

  // Initialize retry previews for all steps with retry enabled
  currentWorkflow.steps.forEach((step, index) => {
    if (step.retry?.enabled) {
      setTimeout(() => updateRetryPreview(index), 100);
    }
  });
}

/**
 * Render workflow steps from files with code editor
 * Used when editing existing workflows with file-based steps
 */
let currentEditingStepFile = null;
let stepEditors = {};

async function renderFileBasedStepsEditor(workflowId) {
  const container = document.getElementById('stepsFileEditor');
  if (!container || !currentWorkflow._detailedSteps) {
    return;
  }

  const steps = currentWorkflow._detailedSteps;

  // Create tabs for each step
  const tabsHTML = `
    <div class="d-flex align-items-center mb-3">
      <ul class="nav nav-tabs flex-grow-1 mb-0" role="tablist">
        ${steps.map((step, index) => `
          <li class="nav-item" role="presentation">
            <button class="nav-link ${index === 0 ? 'active' : ''}"
                    id="step-tab-${index}" type="button"
                    data-bs-toggle="tab"
                    data-bs-target="#step-content-${index}"
                    onclick="switchStepEditor(${index}, '${workflowId}')">
              <i class="bi bi-file-code me-2"></i>${step.filePath.split('/').pop()}
            </button>
          </li>
        `).join('')}
      </ul>
      <button class="btn btn-sm btn-outline-primary ms-2" onclick="showAddStepModal('${workflowId}')" title="Add new step">
        <i class="bi bi-plus-lg"></i>
      </button>
    </div>
    <div class="tab-content">
      ${steps.map((step, index) => `
        <div class="tab-pane fade ${index === 0 ? 'show active' : ''}" id="step-content-${index}" role="tabpanel">
          <div class="mb-3">
            <small class="text-muted">File: <code>${step.filePath}</code></small>
          </div>
          <div class="position-relative" style="border: 1px solid #dee2e6; border-radius: 4px; overflow: hidden;">
            <pre class="mb-0" style="background-color: #f8f9fa; padding: 0;"><code class="language-javascript" id="step-code-${index}" style="display: block; padding: 15px; overflow-x: auto; max-height: 500px; overflow-y: auto;"></code></pre>
            <textarea id="step-editor-${index}" class="form-control"
                     style="font-family: 'Monaco', 'Courier New', monospace; font-size: 11px; border: none; border-radius: 0; min-height: 500px; display: none;"
                     data-step-index="${index}"
                     data-workflow-id="${workflowId}"
                     data-file-path="${step.filePath}"></textarea>
            <button type="button" class="btn btn-sm btn-primary position-absolute"
                   style="top: 10px; right: 10px; z-index: 10;"
                   id="edit-btn-${index}"
                   onclick="toggleStepEditMode(${index})">
              <i class="bi bi-pencil"></i> Edit
            </button>
            <button type="button" class="btn btn-sm btn-success position-absolute"
                   style="top: 10px; right: 70px; z-index: 10; display: none;"
                   id="save-btn-${index}"
                   onclick="saveStepFile(${index})">
              <i class="bi bi-check-lg"></i> Save
            </button>
            <button type="button" class="btn btn-sm btn-secondary position-absolute"
                   style="top: 10px; right: 130px; z-index: 10; display: none;"
                   id="cancel-btn-${index}"
                   onclick="cancelStepEditMode(${index})">
              <i class="bi bi-x-lg"></i> Cancel
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.innerHTML = tabsHTML;

  // Load first step content
  if (steps.length > 0) {
    await loadStepFileContent(0, workflowId);
  }
}

async function loadStepFileContent(stepIndex, workflowId) {
  const step = currentWorkflow._detailedSteps[stepIndex];
  if (!step) return;

  try {
    const response = await window.apiCall(`/api/workflows/${workflowId}/step-file-content?stepFilePath=${encodeURIComponent(step.filePath)}`);
    const result = await response.json();

    if (result.success && result.data) {
      const codeElement = document.getElementById(`step-code-${stepIndex}`);
      const editorElement = document.getElementById(`step-editor-${stepIndex}`);
      const content = result.data.content;

      if (codeElement) {
        codeElement.textContent = content;
        // Highlight code if Prism is available
        if (typeof Prism !== 'undefined') {
          Prism.highlightElement(codeElement);
        }
      }

      if (editorElement) {
        editorElement.value = content;
      }

      currentEditingStepFile = { stepIndex, workflowId, filePath: step.filePath };
    }
  } catch (error) {
    console.error('Error loading step file content:', error);
    ui.showToast({ message: 'Failed to load step file', type: 'danger' });
  }
}

async function switchStepEditor(stepIndex, workflowId) {
  // Cancel any ongoing edits
  if (document.querySelector('[id^="step-editor-"]:not([style*="display: none"])')) {
    const activeIndex = Array.from(document.querySelectorAll('[id^="step-editor-"]')).findIndex(el => el.style.display !== 'none');
    if (activeIndex !== -1 && activeIndex !== stepIndex) {
      cancelStepEditMode(activeIndex);
    }
  }
  await loadStepFileContent(stepIndex, workflowId);
}

function toggleStepEditMode(stepIndex) {
  const codeElement = document.getElementById(`step-code-${stepIndex}`);
  const editorElement = document.getElementById(`step-editor-${stepIndex}`);
  const editBtn = document.getElementById(`edit-btn-${stepIndex}`);
  const saveBtn = document.getElementById(`save-btn-${stepIndex}`);
  const cancelBtn = document.getElementById(`cancel-btn-${stepIndex}`);

  if (editorElement.style.display === 'none') {
    // Switch to edit mode
    codeElement.style.display = 'none';
    editorElement.style.display = 'block';
    editBtn.style.display = 'none';
    saveBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'inline-block';
    editorElement.focus();
  }
}

function cancelStepEditMode(stepIndex) {
  const codeElement = document.getElementById(`step-code-${stepIndex}`);
  const editorElement = document.getElementById(`step-editor-${stepIndex}`);
  const editBtn = document.getElementById(`edit-btn-${stepIndex}`);
  const saveBtn = document.getElementById(`save-btn-${stepIndex}`);
  const cancelBtn = document.getElementById(`cancel-btn-${stepIndex}`);

  // Reload original content
  if (currentEditingStepFile && currentEditingStepFile.stepIndex === stepIndex) {
    const step = currentWorkflow._detailedSteps[stepIndex];
    const originalContent = codeElement.textContent;
    editorElement.value = originalContent;
  }

  codeElement.style.display = 'block';
  editorElement.style.display = 'none';
  editBtn.style.display = 'inline-block';
  saveBtn.style.display = 'none';
  cancelBtn.style.display = 'none';
}

async function saveStepFile(stepIndex) {
  const editorElement = document.getElementById(`step-editor-${stepIndex}`);
  const step = currentWorkflow._detailedSteps[stepIndex];
  const workflowId = editorElement.dataset.workflowId;

  if (!step || !editorElement) return;

  try {
    const response = await window.apiCall(`/api/workflows/${workflowId}/step-file-content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stepFilePath: step.filePath,
        content: editorElement.value
      })
    });

    const result = await response.json();

    if (result.success) {
      ui.showToast({ message: 'Step file saved successfully', type: 'success' });
      isDirty = true;

      // Update the code display with the new content
      const codeElement = document.getElementById(`step-code-${stepIndex}`);
      if (codeElement) {
        codeElement.textContent = editorElement.value;
        if (typeof Prism !== 'undefined') {
          Prism.highlightElement(codeElement);
        }
      }

      // Exit edit mode
      cancelStepEditMode(stepIndex);
    } else {
      ui.showToast({ message: result.error || 'Failed to save step file', type: 'danger' });
    }
  } catch (error) {
    console.error('Error saving step file:', error);
    ui.showToast({ message: 'Error saving step file: ' + error.message, type: 'danger' });
  }
}

// Make functions globally accessible
window.switchStepEditor = switchStepEditor;
window.toggleStepEditMode = toggleStepEditMode;
window.cancelStepEditMode = cancelStepEditMode;
window.saveStepFile = saveStepFile;

/**
 * Initialize SortableJS for drag-and-drop reordering
 */
let sortableInstance = null;

function initializeSortable() {
  const container = document.getElementById('stepsContainer');

  if (!container || currentWorkflow.steps.length === 0) {
    return;
  }

  // Destroy existing instance if any
  if (sortableInstance) {
    sortableInstance.destroy();
  }

  // Create new Sortable instance
  sortableInstance = Sortable.create(container, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',

    onEnd: function(evt) {
      // Reorder the steps array
      const movedStep = currentWorkflow.steps.splice(evt.oldIndex, 1)[0];
      currentWorkflow.steps.splice(evt.newIndex, 0, movedStep);

      // Mark as dirty
      isDirty = true;

      // Re-render to update step numbers
      renderSteps();
    }
  });
}

/**
 * Create step card UI
 */
function createStepCard(step, index) {
  const stepType = step.config.type;
  const typeConfig = STEP_TYPES[stepType];

  const card = document.createElement('div');
  card.className = 'card mb-3 border';
  card.innerHTML = `
    <div class="card-header bg-light d-flex justify-content-between align-items-center">
      <div class="d-flex align-items-center">
        <span class="drag-handle me-2" style="cursor: grab; font-size: 16.8px;" title="Drag to reorder">
          <i class="bi bi-grip-vertical"></i>
        </span>
        <i class=" me-2"></i>
        <strong>Step ${index + 1}:</strong> ${step.name}
        <span class="badge bg-secondary ms-2">${typeConfig.label}</span>
      </div>
      <div class="btn-group btn-group-sm">
        <button class="btn btn-outline-danger delete-step-btn" data-index="${index}" title="Delete step">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>
    <div class="card-body">
      ${createStepConfigForm(step, index)}
    </div>
  `;

  // Event listeners
  setTimeout(() => {
    const deleteBtn = card.querySelector('.delete-step-btn');

    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteStep(index));
    }

    // Form inputs
    card.querySelectorAll('input, textarea, select').forEach(input => {
      input.addEventListener('change', (e) => {
        updateStepConfig(index, e.target);
      });
      input.addEventListener('blur', (e) => {
        updateStepConfig(index, e.target);
      });
    });
  }, 0);

  return card;
}

/**
 * Create step configuration form
 */
function createStepConfigForm(step, index) {
  const stepType = step.config.type;

  // Ensure retry config exists with defaults
  if (!step.retry) {
    step.retry = {
      enabled: false,
      maxAttempts: 3,
      delayMs: 1000,
      backoffStrategy: 'exponential',
      maxDelayMs: 10000,
      continueOnError: false
    };
  }

  let formHTML = `
    <!-- Step Name -->
    <div class="mb-3">
      <label class="form-label">Step Name</label>
      <input type="text" class="form-control" data-field="name"
             value="${step.name}" placeholder="Enter step name">
    </div>

    <!-- Timeout -->
    <div class="mb-3">
      <label class="form-label">Timeout (seconds)</label>
      <input type="number" class="form-control" data-field="timeout"
             value="${step.timeout}" min="1" max="300">
      <small class="text-muted">How long to wait before timing out</small>
    </div>

    <!-- Error Handling & Retry Configuration -->
    <div class="card mb-3 border-warning">
      <div class="card-header bg-warning bg-opacity-10">
        <h6 class="mb-0">
          <i class="bi bi-arrow-repeat me-2"></i>Error Handling & Retry Configuration
        </h6>
      </div>
      <div class="card-body">
        <!-- Enable Retry Toggle -->
        <div class="form-check form-switch mb-3">
          <input class="form-check-input" type="checkbox" id="retryEnabled_${index}"
                 data-field="retry.enabled" ${step.retry.enabled ? 'checked' : ''}
                 onchange="toggleRetryConfig(${index}, this.checked)">
          <label class="form-check-label" for="retryEnabled_${index}">
            <strong>Enable Retry on Failure</strong>
          </label>
        </div>

        <!-- Retry Configuration Fields (shown when enabled) -->
        <div id="retryConfig_${index}" style="display: ${step.retry.enabled ? 'block' : 'none'};">

          <!-- Max Attempts -->
          <div class="row mb-3">
            <div class="col-md-6">
              <label class="form-label">Max Attempts</label>
              <input type="number" class="form-control" data-field="retry.maxAttempts"
                     value="${step.retry.maxAttempts}" min="1" max="10"
                     onchange="updateStepConfig(${index}, this)">
              <small class="text-muted">Total attempts including initial try (1 = no retry)</small>
            </div>

            <!-- Initial Delay -->
            <div class="col-md-6">
              <label class="form-label">Initial Delay (ms)</label>
              <input type="number" class="form-control" data-field="retry.delayMs"
                     value="${step.retry.delayMs}" min="100" step="100"
                     onchange="updateStepConfig(${index}, this)">
              <small class="text-muted">Delay before first retry</small>
            </div>
          </div>

          <!-- Backoff Strategy -->
          <div class="row mb-3">
            <div class="col-md-6">
              <label class="form-label">Backoff Strategy</label>
              <select class="form-select" data-field="retry.backoffStrategy"
                      onchange="updateStepConfig(${index}, this)">
                <option value="none" ${step.retry.backoffStrategy === 'none' ? 'selected' : ''}>
                  None (Fixed delay)
                </option>
                <option value="linear" ${step.retry.backoffStrategy === 'linear' ? 'selected' : ''}>
                  Linear (Delay × attempt)
                </option>
                <option value="exponential" ${step.retry.backoffStrategy === 'exponential' ? 'selected' : ''}>
                  Exponential (Delay × 2^attempt)
                </option>
              </select>
              <small class="text-muted">How delay increases between retries</small>
            </div>

            <!-- Max Delay -->
            <div class="col-md-6">
              <label class="form-label">Max Delay (ms)</label>
              <input type="number" class="form-control" data-field="retry.maxDelayMs"
                     value="${step.retry.maxDelayMs}" min="1000" step="1000"
                     onchange="updateStepConfig(${index}, this)">
              <small class="text-muted">Maximum delay cap</small>
            </div>
          </div>

          <!-- Continue on Error -->
          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="continueOnError_${index}"
                   data-field="retry.continueOnError" ${step.retry.continueOnError ? 'checked' : ''}
                   onchange="updateStepConfig(${index}, this)">
            <label class="form-check-label" for="continueOnError_${index}">
              <strong>Continue workflow even if step fails after all retries</strong>
            </label>
            <small class="text-muted d-block mt-1">
              If checked, workflow will continue to next step even if this step fails after all retry attempts.
              Use with caution.
            </small>
          </div>

          <!-- Retry Preview -->
          <div class="alert alert-info mt-3 mb-0" id="retryPreview_${index}">
            <strong>Retry Schedule:</strong>
            <div id="retrySchedulePreview_${index}" class="mt-2 small font-monospace">
              <!-- Populated by updateRetryPreview() -->
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Type-specific configuration
  switch (stepType) {
    case 'delay':
      formHTML += `
        <div class="mb-3">
          <label class="form-label">Delay Duration</label>
          <div class="card border-warning">
            <div class="card-body py-3">
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                  <small class="text-muted d-block mb-2">Configure delay duration with preset options and human-readable format.</small>
                  <button type="button" class="btn btn-sm btn-warning" onclick="showDelayEditor(${index}, currentWorkflow.steps[${index}], currentWorkflow)">
                    <i class="bi bi-clock me-1"></i>Configure Delay
                  </button>
                </div>
                <div style="padding: 10px; background-color: #f8f9fa; border-radius: 4px;">
                  <small><strong>Duration:</strong></small>
                  <div class="text-monospace" style="font-size: 9px; margin-top: 5px;">
                    <span style="color: #666;">${step.config?.duration || 5000} ms</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- Hidden input for data binding -->
          <input type="hidden" class="form-control" data-field="config.duration" data-step="${index}"
                 value="${step.config?.duration || 5000}">
        </div>
      `;
      break;

    case 'transform':
      formHTML += `
        <div class="mb-3">
          <label class="form-label">Transform Script (JavaScript)</label>
          <div class="card border-info">
            <div class="card-body py-3">
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <div class="alert alert-info mb-0" style="font-size: 0.9em;">
                  <i class="bi bi-info-circle me-2"></i>
                  <strong>Professional Code Editor</strong> - Use the enhanced editor below for syntax highlighting,
                  autocomplete, testing, and test case management.
                </div>

                <!-- Quick Preview of Script -->
                <div>
                  <label class="form-label mb-2" style="font-size: 0.9em;">Current Script Preview:</label>
                  <pre id="transformScriptPreview_${index}" class="bg-light p-2 rounded mb-0 small" style="font-size: 8px; max-height: 100px; overflow-y: auto; border: 1px solid #dee2e6;">
${step.config.script || 'return input;'}
                  </pre>
                </div>

                <!-- Open Editor Button -->
                <button type="button" class="btn btn-info w-100"
                        onclick="showTransformEditor(${index}, currentWorkflow.steps[${index}], currentWorkflow)">
                  <i class="bi bi-code-square me-2"></i>Open Advanced Editor
                </button>

                <small class="text-muted d-block">
                  Opens a full-featured code editor with syntax highlighting, error detection, context variable
                  autocomplete, and built-in testing capabilities. You can also save and reuse test cases.
                </small>
              </div>
            </div>
          </div>

          <!-- Hidden textarea to store actual script value -->
          <textarea id="transformScript_${index}" class="d-none" data-field="config.script">${step.config.script}</textarea>
        </div>
      `;
      break;

    case 'conditional':
      formHTML += `
        <div class="mb-3">
          <label class="form-label">Conditional Branching</label>
          <div class="card border-info">
            <div class="card-body py-3">
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                  <small class="text-muted d-block mb-2">Configure condition expression and branch execution.</small>
                  <button type="button" class="btn btn-sm btn-primary" onclick="showConditionalEditor(${index}, currentWorkflow.steps[${index}], currentWorkflow)">
                    <i class="bi bi-question-circle me-1"></i>Open Conditional Editor
                  </button>
                </div>
                <div style="padding: 10px; background-color: #f8f9fa; border-radius: 4px;">
                  <small><strong>Condition:</strong></small>
                  <div class="text-monospace" style="font-size: 9px; max-height: 100px; overflow-y: auto;">
                    <code>${step.config?.condition || '(not configured)'}</code>
                  </div>
                </div>
                ${step.config?.trueBranch ? `
                  <div style="padding: 8px; background-color: #e8f5e9; border-radius: 4px; border-left: 3px solid #4caf50;">
                    <small><strong style="color: #2e7d32;">✓ If TRUE:</strong></small>
                    <div style="font-size: 9px;">${currentWorkflow.steps.find(s => s.id === step.config.trueBranch)?.name || 'Unknown'}</div>
                  </div>
                ` : ''}
                ${step.config?.falseBranch ? `
                  <div style="padding: 8px; background-color: #ffebee; border-radius: 4px; border-left: 3px solid #f44336;">
                    <small><strong style="color: #c62828;">✗ If FALSE:</strong></small>
                    <div style="font-size: 9px;">${currentWorkflow.steps.find(s => s.id === step.config.falseBranch)?.name || 'Unknown'}</div>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
          <!-- Hidden textarea for data binding -->
          <textarea class="form-control" data-field="config.condition" data-step="${index}"
                    style="display: none;">${step.config?.condition || ''}</textarea>
        </div>
      `;
      break;

    case 'api':
      formHTML += `
        <div class="mb-3">
          <label class="form-label">API Configuration</label>
          <div class="card border-primary">
            <div class="card-body py-3">
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <div class="alert alert-info mb-0" style="font-size: 0.9em;">
                  <i class="bi bi-info-circle me-2"></i>
                  <strong>Professional API Configuration</strong> - Use the advanced editor below for
                  URL configuration, authentication, headers, request body, and built-in API testing.
                </div>

                <!-- Quick Configuration Preview -->
                <div class="row g-2">
                  <div class="col-md-6">
                    <label class="form-label mb-2" style="font-size: 0.9em;">Method:</label>
                    <div class="alert alert-light mb-0" style="padding: 8px 12px; font-size: 0.9em;">
                      <span class="badge bg-info">${step.config.method || 'GET'}</span>
                    </div>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label mb-2" style="font-size: 0.9em;">Endpoint:</label>
                    <div class="alert alert-light mb-0" style="padding: 8px 12px; font-size: 0.85em; overflow: hidden; text-overflow: ellipsis;">
                      <code style="font-size: 0.8em;">${step.config.endpoint || '(not set)'}</code>
                    </div>
                  </div>
                </div>

                <!-- Open Editor Button -->
                <button type="button" class="btn btn-primary w-100"
                        onclick="showAPIEditor(${index}, currentWorkflow.steps[${index}], currentWorkflow)">
                  <i class="bi bi-globe me-2"></i>Open API Configuration Editor
                </button>

                <small class="text-muted d-block">
                  Opens a full-featured API editor with URL variable interpolation, authentication support
                  (Basic, Bearer, API Key), custom headers, JSON body editing, and built-in request testing
                  with response visualization and timing information.
                </small>
              </div>
            </div>
          </div>
        </div>

        <!-- Hidden fields to store actual values -->
        <textarea id="apiEndpoint_${index}" class="d-none" data-field="config.endpoint">${step.config.endpoint || ''}</textarea>
        <textarea id="apiMethod_${index}" class="d-none" data-field="config.method">${step.config.method || 'GET'}</textarea>
        <textarea id="apiHeaders_${index}" class="d-none" data-field="config.headers">${JSON.stringify(step.config.headers || {})}</textarea>
        <textarea id="apiBody_${index}" class="d-none" data-field="config.body">${JSON.stringify(step.config.body || {})}</textarea>
      `;
      break;

    case 'parallel':
      formHTML += `
        <div class="mb-3">
          <label class="form-label">Parallel Branches</label>
          <div class="card border-info">
            <div class="card-body py-3">
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                  <small class="text-muted d-block mb-2">Configure parallel branches and failure handling strategy.</small>
                  <button type="button" class="btn btn-sm btn-info" onclick="showParallelEditor(${index}, currentWorkflow.steps[${index}], currentWorkflow)">
                    <i class="bi bi-diagram-2 me-1"></i>Configure Branches
                  </button>
                </div>
                ${step.config?.steps && step.config.steps.length > 0 ? `
                <div style="padding: 10px; background-color: #f8f9fa; border-radius: 4px;">
                  <small><strong>Branches:</strong></small>
                  <div style="font-size: 9px; margin-top: 5px;">
                    ${step.config.steps.map((b, i) => `<div><i class="bi bi-arrow-right"></i> ${b.name || '(unnamed)'}</div>`).join('')}
                  </div>
                </div>
                <div style="padding: 8px; background-color: #f0f0f0; border-radius: 4px; border-left: 3px solid ${step.config?.failFast !== false ? '#dc3545' : '#28a745'};">
                  <small><strong>${step.config?.failFast !== false ? '🛑 Fail Fast' : '✓ Continue on Error'}</strong></small>
                </div>
                ` : `
                <div style="padding: 10px; background-color: #e3f2fd; border-radius: 4px;">
                  <small style="color: #1976d2;"><i class="bi bi-info-circle me-1"></i>No branches configured yet</small>
                </div>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
      break;

    case 'identity':
      formHTML += `
        <div class="mb-3">
          <label class="form-label">Identity Step</label>
          <div class="card border-success">
            <div class="card-body py-3">
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                  <small class="text-muted d-block mb-2">Add documentation for this pass-through checkpoint.</small>
                  <button type="button" class="btn btn-sm btn-success" onclick="showIdentityEditor(${index}, currentWorkflow.steps[${index}], currentWorkflow)">
                    <i class="bi bi-arrow-right me-1"></i>Configure Description
                  </button>
                </div>
                ${step.config?.description ? `
                <div style="padding: 10px; background-color: #f8f9fa; border-radius: 4px;">
                  <small><strong>Description:</strong></small>
                  <div style="font-size: 9px; margin-top: 5px; color: #666;">
                    ${step.config.description.substring(0, 100)}${step.config.description.length > 100 ? '...' : ''}
                  </div>
                </div>
                ` : `
                <div style="padding: 10px; background-color: #e8f5e9; border-radius: 4px;">
                  <small style="color: #2e7d32;"><i class="bi bi-info-circle me-1"></i>No description added</small>
                </div>
                `}
              </div>
            </div>
          </div>
          <!-- Hidden textarea for data binding -->
          <textarea class="form-control" data-field="config.description" data-step="${index}"
                    style="display: none;">${step.config?.description || ''}</textarea>
        </div>
      `;
      break;
  }

  return formHTML;
}

/**
 * Update step configuration from form input
 */
function updateStepConfig(stepIndex, inputElement) {
  const field = inputElement.dataset.field;
  let value = inputElement.value;

  // Handle checkbox
  if (inputElement.type === 'checkbox') {
    value = inputElement.checked;
  }

  // Handle number fields
  if (inputElement.type === 'number') {
    value = parseInt(value) || 0;
  }

  // Parse JSON for specific fields
  if (field === 'config.headers' || field === 'config.body') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      // Invalid JSON - show error and don't update
      inputElement.classList.add('is-invalid');
      return;
    }
    // Clear invalid state if it was valid
    inputElement.classList.remove('is-invalid');
  }

  // Handle nested fields (e.g., "config.duration")
  const parts = field.split('.');
  let target = currentWorkflow.steps[stepIndex];

  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) {
      target[parts[i]] = {};
    }
    target = target[parts[i]];
  }

  target[parts[parts.length - 1]] = value;
  isDirty = true;

  // Update retry preview if retry field changed
  if (field.startsWith('retry.')) {
    updateRetryPreview(stepIndex);
  }
}

/**
 * Toggle retry configuration visibility
 */
window.toggleRetryConfig = function(stepIndex, enabled) {
  const configDiv = document.getElementById(`retryConfig_${stepIndex}`);
  if (configDiv) {
    configDiv.style.display = enabled ? 'block' : 'none';
  }

  // Update step data
  if (currentWorkflow.steps[stepIndex]) {
    currentWorkflow.steps[stepIndex].retry.enabled = enabled;
    isDirty = true;
  }

  // Update preview
  if (enabled) {
    setTimeout(() => updateRetryPreview(stepIndex), 100);
  }
};

/**
 * Calculate and display retry schedule preview
 */
function updateRetryPreview(stepIndex) {
  const step = currentWorkflow.steps[stepIndex];
  if (!step || !step.retry || !step.retry.enabled) return;

  const { maxAttempts, delayMs, backoffStrategy, maxDelayMs } = step.retry;
  const previewDiv = document.getElementById(`retrySchedulePreview_${stepIndex}`);

  if (!previewDiv) return;

  let schedule = [`Attempt 1: Immediate (initial execution)`];
  let cumulativeTime = 0;

  for (let i = 1; i < maxAttempts; i++) {
    let delay;
    switch (backoffStrategy) {
      case 'none':
        delay = delayMs;
        break;
      case 'linear':
        delay = delayMs * i;
        break;
      case 'exponential':
        delay = delayMs * Math.pow(2, i - 1);
        break;
      default:
        delay = delayMs;
    }

    delay = Math.min(delay, maxDelayMs);
    cumulativeTime += delay;

    const delayFormatted = delay < 1000 ? `${delay}ms` : `${(delay / 1000).toFixed(1)}s`;
    const totalFormatted = cumulativeTime < 1000 ? `${cumulativeTime}ms` : `${(cumulativeTime / 1000).toFixed(1)}s`;

    schedule.push(`Attempt ${i + 1}: After ${delayFormatted} (total wait: ${totalFormatted})`);
  }

  previewDiv.innerHTML = schedule.map(s => `<div>${s}</div>`).join('');
}

/**
 * Delete step
 */
function deleteStep(index) {
  if (!confirm(`Delete step "${currentWorkflow.steps[index].name}"?`)) {
    return;
  }

  currentWorkflow.steps.splice(index, 1);
  isDirty = true;
  renderSteps();
}

/**
 * Populate workflow groups dropdown
 */
async function populateGroupsDropdown(selectedGroup = null) {
  try {
    const response = await window.apiCall('/api/workflows/groups');
    const result = await response.json();
    const groups = result.data || [];

    const dropdown = document.getElementById('workflowGroup');
    if (!dropdown) return;

    // Clear existing options (keep the first placeholder)
    while (dropdown.options.length > 1) {
      dropdown.remove(1);
    }

    // Add "Create New" option
    const createNewOption = document.createElement('option');
    createNewOption.value = '__CREATE_NEW__';
    createNewOption.textContent = '+ Create New Group';
    dropdown.appendChild(createNewOption);

    // Add divider
    const divider = document.createElement('option');
    divider.disabled = true;
    divider.textContent = '──────────';
    dropdown.appendChild(divider);

    // Add existing groups
    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group;
      option.textContent = group;
      if (selectedGroup === group) {
        option.selected = true;
      }
      dropdown.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to load workflow groups:', error);
  }
}

/**
 * Save workflow
 */
async function saveWorkflow(isEditing, workflowId) {
  try {
    // Gather form data
    const name = document.getElementById('workflowName').value.trim();
    const description = document.getElementById('workflowDescription').value.trim();
    const tagsInput = document.getElementById('workflowTags').value.trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

    // Get group value
    const groupSelect = document.getElementById('workflowGroup').value;
    const group = groupSelect === '__CREATE_NEW__'
      ? document.getElementById('workflowGroupNew').value.trim()
      : groupSelect;

    // Parse default input JSON
    let defaultInput = {};
    const jsonInput = document.getElementById('workflowDefaultInput');
    if (jsonInput) {
      const jsonText = jsonInput.value.trim();
      if (jsonText) {
        try {
          defaultInput = JSON.parse(jsonText);
        } catch (error) {
          ui.showToast({
            message: 'Invalid JSON in Default Input field: ' + error.message,
            type: 'danger'
          });
          return;
        }
      }
    }

    // Client-side validation
    const errors = [];

    if (!name) {
      errors.push('Workflow name is required');
    }
    if (name.length > 100) {
      errors.push('Workflow name must be 100 characters or less');
    }
    if (description.length > 500) {
      errors.push('Description must be 500 characters or less');
    }
    if (currentWorkflow.steps.length === 0) {
      errors.push('At least one step is required');
    }
    if (!group) {
      errors.push('Group is required');
    }

    if (errors.length > 0) {
      const errorMsg = errors.join('\n');
      ui.showToast({
        message: 'Validation Error:\n' + errorMsg,
        type: 'danger'
      });
      return;
    }

    // Show loading state
    const saveBtn = document.getElementById('saveWorkflowBtn');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

    // Prepare request
    // Only include steps when creating a new workflow
    // When editing, only update metadata (name, description, tags, defaultInput)
    const workflowData = {
      name,
      description,
      tags,
      defaultInput,
      group  // Include group for both create and edit
    };

    // Only add steps for new workflows, not for edits
    if (!isEditing) {
      workflowData.steps = currentWorkflow.steps;
    }

    const url = isEditing ? `/api/workflows/${workflowId}` : '/api/workflows';
    const method = isEditing ? 'PUT' : 'POST';

    // Save to backend
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflowData)
    });

    const result = await response.json();

    // Restore button
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalText;

    if (!result.success) {
      ui.showToast({ message: result.error || 'Failed to save workflow', type: 'danger' });
      return;
    }

    // Success
    ui.showToast({
      message: isEditing ? 'Workflow updated successfully!' : 'Workflow created successfully!',
      type: 'success'
    });

    isDirty = false;
    clearAutoSave();

    // Navigate back to list after a brief delay
    setTimeout(() => {
      renderWorkflowsListDashboard();
    }, 1200);

  } catch (error) {
    ui.showToast({ message: 'Error saving workflow: ' + error.message, type: 'danger' });

    // Restore button
    const saveBtn = document.getElementById('saveWorkflowBtn');
    saveBtn.disabled = false;
    const isEditing = saveBtn.innerHTML.includes('Update');
    saveBtn.innerHTML = `<i class="bi bi-check-lg"></i> ${isEditing ? 'Update' : 'Create'} Workflow`;
  }
}

/**
 * Show modal to add a new step
 */
function showAddStepModal(workflowId) {
  let modal = document.getElementById('addStepModal');

  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'addStepModal';
    modal.tabIndex = -1;
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-plus-lg me-2"></i>Add New Step</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Step File Name <span class="text-danger">*</span></label>
              <div class="input-group">
                <input type="text" class="form-control" id="stepFileName" placeholder="e.g., transform" value="">
                <span class="input-group-text">.js</span>
              </div>
              <small class="text-muted">Enter a name for the step file (letters, numbers, hyphens, underscores only)</small>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-secondary" id="createStepBtn" onclick="createNewStep('${workflowId}')">
              <i class="bi bi-plus-lg me-1"></i>Create Step
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Clear and focus input
  document.getElementById('stepFileName').value = '';
  document.getElementById('stepFileName').focus();

  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
}

/**
 * Create a new workflow step
 */
async function createNewStep(workflowId) {
  const fileNameInput = document.getElementById('stepFileName');
  const fileName = fileNameInput.value.trim();

  if (!fileName) {
    if (window.ui) {
      window.ui.showToast({ message: 'Please enter a step file name', type: 'warning' });
    }
    return;
  }

  // Validate file name (only letters, numbers, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(fileName)) {
    if (window.ui) {
      window.ui.showToast({ message: 'Step file name can only contain letters, numbers, hyphens, and underscores', type: 'danger' });
    }
    return;
  }

  try {
    // Default code template
    const defaultCode = `/**
 * @fileoverview Example worker task for testing worker thread functionality.
 */

'use strict';

const serviceRegistry = require('nooblyjs-core');

async function run(data) {
  // Get logger from service registry
  const logger = serviceRegistry.logger();

  logger.info('Step started with data:', data);

  const result = {
    'message': 'Step completed successfully!',
    'receivedData': data,
    'processedAt': new Date().toISOString()
  };

  return result;
}

module.exports = {
  run,
};`;

    // Create the step file
    const response = await window.apiCall(`/api/workflows/${workflowId}/step-file-content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stepFileName: fileName,
        content: defaultCode,
        isNew: true
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to create step');
    }

    if (window.ui) {
      window.ui.showToast({ message: 'Step created successfully!', type: 'success' });
    }

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('addStepModal'));
    modal.hide();

    // Refresh the workflow to load the new step
    await renderWorkflowEditEditor(workflowId);

  } catch (error) {
    console.error('Error creating step:', error);
    if (window.ui) {
      window.ui.showToast({ message: 'Failed to create step: ' + error.message, type: 'danger' });
    }
  }
}

/**
 * Setup auto-save
 */
function setupAutoSave() {
  clearAutoSave();

  autoSaveInterval = setInterval(() => {
    // Auto-save logic would go here
    // For now, we just track the dirty state
  }, 30000); // 30 seconds
}

/**
 * Clear auto-save interval
 */
function clearAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

/**
 * Export workflow as JSON file download
 */
async function exportWorkflow(workflowId) {
  try {
    const response = await window.apiCall(`/api/workflows/${workflowId}/export`);

    if (!response.ok) {
      throw new Error('Failed to export workflow');
    }

    const data = await response.json();

    // Create blob and trigger download
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `workflow-${data.workflow.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    ui.showToast({ message: 'Workflow exported successfully', type: 'success' });
  } catch (error) {
    console.error('Error exporting workflow:', error);
    ui.showToast({ message: 'Failed to export workflow: ' + error.message, type: 'danger' });
  }
}

/**
 * Show execute workflow modal
 */
/**
 * Execute workflow directly without modal
 * Uses the workflow's defaultInput
 */
async function executeWorkflowDirectly(workflowId) {
  try {
    // Show loading toast
    if (window.ui && window.ui.showToast) {
      window.ui.showToast({
        message: 'Executing workflow...',
        type: 'info',
        duration: 2000
      });
    }

    // Execute the workflow
    const response = await window.apiCall(`/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const result = await response.json();

    if (result.success) {
      if (window.ui && window.ui.showToast) {
        window.ui.showToast({
          message: 'Workflow executed successfully!',
          type: 'success',
          duration: 3000
        });
      }
    } else {
      if (window.ui && window.ui.showToast) {
        window.ui.showToast({
          message: result.error || 'Failed to execute workflow',
          type: 'danger'
        });
      }
    }
  } catch (error) {
    console.error('Error executing workflow:', error);
    if (window.ui && window.ui.showToast) {
      window.ui.showToast({
        message: 'Error executing workflow: ' + error.message,
        type: 'danger'
      });
    }
  }
}

function showExecuteModal(workflowId) {
  let modal = document.getElementById('executeWorkflowModal');

  if (!modal) {
    modal = createExecuteModal();
    document.body.appendChild(modal);
  }

  // Store workflow ID for later use
  modal.dataset.workflowId = workflowId;

  // Reset the modal
  document.getElementById('executeInputData').value = '{}';
  document.getElementById('executionResultContainer').style.display = 'none';
  document.getElementById('executionResultContainer').innerHTML = '';
  document.getElementById('runWorkflowBtn').disabled = false;
  document.getElementById('runWorkflowBtn').innerHTML = '<i class="bi bi-play-fill me-1"></i>Run Workflow';

  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
}

/**
 * Create execute modal HTML
 */
function createExecuteModal() {
  const modal = document.createElement('div');
  modal.className = 'modal fade';
  modal.id = 'executeWorkflowModal';
  modal.tabIndex = -1;
  modal.innerHTML = `
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header bg-success text-white">
          <h5 class="modal-title"><i class="bi bi-play-circle me-2"></i>Execute Workflow</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label class="form-label">Input Data (JSON)</label>
            <textarea class="form-control font-monospace" id="executeInputData" rows="8" placeholder='{"key": "value"}'>{}</textarea>
            <small class="text-muted">Provide input data for the workflow execution as JSON</small>
          </div>

          <div id="executionResultContainer" style="display: none;">
            <!-- Results will be rendered here -->
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          <button type="button" class="btn btn-success" id="runWorkflowBtn">
            <i class="bi bi-play-fill me-1"></i>Run Workflow
          </button>
        </div>
      </div>
    </div>
  `;

  // Add event listener for run button
  setTimeout(() => {
    document.getElementById('runWorkflowBtn').addEventListener('click', executeWorkflowFromModal);
  }, 0);

  return modal;
}

/**
 * Execute workflow from modal
 */
async function executeWorkflowFromModal() {
  const modal = document.getElementById('executeWorkflowModal');
  const workflowId = modal.dataset.workflowId;
  const inputDataStr = document.getElementById('executeInputData').value;
  const runBtn = document.getElementById('runWorkflowBtn');
  const resultContainer = document.getElementById('executionResultContainer');

  // Validate JSON
  let inputData;
  try {
    inputData = JSON.parse(inputDataStr);
  } catch (e) {
    ui.showToast({ message: 'Invalid JSON input: ' + e.message, type: 'danger' });
    return;
  }

  // Show loading state
  runBtn.disabled = true;
  runBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Executing...';

  // Show progress in result container
  resultContainer.style.display = 'block';
  resultContainer.innerHTML = `
    <div class="alert alert-info mb-0">
      <div class="d-flex align-items-center">
        <span class="spinner-border spinner-border-sm me-2"></span>
        <span>Executing workflow...</span>
      </div>
    </div>
  `;

  try {
    const response = await window.apiCall(`/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: inputData })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Execution failed');
    }

    // Show success result
    renderExecutionResult(result.data);
    ui.showToast({ message: 'Workflow executed successfully!', type: 'success' });

  } catch (error) {
    console.error('Execution error:', error);
    resultContainer.innerHTML = `
      <div class="alert alert-danger mb-0">
        <h6 class="alert-heading"><i class="bi bi-x-circle me-2"></i>Execution Failed</h6>
        <p class="mb-0">${error.message}</p>
      </div>
    `;
    ui.showToast({ message: 'Workflow execution failed', type: 'danger' });
  } finally {
    runBtn.disabled = false;
    runBtn.innerHTML = '<i class="bi bi-play-fill me-1"></i>Run Again';
  }
}

/**
 * Render execution result in modal
 */
function renderExecutionResult(execution) {
  const container = document.getElementById('executionResultContainer');
  const duration = execution.completedAt && execution.startedAt
    ? new Date(execution.completedAt) - new Date(execution.startedAt)
    : 0;

  // Show toast notification for execution result
  if (execution.outcome === 'failed') {
    ui.showToast({
      message: `Workflow execution failed: ${execution.error || 'Unknown error'}`,
      type: 'danger',
      duration: 5000
    });
  } else if (execution.outcome === 'success') {
    ui.showToast({
      message: 'Workflow executed successfully!',
      type: 'success',
      duration: 3000
    });
  }

  const outcomeClass = execution.outcome === 'success' ? 'success' : 'danger';
  const outcomeIcon = execution.outcome === 'success' ? 'check-circle' : 'x-circle';

  container.innerHTML = `
    <div class="card border-${outcomeClass}">
      <div class="card-header bg-${outcomeClass} text-white">
        <i class="bi bi-${outcomeIcon} me-2"></i>
        Execution ${execution.outcome === 'success' ? 'Completed' : 'Failed'}
      </div>
      <div class="card-body">
        <div class="row mb-3">
          <div class="col-md-4">
            <small class="text-muted d-block">Execution ID</small>
            <code class="small">${execution.id}</code>
          </div>
          <div class="col-md-4">
            <small class="text-muted d-block">Duration</small>
            <strong>${formatDuration(duration)}</strong>
          </div>
          <div class="col-md-4">
            <small class="text-muted d-block">Steps Executed</small>
            <strong>${execution.steps ? execution.steps.length : 0}</strong>
          </div>
        </div>

        ${execution.steps && execution.steps.length > 0 ? `
          <h6 class="mb-2">Step Results</h6>
          <div class="list-group mb-3">
            ${execution.steps.map((step, index) => `
              <div class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                  <span class="badge bg-secondary me-2">${index + 1}</span>
                  ${step.stepName}
                </div>
                <span class="badge ${step.status === 'completed' ? 'bg-success' : 'bg-danger'}">
                  ${step.status}
                </span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${execution.error ? `
          <div class="alert alert-danger mb-3">
            <h6 class="alert-heading">Error</h6>
            <p class="mb-0 small">${execution.error}</p>
          </div>
        ` : ''}

        <div class="accordion" id="executionResultAccordion">
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#outputData">
                <i class="bi bi-code-square me-2"></i>Output Data
              </button>
            </h2>
            <div id="outputData" class="accordion-collapse collapse" data-bs-parent="#executionResultAccordion">
              <div class="accordion-body">
                <pre class="mb-0 p-2 bg-light rounded" style="max-height: 300px; overflow: auto;"><code>${JSON.stringify(execution.result || {}, null, 2)}</code></pre>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3">
          <button class="btn btn-sm btn-outline-primary" onclick="downloadExecutionResult('${execution.id}')">
            <i class="bi bi-download me-1"></i>Download Result
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

/**
 * Download execution result as JSON
 */
async function downloadExecutionResult(executionId) {
  try {
    const response = await window.apiCall(`/api/executions/${executionId}`);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error);
    }

    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `execution-${executionId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    ui.showToast({ message: 'Execution result downloaded', type: 'success' });
  } catch (error) {
    ui.showToast({ message: 'Failed to download result: ' + error.message, type: 'danger' });
  }
}

/**
 * Show schedule workflow inline panel
 */
function showScheduleModal(workflowId) {
  let panel = document.getElementById('scheduleWorkflowPanel');

  if (!panel) {
    panel = createScheduleModal();
    mainContent.appendChild(panel);
  }

  // Store workflow ID for later use
  panel.dataset.workflowId = workflowId;

  // Reset the panel
  document.getElementById('scheduleName').value = '';
  document.getElementById('scheduleDescription').value = '';
  document.getElementById('scheduleType').value = 'cron';
  document.getElementById('cronExpression').value = '0 2 * * *';
  document.getElementById('intervalInput').value = '3600000';
  document.getElementById('scheduleInputData').value = '{}';
  document.getElementById('scheduleInputData').disabled = false;
  document.getElementById('scheduleListContainer').innerHTML = '';
  document.getElementById('createScheduleBtn').disabled = false;
  document.getElementById('createScheduleBtn').innerHTML = '<i class="bi bi-plus-lg me-1"></i>Create Schedule';

  // Show the panel
  panel.style.display = 'block';

  // Load existing schedules
  loadSchedulesList(workflowId);
  updateCronDescription();

  // Scroll to panel
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Create schedule inline panel HTML
 */
function createScheduleModal() {
  const panel = document.createElement('div');
  panel.id = 'scheduleWorkflowPanel';
  panel.style.display = 'none';
  panel.className = 'card border-0 shadow-sm mb-4';
  panel.innerHTML = `
    <div class="card-header bg-warning text-dark d-flex justify-content-between align-items-center">
      <h5 class="mb-0"><i class="bi bi-clock me-2"></i>Schedule Workflow</h5>
      <button type="button" class="btn btn-sm btn-close" onclick="closeSchedulePanel()"></button>
    </div>
    <div class="card-body">
      <!-- Create Schedule Section -->
      <div class="card mb-4 border-0 bg-light">
        <div class="card-header bg-transparent border-bottom">
          <h6 class="mb-0">Create New Schedule</h6>
        </div>
        <div class="card-body">
          <div class="mb-3">
            <label class="form-label">Schedule Name <span class="text-danger">*</span></label>
            <input type="text" class="form-control" id="scheduleName" placeholder="e.g., Daily Report" required>
          </div>

          <div class="mb-3">
            <label class="form-label">Description</label>
            <textarea class="form-control" id="scheduleDescription" rows="2" placeholder="Optional description"></textarea>
          </div>

          <div class="mb-3">
            <label class="form-label">Schedule Type <span class="text-danger">*</span></label>
            <select class="form-select" id="scheduleType" onchange="updateScheduleTypeUI()" style="width: 150px;">
              <option value="cron">Cron Expression</option>
              <option value="interval">Interval (milliseconds)</option>
              <option value="preset">Preset</option>
            </select>
          </div>

          <!-- Cron Expression Input -->
          <div id="cronSection" class="mb-3">
            <label class="form-label">Cron Expression</label>
            <input type="text" class="form-control font-monospace" id="cronExpression" placeholder="0 2 * * *" onchange="updateCronDescription()">
            <small class="text-muted d-block mt-2">
              Format: <code>minute hour day month day-of-week</code><br>
              Examples: <code>0 2 * * *</code> (daily at 2 AM), <code>0 * * * *</code> (every hour)
            </small>
            <div id="cronDescription" class="alert alert-info mt-2 mb-0" style="display: none;"></div>
          </div>

          <!-- Interval Input -->
          <div id="intervalSection" class="mb-3" style="display: none;">
            <label class="form-label">Interval (milliseconds)</label>
            <input type="number" class="form-control" id="intervalInput" placeholder="3600000" value="3600000" min="1000">
            <small class="text-muted">
              1000 = 1 second, 60000 = 1 minute, 3600000 = 1 hour
            </small>
          </div>

          <!-- Preset Selection -->
          <div id="presetSection" style="display: none;">
            <label class="form-label">Select Preset</label>
            <div class="btn-group-vertical w-100" role="group">
              <input type="radio" class="btn-check" name="preset" id="presetHourly" value="0 * * * *" onchange="applyPreset()">
              <label class="btn btn-outline-primary text-start" for="presetHourly">
                <strong>Hourly</strong> <small class="d-block text-muted">Every hour at minute 0</small>
              </label>

              <input type="radio" class="btn-check" name="preset" id="presetDaily" value="0 2 * * *" checked onchange="applyPreset()">
              <label class="btn btn-outline-primary text-start" for="presetDaily">
                <strong>Daily</strong> <small class="d-block text-muted">Every day at 2:00 AM</small>
              </label>

              <input type="radio" class="btn-check" name="preset" id="presetWeekly" value="0 2 * * 1" onchange="applyPreset()">
              <label class="btn btn-outline-primary text-start" for="presetWeekly">
                <strong>Weekly</strong> <small class="d-block text-muted">Every Monday at 2:00 AM</small>
              </label>

              <input type="radio" class="btn-check" name="preset" id="presetMonthly" value="0 2 1 * *" onchange="applyPreset()">
              <label class="btn btn-outline-primary text-start" for="presetMonthly">
                <strong>Monthly</strong> <small class="d-block text-muted">1st day of month at 2:00 AM</small>
              </label>
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label">Input Data (JSON)</label>
            <textarea class="form-control font-monospace" id="scheduleInputData" rows="4" placeholder='{}' oninput="validateJSON(this)">{}</textarea>
            <small class="text-muted">Data to pass to the workflow each execution</small>
          </div>

          <div class="d-flex gap-2">
            <button class="btn btn-warning flex-grow-1" id="createScheduleBtn">
              <i class="bi bi-plus-lg me-1"></i>Create Schedule
            </button>
            <button type="button" class="btn btn-secondary" onclick="closeSchedulePanel()">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Existing Schedules Section -->
      <div class="card border-0">
        <div class="card-header bg-transparent border-bottom">
          <h6 class="mb-0">Existing Schedules</h6>
        </div>
        <div class="card-body p-0">
          <div id="scheduleListContainer" class="list-group list-group-flush">
            <div class="text-center text-muted py-3">
              <small>Loading schedules...</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add event listeners
  setTimeout(() => {
    document.getElementById('createScheduleBtn').addEventListener('click', createNewSchedule);
    document.getElementById('scheduleType').addEventListener('change', updateScheduleTypeUI);
    document.getElementById('cronExpression').addEventListener('change', updateCronDescription);
  }, 0);

  return panel;
}

/**
 * Close schedule panel
 */
window.closeSchedulePanel = function() {
  const panel = document.getElementById('scheduleWorkflowPanel');
  if (panel) {
    panel.style.display = 'none';
  }
}

/**
 * Update schedule type UI visibility
 */
window.updateScheduleTypeUI = function() {
  const type = document.getElementById('scheduleType').value;
  document.getElementById('cronSection').style.display = type === 'cron' ? 'block' : 'none';
  document.getElementById('intervalSection').style.display = type === 'interval' ? 'block' : 'none';
  document.getElementById('presetSection').style.display = type === 'preset' ? 'block' : 'none';
};

/**
 * Apply preset cron expression
 */
window.applyPreset = function() {
  const preset = document.querySelector('input[name="preset"]:checked');
  if (preset) {
    document.getElementById('cronExpression').value = preset.value;
    document.getElementById('scheduleType').value = 'cron';
    updateScheduleTypeUI();
    updateCronDescription();
  }
};

/**
 * Validate JSON input
 */
window.validateJSON = function(el) {
  try {
    JSON.parse(el.value);
    el.classList.remove('is-invalid');
    el.classList.add('is-valid');
  } catch (e) {
    el.classList.remove('is-valid');
    el.classList.add('is-invalid');
  }
};

/**
 * Update cron description
 */
window.updateCronDescription = function() {
  const cronExpr = document.getElementById('cronExpression').value;
  const description = describeCronExpression(cronExpr);
  const descEl = document.getElementById('cronDescription');
  if (description) {
    descEl.innerHTML = `<strong>Will run:</strong> ${description}`;
    descEl.style.display = 'block';
  } else {
    descEl.style.display = 'none';
  }
};

/**
 * Describe cron expression in human-readable format
 */
function describeCronExpression(cronExpr) {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const descriptions = [];

  // Time of day
  if (hour !== '*' && minute !== '*') {
    descriptions.push(`at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  } else if (hour !== '*') {
    descriptions.push(`every hour at minute ${minute}`);
  } else if (minute !== '*') {
    descriptions.push(`at ${minute} minutes past every hour`);
  }

  // Day/frequency
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (hour === '*' && minute === '*') return 'every minute';
    if (hour === '*') return 'every hour';
    return `every day ${descriptions[0] || ''}`.trim();
  } else if (dayOfWeek !== '*' && dayOfMonth === '*') {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayNum = parseInt(dayOfWeek);
    descriptions.push(`every ${dayNames[dayNum] || dayOfWeek}`);
  } else if (dayOfMonth !== '*') {
    descriptions.push(`on day ${dayOfMonth} of every month`);
  }

  return descriptions.join(' ');
}

/**
 * Create a new schedule
 */
async function createNewSchedule() {
  const panel = document.getElementById('scheduleWorkflowPanel');
  const workflowId = panel.dataset.workflowId;
  const name = document.getElementById('scheduleName').value.trim();
  const description = document.getElementById('scheduleDescription').value.trim();
  const type = document.getElementById('scheduleType').value;
  const inputDataStr = document.getElementById('scheduleInputData').value;
  const createBtn = document.getElementById('createScheduleBtn');

  // Validation
  if (!name) {
    ui.showToast({ message: 'Schedule name is required', type: 'danger' });
    return;
  }

  let cronExpression = null;
  let interval = null;

  if (type === 'cron' || type === 'preset') {
    cronExpression = document.getElementById('cronExpression').value;
    if (!cronExpression) {
      ui.showToast({ message: 'Cron expression is required', type: 'danger' });
      return;
    }
  } else if (type === 'interval') {
    interval = parseInt(document.getElementById('intervalInput').value);
    if (!interval || interval < 1000) {
      ui.showToast({ message: 'Interval must be at least 1000 milliseconds', type: 'danger' });
      return;
    }
  }

  // Validate JSON
  let inputData;
  try {
    inputData = JSON.parse(inputDataStr);
  } catch (e) {
    ui.showToast({ message: 'Invalid JSON input: ' + e.message, type: 'danger' });
    return;
  }

  // Create schedule
  createBtn.disabled = true;
  createBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating...';

  try {
    const response = await window.apiCall(`/api/workflows/${workflowId}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        cronExpression,
        interval,
        input: inputData
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to create schedule');
    }

    ui.showToast({ message: 'Schedule created successfully!', type: 'success' });

    // Reset form
    document.getElementById('scheduleName').value = '';
    document.getElementById('scheduleDescription').value = '';
    document.getElementById('scheduleInputData').value = '{}';

    // Reload schedules
    loadSchedulesList(workflowId);

    // Close panel
    setTimeout(() => closeSchedulePanel(), 1500);

  } catch (error) {
    console.error('Error creating schedule:', error);
    ui.showToast({ message: 'Failed to create schedule: ' + error.message, type: 'danger' });
  } finally {
    createBtn.disabled = false;
    createBtn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Create Schedule';
  }
}

/**
 * Load schedules list for a workflow
 */
async function loadSchedulesList(workflowId) {
  try {
    const response = await window.apiCall(`/api/workflows/${workflowId}/schedules`);
    const result = await response.json();

    const container = document.getElementById('scheduleListContainer');

    if (result.success && result.data && result.data.length > 0) {
      container.innerHTML = result.data.map(schedule => `
        <div class="list-group-item">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="flex-grow-1">
              <h6 class="mb-1">${schedule.name}</h6>
              ${schedule.description ? `<p class="text-muted small mb-0">${schedule.description}</p>` : ''}
            </div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-sm btn-outline-secondary" onclick="toggleScheduleEnabled('${schedule.id}', ${!schedule.enabled})" title="${schedule.enabled ? 'Disable' : 'Enable'}">
                <i class="bi ${schedule.enabled ? 'bi-pause' : 'bi-play'} me-1"></i>${schedule.enabled ? 'Disable' : 'Enable'}
              </button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteSchedule('${schedule.id}', '${workflowId}')" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
          <small class="text-muted d-block">
            <strong>Type:</strong> ${schedule.cronExpression ? `Cron: ${schedule.cronExpression}` : `Interval: ${(schedule.interval / 1000).toFixed(0)}s`}
          </small>
          <small class="text-muted d-block">
            <strong>Next Run:</strong> ${new Date(schedule.nextRun).toLocaleString()}
          </small>
          ${schedule.lastRun ? `
            <small class="text-muted d-block">
              <strong>Last Run:</strong> ${new Date(schedule.lastRun).toLocaleString()} - ${schedule.lastResult || 'pending'}
            </small>
          ` : ''}
        </div>
      `).join('');
    } else {
      container.innerHTML = '<div class="text-center text-muted py-3"><small>No schedules created yet</small></div>';
    }
  } catch (error) {
    console.error('Error loading schedules:', error);
    document.getElementById('scheduleListContainer').innerHTML = '<div class="text-center text-danger py-3"><small>Failed to load schedules</small></div>';
  }
}

/**
 * Toggle schedule enabled/disabled
 */
window.toggleScheduleEnabled = async function(scheduleId, enabled) {
  try {
    const response = await window.apiCall(`/api/schedules/${scheduleId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error);
    }

    ui.showToast({ message: `Schedule ${enabled ? 'enabled' : 'disabled'}`, type: 'success' });

    // Reload schedules
    const modal = document.getElementById('scheduleWorkflowModal');
    const workflowId = modal.dataset.workflowId;
    loadSchedulesList(workflowId);

  } catch (error) {
    ui.showToast({ message: 'Failed to toggle schedule: ' + error.message, type: 'danger' });
  }
};

/**
 * Delete schedule
 */
window.deleteSchedule = async function(scheduleId, workflowId) {
  if (!confirm('Are you sure you want to delete this schedule?')) return;

  try {
    const response = await window.apiCall(`/api/schedules/${scheduleId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error);
    }

    ui.showToast({ message: 'Schedule deleted successfully', type: 'success' });
    loadSchedulesList(workflowId);

  } catch (error) {
    ui.showToast({ message: 'Failed to delete schedule: ' + error.message, type: 'danger' });
  }
};

// Export functions for use in app.js
window.renderWorkflowCreateEditor = renderWorkflowCreateEditor;
window.renderWorkflowEditEditor = renderWorkflowEditEditor;
window.exportWorkflow = exportWorkflow;
window.showExecuteModal = showExecuteModal;
window.downloadExecutionResult = downloadExecutionResult;
window.showScheduleModal = showScheduleModal;
window.showAddStepModal = showAddStepModal;
window.createNewStep = createNewStep;
