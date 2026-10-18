/**
 * User Content Controller ("Add Content")
 *
 * Lets any authenticated user contribute prose *into* a document without editing
 * it — the counterpart to the annotation controller, but the contribution renders
 * as ordinary body text rather than a highlighted callout. This is the way people
 * add to system-owned documents (owner: system), whose Blocks/Markdown/Visualise
 * editor tabs are hidden.
 *
 * The right-click "Add Content" entry (wired from annotationcontroller's shared
 * menu, reusing its target-inference logic) opens a small editor; on save the text
 * is POSTed to the user-content API, which writes an inline ```user-content```
 * block anchored to the same Target next to the clicked content. Authors can edit
 * or delete their own contribution from the hover affordance the parser renders.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-07-12
 */

import { documentController } from "./documentcontroller.js";

const API = '/applications/wiki/api/user-content';

export const userContentController = {
    app: null,
    _modal: null,
    _observer: null,

    init(app) {
        this.app = app;
        this._wireBlockActions();
        this._observeRenders();
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._closeModal(); });
    },

    // ---- context ---------------------------------------------------------

    _docCtx() {
        const d = this.app?.currentDocument;
        return d && d.path && d.spaceName ? { path: d.path, spaceName: d.spaceName } : null;
    },

    _userEmail() {
        return (this.app?.userProfile?.email || '').toLowerCase();
    },

    _hint(msg) {
        if (this.app?.showNotification) this.app.showNotification(msg, 'info');
        else console.info('[UserContent]', msg);
    },

    /**
     * Entry point invoked from the document right-click menu. `target` is the
     * anchor descriptor produced by annotationcontroller._contextTargetFor (the
     * same text/section/cell inference), so Add Content lands exactly where the
     * user clicked. null target → nudge the user to pick a spot.
     */
    startAddContent(target) {
        if (!this._docCtx()) {
            this._hint('Open a document first, then choose where to add content.');
            return;
        }
        if (!target) {
            this._hint('Select text, a table row, or a heading to add content next to.');
            return;
        }
        this._openModal({ mode: 'create', target });
    },

    // ---- modal -----------------------------------------------------------

    _openModal({ mode, target, id, current }) {
        this._closeModal();
        const overlay = document.createElement('div');
        overlay.className = 'kr-annotation-modal-overlay';
        const heading = mode === 'edit' ? 'Edit content' : 'Add content';
        overlay.innerHTML = `
            <div class="kr-annotation-modal" role="dialog" aria-modal="true">
                <header><i class="bi bi-pencil-square"></i> ${heading}</header>
                <textarea rows="5" placeholder="Write the content to add… (markdown supported)"></textarea>
                <div class="kr-annotation-modal-actions">
                    <button type="button" data-cancel class="btn btn-ghost btn-sm">Cancel</button>
                    <button type="button" data-save class="btn btn-primary btn-sm">Save</button>
                </div>
                <div class="kr-annotation-modal-status"></div>
            </div>`;
        const ta = overlay.querySelector('textarea');
        if (current) ta.value = current;
        overlay.querySelector('[data-cancel]').addEventListener('click', () => this._closeModal());
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this._closeModal(); });
        overlay.querySelector('[data-save]').addEventListener('click', () => this._save({ mode, target, id, textarea: ta, overlay }));
        document.body.appendChild(overlay);
        this._modal = overlay;
        setTimeout(() => ta.focus(), 0);
    },

    _closeModal() {
        if (this._modal) { this._modal.remove(); this._modal = null; }
    },

    async _save({ mode, target, id, textarea, overlay }) {
        const text = (textarea.value || '').trim();
        const status = overlay.querySelector('.kr-annotation-modal-status');
        if (!text) { status.textContent = 'Content cannot be empty.'; return; }
        const ctx = this._docCtx();
        if (!ctx) { status.textContent = 'Cannot identify the current document.'; return; }

        status.textContent = 'Saving…';
        const body = mode === 'edit'
            ? { spaceName: ctx.spaceName, path: ctx.path, id, content: text }
            : { spaceName: ctx.spaceName, path: ctx.path, target, content: text };
        try {
            const resp = await fetch(API, {
                method: mode === 'edit' ? 'PATCH' : 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
            this._closeModal();
            await documentController.openDocumentByPath(ctx.path, ctx.spaceName);
        } catch (err) {
            console.error('[UserContent] save failed:', err);
            status.textContent = `Failed: ${err.message}`;
        }
    },

    // ---- edit / delete on rendered contributions -------------------------

    _wireBlockActions() {
        document.body.addEventListener('click', async (e) => {
            const editBtn = e.target.closest && e.target.closest('[data-user-content-edit]');
            const delBtn = e.target.closest && e.target.closest('[data-user-content-delete]');
            if (!editBtn && !delBtn) return;
            const block = e.target.closest('[data-user-content-block]');
            if (!block) return;
            e.preventDefault();

            const id = block.getAttribute('data-user-content-id');
            const ctx = this._docCtx();
            if (!id || !ctx) return;

            if (editBtn) {
                // Prefer the raw stored source over the rendered HTML so markdown
                // round-trips cleanly; fall back to the rendered text.
                const current = block.getAttribute('data-user-content-raw')
                    || block.querySelector('[data-user-content-text]')?.innerText || '';
                this._openModal({ mode: 'edit', id, current });
                return;
            }

            if (!window.confirm('Delete this content?')) return;
            try {
                const resp = await fetch(API, {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spaceName: ctx.spaceName, path: ctx.path, id })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
                await documentController.openDocumentByPath(ctx.path, ctx.spaceName);
            } catch (err) {
                console.error('[UserContent] delete failed:', err);
                this.app?.showNotification?.(`Failed to delete content: ${err.message}`, 'error');
            }
        });
    },

    // ---- author-only affordance visibility -------------------------------

    /**
     * Hide edit/delete on contributions the current user did not author. Runs on
     * any DOM mutation that adds user-content blocks (i.e. each doc render).
     */
    _observeRenders() {
        this.applyAuthorVisibility();
        this._observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.('[data-user-content-block]') || node.querySelector?.('[data-user-content-block]')) {
                        this.applyAuthorVisibility(node);
                    }
                }
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    },

    applyAuthorVisibility(root = document) {
        const me = this._userEmail();
        const scope = root.querySelectorAll ? root : document;
        const blocks = (root.matches && root.matches('[data-user-content-block]'))
            ? [root]
            : Array.from(scope.querySelectorAll('[data-user-content-block]'));
        blocks.forEach(block => {
            const author = (block.getAttribute('data-user-content-author') || '').toLowerCase();
            const mine = !!(me && author === me);
            block.querySelectorAll('[data-user-content-edit], [data-user-content-delete]').forEach(btn => {
                btn.style.display = mine ? '' : 'none';
            });
        });
    }
};
