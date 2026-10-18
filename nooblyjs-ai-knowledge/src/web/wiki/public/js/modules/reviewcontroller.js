/**
 * Review Controller
 *
 * Adds a lightweight review workflow on top of a document, written into the
 * source markdown as a ```reviews``` block (see backend reviewBlocks.js):
 *
 *   - "Request review" toolbar button → an inline email input; pressing Enter
 *     POSTs a new in-progress review to the reviews API.
 *   - While a page is under review the assigned reviewer sees an inline
 *     "Complete review" control (a 1–5 star picker + comment) under their entry
 *     in the rendered reviews panel; submitting it PATCHes the review complete.
 *   - Exposes isUnderReview()/activeReviewForMe() so annotationController can
 *     offer the rose "Review annotation" affordance only while under review.
 *
 * Mirrors the delegated-listener style of annotationController.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-09
 */

import { documentController } from "./documentcontroller.js";

const API = '/applications/wiki/api/reviews';
const REVIEWS_BLOCK_RE = /```reviews[ \t]*\n([\s\S]*?)\n```/;

export const reviewController = {
    app: null,
    _popover: null,
    _observer: null,

    init(app) {
        this.app = app;
        this._wireToolbarButton();
        this._wireStarPickers();
        this._wireCompleteForms();
        this._observeRenders();
    },

    // ---- context helpers -------------------------------------------------

    _docCtx() {
        const d = this.app?.currentDocument;
        return d && d.path && d.spaceName ? { path: d.path, spaceName: d.spaceName } : null;
    },

    _content() {
        return this.app?.currentDocument?.content || '';
    },

    _userEmail() {
        return (this.app?.userProfile?.email || '').toLowerCase();
    },

    /** Parse the entries in the current document's reviews block. */
    parseReviews(content) {
        const m = String(content || '').match(REVIEWS_BLOCK_RE);
        if (!m) return [];
        return m[1].split(/\n\s*\n/).map(c => c.trim()).filter(Boolean).map(chunk => {
            const e = {};
            for (const line of chunk.split(/\r?\n/)) {
                const mm = line.match(/^([a-zA-Z][\w-]*)\s*:\s?(.*)$/);
                if (mm) e[mm[1].toLowerCase()] = mm[2].trim();
            }
            return {
                id: e.id || '', review: (e.review || 'inprogress').toLowerCase(),
                requested: e.requested || '', reviewer: e.reviewer || '',
                annotations: e.annotations || '', stars: e.stars || '',
                comment: e.comment || '', startdate: e.startdate || '', enddate: e.enddate || ''
            };
        });
    },

    /** True when the current document has any in-progress review. */
    isUnderReview() {
        return this.parseReviews(this._content()).some(e => e.review === 'inprogress');
    },

    /** The in-progress review assigned to the current user, or null. */
    activeReviewForMe() {
        const me = this._userEmail();
        if (!me) return null;
        return this.parseReviews(this._content())
            .find(e => e.review === 'inprogress' && e.reviewer.toLowerCase() === me) || null;
    },

    _hint(msg, type = 'info') {
        if (this.app?.showNotification) this.app.showNotification(msg, type);
        else console.info('[Reviews]', msg);
    },

    // ---- "Request review" toolbar button + inline email popover ----------

    _wireToolbarButton() {
        const btn = document.getElementById('requestReviewBtn');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (this._popover) { this._closePopover(); return; }
            this._openPopover(btn);
        });
    },

    _openPopover(anchor) {
        if (!this._docCtx()) { this._hint('Open a document first, then request a review.'); return; }
        this._closePopover();

        const pop = document.createElement('div');
        pop.className = 'kr-review-request-popover';
        pop.innerHTML = `
            <label>Request a review from</label>
            <input type="email" placeholder="name@company.com" data-review-email autocomplete="off" />
            <div class="kr-review-request-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-review-cancel>Cancel</button>
                <button type="button" class="btn btn-primary btn-sm" data-review-send>Send</button>
            </div>
            <div class="kr-review-request-status" data-review-request-status></div>`;
        document.body.appendChild(pop);

        const r = anchor.getBoundingClientRect();
        pop.style.top = `${Math.round(r.bottom + 6 + window.scrollY)}px`;
        pop.style.left = `${Math.round(Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;

        const input = pop.querySelector('[data-review-email]');
        const submit = () => this._submitRequest(pop, input.value);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); this._closePopover(); }
        });
        pop.querySelector('[data-review-send]').addEventListener('click', submit);
        pop.querySelector('[data-review-cancel]').addEventListener('click', () => this._closePopover());

        this._popover = pop;
        this._onDocMouseDown = (e) => {
            if (this._popover && !e.target.closest('.kr-review-request-popover') && e.target.id !== 'requestReviewBtn') {
                this._closePopover();
            }
        };
        document.addEventListener('mousedown', this._onDocMouseDown);
        setTimeout(() => input.focus(), 0);
    },

    _closePopover() {
        if (this._popover) { this._popover.remove(); this._popover = null; }
        if (this._onDocMouseDown) { document.removeEventListener('mousedown', this._onDocMouseDown); this._onDocMouseDown = null; }
    },

    async _submitRequest(pop, rawEmail) {
        const email = (rawEmail || '').trim();
        const status = pop.querySelector('[data-review-request-status]');
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            status.textContent = 'Enter a valid email address.';
            return;
        }
        const ctx = this._docCtx();
        if (!ctx) { status.textContent = 'Cannot identify the current document.'; return; }

        status.textContent = 'Sending…';
        try {
            const resp = await fetch(API, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spaceName: ctx.spaceName, path: ctx.path, reviewer: email })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
            this._closePopover();
            this._hint(`Review requested from ${email}.`, 'success');
            await documentController.openDocumentByPath(ctx.path, ctx.spaceName);
        } catch (err) {
            console.error('[Reviews] request failed:', err);
            status.textContent = `Failed: ${err.message}`;
        }
    },

    // ---- inline star picker (in the rendered reviews panel) --------------

    _wireStarPickers() {
        document.body.addEventListener('click', (e) => {
            const star = e.target.closest && e.target.closest('[data-star]');
            if (!star) return;
            const box = star.closest('[data-star-input]');
            const form = star.closest('[data-review-complete]');
            if (!box || !form) return;
            e.preventDefault();
            const value = parseInt(star.getAttribute('data-star'), 10) || 0;
            form.querySelector('[data-star-value]').value = String(value);
            box.querySelectorAll('[data-star]').forEach((b) => {
                const n = parseInt(b.getAttribute('data-star'), 10) || 0;
                const icon = b.querySelector('i');
                if (icon) icon.className = `bi ${n <= value ? 'bi-star-fill' : 'bi-star'}`;
                b.classList.toggle('is-on', n <= value);
            });
        });
    },

    // ---- "Complete review" form submit -----------------------------------

    _wireCompleteForms() {
        document.body.addEventListener('submit', async (e) => {
            const form = e.target.closest && e.target.closest('[data-review-complete]');
            if (!form) return;
            e.preventDefault();

            const id = form.getAttribute('data-review-id');
            const stars = parseInt(form.querySelector('[data-star-value]')?.value || '0', 10);
            const comment = form.querySelector('[data-review-comment]')?.value || '';
            const status = form.querySelector('[data-review-status]');
            const ctx = this._docCtx();
            if (!ctx || !id) return;
            if (!stars || stars < 1 || stars > 5) { if (status) status.textContent = 'Pick a star rating.'; return; }

            if (status) status.textContent = 'Saving…';
            try {
                const resp = await fetch(API, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spaceName: ctx.spaceName, path: ctx.path, id, stars, comment })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || !data.success) throw new Error(data.error || `HTTP ${resp.status}`);
                this._hint('Review completed.', 'success');
                await documentController.openDocumentByPath(ctx.path, ctx.spaceName);
            } catch (err) {
                console.error('[Reviews] complete failed:', err);
                if (status) status.textContent = `Failed: ${err.message}`;
            }
        });
    },

    // ---- per-render upkeep: reveal reviewer controls + title badge -------

    _observeRenders() {
        this.refresh();
        this._observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.('[data-reviews-block]') || node.querySelector?.('[data-reviews-block], .markdown-content')) {
                        this.refresh();
                        return;
                    }
                }
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    },

    /** Reveal the completion form for the assigned reviewer; update the badge. */
    refresh() {
        const me = this._userEmail();
        document.querySelectorAll('[data-review-complete]').forEach((form) => {
            const reviewer = (form.getAttribute('data-review-reviewer') || '').toLowerCase();
            form.style.display = (me && reviewer === me) ? '' : 'none';
        });
        this._updateBadge();
    },

    _updateBadge() {
        const title = document.getElementById('currentDocTitle');
        if (!title) return;
        const head = title.parentElement || title;
        let badge = document.getElementById('reviewStatusBadge');
        if (this.isUnderReview()) {
            if (!badge) {
                badge = document.createElement('span');
                badge.id = 'reviewStatusBadge';
                badge.className = 'kr-under-review-badge';
                badge.innerHTML = '<i class="bi bi-clipboard-check"></i> Under review';
                head.appendChild(badge);
            }
        } else if (badge) {
            badge.remove();
        }
    }
};
