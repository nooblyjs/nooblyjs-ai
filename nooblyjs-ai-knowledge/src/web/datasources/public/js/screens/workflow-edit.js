/* Workflow editor screen — create (/api/workflows) & edit (/api/workflows/:id).
   Workflow details + ordered step list. Per-step configuration is delegated
   to the existing dedicated step editors (stepEditors/*.js) — Bootstrap-modal
   editors that mutate step.config in place, including the CodeMirror-backed
   Transform and API editors. */
(function () {
  const { escapeHtml, toast } = window.DS.util;
  const api = window.DS.api;

  /* Provide the toast hook the legacy step editors look for. */
  if (!window.ui) window.ui = { showToast: (o) => toast(o && o.message, o && o.type) };

  const STEP_TYPES = {
    identity:    { label: 'Identity',    desc: 'Pass-through step',         icon: 'arrowRight', fn: 'showIdentityEditor',    modal: 'identityEditorModal' },
    delay:       { label: 'Delay',       desc: 'Pause execution',           icon: 'clock',      fn: 'showDelayEditor',       modal: 'delayEditorModal' },
    transform:   { label: 'Transform',   desc: 'Transform data with JS',    icon: 'code',       fn: 'showTransformEditor',   modal: 'transformEditorModal' },
    conditional: { label: 'Conditional', desc: 'Conditional branching',     icon: 'branch',     fn: 'showConditionalEditor', modal: 'conditionalEditorModal' },
    api:         { label: 'API Call',    desc: 'Call an external HTTP API', icon: 'globe',      fn: 'showAPIEditor',         modal: 'apiEditorModal' },
    parallel:    { label: 'Parallel',    desc: 'Execute steps in parallel', icon: 'arrowSplit', fn: 'showParallelEditor',    modal: 'parallelEditorModal' },
  };

  let local = blank();
  function blank() {
    return {
      loaded: false, id: null,
      name: '', description: '', group: '', tags: [], defaultInput: '{}',
      defaultInputError: null,
      steps: [], activeStep: null, showAddMenu: false, saving: false,
    };
  }

  function adoptWorkflow(wf) {
    local.id = wf.id;
    local.name = wf.name || '';
    local.description = wf.description || '';
    local.group = wf.group || wf.directoryName || '';
    local.tags = wf.tags || [];
    local.defaultInput = JSON.stringify(wf.defaultInput || {}, null, 2);
    local.defaultInputError = null;
    local.steps = (wf.steps || []).map((s, i) => normaliseStep(s, i));
    local.activeStep = local.steps.length ? local.steps[0].id : null;
    local.loaded = true;
  }

  function normaliseStep(s, i) {
    const type = s.type || 'identity';
    return {
      id: s.id || `s${i}_${Date.now()}`,
      name: s.name || (STEP_TYPES[type] ? STEP_TYPES[type].label : 'Step'),
      type,
      config: (s.config && typeof s.config === 'object') ? s.config
            : (s.settings && typeof s.settings === 'object') ? s.settings : {},
      // File-based workflows store each step as a .js module; keep the path.
      filePath: s.filePath || s.file || s.stepFilePath || null,
    };
  }

  /* ---------- render ---------- */
  function configSummary(cfg) {
    const keys = Object.keys(cfg || {});
    if (!keys.length) return '<span class="muted" style="font-size:12px">Not configured yet</span>';
    return `<div class="code" style="max-height:180px">${escapeHtml(JSON.stringify(cfg, null, 2))}</div>`;
  }

  function stepConfigCard() {
    const s = local.steps.find(x => x.id === local.activeStep);
    if (!s) return '';
    const info = STEP_TYPES[s.type] || STEP_TYPES.identity;
    const idx = local.steps.findIndex(x => x.id === s.id) + 1;
    return `
      <div class="card">
        <div class="card-head">
          <div class="card-title">${icon(info.icon, 16)} Step configuration · ${info.label}</div>
          <span class="badge info">step ${idx}</span>
        </div>
        <div class="card-pad">
          <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:14px">
            <div class="field">
              <label class="field-label">Step name</label>
              <input class="input" data-step-field="name" value="${escapeHtml(s.name)}"/>
            </div>
            <div class="field">
              <label class="field-label">Type</label>
              <select class="select" data-step-field="type">
                ${Object.entries(STEP_TYPES).map(([k, v]) => `<option value="${k}"${k === s.type ? ' selected' : ''}>${v.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field" style="margin-bottom:0">
            <div class="between" style="margin-bottom:8px">
              <label class="field-label" style="margin:0">${s.filePath ? 'Step module' : 'Configuration'}</label>
              <button class="btn btn-sm" data-action="configure-step" data-id="${s.id}">
                ${s.filePath ? `${icon('code', 13)} Edit step code` : `${icon('sliders', 13)} Open ${info.label} editor`}
              </button>
            </div>
            ${s.filePath
              ? `<div class="code" style="padding:8px 12px">${escapeHtml(s.filePath)}</div>`
              : configSummary(s.config)}
          </div>
        </div>
      </div>`;
  }

  function addMenu() {
    if (!local.showAddMenu) return '';
    return `<div class="card" style="position:absolute;right:0;top:38px;width:268px;z-index:20;padding:6px;box-shadow:var(--shadow-lg)">
      ${Object.entries(STEP_TYPES).map(([k, v]) => `
        <div data-action="add-step" data-type="${k}" style="display:flex;gap:10px;align-items:center;padding:8px;border-radius:6px;cursor:pointer">
          <span class="step-type-pill ${k}" style="width:26px;height:26px;padding:0;justify-content:center">${icon(v.icon, 13)}</span>
          <div><div style="font-size:13px;font-weight:600;color:var(--ink-900)">${v.label}</div>
            <div style="font-size:11.5px;color:var(--ink-500)">${v.desc}</div></div>
        </div>`).join('')}
    </div>`;
  }

  function renderBody() {
    return `
      <div class="grid-2" style="grid-template-columns:1fr 320px;align-items:flex-start;gap:18px">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-head"><div class="card-title">${icon('fileText', 16)} Workflow details</div></div>
            <div class="card-pad">
              <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:14px">
                <div class="field">
                  <label class="field-label">Name <span class="req">*</span></label>
                  <input class="input" data-field="name" value="${escapeHtml(local.name)}" placeholder="Workflow name"/>
                </div>
                <div class="field">
                  <label class="field-label">Group (folder) <span class="req">*</span></label>
                  <input class="input" data-field="group" value="${escapeHtml(local.group)}" placeholder="e.g., design-documents"/>
                </div>
              </div>
              <div class="field">
                <label class="field-label">Description</label>
                <textarea class="textarea" data-field="description" placeholder="What does this workflow do?">${escapeHtml(local.description)}</textarea>
              </div>
              <div class="field">
                <label class="field-label">Tags (comma-separated)</label>
                <input class="input" data-field="tags" value="${escapeHtml(local.tags.join(', '))}" placeholder="Design, Ingest"/>
              </div>
              <div class="field" style="margin-bottom:0">
                <label class="field-label">Default input (JSON)</label>
                <textarea class="textarea mono" data-field="defaultInput" rows="4"
                  placeholder='{ "filter": [] }'
                  style="${local.defaultInputError ? 'border-color:var(--danger-500)' : ''}">${escapeHtml(local.defaultInput)}</textarea>
                <div data-role="json-error" style="display:${local.defaultInputError ? 'block' : 'none'};color:var(--danger-700);font-size:9.6px;margin-top:5px">${escapeHtml(local.defaultInputError || '')}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <div class="card-title">${icon('layers', 16)} Workflow steps <span class="req">*</span></div>
              <div style="position:relative">
                <button class="btn btn-primary btn-sm" data-action="toggle-add-menu">${icon('plus', 13)} Add step ${icon('chevronDown', 11)}</button>
                ${addMenu()}
              </div>
            </div>
            <div style="padding:16px;display:flex;flex-direction:column;gap:8px">
              ${local.steps.length ? local.steps.map((s, i) => {
                const info = STEP_TYPES[s.type] || STEP_TYPES.identity;
                const active = local.activeStep === s.id;
                const configured = Object.keys(s.config || {}).length > 0;
                return `<div class="step-row" data-action="select-step" data-id="${s.id}"
                    style="${active ? 'border-color:var(--gold-500);box-shadow:0 0 0 3px rgba(14,61,86,.15)' : ''};cursor:pointer">
                  <span class="step-num">${i + 1}</span>
                  <div style="min-width:0">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                      <span style="font-weight:600;color:var(--ink-900);font-size:13px">${escapeHtml(s.name)}</span>
                      <span class="step-type-pill ${s.type}">${icon(info.icon, 11)} ${info.label}</span>
                      ${configured ? `<span class="badge success" style="font-size:10px">${icon('check', 9)} configured</span>` : ''}
                    </div>
                  </div>
                  <div class="row row-tight">
                    <button class="btn btn-icon-sm" title="Configure" data-action="configure-step" data-id="${s.id}">${icon('sliders', 12)}</button>
                    <button class="btn btn-icon-sm" title="Move up" data-action="move-step" data-id="${s.id}" data-dir="-1"${i === 0 ? ' disabled' : ''}>${icon('chevronUp', 12)}</button>
                    <button class="btn btn-icon-sm" title="Move down" data-action="move-step" data-id="${s.id}" data-dir="1"${i === local.steps.length - 1 ? ' disabled' : ''}>${icon('chevronDown', 12)}</button>
                    <button class="btn btn-icon-sm" title="Delete" data-action="delete-step" data-id="${s.id}" style="color:var(--danger-700)">${icon('trash', 12)}</button>
                  </div>
                </div>`;
              }).join('') : `<div class="empty-state" style="padding:32px">
                <div class="ico">${icon('inbox', 22)}</div>
                <div style="font-size:13px;font-weight:600">No steps yet</div>
                <div style="font-size:12px;margin-top:2px">Click "Add step" to start building the workflow.</div>
              </div>`}
            </div>
          </div>

          ${stepConfigCard()}
        </div>

        <div style="display:flex;flex-direction:column;gap:14px;position:sticky;top:20px">
          <div class="card"><div class="card-pad">
            <div class="card-title" style="margin-bottom:10px">${icon('save', 15)} Save</div>
            <p style="font-size:12px;color:var(--ink-500);margin:0 0 12px">
              ${local.id ? 'Update this workflow and its steps.' : 'Create a new workflow with the configured steps.'}
            </p>
            <button class="btn btn-primary" style="width:100%;justify-content:center" data-action="save"${local.saving ? ' disabled' : ''}>
              ${local.saving ? '<span class="spinner"></span> Saving…' : `${icon('check', 14)} ${local.id ? 'Update workflow' : 'Create workflow'}`}
            </button>
            <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px" data-action="nav" data-screen="workflows">Cancel</button>
          </div></div>
        </div>
      </div>`;
  }

  function html() {
    return `${pageHead('workflowEdit', '')}<div data-region="body"></div>`;
  }

  function init(root, state) {
    const id = state && state.params && state.params.id;
    if (id) {
      window.DS.util.loadRegion(root, async () => {
        const wf = await api.get(`/api/workflows/${id}`);
        adoptWorkflow(wf || {});
        return true;
      }, () => renderBody());
    } else {
      local = blank();
      root.querySelector('[data-region="body"]').innerHTML = renderBody();
    }

    // Live-validate the Default input JSON as the user types. Delegated on the
    // (stable) screen root so it survives the body re-renders done by paint();
    // updates the error in place to avoid disturbing the caret.
    if (!root._jsonValidatorBound) {
      root._jsonValidatorBound = true;
      root.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.dataset || t.dataset.field !== 'defaultInput') return;
        local.defaultInput = t.value;
        const err = defaultInputJsonError();
        local.defaultInputError = err;
        const field = t.closest('.field');
        const hint = field && field.querySelector('[data-role="json-error"]');
        if (hint) {
          hint.textContent = err || '';
          hint.style.display = err ? 'block' : 'none';
        }
        t.style.borderColor = err ? 'var(--danger-500)' : '';
      });
    }
  }

  function paint() {
    const region = document.querySelector('#mainContent .kr-ds [data-region="body"]');
    if (region) region.innerHTML = renderBody();
  }

  /* Capture edits from detail/step fields before any re-render. */
  function syncFields() {
    document.querySelectorAll('[data-field]').forEach(el => {
      const f = el.dataset.field;
      if (f === 'tags') local.tags = el.value.split(',').map(t => t.trim()).filter(Boolean);
      else local[f] = el.value;
    });
    const s = local.steps.find(x => x.id === local.activeStep);
    if (s) {
      document.querySelectorAll('[data-step-field]').forEach(el => {
        s[el.dataset.stepField] = el.value;
      });
    }
  }

  /* Edit a file-based step's .js module in the CodeMirror code editor. */
  function openStepFile(step) {
    if (!local.id) {
      toast('Save the workflow before editing step files', 'warn');
      return;
    }
    const wfId = encodeURIComponent(local.id);
    const fp = encodeURIComponent(step.filePath);
    window.DS.api.get(`/api/workflows/${wfId}/step-file-content?stepFilePath=${fp}`)
      .then((res) => {
        window.DS.codeEditor.open({
          title: `${step.name} · ${step.filePath}`,
          value: (res && res.content) || '',
          mode: 'javascript',
          onSave: async (code) => {
            await window.DS.api.put(`/api/workflows/${wfId}/step-file-content`,
              { stepFilePath: step.filePath, content: code });
            toast('Step file saved', 'success');
          },
        });
      })
      .catch((err) => toast('Failed to load step file: ' + err.message, 'danger'));
  }

  /* Open a step for editing.
     File-based steps (a .js module on disk) open in the CodeMirror code
     editor — fetched/saved via the step-file-content API. Inline-config
     steps fall back to the dedicated per-type Bootstrap editors. */
  function openStepEditor(step) {
    if (step.filePath) { openStepFile(step); return; }
    const info = STEP_TYPES[step.type] || STEP_TYPES.identity;
    const fn = window[info.fn];
    if (typeof fn !== 'function') {
      toast(`${info.label} editor is unavailable`, 'danger');
      return;
    }
    if (!step.config || typeof step.config !== 'object') step.config = {};
    const idx = local.steps.findIndex(s => s.id === step.id);
    const workflowCtx = { id: local.id, name: local.name, steps: local.steps };
    try {
      fn(idx, step, workflowCtx);
    } catch (err) {
      console.error('[workflow-edit] step editor failed:', err);
      toast('Could not open step editor: ' + err.message, 'danger');
      return;
    }
    const modalEl = document.getElementById(info.modal);
    if (modalEl) {
      modalEl.addEventListener('hidden.bs.modal', () => paint(), { once: true });
    }
  }

  /* Validate the Default input field's JSON. Returns a parse-error message, or
     null when the field is empty (treated as {}) or contains valid JSON. */
  function defaultInputJsonError() {
    const text = (local.defaultInput || '').trim();
    if (!text) return null;
    try { JSON.parse(text); return null; }
    catch (e) { return e.message; }
  }

  function buildPayload() {
    let defaultInput = {};
    try { defaultInput = JSON.parse(local.defaultInput || '{}'); } catch (e) { /* keep {} */ }
    // File-based steps round-trip as their path string (the on-disk
    // workflow-definition.json format); inline steps as objects.
    const steps = local.steps.map(s => s.filePath
      ? s.filePath
      : { id: s.id, name: s.name, type: s.type, config: s.config || {} });
    return {
      name: local.name.trim(),
      description: local.description.trim(),
      group: local.group.trim(),
      tags: local.tags,
      defaultInput,
      steps,
    };
  }

  async function handle(action, el, e, state) {
    if (action === 'retry') return rerenderScreen();
    if (action === 'toggle-add-menu') {
      syncFields(); local.showAddMenu = !local.showAddMenu; paint();
    } else if (action === 'add-step') {
      syncFields();
      const type = el.dataset.type;
      const id = `s_${Date.now()}`;
      local.steps.push({ id, name: STEP_TYPES[type].label + ' step', type, config: {} });
      local.activeStep = id;
      local.showAddMenu = false;
      paint();
    } else if (action === 'delete-step') {
      syncFields();
      local.steps = local.steps.filter(s => s.id !== el.dataset.id);
      if (local.activeStep === el.dataset.id) local.activeStep = local.steps[0] ? local.steps[0].id : null;
      paint();
    } else if (action === 'select-step') {
      syncFields(); local.activeStep = el.dataset.id; paint();
    } else if (action === 'configure-step') {
      syncFields();
      local.activeStep = el.dataset.id;
      const step = local.steps.find(s => s.id === el.dataset.id);
      if (step) openStepEditor(step);
    } else if (action === 'move-step') {
      syncFields();
      const i = local.steps.findIndex(s => s.id === el.dataset.id);
      const j = i + Number(el.dataset.dir);
      if (i >= 0 && j >= 0 && j < local.steps.length) {
        const [m] = local.steps.splice(i, 1);
        local.steps.splice(j, 0, m);
      }
      paint();
    } else if (action === 'save') {
      syncFields();
      const payload = buildPayload();
      if (!payload.name) return toast('Workflow name is required', 'warn');
      if (!payload.group) return toast('Group is required', 'warn');
      if (!payload.steps.length) return toast('Add at least one step', 'warn');
      const jsonErr = defaultInputJsonError();
      if (jsonErr) {
        local.defaultInputError = jsonErr; paint();
        return toast('Default input is not valid JSON: ' + jsonErr, 'warn');
      }
      local.saving = true; paint();
      try {
        if (local.id) {
          await api.put(`/api/workflows/${local.id}`, payload);
          toast('Workflow updated', 'success');
        } else {
          const created = await api.post('/api/workflows', payload);
          if (created && created.id) local.id = created.id;
          toast('Workflow created', 'success');
        }
        navTo('workflows');
      } catch (err) {
        local.saving = false; paint();
        toast('Failed to save: ' + err.message, 'danger');
      }
    }
  }

  window.Router.register('workflowEdit', { html, init, handle }, {
    title: 'Workflow editor',
    sub: 'Configure workflow details and steps.',
    crumb: ['Datasources', 'Workflows', 'Editor'],
  });
})();
