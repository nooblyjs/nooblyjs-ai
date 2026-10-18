/* Prompt library screen — /api/prompts
   Authoring surface for the shared prompt store. Prompts are looked up in code
   and workflow steps by KEY: prompts.get("document-processing-pdf").
   The test bench runs a prompt as the SYSTEM prompt against a configured agent
   with a user-supplied input, so a prompt can be proven before anything uses it. */
(function () {
  const { escapeHtml, fmtDateTime, toast } = window.DS.util;
  const api = window.DS.api;

  const STATUSES = ['published', 'draft'];
  const CATEGORY_SUGGESTIONS = [
    'General', 'Document Processing', 'Chat Processing', 'Code Processing',
    'Folder Processing', 'Analysis', 'Extraction'
  ];

  const local = {
    prompts: [],
    stats: {},
    agents: [],
    search: '',
    categoryFilter: '',
    statusFilter: '',
    // The prompt currently open in the test bench (null when the modal is closed).
    testing: null,
  };

  /* ---------------------------------------------------------------- helpers */

  /** Mirror of the server-side slug rules so the key preview matches what is saved. */
  function slugify(value) {
    return String(value || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /** Distinct {{placeholder}} names in a prompt body. */
  function variablesIn(content) {
    const found = [];
    const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(String(content || ''))) !== null) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    return found;
  }

  function statusBadge(status) {
    return status === 'draft'
      ? `<span class="badge warn">Draft</span>`
      : `<span class="badge success"><span class="dot"></span> Published</span>`;
  }

  function filtered() {
    const q = local.search.trim().toLowerCase();
    return local.prompts.filter((p) => {
      if (local.categoryFilter && p.category !== local.categoryFilter) return false;
      if (local.statusFilter && p.status !== local.statusFilter) return false;
      if (!q) return true;
      return p.key.toLowerCase().includes(q)
        || (p.name || '').toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
        || (p.tags || []).some((t) => String(t).toLowerCase().includes(q));
    });
  }

  function categories() {
    return Array.from(new Set(local.prompts.map((p) => p.category).filter(Boolean))).sort();
  }

  /** Agent <option> list; the blank option means "pick by usage tag". */
  function agentOptions(selected) {
    return `<option value="">Default agent (by usage)</option>`
      + local.agents
        .filter((a) => a.enabled !== false)
        .map((a) => `<option value="${escapeHtml(a.name)}"${a.name === selected ? ' selected' : ''}>${escapeHtml(a.name)} · ${escapeHtml(a.provider || '')}</option>`)
        .join('');
  }

  /* ----------------------------------------------------------------- render */

  function renderBody() {
    const list = filtered();
    const s = local.stats || {};
    return `
      <div class="kpi-grid" style="margin-bottom:16px">
        <div class="kpi"><div class="kpi-ico">${icon('book', 16)}</div>
          <div><div class="kpi-label">Prompts</div><div class="kpi-value"><span class="num">${s.totalPrompts || 0}</span></div></div></div>
        <div class="kpi success"><div class="kpi-ico">${icon('checkCircle', 16)}</div>
          <div><div class="kpi-label">Published</div><div class="kpi-value"><span class="num">${s.published || 0}</span></div></div></div>
        <div class="kpi gold"><div class="kpi-ico">${icon('pencil', 16)}</div>
          <div><div class="kpi-label">Drafts</div><div class="kpi-value"><span class="num">${s.drafts || 0}</span></div></div></div>
        <div class="kpi info"><div class="kpi-ico">${icon('play', 16)}</div>
          <div><div class="kpi-label">Runs</div><div class="kpi-value"><span class="num">${s.totalExecutions || 0}</span></div></div></div>
      </div>

      <div class="card" style="margin-bottom:16px;padding:12px 16px">
        <div class="between" style="flex-wrap:wrap;gap:12px">
          <div class="input-icon-wrap" style="flex:1 1 280px;max-width:420px">
            <span class="ico">${icon('search', 14)}</span>
            <input class="input" data-field="search" placeholder="Search by key, name, tag…" value="${escapeHtml(local.search)}"/>
          </div>
          <div class="row" style="gap:8px">
            <select class="select" data-field="category" style="width:180px">
              <option value="">All categories</option>
              ${categories().map((c) => `<option value="${escapeHtml(c)}"${c === local.categoryFilter ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
            <select class="select" data-field="status" style="width:150px">
              <option value="">All status</option>
              ${STATUSES.map((st) => `<option value="${st}"${st === local.statusFilter ? ' selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      ${list.length ? `<div class="card"><div class="table-wrap"><table class="table">
        <thead><tr>
          <th style="width:26%">Key</th>
          <th>Prompt</th>
          <th style="width:15%">Category</th>
          <th style="width:11%">Status</th>
          <th style="width:14%">Updated</th>
          <th style="width:130px"></th>
        </tr></thead>
        <tbody>
          ${list.map((p) => `<tr>
            <td>
              <span class="mono" style="color:var(--violet-700)">${escapeHtml(p.key)}</span>
              <div style="font-size:11px;color:var(--ink-400);margin-top:2px">v${p.version} · ${p.executions || 0} run${p.executions === 1 ? '' : 's'}</div>
            </td>
            <td>
              <div style="font-weight:600;color:var(--ink-900)">${escapeHtml(p.name)}</div>
              <div style="font-size:12px;color:var(--ink-500)">${escapeHtml(p.description || '')}</div>
              ${(p.variables || []).length ? `<div class="row" style="gap:4px;margin-top:4px;flex-wrap:wrap">${p.variables.map((v) => `<span class="tag mono">{{${escapeHtml(v)}}}</span>`).join('')}</div>` : ''}
            </td>
            <td><span class="tag">${escapeHtml(p.category)}</span></td>
            <td>${statusBadge(p.status)}</td>
            <td style="font-size:12px;color:var(--ink-500)">${fmtDateTime(p.updatedAt)}</td>
            <td><div class="row row-actions" style="gap:4px;justify-content:flex-end">
              <button class="btn btn-icon-sm" title="Test prompt" data-action="test" data-id="${escapeHtml(p.id)}">${icon('flask', 12)}</button>
              <button class="btn btn-icon-sm" title="Copy prompts.get(…)" data-action="copy-key" data-key="${escapeHtml(p.key)}">${icon('copy', 12)}</button>
              <button class="btn btn-icon-sm" title="Edit" data-action="edit" data-id="${escapeHtml(p.id)}">${icon('pencil', 12)}</button>
              <button class="btn btn-icon-sm" title="Delete" data-action="delete" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">${icon('trash', 12)}</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>`
      : `<div class="card"><div class="empty-state">
          <div class="ico">${icon('book', 22)}</div>
          <div style="font-size:14px;font-weight:600;color:var(--ink-800)">${local.prompts.length ? 'No prompts match these filters' : 'No prompts yet'}</div>
          <div style="font-size:12.5px;margin:4px 0 14px">Prompts are reusable system instructions your workflows call by key.</div>
          <button class="btn btn-primary btn-sm" data-action="show-create">${icon('plus', 13)} New prompt</button>
        </div></div>`}`;
  }

  /* ------------------------------------------------------------ edit modal */

  function promptForm(prompt) {
    const p = prompt || {};
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
    return `
      <div class="row" style="gap:12px;align-items:flex-start">
        <div class="field" style="flex:1">
          <label class="field-label">Name <span class="req">*</span></label>
          <input class="input" data-field="name" placeholder="e.g., PDF document processing" value="${escapeHtml(p.name || '')}"/>
        </div>
        <div class="field" style="flex:1">
          <label class="field-label">Key <span class="req">*</span></label>
          <input class="input mono" data-field="key" placeholder="auto from name" value="${escapeHtml(p.key || '')}"/>
          <div class="field-help">Used in code: <span class="mono">prompts.get("<span data-region="key-preview">${escapeHtml(p.key || 'your-key')}</span>")</span></div>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Description</label>
        <input class="input" data-field="description" placeholder="What does this prompt do?" value="${escapeHtml(p.description || '')}"/>
      </div>
      <div class="row" style="gap:12px;align-items:flex-start">
        <div class="field" style="flex:1">
          <label class="field-label">Category</label>
          <input class="input" data-field="category" list="prompt-categories" value="${escapeHtml(p.category || 'General')}"/>
          <datalist id="prompt-categories">
            ${Array.from(new Set(CATEGORY_SUGGESTIONS.concat(categories()))).map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
          </datalist>
        </div>
        <div class="field" style="flex:1">
          <label class="field-label">Status</label>
          <select class="select" data-field="status">
            ${STATUSES.map((st) => `<option value="${st}"${st === (p.status || 'published') ? ' selected' : ''}>${st}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="row" style="gap:12px;align-items:flex-start">
        <div class="field" style="flex:1">
          <label class="field-label">Tags</label>
          <input class="input" data-field="tags" placeholder="pdf, markdown" value="${escapeHtml(tags)}"/>
        </div>
        <div class="field" style="flex:1">
          <label class="field-label">Default agent</label>
          <select class="select" data-field="agent">${agentOptions(p.agent || '')}</select>
          <div class="field-help">Used by the test bench when none is chosen.</div>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Prompt <span class="req">*</span></label>
        <textarea class="textarea mono" data-field="content" rows="14"
          placeholder="You are a document conversion assistant…&#10;&#10;Use {{placeholders}} for values supplied at call time."
          style="min-height:240px;font-size:12px;line-height:1.55">${escapeHtml(p.content || '')}</textarea>
        <div class="field-help">Sent as the system prompt. <span class="mono">{{name}}</span> placeholders are filled by <span class="mono">prompts.get(key, { name })</span>.</div>
      </div>`;
  }

  /* `prompt` may be a saved record or an unsaved draft handed back from the test
     bench — only a record with an id edits in place. */
  function editorModal(prompt) {
    const isEdit = !!(prompt && prompt.id);
    return `
      <div class="modal-card" style="width:760px;max-width:94vw">
        <div class="card-head">
          <div class="card-title">${icon(isEdit ? 'pencil' : 'plus', 16)} ${isEdit ? 'Edit prompt' : 'New prompt'}</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad modal-body" style="max-height:82vh">
          ${promptForm(prompt)}
          <div class="row" style="justify-content:space-between;gap:8px">
            <button class="btn" data-action="test-draft"${isEdit ? ` data-id="${escapeHtml(prompt.id)}"` : ''}>${icon('flask', 13)} Test</button>
            <div class="row" style="gap:8px">
              <button class="btn" data-action="modal-close">Cancel</button>
              <button class="btn btn-primary" data-action="${isEdit ? 'do-edit' : 'do-create'}"${isEdit ? ` data-id="${escapeHtml(prompt.id)}"` : ''}>
                ${icon('save', 13)} ${isEdit ? 'Save changes' : 'Create prompt'}
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------ test modal */

  function testModal(ctx) {
    const vars = variablesIn(ctx.content);
    return `
      <div class="modal-card" style="width:860px;max-width:96vw">
        <div class="card-head">
          <div class="card-title">${icon('flask', 16)} Test · ${escapeHtml(ctx.name || 'prompt')}</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad modal-body" style="max-height:84vh">
          <div class="field">
            <label class="field-label">System prompt</label>
            <textarea class="textarea mono" data-field="test-system" rows="8"
              style="min-height:150px;font-size:12px;line-height:1.55">${escapeHtml(ctx.content || '')}</textarea>
            <div class="field-help">Edits here are used for this run only — they are not saved.</div>
          </div>
          ${vars.length ? `<div class="field">
            <label class="field-label">Variables</label>
            <div class="row" style="gap:10px;flex-wrap:wrap">
              ${vars.map((v) => `<div style="flex:1 1 200px">
                <input class="input" data-var="${escapeHtml(v)}" placeholder="{{${escapeHtml(v)}}}"/>
              </div>`).join('')}
            </div>
          </div>` : ''}
          <div class="row" style="gap:12px;align-items:flex-start">
            <div class="field" style="flex:1">
              <label class="field-label">Agent</label>
              <select class="select" data-field="test-agent">${agentOptions(ctx.agent || '')}</select>
            </div>
          </div>
          <div class="field">
            <label class="field-label">User input</label>
            <textarea class="textarea" data-field="test-input" rows="6"
              placeholder="Paste the content you want the prompt to act on…" style="min-height:120px">${escapeHtml(ctx.input || '')}</textarea>
          </div>
          <div class="row" style="justify-content:flex-end;gap:8px;margin-bottom:14px">
            ${ctx.draft ? `<button class="btn" data-action="back-to-editor">${icon('chevronLeft', 13)} Back to editing</button>` : ''}
            <button class="btn" data-action="modal-close">Close</button>
            <button class="btn btn-primary" data-action="run-test">${icon('play', 13)} Run test</button>
          </div>
          <div data-region="test-result"></div>
        </div>
      </div>`;
  }

  function resultPanel(result) {
    return `
      <div class="card" style="background:var(--ink-50)">
        <div class="card-head">
          <div class="card-title">${icon('sparkles', 14)} Response</div>
          <div class="row" style="gap:6px">
            ${result.model ? `<span class="tag">${escapeHtml(result.model)}</span>` : ''}
            <span class="tag">${escapeHtml(result.agent || 'default')}</span>
            <span class="badge info">${window.DS.util.fmtDuration(result.durationMs)}</span>
          </div>
        </div>
        <div class="card-pad">
          <pre class="mono" style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px;line-height:1.6;color:var(--ink-800)">${escapeHtml(result.response || '(empty response)')}</pre>
        </div>
      </div>`;
  }

  /* -------------------------------------------------------------- lifecycle */

  function html() {
    const actions = `<button class="btn btn-primary" data-action="show-create">${icon('plus', 14)} New prompt</button>`;
    return `${pageHead('prompts', actions)}<div data-region="body"></div>`;
  }

  async function load() {
    // Agents are needed by both modals; a failure there must not blank the list.
    const [library, agents] = await Promise.all([
      api.get('/api/prompts'),
      api.get('/api/agents').catch(() => []),
    ]);
    local.prompts = (library && library.prompts) || [];
    local.stats = (library && library.stats) || {};
    local.agents = agents || [];
  }

  function init(root) {
    window.DS.util.loadRegion(root, async () => { await load(); return true; }, () => renderBody());
  }

  async function refresh() {
    await load();
    rerenderScreen();
  }

  /* Modal-scoped lookup. The editor reuses field names the screen's filter bar
     also uses (category, status), and the modal root sits after #mainContent in
     the DOM — an unscoped querySelector would read the filter, not the form. */
  function modalEl(selector) {
    return document.querySelector(`#kr-modal-root ${selector}`);
  }

  /* Read the editor modal into a create/update payload, or null on invalid input. */
  function readForm() {
    const get = (f) => {
      const el = modalEl(`[data-field="${f}"]`);
      return el ? el.value.trim() : '';
    };
    const name = get('name');
    if (!name) { toast('Name is required', 'warn'); return null; }
    const content = modalEl('[data-field="content"]');
    if (!content || !content.value.trim()) { toast('Prompt content is required', 'warn'); return null; }

    return {
      name,
      key: get('key') || slugify(name),
      description: get('description'),
      category: get('category') || 'General',
      tags: get('tags').split(',').map((t) => t.trim()).filter(Boolean),
      status: get('status') || 'published',
      agent: get('agent'),
      content: content.value,
    };
  }

  /** Open the test bench for a saved prompt, or for unsaved editor content. */
  function openTest(ctx) {
    local.testing = ctx;
    window.Router.openModal(testModal(ctx));
  }

  async function runTest() {
    const systemEl = modalEl('[data-field="test-system"]');
    const inputEl = modalEl('[data-field="test-input"]');
    const agentEl = modalEl('[data-field="test-agent"]');
    const region = modalEl('[data-region="test-result"]');
    const button = modalEl('[data-action="run-test"]');
    if (!systemEl || !region) return;

    const system = systemEl.value;
    if (!system.trim()) return toast('The system prompt is empty', 'warn');

    const variables = {};
    document.querySelectorAll('#kr-modal-root [data-var]').forEach((el) => {
      if (el.value) variables[el.dataset.var] = el.value;
    });

    region.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:24px;justify-content:center;color:var(--ink-500)">
      <span class="spinner"></span> Running…</div>`;
    if (button) button.disabled = true;

    const ctx = local.testing || {};
    // The saved-prompt endpoint runs the text ON THE SERVER, so it may only be
    // used for an unmodified prompt opened from the list — an editor draft (even
    // one with an id) must be sent as ad-hoc content or the server would silently
    // test the previously saved version instead.
    const useSaved = !!ctx.id && !ctx.draft && system === ctx.content;
    const body = { input: inputEl ? inputEl.value : '', agent: agentEl ? agentEl.value : '', variables };
    try {
      const result = useSaved
        ? await api.post(`/api/prompts/${ctx.id}/test`, body)
        : await api.post('/api/prompts/test', { ...body, content: system });
      region.innerHTML = resultPanel(result || {});
      // Keep the run counter honest without tearing down the open modal.
      if (useSaved) load().catch(() => {});
    } catch (err) {
      region.innerHTML = `<div class="card" style="border-color:#FECACA">
        <div class="card-pad" style="color:var(--danger-700);font-size:12.5px">
          ${icon('alertTriangle', 14)} ${escapeHtml(err.message || 'Test failed')}
        </div></div>`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function handle(action, el) {
    if (action === 'retry') return rerenderScreen();

    if (action === 'show-create') {
      window.Router.openModal(editorModal(null));
    } else if (action === 'edit') {
      const prompt = local.prompts.find((p) => p.id === el.dataset.id);
      if (!prompt) return toast('Prompt not found', 'warn');
      window.Router.openModal(editorModal(prompt));
    } else if (action === 'do-create') {
      const payload = readForm();
      if (!payload) return;
      try {
        await api.post('/api/prompts', payload);
        window.Router.closeModal();
        toast('Prompt created', 'success');
        refresh();
      } catch (err) { toast('Failed to create prompt: ' + err.message, 'danger'); }
    } else if (action === 'do-edit') {
      const payload = readForm();
      if (!payload) return;
      try {
        await api.put(`/api/prompts/${el.dataset.id}`, payload);
        window.Router.closeModal();
        toast('Prompt saved', 'success');
        refresh();
      } catch (err) { toast('Failed to save prompt: ' + err.message, 'danger'); }
    } else if (action === 'delete') {
      if (!confirm(`Delete prompt "${el.dataset.name}"? Anything calling it by key will fail.`)) return;
      try {
        await api.del(`/api/prompts/${el.dataset.id}`);
        toast('Prompt deleted', 'success');
        refresh();
      } catch (err) { toast('Failed to delete: ' + err.message, 'danger'); }
    } else if (action === 'copy-key') {
      const snippet = `prompts.get("${el.dataset.key}")`;
      try {
        await navigator.clipboard.writeText(snippet);
        toast(`Copied ${snippet}`, 'success');
      } catch (err) { toast('Clipboard unavailable — key: ' + el.dataset.key, 'warn'); }
    } else if (action === 'test') {
      const prompt = local.prompts.find((p) => p.id === el.dataset.id);
      if (!prompt) return toast('Prompt not found', 'warn');
      openTest({ id: prompt.id, name: prompt.name, content: prompt.content, agent: prompt.agent });
    } else if (action === 'test-draft') {
      // Test the text currently in the editor, saved or not. The draft rides
      // along so "Back to editing" can restore the form the modal just replaced.
      const payload = readForm();
      if (!payload) return;
      const id = el.dataset.id || null;
      openTest({
        id,
        name: payload.name,
        content: payload.content,
        agent: payload.agent,
        draft: { ...payload, id },
      });
    } else if (action === 'back-to-editor') {
      const draft = local.testing && local.testing.draft;
      if (!draft) return;
      window.Router.openModal(editorModal(draft));
    } else if (action === 'run-test') {
      await runTest();
    }
  }

  /* --------------------------------------------------- inline filter inputs */

  function activeRoot() {
    const root = document.querySelector('#mainContent .kr-ds');
    return root && root.dataset.screen === 'prompts' ? root : null;
  }

  function repaint() {
    const root = activeRoot();
    if (!root) return;
    const region = root.querySelector('[data-region="body"]');
    const active = document.activeElement;
    const caret = active && active.dataset && active.dataset.field === 'search' ? active.selectionStart : null;
    region.innerHTML = renderBody();
    if (caret !== null) {
      const s = region.querySelector('[data-field="search"]');
      if (s) { s.focus(); s.setSelectionRange(caret, caret); }
    }
  }

  let debounce;
  function onInput(e) {
    const field = e.target.dataset && e.target.dataset.field;
    if (!field) return;
    // Modal fields share names with the filter bar (category, status) — keep
    // typing in the editor from filtering the list behind it.
    if (e.target.closest('#kr-modal-root')) {
      if (field === 'name' || field === 'key') {
        const keyEl = modalEl('[data-field="key"]');
        const nameEl = modalEl('[data-field="name"]');
        const preview = modalEl('[data-region="key-preview"]');
        if (preview && keyEl && nameEl) {
          preview.textContent = slugify(keyEl.value || nameEl.value) || 'your-key';
        }
      }
      return;
    }
    if (!activeRoot()) return;
    if (field === 'search') {
      local.search = e.target.value;
      clearTimeout(debounce);
      debounce = setTimeout(repaint, 200);
    } else if (field === 'category') {
      local.categoryFilter = e.target.value;
      repaint();
    } else if (field === 'status') {
      local.statusFilter = e.target.value;
      repaint();
    }
  }

  document.addEventListener('input', onInput);

  window.Router.register('prompts', { html, init, handle }, {
    title: 'Prompts',
    sub: 'Reusable system prompts your workflows and applications call by key.',
    crumb: ['Knowledge', 'Prompts'],
  });
})();
