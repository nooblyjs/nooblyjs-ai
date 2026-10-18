/* Needs review screen — /applications/wiki/api/knowledge/needs-review (NooblyJS Phase 8).
   Documents someone flagged by reporting an answer as wrong: why, who and when, a
   link to the page, and "Reviewed" for a person who may approve. */
(function () {
  const { escapeHtml, toast, timeAgo } = window.DS.util;
  const api = window.DS.api;
  const API = '/applications/wiki/api/knowledge';

  const local = { flags: [], canResolve: false };

  function renderBody() {
    const list = local.flags;
    if (!list.length) {
      return `<div class="card"><div class="empty-state">
        <div class="ico">${icon('check', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">Nothing needs review</div>
        <div style="font-size:12.5px;margin:4px 0 0">When someone says an answer is wrong, the documents it was built from are listed here.</div>
      </div></div>`;
    }
    return `<div class="card"><div class="table-container"><table class="table">
        <caption style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">Documents that need review</caption>
        <thead><tr><th scope="col">Document</th><th scope="col">Why it needs review</th><th scope="col">Reported</th><th scope="col"><span style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">Actions</span></th></tr></thead>
        <tbody>
          ${list.map((f) => `<tr>
            <th scope="row" style="text-align:left;font-weight:600;text-transform:none;letter-spacing:normal;font-size:inherit;color:inherit;background:none"><a href="${escapeHtml(f.href)}">${escapeHtml(f.title || f.path)}</a>
              <div style="font-size:12px;font-weight:400;color:var(--ink-500)">${escapeHtml(f.spaceName)} · ${escapeHtml(f.path)}</div></th>
            <td>${escapeHtml(f.reason || '')}${f.reports > 1 ? `<div style="font-size:12px;color:var(--ink-500)">Reported ${f.reports} times</div>` : ''}</td>
            <td>${escapeHtml(f.by || 'Someone')}<div style="font-size:12px;color:var(--ink-500)">${escapeHtml(timeAgo(f.at))}</div></td>
            <td style="text-align:right">${local.canResolve
              ? `<button class="btn btn-sm" data-action="resolve" data-id="${escapeHtml(f.id)}" aria-label="Mark ${escapeHtml(f.title || f.path)} as reviewed">${icon('check', 13)} Reviewed</button>`
              : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>
      ${local.canResolve ? '' : '<p style="font-size:12.5px;color:var(--ink-500);margin-top:12px">Marking a document as reviewed needs an Approver.</p>'}`;
  }

  async function load() {
    const data = await api.get(`${API}/needs-review`) || {};
    local.flags = data.flags || [];
    local.canResolve = Boolean(data.canResolve);
    return true;
  }

  function html() {
    return `${pageHead('needs-review')}<div data-region="body"></div>`;
  }

  function init(root) {
    window.DS.util.loadRegion(root, load, () => renderBody());
  }

  async function handle(action, el) {
    if (action === 'retry') return rerenderScreen();
    if (action === 'resolve') {
      try {
        await api.post(`${API}/needs-review/resolve`, { id: el.dataset.id });
        toast('Marked as reviewed', 'success');
        await load();
        rerenderScreen();
      } catch (err) {
        toast(`Could not mark it as reviewed: ${err.message}`, 'danger');
      }
    }
  }

  window.Router.register('needs-review', { html, init, handle }, {
    title: 'Needs review',
    sub: 'Documents behind an answer someone reported as wrong.',
    crumb: ['Knowledge', 'Needs review'],
  });
})();
