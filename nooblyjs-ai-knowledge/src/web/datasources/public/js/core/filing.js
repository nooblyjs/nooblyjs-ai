/* Filing browser helper — wraps the shared FilingUIManager.
   - DS.filing.mount(hostEl, opts)  → renders the filer into a content-area
     element (used by the Spaces screen).
   - DS.filing.open(opts)           → renders the filer inside a modal
     (used by the Connections screen).

   opts: { title?, instance?, initEndpoint? }
     initEndpoint — optional POST hit before browsing (connections call
       /api/connections/:id/initialize to point the filing service).
     instance — optional registry instance name (spaces use space-<id>). */
(function () {
  const { escapeHtml, toast } = window.DS.util;

  let scriptsPromise = null;
  function ensureFilingLoaded() {
    if (typeof window.FilingUIManager !== 'undefined') return Promise.resolve();
    if (scriptsPromise) return scriptsPromise;
    scriptsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/services/filing/scripts/';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load filing component'));
      document.head.appendChild(s);
    });
    return scriptsPromise;
  }

  /* The filer panes — nav tree, breadcrumb, content, refresh button. */
  function filerMarkup() {
    return `
      <div style="display:flex;flex-direction:column;height:100%;min-height:0">
        <div style="display:flex;justify-content:flex-end;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--ink-50)">
          <button class="btn btn-icon-sm" id="dsFilingRefresh" title="Refresh">${icon('refresh', 13)}</button>
        </div>
        <div style="display:flex;flex:1;min-height:0">
          <div id="dsFilingNav" style="width:252px;border-right:1px solid var(--line);overflow:auto;padding:10px;background:var(--ink-50)"></div>
          <div style="flex:1;display:flex;flex-direction:column;min-width:0">
            <ol class="breadcrumb" id="dsFilingBreadcrumb"
                style="margin:0;padding:10px 16px;border-bottom:1px solid var(--line);font-size:12px;list-style:none;display:flex;gap:6px">
              <li class="breadcrumb-item"><a href="#" class="breadcrumb-root">Root</a></li>
            </ol>
            <div id="dsFilingContent" class="filing-content card-view" style="flex:1;overflow:auto;padding:14px">
              <div style="display:flex;align-items:center;gap:10px;justify-content:center;color:var(--ink-500);padding:48px">
                <span class="spinner"></span> Loading file browser…
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  async function startFiling(opts) {
    const region = document.getElementById('dsFilingContent');
    try {
      if (opts.initEndpoint) await window.DS.api.post(opts.initEndpoint, {});
      await ensureFilingLoaded();
      if (typeof window.FilingUIManager === 'undefined') {
        throw new Error('Filing component is not available');
      }
      const cfg = {
        navigationContainerId: 'dsFilingNav',
        contentContainerId: 'dsFilingContent',
        breadcrumbId: 'dsFilingBreadcrumb',
        refreshButtonId: 'dsFilingRefresh',
      };
      if (opts.instance) cfg.instance = opts.instance;
      const filingUI = new window.FilingUIManager(cfg);
      await filingUI.initialize();
    } catch (err) {
      console.error('[filing] failed:', err);
      if (region) {
        region.innerHTML = `<div class="empty-state">
          <div class="ico">${icon('alertTriangle', 22)}</div>
          <div style="font-size:14px;font-weight:600;color:var(--ink-800)">Couldn't open the file browser</div>
          <div style="font-size:12.5px;margin-top:4px">${escapeHtml(err && err.message || 'Request failed')}</div>
        </div>`;
      }
      toast('File browser failed: ' + (err && err.message || 'error'), 'danger');
    }
  }

  /* Render the filer into an existing content-area element. */
  async function mount(hostEl, opts = {}) {
    if (!hostEl) return;
    hostEl.innerHTML = filerMarkup();
    await startFiling(opts);
  }

  /* Render the filer inside a kr-ds modal. */
  async function open(opts = {}) {
    window.openModal(`
      <div class="modal-card" style="width:min(1120px,96vw);height:86vh">
        <div class="card-head">
          <div class="card-title">${icon('folderOpen', 16)} ${escapeHtml(opts.title || 'File browser')}</div>
          <button class="btn btn-icon-sm" data-action="modal-close" title="Close">${icon('x', 14)}</button>
        </div>
        <div class="modal-body" style="flex:1;display:flex;min-height:0;padding:0">
          <div id="dsFilingHost" style="flex:1;min-height:0"></div>
        </div>
      </div>`);
    await mount(document.getElementById('dsFilingHost'), opts);
  }

  window.DS = window.DS || {};
  window.DS.filing = { open, mount };
})();
