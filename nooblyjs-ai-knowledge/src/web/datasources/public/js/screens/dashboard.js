/* Dashboard screen — live data from /api/workflows/dashboard */
(function () {
  const { fmtDuration, timeAgo, escapeHtml, loadRegion } = window.DS.util;

  function runStatus(s) {
    const v = (s || '').toLowerCase();
    if (v === 'success' || v === 'succeeded' || v === 'completed')
      return `<span class="status-pill succ"><span class="dot"></span> Succeeded</span>`;
    if (v === 'failed' || v === 'error')
      return `<span class="status-pill fail"><span class="dot"></span> Failed</span>`;
    if (v === 'running')
      return `<span class="status-pill run"><span class="dot"></span> Running</span>`;
    return `<span class="status-pill queued"><span class="dot"></span> ${escapeHtml(s || 'Queued')}</span>`;
  }

  function wfStatusBadge(s) {
    if (s === 'active') return `<span class="badge success"><span class="dot"></span> Active</span>`;
    if (s === 'draft')  return `<span class="badge warn">Draft</span>`;
    return `<span class="badge neutral">${escapeHtml(s || 'Unscheduled')}</span>`;
  }

  function emptyMini(msg) {
    return `<div style="padding:32px;text-align:center;color:var(--ink-500);font-size:13px">${escapeHtml(msg)}</div>`;
  }

  function heroCard(d) {
    const stats = d.stats || {};
    const val = (k) => (stats[k] && stats[k].value !== undefined ? stats[k].value : 0);
    const stat = (num, lbl) =>
      `<div class="hero-stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
    return `
      <div class="hero">
        <div class="hero-eyebrow">Datasources · Workflow Automation</div>
        <h1 class="hero-title">Workflow Dashboard</h1>
        <p class="hero-sub">Workflow automation and data pipeline orchestration at a glance.</p>
        <div class="hero-stats">
          ${stat(val('activeWorkflows'), 'Active workflows')}
          ${stat(val('recordsProcessed'), 'Records processed')}
          ${stat(val('agentExecutions'), 'Executions')}
          ${stat(val('publishedSources'), 'Published sources')}
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary" data-action="nav" data-screen="workflowEdit">${icon('plus', 14)} New workflow</button>
          <button class="btn" data-action="refresh">${icon('refresh', 14)} Refresh</button>
        </div>
      </div>`;
  }

  function renderBody(d) {
    const execs = d.executions || [];
    const schedules = d.schedules || [];
    const edited = d.recentlyEdited || [];

    return `
      ${heroCard(d)}

      <div class="card" style="margin-bottom:22px">
        <div class="card-pad between">
          <div class="card-title"><span class="ico" style="color:var(--gold-600)">${icon('zap', 16)}</span> Quick actions</div>
          <div class="row">
            <button class="btn btn-primary" data-action="nav" data-screen="workflowEdit">${icon('plus', 14)} Create workflow</button>
            <button class="btn" data-action="nav" data-screen="workflows">${icon('workflow', 14)} All workflows</button>
            <button class="btn btn-ghost" data-action="nav" data-screen="executions">${icon('history', 14)} View executions</button>
          </div>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:22px">
        <div class="card">
          <div class="card-head">
            <div class="card-title">${icon('history', 16)} Recent executions</div>
            <a class="link" data-action="nav" data-screen="executions"
               style="font-size:12px;color:var(--gold-700);font-weight:600;cursor:pointer;text-decoration:none">View all →</a>
          </div>
          ${execs.length ? `
            <table class="table">
              <thead><tr><th>Workflow</th><th style="width:90px">Duration</th><th style="width:130px">Status</th></tr></thead>
              <tbody>
                ${execs.map(e => `
                  <tr>
                    <td>
                      <div class="cell-main">
                        <span class="title">${escapeHtml(e.workflowName || 'Workflow')}</span>
                        <span class="sub mono">${escapeHtml(String(e.id || '').slice(0, 10))}</span>
                      </div>
                    </td>
                    <td class="mono">${fmtDuration(e.duration)}</td>
                    <td>${runStatus(e.status || e.outcome)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>` : emptyMini('No executions yet')}
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">${icon('schedule', 16)} Active schedules</div>
            <a class="link" data-action="nav" data-screen="schedules"
               style="font-size:12px;color:var(--gold-700);font-weight:600;cursor:pointer;text-decoration:none">Manage →</a>
          </div>
          ${schedules.length ? schedules.map(s => `
            <div style="display:flex;gap:12px;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line-2)">
              <div style="width:32px;height:32px;border-radius:8px;background:var(--gold-50);color:var(--gold-700);display:flex;align-items:center;justify-content:center">
                ${icon('schedule', 16)}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:10.4px;color:var(--ink-900)">${escapeHtml(s.workflowName || 'Workflow')}</div>
                <div style="font-size:9.6px;color:var(--ink-500)">
                  <span class="mono" style="background:var(--ink-100);padding:1px 6px;border-radius:4px">${escapeHtml(s.cron || '—')}</span>
                </div>
              </div>
              <span class="badge ${s.enabled ? 'success' : 'neutral'}"><span class="dot"></span> ${s.enabled ? 'enabled' : 'paused'}</span>
            </div>`).join('') : emptyMini('No active schedules')}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">${icon('clock', 16)} Recently edited workflows</div>
          <a class="link" data-action="nav" data-screen="workflows"
             style="font-size:12px;color:var(--gold-700);font-weight:600;cursor:pointer;text-decoration:none">All workflows →</a>
        </div>
        ${edited.length ? edited.map(w => `
          <div style="display:flex;gap:12px;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line-2)">
            <div style="width:32px;height:32px;border-radius:8px;background:var(--ink-50);color:var(--ink-600);display:flex;align-items:center;justify-content:center">
              ${icon('fileText', 16)}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:10.4px;color:var(--ink-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(w.name)}</div>
              <div style="font-size:9.6px;color:var(--ink-500)">${(w.stepCount || 0)} step${w.stepCount === 1 ? '' : 's'} · ${escapeHtml(timeAgo(w.modifiedAt))}</div>
            </div>
            ${wfStatusBadge(w.status)}
            <button class="btn btn-icon-sm" title="Edit" data-action="edit-workflow" data-id="${escapeHtml(w.id)}">${icon('pencil', 13)}</button>
          </div>`).join('') : emptyMini('No workflows yet')}
      </div>
    `;
  }

  function html() {
    const crumb = `
      <div class="crumb" style="margin-bottom:14px">
        ${icon('home', 12)}
        <span class="sep">${icon('chevronRight', 12)}</span><span>Datasources</span>
        <span class="sep">${icon('chevronRight', 12)}</span><span class="here">Dashboard</span>
      </div>`;
    return `${crumb}<div data-region="body"></div>`;
  }

  let liveTimer;
  function liveRefresh() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (!window.Router || window.Router.state.screen !== 'dashboard') return;
      window.DS.api.get('/api/workflows/dashboard').then((d) => {
        const region = document.querySelector('#mainContent .kr-ds[data-screen="dashboard"] [data-region="body"]');
        if (region) region.innerHTML = renderBody(d);
      }).catch(() => {});
    }, 600);
  }

  function init(root) {
    loadRegion(root, () => window.DS.api.get('/api/workflows/dashboard'), renderBody);
    if (window.DS.realtime) {
      ['workflow:start', 'workflow:complete', 'workflow:error'].forEach((evt) =>
        window.DS.realtime.on('dashboard', evt, liveRefresh));
    }
  }

  function handle(action, el) {
    if (action === 'refresh' || action === 'retry') rerenderScreen();
    else if (action === 'edit-workflow') navTo('workflowEdit', { id: el.dataset.id });
  }

  window.Router.register('dashboard', { html, init, handle }, {
    title: 'Dashboard',
    sub: 'Workflow automation and data pipeline orchestration at a glance.',
    crumb: ['Datasources', 'Dashboard'],
  });
})();
