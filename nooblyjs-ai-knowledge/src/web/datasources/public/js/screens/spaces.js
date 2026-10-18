/* Spaces screen — /api/spaces.
   List view (cards) + a per-space detail view (?browse=<id>) whose settings
   form sits ABOVE the file browser.

   ONE form definition serves both creating and editing (see spaceFormHtml /
   readSpaceForm), so the two can never drift into accepting different fields —
   which is how the previous create modal ended up writing a `configuration`
   shape ({ filerType, …arbitrary JSON }) that nothing else in the platform
   reads, while the fields spaces.json actually uses (theme, permissions,
   allowedPaths, excludedPaths, filing.baseDir) had no UI at all. */
(function () {
  const { escapeHtml, toast } = window.DS.util;
  const api = window.DS.api;

  const local = { spaces: [], editing: null };

  const TYPE_ICON = {
    project: 'layers', team: 'users', workflow: 'workflow',
    archive: 'inbox', documentation: 'book', temporary: 'clock',
  };

  const SPACE_TYPES = ['project', 'team', 'workflow', 'archive', 'documentation', 'temporary'];
  const THEME_PRESETS = ['noobly'];

  function visBadge(v) {
    if (v === 'private') return `<span class="badge neutral">${icon('lock', 10)} Private</span>`;
    if (v === 'team') return `<span class="badge info">${icon('users', 10)} Team</span>`;
    return `<span class="badge success">${icon('globe', 10)} Public</span>`;
  }

  /* ---------- value helpers ----------
     Every list-shaped field (allowedUsers, allowedPaths, excludedPaths,
     allowedExtensions) is edited as one entry per line: it round-trips exactly,
     needs no separator escaping, and a path containing a comma stays one entry. */
  function linesFrom(arr) {
    return Array.isArray(arr) ? arr.join('\n') : '';
  }
  function toLines(value) {
    return String(value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** The object form of a theme, or an empty object when it is a preset/absent. */
  function themeObject(space) {
    const t = space && space.theme;
    return (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
  }
  /** The preset name when a theme is the string form, else ''. */
  function themePreset(space) {
    const t = space && space.theme;
    return typeof t === 'string' ? t : '';
  }

  /* ---------- the one form ---------- */

  /**
   * Renders every field of a space record. `space` is the record being edited,
   * or null/{} when creating.
   *
   * Read-only audit fields (id, created*, updated*) are shown but never sent —
   * the server owns them, and seeing them here is what makes this screen a
   * usable substitute for opening spaces.json by hand.
   */
  function spaceFormHtml(space) {
    const s = space || {};
    const cfg = s.configuration || {};
    const filing = cfg.filing || {};
    const theme = themeObject(s);
    const preset = themePreset(s);
    const meta = s.metadata || {};
    const val = (v) => escapeHtml(v == null ? '' : String(v));

    const colorField = (label, field, value, help) => `
      <div class="field">
        <label class="field-label">${label}</label>
        <div class="row" style="gap:8px;align-items:center">
          <input class="input mono" data-field="${field}" value="${val(value)}" placeholder="#0e5c5c" style="flex:1"/>
          <input type="color" data-color-for="${field}" value="${/^#[0-9a-f]{6}$/i.test(value || '') ? val(value) : '#000000'}"
                 title="Pick a colour" style="width:38px;height:36px;padding:2px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer"/>
        </div>
        ${help ? `<div class="field-help">${help}</div>` : ''}
      </div>`;

    return `
      <div data-space-form>
        <div class="form-section">${icon('info', 12)} Identity</div>
        <div class="field">
          <label class="field-label">Name <span class="req">*</span></label>
          <input class="input" data-field="name" value="${val(s.name)}" placeholder="e.g., Engineering Space"/>
          <div class="field-help">Documents are resolved by space NAME — renaming one breaks open tabs until they reload.</div>
        </div>
        <div class="field">
          <label class="field-label">Description</label>
          <textarea class="textarea" data-field="description" style="min-height:60px" placeholder="Optional">${val(s.description)}</textarea>
        </div>
        <div class="grid-cols-3">
          <div class="field">
            <label class="field-label">Type</label>
            <select class="select" data-field="type">
              ${SPACE_TYPES.map((t) => `<option value="${t}"${(s.type || 'project') === t ? ' selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Visibility</label>
            <select class="select" data-field="visibility">
              ${['public', 'team', 'private'].map((v) => `<option value="${v}"${(s.visibility || 'team') === v ? ' selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Permissions</label>
            <select class="select" data-field="permissions">
              ${['read-write', 'read-only'].map((p) => `<option value="${p}"${(s.permissions || 'read-write') === p ? ' selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">Allowed users</label>
          <textarea class="textarea mono" data-field="allowedUsers" style="min-height:64px"
                    placeholder="one email per line">${val(linesFrom(s.allowedUsers))}</textarea>
          <div class="field-help">One email per line. Applies to team/private spaces; the creator always retains access.</div>
        </div>

        <div class="form-section">${icon('folder', 12)} Filing</div>
        <div class="grid-cols-3">
          <div class="field">
            <label class="field-label">Provider</label>
            <select class="select" data-field="filingProvider">
              ${['local', 'git', 'ftp', 's3'].map((p) => `<option value="${p}"${(filing.provider || 'local') === p ? ' selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Max file size (bytes)</label>
            <input class="input mono" type="number" min="0" data-field="filingMaxFileSize" value="${val(filing.maxFileSize)}" placeholder="10485760"/>
          </div>
          <div class="field">
            <label class="field-label">Allowed extensions</label>
            <textarea class="textarea mono" data-field="filingAllowedExtensions" style="min-height:36px"
                      placeholder="*">${val(linesFrom(filing.allowedExtensions))}</textarea>
          </div>
        </div>
        <div class="field">
          <label class="field-label">Base directory</label>
          <input class="input mono" data-field="filingBaseDir" value="${val(filing.baseDir)}" placeholder="../knowledge-content/engineering"/>
          <div class="field-help">The content root. Several spaces may share one — they then differ only by the paths below.</div>
        </div>

        <div class="form-section">${icon('filter', 12)} Path curation</div>
        <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:16px">
          <div class="field">
            <label class="field-label">Allowed paths</label>
            <textarea class="textarea mono" data-field="allowedPaths" style="min-height:88px"
                      placeholder="empty = the whole content root">${val(linesFrom(cfg.allowedPaths))}</textarea>
            <div class="field-help">Prefix match, one per line. Empty means no restriction.</div>
          </div>
          <div class="field">
            <label class="field-label">Excluded paths</label>
            <textarea class="textarea mono" data-field="excludedPaths" style="min-height:88px"
                      placeholder="Solution Design/Fintech Technologies/">${val(linesFrom(cfg.excludedPaths))}</textarea>
            <div class="field-help">Prefix match, one per line. Applied after the allow list.</div>
          </div>
        </div>

        <div class="form-section">${icon('sparkles', 12)} Brand &amp; landing page</div>
        <div class="field">
          <label class="field-label">Brand source</label>
          <select class="select" data-field="themeMode">
            <option value="custom"${!preset ? ' selected' : ''}>Custom — set the fields below</option>
            <option value="preset"${preset ? ' selected' : ''}>Preset — named theme from theme.js</option>
            <option value="none">None — use the default noobly brand</option>
          </select>
        </div>
        <div class="field" data-theme-part="preset"${preset ? '' : ' hidden'}>
          <label class="field-label">Preset name</label>
          <input class="input mono" data-field="themePreset" value="${val(preset)}" list="dsThemePresets" placeholder="noobly"/>
          <datalist id="dsThemePresets">${THEME_PRESETS.map((p) => `<option value="${p}"></option>`).join('')}</datalist>
        </div>
        <div data-theme-part="custom"${preset ? ' hidden' : ''}>
          <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:16px">
            <div class="field">
              <label class="field-label">Title</label>
              <input class="input" data-field="themeTitle" value="${val(theme.title)}" placeholder="Engineering Wiki"/>
            </div>
            <div class="field">
              <label class="field-label">Subtitle</label>
              <input class="input" data-field="themeSubtitle" value="${val(theme.subtitle)}" placeholder="Wiki"/>
            </div>
          </div>
          <div class="field">
            <label class="field-label">Logo image</label>
            <input class="input mono" data-field="themeImage" value="${val(theme.image)}" placeholder="/images/noobly-logo-colour.png"/>
          </div>
          <div class="grid-2" style="grid-template-columns:1fr 1fr;gap:16px">
            ${colorField('Colour', 'themeColor', theme.color, 'The accent; an 8-step ramp is derived from it.')}
            ${colorField('Highlight colour', 'themeColorHighlight', theme['color-highlight'], 'The light end of the ramp.')}
          </div>
        </div>
        <div class="field">
          <label class="field-label">Landing page</label>
          <input class="input mono" data-field="themeHome" value="${val(theme.home != null ? theme.home : s.home)}" placeholder="Engineering.md"/>
          <div class="field-help">Space-relative. This is what lets spaces sharing one content root open on different pages.</div>
        </div>

        <div class="form-section">${icon('settings', 12)} State</div>
        <div class="field">
          <label class="row" style="gap:8px;align-items:center;cursor:pointer">
            <input type="checkbox" data-field="archived"${meta.archived ? ' checked' : ''} style="width:15px;height:15px;cursor:pointer"/>
            <span class="field-label" style="margin:0">Archived</span>
          </label>
          <div class="field-help">Archived spaces stay on disk and are filtered out of the default listing.</div>
        </div>
        ${s.id != null ? `
        <div class="audit-grid">
          <div><span>ID</span><b class="mono">${val(s.id)}</b></div>
          <div><span>Created</span><b>${val(s.createdAt)}</b></div>
          <div><span>Created by</span><b>${val(s.createdBy)}</b></div>
          <div><span>Updated</span><b>${val(s.updatedAt)}</b></div>
          <div><span>Updated by</span><b>${val(s.updatedBy)}</b></div>
        </div>` : ''}
      </div>`;
  }

  /**
   * Reads the form back into an API payload.
   *
   * MERGES onto the record being edited rather than rebuilding it: a space's
   * `configuration`, `theme` and `metadata` may legitimately carry keys this
   * form does not know about, and PUT replaces those objects wholesale — so a
   * blind rebuild would silently delete them on the next save.
   *
   * @param {!Element} scope The [data-space-form] container.
   * @param {?Object} original The record being edited, or null when creating.
   * @return {?Object} Payload, or null when validation failed (a toast is shown).
   */
  function readSpaceForm(scope, original) {
    const get = (f) => {
      const el = scope.querySelector(`[data-field="${f}"]`);
      if (!el) return '';
      return el.type === 'checkbox' ? el.checked : el.value.trim();
    };

    const name = get('name');
    if (!name) { toast('Name is required', 'warn'); return null; }

    const base = original || {};
    const baseCfg = base.configuration || {};
    const baseFiling = baseCfg.filing || {};

    // An emptied filing field is REMOVED, not stored as "" / []. Absent means
    // "not configured" everywhere else in the platform — contentRootKey falls
    // back to a per-space key when there is no baseDir — whereas an empty string
    // is a configured value that resolves to the process working directory.
    const filing = Object.assign({}, baseFiling, { provider: get('filingProvider') || 'local' });
    const setOrDrop = (key, value) => {
      if (value === '' || (Array.isArray(value) && value.length === 0)) delete filing[key];
      else filing[key] = value;
    };
    setOrDrop('baseDir', get('filingBaseDir'));
    setOrDrop('allowedExtensions', toLines(get('filingAllowedExtensions')));
    const maxFileSize = get('filingMaxFileSize');
    setOrDrop('maxFileSize', maxFileSize === '' ? '' : Number(maxFileSize));

    const configuration = Object.assign({}, baseCfg, {
      filing,
      allowedPaths: toLines(get('allowedPaths')),
      excludedPaths: toLines(get('excludedPaths'))
    });

    // `null` clears the brand — see the PUT handler in spacesRoutes.js, which
    // distinguishes null (clear) from undefined (leave alone).
    let theme = null;
    const mode = get('themeMode');
    const home = get('themeHome');
    if (mode === 'preset') {
      theme = get('themePreset') || null;
      // A preset carries no `home`, so a landing page set alongside one would be
      // silently lost. Keep it addressable via the record's top-level `home`,
      // which navigation-core checks straight after theme.home.
    } else if (mode === 'custom') {
      const custom = Object.assign({}, themeObject(base));
      const put = (key, value) => { if (value) custom[key] = value; else delete custom[key]; };
      put('title', get('themeTitle'));
      put('subtitle', get('themeSubtitle'));
      put('image', get('themeImage'));
      put('color', get('themeColor'));
      put('color-highlight', get('themeColorHighlight'));
      put('home', home);
      theme = Object.keys(custom).length ? custom : null;
    }

    const payload = {
      name,
      description: get('description'),
      type: get('type'),
      visibility: get('visibility'),
      permissions: get('permissions'),
      allowedUsers: toLines(get('allowedUsers')),
      configuration,
      theme,
      metadata: Object.assign({}, base.metadata, { archived: !!get('archived') })
    };

    // Preserve a landing page chosen while a preset brand is selected.
    if (mode !== 'custom' && home) payload.home = home;

    return payload;
  }

  /* Keep the colour picker and its hex field in step, and show/hide the theme
     fields for the selected brand source. Delegated so it survives re-renders. */
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;

    const colorFor = t.getAttribute('data-color-for');
    if (colorFor) {
      const text = t.closest('.field').querySelector(`[data-field="${colorFor}"]`);
      if (text) text.value = t.value;
      return;
    }
    if (t.matches('[data-field="themeColor"], [data-field="themeColorHighlight"]')) {
      const picker = t.closest('.field').querySelector('[data-color-for]');
      if (picker && /^#[0-9a-f]{6}$/i.test(t.value.trim())) picker.value = t.value.trim();
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('[data-field="themeMode"]')) return;
    const form = t.closest('[data-space-form]');
    if (!form) return;
    const mode = t.value;
    form.querySelectorAll('[data-theme-part]').forEach((part) => {
      part.hidden = part.getAttribute('data-theme-part') !== mode;
    });
  });

  /* ---------- list view ---------- */
  function renderBody() {
    const list = local.spaces;
    return list.length ? `
      <div class="grid-3">
        ${list.map((s) => {
          const ic = TYPE_ICON[(s.type || '').toLowerCase()] || 'folderOpen';
          const openParams = escapeHtml(JSON.stringify({ browse: s.id, spaceName: s.name || 'Space' }));
          const swatch = themeObject(s).color;
          return `<div class="card"><div class="card-pad">
            <div class="row between" style="align-items:flex-start">
              <div style="width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:${swatch ? escapeHtml(swatch) : 'var(--gold-50)'};color:${swatch ? '#fff' : 'var(--gold-700)'}">${icon(ic, 18)}</div>
              <button class="btn btn-icon-sm" title="Delete" data-action="delete" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}" style="color:var(--danger-700)">${icon('trash', 12)}</button>
            </div>
            <div style="font-weight:600;font-size:14px;color:var(--ink-900);margin-top:10px">${escapeHtml(s.name)}</div>
            <div style="font-size:12px;color:var(--ink-500);margin-top:2px;min-height:32px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(s.description || '')}</div>
            <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
              ${s.type ? `<span class="tag">${escapeHtml(s.type)}</span>` : ''}
              ${visBadge(s.visibility)}
              ${(s.metadata && s.metadata.archived) ? `<span class="badge neutral">${icon('inbox', 10)} Archived</span>` : ''}
            </div>
            ${(s.allowedUsers && s.allowedUsers.length) ? `<div style="font-size:11.5px;color:var(--ink-500);margin-top:8px">${s.allowedUsers.length} member${s.allowedUsers.length === 1 ? '' : 's'}</div>` : ''}
            <button class="btn btn-sm" style="width:100%;justify-content:center;margin-top:12px"
                    data-action="nav" data-screen="spaces" data-params="${openParams}">
              ${icon('sliders', 13)} Settings &amp; files
            </button>
          </div></div>`;
        }).join('')}
      </div>` : `<div class="card"><div class="empty-state">
        <div class="ico">${icon('folderOpen', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">No spaces</div>
        <div style="font-size:12.5px;margin:4px 0 14px">Spaces organise knowledge and control access.</div>
        <button class="btn btn-primary btn-sm" data-action="show-create">${icon('plus', 13)} New space</button>
      </div></div>`;
  }

  /* ---------- detail view: settings ABOVE the file browser ---------- */
  function renderDetail(root, id, fallbackName) {
    const region = root.querySelector('[data-region="body"]');
    region.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:48px;justify-content:center;color:var(--ink-500)">
      <span class="spinner"></span> Loading space…</div>`;

    api.get(`/api/spaces/${encodeURIComponent(id)}`).then((space) => {
      local.editing = space || null;
      const name = (space && space.name) || fallbackName;
      region.innerHTML = `
        <button class="btn btn-ghost btn-sm" data-action="nav" data-screen="spaces" style="margin-bottom:14px">
          ${icon('chevronLeft', 13)} Back to spaces
        </button>

        <div class="card" style="margin-bottom:16px">
          <div class="card-head">
            <div class="card-title">${icon('sliders', 16)} ${escapeHtml(name)} — settings</div>
            <div class="row" style="gap:8px">
              <span data-save-status style="font-size:11.5px;color:var(--ink-500)"></span>
              <button class="btn btn-sm" data-action="revert">${icon('refresh', 13)} Revert</button>
              <button class="btn btn-primary btn-sm" data-action="do-save">${icon('save', 13)} Save changes</button>
            </div>
          </div>
          <div class="card-pad">${spaceFormHtml(space)}</div>
        </div>

        <div class="card" style="overflow:hidden">
          <div class="card-head"><div class="card-title">${icon('folderOpen', 16)} Files</div></div>
          <div id="spacesFilerHost" style="height:62vh"></div>
        </div>`;
      window.DS.filing.mount(region.querySelector('#spacesFilerHost'), { instance: `space-${id}` });
    }).catch((err) => {
      region.innerHTML = `<div class="empty-state">
        <div class="ico">${icon('alertTriangle', 22)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--ink-800)">Couldn't load this space</div>
        <div style="font-size:12.5px;margin:4px 0 14px">${escapeHtml(err && err.message || 'Request failed')}</div>
        <button class="btn btn-sm" data-action="nav" data-screen="spaces">${icon('chevronLeft', 13)} Back to spaces</button>
      </div>`;
    });
  }

  function createModal() {
    return `
      <div class="modal-card" style="width:min(760px,96vw)">
        <div class="card-head">
          <div class="card-title">${icon('folderPlus', 16)} New space</div>
          <button class="btn btn-icon-sm" data-action="modal-close">${icon('x', 14)}</button>
        </div>
        <div class="card-pad modal-body" style="max-height:74vh">
          ${spaceFormHtml(null)}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
            <button class="btn" data-action="modal-close">Cancel</button>
            <button class="btn btn-primary" data-action="do-create">${icon('plus', 13)} Create space</button>
          </div>
        </div>
      </div>`;
  }

  function html() {
    const actions = `<button class="btn btn-primary" data-action="show-create">${icon('plus', 14)} New space</button>`;
    return `${pageHead('spaces', actions)}<div data-region="body"></div>`;
  }

  function init(root, state) {
    const browseId = state && state.params && state.params.browse;
    if (browseId) {
      renderDetail(root, browseId, (state.params && state.params.spaceName) || 'Space');
      return;
    }
    local.editing = null;
    window.DS.util.loadRegion(root, async () => {
      local.spaces = await api.get('/api/spaces') || [];
      return true;
    }, () => renderBody());
  }

  async function refresh() {
    local.spaces = await api.get('/api/spaces') || [];
    rerenderScreen();
  }

  async function handle(action, el) {
    if (action === 'retry') return rerenderScreen();

    if (action === 'show-create') {
      window.Router.openModal(createModal());
      return;
    }

    if (action === 'do-create') {
      const scope = document.querySelector('#kr-modal-root [data-space-form]');
      if (!scope) return;
      const payload = readSpaceForm(scope, null);
      if (!payload) return;
      try {
        await api.post('/api/spaces', payload);
        window.Router.closeModal();
        toast('Space created', 'success');
        refresh();
      } catch (err) { toast('Failed to create space: ' + err.message, 'danger'); }
      return;
    }

    if (action === 'do-save') {
      const scope = document.querySelector('[data-region="body"] [data-space-form]');
      if (!scope || !local.editing) return;
      const payload = readSpaceForm(scope, local.editing);
      if (!payload) return;
      const status = document.querySelector('[data-save-status]');
      if (status) { status.textContent = 'Saving…'; status.style.color = ''; }
      try {
        const updated = await api.put(`/api/spaces/${encodeURIComponent(local.editing.id)}`, payload);
        local.editing = updated || local.editing;
        if (status) {
          status.textContent = 'Saved';
          status.style.color = 'var(--success-700)';
          setTimeout(() => { if (status.textContent === 'Saved') status.textContent = ''; }, 2500);
        }
        toast('Space saved', 'success');
        // A rename only reaches SpaceManager.spaces at boot, and the wiki
        // resolves documents by NAME — so say so rather than let it look applied.
        if (payload.name !== (updated && updated.name)) refresh();
      } catch (err) {
        if (status) { status.textContent = 'Not saved'; status.style.color = 'var(--danger-700)'; }
        toast('Failed to save space: ' + err.message, 'danger');
      }
      return;
    }

    if (action === 'revert') {
      rerenderScreen();
      return;
    }

    if (action === 'delete') {
      if (!confirm(`Delete space "${el.dataset.name}"?`)) return;
      try { await api.del(`/api/spaces/${el.dataset.id}`); toast('Space deleted', 'success'); refresh(); }
      catch (err) { toast('Failed to delete: ' + err.message, 'danger'); }
    }
  }

  window.Router.register('spaces', { html, init, handle }, {
    title: 'Spaces',
    sub: 'Configure knowledge spaces and access.',
    crumb: ['Knowledge', 'Spaces'],
  });
})();
