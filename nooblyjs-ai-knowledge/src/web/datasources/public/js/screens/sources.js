/* Sources screen — /applications/wiki/api/knowledge/sources (NooblyJS Phase 8).
   Where the wiki's content came from: each import, its state in words, when it last
   ran, how many documents it wrote per space, and how many personal values it
   redacted on the way in. An Owner can run the import again. */
(function () {
  const { escapeHtml, toast, fmtDateTime } = window.DS.util;
  const api = window.DS.api;
  const API = '/applications/wiki/api/knowledge';

  const local = { sources: [], status: null, canImport: false, busy: false };

  const count = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const redactedTotal = (r) => (r ? (r.id || 0) + (r.email || 0) + (r.phone || 0) : 0);

  function redactedText(r, src) {
    if (src?.redaction === 'off') return 'Not redacted: the Platform guardrail "Redact personal data on ingest" was off';
    const total = redactedTotal(r);
    if (!total) return 'Nothing to redact';
    const parts = [];
    if (r.email) parts.push(count(r.email, 'email address', 'email addresses'));
    if (r.phone) parts.push(count(r.phone, 'phone number'));
    if (r.id) parts.push(count(r.id, 'ID number'));
    return `${count(total, 'value')} redacted: ${parts.join(', ')}`;
  }

  /** The state in words, with a badge colour as a second signal. */
  function stateBadge(state) {
    const failed = /^failed/i.test(state || '');
    const tone = failed ? 'danger' : state === 'Imported' ? 'success' : 'neutral';
    return `<span class="badge ${tone}">${escapeHtml(state || 'Unknown')}</span>`;
  }

  function renderBody() {
    const list = local.sources;
    if (!list.length) {
      return `<div class="card"><div class="empty-state">
        <div class="ico">${icon('download', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">Nothing has been imported yet</div>
        <div style="font-size:12.5px;margin:4px 0 14px">An import turns an export folder into spaces, with personal data redacted before anything is stored.</div>
        ${local.canImport ? `<button class="btn btn-primary btn-sm" data-action="import-sample">${icon('download', 13)} Import the sample export</button>` : '<div style="font-size:12.5px">Importing needs an Owner.</div>'}
      </div></div>`;
    }
    const s = local.status;
    const summary = s ? `<p style="font-size:13px;color:var(--ink-600);margin:0 0 14px">${count(s.documents, 'document')} imported from ${count(s.sources, 'source')} · ${count(s.spaces, 'space')} in the wiki · ${s.needsReview ? `${count(s.needsReview, 'document')} need review` : 'nothing needs review'}</p>` : '';
    return `${summary}
      <div class="card"><div class="table-container"><table class="table">
        <caption style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">Sources and their last import</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">State</th><th scope="col">Last run</th><th scope="col">Documents</th><th scope="col">Personal data</th><th scope="col"><span style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">Actions</span></th></tr></thead>
        <tbody>
          ${list.map((src) => `<tr>
            <th scope="row" style="text-align:left;font-weight:600;text-transform:none;letter-spacing:normal;font-size:inherit;color:inherit;background:none">${escapeHtml(src.name)}
              <div style="font-size:12px;font-weight:400;color:var(--ink-500)">Folder · ${escapeHtml(src.from || '')}</div></th>
            <td>${stateBadge(src.state)}</td>
            <td>${src.lastRunAt ? escapeHtml(fmtDateTime(src.lastRunAt)) : ''}<div style="font-size:12px;color:var(--ink-500)">by ${escapeHtml(src.by || 'system')}</div></td>
            <td>${count(src.documents || 0, 'document')}
              <div style="font-size:12px;color:var(--ink-500)">${(src.spaces || []).map((sp) => `${escapeHtml(sp.name)}: ${sp.documents}`).join(' · ')}</div></td>
            <td>${escapeHtml(redactedText(src.redacted, src))}</td>
            <td style="text-align:right">${local.canImport ? `<button class="btn btn-sm" data-action="import-again" data-id="${escapeHtml(src.id)}" data-name="${escapeHtml(src.name)}" aria-label="Import ${escapeHtml(src.name)} again">${icon('refresh', 13)} Import again</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>
      <p style="font-size:12.5px;color:var(--ink-500);margin-top:12px">To import your own export, an operator puts the folder under <code>imports/</code> in the wiki's data folder. Email addresses, phone numbers and ID numbers are replaced before a file is stored; names are not.</p>`;
  }

  async function load() {
    const data = await api.get(`${API}/sources`) || {};
    local.sources = data.sources || [];
    local.status = data.status || null;
    local.canImport = Boolean(data.canImport);
    return true;
  }

  function html() {
    return `${pageHead('sources')}<div data-region="body"></div>`;
  }

  function init(root) {
    window.DS.util.loadRegion(root, load, () => renderBody());
  }

  async function runImport(body, label) {
    if (local.busy) return;
    local.busy = true;
    try {
      const result = await api.post(`${API}/import`, body);
      const src = result && result.source;
      toast(src ? `${src.name}: ${count(src.documents, 'document')} imported, ${count(redactedTotal(src.redacted), 'value')} redacted` : `${label} imported`, 'success');
      await load();
      rerenderScreen();
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'danger');
    } finally {
      local.busy = false;
    }
  }

  async function handle(action, el) {
    if (action === 'retry') return rerenderScreen();
    if (action === 'import-sample') return runImport({}, 'The sample export');
    if (action === 'import-again') {
      // The bundled sample has no folder under imports/: it is imported by leaving the name out.
      const body = el.dataset.id === 'sample-wiki-export' ? {} : { name: el.dataset.id };
      return runImport(body, el.dataset.name);
    }
  }

  window.Router.register('sources', { html, init, handle }, {
    title: 'Sources',
    sub: 'Where the wiki\'s content came from, and what was redacted on the way in.',
    crumb: ['Knowledge', 'Sources'],
  });
})();
