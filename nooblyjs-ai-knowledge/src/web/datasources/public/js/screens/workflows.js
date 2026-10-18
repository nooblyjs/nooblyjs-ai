/* Workflows screen — grouped list from /api/workflows/list */
(function () {
  const { escapeHtml, fmtDateTime, fmtDuration, timeAgo, describeCron, cronRejection, toast } = window.DS.util;
  const api = window.DS.api;

  // Persist each workflow group's open/collapsed state across reloads. The map
  // holds an entry only for groups the user has toggled (false = collapsed); a
  // group with no entry is treated as open, so brand-new groups start expanded.
  const EXPANDED_STORAGE_KEY = 'ds.workflows.expanded';

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

  const local = {
    workflows: [],
    lastRuns: {},
    expanded: loadExpanded(),
    search: '',
    statusFilter: '',
    lastRunFilter: '', // Filter by last run status: '' (all), 'success', 'failed', 'running'
    starredOnly: false,
  };

  function groupKey(w) { return w.group || w.directoryName || 'ungrouped'; }

  function statusBadge(s) {
    if (s === 'active')   return `<span class="badge success"><span class="dot"></span> Active</span>`;
    if (s === 'inactive') return `<span class="badge neutral">Inactive</span>`;
    if (s === 'draft')    return `<span class="badge warn">Draft</span>`;
    return `<span class="badge neutral">Unscheduled</span>`;
  }

  /* Normalise an execution outcome to one of the four buckets the pill styles
     and the filter chips share. A workflow with no run at all answers ''. */
  function lastRunStatus(workflowId) {
    const run = local.lastRuns[workflowId];
    if (!run) return '';
    const s = (run.status || '').toLowerCase();
    if (['success', 'succeeded', 'completed'].includes(s)) return 'success';
    if (['failed', 'error'].includes(s)) return 'failed';
    if (s === 'running') return 'running';
    return 'queued';
  }

  const RUN_PILL = {
    success: ['succ', 'Success'],
    failed:  ['fail', 'Failed'],
    running: ['run', 'Running'],
  };

  function lastRunDisplay(w) {
    const run = local.lastRuns[w.id];
    if (!run) return '<span class="muted" style="font-size:12px">—</span>';
    const bucket = lastRunStatus(w.id);
    const [cls, label] = RUN_PILL[bucket] || ['queued', run.status || 'Queued'];
    return `
      <div class="cell-main">
        <span class="row" style="gap:6px">
          <span class="status-pill ${cls}" style="font-size:11px"><span class="dot"></span> ${escapeHtml(label)}</span>
          <span class="muted" style="font-size:11px">${escapeHtml(timeAgo(run.startedAt))}</span>
        </span>
        <span class="sub mono">${escapeHtml(fmtDuration(run.duration))}</span>
      </div>`;
  }

  function filtered() {
    const q = local.search.trim().toLowerCase();
    return local.workflows.filter(w => {
      if (local.starredOnly && !w.starred) return false;
      if (local.statusFilter && (w.status || 'unscheduled') !== local.statusFilter) return false;
      if (local.lastRunFilter && lastRunStatus(w.id) !== local.lastRunFilter) return false;
      if (!q) return true;
      return (w.name || '').toLowerCase().includes(q)
        || (w.description || '').toLowerCase().includes(q)
        || groupKey(w).toLowerCase().includes(q)
        || (w.tags || []).some(t => String(t).toLowerCase().includes(q));
    });
  }

  function groupsOf(list) {
    const map = {};
    list.forEach(w => { (map[groupKey(w)] = map[groupKey(w)] || []).push(w); });
    return Object.keys(map).sort().map(k => ({ key: k, workflows: map[k] }));
  }

  function renderBody() {
    const list = filtered();
    const groups = groupsOf(list);
    return `
      <div class="card" style="margin-bottom:16px;padding:12px 16px">
        <div class="between" style="flex-wrap:wrap;gap:12px">
          <div class="input-icon-wrap" style="flex:1 1 280px;max-width:420px">
            <span class="ico">${icon('search', 14)}</span>
            <input class="input" data-field="search" placeholder="Search workflows by name, tag, group…" value="${escapeHtml(local.search)}"/>
          </div>
          <div class="row" style="gap:8px">
            <select class="select" data-field="status" style="width:150px">
              <option value="">All status</option>
              <option value="active"${local.statusFilter === 'active' ? ' selected' : ''}>Active</option>
              <option value="inactive"${local.statusFilter === 'inactive' ? ' selected' : ''}>Inactive</option>
              <option value="draft"${local.statusFilter === 'draft' ? ' selected' : ''}>Draft</option>
            </select>
            <div class="chip ${local.starredOnly ? 'active' : ''}" data-action="toggle-starred">${icon('star', 12)} Starred</div>
            <button class="btn btn-sm" data-action="refresh-last-runs" title="Refresh last run data">${icon('refresh', 12)} Refresh</button>
          </div>
        </div>
        <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
          <div class="chip ${local.lastRunFilter === '' ? 'active' : ''}" data-action="filter-last-run" data-status="">All runs</div>
          <div class="chip ${local.lastRunFilter === 'success' ? 'active' : ''}" data-action="filter-last-run" data-status="success"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#2e7d32;margin-right:4px"></span>Success</div>
          <div class="chip ${local.lastRunFilter === 'failed' ? 'active' : ''}" data-action="filter-last-run" data-status="failed"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#c62828;margin-right:4px"></span>Failed</div>
          <div class="chip ${local.lastRunFilter === 'running' ? 'active' : ''}" data-action="filter-last-run" data-status="running"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#e65100;margin-right:4px"></span>Running</div>
        </div>
      </div>

      ${groups.length ? `<div style="display:flex;flex-direction:column;gap:16px">
        ${groups.map(g => {
          const open = local.expanded[g.key] !== false;
          return `
            <div class="workflow-group">
              <div class="group-head" data-action="toggle-group" data-key="${escapeHtml(g.key)}">
                ${icon(open ? 'chevronDown' : 'chevronRight', 14)}
                <span class="ico">${icon(open ? 'folderOpen' : 'folder', 16)}</span>
                <div><div class="name">${escapeHtml(g.key)}</div>
                  <div class="meta">${g.workflows.length} workflow${g.workflows.length === 1 ? '' : 's'}</div></div>
                <span class="group-count">${g.workflows.length}</span>
              </div>
              ${open ? `<div class="table-wrap" style="border-radius:0 0 10px 10px;border-top:none">
                <table class="table">
                  <thead><tr>
                    <th style="width:34px"></th><th>Name</th>
                    <th style="width:110px">Status</th><th style="width:80px">Steps</th>
                    <th style="width:150px">Tags</th><th style="width:160px">Modified</th>
                    <th style="width:180px">Last Run</th>
                    <th style="width:186px"></th>
                  </tr></thead>
                  <tbody>
                    ${g.workflows.map(w => `
                      <tr>
                        <td><div class="star ${w.starred ? 'on' : ''}" data-action="toggle-star" data-id="${escapeHtml(w.id)}">
                          ${icon(w.starred ? 'starFilled' : 'star', 15)}</div></td>
                        <td><div class="cell-main">
                          <span class="title">${escapeHtml(w.name)}</span>
                          <span class="sub" style="max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(w.description || '')}</span>
                        </div></td>
                        <td>${statusBadge(w.status)}</td>
                        <td><span class="row" style="gap:6px;font-size:12px">
                          <span style="color:var(--ink-400);display:inline-flex">${icon('layers', 12)}</span>${(w.steps || []).length}</span></td>
                        <td><div class="row" style="gap:4px">${(w.tags || []).slice(0, 3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('') || '<span class="muted" style="font-size:12px">—</span>'}</div></td>
                        <td class="muted mono" style="font-size:11.5px">${escapeHtml(fmtDateTime(w.modifiedAt || w.updatedAt))}</td>
                        <td>${lastRunDisplay(w)}</td>
                        <td><div class="row row-tight" style="justify-content:flex-end;flex-wrap:nowrap">
                          <button class="btn btn-icon-sm" title="Run now" data-action="run-workflow" data-id="${escapeHtml(w.id)}">${icon('play', 12)}</button>
                          <button class="btn btn-icon-sm" title="Schedule" data-action="schedule-workflow" data-id="${escapeHtml(w.id)}">${icon('schedule', 12)}</button>
                          <button class="btn btn-icon-sm" title="Edit" data-action="edit-workflow" data-id="${escapeHtml(w.id)}">${icon('pencil', 12)}</button>
                          <button class="btn btn-icon-sm" title="Delete" data-action="delete-workflow" data-id="${escapeHtml(w.id)}" data-name="${escapeHtml(w.name)}">${icon('trash', 12)}</button>
                          <button class="btn btn-icon-sm" title="Execution history" data-action="workflow-history" data-id="${escapeHtml(w.id)}" data-name="${escapeHtml(w.name)}">${icon('history', 12)}</button>
                        </div></td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>` : ''}
            </div>`;
        }).join('')}
      </div>` : `<div class="card"><div class="empty-state">
        <div class="ico">${icon('workflow', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No workflows found</div>
        <div style="font-size:12.5px;margin:4px 0 14px">${local.workflows.length ? 'Try adjusting your search or filters.' : 'Create your first workflow to get started.'}</div>
        <button class="btn btn-primary btn-sm" data-action="nav" data-screen="workflowEdit">${icon('plus', 13)} New workflow</button>
      </div></div>`}

      <div style="margin-top:18px;color:var(--ink-500);font-size:12px;text-align:center">
        Showing ${list.length} of ${local.workflows.length} workflows · ${groups.length} group${groups.length === 1 ? '' : 's'}
      </div>`;
  }

  function html() {
    const actions = `
      <button class="btn" data-action="show-import">${icon('import', 14)} Import</button>
      <button class="btn btn-primary" data-action="nav" data-screen="workflowEdit">${icon('plus', 14)} New workflow</button>`;
    return `${pageHead('workflows', actions)}<div data-region="body"></div>`;
  }

  function paint(root) {
    root.querySelector('[data-region="body"]').innerHTML = renderBody();
  }

  /* Last-run status is DECORATION on a list that must render without it, so a
     failure here leaves every row showing "—" rather than emptying the screen. */
  async function loadLastRuns({ fresh = false } = {}) {
    try {
      local.lastRuns = await api.get(`/api/workflows/last-runs${fresh ? '?nocache=true' : ''}`) || {};
      return true;
    } catch (err) {
      console.warn('[workflows] last-run status unavailable:', err.message);
      local.lastRuns = {};
      return false;
    }
  }

  function init(root) {
    window.DS.util.loadRegion(root, async () => {
      local.workflows = await api.get('/api/workflows/list') || [];
      await loadLastRuns();
      return true;
    }, () => renderBody());
  }

  async function refresh() {
    local.workflows = await api.get('/api/workflows/list') || [];
    await loadLastRuns();
    rerenderScreen();
  }

  function importModal() {
    return `
      <div class="modal-card" style="width:520px">
        <div class="card-head">
          <div class="card-title">${icon('upload', 16)} Import workflow</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad">
          <div class="field">
            <label class="field-label">Workflow JSON</label>
            <input class="input" type="file" accept="application/json,.json" data-field="import-file"/>
            <div class="field-help">A workflow exported from this application (.json).</div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
            <button class="btn" data-action="modal-close">Cancel</button>
            <button class="btn btn-primary" data-action="do-import">${icon('upload', 13)} Import</button>
          </div>
        </div>
      </div>`;
  }

  /* The name a quick schedule is created under: "<workflow> - <cron in
     English>". An expression describeCron() cannot phrase is not silently
     dropped from the name - the raw expression stands in, so the schedule is
     still identifiable in the list. */
  function quickScheduleName(workflowName, cron) {
    const phrase = describeCron(cron) || String(cron || '').trim();
    return phrase ? workflowName + ' - ' + phrase : workflowName;
  }

  /* Numeric day-of-week deliberately: this scheduler does not read MON-FRI. */
  const QUICK_CRON_PRESETS = [
    ['0 * * * *', 'Hourly'],
    ['0 2 * * *', 'Daily 02:00'],
    ['0 8 * * 1-5', 'Weekdays 08:00'],
    ['0 0 1 * *', 'Monthly'],
  ];

  /* Ask for a cron expression and nothing else - the schedule's name is derived
     from it, and everything else (description, input data, pausing) is editable
     on the Schedules screen afterwards. */
  function scheduleModal(w) {
    const cron = '0 2 * * *';
    return `
      <div class="modal-card" style="width:540px">
        <div class="card-head">
          <div class="card-title">${icon('schedule', 16)} Schedule workflow</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad">
          <div class="field">
            <label class="field-label">Workflow</label>
            <div class="input" style="background:var(--ink-50);color:var(--ink-700)">${escapeHtml(w.name)}</div>
          </div>
          <div class="field">
            <label class="field-label">Cron expression <span class="req">*</span></label>
            <input class="input mono" data-field="quick-cron" data-workflow-name="${escapeHtml(w.name)}"
                   value="${cron}" spellcheck="false" autocomplete="off"/>
            <div class="field-help" data-quick-cron-status></div>
            <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
              ${QUICK_CRON_PRESETS.map(([expr, label]) =>
                `<div class="chip" data-action="quick-cron-preset" data-cron="${escapeHtml(expr)}">${escapeHtml(label)}</div>`).join('')}
            </div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">Schedule name</label>
            <div class="input mono" style="background:var(--ink-50);color:var(--ink-700);font-size:12px"
                 data-quick-cron-name>${escapeHtml(quickScheduleName(w.name, cron))}</div>
            <div class="field-help">Derived from the workflow name and the cron expression.</div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
            <button class="btn" data-action="modal-close">Cancel</button>
            <button class="btn btn-primary" data-action="do-quick-schedule" data-id="${escapeHtml(w.id)}">${icon('check', 13)} Create schedule</button>
          </div>
        </div>
      </div>`;
  }

  /* Repaint the modal's interpretation + derived name from the cron field. */
  function refreshQuickSchedule() {
    const input = document.querySelector('[data-field="quick-cron"]');
    if (!input) return null;
    const cron = input.value.trim();
    const phrase = describeCron(cron);
    /* Readable and acceptable are two different questions - "0 8 * * MON-FRI"
       passes the first and fails the second - and the reader needs the answer
       to the second BEFORE pressing Create. */
    const rejection = cron ? cronRejection(cron) : 'Enter a cron expression';
    const status = document.querySelector('[data-quick-cron-status]');
    const name = document.querySelector('[data-quick-cron-name]');
    if (status) {
      status.innerHTML = rejection
        ? `${icon('alertCircle', 11)} ${escapeHtml(rejection)}. Format: minute · hour · day-of-month · month · day-of-week.`
        : `${icon('check', 11)} Runs ${escapeHtml(phrase.charAt(0).toLowerCase() + phrase.slice(1))}.`;
      status.style.color = rejection ? 'var(--danger-700)' : 'var(--success-700)';
    }
    if (name) name.textContent = quickScheduleName(input.dataset.workflowName || '', cron);
    return rejection ? null : cron;
  }

  async function handle(action, el, e, state) {
    const root = document.querySelector('#mainContent .kr-ds');
    if (action === 'retry') return rerenderScreen();
    if (action === 'refresh-last-runs') {
      const ok = await loadLastRuns({ fresh: true });
      paint(root);
      toast(ok ? 'Last run status updated' : 'Could not refresh last run status', ok ? 'success' : 'danger');
    } else if (action === 'filter-last-run') {
      local.lastRunFilter = el.dataset.status;
      paint(root);
    } else if (action === 'toggle-group') {
      const k = el.dataset.key;
      local.expanded[k] = local.expanded[k] === false;
      saveExpanded();
      paint(root);
    } else if (action === 'toggle-starred') {
      local.starredOnly = !local.starredOnly;
      paint(root);
    } else if (action === 'toggle-star') {
      const id = el.dataset.id;
      const wf = local.workflows.find(w => String(w.id) === String(id));
      if (wf) wf.starred = !wf.starred;
      paint(root);
      try { await api.post(`/api/workflows/${id}/star`, { starred: wf ? wf.starred : true }); }
      catch (err) { toast('Failed to update star: ' + err.message, 'danger'); refresh(); }
    } else if (action === 'edit-workflow') {
      navTo('workflowEdit', { id: el.dataset.id });
    } else if (action === 'workflow-history') {
      /* Execution History screen, scoped to this workflow — it reads across the
         per-day files, so a busy neighbour can't bury this workflow's runs. */
      navTo('executions', { workflowId: el.dataset.id, workflowName: el.dataset.name });
    } else if (action === 'schedule-workflow') {
      const wf = local.workflows.find(w => String(w.id) === String(el.dataset.id));
      if (!wf) return toast('Workflow not found', 'danger');
      window.Router.openModal(scheduleModal(wf));
      refreshQuickSchedule();
    } else if (action === 'quick-cron-preset') {
      const input = document.querySelector('[data-field="quick-cron"]');
      if (input) { input.value = el.dataset.cron; input.focus(); }
      refreshQuickSchedule();
    } else if (action === 'do-quick-schedule') {
      const id = el.dataset.id;
      const input = document.querySelector('[data-field="quick-cron"]');
      const wf = local.workflows.find(w => String(w.id) === String(id));
      if (!input || !wf) return toast('Workflow not found', 'danger');
      const cron = input.value.trim();
      const rejection = cron ? cronRejection(cron) : 'Enter a cron expression';
      if (rejection) {
        refreshQuickSchedule();
        return toast(rejection, 'warn');
      }
      const name = quickScheduleName(wf.name, cron);
      try {
        await api.post('/api/schedules', { workflowId: id, name, cron, enabled: true });
        window.Router.closeModal();
        toast('Scheduled — ' + name, 'success');
        /* The row's Status badge is derived server-side from whether the
           workflow has a schedule, so it only becomes "Active" on a re-read. */
        refresh();
      } catch (err) { toast('Failed to create schedule: ' + err.message, 'danger'); }
    } else if (action === 'run-workflow') {
      const id = el.dataset.id;
      toast('Starting workflow…', 'info');
      try {
        await api.post(`/api/workflows/${id}/execute`, {});
        toast('Workflow execution started', 'success');
      } catch (err) { toast('Failed to run workflow: ' + err.message, 'danger'); }
    } else if (action === 'delete-workflow') {
      const id = el.dataset.id, name = el.dataset.name;
      if (!confirm(`Delete workflow "${name}"? This cannot be undone.`)) return;
      try {
        await api.del(`/api/workflows/${id}`);
        toast('Workflow deleted', 'success');
        refresh();
      } catch (err) { toast('Failed to delete: ' + err.message, 'danger'); }
    } else if (action === 'show-import') {
      window.Router.openModal(importModal());
    } else if (action === 'do-import') {
      const input = document.querySelector('[data-field="import-file"]');
      const file = input && input.files && input.files[0];
      if (!file) return toast('Choose a JSON file first', 'warn');
      try {
        const text = await file.text();
        await api.post('/api/workflows/import', JSON.parse(text));
        window.Router.closeModal();
        toast('Workflow imported', 'success');
        refresh();
      } catch (err) { toast('Import failed: ' + err.message, 'danger'); }
    }
  }

  /* React to inline filter inputs without a full re-render. */
  function onInput(e) {
    const f = e.target.dataset.field;
    if (f === 'search') { local.search = e.target.value; repaintSoon(); }
    else if (f === 'status') { local.statusFilter = e.target.value; repaint(); }
    else if (f === 'quick-cron') { refreshQuickSchedule(); }
  }
  let t;
  function repaintSoon() { clearTimeout(t); t = setTimeout(repaint, 200); }
  function repaint() {
    const root = document.querySelector('#mainContent .kr-ds');
    if (!root || root.dataset.screen !== 'workflows') return;
    const region = root.querySelector('[data-region="body"]');
    const active = document.activeElement;
    const caret = active && active.dataset && active.dataset.field === 'search' ? active.selectionStart : null;
    region.innerHTML = renderBody();
    if (caret !== null) {
      const s = region.querySelector('[data-field="search"]');
      if (s) { s.focus(); s.setSelectionRange(caret, caret); }
    }
  }

  document.addEventListener('input', onInput);

  window.Router.register('workflows', { html, init, handle }, {
    title: 'Workflows',
    sub: 'Manage and execute your data processing workflows.',
    crumb: ['Datasources', 'Workflows'],
  });
})();
