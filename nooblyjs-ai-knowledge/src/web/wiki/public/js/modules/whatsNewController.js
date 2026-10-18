/**
 * What's New Controller
 *
 * Shows a centered "What's New" modal (the same variant-A modal styling as the
 * onboarding wizard) when the user logs in, IF an admin has published a
 * message. The message is a single admin-maintained markdown document
 * (`<APP_BASE_DIR>/content/whatsnew.md`, served via
 * `/applications/wiki/api/whats-new`).
 *
 * Dismissal is remembered per user in localStorage as the *version* (a content
 * hash returned by the server) of the message they dismissed. The modal is
 * shown only when the current version differs from the last dismissed one — so
 * once dismissed it stays hidden until an admin edits the message (which changes
 * the hash), at which point it shows again and is dismissed again.
 *
 * Admins edit the message from the Profile screen ("What's New" section); saving
 * there does not re-open the modal — the new message surfaces on the next login.
 *
 * Styling reuses the onboarding `.obA-*` classes (public/css/onboarding.css)
 * plus a few `.wn-*` rules in src/web/wiki/public/css/wiki.css. Markdown is rendered with
 * the shared `window.parseMarkdown` (no parser changes).
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-26
 */

const WHATS_NEW_API = '/applications/wiki/api/whats-new';
const STORAGE_PREFIX = 'kr_whatsnew_dismissed::';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const whatsNewController = {
    app: null,
    root: null,
    _version: '',
    _onKeydown: null,

    init(app) {
        this.app = app;
    },

    /** localStorage key for the current user's dismissed-version record. */
    storageKey() {
        const profile = this.app?.userProfile || {};
        const id = profile.email || profile.name || 'anonymous';
        return `${STORAGE_PREFIX}${id}`;
    },

    dismissedVersion() {
        try {
            return localStorage.getItem(this.storageKey()) || '';
        } catch {
            return '';
        }
    },

    rememberDismissed(version) {
        try {
            localStorage.setItem(this.storageKey(), version || '');
        } catch (err) {
            console.warn('[WhatsNew] Failed to persist dismissed version:', err);
        }
    },

    /**
     * Fetch the current message and show the modal when there is one the user
     * has not already dismissed. No-op for public mode or while the onboarding
     * wizard is on screen (the new user will see it on their next login).
     */
    async maybeShow() {
        if (this.app?.isPublicMode) return;
        if (this.root) return;
        if (document.getElementById('onboardingRoot')) return;

        let data;
        try {
            const res = await fetch(WHATS_NEW_API, { credentials: 'include' });
            data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
            console.warn('[WhatsNew] load failed:', err);
            return;
        }

        const content = String(data.content || '').trim();
        const version = String(data.version || '').trim();
        if (!content || !version) return;            // nothing to announce
        if (this.dismissedVersion() === version) return;  // already dismissed this one

        this.show(content, version);
    },

    show(content, version) {
        if (this.root) return;
        this._version = version;

        const render = (typeof window !== 'undefined' && window.parseMarkdown) ? window.parseMarkdown : null;
        const bodyHtml = render
            ? render(content)
            : `<pre>${escapeHtml(content)}</pre>`;

        const root = document.createElement('div');
        root.className = 'ob-screen obA wn-screen';
        root.id = 'whatsNewRoot';
        root.innerHTML = `
            <div class="obA-scrim" data-action="dismiss"></div>
            <div class="obA-card wn-card" role="dialog" aria-modal="true" aria-labelledby="wnTitle">
                <div class="top-row">
                    <div class="brand-mark">
                        <div class="logo">N</div>
                        noobly Wiki
                    </div>
                    <button class="ob-skip" type="button" data-action="dismiss" aria-label="Dismiss">
                        Dismiss <i class="bi bi-x-lg" style="font-size:11px"></i>
                    </button>
                </div>
                <div class="body wn-body">
                    <div class="ob-eyebrow"><i class="bi bi-stars"></i> What's new</div>
                    <h1 class="ob-title" id="wnTitle" style="margin-top:8px">What's New</h1>
                    <div class="wn-content markdown-content">${bodyHtml}</div>
                </div>
                <div class="footer">
                    <span class="ob-step-label">You won't see this again until there's a new update.</span>
                    <button class="ob-btn" type="button" data-action="dismiss">Got it <i class="bi bi-check-lg"></i></button>
                </div>
            </div>
        `;
        this.root = root;
        document.body.appendChild(root);

        root.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="dismiss"]')) this.dismiss();
        });
        this._onKeydown = (e) => { if (e.key === 'Escape') this.dismiss(); };
        document.addEventListener('keydown', this._onKeydown);
    },

    /** Close the modal and remember this version as dismissed for the user. */
    dismiss() {
        this.rememberDismissed(this._version);
        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown);
            this._onKeydown = null;
        }
        if (this.root) {
            this.root.remove();
            this.root = null;
        }
    }
};
