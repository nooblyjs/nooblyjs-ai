/**
 * Templates Controller — the "Templates" hub reached from the Shortcuts rail.
 *
 * One central-content view (#templatesView) with two tabs:
 *
 *   1. Document templates — markdown files in a `.system/templates/` folder,
 *      listed and editable right here (same storage the "create document from
 *      template" flow and the profile screen use).
 *
 *   2. Continuous Exploration templates — prompt + document-list bundles in a
 *      `.system/continuous-explorations/.templates/` folder. Card grid + editor
 *      ported from the retired standalone Continuous Exploration app's "Manage
 *      Templates" section.
 *
 * Both tabs carry a second row of SCOPE tabs — Mine / Folder / Space — and the
 * active one is where "New template" writes. That is the point of the row: the
 * destination is the screen you are on, not a dropdown you might not read.
 *
 *   Mine    <space>/.system/useractivity/<prefix>/…  yours, every folder
 *   Folder  <folder>/.system/…                       the picked folder + below
 *   Space   <space>/.system/…                         the whole space (admin)
 *
 * The Folder tab shows the CASCADE for the picked folder — its own templates
 * first, then each ancestor's, ending at the space tier — because that is
 * exactly what someone creating a file there will be offered. Anything not
 * owned by the picked folder is shown as inherited and read-only here; edit it
 * where it lives.
 *
 * @author noobly Team
 * @version 3.0.0
 * @since 2026-06-11
 */

const WIKI_API = '/applications/wiki/api';
const BP_API = '/applications/wiki/api/continuous-explorations';

