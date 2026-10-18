/**
 * Help Controller
 *
 * Drives the right-side "Help & support" drawer opened from the `?` button in
 * the top bar. The drawer is backed by a single admin-maintained markdown file
 * (`<APP_BASE_DIR>/content/help.md`, served via `/applications/wiki/api/help`):
 *
 *   - The drawer renders the help markdown and builds its navigation list from
 *     the document headings — clicking a heading scrolls to that section.
 *   - A search box finds word occurrences in the rendered content, highlights
 *     them, scrolls to the first match and steps next/prev.
 *   - On open, if a heading matches the current view (e.g. "Content view" when
 *     the Content layout is active) the drawer scrolls there under a
 *     "Help for this page" label; otherwise it opens at the top.
 *   - A single "Contact support" footer button targets an address configured by
 *     the admin in the file's frontmatter (hidden when none is set).
 *
 * The markup lives in index.html (`#helpDrawer`). Styling is in
 * src/web/wiki/public/css/wiki.css (`.kr-help-*`, `.help-*`). Markdown is rendered with
 * the shared `window.parseMarkdown` (no parser changes).
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-25
 */

import { layoutController } from "./layoutController.js";

const HELP_API = '/applications/wiki/api/help';

/** Layout key → the heading text that documents that view. */
const LAYOUT_HEADINGS = {
    detailed: 'Detailed view',
    content: 'Content view',
    chat: 'Chat view',
    search: 'Search view'
};

/** app.currentView → the heading text that documents that page. */
const VIEW_HEADINGS = {
    document: 'Document',
    home: 'Home',
    folder: 'Folder',
    spaces: 'Spaces',
    profile: 'Profile'
};

function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase();
}

