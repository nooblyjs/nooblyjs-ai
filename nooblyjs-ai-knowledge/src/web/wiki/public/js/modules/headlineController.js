/**
 * Headline Controller
 *
 * Drives the full-width announcement banner shown directly under the topbar
 * (`#headlineBanner` in index.html). The banner is backed by a single
 * admin-maintained string (`<APP_BASE_DIR>/content/headline.txt`, served via
 * `/applications/wiki/api/headline`):
 *
 *   - On load it fetches the headline. When the string is non-empty the banner
 *     is shown; when empty (the default) the banner stays hidden and the grid
 *     row it occupies collapses to nothing.
 *   - Admins edit the string from the Profile screen ("Headline" section);
 *     saving calls `refresh()` here so the banner updates without a reload.
 *
 * Styling lives in src/web/wiki/public/css/wiki.css (`.kr-headline`).
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-26
 */

const HEADLINE_API = '/applications/wiki/api/headline';

export const headlineController = {
    app: null,

    init(app) {
        this.app = app;
        this.refresh();
    },

    /** Fetch the current headline and (re)render the banner. */
    async refresh() {
        let headline = '';
        try {
            const res = await fetch(HEADLINE_API, { credentials: 'include' });
            const data = await res.json();
            if (res.ok && data && data.success !== false) {
                headline = String(data.headline || '').trim();
            }
        } catch (err) {
            console.error('[headline] load failed:', err);
        }
        this.render(headline);
    },

    /** Show the banner with `text`, or hide it when `text` is empty. */
    render(text) {
        const banner = document.getElementById('headlineBanner');
        if (!banner) return;
        const label = banner.querySelector('[data-headline-text]');
        if (text) {
            if (label) label.textContent = text;
            banner.classList.remove('hidden');
        } else {
            if (label) label.textContent = '';
            banner.classList.add('hidden');
        }
    }
};
