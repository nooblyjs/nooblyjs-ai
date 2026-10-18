/**
 * @fileoverview Pane block controller
 *
 * Hydrates ```pane``` block placeholders (emitted by markdown-parser.js)
 * into an inline rendering of another wiki document:
 *
 *   ```pane
 *   source: [Space Name]/path/to/file.md
 *   clickout: true
 *   ```
 *
 * - `source` points at a markdown document, optionally prefixed with the
 *   space in square brackets. Without a prefix the host document's space is
 *   assumed. Backslashes are tolerated and normalised to `/`.
 * - The hydrated pane shows a subtle header identifying the source; when
 *   `clickout` is true the header carries an open button (and the label
 *   itself is clickable) that navigates to the source document.
 * - Panes inside the embedded content are hydrated recursively, with a
 *   depth cap and a visited set so circular embeds stop with a notice
 *   instead of looping.
 *
 * The editor-side block (markdown-editor-blocks.js) dispatches a
 * `wiki:pane-open` window event for its clickout button; init() wires that
 * to the same navigation used here.
 *
 * @author noobly Team
 * @version 1.0.0
 */

import { documentController } from "./documentcontroller.js";

const MAX_DEPTH = 3;

export const paneController = {
    app: null,

    init(app) {
        this.app = app;

        // The markdown editor's pane block is app-agnostic, so its clickout
        // button just announces the source it wants opened.
        window.addEventListener('wiki:pane-open', (e) => {
            const source = e.detail && e.detail.source;
            if (!source) return;
            const ref = resolveSource(source, this.app && this.app.currentDocument);
            if (ref) this.openSource(ref);
        });
    },

    /**
     * Hydrate every pane placeholder inside a freshly rendered document.
     * @param {HTMLElement} rootEl - The just-inserted content wrapper
     * @param {Object} doc - The host wiki document ({path, spaceName, content})
     */
    hydrate(rootEl, doc) {
        if (!rootEl || !doc) return;
        const visited = new Set();
        if (doc.spaceName && doc.path) visited.add(refKey({ spaceName: doc.spaceName, path: doc.path }));
        this._hydrateWithin(rootEl, doc, visited, MAX_DEPTH);
    },

    _hydrateWithin(rootEl, doc, visited, depth) {
        const placeholders = rootEl.querySelectorAll('.kr-pane[data-pane-placeholder]');
        placeholders.forEach(el => {
            buildPane(el, doc, visited, depth, this)
                .catch(error => {
                    console.error('[PaneController] Failed to build pane:', error);
                    showPaneNote(el, 'Could not load pane: ' + error.message);
                });
        });
    },

    /** Navigate to a resolved {spaceName, path} source. */
    openSource(ref) {
        documentController.openDocumentByPath(ref.path, ref.spaceName);
    }
};

/* ============================================================================
   Source resolution
   ============================================================================ */

/**
 * Resolve a raw `source:` value into {spaceName, path}. Accepts
 * `[Space]/path/file.md`, `[Space]\path\file.md` or a bare space-relative
 * path (host document's space). Returns null when nothing usable remains.
 */
function resolveSource(raw, hostDoc) {
    let s = String(raw || '').trim().replace(/\\/g, '/');
    if (!s) return null;
    let spaceName = (hostDoc && hostDoc.spaceName) || null;
    const m = s.match(/^\[([^\]]+)\]\s*\/?\s*(.*)$/);
    if (m) {
        spaceName = m[1].trim();
        s = m[2];
    }
    const path = s.replace(/^\/+/, '').trim();
    if (!path || !spaceName) return null;
    return { spaceName, path };
}

function refKey(ref) {
    return (ref.spaceName + '|' + ref.path).toLowerCase();
}

/* ============================================================================
   Pane construction
   ============================================================================ */