export const helpController = {
    app: null,
    _loaded: false,
    _headings: [],   // [{ el, text }]
    _hits: [],       // <mark> elements from the active search
    _hitIndex: -1,
    _suppressSync: false, // ignore scroll-driven nav toggling during a programmatic scroll
    _syncTimer: null,

    init(app) {
        this.app = app;

        document.getElementById('helpToggleBtn')?.addEventListener('click', () => this.toggle());
        document.getElementById('helpCloseBtn')?.addEventListener('click', () => this.close());

        const input = document.getElementById('helpSearchInput');
        if (input) {
            input.addEventListener('input', () => this.search(input.value));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); this.goto(e.shiftKey ? -1 : 1); }
                if (e.key === 'Escape') { input.value = ''; this.search(''); }
            });
        }
        document.getElementById('helpSearchPrev')?.addEventListener('click', () => this.goto(-1));
        document.getElementById('helpSearchNext')?.addEventListener('click', () => this.goto(1));

        // Nav-item clicks (delegated — items are rendered after load).
        document.getElementById('helpNav')?.addEventListener('click', (e) => {
            const a = e.target.closest('[data-help-idx]');
            if (!a) return;
            e.preventDefault();
            const h = this._headings[Number(a.dataset.helpIdx)];
            if (h) this.scrollToEl(h.el);
        });

        // The page TOC + "this page" pill only show at the very top of the help
        // body; once the reader scrolls into the content they tuck away.
        document.getElementById('helpBody')
            ?.addEventListener('scroll', () => this.syncNavVisibility(), { passive: true });
    },

    // ---- Open / close ------------------------------------------------------

    isOpen() {
        const d = document.getElementById('helpDrawer');
        return !!d && !d.classList.contains('hidden');
    },

    toggle() { this.isOpen() ? this.close() : this.open(); },

    async open() {
        const drawer = document.getElementById('helpDrawer');
        if (!drawer) return;
        drawer.classList.remove('hidden');
        await this.ensureLoaded();
        this.applyCurrentViewScroll();
    },

    close() {
        document.getElementById('helpDrawer')?.classList.add('hidden');
    },

    /** Force the next open() to re-fetch — called after an admin edits the help. */
    invalidate() {
        this._loaded = false;
        if (this.isOpen()) this.open();
    },

    // ---- Load + render -----------------------------------------------------

    async ensureLoaded(force = false) {
        if (this._loaded && !force) return;
        const body = document.getElementById('helpBody');
        const nav = document.getElementById('helpNav');
        if (!body) return;

        let data;
        try {
            const res = await fetch(HELP_API, { credentials: 'include' });
            data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
            console.error('[help] load failed:', err);
            body.innerHTML = `<p class="kr-help-error">Could not load help right now.</p>`;
            if (nav) nav.innerHTML = '';
            return;
        }

        const render = (typeof window !== 'undefined' && window.parseMarkdown) ? window.parseMarkdown : null;
        body.innerHTML = render ? render(data.content || '') : `<pre>${(data.content || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`;

        // Build the nav from the rendered headings. Reference elements directly
        // (not document.getElementById) so ids can't collide with the rest of
        // the SPA page (e.g. an open document view).
        this._headings = Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6'))
            .map((el) => ({ el, text: el.textContent.trim(), level: Number(el.tagName[1]) }))
            .filter(h => h.text);

        if (nav) {
            nav.innerHTML = this._headings.length
                ? this._headings.map((h, i) =>
                    `<a href="#" class="help-nav-item lvl-${h.level}" data-help-idx="${i}">${escapeHtml(h.text)}</a>`
                ).join('')
                : '';
        }

        // Footer "Contact support" — only when a target is configured.
        const supportBtn = document.getElementById('helpSupportBtn');
        if (supportBtn) {
            if (data.support) {
                supportBtn.href = data.support;
                supportBtn.style.display = '';
            } else {
                supportBtn.style.display = 'none';
            }
        }

        this._loaded = true;
    },

    // ---- Page-context scroll ----------------------------------------------

    applyCurrentViewScroll() {
        const body = document.getElementById('helpBody');
        const pill = document.getElementById('helpThisPage');
        if (!body) return;

        const candidates = [
            LAYOUT_HEADINGS[layoutController?.current],
            VIEW_HEADINGS[this.app?.currentView]
        ].filter(Boolean).map(norm);

        let match = null;
        for (const cand of candidates) {
            match = this._headings.find(h => norm(h.text) === cand)
                || this._headings.find(h => norm(h.text).includes(cand));
            if (match) break;
        }

        if (match) {
            if (pill) pill.classList.remove('hidden');
            // Opening straight onto a section counts as "in the content" — tuck
            // the TOC away unless that section already sits at the very top.
            const target = this.scrollToEl(match.el);
            this.setNavCollapsed(target > 4);
        } else {
            if (pill) pill.classList.add('hidden');
            body.scrollTop = 0;
            this.setNavCollapsed(false);
        }
    },

    /**
     * Scroll the drawer body so `el` sits near the top, regardless of
     * offsetParent. Returns the scrollTop it is heading toward. The scroll-driven
     * nav toggle is suppressed for the duration of the smooth scroll so the TOC
     * doesn't flicker as scrollTop passes back through the top.
     */
    scrollToEl(el) {
        const body = document.getElementById('helpBody');
        if (!body || !el) return 0;
        const delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top;
        const max = body.scrollHeight - body.clientHeight;
        const target = Math.max(0, Math.min(body.scrollTop + delta - 8, max));
        this._suppressSync = true;
        clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => { this._suppressSync = false; this.syncNavVisibility(); }, 450);
        body.scrollBy({ top: delta - 8, behavior: 'smooth' });
        return target;
    },

    /** Add/remove the collapsed-TOC class on the drawer. */
    setNavCollapsed(collapsed) {
        document.getElementById('helpDrawer')?.classList.toggle('help-scrolled', collapsed);
    },

    /** Reveal the TOC at the top of the help body, collapse it once scrolled in. */
    syncNavVisibility() {
        if (this._suppressSync) return;
        const body = document.getElementById('helpBody');
        if (!body) return;
        this.setNavCollapsed(body.scrollTop > 4);
    },

    // ---- Search (highlight + next/prev) -----------------------------------

    search(termRaw) {
        const body = document.getElementById('helpBody');
        const count = document.getElementById('helpSearchCount');
        if (!body) return;

        this.clearHighlights();
        this._hits = [];
        this._hitIndex = -1;

        const term = String(termRaw || '').trim();
        if (term.length < 2) { if (count) count.textContent = ''; return; }

        this.highlight(body, term);

        if (!this._hits.length) {
            if (count) count.textContent = 'No matches';
            return;
        }
        this._hitIndex = 0;
        this.markCurrent();
        this.scrollToEl(this._hits[0]);
        this.updateCount();
    },

    goto(delta) {
        if (!this._hits.length) return;
        this._hits[this._hitIndex]?.classList.remove('current');
        this._hitIndex = (this._hitIndex + delta + this._hits.length) % this._hits.length;
        this.markCurrent();
        this.scrollToEl(this._hits[this._hitIndex]);
        this.updateCount();
    },

    markCurrent() {
        this._hits[this._hitIndex]?.classList.add('current');
    },

    updateCount() {
        const count = document.getElementById('helpSearchCount');
        if (count) count.textContent = `${this._hitIndex + 1} of ${this._hits.length}`;
    },

    /** Unwrap every existing highlight and re-merge the split text nodes. */
    clearHighlights() {
        const body = document.getElementById('helpBody');
        if (!body) return;
        body.querySelectorAll('mark.help-hl').forEach((m) => {
            m.replaceWith(document.createTextNode(m.textContent));
        });
        body.normalize();
    },

    /**
     * Wrap every case-insensitive occurrence of `term` in `<mark class="help-hl">`,
     * touching text nodes only (never innerHTML) so rendered links/HTML stay intact.
     */
    highlight(root, term) {
        const needle = term.toLowerCase();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const tag = node.parentNode && node.parentNode.nodeName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
                return node.nodeValue.toLowerCase().includes(needle)
                    ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });

        const targets = [];
        let n;
        while ((n = walker.nextNode())) targets.push(n);

        for (const textNode of targets) {
            const value = textNode.nodeValue;
            const lower = value.toLowerCase();
            const frag = document.createDocumentFragment();
            let pos = 0, idx;
            while ((idx = lower.indexOf(needle, pos)) !== -1) {
                if (idx > pos) frag.appendChild(document.createTextNode(value.slice(pos, idx)));
                const mark = document.createElement('mark');
                mark.className = 'help-hl';
                mark.textContent = value.slice(idx, idx + needle.length);
                frag.appendChild(mark);
                this._hits.push(mark);
                pos = idx + needle.length;
            }
            if (pos < value.length) frag.appendChild(document.createTextNode(value.slice(pos)));
            textNode.replaceWith(frag);
        }
    }
};

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
