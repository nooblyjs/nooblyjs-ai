/* Data connections screen — /api/connections */
(function () {
  const { escapeHtml, toast } = window.DS.util;
  const api = window.DS.api;

  const local = { connections: [] };

  const TYPE_ICON = { ftp: 'server', sftp: 'server', s3: 'cloud', git: 'git', http: 'globe', api: 'api', local: 'folder', filesystem: 'folder' };

  function renderBody() {
    const list = local.connections;
    return list.length ? `
      <div class="grid-3">
        ${list.map(c => {
          const ic = TYPE_ICON[(c.type || '').toLowerCase()] || 'database';
          return `<div class="card"><div class="card-pad">
            <div class="row between" style="align-items:flex-start">
              <div style="width:38px;height:38px;border-radius:9px;background:var(--gold-50);color:var(--gold-700);display:flex;align-items:center;justify-content:center">${icon(ic, 18)}</div>
              <button class="btn btn-icon-sm" title="Delete" data-action="delete" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" style="color:var(--danger-700)">${icon('trash', 12)}</button>
            </div>
            <div style="font-weight:600;font-size:14px;color:var(--ink-900);margin-top:10px">${escapeHtml(c.name)}</div>
            <div style="font-size:12px;color:var(--ink-500);margin-top:2px">${escapeHtml(c.description || '')}</div>
            <div class="row" style="gap:6px;margin-top:10px">
              <span class="tag">${escapeHtml(c.type || 'unknown')}</span>
              ${c.status ? `<span class="badge ${c.status === 'connected' ? 'success' : 'neutral'}">${escapeHtml(c.status)}</span>` : ''}
            </div>
            <button class="btn btn-sm" style="width:100%;justify-content:center;margin-top:12px"
                    data-action="browse" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">
              ${icon('folderOpen', 13)} Browse files
            </button>
          </div></div>`;
        }).join('')}
      </div>` : `<div class="card"><div class="empty-state">
        <div class="ico">${icon('database', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No data connections</div>
        <div style="font-size:12.5px;margin:4px 0 14px">Connect source systems such as FTP, S3 or Git.</div>
        <button class="btn btn-primary btn-sm" data-action="show-create">${icon('plus', 13)} New connection</button>
      </div></div>`;
  }

  function createModal() {
    return `
      <div class="modal-card" style="width:540px">
        <div class="card-head">
          <div class="card-title">${icon('database', 16)} New connection</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad modal-body" style="max-height:72vh">
          <div class="field">
            <label class="field-label">Name <span class="req">*</span></label>
            <input class="input" data-field="name" placeholder="e.g., Production FTP"/>
          </div>
          <div class="field">
            <label class="field-label">Type <span class="req">*</span></label>
            <select class="select" data-field="type">
              ${['ftp', 'sftp', 's3', 'git', 'http', 'local'].map(t => `<option value="${t}">${t.toUpperCase()}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Description</label>
            <textarea class="textarea" data-field="description" placeholder="Optional"></textarea>
          </div>
          <div class="field">
            <label class="field-label">Configuration (JSON)</label>
            <textarea class="textarea mono" data-field="config" placeholder='{ "host": "…" }'>{}</textarea>
            <div class="field-help">Connection-specific settings (host, credentials, path…).</div>
          </div>
          <div class="row" style="justify-content:flex-end;gap:8px">
            <button class="btn" data-action="modal-close">Cancel</button>
            <button class="btn btn-primary" data-action="do-create">${icon('plus', 13)} Create connection</button>
          </div>
        </div>
      </div>`;
  }

  function html() {
    const actions = `<button class="btn btn-primary" data-action="show-create">${icon('plus', 14)} New connection</button>`;
    return `${pageHead('connections', actions)}<div data-region="body"></div>`;
  }

  function init(root) {
    window.DS.util.loadRegion(root, async () => {
      local.connections = await api.get('/api/connections') || [];
      return true;
    }, () => renderBody());
  }

  async function refresh() {
    local.connections = await api.get('/api/connections') || [];
    rerenderScreen();
  }

  async function handle(action, el) {
    if (action === 'retry') return rerenderScreen();
    if (action === 'browse') {
      window.DS.filing.open({
        title: el.dataset.name || 'Connection',
        initEndpoint: `/api/connections/${el.dataset.id}/initialize`,
      });
    } else if (action === 'show-create') {
      window.Router.openModal(createModal());
    } else if (action === 'do-create') {
      const get = (f) => { const el = document.querySelector(`[data-field="${f}"]`); return el ? el.value.trim() : ''; };
      const name = get('name'), type = get('type');
      if (!name || !type) return toast('Name and type are required', 'warn');
      let config;
      try { config = JSON.parse(get('config') || '{}'); }
      catch (e) { return toast('Configuration must be valid JSON', 'warn'); }
      try {
        await api.post('/api/connections', { name, type, description: get('description'), config });
        window.Router.closeModal();
        toast('Connection created', 'success');
        refresh();
      } catch (err) { toast('Failed to create connection: ' + err.message, 'danger'); }
    } else if (action === 'delete') {
      if (!confirm(`Delete connection "${el.dataset.name}"?`)) return;
      try { await api.del(`/api/connections/${el.dataset.id}`); toast('Connection deleted', 'success'); refresh(); }
      catch (err) { toast('Failed to delete: ' + err.message, 'danger'); }
    }
  }

  window.Router.register('connections', { html, init, handle }, {
    title: 'Data Connections',
    sub: 'Configure source systems, credentials and integrations.',
    crumb: ['System', 'Data Connections'],
  });
})();