async function buildPane(el, hostDoc, visited, depth, controller) {
    delete el.dataset.panePlaceholder;

    const raw = el.dataset.paneSource || '';
    const clickout = el.dataset.paneClickout === 'true';
    const ref = resolveSource(raw, hostDoc);

    if (!ref) {
        showPaneNote(el, 'No source set — edit this pane and pick a document.');
        return;
    }
    if (visited.has(refKey(ref))) {
        showPaneNote(el, `Circular pane reference to ${ref.path} — not rendered.`);
        return;
    }
    if (depth <= 0) {
        showPaneNote(el, 'Panes nested too deep — not rendered.');
        return;
    }

    const content = await fetchSourceContent(ref);
    if (content == null) {
        showPaneNote(el, `Could not load ${formatRefLabel(ref, hostDoc)} — check the source path.`);
        return;
    }

    const html = renderEmbeddedMarkdown(content);

    el.innerHTML = '';
    el.classList.add('is-hydrated');

    const head = document.createElement('div');
    head.className = 'pane-head';
    const label = formatRefLabel(ref, hostDoc);
    head.innerHTML =
        `<span class="pane-src" title="${escapeHtml(ref.spaceName + ' / ' + ref.path)}">` +
        `<i class="bi bi-layout-text-window-reverse"></i>` +
        `<span class="pane-src-label">${escapeHtml(label)}</span></span>`;
    if (clickout) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pane-open-btn';
        btn.title = 'Open ' + label;
        btn.innerHTML = '<i class="bi bi-box-arrow-up-right"></i> Open';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            controller.openSource(ref);
        });
        head.appendChild(btn);
        head.classList.add('is-clickout');
        head.querySelector('.pane-src').addEventListener('click', () => controller.openSource(ref));
    }
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'pane-body markdown-content';
    body.innerHTML = html;
    el.appendChild(body);

    // Hydrate panes the embedded document itself contains. The visited set
    // branches per pane so two sibling panes may embed the same doc, while a
    // chain back to an ancestor is cut.
    const nextVisited = new Set(visited);
    nextVisited.add(refKey(ref));
    controller._hydrateWithin(body, { spaceName: ref.spaceName, path: ref.path }, nextVisited, depth - 1);
}

async function fetchSourceContent(ref) {
    const url = `/applications/wiki/api/documents/content?path=${encodeURIComponent(ref.path)}&spaceName=${encodeURIComponent(ref.spaceName)}`;
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
            const data = await r.json();
            return typeof data.content === 'string' ? data.content : null;
        }
        return await r.text();
    } catch (_) {
        return null;
    }
}

/**
 * Render embedded markdown, dropping blocks that belong to the source
 * document's own page furniture (comments, like badges, visit stats,
 * reviews) — the pane shows the content, not the source's social chrome.
 */
function renderEmbeddedMarkdown(content) {
    const fenceRe = /```(?:comments|sharedlinkvisits|liked|reviews)\b[^\n]*\r?\n(?:```|[\s\S]*?\r?\n```)[ \t]*/gi;
    const cleaned = String(content || '').replace(fenceRe, '').replace(/\n{3,}/g, '\n\n').trim();
    if (typeof window.parseMarkdown === 'function') {
        return window.parseMarkdown(cleaned);
    }
    return `<pre>${escapeHtml(cleaned)}</pre>`;
}

/** Label shown in the pane header: file name, plus the space when foreign. */
function formatRefLabel(ref, hostDoc) {
    const name = ref.path.split('/').pop();
    const hostSpace = hostDoc && hostDoc.spaceName;
    return hostSpace && hostSpace !== ref.spaceName ? `${ref.spaceName} / ${name}` : name;
}

function showPaneNote(el, message) {
    el.innerHTML =
        `<div class="pane-placeholder"><i class="bi bi-layout-text-window-reverse"></i> Pane ` +
        `<span class="pane-note">${escapeHtml(message)}</span></div>`;
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text == null ? '' : text).replace(/[&<>"']/g, m => map[m]);
}