function el(id) { return document.getElementById(id); }
function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
function fmtDate(value) {
    if (!value) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

const TABS = [
    { key: 'documents', icon: 'bi-file-earmark-code', label: 'Document templates' },
    { key: 'continuous-exploration-templates', icon: 'bi-diagram-3', label: 'Continuous Exploration templates' }
];

/** Where a new template gets written. The active tab IS the destination. */
const SCOPES = [
    { key: 'personal', icon: 'bi-person', label: 'Mine', blurb: 'Only you see these, in every folder of the space.' },
    { key: 'folder', icon: 'bi-folder', label: 'Folder', blurb: 'Offered when creating a file in this folder or below it.' },
    { key: 'space', icon: 'bi-building', label: 'Space', blurb: 'Offered everywhere in the space. Space administrators only.' }
];

export const templatesController = {
    app: null,
    activeTab: 'documents',
    activeScope: 'personal',
    /** Folder the Folder scope is aimed at ('' = space root). */
    folderPath: '',
    /** Space the Folder scope resolves against — a cascade is rooted in one space. */
    folderSpaceId: null,
    userDir: null,
    data: { docTemplates: [], ceTemplates: [], spaces: [], folderDocTemplates: [], folderCeTemplates: [] },

    init(app) {
        this.app = app;
    },

    /**
     * True when this template is owned by the folder currently picked, as opposed
     * to inherited from an ancestor. Only the owned ones are editable here —
     * an inherited one is edited where it lives, so that a fix made in the Buy
     * folder can't silently rewrite a space-wide template for everyone.
     */
    isOwnedByPickedFolder(t) {
        return t.scope === 'folder' && (t.folderPath || '') === (this.folderPath || '');
    },

    /** Space record the Folder scope is working against. */
    folderSpace() {
        const id = this.folderSpaceId ?? this.defaultSpaceId();
        return this.data.spaces.find(s => String(s.id) === String(id)) || null;
    },

    /** Whether the current user may manage the given space's space-level templates. */
    canAdminSpace(spaceId) {
        const s = this.data.spaces.find(sp => String(sp.id) === String(spaceId));
        return !!(s && s.canAdminSpace);
    },

    /** First space the user can administer (for defaulting the Space scope option). */
    firstAdminSpaceId() {
        const s = this.data.spaces.find(sp => sp.canAdminSpace);
        return s ? s.id : '';
    },

    /** Switch the main content area to the Templates hub. */
    async show(tab) {
        if (tab) this.activeTab = tab;
        // Open aimed at wherever the user just was, so the Folder scope is useful
        // immediately rather than defaulting to the root every time.
        if (this.folderSpaceId === null) {
            this.folderSpaceId = this.app?.currentSpace?.id ?? null;
            this.folderPath = this.app?.currentFolder || '';
        }
        this.app?.setActiveView('templates');
        this.app?.setActiveShortcut('shortcutTemplates');
        this.renderShell();
        await this.loadAll();
    },

    // ─── Shell ───────────────────────────────────────────────────────────

    renderShell() {
        const mount = el('templatesContent');
        if (!mount) return;
        // Panelled like the profile sections (.pf-section): a head band with an
        // icon, then white cards on the page ground. Everything is inside
        // `.tpl-hub` so the styling can key off it without touching the `.pf-*`
        // rules the profile screen shares.
        mount.innerHTML = `
          <div class="tpl-hub">
            <div class="tpl-hub-head">
              <div class="ico"><i class="bi bi-files"></i></div>
              <div class="titles">
                <h1>Templates</h1>
                <p>
                  Templates are offered when you create a new document. Pick where they live —
                  the closest one to a folder wins.
                </p>
              </div>
            </div>
            <div class="tpl-hub-panel tpl-hub-controls">
              <div class="ce-tabs">
                ${TABS.map(t => `
                  <button type="button" class="ce-tab ${this.activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">
                    <i class="bi ${t.icon}"></i> ${t.label}
                  </button>`).join('')}
              </div>
              <div class="tpl-scope-tabs" id="tplScopeTabs"></div>
            </div>
            <div id="tplTabContent">
              <div class="tpl-hub-panel" style="padding: 20px; color: var(--kr-ink-400); font-size: 12px;">Loading…</div>
            </div>
          </div>
        `;
        mount.querySelectorAll('.ce-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                this.activeTab = btn.dataset.tab;
                mount.querySelectorAll('.ce-tab').forEach(b => b.classList.toggle('active', b === btn));
                this.renderScopeTabs();
                this.renderActiveTab();
            });
        });
        this.renderScopeTabs();
    },

    /**
     * The Mine / Folder / Space row — the control that answers "where is this
     * template going?". Rendered separately from the shell so switching scope
     * can repaint it (the Folder picker below it belongs to one scope only).
     */
    renderScopeTabs() {
        const host = el('tplScopeTabs');
        if (!host) return;

        const canAdminAny = this.data.spaces.some(s => s.canAdminSpace);
        const scopes = SCOPES.filter(s => s.key !== 'space' || canAdminAny || this.hasSpaceTemplates());
        if (!scopes.some(s => s.key === this.activeScope)) this.activeScope = scopes[0].key;
        const active = scopes.find(s => s.key === this.activeScope);

        host.innerHTML = `
          <div class="tpl-scope-row">
            ${scopes.map(s => `
              <button type="button" class="tpl-scope-tab ${this.activeScope === s.key ? 'active' : ''}" data-scope="${s.key}">
                <i class="bi ${s.icon}"></i> ${s.label}
              </button>`).join('')}
          </div>
          <div class="tpl-scope-blurb">${esc(active ? active.blurb : '')}</div>
          ${this.activeScope === 'folder' ? this.renderFolderPicker() : ''}
        `;

        host.querySelectorAll('.tpl-scope-tab').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (this.activeScope === btn.dataset.scope) return;
                this.activeScope = btn.dataset.scope;
                this.renderScopeTabs();
                if (this.activeScope === 'folder') await this.loadFolderTemplates();
                this.renderActiveTab();
            });
        });

        if (this.activeScope === 'folder') this.bindFolderPicker(host);
    },

    /** True when any space tier template exists (so the tab is worth showing read-only). */
    hasSpaceTemplates() {
        return this.data.docTemplates.some(t => t.scope === 'space')
            || this.data.ceTemplates.some(t => t.scope === 'space');
    },

    /**
     * Space + folder picker for the Folder scope. Free-text for the folder rather
     * than a tree widget: the nav tree is lazy (see navigationController), so a
     * picker that insisted on a fully-listed tree would force the exhaustive walk
     * the lazy tree exists to avoid. Defaults to the folder the user came from.
     */
    renderFolderPicker() {
        return `
          <div class="tpl-folder-picker">
            <div>
              <label class="form-label">Space</label>
              <select class="form-select" data-tpl-folder-space>${this.spaceOptions(this.folderSpaceId ?? this.defaultSpaceId())}</select>
            </div>
            <div style="flex: 1; min-width: 220px;">
              <label class="form-label">Folder</label>
              <input type="text" class="form-control" data-tpl-folder-path
                     placeholder="Leave empty for the space root"
                     value="${esc(this.folderPath)}">
            </div>
            <button class="ce-btn ghost" data-tpl-folder-apply><i class="bi bi-arrow-repeat"></i> Show</button>
          </div>`;
    },

    bindFolderPicker(host) {
        const spaceSel = host.querySelector('[data-tpl-folder-space]');
        const pathInput = host.querySelector('[data-tpl-folder-path]');
        const apply = async () => {
            this.folderSpaceId = spaceSel ? spaceSel.value : this.folderSpaceId;
            this.folderPath = (pathInput ? pathInput.value : '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
            await this.loadFolderTemplates();
            this.renderActiveTab();
        };
        host.querySelector('[data-tpl-folder-apply]')?.addEventListener('click', apply);
        if (spaceSel) spaceSel.addEventListener('change', apply);
        if (pathInput) pathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
        });
    },

    async loadAll() {
        const results = await Promise.allSettled([
            fetch(`${WIKI_API}/templates`, { credentials: 'include' }).then(r => r.json()),
            fetch(`${BP_API}/templates`, { credentials: 'include' }).then(r => r.json()),
            fetch(`${WIKI_API}/spaces`, { credentials: 'include' }).then(r => r.json()),
            fetch('/api/auth/check', { credentials: 'include' }).then(r => r.json())
        ]);
        const [docs, ceTpls, spaces, auth] = results.map(r => r.status === 'fulfilled' ? r.value : null);
        this.data.docTemplates = Array.isArray(docs) ? docs : [];
        this.data.ceTemplates = (ceTpls && ceTpls.templates) || [];
        this.data.spaces = Array.isArray(spaces) ? spaces : [];
        // Canonical per-space folder name for building personal template paths.
        this.userDir = (auth && auth.user && auth.user.userDir) || this.userDir || null;
        this.renderScopeTabs();
        if (this.activeScope === 'folder') await this.loadFolderTemplates();
        this.renderActiveTab();
    },

    /**
     * Load the cascade for the picked folder — both template kinds, one round trip
     * each. Kept out of `loadAll` because it is scoped to one space and one folder,
     * where the other two calls span every space the user can see.
     */
    async loadFolderTemplates() {
        const spaceId = this.folderSpaceId ?? this.defaultSpaceId();
        if (spaceId === '' || spaceId === undefined || spaceId === null) {
            this.data.folderDocTemplates = [];
            this.data.folderCeTemplates = [];
            return;
        }
        const q = `spaceId=${encodeURIComponent(spaceId)}&folderPath=${encodeURIComponent(this.folderPath || '')}`;
        const results = await Promise.allSettled([
            fetch(`${WIKI_API}/spaces/${encodeURIComponent(spaceId)}/templates?folderPath=${encodeURIComponent(this.folderPath || '')}`,
                { credentials: 'include' }).then(r => r.json()),
            fetch(`${BP_API}/templates?${q}`, { credentials: 'include' }).then(r => r.json())
        ]);
        const [docs, ce] = results.map(r => r.status === 'fulfilled' ? r.value : null);
        // Personal templates ride along on both endpoints but belong to the Mine
        // tab — the Folder tab is about what this folder inherits and owns.
        this.data.folderDocTemplates = (Array.isArray(docs) ? docs : []).filter(t => t.scope !== 'personal');
        this.data.folderCeTemplates = ((ce && ce.templates) || []).filter(t => t.scope !== 'personal');
    },

    /** Templates the active scope should list, for the active tab. */
    scopedItems(kind) {
        if (this.activeScope === 'folder') {
            return kind === 'ce' ? this.data.folderCeTemplates : this.data.folderDocTemplates;
        }
        const all = kind === 'ce' ? this.data.ceTemplates : this.data.docTemplates;
        return this.activeScope === 'personal'
            ? all.filter(t => t.scope === 'personal')
            : all.filter(t => t.scope === 'space');
    },

    renderActiveTab() {
        const wrap = el('tplTabContent');
        if (!wrap) return;
        if (this.activeTab === 'continuous-exploration-templates') this.renderContinuousExplorationTplList(wrap);
        else this.renderDocumentsTab(wrap);
    },

    groupBySpace(items) {
        return items.reduce((acc, it) => {
            const k = it.spaceName || 'Unknown';
            (acc[k] = acc[k] || []).push(it);
            return acc;
        }, {});
    },

    spaceOptions(selectedId) {
        return this.data.spaces.map(s =>
            `<option value="${s.id}" ${String(s.id) === String(selectedId) ? 'selected' : ''}>${esc(s.name)}</option>`
        ).join('');
    },

    defaultSpaceId() {
        return this.app?.currentSpace?.id ?? this.data.spaces[0]?.id ?? '';
    },

    // ════════════════════════════════════════════════════════════════════
    // Tab 1 — Document templates (.system/templates/, markdown)
    // ════════════════════════════════════════════════════════════════════

    /**
     * Render one section as grouped template buttons.
     *
     * Grouping is by SPACE for the Mine/Space scopes (they span every space the
     * user can see) and by owning FOLDER for the Folder scope, where every entry
     * is in one space and the useful distinction is which folder it came from.
     *
     * `readOnly` forces the buttons non-editable regardless of the server's
     * `canEdit`: an inherited template is editable, just not from here — editing
     * it while standing in Buy would rewrite it for every folder that inherits it.
     */
    renderDocScopeSection(label, icon, items, { readOnly = false } = {}) {
        if (!items.length) return '';
        const byGroup = this.activeScope === 'folder'
            ? items.reduce((acc, t) => {
                const k = t.scope === 'folder' ? (t.folderPath || 'Space root') : `${t.spaceName} (space-wide)`;
                (acc[k] = acc[k] || []).push(t);
                return acc;
              }, {})
            : this.groupBySpace(items);
        const groupIcon = this.activeScope === 'folder' ? 'bi-folder2' : 'bi-collection';
        return `
          <div class="pf-tpl-scope">
            <div class="pf-tpl-scope-head" style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--kr-ink-500);margin:6px 0 8px;">
              <i class="bi ${icon}"></i> ${esc(label)}
            </div>
            ${Object.entries(byGroup).map(([groupName, templates]) => `
              <div class="pf-tpl-group">
                <div class="pf-tpl-group-head">
                  <i class="bi ${groupIcon}"></i> ${esc(groupName)}
                  <span class="pf-tpl-group-count">${templates.length}</span>
                </div>
                ${templates.map(t => `
                  <button class="pf-tpl-item" type="button" data-doc-open
                          data-space-id="${esc(t.spaceId)}"
                          data-space-name="${esc(t.spaceName)}"
                          data-path="${esc(t.path)}"
                          data-can-edit="${!readOnly && t.canEdit ? '1' : '0'}">
                    <i class="bi bi-file-earmark-text"></i>
                    <div class="pf-tpl-meta">
                      <div class="pf-tpl-title">${esc(t.title || t.name)}</div>
                      <div class="pf-tpl-sub">${esc(t.path)} · ${fmtDate(t.lastModified)}</div>
                    </div>
                  </button>
                `).join('')}
              </div>
            `).join('')}
          </div>`;
    },

    /**
     * The Folder scope's list: the cascade, split into what this folder OWNS and
     * what it inherits. Both are shown — seeing what you already inherit is the
     * point of standing in a folder — but only the owned ones are editable here.
     */
    renderFolderCascadeSections(items) {
        const owned = items.filter(t => this.isOwnedByPickedFolder(t));
        const inherited = items.filter(t => !this.isOwnedByPickedFolder(t));
        const here = this.folderPath || 'the space root';
        return this.renderDocScopeSection(`In ${here}`, 'bi-folder-fill', owned)
             + this.renderDocScopeSection('Inherited from above', 'bi-arrow-up-circle', inherited, { readOnly: true });
    },

    /** Where the active scope writes, spelled out so it is never a guess. */
    destinationHint() {
        if (this.activeScope === 'personal') {
            return `.system/useractivity/${this.userDir || '<you>'}/templates/`;
        }
        if (this.activeScope === 'space') return '.system/templates/';
        return `${this.folderPath ? this.folderPath + '/' : ''}.system/templates/`;
    },

    renderDocumentsTab(wrap) {
        const items = this.scopedItems('doc');
        const isFolder = this.activeScope === 'folder';
        const ownedCount = isFolder ? items.filter(t => this.isOwnedByPickedFolder(t)).length : items.length;

        wrap.innerHTML = `
          <div class="tpl-hub-panel tpl-hub-toolbar">
            <div class="tpl-hub-toolbar-text">
              <strong>${ownedCount}</strong> template${ownedCount === 1 ? '' : 's'} here${
                isFolder && items.length > ownedCount ? ` · ${items.length - ownedCount} inherited` : ''}
              · new ones go to <code>${esc(this.destinationHint())}</code>
            </div>
            <button class="ce-btn" data-doc-new><i class="bi bi-plus-lg"></i> New template</button>
          </div>
          <div data-doc-new-form style="display: none;" class="tpl-hub-panel tpl-hub-form">
            <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end;">
              <div style="flex: 1; min-width: 180px;">
                <label class="form-label" style="font-weight: 600;">Template name</label>
                <input type="text" class="form-control" data-doc-new-name placeholder="e.g. Meeting notes">
              </div>
              ${isFolder ? '' : `
              <div style="min-width: 180px;">
                <label class="form-label" style="font-weight: 600;">Space</label>
                <select class="form-select" data-doc-new-space>${this.spaceOptions(this.defaultSpaceId())}</select>
              </div>`}
              <div style="display: flex; gap: 8px;">
                <button class="ce-btn" data-doc-new-create>Create</button>
                <button class="ce-btn ghost" data-doc-new-cancel>Cancel</button>
              </div>
            </div>
            <div class="tpl-hub-hint">
              Creating in <code>${esc(this.destinationHint())}</code>${
                isFolder ? ` of ${esc(this.folderSpace()?.name || '')}` : ''}
            </div>
            <div data-doc-new-msg class="tpl-hub-err"></div>
          </div>
          <div class="pf-templates">
            <div class="pf-templates-list" data-doc-list>
              ${items.length ? '' : '<div class="pf-empty">No document templates here yet. Create one to get started.</div>'}
            </div>
            <div class="pf-templates-editor" data-doc-editor>
              <div class="pf-tpl-placeholder">Select a template on the left to preview or edit.</div>
            </div>
          </div>
        `;

        const list = wrap.querySelector('[data-doc-list]');
        if (items.length) {
            list.innerHTML = isFolder
                ? this.renderFolderCascadeSections(items)
                : this.renderDocScopeSection(
                    this.activeScope === 'personal' ? 'My templates' : 'Space templates',
                    this.activeScope === 'personal' ? 'bi-person' : 'bi-building',
                    items);
        }

        list.querySelectorAll('[data-doc-open]').forEach(btn =>
            btn.addEventListener('click', () => this.openDocTemplate(wrap, btn)));

        const newBtn = wrap.querySelector('[data-doc-new]');
        const form = wrap.querySelector('[data-doc-new-form]');
        newBtn.addEventListener('click', () => {
            form.style.display = form.style.display === 'none' ? '' : 'none';
            if (form.style.display !== 'none') form.querySelector('[data-doc-new-name]').focus();
        });
        form.querySelector('[data-doc-new-cancel]').addEventListener('click', () => { form.style.display = 'none'; });
        form.querySelector('[data-doc-new-create]').addEventListener('click', () => this.createDocTemplate(wrap, form));
    },

    async openDocTemplate(wrap, btn) {
        wrap.querySelectorAll('.pf-tpl-item.active').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const editor = wrap.querySelector('[data-doc-editor]');
        const spaceName = btn.dataset.spaceName;
        const tplPath = btn.dataset.path;
        const spaceId = btn.dataset.spaceId;
        const canEdit = btn.dataset.canEdit === '1';
        const title = btn.querySelector('.pf-tpl-title')?.textContent || tplPath;

        editor.innerHTML = `<div class="pf-tpl-placeholder">Loading…</div>`;

        let content = '';
        try {
            const url = `${WIKI_API}/documents/content?path=${encodeURIComponent(tplPath)}&spaceName=${encodeURIComponent(spaceName)}&enhanced=true`;
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            content = data.content || '';
        } catch (err) {
            editor.innerHTML = `<div class="pf-tpl-placeholder">Could not load template.</div>`;
            return;
        }

        editor.innerHTML = `
          <div class="pf-tpl-editor-head">
            <div class="pf-tpl-editor-title">
              <i class="bi bi-file-earmark-text"></i>
              <strong>${esc(title)}</strong>
              <span class="pf-tpl-editor-sub">${esc(spaceName)} · ${esc(tplPath)}</span>
            </div>
            <div class="pf-tpl-editor-acts">
              ${canEdit ? `
                <button class="pf-btn sm" type="button" data-doc-save><i class="bi bi-check2"></i> Save</button>
                <button class="pf-btn sm" type="button" data-doc-delete><i class="bi bi-trash"></i> Delete</button>
              ` : `<span class="pf-tpl-readonly" style="font-size:12px;color:var(--kr-ink-400);"><i class="bi bi-lock"></i> Read-only — only a space admin can edit this template</span>`}
            </div>
          </div>
          <textarea class="pf-tpl-textarea" data-doc-textarea spellcheck="false" ${canEdit ? '' : 'readonly'}></textarea>
          <div class="pf-tpl-msg" data-doc-msg></div>
        `;
        editor.querySelector('[data-doc-textarea]').value = content;

        if (!canEdit) return; // read-only preview: no save/delete handlers

        editor.querySelector('[data-doc-save]').addEventListener('click', async (e) => {
            const saveBtn = e.currentTarget;
            const msg = editor.querySelector('[data-doc-msg]');
            saveBtn.disabled = true;
            msg.textContent = 'Saving…'; msg.className = 'pf-tpl-msg';
            try {
                const res = await fetch(`${WIKI_API}/documents/content`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: tplPath, spaceName, content: editor.querySelector('[data-doc-textarea]').value })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.error || data.message || `HTTP ${res.status}`);
                msg.textContent = 'Saved.'; msg.className = 'pf-tpl-msg ok';
            } catch (err) {
                msg.textContent = err.message || 'Could not save template.'; msg.className = 'pf-tpl-msg err';
            } finally {
                saveBtn.disabled = false;
            }
        });

        editor.querySelector('[data-doc-delete]').addEventListener('click', async () => {
            if (!confirm(`Delete template "${tplPath}" from ${spaceName}? This cannot be undone.`)) return;
            try {
                const res = await fetch(`${WIKI_API}/documents/${encodeURIComponent(tplPath)}`, {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spaceName, spaceId })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.error || data.message || `HTTP ${res.status}`);
                await this.reloadDocTemplates();
            } catch (err) {
                alert(`Could not delete template: ${err.message}`);
            }
        });
    },

    async createDocTemplate(wrap, form) {
        const nameInput = form.querySelector('[data-doc-new-name]');
        const spaceSelect = form.querySelector('[data-doc-new-space]');
        const msg = form.querySelector('[data-doc-new-msg]');
        const name = (nameInput.value || '').trim();
        if (!name) { msg.textContent = 'Please give the template a name.'; return; }
        // The active scope tab IS the destination — there is no scope field.
        const scope = this.activeScope;
        const spaceId = scope === 'folder'
            ? (this.folderSpaceId ?? this.defaultSpaceId())
            : spaceSelect.value;
        // Build only the DIRECTORY from the scope. The file name is the name as
        // typed — this used to slugify it (`ADR Record` → `adr-record.md`), the
        // same transform that was renaming documents on create. A template is
        // read back by file name in the cascade, where the nearest folder
        // shadows an ancestor's template BY NAME, so a name the author cannot
        // predict is a name they cannot deliberately override. Sending
        // folderPath + fileName lets the server apply one set of naming and
        // validation rules (shared/utils/fileNaming.js) instead of a second
        // copy here.
        let templateDir;
        if (scope === 'space') {
            if (!this.canAdminSpace(spaceId)) {
                msg.textContent = 'You must be an administrator of this space to create a space template.';
                return;
            }
            templateDir = '.system/templates';
        } else if (scope === 'folder') {
            // Same directory shape as the space tier, just anchored at the folder —
            // which is what makes the space root simply the last rung of the cascade.
            templateDir = this.folderPath
                ? `${this.folderPath}/.system/templates`
                : '.system/templates';
        } else {
            if (!this.userDir) {
                msg.textContent = 'Could not resolve your user folder — please reload and try again.';
                return;
            }
            templateDir = `.system/useractivity/${this.userDir}/templates`;
        }

        msg.textContent = '';
        try {
            const res = await fetch(`${WIKI_API}/documents`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: name,
                    fileName: name,
                    spaceId,
                    folderPath: templateDir,
                    content: `# ${name}\n\nDescribe the structure this template should provide…\n`
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) throw new Error(data.error || data.message || `HTTP ${res.status}`);
            await this.reloadDocTemplates();
        } catch (err) {
            msg.textContent = `Could not create template: ${err.message}`;
        }
    },

    async reloadDocTemplates() {
        try {
            const res = await fetch(`${WIKI_API}/templates`, { credentials: 'include' });
            const data = await res.json();
            this.data.docTemplates = Array.isArray(data) ? data : [];
        } catch (_) { /* keep current list */ }
        // The all-spaces endpoint never returns folder templates (it would have to
        // walk every tree), so the cascade has to be re-fetched separately or a
        // just-created folder template would not appear until the next visit.
        if (this.activeScope === 'folder') await this.loadFolderTemplates();
        if (this.activeTab === 'documents') this.renderActiveTab();
    },

    // ════════════════════════════════════════════════════════════════════
    // Tab 2 — Continuous Exploration templates (.system/continuous-explorations/.templates/, prompt bundles)
    // ════════════════════════════════════════════════════════════════════

    templateGlyph(t) {
        const name = (t.name || '').toLowerCase();
        if (name.includes('pipeline')) return 'bi-stack';
        if (name.includes('integration')) return 'bi-plug';
        if (name.includes('micro') || name.includes('service')) return 'bi-diagram-3';
        if (name.includes('api')) return 'bi-activity';
        if (name.includes('ml') || name.includes('model')) return 'bi-diagram-2';
        if (name.includes('application') || name.includes('app')) return 'bi-app-indicator';
        return 'bi-rulers';
    },

    /** One CE scope section: card grids, grouped like the document sections. */
    renderCeScopeSection(label, icon, items, { readOnly = false } = {}) {
        if (!items.length) return '';
        const byGroup = this.activeScope === 'folder'
            ? items.reduce((acc, t) => {
                const k = t.scope === 'folder' ? (t.folderPath || 'Space root') : `${t.spaceName} (space-wide)`;
                (acc[k] = acc[k] || []).push(t);
                return acc;
              }, {})
            : this.groupBySpace(items);
        const groupIcon = this.activeScope === 'folder' ? 'bi-folder2' : 'bi-collection';
        return `
          <div class="ce-tpl-scope" style="margin-bottom: 8px;">
            <div class="pf-tpl-scope-head" style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--kr-ink-500);margin:6px 0 8px;">
              <i class="bi ${icon}"></i> ${esc(label)}
            </div>
            ${Object.entries(byGroup).map(([groupName, templates]) => `
              <div class="pf-tpl-group" style="margin-bottom: 18px;">
                <div class="pf-tpl-group-head" style="margin-bottom: 10px;">
                  <i class="bi ${groupIcon}"></i> ${esc(groupName)}
                  <span class="pf-tpl-group-count">${templates.length}</span>
                </div>
                <div class="ce-template-grid">
                  ${templates.map(t => {
                      const docs = (t.documents || []).length;
                      return `
                        <div class="ce-template-card" data-template-id="${esc(t.id)}">
                          <div class="ce-icon"><i class="bi ${this.templateGlyph(t)}"></i></div>
                          <h3 class="ce-title">${esc(t.name)}</h3>
                          <p class="ce-desc">${esc(t.description || '')}</p>
                          <div class="ce-tags">
                            <span class="ce-tag">${docs} document${docs === 1 ? '' : 's'}</span>
                          </div>
                          <div class="ce-actions">
                            ${!readOnly && t.canEdit ? `
                              <button data-action="edit"><i class="bi bi-pencil"></i> Edit</button>
                              <button data-action="delete" class="ce-delete"><i class="bi bi-trash"></i> Delete</button>
                            ` : `<button data-action="view"><i class="bi bi-eye"></i> View</button>`}
                          </div>
                        </div>`;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>`;
    },

    renderContinuousExplorationTplList(wrap) {
        const items = this.scopedItems('ce');
        const isFolder = this.activeScope === 'folder';

        wrap.innerHTML = `
          <div class="tpl-hub-panel tpl-hub-toolbar">
            <div class="tpl-hub-toolbar-text">
              The prompts that tell Continuous Exploration what to draft — a system prompt plus the documents to
              generate. New ones go to <code>${esc(this.ceDestinationHint())}</code>
            </div>
            <button class="ce-btn" data-cetpl-new><i class="bi bi-plus-lg"></i> New template</button>
          </div>
          <div class="tpl-hub-panel tpl-hub-body" data-cetpl-list></div>
        `;
        wrap.querySelector('[data-cetpl-new]').addEventListener('click', () => this.openBpTplEditor(wrap, null));

        const list = wrap.querySelector('[data-cetpl-list]');
        if (!items.length) {
            list.innerHTML = `
              <div class="pf-empty">
                No continuous exploration templates here yet. Click <strong>New template</strong> to create one — or right-click in a space
                and pick <strong>Create Continuous Exploration</strong>, which seeds the space with the default org playbook.
              </div>`;
            return;
        }

        if (isFolder) {
            const owned = items.filter(t => this.isOwnedByPickedFolder(t));
            const inherited = items.filter(t => !this.isOwnedByPickedFolder(t));
            list.innerHTML =
                this.renderCeScopeSection(`In ${this.folderPath || 'the space root'}`, 'bi-folder-fill', owned) +
                this.renderCeScopeSection('Inherited from above', 'bi-arrow-up-circle', inherited, { readOnly: true });
        } else {
            list.innerHTML = this.renderCeScopeSection(
                this.activeScope === 'personal' ? 'My templates' : 'Space templates',
                this.activeScope === 'personal' ? 'bi-person' : 'bi-building',
                items);
        }

        list.querySelectorAll('[data-template-id]').forEach(card => {
            const id = card.getAttribute('data-template-id');
            // Resolve against what is actually on screen — in the Folder scope the
            // cards come from the cascade, which the all-spaces list never holds.
            const tpl = items.find(t => t.id === id);
            const editBtn = card.querySelector('[data-action="edit"]');
            const delBtn = card.querySelector('[data-action="delete"]');
            const viewBtn = card.querySelector('[data-action="view"]');
            if (editBtn) editBtn.addEventListener('click', () => { if (tpl) this.openBpTplEditor(wrap, tpl); });
            if (delBtn) delBtn.addEventListener('click', () => this.deleteBpTpl(id, tpl));
            if (viewBtn) viewBtn.addEventListener('click', () => { if (tpl) this.openBpTplEditor(wrap, tpl, { readOnly: true }); });
        });
    },

    /** Where a new Continuous Exploration template goes, for the active scope. */
    ceDestinationHint() {
        if (this.activeScope === 'personal') {
            return `.system/useractivity/${this.userDir || '<you>'}/continuousexploration/`;
        }
        if (this.activeScope === 'space') return '.system/continuous-explorations/.templates/';
        return `${this.folderPath ? this.folderPath + '/' : ''}.system/continuous-explorations/.templates/`;
    },

    openBpTplEditor(wrap, tpl, { readOnly = false } = {}) {
        const isNew = !tpl;
        const t = tpl || { id: null, name: '', description: '', systemPrompt: '', documents: [] };
        const ro = readOnly && !isNew;
        const dis = ro ? 'disabled' : '';
        // The scope tab decides where a new template goes, so the editor no longer
        // asks — and in the Folder scope the space is fixed by the folder picker.
        const isFolderScope = this.activeScope === 'folder';

        wrap.innerHTML = `
          <div>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 18px;">
              <button class="ce-back-btn" data-cetpl-back title="Back to templates"><i class="bi bi-arrow-left"></i></button>
              <h2 style="font-weight: 700; margin: 0; font-size: 20px;">${isNew ? 'New continuous exploration template' : (ro ? 'View continuous exploration template' : 'Edit continuous exploration template')}</h2>
            </div>

            <div class="ce-editor-panel">
              <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px; margin-bottom: 14px;">
                  <label class="form-label" style="font-weight: 600;">Name</label>
                  <input type="text" class="form-control" data-cetpl-name placeholder="e.g. Microservice" value="${esc(t.name)}" ${dis}>
                </div>
                <div style="min-width: 200px; margin-bottom: 14px;">
                  <label class="form-label" style="font-weight: 600;">Space</label>
                  ${isNew && !isFolderScope
                    ? `<select class="form-select" data-cetpl-space>${this.spaceOptions(this.defaultSpaceId())}</select>`
                    : `<input type="text" class="form-control" value="${esc(isNew ? (this.folderSpace()?.name || '') : (t.spaceName || ''))}" disabled title="Templates can't move between spaces">`}
                </div>
              </div>
              ${isNew ? `
              <div style="font-size: 12px; color: var(--kr-ink-400); margin: -4px 0 14px;">
                <i class="bi bi-folder2"></i> Creating in <code>${esc(this.ceDestinationHint())}</code>
              </div>` : ''}
              <div style="margin-bottom: 14px;">
                <label class="form-label" style="font-weight: 600;">Description</label>
                <input type="text" class="form-control" data-cetpl-desc placeholder="One line about when to use this template" value="${esc(t.description)}" ${dis}>
              </div>
              <div style="margin-bottom: 14px;">
                <label class="form-label" style="font-weight: 600;">System prompt</label>
                <textarea class="form-control" data-cetpl-prompt rows="5" ${dis}
                  placeholder="Persistent context the AI gets every time this template is used.">${esc(t.systemPrompt)}</textarea>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label class="form-label" style="font-weight: 600; margin: 0;">Documents to generate</label>
                ${ro ? '' : '<button class="ce-btn ghost sm" data-cetpl-adddoc><i class="bi bi-plus-lg"></i> Add document</button>'}
              </div>
              <div data-cetpl-docs></div>

              <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;">
                <button class="ce-btn ghost" data-cetpl-cancel>${ro ? 'Close' : 'Cancel'}</button>
                ${ro ? '' : '<button class="ce-btn" data-cetpl-save>Save</button>'}
              </div>
              <div data-cetpl-msg style="text-align: right; font-size: 12px; color: #b54545; min-height: 16px; margin-top: 6px;"></div>
            </div>
          </div>
        `;

        const docsWrap = wrap.querySelector('[data-cetpl-docs]');
        const addDocRow = (doc) => {
            const row = document.createElement('div');
            row.className = 'ce-doc-edit-row';
            row.innerHTML = `
              <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <input type="text" class="form-control doc-name"
                  placeholder="filename, e.g. architecture.md" value="${esc(doc.name || '')}" ${dis}>
                ${ro ? '' : '<button class="ce-btn ghost danger sm doc-remove" title="Remove"><i class="bi bi-trash"></i></button>'}
              </div>
              <textarea class="form-control doc-prompt" rows="2" ${dis}
                placeholder="What should this document cover?">${esc(doc.prompt || '')}</textarea>
            `;
            const rm = row.querySelector('.doc-remove');
            if (rm) rm.addEventListener('click', () => row.remove());
            docsWrap.appendChild(row);
        };
        (t.documents || []).forEach(d => addDocRow(d));
        if (!(t.documents || []).length && !ro) addDocRow({ name: '', prompt: '' });

        const backToList = () => this.renderActiveTab();
        wrap.querySelector('[data-cetpl-back]').addEventListener('click', backToList);
        wrap.querySelector('[data-cetpl-cancel]').addEventListener('click', backToList);
        const addDocBtn = wrap.querySelector('[data-cetpl-adddoc]');
        if (addDocBtn) addDocBtn.addEventListener('click', () => addDocRow({ name: '', prompt: '' }));

        const saveEl = wrap.querySelector('[data-cetpl-save]');
        if (!saveEl) return; // read-only view
        saveEl.addEventListener('click', async (e) => {
            const saveBtn = e.currentTarget;
            const msg = wrap.querySelector('[data-cetpl-msg]');
            const payload = {
                name: wrap.querySelector('[data-cetpl-name]').value.trim(),
                description: wrap.querySelector('[data-cetpl-desc]').value.trim(),
                systemPrompt: wrap.querySelector('[data-cetpl-prompt]').value,
                documents: Array.from(docsWrap.querySelectorAll('.ce-doc-edit-row')).map(r => ({
                    name: r.querySelector('.doc-name').value.trim(),
                    prompt: r.querySelector('.doc-prompt').value
                })).filter(d => d.name)
            };
            if (!payload.name) { msg.textContent = 'Name is required.'; return; }
            if (isNew) {
                payload.scope = this.activeScope;
                payload.spaceId = isFolderScope
                    ? (this.folderSpaceId ?? this.defaultSpaceId())
                    : wrap.querySelector('[data-cetpl-space]').value;
                if (isFolderScope) payload.folderPath = this.folderPath || '';
                if (payload.scope === 'space' && !this.canAdminSpace(payload.spaceId)) {
                    msg.textContent = 'You must be an administrator of this space to create a space template.';
                    return;
                }
            } else if (t.scope === 'folder') {
                // A folder template can't be found by id alone — tell the server
                // which cascade it came from (see templateManager._locate).
                payload.folderPath = t.folderPath || '';
            }

            saveBtn.disabled = true;
            msg.textContent = '';
            try {
                const url = isNew ? `${BP_API}/templates` : `${BP_API}/templates/${encodeURIComponent(t.id)}`;
                const res = await fetch(url, {
                    method: isNew ? 'POST' : 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
                await this.reloadBpTemplates();
            } catch (err) {
                msg.textContent = `Save failed: ${err.message}`;
                saveBtn.disabled = false;
            }
        });
    },

    async deleteBpTpl(id, tpl) {
        if (!confirm('Delete this continuous exploration template?')) return;
        try {
            // A folder template needs its cascade named, or the server can't find it.
            const hint = tpl && tpl.scope === 'folder'
                ? `?folderPath=${encodeURIComponent(tpl.folderPath || '')}`
                : '';
            const res = await fetch(`${BP_API}/templates/${encodeURIComponent(id)}${hint}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await this.reloadBpTemplates();
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    },

    async reloadBpTemplates() {
        try {
            const res = await fetch(`${BP_API}/templates`, { credentials: 'include' });
            const body = await res.json();
            this.data.ceTemplates = body.templates || [];
        } catch (_) { /* keep current list */ }
        // As with document templates, the all-spaces listing holds no folder
        // templates — the cascade is a separate, space-and-folder-scoped fetch.
        if (this.activeScope === 'folder') await this.loadFolderTemplates();
        if (this.activeTab === 'continuous-exploration-templates') this.renderActiveTab();
    }
};
