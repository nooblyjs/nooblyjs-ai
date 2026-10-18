/**
 * Transform Step Editor
 * Provides a professional code editor for JavaScript transforms with:
 * - CodeMirror syntax highlighting and line numbers
 * - Context variable autocomplete
 * - Transform testing with sample input
 * - Test case management and history
 */

class TransformEditor {
  constructor(stepIndex, step, currentWorkflow) {
    this.stepIndex = stepIndex;
    this.step = step;
    this.currentWorkflow = currentWorkflow;
    this.codeMirrorInstance = null;
    this.testCases = JSON.parse(localStorage.getItem(`transform-tests-${step.id}`) || '[]');
    this.lastTestResult = null;
  }

  /**
   * Initialize the transform editor with CodeMirror
   */
  initializeEditor(container) {
    // Create editor container
    const editorHTML = `
      <div class="transform-editor-container" style="display: flex; flex-direction: column; height: 100%; gap: 15px;">
        <!-- Code Editor Section -->
        <div class="code-editor-section" style="flex: 1; display: flex; flex-direction: column; min-height: 400px;">
          <div class="editor-header mb-2">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h6 class="mb-0">
                <i class="bi bi-code-square me-2"></i>Transform Script (JavaScript)
              </h6>
              <button type="button" class="btn btn-sm btn-info" id="transformFormatBtn" title="Format code">
                <i class="bi bi-arrow-repeat"></i> Format
              </button>
            </div>
            <small class="text-muted d-block mb-2">
              Write JavaScript code that receives 'input' parameter with workflow context.
              Return the transformed data. Context variables available:
              <code id="availableVars" style="font-size: 0.85em;">input</code>
            </small>
          </div>

          <div id="transformEditor" style="flex: 1; border: 1px solid #ddd; border-radius: 4px; overflow: hidden;"></div>

          <!-- Error Highlighting -->
          <div id="transformErrors" class="mt-2" style="display: none;"></div>
        </div>

        <!-- Testing Section -->
        <div class="testing-section card border-info">
          <div class="card-header bg-info bg-opacity-10">
            <h6 class="mb-0">
              <i class="bi bi-flask me-2"></i>Test Transform
            </h6>
          </div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 12px; max-height: 600px; overflow-y: auto;">

            <!-- Test Input -->
            <div>
              <label class="form-label mb-2">Test Input Data (JSON)</label>
              <textarea id="transformTestInput" class="form-control font-monospace" rows="4"
                        style="font-size: 12px;" placeholder='{}'></textarea>
              <small class="text-muted d-block mt-1">
                Provide sample input data as JSON. Available in script as 'input' parameter.
              </small>
            </div>

            <!-- Test Buttons -->
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-success" id="runTestBtn">
                <i class="bi bi-play-fill me-2"></i>Run Test
              </button>
              <button type="button" class="btn btn-secondary" id="saveTestBtn" title="Save current test case">
                <i class="bi bi-bookmark me-2"></i>Save Test Case
              </button>
              <button type="button" class="btn btn-outline-secondary" id="clearTestBtn">
                <i class="bi bi-trash me-2"></i>Clear
              </button>
            </div>

            <!-- Test Result -->
            <div id="testResultSection" style="display: none;">
              <hr>
              <h6>Test Result:</h6>
              <div class="alert" id="testResultAlert" style="margin-bottom: 0; max-height: 200px; overflow-y: auto;">
                <strong>Output:</strong>
                <pre id="testResultOutput" class="mb-0 mt-2" style="font-size: 11px; white-space: pre-wrap; word-break: break-word;"></pre>
              </div>
            </div>

            <!-- Saved Test Cases -->
            <div id="savedTestsSection" style="display: none;">
              <hr>
              <h6 class="mb-2">Saved Test Cases</h6>
              <div id="savedTestsList" style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">
                <!-- Test case items added here -->
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = editorHTML;

    // Initialize CodeMirror
    this.initializeCodeMirror();

    // Setup event listeners
    this.setupEventListeners();

    // Populate available context variables
    this.updateAvailableVariables();

    // Load saved test cases if any
    this.loadSavedTests();
  }

  /**
   * Initialize CodeMirror editor with syntax highlighting
   */
  initializeCodeMirror() {
    const editorContainer = document.getElementById('transformEditor');

    this.codeMirrorInstance = CodeMirror(editorContainer, {
      value: this.step.config.script || 'return input;',
      mode: 'javascript',
      theme: 'monokai',
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      indentWithTabs: false,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      styleActiveLine: true,
      highlightSelectionMatches: { showToken: /\w/, annotateScrollbar: true },
      extraKeys: {
        'Ctrl-Space': 'autocomplete',
        'Cmd-Space': 'autocomplete',
        'Ctrl-Enter': () => this.runTest(),
        'Cmd-Enter': () => this.runTest()
      }
    });

    // Add custom autocomplete hints for context variables
    this.setupAutocomplete();

    // Watch for changes and update step config
    this.codeMirrorInstance.on('change', () => {
      this.step.config.script = this.codeMirrorInstance.getValue();
      isDirty = true;
    });

    // Validate syntax on blur
    this.codeMirrorInstance.on('blur', () => {
      this.validateSyntax();
    });
  }

  /**
   * Setup autocomplete for context variables
   */
  setupAutocomplete() {
    const editor = this.codeMirrorInstance;

    // Override hint function for custom variables
    CodeMirror.registerHelper('hint', 'javascript', (editor) => {
      const cur = editor.getCursor();
      const token = editor.getTokenAt(cur);
      const line = editor.getLine(cur.line);
      const start = token.start;
      const end = cur.ch;
      const word = line.slice(start, end);

      // Get context variables from workflow
      const contextVars = this.getContextVariables();

      // Filter matching variables
      const matches = contextVars.filter(v => v.startsWith(word.toLowerCase()));

      if (matches.length === 0) return null;

      return {
        from: CodeMirror.Pos(cur.line, start),
        to: CodeMirror.Pos(cur.line, end),
        list: matches.map(m => ({
          text: m,
          className: 'autocomplete-variable',
          displayText: `${m} (from context)`
        }))
      };
    });

    // Enable autocomplete on input
    editor.on('inputRead', (instance) => {
      const cur = instance.getCursor();
      const token = instance.getTokenAt(cur);

      // Show hints when typing identifiers
      if (token.string && token.type === 'variable') {
        instance.showHint({ hint: CodeMirror.hint.javascript });
      }
    });
  }

  /**
   * Get context variables available from workflow
   */
  getContextVariables() {
    const vars = new Set(['input']);

    // Add all previous step outputs
    if (this.currentWorkflow && this.currentWorkflow.steps) {
      for (let i = 0; i < this.stepIndex; i++) {
        const prevStep = this.currentWorkflow.steps[i];
        if (prevStep && prevStep.name) {
          // Steps can be accessed by name as camelCase or original
          const camelCase = prevStep.name
            .toLowerCase()
            .replace(/\s+([a-z])/g, (_, char) => char.toUpperCase());
          vars.add(camelCase);
          vars.add(prevStep.name.toLowerCase());
        }
      }
    }

    // Always available variables
    vars.add('Math');
    vars.add('JSON');
    vars.add('Date');
    vars.add('String');
    vars.add('Array');
    vars.add('Object');
    vars.add('Number');
    vars.add('Boolean');

    return Array.from(vars).sort();
  }

  /**
   * Update the displayed available variables
   */
  updateAvailableVariables() {
    const vars = this.getContextVariables();
    const varDisplay = document.getElementById('availableVars');
    if (varDisplay) {
      varDisplay.textContent = vars.slice(0, 5).join(', ') + (vars.length > 5 ? `, ... (+${vars.length - 5} more)` : '');
    }
  }

  /**
   * Setup event listeners for buttons
   */
  setupEventListeners() {
    document.getElementById('runTestBtn').addEventListener('click', () => this.runTest());
    document.getElementById('saveTestBtn').addEventListener('click', () => this.saveTestCase());
    document.getElementById('clearTestBtn').addEventListener('click', () => this.clearTest());
    document.getElementById('transformFormatBtn').addEventListener('click', () => this.formatCode());
  }

  /**
   * Format/beautify the code
   */
  formatCode() {
    try {
      const code = this.codeMirrorInstance.getValue();
      // Basic formatting: indent and fix spacing
      const formatted = this.beautifyCode(code);
      this.codeMirrorInstance.setValue(formatted);
      ui.showToast({ message: 'Code formatted', type: 'success', duration: 2000 });
    } catch (error) {
      ui.showToast({ message: 'Failed to format code', type: 'warning' });
    }
  }

  /**
   * Simple code beautifier
   */
  beautifyCode(code) {
    let indent = 0;
    let formatted = '';
    const lines = code.split('\n');

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Decrease indent for closing braces
      if (trimmed.match(/^[}\]]/)) {
        indent = Math.max(0, indent - 1);
      }

      formatted += '  '.repeat(indent) + trimmed + '\n';

      // Increase indent for opening braces
      if (trimmed.match(/[{[]$/)) {
        indent++;
      }
    }

    return formatted.trim();
  }

  /**
   * Validate JavaScript syntax
   */
  validateSyntax() {
    const code = this.codeMirrorInstance.getValue();
    const errorDiv = document.getElementById('transformErrors');

    try {
      new Function('input', code);
      errorDiv.style.display = 'none';
      this.codeMirrorInstance.clearGutter('CodeMirror-linenumber');
    } catch (error) {
      errorDiv.style.display = 'block';
      errorDiv.innerHTML = `
        <div class="alert alert-danger mb-0" style="font-size: 0.9em;">
          <i class="bi bi-exclamation-circle me-2"></i>
          <strong>Syntax Error:</strong> ${error.message}
        </div>
      `;
    }
  }

  /**
   * Run test with sample input
   */
  async runTest() {
    try {
      const code = this.codeMirrorInstance.getValue();
      const inputStr = document.getElementById('transformTestInput').value.trim();
      const input = inputStr ? JSON.parse(inputStr) : {};

      // Validate syntax first
      const fn = new Function('input', code);

      // Execute transform
      const result = fn(input);

      // Display result
      this.displayTestResult(result, null);

      // Store for comparison
      this.lastTestResult = { input, output: result, timestamp: new Date().toISOString() };

      ui.showToast({ message: 'Test executed successfully', type: 'success', duration: 2000 });
    } catch (error) {
      this.displayTestResult(null, error);
      ui.showToast({ message: `Test failed: ${error.message}`, type: 'danger', duration: 3000 });
    }
  }

  /**
   * Display test result
   */
  displayTestResult(result, error) {
    const resultSection = document.getElementById('testResultSection');
    const resultAlert = document.getElementById('testResultAlert');
    const resultOutput = document.getElementById('testResultOutput');

    resultSection.style.display = 'block';

    if (error) {
      resultAlert.className = 'alert alert-danger';
      resultOutput.textContent = `Error: ${error.message}\n\nStack trace:\n${error.stack || ''}`;
    } else {
      resultAlert.className = 'alert alert-success';
      try {
        const formatted = JSON.stringify(result, null, 2);
        resultOutput.textContent = formatted;
      } catch (e) {
        resultOutput.textContent = String(result);
      }
    }

    // Scroll to result
    resultSection.scrollIntoView({ behavior: 'smooth' });
  }

  /**
   * Save current test case
   */
  saveTestCase() {
    try {
      const inputStr = document.getElementById('transformTestInput').value.trim();
      const input = inputStr ? JSON.parse(inputStr) : {};

      if (!this.lastTestResult) {
        ui.showToast({ message: 'Please run a test first', type: 'warning' });
        return;
      }

      const testCase = {
        id: `test-${Date.now()}`,
        name: prompt('Enter test case name:', `Test ${this.testCases.length + 1}`) || `Test ${this.testCases.length + 1}`,
        input,
        expectedOutput: this.lastTestResult.output,
        description: '',
        createdAt: new Date().toISOString()
      };

      this.testCases.push(testCase);
      this.saveTestCases();
      this.loadSavedTests();

      ui.showToast({ message: 'Test case saved', type: 'success', duration: 2000 });
    } catch (error) {
      ui.showToast({ message: `Failed to save: ${error.message}`, type: 'danger' });
    }
  }

  /**
   * Load saved test cases
   */
  loadSavedTests() {
    const section = document.getElementById('savedTestsSection');
    const list = document.getElementById('savedTestsList');

    if (this.testCases.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    list.innerHTML = this.testCases.map((tc, idx) => `
      <div class="card border-sm" style="border-radius: 3px;">
        <div class="card-body py-2 px-3" style="font-size: 0.9em;">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <strong>${tc.name}</strong>
              <br>
              <small class="text-muted">${new Date(tc.createdAt).toLocaleDateString()}</small>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-outline-primary"
                      onclick="window.transformEditorInstance?.loadTestCase(${idx})" title="Load test case">
                <i class="bi bi-arrow-down-short"></i>
              </button>
              <button class="btn btn-sm btn-outline-success"
                      onclick="window.transformEditorInstance?.runTestCase(${idx})" title="Run test case">
                <i class="bi bi-play-fill"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger"
                      onclick="window.transformEditorInstance?.deleteTestCase(${idx})" title="Delete test case">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
          <small class="d-block mt-2">
            Input: <code style="font-size: 0.85em;">${JSON.stringify(tc.input).substring(0, 100)}</code>
          </small>
        </div>
      </div>
    `).join('');
  }

  /**
   * Load test case into input field
   */
  loadTestCase(index) {
    const testCase = this.testCases[index];
    if (testCase) {
      document.getElementById('transformTestInput').value = JSON.stringify(testCase.input, null, 2);
      ui.showToast({ message: 'Test case loaded', type: 'info', duration: 2000 });
    }
  }

  /**
   * Run specific test case
   */
  async runTestCase(index) {
    const testCase = this.testCases[index];
    if (testCase) {
      document.getElementById('transformTestInput').value = JSON.stringify(testCase.input, null, 2);
      await this.runTest();
    }
  }

  /**
   * Delete test case
   */
  deleteTestCase(index) {
    if (confirm('Delete this test case?')) {
      this.testCases.splice(index, 1);
      this.saveTestCases();
      this.loadSavedTests();
      ui.showToast({ message: 'Test case deleted', type: 'info', duration: 2000 });
    }
  }

  /**
   * Clear test input and result
   */
  clearTest() {
    document.getElementById('transformTestInput').value = '';
    document.getElementById('testResultSection').style.display = 'none';
    this.lastTestResult = null;
  }

  /**
   * Save test cases to localStorage
   */
  saveTestCases() {
    localStorage.setItem(`transform-tests-${this.step.id}`, JSON.stringify(this.testCases));
  }

  /**
   * Get editor content
   */
  getCode() {
    return this.codeMirrorInstance.getValue();
  }

  /**
   * Set editor content
   */
  setCode(code) {
    this.codeMirrorInstance.setValue(code);
  }
}

/**
 * Initialize transform editor modal
 */
function showTransformEditor(stepIndex, step, currentWorkflow) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('transformEditorModal');
  if (!modal) {
    const modalHTML = `
      <div class="modal fade" id="transformEditorModal" tabindex="-1">
        <div class="modal-dialog modal-lg" style="max-width: 1000px;">
          <div class="modal-content" style="max-height: 90vh; display: flex; flex-direction: column;">
            <div class="modal-header">
              <h5 class="modal-title">
                <i class="bi bi-code-square me-2"></i>Transform Step Editor
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 0;">
              <div id="transformEditorContainer" style="padding: 20px; height: 100%; display: flex; flex-direction: column;"></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              <button type="button" class="btn btn-primary" id="saveTransformBtn">
                <i class="bi bi-check-lg me-2"></i>Save Transform
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    modal = document.getElementById('transformEditorModal');
  }

  // Initialize editor
  const editor = new TransformEditor(stepIndex, step, currentWorkflow);
  window.transformEditorInstance = editor;

  const container = document.getElementById('transformEditorContainer');
  editor.initializeEditor(container);

  // Save button
  document.getElementById('saveTransformBtn').onclick = () => {
    step.config.script = editor.getCode();
    isDirty = true;
    const bsModal = bootstrap.Modal.getInstance(modal);
    bsModal.hide();
    ui.showToast({ message: 'Transform saved', type: 'success' });
  };

  // CodeMirror measures its layout wrongly when created inside a hidden
  // modal — refresh it once the modal is fully visible so it paints.
  modal.addEventListener('shown.bs.modal', () => {
    if (editor.codeMirrorInstance) {
      editor.codeMirrorInstance.refresh();
      editor.codeMirrorInstance.focus();
    }
  }, { once: true });

  // Show modal
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
}

// Export for use
window.showTransformEditor = showTransformEditor;
