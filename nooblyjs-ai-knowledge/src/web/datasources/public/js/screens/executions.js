/* Execution history screen — /api/executions + /api/executions/stats */
(function () {
  const { escapeHtml, fmtDuration, fmtDateTime, timeAgo, toast } = window.DS.util;
  const api = window.DS.api;

  // Persist each group's open/collapsed state across reloads (mirrors the
  // Workflows screen). Only toggled groups get an entry (false = collapsed);
  // a group with no entry is treated as open, so new groups start expanded.
  const EXPANDED_STORAGE_KEY = 'ds.executions.expanded';

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

  /* Look-back windows offered when the screen is scoped to one workflow.
     0 = every day file on record. */
  const DAY_RANGES = [
    { days: 7,  label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
    { days: 0,  label: 'All' },
  ];
  const SCOPED_LIMIT = 300;

  const local = {
    executions: [], workflows: [], stats: null, statusFilter: '', expanded: loadExpanded(),
    /* Set from the router params when arrived at from a workflow's History
       button: { workflowId, workflowName }. Null = the all-workflows view. */
    scope: null,
    days: 30,
    window: null,
  };

  /* Map a workflow id to its group label (same grouping the Workflows screen
     shows), so execution runs are categorised identically. Falls back to the
     record's own group/'ungrouped' when the workflow no longer exists. */
  function workflowGroupMap() {
    const map = {};
    (local.workflows || []).forEach((w) => {
      map[String(w.id)] = w.group || w.directoryName || 'ungrouped';
    });
    return map;
  }

  function groupOf(e, map) {
    const key = String(e.workflowId || '');
    return (key && map[key]) || e.group || 'ungrouped';
  }

  function groupsOf(list, map) {
    const buckets = {};
    list.forEach((e) => { const k = groupOf(e, map); (buckets[k] = buckets[k] || []).push(e); });
    return Object.keys(buckets).sort().map((k) => ({ key: k, items: buckets[k] }));
  }

  function statusPill(s) {
    const v = (s || '').toLowerCase();
    if (v === 'success' || v === 'succeeded' || v === 'completed')
      return `<span class="status-pill succ"><span class="dot"></span> Succeeded</span>`;
    if (v === 'failed' || v === 'error')
      return `<span class="status-pill fail"><span class="dot"></span> Failed</span>`;
    if (v === 'running')
      return `<span class="status-pill run"><span class="dot"></span> Running</span>`;
    return `<span class="status-pill queued"><span class="dot"></span> ${escapeHtml(s || 'Queued')}</span>`;
  }

  function outcomeOf(e) { return (e.outcome || e.status || '').toLowerCase(); }

  function filtered() {
    /* Scoped mode filters server-side: the window can hold far more runs than
       the page returns, so filtering the page would hide older failures. */
    if (local.scope || !local.statusFilter) return local.executions;
    return local.executions.filter(e => {
      const o = outcomeOf(e);
      if (local.statusFilter === 'success') return ['success', 'succeeded', 'completed'].includes(o);
      if (local.statusFilter === 'failed') return ['failed', 'error'].includes(o);
      return o === local.statusFilter;
    });
  }

  function statStrip() {
    const s = local.stats || {};
    const total = s.total !== undefined ? s.total : local.executions.length;
    /* The stats endpoint answers with `succeeded`; older shapes used
       successful/success. Miss the first and the tile reads "—" while the
       success rate beside it shows 100%. */
    const succ = s.succeeded !== undefined ? s.succeeded
      : (s.successful !== undefined ? s.successful : s.success);
    const fail = s.failed !== undefined ? s.failed : s.failures;
    const rate = s.successRate !== undefined ? s.successRate
      : (total ? Math.round(((succ || 0) / total) * 100) : 0);
    return `
      <div class="stat-strip" style="margin-bottom:18px">
        <div class="stat"><div class="label">Total runs</div><div class="value">${total}</div></div>
        <div class="stat"><div class="label">Succeeded</div><div class="value" style="color:var(--success-700)">${succ !== undefined ? succ : '—'}</div></div>
        <div class="stat"><div class="label">Failed</div><div class="value" style="color:var(--danger-700)">${fail !== undefined ? fail : '—'}</div></div>
        <div class="stat"><div class="label">Success rate</div><div class="value">${rate}%</div></div>
      </div>`;
  }

  function execRow(e) {
    const id = e.id || e.executionId;
    return `<tr>
      <td><div class="cell-main">
        <span class="title">${escapeHtml(e.workflowName || e.name || 'Workflow')}</span>
        <span class="sub mono">${escapeHtml(String(id || '').slice(0, 12))}</span>
      </div></td>
      <td class="muted" style="font-size:12px">${escapeHtml(timeAgo(e.startedAt || e.executedAt || e.timestamp))}</td>
      <td class="mono">${fmtDuration(e.duration)}</td>
      <td>${statusPill(e.outcome || e.status)}</td>
      <td><button class="btn btn-icon-sm" title="Details" data-action="view" data-id="${escapeHtml(id)}">${icon('eye', 13)}</button></td>
    </tr>`;
  }

  /* The per-group table of executions (thead + tbody). Extracted so every
     group renders an identical table. */
  function execTable(items) {
    return `
      <table class="table">
        <thead><tr>
          <th>Workflow</th><th style="width:170px">Started</th>
          <th style="width:110px">Duration</th><th style="width:140px">Status</th>
          <th style="width:80px"></th>
        </tr></thead>
        <tbody>${items.map(execRow).join('')}</tbody>
      </table>`;
  }

  /* ---------- Scoped mode: one workflow's history across the day files ---------- */

  /* A run of the scoped workflow. The workflow name is in the banner above, so
     the first column carries what the all-workflows table can't afford: the
     absolute date of the run, which is the whole point of looking back. */
  function scopedRow(e) {
    const id = e.id || e.executionId;
    const started = e.startedAt || e.executedAt || e.timestamp;
    return `<tr>
      <td><div class="cell-main">
        <span class="title">${escapeHtml(fmtDateTime(started))}</span>
        <span class="sub">${escapeHtml(timeAgo(started))}</span>
      </div></td>
      <td class="muted mono" style="font-size:11px">${escapeHtml(String(id || '').slice(0, 12))}</td>
      <td class="mono">${fmtDuration(e.duration)}</td>
      <td>${statusPill(e.outcome || e.status)}</td>
      <td><button class="btn btn-icon-sm" title="Details" data-action="view" data-id="${escapeHtml(id)}">${icon('eye', 13)}</button></td>
    </tr>`;
  }

  function windowLabel() {
    const w = local.window || {};
    if (w.days) return `last ${w.days} days`;
    if (w.daysAvailable) return `all ${w.daysAvailable} day${w.daysAvailable === 1 ? '' : 's'} on record`;
    return 'all history';
  }

  function scopeBanner() {
    const w = local.window || {};
    const shown = local.executions.length;
    const matched = w.matched !== undefined ? w.matched : shown;
    // With a status chip on, these numbers describe the filtered runs — say so,
    // or "3 runs" reads as the workflow's whole history.
    const noun = local.statusFilter ? `${local.statusFilter} run` : 'run';
    const counts = w.truncated
      ? `Showing the ${shown} most recent of ${matched} ${noun}s`
      : `${shown} ${noun}${shown === 1 ? '' : 's'}`;
    return `
      <div class="card" style="margin-bottom:16px;padding:12px 16px">
        <div class="between" style="flex-wrap:wrap;gap:12px">
          <div class="row" style="gap:10px">
            <span style="color:var(--gold-700);display:inline-flex">${icon('workflow', 16)}</span>
            <div>
              <div style="font-weight:600;font-size:12px;color:var(--ink-900)">${escapeHtml(local.scope.workflowName || local.scope.workflowId)}</div>
              <div style="font-size:11px;color:var(--ink-500)">${escapeHtml(counts)} · ${escapeHtml(windowLabel())}</div>
            </div>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            ${DAY_RANGES.map(r => `
              <div class="chip ${local.days === r.days ? 'active' : ''}" data-action="set-days" data-days="${r.days}">${r.label}</div>`).join('')}
            <button class="btn btn-sm" data-action="clear-scope">${icon('list', 13)} All workflows</button>
          </div>
        </div>
      </div>`;
  }

  function renderScoped() {
    const list = local.executions;
    return `
      ${scopeBanner()}
      ${statStrip()}
      <div class="card" style="margin:16px 0;padding:12px 16px">
        <div class="row" style="gap:8px">
          ${['', 'success', 'failed', 'running'].map(v => `
            <div class="chip ${local.statusFilter === v ? 'active' : ''}" data-action="filter" data-value="${v}">
              ${v === '' ? 'All' : v[0].toUpperCase() + v.slice(1)}
            </div>`).join('')}
          <button class="btn btn-sm" style="margin-left:auto" data-action="refresh">${icon('refresh', 13)} Refresh</button>
        </div>
      </div>

      ${list.length ? `<div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th style="width:200px">Started</th><th style="width:130px">Execution</th>
            <th style="width:110px">Duration</th><th style="width:140px">Status</th>
            <th style="width:80px"></th>
          </tr></thead>
          <tbody>${list.map(scopedRow).join('')}</tbody>
        </table>
      </div>` : `<div class="card"><div class="empty-state">
        <div class="ico">${icon('history', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No runs in this window</div>
        <div style="font-size:12.5px;margin-top:4px">Nothing recorded for this workflow in the ${escapeHtml(windowLabel())}${local.statusFilter ? ` with status "${escapeHtml(local.statusFilter)}"` : ''}. Widen the range above to look further back.</div>
      </div></div>`}`;
  }

  function renderBody() {
    if (local.scope) return renderScoped();
    const list = filtered();
    const groups = groupsOf(list, workflowGroupMap());
    return `
      ${statStrip()}
      <div class="card" style="margin-bottom:16px;padding:12px 16px">
        <div class="row" style="gap:8px">
          ${['', 'success', 'failed', 'running'].map(v => `
            <div class="chip ${local.statusFilter === v ? 'active' : ''}" data-action="filter" data-value="${v}">
              ${v === '' ? 'All' : v[0].toUpperCase() + v.slice(1)}
            </div>`).join('')}
          <button class="btn btn-sm" style="margin-left:auto" data-action="refresh">${icon('refresh', 13)} Refresh</button>
          <button class="btn btn-sm btn-danger" data-action="clear-history">${icon('trash', 13)} Clear history</button>
        </div>
      </div>

      ${list.length ? `<div style="display:flex;flex-direction:column;gap:16px">
        ${groups.map(g => {
          const open = local.expanded[g.key] !== false;
          return `
            <div class="workflow-group">
              <div class="group-head" data-action="toggle-group" data-key="${escapeHtml(g.key)}">
                ${icon(open ? 'chevronDown' : 'chevronRight', 14)}
                <span class="ico">${icon(open ? 'folderOpen' : 'folder', 16)}</span>
                <div><div class="name">${escapeHtml(g.key)}</div>
                  <div class="meta">${g.items.length} run${g.items.length === 1 ? '' : 's'}</div></div>
                <span class="group-count">${g.items.length}</span>
              </div>
              ${open ? `<div class="table-wrap" style="border-radius:0 0 10px 10px;border-top:none">
                ${execTable(g.items)}
              </div>` : ''}
            </div>`;
        }).join('')}
      </div>` : `<div class="card"><div class="empty-state">
        <div class="ico">${icon('history', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No executions</div>
        <div style="font-size:12.5px;margin-top:4px">Runs will appear here once workflows execute.</div>
      </div></div>`}`;
  }

  /* Render an execution's result payload for the detail modal, guarding against
     pathologically large results. JSON.stringify on a multi-hundred-MB object
     can itself throw "Invalid string length", and even a merely-large string
     freezes the DOM — so cap the rendered text and note the truncation. The
     list endpoint no longer ships `result` at all (see slimExecution on the
     server); this only ever runs on the single record fetched by id. */
  const MAX_RESULT_CHARS = 200000; // ~200KB of pretty JSON is plenty for a modal
  function resultBlock(e) {
    if (e.result === undefined || e.result === null) return '';
    let str;
    try {
      str = JSON.stringify(e.result, null, 2);
    } catch (_err) {
      return `<div class="field" style="margin-top:14px"><div class="field-label">Result</div>
        <div class="code">(result too large to display)</div></div>`;
    }
    let note = '';
    if (str.length > MAX_RESULT_CHARS) {
      note = `\n\n… truncated (${str.length.toLocaleString()} characters total)`;
      str = str.slice(0, MAX_RESULT_CHARS);
    }
    return `<div class="field" style="margin-top:14px"><div class="field-label">Result</div>
      <div class="code">${escapeHtml(str + note)}</div></div>`;
  }

  function detailModal(e) {
    const id = e.id || e.executionId;
    const steps = e.steps || e.stepResults || [];
    return `
      <div class="modal-card" style="width:640px">
        <div class="card-head">
          <div class="card-title">${icon('history', 16)} Execution detail</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad modal-body" style="max-height:72vh">
          <div class="row" style="gap:8px;margin-bottom:14px">
            ${statusPill(e.outcome || e.status)}
            <span class="mono" style="background:var(--ink-100);padding:2px 7px;border-radius:4px;font-size:11px">${escapeHtml(String(id))}</span>
          </div>
          <div class="grid-3" style="grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
            <div><div class="field-label">Workflow</div><div style="font-size:13px">${escapeHtml(e.workflowName || e.name || '—')}</div></div>
            <div><div class="field-label">Duration</div><div class="mono" style="font-size:13px">${fmtDuration(e.duration)}</div></div>
            <div><div class="field-label">Started</div><div style="font-size:13px">${escapeHtml(fmtDateTime(e.startedAt || e.executedAt))}</div></div>
          </div>
          ${e.error ? `<div class="field"><div class="field-label" style="color:var(--danger-700)">Error</div>
            <div class="code" style="color:#FCA5A5">${escapeHtml(typeof e.error === 'string' ? e.error : JSON.stringify(e.error, null, 2))}</div></div>` : ''}
          ${steps.length ? `<div class="field-label" style="margin-bottom:8px">Steps (${steps.length})</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${steps.map((st, i) => `<div class="step-row" style="grid-template-columns:24px 1fr auto">
                <span class="step-num">${i + 1}</span>
                <div><div style="font-weight:600;font-size:13px">${escapeHtml(st.name || st.type || 'Step')}</div>
                  <div style="font-size:11.5px;color:var(--ink-500)">${escapeHtml(st.type || '')}</div></div>
                ${statusPill(st.outcome || st.status || 'success')}
              </div>`).join('')}
            </div>` : ''}
          ${resultBlock(e)}
        </div>
      </div>`;
  }

  function html(state) {
    /* Arriving from a workflow's History button scopes the screen; the sidebar
       entry navigates with no params, which clears it. Read on every render so
       rerenderScreen() keeps the scope. */
    const params = (state && state.params) || {};
    const nextId = params.workflowId || null;
    const prevId = local.scope ? local.scope.workflowId : null;
    if (nextId !== prevId) {
      // Entering, leaving or switching scope — don't carry the previous view's
      // range/filter (a leftover "Failed" chip reads as "this never ran").
      local.days = 30;
      local.statusFilter = '';
      local.window = null;
      local.stats = null;
      local.executions = [];
    }
    local.scope = nextId
      ? { workflowId: nextId, workflowName: params.workflowName || nextId }
      : null;
    const actions = `<button class="btn" data-action="refresh">${icon('refresh', 14)} Refresh</button>`;
    return `${pageHead('executions', actions)}<div data-region="body"></div>`;
  }

  async function fetchAll() {
    if (local.scope) return fetchScoped();
    const [exec, stats, wf] = await Promise.all([
      api.get('/api/executions'),
      api.get('/api/executions/stats').catch(() => null),
      api.get('/api/workflows/list').catch(() => []),
    ]);
    local.executions = exec || [];
    local.stats = stats;
    local.workflows = wf || [];
  }

  /* One workflow's runs, read across the per-day execution files rather than
     from today's shared 100-record page — which is what a busy schedule pushes
     a quieter workflow's history out of. */
  async function fetchScoped() {
    const qs = [
      `days=${local.days > 0 ? local.days : 'all'}`,
      `limit=${SCOPED_LIMIT}`,
      local.statusFilter ? `status=${encodeURIComponent(local.statusFilter)}` : '',
    ].filter(Boolean).join('&');
    const res = await api.get(`/api/workflows/${encodeURIComponent(local.scope.workflowId)}/executions?${qs}`);
    local.executions = (res && res.executions) || [];
    local.stats = (res && res.stats) || null;
    local.window = (res && res.window) || null;
    if (res && res.workflow && res.workflow.name) local.scope.workflowName = res.workflow.name;
  }

  /* Re-fetch and repaint the body without tearing down the screen (keeps the
     scope banner's controls responsive). */
  async function reloadBody() {
    const region = document.querySelector('#mainContent .kr-ds[data-screen="executions"] [data-region="body"]');
    // A wide look-back walks every day file server-side, so show it is working.
    if (region) region.style.opacity = '0.55';
    try {
      await fetchAll();
      if (region) region.innerHTML = renderBody();
    } catch (err) {
      toast('Failed to load executions: ' + err.message, 'danger');
    } finally {
      if (region) region.style.opacity = '';
    }
  }

  let liveTimer;
  function liveRefresh() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      if (!window.Router || window.Router.state.screen !== 'executions') return;
      try {
        await fetchAll();
        const region = document.querySelector('#mainContent .kr-ds[data-screen="executions"] [data-region="body"]');
        if (region) region.innerHTML = renderBody();
      } catch (e) { /* ignore transient live-refresh errors */ }
    }, 600);
  }

  function init(root) {
    window.DS.util.loadRegion(root, async () => { await fetchAll(); return true; }, () => renderBody());
    if (window.DS.realtime) {
      ['workflow:start', 'workflow:complete', 'workflow:error', 'execution:complete', 'execution:update']
        .forEach((evt) => window.DS.realtime.on('executions', evt, liveRefresh));
    }
  }

  async function handle(action, el) {
    if (action === 'refresh' || action === 'retry') return rerenderScreen();
    if (action === 'toggle-group') {
      const k = el.dataset.key;
      local.expanded[k] = local.expanded[k] === false;
      saveExpanded();
      const region = document.querySelector('#mainContent .kr-ds[data-screen="executions"] [data-region="body"]');
      if (region) region.innerHTML = renderBody();
    } else if (action === 'filter') {
      local.statusFilter = el.dataset.value;
      if (local.scope) return reloadBody();   // server-side filter over the whole window
      const region = document.querySelector('#mainContent .kr-ds [data-region="body"]');
      if (region) region.innerHTML = renderBody();
    } else if (action === 'set-days') {
      local.days = parseInt(el.dataset.days, 10) || 0;
      return reloadBody();
    } else if (action === 'clear-scope') {
      // Navigating with no params drops the scope; html() resets range + filter.
      return navTo('executions');
    } else if (action === 'clear-history') {
      if (!confirm('Clear all execution history? This cannot be undone.')) return;
      try {
        const res = await api.post('/api/executions/clear', { olderThanDays: 0 });
        const n = res && res.deletedCount != null ? res.deletedCount : '';
        toast(`Cleared ${n} execution record${n === 1 ? '' : 's'}`.replace('  ', ' '), 'success');
        rerenderScreen();
      } catch (err) { toast('Failed to clear history: ' + err.message, 'danger'); }
    } else if (action === 'view') {
      try {
        const e = await api.get(`/api/executions/${el.dataset.id}`);
        window.Router.openModal(detailModal(e || {}));
      } catch (err) { toast('Failed to load execution: ' + err.message, 'danger'); }
    }
  }

  window.Router.register('executions', { html, init, handle }, {
    title: 'Execution history',
    sub: 'Inspect every run — succeeded, failed, in-flight.',
    crumb: ['Datasources', 'Execution history'],
  });
})();
