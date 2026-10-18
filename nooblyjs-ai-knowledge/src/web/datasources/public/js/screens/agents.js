/* AI Agents screen — /api/agents */
(function () {
  const { escapeHtml, toast } = window.DS.util;
  const api = window.DS.api;

  const local = { agents: [] };
  const PROVIDERS = ['ollama', 'claude', 'openai' ,'openai-kv', 'gemini', 'api'];
  const USAGE_OPTIONS = ['Chat Processing', 'Document Processing', 'Code Processing', 'Folder Processing'];

  function renderBody() {
    const list = local.agents;
    return list.length ? `
      <div class="grid-3">
        ${list.map(a => `<div class="card"><div class="card-pad">
          <div class="row between" style="align-items:flex-start">
            <div style="width:38px;height:38px;border-radius:9px;background:var(--violet-50);color:var(--violet-700);display:flex;align-items:center;justify-content:center">${icon('sparkles', 18)}</div>
            <div class="row" style="gap:4px">
              <button class="btn btn-icon-sm" title="Edit" data-action="edit" data-id="${escapeHtml(a.id)}">${icon('pencil', 12)}</button>
              <button class="btn btn-icon-sm" title="Delete" data-action="delete" data-id="${escapeHtml(a.id)}" data-name="${escapeHtml(a.name || '')}">${icon('trash', 12)}</button>
            </div>
          </div>
          <div style="font-weight:600;font-size:14px;color:var(--ink-900);margin-top:10px">${escapeHtml(a.name || 'Agent')}</div>
          <div style="font-size:12px;color:var(--ink-500);margin-top:2px;min-height:32px">${escapeHtml(a.description || '')}</div>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
            ${a.provider ? `<span class="tag">${escapeHtml(a.provider)}</span>` : ''}
            <span class="badge ${a.enabled !== false ? 'success' : 'neutral'}">${a.enabled !== false ? 'enabled' : 'disabled'}</span>
            ${(Array.isArray(a.usage) ? a.usage : []).map(u => `<span class="tag">${escapeHtml(u)}</span>`).join('')}
          </div>
        </div></div>`).join('')}
      </div>` : `<div class="card"><div class="empty-state">
        <div class="ico">${icon('sparkles', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No agents configured</div>
        <div style="font-size:12.5px;margin:4px 0 14px">Agents ground AI answers on your spaces and prompts.</div>
        <button class="btn btn-primary btn-sm" data-action="show-create">${icon('plus', 13)} New agent</button>
      </div></div>`;
  }

  /** Shared form fields for the create and edit modals; prefilled when an agent is passed. */
  function agentForm(agent) {
    const a = agent || {};
    const optionsText = a.options && Object.keys(a.options).length ? JSON.stringify(a.options, null, 2) : '';
    const usage = Array.isArray(a.usage) ? a.usage : [];
    // New agents default to enabled; existing agents respect the stored flag.
    const enabled = agent ? a.enabled !== false : true;
    return `
      <div class="field">
        <label class="field-label">Name <span class="req">*</span></label>
        <input class="input" data-field="name" placeholder="e.g., RAG OpenAI" value="${escapeHtml(a.name || '')}"/>
      </div>
      <div class="field">
        <label class="field-label">Description</label>
        <textarea class="textarea" data-field="description" placeholder="What does this agent do?">${escapeHtml(a.description || '')}</textarea>
      </div>
      <div class="field">
        <label class="field-label">Provider <span class="req">*</span></label>
        <select class="select" data-field="provider">
          ${PROVIDERS.map(p => `<option value="${p}"${p === a.provider ? ' selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="checkbox-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" data-field="enabled" ${enabled ? 'checked' : ''}/>
          <span class="field-label" style="margin:0">Enabled</span>
        </label>
      </div>
      <div class="field">
        <label class="field-label">Usage</label>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${USAGE_OPTIONS.map(u => `
            <label class="checkbox-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" data-usage value="${escapeHtml(u)}" ${usage.includes(u) ? 'checked' : ''}/>
              <span style="font-size:13px;color:var(--ink-700)">${escapeHtml(u)}</span>
            </label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label class="field-label">Options (JSON)</label>
        <textarea class="textarea" data-field="options" rows="6" placeholder='{ "model": "gpt-4o", "temperature": 0.7 }' style="font-family:monospace;font-size:12px">${escapeHtml(optionsText)}</textarea>
        <div data-region="options-error" style="color:var(--danger-700);font-size:11.5px;margin-top:4px;display:none"></div>
      </div>`;
  }

  function createModal() {
    return `
      <div class="modal-card" style="width:540px">
        <div class="card-head">
          <div class="card-title">${icon('sparkles', 16)} New agent</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad modal-body" style="max-height:86vh">
          ${agentForm()}
          <div class="row" style="justify-content:flex-end;gap:8px">
            <button class="btn" data-action="modal-close">Cancel</button>
            <button class="btn btn-primary" data-action="do-create">${icon('plus', 13)} Create agent</button>
          </div>
        </div>
      </div>`;
  }

  function editModal(agent) {
    return `
      <div class="modal-card" style="width:540px">
        <div class="card-head">
          <div class="card-title">${icon('pencil', 16)} Edit agent</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad modal-body" style="max-height:86vh">
          ${agentForm(agent)}
          <div class="row" style="justify-content:flex-end;gap:8px">
            <button class="btn" data-action="modal-close">Cancel</button>
            <button class="btn btn-primary" data-action="do-edit" data-id="${escapeHtml(agent.id)}">${icon('save', 13)} Save changes</button>
          </div>
        </div>
      </div>`;
  }

  function html() {
    const actions = `<button class="btn btn-primary" data-action="show-create">${icon('plus', 14)} New agent</button>`;
    return `${pageHead('agents', actions)}<div data-region="body"></div>`;
  }

  function init(root) {
    window.DS.util.loadRegion(root, async () => {
      local.agents = await api.get('/api/agents') || [];
      return true;
    }, () => renderBody());
  }

  async function refresh() {
    local.agents = await api.get('/api/agents') || [];
    rerenderScreen();
  }

  /** Read the modal form. Returns the payload, or null if validation fails (a toast is shown). */
  function readForm() {
    const get = (f) => { const el = document.querySelector(`[data-field="${f}"]`); return el ? el.value.trim() : ''; };
    const name = get('name');
    if (!name) { toast('Name is required', 'warn'); return null; }

    const errEl = document.querySelector('[data-region="options-error"]');
    if (errEl) errEl.style.display = 'none';
    const optionsRaw = get('options');
    let options = {};
    if (optionsRaw) {
      try {
        options = JSON.parse(optionsRaw);
      } catch (e) {
        if (errEl) { errEl.textContent = 'Invalid JSON: ' + e.message; errEl.style.display = 'block'; }
        toast('Options must be valid JSON', 'warn');
        return null;
      }
    }
    const enabledEl = document.querySelector('[data-field="enabled"]');
    const enabled = enabledEl ? enabledEl.checked : true;
    const usage = Array.from(document.querySelectorAll('[data-usage]:checked')).map(el => el.value);

    return { name, description: get('description'), provider: get('provider'), enabled, usage, options };
  }

  async function handle(action, el) {
    if (action === 'retry') return rerenderScreen();
    if (action === 'show-create') {
      window.Router.openModal(createModal());
    } else if (action === 'do-create') {
      const payload = readForm();
      if (!payload) return;
      try {
        await api.post('/api/agents', payload);
        window.Router.closeModal();
        toast('Agent created', 'success');
        refresh();
      } catch (err) { toast('Failed to create agent: ' + err.message, 'danger'); }
    } else if (action === 'edit') {
      const agent = local.agents.find(a => a.id === el.dataset.id);
      if (!agent) return toast('Agent not found', 'warn');
      window.Router.openModal(editModal(agent));
    } else if (action === 'do-edit') {
      const payload = readForm();
      if (!payload) return;
      try {
        await api.put(`/api/agents/${el.dataset.id}`, payload);
        window.Router.closeModal();
        toast('Agent updated', 'success');
        refresh();
      } catch (err) { toast('Failed to update agent: ' + err.message, 'danger'); }
    } else if (action === 'delete') {
      if (!confirm(`Delete agent "${el.dataset.name}"?`)) return;
      try { await api.del(`/api/agents/${el.dataset.id}`); toast('Agent deleted', 'success'); refresh(); }
      catch (err) { toast('Failed to delete: ' + err.message, 'danger'); }
    }
  }

  window.Router.register('agents', { html, init, handle }, {
    title: 'Agents',
    sub: 'Configure AI agents that ground answers on your spaces.',
    crumb: ['Knowledge', 'Agents'],
  });
})();
