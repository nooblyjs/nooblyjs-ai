/* Schedules screen — /api/schedules.
   Two views in the content area: 'list' (table) and 'create' (full form). */
(function () {
  const { escapeHtml, fmtDateTime, timeAgo, toast } = window.DS.util;
  const api = window.DS.api;

  // Persist each group's open/collapsed state across reloads (mirrors the
  // Workflows screen). Only toggled groups get an entry (false = collapsed);
  // a group with no entry is treated as open, so new groups start expanded.
  const EXPANDED_STORAGE_KEY = 'ds.schedules.expanded';

  function loadExpanded() {
    try {
      const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_err) {
      return {};
    }
  }

  function saveExpanded() {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(local.expanded));
    } catch (_err) {
      /* localStorage unavailable (private mode / quota) — non-fatal */
    }
  }

  const local = { schedules: [], workflows: [], editingId: null, view: 'list', expanded: loadExpanded() };

  function cronOf(s) { return s.cronExpression || s.cron || '—'; }

  /* Map a workflow id to its group label (same grouping the Workflows screen
     shows), so schedules are categorised identically. Falls back to the
     schedule's own group/'ungrouped' when the workflow no longer exists. */
  function workflowGroupMap() {
    const map = {};
    (local.workflows || []).forEach((w) => {
      map[String(w.id)] = w.group || w.directoryName || 'ungrouped';
    });
    return map;
  }

  function groupOf(s, map) {
    const key = String(s.workflowId || '');
    return (key && map[key]) || s.group || 'ungrouped';
  }

  function groupsOf(list, map) {
    const buckets = {};
    list.forEach((s) => { const k = groupOf(s, map); (buckets[k] = buckets[k] || []).push(s); });
    return Object.keys(buckets).sort().map((k) => ({ key: k, items: buckets[k] }));
  }

  /* Schedule records store only a workflowId, so the workflow's display name is
     resolved from the workflows list - used for the row's sub-line and for the
     name the Execution History screen shows in its scope banner. */
  function workflowNameMap() {
    const map = {};
    (local.workflows || []).forEach((w) => { map[String(w.id)] = w.name || ''; });
    return map;
  }

  function workflowNameOf(s, names) {
    return (names && names[String(s.workflowId || '')]) || s.workflowName || s.workflowId || '';
  }

  const RUN_PILL = {
    success: ['succ', 'Success'],
    failed:  ['fail', 'Failed'],
    running: ['run', 'Running'],
  };

  /* Normalise a schedule's own last outcome to one of the pill buckets. The
     scheduler stamps lastRun / lastResult / lastError / executionCount onto the
     schedule record on every fire (workflowBridge's executionCallback), so this
     is the SCHEDULE's own history - not the workflow's, which also counts manual
     runs. A schedule that has never fired answers ''. */
  function lastRunBucket(s) {
    const v = String(s.lastResult || '').toLowerCase();
    if (!s.lastRun && !v) return '';
    if (['success', 'succeeded', 'completed'].includes(v)) return 'success';
    if (['failed', 'error'].includes(v)) return 'failed';
    if (v === 'running') return 'running';
    return 'queued';
  }

  function lastRunCell(s) {
    const bucket = lastRunBucket(s);
    if (!bucket) return '<span class="muted" style="font-size:12px">Never run</span>';
    const [cls, label] = RUN_PILL[bucket] || ['queued', s.lastResult || 'Queued'];
    const runs = s.executionCount
      ? `${s.executionCount} run${s.executionCount === 1 ? '' : 's'}`
      : '';
    /* The failure reason lives only on the schedule record - the history screen
       reads the execution files - so surface it on hover rather than lose it. */
    const tip = [fmtDateTime(s.lastRun), bucket === 'failed' && s.lastError ? String(s.lastError) : '']
      .filter(Boolean).join(' - ');
    return `
      <div class="cell-main" title="${escapeHtml(tip)}">
        <span class="row" style="gap:6px">
          <span class="status-pill ${cls}" style="font-size:11px"><span class="dot"></span> ${escapeHtml(label)}</span>
          <span class="muted" style="font-size:11px">${escapeHtml(timeAgo(s.lastRun))}</span>
        </span>
        <span class="sub">${escapeHtml(runs)}</span>
      </div>`;
  }

  const codeBit = (t) =>
    `<span class="mono" style="background:var(--ink-100);padding:1px 5px;border-radius:3px">${t}</span>`;

  /* Cron hints — includes minute-level granularity. */
  function cronHints() {
    return `<div class="field-help" style="line-height:1.9">
      ${codeBit('* * * * *')} every minute ·
      ${codeBit('*/5 * * * *')} every 5 min ·
      ${codeBit('0 * * * *')} hourly ·
      ${codeBit('0 2 * * *')} daily 02:00 ·
      ${codeBit('0 8 * * 1-5')} weekdays 08:00
      <br><span style="color:var(--ink-400)">Format: minute · hour · day-of-month · month · day-of-week — numbers only (Sunday is 0)</span>
    </div>`;
  }

  /* JSON input-data field. `attr` is data-field (create) or data-edit (edit). */
  function inputField(attr, value, last) {
    return `
      <div class="field"${last ? ' style="margin-bottom:0"' : ''}>
        <label class="field-label">Input data (JSON)</label>
        <textarea class="textarea mono" ${attr}="input" data-json placeholder="{}" style="min-height:84px">${value ? escapeHtml(value) : '{}'}</textarea>
        <div class="field-help" data-json-status>Passed to the workflow each time the schedule runs.</div>
      </div>`;
  }

  /* The schedule's stored input as an editable JSON string. */
  function inputString(s) {
    if (s && s.input && typeof s.input === 'object') return JSON.stringify(s.input, null, 2);
    if (s && typeof s.input === 'string') return s.input;
    return '{}';
  }

  /* Live JSON validation feedback under an input-data textarea. */
  function setJsonStatus(ta) {
    const field = ta.closest('.field');
    const status = field && field.querySelector('[data-json-status]');
    if (!status) return;
    const val = ta.value.trim();
    if (!val || val === '{}') {
      status.textContent = 'Passed to the workflow each time the schedule runs.';
      status.style.color = '';
      return;
    }
    try {
      JSON.parse(val);
      status.innerHTML = `${icon('check', 11)} Valid JSON — passed to the workflow on each run.`;
      status.style.color = 'var(--success-700)';
    } catch (err) {
      status.innerHTML = `${icon('alertCircle', 11)} Invalid JSON: ${escapeHtml(err.message)}`;
      status.style.color = 'var(--danger-700)';
    }
  }

  /* Parse an input-data value; throws a friendly error if invalid. */
  function parseInput(raw) {
    if (!raw || !raw.trim() || raw.trim() === '{}') return {};
    try { return JSON.parse(raw); }
    catch (e) { throw new Error('Input data is not valid JSON'); }
  }

  /* Inline edit form — replaces a schedule's row while editing. */
  function editRow(s, names) {
    const cron = cronOf(s);
    return `
      <tr>
        <td colspan="6" style="background:var(--ink-50);padding:18px 16px;border-left:3px solid var(--gold-500)">
          <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-500);margin-bottom:12px">
            Edit schedule · ${escapeHtml(workflowNameOf(s, names))}
          </div>
          <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px">
            <div class="field" style="margin:0">
              <label class="field-label">Schedule name <span class="req">*</span></label>
              <input class="input" data-edit="name" value="${escapeHtml(s.name || '')}"/>
            </div>
            <div class="field" style="margin:0">
              <label class="field-label">Cron expression <span class="req">*</span></label>
              <input class="input mono" data-edit="cron" value="${escapeHtml(cron === '—' ? '' : cron)}"/>
            </div>
          </div>
          <div class="field" style="margin:12px 0 0">
            <label class="field-label">Description</label>
            <input class="input" data-edit="description" value="${escapeHtml(s.description || '')}"/>
          </div>
          <div style="margin-top:12px">${inputField('data-edit', inputString(s), false)}</div>
          ${cronHints()}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
            <button class="btn btn-sm" data-action="cancel-edit">Cancel</button>
            <button class="btn btn-sm btn-primary" data-action="save-edit" data-id="${escapeHtml(s.id)}">${icon('check', 13)} Save changes</button>
          </div>
        </td>
      </tr>`;
  }

  function viewRow(s, names) {
    const workflowName = workflowNameOf(s, names);
    return `
      <tr>
        <td><div class="cell-main">
          <span class="title">${escapeHtml(s.name || workflowName || 'Schedule')}</span>
          <span class="sub">${escapeHtml(workflowName)}</span>
        </div></td>
        <td><span class="mono" style="background:var(--ink-100);padding:2px 7px;border-radius:4px;font-size:11.5px">${escapeHtml(cronOf(s))}</span></td>
        <td class="muted" style="font-size:12px">${escapeHtml(s.nextRun ? fmtDateTime(s.nextRun) : '—')}</td>
        <td>${lastRunCell(s)}</td>
        <td><span class="badge ${s.enabled ? 'success' : 'neutral'}"><span class="dot"></span> ${s.enabled ? 'Enabled' : 'Paused'}</span></td>
        <td><div class="row row-tight" style="justify-content:flex-end;flex-wrap:nowrap">
          <button class="btn btn-icon-sm" title="Run now" data-action="run" data-id="${escapeHtml(s.id)}">${icon('play', 12)}</button>
          <button class="btn btn-icon-sm" title="Edit" data-action="show-edit" data-id="${escapeHtml(s.id)}">${icon('pencil', 12)}</button>
          <button class="btn btn-icon-sm" title="${s.enabled ? 'Pause' : 'Enable'}" data-action="toggle" data-id="${escapeHtml(s.id)}">${icon(s.enabled ? 'pause' : 'play', 12)}</button>
          <button class="btn btn-icon-sm" title="Delete" data-action="delete" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name || '')}">${icon('trash', 12)}</button>
          <button class="btn btn-icon-sm" title="Execution history" data-action="schedule-history" data-workflow-id="${escapeHtml(s.workflowId || '')}" data-workflow-name="${escapeHtml(workflowName)}">${icon('history', 12)}</button>
        </div></td>
      </tr>`;
  }

  /* Full content-area form for creating a schedule. */
  function createForm() {
    return `
      <button class="btn btn-ghost btn-sm" data-action="cancel-create" style="margin-bottom:14px">
        ${icon('chevronLeft', 13)} Back to schedules
      </button>
      <div class="grid-2" style="grid-template-columns:1fr 320px;align-items:flex-start;gap:18px">
        <div class="card">
          <div class="card-head"><div class="card-title">${icon('schedule', 16)} New schedule</div></div>
          <div class="card-pad">
            <div class="field">
              <label class="field-label">Workflow <span class="req">*</span></label>
              <select class="select" data-field="workflowId">
                <option value="">Select a workflow…</option>
                ${local.workflows.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label">Schedule name <span class="req">*</span></label>
              <input class="input" data-field="name" placeholder="e.g., Nightly ingest"/>
            </div>
            <div class="field">
              <label class="field-label">Cron expression <span class="req">*</span></label>
              <input class="input mono" data-field="cron" value="0 2 * * *"/>
              ${cronHints()}
            </div>
            <div class="field">
              <label class="field-label">Description</label>
              <textarea class="textarea" data-field="description" placeholder="Optional"></textarea>
            </div>
            ${inputField('data-field', '', true)}
          </div>
        </div>
        <div class="card"><div class="card-pad">
          <div class="card-title" style="margin-bottom:10px">${icon('plus', 15)} Create</div>
          <p style="font-size:12px;color:var(--ink-500);margin:0 0 12px">
            Schedule this workflow to run automatically on the cron expression.
          </p>
          <button class="btn btn-primary" style="width:100%;justify-content:center" data-action="do-create">
            ${icon('check', 14)} Create schedule
          </button>
          <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px" data-action="cancel-create">Cancel</button>
        </div></div>
      </div>`;
  }

  /* The per-group table of schedules (thead + tbody). Extracted so every
     group renders an identical table. */
  function scheduleTable(items, names) {
    return `
      <table class="table">
        <thead><tr>
          <th>Schedule</th><th style="width:150px">Cron</th>
          <th style="width:165px">Next run</th><th style="width:175px">Last run</th>
          <th style="width:110px">Status</th>
          <th style="width:192px"></th>
        </tr></thead>
        <tbody>
          ${items.map(s => (String(s.id) === String(local.editingId) ? editRow(s, names) : viewRow(s, names))).join('')}
        </tbody>
      </table>`;
  }

  function listView() {
    const list = local.schedules;
    if (!list.length) {
      return `<div class="card"><div class="empty-state">
        <div class="ico">${icon('schedule', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No schedules</div>
        <div style="font-size:12.5px;margin:4px 0 14px">Schedule a workflow to run automatically on a cron expression.</div>
        <button class="btn btn-primary btn-sm" data-action="show-create">${icon('plus', 13)} New schedule</button>
      </div></div>`;
    }
    const groups = groupsOf(list, workflowGroupMap());
    const names = workflowNameMap();
    return `
      <div class="row" style="justify-content:flex-end;margin-bottom:14px">
        <button class="btn btn-primary" data-action="show-create">${icon('plus', 14)} New schedule</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${groups.map(g => {
          const open = local.expanded[g.key] !== false;
          return `
            <div class="workflow-group">
              <div class="group-head" data-action="toggle-group" data-key="${escapeHtml(g.key)}">
                ${icon(open ? 'chevronDown' : 'chevronRight', 14)}
                <span class="ico">${icon(open ? 'folderOpen' : 'folder', 16)}</span>
                <div><div class="name">${escapeHtml(g.key)}</div>
                  <div class="meta">${g.items.length} schedule${g.items.length === 1 ? '' : 's'}</div></div>
                <span class="group-count">${g.items.length}</span>
              </div>
              ${open ? `<div class="table-wrap" style="border-radius:0 0 10px 10px;border-top:none">
                ${scheduleTable(g.items, names)}
              </div>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  }

  function renderBody() {
    return local.view === 'create' ? createForm() : listView();
  }

  function html() {
    const actions = `<button class="btn" data-action="refresh">${icon('refresh', 14)} Refresh</button>`;
    return `${pageHead('schedules', actions)}<div data-region="body"></div>`;
  }

  function init(root) {
    local.view = 'list';
    local.editingId = null;
    window.DS.util.loadRegion(root, async () => {
      const [sch, wf] = await Promise.all([
        api.get('/api/schedules'),
        api.get('/api/workflows/list').catch(() => []),
      ]);
      local.schedules = sch || [];
      local.workflows = wf || [];
      return true;
    }, () => renderBody());
  }

  function paint() {
    const region = document.querySelector('#mainContent .kr-ds[data-screen="schedules"] [data-region="body"]');
    if (region) region.innerHTML = renderBody();
  }

  async function refresh() {
    local.schedules = await api.get('/api/schedules') || [];
    rerenderScreen();
  }

  async function handle(action, el) {
    if (action === 'retry' || action === 'refresh') return rerenderScreen();
    if (action === 'schedule-history') {
      /* Execution History screen, scoped to the workflow this schedule runs -
         the same view the Workflows screen's History button opens. Executions
         are keyed by workflow, so a workflow carrying two schedules shows both
         schedules' runs there; the row's own Last run cell is the
         schedule-specific answer. */
      const workflowId = el.dataset.workflowId;
      if (!workflowId) return toast('This schedule has no workflow to show history for', 'warn');
      return navTo('executions', { workflowId, workflowName: el.dataset.workflowName || workflowId });
    }
    if (action === 'toggle-group') {
      const k = el.dataset.key;
      local.expanded[k] = local.expanded[k] === false;
      saveExpanded();
      return paint();
    }
    if (action === 'show-create') {
      local.view = 'create';
      local.editingId = null;
      paint();
    } else if (action === 'cancel-create') {
      local.view = 'list';
      paint();
    } else if (action === 'do-create') {
      const get = (f) => { const e = document.querySelector(`[data-field="${f}"]`); return e ? e.value.trim() : ''; };
      const workflowId = get('workflowId'), name = get('name'), cron = get('cron');
      if (!workflowId || !name || !cron) return toast('Workflow, name and cron are required', 'warn');
      let input;
      try { input = parseInput(get('input')); }
      catch (e) { return toast(e.message, 'warn'); }
      try {
        await api.post('/api/schedules', { workflowId, name, cron, description: get('description'), input, enabled: true });
        local.view = 'list';
        toast('Schedule created', 'success');
        refresh();
      } catch (err) { toast('Failed to create schedule: ' + err.message, 'danger'); }
    } else if (action === 'show-edit') {
      local.editingId = el.dataset.id;
      paint();
    } else if (action === 'cancel-edit') {
      local.editingId = null;
      paint();
    } else if (action === 'save-edit') {
      const get = (f) => { const e = document.querySelector(`[data-edit="${f}"]`); return e ? e.value.trim() : ''; };
      const name = get('name'), cron = get('cron');
      if (!name || !cron) return toast('Name and cron are required', 'warn');
      let input;
      try { input = parseInput(get('input')); }
      catch (e) { return toast(e.message, 'warn'); }
      try {
        await api.put(`/api/schedules/${el.dataset.id}`,
          { name, cronExpression: cron, description: get('description'), input });
        local.editingId = null;
        toast('Schedule updated', 'success');
        refresh();
      } catch (err) { toast('Failed to update schedule: ' + err.message, 'danger'); }
    } else if (action === 'toggle') {
      try { await api.post(`/api/schedules/${el.dataset.id}/toggle`, {}); refresh(); }
      catch (err) { toast('Failed to toggle: ' + err.message, 'danger'); }
    } else if (action === 'run') {
      try { await api.post(`/api/schedules/${el.dataset.id}/run-now`, {}); toast('Schedule triggered', 'success'); }
      catch (err) { toast('Failed to run: ' + err.message, 'danger'); }
    } else if (action === 'delete') {
      if (!confirm(`Delete schedule "${el.dataset.name}"?`)) return;
      try { await api.del(`/api/schedules/${el.dataset.id}`); toast('Schedule deleted', 'success'); refresh(); }
      catch (err) { toast('Failed to delete: ' + err.message, 'danger'); }
    }
  }

  /* Live JSON validation for input-data textareas. */
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-json')) setJsonStatus(t);
  });

  window.Router.register('schedules', { html, init, handle }, {
    title: 'Schedules',
    sub: 'Manage cron schedules for automated workflow execution.',
    crumb: ['Datasources', 'Schedules'],
  });
})();
