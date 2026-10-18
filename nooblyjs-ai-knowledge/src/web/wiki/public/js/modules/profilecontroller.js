/**
 * Profile Controller
 *
 * Renders the user's profile screen into the main content area when the
 * username badge in the top bar is clicked. The profile lets the user:
 *   - change their password
 *   - view and remove pinned items, subscriptions, viewed history,
 *     starred items, comments and likes
 *
 * The screen is built entirely in JS into #profileContent (a #profileView
 * `.view` shell in index.html). Styling lives in src/web/wiki/public/css/wiki.css (`.pf-*`).
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-19
 */

import { documentController } from "./documentcontroller.js";
import { userController } from "./usercontroller.js";
import { openAvatarCropper } from "./avatarCropper.js";
import { helpController } from "./helpController.js";
import { headlineController } from "./headlineController.js";

const API = '/applications/wiki/api';

/** Section kind → which header stat tile (if any) it feeds. */
const STAT_OF = { pinned: 'pinned', subs: 'subs', comments: 'comments', likes: 'likes' };

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function basename(p) {
    return String(p || '').split('/').filter(Boolean).pop() || String(p || '');
}

function fmtDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
}

/** Send a JSON request and resolve to the parsed body, throwing on failure. */
async function apiSend(url, method, body) {
    const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty body is fine */ }
    if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || `Request failed (${res.status})`);
    }
    return data;
}

export const profileController = {
    app: null,
    data: { pinned: [], subs: [], viewed: [], starred: [], comments: [], annotations: [], reviews: [], likes: [], templates: [], tokens: [] },

    init(app) {
        this.app = app;
        const badge = document.getElementById('userProfileBadge');
        if (badge) {
            badge.style.cursor = 'pointer';
            badge.addEventListener('click', () => this.show());
        }
    },

    /** Switch the main content area to the profile view and load it. */
    async show() {
        if (this.app?.setActiveView) this.app.setActiveView('profile');
        this.renderShell();
        await this.loadAll();
    },

    // ---- Shell -------------------------------------------------------------

    renderShell() {
        const profile = this.app?.userProfile || {};
        const email = profile.email || profile.name || 'User';
        const name = profile.name && profile.name !== 'User' ? profile.name : email;
        const initials = this.initials(name);
        const container = document.getElementById('profileContent');
        if (!container) return;

        // Tear down a previous help editor before the shell is rebuilt — the
        // editor appends slash/URL menus to <body> that the innerHTML reset
        // below would otherwise orphan (and stack on the next render).
        if (this._helpEditor) { try { this._helpEditor.destroy(); } catch (_) { /* noop */ } this._helpEditor = null; }
        this._helpRaw = null;
        if (this._whatsNewEditor) { try { this._whatsNewEditor.destroy(); } catch (_) { /* noop */ } this._whatsNewEditor = null; }
        this._whatsNewRaw = null;

        const avatarImg = profile.email
            ? `<img alt="" src="/applications/wiki/avatars/${encodeURIComponent(profile.email)}${profile.avatarVersion ? `?v=${profile.avatarVersion}` : ''}" onerror="this.remove()">`
            : '';

        container.innerHTML = `
          <section class="pf-header">
            <div class="who">
              <div class="pf-avatar-wrap">
                <div class="avatar-xl">${esc(initials)}${avatarImg}</div>
                <button type="button" class="pf-avatar-edit" data-avatar-edit title="Upload profile picture"><i class="bi bi-camera-fill"></i></button>
                <input type="file" data-avatar-input accept="image/png,image/jpeg,image/gif" style="display:none">
              </div>
              <div>
                <h1>${esc(name)}</h1>
                <p class="sub">${esc(email)}${profile.role ? ' · ' + esc(profile.role) : ''}</p>
              </div>
            </div>
            <div class="pf-stats">
              <div class="stat"><div class="n" data-stat="pinned">–</div><div class="l">Pinned</div></div>
              <div class="stat"><div class="n" data-stat="subs">–</div><div class="l">Subscriptions</div></div>
              <div class="stat"><div class="n" data-stat="comments">–</div><div class="l">Comments</div></div>
              <div class="stat"><div class="n" data-stat="likes">–</div><div class="l">Likes</div></div>
            </div>
          </section>
          <div class="pf-body">
            <nav class="pf-rail">
              <div class="head" data-head="dashboard">Dashboard</div>
              <a data-jump="sec-dashboard" data-rail="dashboard"><i class="bi bi-speedometer2"></i> Dashboard</a>
              <div class="head">My items</div>
              <a data-jump="sec-pinned"><i class="bi bi-pin-angle"></i> Pinned <span class="num" data-num="pinned">0</span></a>
              <a data-jump="sec-subs"><i class="bi bi-bell"></i> Subscriptions <span class="num" data-num="subs">0</span></a>
              <a data-jump="sec-viewed"><i class="bi bi-clock-history"></i> Viewed <span class="num" data-num="viewed">0</span></a>
              <a data-jump="sec-starred"><i class="bi bi-star"></i> Starred <span class="num" data-num="starred">0</span></a>
              <div class="head">Activity</div>
              <a data-jump="sec-comments"><i class="bi bi-chat-square-text"></i> Comments <span class="num" data-num="comments">0</span></a>
              <a data-jump="sec-annotations"><i class="bi bi-pin-angle"></i> Annotations <span class="num" data-num="annotations">0</span></a>
              <a data-jump="sec-reviews"><i class="bi bi-clipboard-check"></i> Reviews <span class="num" data-num="reviews">0</span></a>
              <a data-jump="sec-likes"><i class="bi bi-heart"></i> Likes <span class="num" data-num="likes">0</span></a>
              <div class="head">Wiki</div>
              <a data-jump="sec-templates"><i class="bi bi-file-earmark-code"></i> Templates <span class="num" data-num="templates">0</span></a>
              <div class="head">Account</div>
              <a data-jump="sec-account"><i class="bi bi-shield-lock"></i> Account &amp; security</a>
              <a data-jump="sec-tokens"><i class="bi bi-key"></i> API tokens <span class="num" data-num="tokens">0</span></a>
              <div class="head">Developer</div>
              <a data-jump="sec-swagger"><i class="bi bi-braces"></i> API Reference</a>
              <div class="head" data-head="system" style="display:none;">System</div>
              <a data-jump="sec-help" data-rail="help" style="display:none;"><i class="bi bi-question-circle"></i> Help content</a>
              <a data-jump="sec-headline" data-rail="headline" style="display:none;"><i class="bi bi-megaphone"></i> Headline</a>
              <a data-jump="sec-whatsnew" data-rail="whatsnew" style="display:none;"><i class="bi bi-stars"></i> What's New</a>
              <a data-jump="sec-clientcache" data-rail="clientcache" style="display:none;"><i class="bi bi-arrow-repeat"></i> Client caches</a>
            </nav>
            <div>
              ${this.dashboardSectionHtml()}
              ${this.sectionShell('sec-pinned', 'pinned', 'bi-pin-angle', 'Pinned items', 'Quick-access pins shown in your sidebar', 'Unpin')}
              ${this.sectionShell('sec-subs', 'subs', 'bi-bell', 'Subscriptions', 'Documents and folders you are notified about', 'Unsubscribe')}
              ${this.sectionShell('sec-viewed', 'viewed', 'bi-clock-history', 'Viewed', 'Your recently opened documents', 'Remove')}
              ${this.sectionShell('sec-starred', 'starred', 'bi-star', 'Starred', 'Documents you have starred', 'Unstar')}
              ${this.sectionShell('sec-comments', 'comments', 'bi-chat-square-text', 'Comments', 'Everywhere you have contributed to a discussion', 'Delete')}
              ${this.sectionShell('sec-annotations', 'annotations', 'bi-pin-angle', 'Annotations', 'Content you have annotated across documents', 'Delete')}
              ${this.sectionShell('sec-reviews', 'reviews', 'bi-clipboard-check', 'Reviews', 'Reviews requested of you and reviews you have requested', 'Cancel')}
              ${this.sectionShell('sec-likes', 'likes', 'bi-heart', 'Likes', 'Pages you have liked', 'Unlike')}
              ${this.templatesSectionHtml()}
              ${this.accountSectionHtml()}
              ${this.apiTokensSectionHtml()}
              ${this.swaggerSectionHtml()}
              ${this.helpSectionHtml()}
              ${this.headlineSectionHtml()}
              ${this.whatsNewSectionHtml()}
              ${this.clientCacheSectionHtml()}
            </div>
          </div>
        `;
        this.bindShell(container);
    },

    dashboardSectionHtml() {
        // Hidden until loadDashboard() confirms a dashboard exists for this
        // user in the current space. Rendered read-only — no editor wiring.
        return `
          <section class="pf-section" id="sec-dashboard" data-section="dashboard" style="display:none;">
            <div class="head">
              <span class="ico"><i class="bi bi-speedometer2"></i></span>
              <div class="titles">
                <h2>Dashboard</h2>
                <div class="sub">Your personal dashboard from this space's <code>.system/dashboards/</code> folder</div>
              </div>
            </div>
            <div class="body markdown-content" data-dashboard-body style="padding: 24px 28px;">
              <div class="pf-empty">Loading…</div>
            </div>
          </section>`;
    },

    accountSectionHtml() {
        return `
          <section class="pf-section" id="sec-account">
            <div class="head">
              <span class="ico"><i class="bi bi-shield-lock"></i></span>
              <div class="titles">
                <h2>Account &amp; security</h2>
                <div class="sub">Change your password</div>
              </div>
            </div>
            <form class="pf-form" id="pfPasswordForm" autocomplete="off">
              <div class="pf-field">
                <label>Current password</label>
                <input type="password" name="current" autocomplete="current-password" required>
              </div>
              <div class="pf-field">
                <label>New password</label>
                <input type="password" name="next" autocomplete="new-password" required>
                <div class="pf-strength">
                  <div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>
                </div>
                <div class="hint">At least 6 characters.</div>
              </div>
              <div class="pf-field">
                <label>Confirm new password</label>
                <input type="password" name="confirm" autocomplete="new-password" required>
              </div>
              <div class="pf-form-foot">
                <button type="submit" class="pf-btn solid"><i class="bi bi-shield-check"></i> Update password</button>
                <button type="button" class="pf-btn" data-pw-cancel>Cancel</button>
              </div>
              <div class="pf-msg" id="pfPasswordMsg"></div>
            </form>
          </section>`;
    },

    apiTokensSectionHtml() {
        return `
          <section class="pf-section" id="sec-tokens" data-section="tokens">
            <div class="head">
              <span class="ico"><i class="bi bi-key"></i></span>
              <div class="titles">
                <h2>API tokens <span class="count">0</span></h2>
                <div class="sub">Personal access tokens for the API. Send as <code>Authorization: Bearer &lt;token&gt;</code> — they act as you, with your roles.</div>
              </div>
              <div class="acts">
                <button class="pf-btn sm" data-token-refresh title="Refresh"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
              </div>
            </div>

            <div class="pf-token-reveal" data-token-reveal style="display:none;">
              <div class="pf-token-reveal-head"><i class="bi bi-shield-exclamation"></i> Copy your new token now — you won't be able to see it again.</div>
              <div class="pf-token-reveal-row">
                <input type="text" readonly data-token-value spellcheck="false" aria-label="New API token">
                <button class="pf-btn solid sm" type="button" data-token-copy><i class="bi bi-clipboard"></i> Copy</button>
                <button class="pf-btn sm" type="button" data-token-dismiss>Done</button>
              </div>
              <div class="pf-token-reveal-note" data-token-expiry-note></div>
            </div>

            <form class="pf-form pf-token-form" id="pfTokenForm" autocomplete="off">
              <div class="pf-token-form-grid">
                <div class="pf-field">
                  <label>Token name</label>
                  <input type="text" name="name" placeholder="e.g. VS Code on my laptop" maxlength="100" required>
                  <div class="hint">A label so you can recognise this token later.</div>
                </div>
                <div class="pf-field">
                  <label>Expires</label>
                  <select name="expiresInDays" class="pf-select">
                    <option value="">Never</option>
                    <option value="30">In 30 days</option>
                    <option value="60">In 60 days</option>
                    <option value="90" selected>In 90 days</option>
                    <option value="365">In 1 year</option>
                  </select>
                  <div class="hint">Revocation or expiry takes effect immediately.</div>
                </div>
              </div>
              <div class="pf-form-foot">
                <button type="submit" class="pf-btn solid"><i class="bi bi-plus-lg"></i> Generate token</button>
                <span class="pf-msg" id="pfTokenMsg"></span>
              </div>
            </form>

            <div class="body" data-token-list>
              <div class="pf-empty">Loading…</div>
            </div>
          </section>`;
    },

    /**
     * Admin-only help editor. Hidden until loadHelp() confirms the server says
     * this user may edit (canEdit). Edits the single global help document shown
     * in the topbar help drawer.
     */
    helpSectionHtml() {
        return `
          <section class="pf-section" id="sec-help" data-section="help" style="display:none;">
            <div class="head">
              <span class="ico"><i class="bi bi-question-circle"></i></span>
              <div class="titles">
                <h2>Help content</h2>
                <div class="sub">Edit the help shown in the help (<i class="bi bi-question-circle"></i>) drawer. Each heading (<code>#</code>, <code>##</code>) becomes a navigable item. Everyone can read it; only admins can edit.</div>
              </div>
              <div class="acts">
                <button class="pf-btn solid sm" type="button" data-help-save><i class="bi bi-check2"></i> Save</button>
              </div>
            </div>
            <div class="pf-help-body">
              <div class="pf-field">
                <label>Contact support target</label>
                <input type="text" data-help-support placeholder="mailto:support@example.com or https://…" spellcheck="false">
                <div class="hint">Used by the “Contact support” button in the drawer. Leave blank to hide the button.</div>
              </div>
              <div id="pfHelpEditor" class="pf-help-editor we-doc-editor"></div>
              <div class="pf-help-msg" data-help-msg></div>
            </div>
          </section>`;
    },

    /**
     * Admin-only headline editor. Hidden until loadHeadline() confirms the
     * server says this user may edit (canEdit). Captures the single global
     * headline string shown in the full-width banner under the topbar; an
     * empty value hides the banner.
     */
    headlineSectionHtml() {
        return `
          <section class="pf-section" id="sec-headline" data-section="headline" style="display:none;">
            <div class="head">
              <span class="ico"><i class="bi bi-megaphone"></i></span>
              <div class="titles">
                <h2>Headline</h2>
                <div class="sub">A short announcement shown in a banner across the top of every page. Leave it blank to hide the banner. Everyone sees it; only admins can edit.</div>
              </div>
              <div class="acts">
                <button class="pf-btn solid sm" type="button" data-headline-save><i class="bi bi-check2"></i> Save</button>
              </div>
            </div>
            <div class="pf-help-body">
              <div class="pf-field">
                <label>Headline text</label>
                <input type="text" data-headline-input placeholder="e.g. Scheduled maintenance this Saturday 18:00–20:00" spellcheck="true" maxlength="300">
                <div class="hint">One line. Clear the field and save to remove the banner.</div>
              </div>
              <div class="pf-help-msg" data-headline-msg></div>
            </div>
          </section>`;
    },

    /**
     * Admin-only "What's New" editor. Hidden until loadWhatsNew() confirms the
     * server says this user may edit (canEdit). Edits the single global What's
     * New message shown in a modal when users log in; changing it makes the
     * modal reappear (for everyone) until each user dismisses it again.
     */
    whatsNewSectionHtml() {
        return `
          <section class="pf-section" id="sec-whatsnew" data-section="whatsnew" style="display:none;">
            <div class="head">
              <span class="ico"><i class="bi bi-stars"></i></span>
              <div class="titles">
                <h2>What's New</h2>
                <div class="sub">A short announcement shown in a modal when users log in. Editing it makes the modal reappear for everyone (until they dismiss it again). Clear it and save to stop showing it. Everyone sees it; only admins can edit.</div>
              </div>
              <div class="acts">
                <button class="pf-btn solid sm" type="button" data-whatsnew-save><i class="bi bi-check2"></i> Save</button>
              </div>
            </div>
            <div class="pf-help-body">
              <div id="pfWhatsNewEditor" class="pf-help-editor we-doc-editor"></div>
              <div class="pf-help-msg" data-whatsnew-msg></div>
            </div>
          </section>`;
    },

    /**
     * Admin-only client cache control. Hidden until loadClientCache() confirms
     * the server says this user may edit (canEdit).
     *
     * Bumping the epoch makes every browser drop its cached navigation trees on
     * its next page load, which is the scalable replacement for talking someone
     * through `window.wikiClearAllCache()` in devtools. Deliberately a bump, not
     * a free-text field: the value only has to CHANGE, and a typo that reuses a
     * previous value would silently purge nobody.
     */
    clientCacheSectionHtml() {
        return `
          <section class="pf-section" id="sec-clientcache" data-section="clientcache" style="display:none;">
            <div class="head">
              <span class="ico"><i class="bi bi-arrow-repeat"></i></span>
              <div class="titles">
                <h2>Client caches</h2>
                <div class="sub">Make every user's browser drop its cached navigation trees on their next page load. Use after a change that leaves cached trees wrong. Admins only.</div>
              </div>
              <div class="acts">
                <button class="pf-btn solid sm" type="button" data-cache-bump><i class="bi bi-arrow-repeat"></i> Refresh everyone</button>
              </div>
            </div>
            <div class="pf-help-body">
              <div class="pf-field">
                <label>Current cache version</label>
                <input type="text" data-cache-version readonly>
                <div class="hint">
                  Users keep their sign-in, layout, view preferences, chat history and
                  dismissed announcements — only the cached navigation trees are dropped,
                  and each user is told it happened. The trees rebuild themselves on the
                  next load, so this costs every user one full tree fetch: worth doing
                  after a release that changes the navigation, not as routine housekeeping.
                  The server's own tree cache is separate — clear that with
                  <code>?clearCache=all</code>.
                </div>
              </div>
              <div class="pf-help-msg" data-cache-msg></div>
            </div>
          </section>`;
    },

    templatesSectionHtml() {
        return `
          <section class="pf-section" id="sec-templates" data-section="templates">
            <div class="head">
              <span class="ico"><i class="bi bi-file-earmark-code"></i></span>
              <div class="titles">
                <h2>Templates <span class="count">0</span></h2>
                <div class="sub">Markdown templates stored in each space's <code>.system/templates/</code> folder</div>
              </div>
              <div class="acts">
                <button class="pf-btn sm" data-tpl-refresh title="Refresh"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
              </div>
            </div>
            <div class="pf-templates">
              <div class="pf-templates-list" data-tpl-list>
                <div class="pf-empty">Loading…</div>
              </div>
              <div class="pf-templates-editor" data-tpl-editor>
                <div class="pf-tpl-placeholder">Select a template on the left to preview or edit.</div>
              </div>
            </div>
          </section>`;
    },

    swaggerSectionHtml() {
        return `
          <section class="pf-section" id="sec-swagger" data-section="swagger">
            <div class="head">
              <span class="ico"><i class="bi bi-braces"></i></span>
              <div class="titles">
                <h2>API Reference</h2>
                <div class="sub">Interactive OpenAPI documentation for all platform endpoints</div>
              </div>
              <div class="acts">
                <button class="pf-btn sm" data-swagger-expand title="Open in new tab" onclick="window.open('/applications/wiki/api/swagger/openapi.json','_blank')">
                  <i class="bi bi-box-arrow-up-right"></i> View spec JSON
                </button>
              </div>
            </div>
            <div class="pf-swagger-wrap" id="swaggerUiMount">
              <div class="pf-empty" id="swaggerUiPlaceholder">Loading API documentation…</div>
            </div>
          </section>`;
    },

    /** Lazily load Swagger UI from CDN and render the spec into #swaggerUiMount. */
    async loadSwagger() {
        const mount = document.getElementById('swaggerUiMount');
        if (!mount || mount.dataset.loaded) return;
        mount.dataset.loaded = 'true';

        const CDN = 'https://unpkg.com/swagger-ui-dist@5.17.14';

        const ensureLink = (href) => {
            if (document.querySelector(`link[href="${href}"]`)) return;
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            document.head.appendChild(link);
        };

        const ensureScript = (src) => new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });

        try {
            ensureLink(`${CDN}/swagger-ui.css`);
            await ensureScript(`${CDN}/swagger-ui-bundle.js`);

            const placeholder = document.getElementById('swaggerUiPlaceholder');
            if (placeholder) placeholder.remove();

            // eslint-disable-next-line no-undef
            SwaggerUIBundle({
                url: '/applications/wiki/api/swagger/openapi.json',
                domNode: mount,
                presets: [
                    // eslint-disable-next-line no-undef
                    SwaggerUIBundle.presets.apis,
                    // eslint-disable-next-line no-undef
                    SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: 'BaseLayout',
                deepLinking: false,
                defaultModelsExpandDepth: 0,
                defaultModelExpandDepth: 1,
                docExpansion: 'none',
                filter: true,
                tryItOutEnabled: false
            });
        } catch (err) {
            console.error('[Profile] Failed to load Swagger UI:', err);
            mount.innerHTML = `<div class="pf-empty">Could not load API documentation. <a href="/applications/wiki/api/swagger/openapi.json" target="_blank">View raw spec</a></div>`;
        }
    },

    sectionShell(id, kind, icon, title, sub, delLabel) {
        return `
          <section class="pf-section" id="${id}" data-section="${kind}">
            <div class="head">
              <span class="ico"><i class="bi ${icon}"></i></span>
              <div class="titles">
                <h2>${esc(title)} <span class="count">0</span></h2>
                <div class="sub">${esc(sub)}</div>
              </div>
              <div class="acts">
                <button class="pf-btn sm" data-bulk-select><i class="bi bi-check2-square"></i> Select all</button>
                <button class="pf-btn sm" data-bulk-delete><i class="bi bi-trash"></i> ${esc(delLabel)} selected</button>
              </div>
            </div>
            <div class="body" data-list>
              <div class="pf-empty">Loading…</div>
            </div>
          </section>`;
    },

    initials(source) {
        const s = String(source || 'U').replace(/@.*$/, '');
        return s.split(/[\s._-]+/).filter(Boolean).slice(0, 2)
            .map(w => w[0].toUpperCase()).join('') || 'U';
    },

    // ---- Data loading ------------------------------------------------------

    async loadAll() {
        await Promise.all([
            this.loadDashboard(),
            this.loadSection('pinned', `${API}/pins`, d => d.pins || []),
            this.loadSection('subs', `${API}/notifications/subscriptions`, d => d.data || []),
            this.loadActivity(),
            this.loadSection('comments', `${API}/user/comments`, d => d.comments || []),
            this.loadSection('annotations', `${API}/user/annotations`, d => d.annotations || []),
            this.loadSection('reviews', `${API}/user/reviews`, d => [
                ...((d.reviews && d.reviews.assignedToMe) || []),
                ...((d.reviews && d.reviews.requestedByMe) || [])
            ]),
            this.loadSection('likes', `${API}/user/likes`, d => d.likes || []),
            this.loadTemplates(),
            this.loadApiTokens(),
            this.loadHelp(),
            this.loadHeadline(),
            this.loadWhatsNew(),
            this.loadClientCache()
        ]);
    },

    /**
     * Load the user's personal dashboard for the current space and render it
     * read-only at the top of the profile screen. Mirrors the home-page logic:
     * looks for `.system/dashboards/{email-prefix}.md` (then legacy
     * `.dashboards/{email-prefix}.md`), shows the section (and its rail
     * entry) only when the file exists, hides everything otherwise.
     */
    async loadDashboard() {
        const section = document.getElementById('sec-dashboard');
        if (!section) return;
        const body = section.querySelector('[data-dashboard-body]');
        const railLink = document.querySelector('.pf-rail [data-rail="dashboard"]');
        const railHead = document.querySelector('.pf-rail [data-head="dashboard"]');

        const setVisible = (visible) => {
            const display = visible ? '' : 'none';
            section.style.display = display;
            if (railLink) railLink.style.display = display;
            if (railHead) railHead.style.display = display;
        };

        // Reviews awaiting me are shown at the top of the dashboard, independent
        // of whether a .system/dashboards/ file exists for this user.
        let awaitingHtml = '';
        try {
            const res = await fetch(`${API}/user/reviews${this.spaceQS()}`, { credentials: 'include' });
            const data = await res.json();
            const awaiting = ((data.reviews && data.reviews.assignedToMe) || [])
                .filter(r => r.status === 'inprogress');
            awaitingHtml = this.awaitingReviewsHtml(awaiting);
        } catch (_) { /* optional — ignore */ }

        const renderMd = (md) => (typeof window.parseMarkdown === 'function')
            ? window.parseMarkdown(md)
            : esc(md);

        let dashHtml = '';

        // 1) Per-user dashboard from the activity folder
        // (.system/useractivity/<prefix>/dashboard.md), same source as the home page.
        try {
            const res = await fetch(`${API}/user/dashboard${this.spaceQS()}`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.exists && data.content) dashHtml = renderMd(data.content);
            }
        } catch (_) { /* fall through to the per-space lookup */ }

        // 2) Fallback: workflow-generated per-space dashboard. Prefer the new
        //    .system/dashboards/<prefix>.md, then the legacy .dashboards/<prefix>.md
        //    (older workflow output) so it keeps working until the generator moves.
        if (!dashHtml) {
            const space = this.app?.currentSpace?.name;
            const email = this.app?.userProfile?.email
                || document.getElementById('userName')?.textContent
                || '';
            const prefix = email.split('@')[0].trim().toLowerCase();
            if (space && prefix) {
                const candidates = [`.system/dashboards/${prefix}.md`, `.dashboards/${prefix}.md`];
                for (const path of candidates) {
                    try {
                        const exists = await apiSend(`${API}/documents/exists`, 'POST', { spaceName: space, path });
                        if (exists.exists) {
                            const data = await apiSend(`${API}/documents/content`, 'POST', { spaceName: space, path });
                            if (data.content) { dashHtml = renderMd(data.content); break; }
                        }
                    } catch (err) {
                        // Dashboard markdown is optional — fail silently, like the home page.
                    }
                }
            }
        }

        if (!awaitingHtml && !dashHtml) { setVisible(false); return; }
        body.innerHTML = awaitingHtml + dashHtml;
        setVisible(true);
    },

    /** A compact "reviews awaiting your review" panel for the dashboard. */
    awaitingReviewsHtml(list) {
        if (!list || !list.length) return '';
        const rows = list.map(r => `
            <li>
              <button type="button" class="pf-review-open" data-open-review data-path="${esc(r.path)}" data-space="${esc(r.spaceName)}">
                <i class="bi bi-file-earmark-text"></i> ${esc(r.title || basename(r.path))}
              </button>
              <span class="pf-review-from">requested by ${esc(r.requested || 'someone')}${r.startdate ? ' · ' + esc(r.startdate) : ''}</span>
            </li>`).join('');
        return `
          <div class="pf-awaiting-reviews">
            <h3><i class="bi bi-clipboard-check"></i> Reviews awaiting your review <span class="pf-awaiting-count">${list.length}</span></h3>
            <ul>${rows}</ul>
          </div>`;
    },

    async loadTemplates() {
        try {
            const res = await fetch(`${API}/templates`, { credentials: 'include' });
            const data = await res.json();
            this.data.templates = Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[Profile] failed to load templates:', err);
            this.data.templates = [];
        }
        this.renderTemplatesSection();
    },

    /** `?space=<current space>` query suffix; per-user data is now space-scoped. */
    spaceQS() {
        const sp = this.app?.currentSpace?.name;
        return sp ? `?space=${encodeURIComponent(sp)}` : '';
    },

    async loadSection(kind, url, pick) {
        try {
            const res = await fetch(url + this.spaceQS(), { credentials: 'include' });
            const data = await res.json();
            this.data[kind] = pick(data) || [];
        } catch (err) {
            console.error(`[Profile] failed to load ${kind}:`, err);
            this.data[kind] = [];
            this.renderError(kind);
            return;
        }
        this.renderSection(kind);
    },

    /** Viewed + starred both come from the single /user/activity endpoint. */
    async loadActivity() {
        try {
            const res = await fetch(`${API}/user/activity${this.spaceQS()}`, { credentials: 'include' });
            const data = await res.json();
            this.data.viewed = Array.isArray(data.recent) ? data.recent : [];
            this.data.starred = Array.isArray(data.starred) ? data.starred : [];
        } catch (err) {
            console.error('[Profile] failed to load activity:', err);
            this.data.viewed = [];
            this.data.starred = [];
        }
        this.renderSection('viewed');
        this.renderSection('starred');
    },

    // ---- Rendering ---------------------------------------------------------

    /** Normalise a stored item into the fields a row needs. */
    normalize(kind, item) {
        const title = item.title || basename(item.path);
        const space = item.spaceName || '';
        const pathLabel = [space, item.path].filter(Boolean).join(' / ');
        const isFolder = item.type === 'folder';
        switch (kind) {
            case 'pinned':
                return { ftype: isFolder ? 'sp' : '', icon: isFolder ? 'bi-folder' : 'bi-file-earmark-text',
                    name: title, pathLabel, snippet: '', when: 'Pinned ' + fmtDate(item.pinnedAt),
                    canOpen: !isFolder };
            case 'subs':
                return { ftype: item.type === 'folder' ? 'sp' : '', icon: item.type === 'folder' ? 'bi-folder' : 'bi-file-earmark-text',
                    name: basename(item.path), pathLabel: item.path || '', snippet: '',
                    when: item.type === 'folder' ? 'Folder' : 'Document', canOpen: item.type !== 'folder' };
            case 'viewed':
                return { ftype: '', icon: 'bi-file-earmark-text', name: title, pathLabel, snippet: '',
                    when: 'Viewed ' + fmtDate(item.visitedAt), canOpen: true };
            case 'starred':
                return { ftype: '', icon: 'bi-file-earmark-text', name: title, pathLabel, snippet: '',
                    when: 'Starred ' + fmtDate(item.starredAt), canOpen: true };
            case 'comments':
                return { ftype: 'cm', icon: 'bi-chat-square-text-fill', name: title, pathLabel,
                    snippet: item.text || '', when: item.date || fmtDate(item.indexedAt), canOpen: true };
            case 'annotations':
                return { ftype: 'an', icon: 'bi-pin-angle-fill', name: title,
                    pathLabel: [pathLabel, item.target].filter(Boolean).join(' · '),
                    snippet: item.text || '', when: item.date || fmtDate(item.indexedAt), canOpen: true };
            case 'reviews': {
                const mine = item.role === 'reviewer';
                const done = item.status === 'complete';
                const party = mine ? `from ${item.requested || '?'}` : `reviewer ${item.reviewer || '?'}`;
                const state = done ? `Complete${item.stars ? ' · ' + item.stars + '★' : ''}` : 'In progress';
                const when = done
                    ? 'Completed ' + (item.enddate || '')
                    : 'Requested ' + (item.startdate || '');
                return { ftype: mine ? 'rv-in' : 'rv-out', icon: mine ? 'bi-clipboard-check-fill' : 'bi-send-check-fill',
                    name: title,
                    pathLabel: [pathLabel, party, state].filter(Boolean).join(' · '),
                    snippet: '', when, canOpen: true };
            }
            case 'likes':
                return { ftype: 'lk', icon: 'bi-heart-fill', name: title, pathLabel, snippet: '',
                    when: 'Liked ' + fmtDate(item.likedAt), canOpen: true };
            default:
                return { ftype: '', icon: 'bi-file-earmark-text', name: title, pathLabel, snippet: '', when: '', canOpen: false };
        }
    },

    rowHtml(kind, item, idx) {
        const n = this.normalize(kind, item);
        return `
          <div class="pf-row" data-kind="${kind}" data-idx="${idx}">
            <span class="cb" data-cb><i class="bi bi-check2"></i></span>
            <span class="ftype ${n.ftype}"><i class="bi ${n.icon}"></i></span>
            <div class="meta-main">
              <div class="name">${esc(n.name)}</div>
              ${n.pathLabel ? `<div class="path"><i class="bi bi-folder2"></i> ${esc(n.pathLabel)}</div>` : ''}
              ${n.snippet ? `<div class="snippet">${esc(n.snippet)}</div>` : ''}
            </div>
            <span class="when">${esc(n.when)}</span>
            <div class="row-acts">
              ${n.canOpen ? `<button data-open title="Open"><i class="bi bi-box-arrow-up-right"></i></button>` : ''}
              <button class="del" data-del title="Remove"><i class="bi bi-trash"></i></button>
            </div>
          </div>`;
    },

    renderSection(kind) {
        const section = document.querySelector(`.pf-section[data-section="${kind}"]`);
        if (!section) return;
        const list = section.querySelector('[data-list]');
        const items = this.data[kind] || [];

        list.innerHTML = items.length
            ? items.map((it, i) => this.rowHtml(kind, it, i)).join('')
            : `<div class="pf-empty">Nothing here yet.</div>`;

        this.updateCount(kind, items.length);
    },

    renderTemplatesSection() {
        const section = document.getElementById('sec-templates');
        if (!section) return;
        const list = section.querySelector('[data-tpl-list]');
        const items = this.data.templates || [];

        if (!items.length) {
            list.innerHTML = `<div class="pf-empty">No templates yet. Create one in any space's <code>.system/templates/</code> folder.</div>`;
            this.updateCount('templates', 0);
            return;
        }

        const bySpace = items.reduce((acc, t) => {
            const k = t.spaceName || 'Unknown';
            (acc[k] = acc[k] || []).push(t);
            return acc;
        }, {});

        list.innerHTML = Object.entries(bySpace).map(([spaceName, templates]) => `
            <div class="pf-tpl-group">
              <div class="pf-tpl-group-head">
                <i class="bi bi-collection"></i> ${esc(spaceName)}
                <span class="pf-tpl-group-count">${templates.length}</span>
              </div>
              ${templates.map(t => `
                <button class="pf-tpl-item" type="button" data-tpl-open
                        data-space-id="${esc(t.spaceId)}"
                        data-space-name="${esc(t.spaceName)}"
                        data-path="${esc(t.path)}"
                        data-name="${esc(t.name)}"
                        data-can-edit="${t.canEdit ? '1' : '0'}">
                  <i class="bi ${t.scope === 'personal' ? 'bi-person' : 'bi-building'}"></i>
                  <div class="pf-tpl-meta">
                    <div class="pf-tpl-title">${esc(t.title || t.name)} <span style="font-size:10px;color:var(--kr-ink-400);">${t.scope === 'personal' ? 'Mine' : 'Space'}</span></div>
                    <div class="pf-tpl-sub">${esc(t.path)} · ${fmtDate(t.lastModified)}</div>
                  </div>
                </button>
              `).join('')}
            </div>
        `).join('');

        this.updateCount('templates', items.length);
    },

    async onOpenTemplate(button) {
        const section = document.getElementById('sec-templates');
        if (!section) return;

        section.querySelectorAll('.pf-tpl-item.active').forEach(b => b.classList.remove('active'));
        button.classList.add('active');

        const editor = section.querySelector('[data-tpl-editor]');
        const spaceName = button.dataset.spaceName;
        const tplPath = button.dataset.path;
        const tplName = button.dataset.name;
        const canEdit = button.dataset.canEdit === '1';
        const title = button.querySelector('.pf-tpl-title')?.textContent || tplName;

        editor.innerHTML = `<div class="pf-tpl-placeholder">Loading…</div>`;

        let content = '';
        try {
            const url = `${API}/documents/content?path=${encodeURIComponent(tplPath)}&spaceName=${encodeURIComponent(spaceName)}&enhanced=true`;
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            content = data.content || '';
        } catch (err) {
            console.error('[Profile] failed to load template content:', err);
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
                <button class="pf-btn sm" type="button" data-tpl-save><i class="bi bi-check2"></i> Save</button>
                <button class="pf-btn sm" type="button" data-tpl-delete><i class="bi bi-trash"></i> Delete</button>
              ` : `<span style="font-size:12px;color:var(--kr-ink-400);"><i class="bi bi-lock"></i> Read-only — only a space admin can edit this template</span>`}
            </div>
          </div>
          <textarea class="pf-tpl-textarea" data-tpl-textarea spellcheck="false" ${canEdit ? '' : 'readonly'}></textarea>
          <div class="pf-tpl-msg" data-tpl-msg></div>
        `;
        editor.querySelector('[data-tpl-textarea]').value = content;
        editor.dataset.spaceName = spaceName;
        editor.dataset.path = tplPath;
        editor.dataset.name = tplName;
    },

    async onSaveTemplate(button) {
        const editor = button.closest('[data-tpl-editor]');
        if (!editor) return;
        const ta = editor.querySelector('[data-tpl-textarea]');
        const msg = editor.querySelector('[data-tpl-msg]');
        const spaceName = editor.dataset.spaceName;
        const tplPath = editor.dataset.path;
        if (!ta || !spaceName || !tplPath) return;

        button.disabled = true;
        msg.textContent = 'Saving…';
        msg.className = 'pf-tpl-msg';
        try {
            await apiSend(`${API}/documents/content`, 'PUT', {
                path: tplPath, spaceName, content: ta.value
            });
            msg.textContent = 'Saved.';
            msg.className = 'pf-tpl-msg ok';
            await this.loadTemplates();
            const reopen = document.querySelector(`.pf-tpl-item[data-path="${tplPath}"][data-space-name="${spaceName}"]`);
            if (reopen) reopen.classList.add('active');
        } catch (err) {
            msg.textContent = err.message || 'Could not save template.';
            msg.className = 'pf-tpl-msg err';
        } finally {
            button.disabled = false;
        }
    },

    async onDeleteTemplate(button) {
        const editor = button.closest('[data-tpl-editor]');
        if (!editor) return;
        const spaceName = editor.dataset.spaceName;
        const tplPath = editor.dataset.path;
        if (!spaceName || !tplPath) return;
        if (!confirm(`Delete template "${tplPath}" from ${spaceName}? This cannot be undone.`)) return;

        button.disabled = true;
        try {
            const tpl = (this.data.templates || []).find(t => t.path === tplPath && t.spaceName === spaceName);
            const url = `${API}/documents/${encodeURIComponent(tplPath)}`;
            await apiSend(url, 'DELETE', { spaceName, spaceId: tpl?.spaceId });
            editor.innerHTML = `<div class="pf-tpl-placeholder">Template deleted.</div>`;
            delete editor.dataset.spaceName;
            delete editor.dataset.path;
            delete editor.dataset.name;
            await this.loadTemplates();
        } catch (err) {
            alert(`Could not delete template: ${err.message}`);
            button.disabled = false;
        }
    },

    // ---- Help editor (admin only) -----------------------------------------

    /**
     * Load the global help document. The server returns `canEdit` (computed
     * from the user's roles). When the user may edit, reveal the section + rail
     * entries and mount a MarkdownEditor; otherwise keep them hidden.
     */
    async loadHelp() {
        const section = document.getElementById('sec-help');
        if (!section) return;
        const railLink = document.querySelector('.pf-rail [data-rail="help"]');
        const systemHead = document.querySelector('.pf-rail [data-head="system"]');
        const setVisible = (visible) => {
            const display = visible ? '' : 'none';
            section.style.display = display;
            if (railLink) railLink.style.display = display;
            // The "System" header is shared by help/headline/what's-new, so only
            // ever reveal it here — never hide it (another section may need it).
            if (visible && systemHead) systemHead.style.display = '';
        };

        let data;
        try {
            const res = await fetch(`${API}/help`, { credentials: 'include' });
            data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
            console.error('[Profile] failed to load help:', err);
            setVisible(false);
            return;
        }

        if (!data.canEdit) { setVisible(false); return; }
        setVisible(true);

        const supportInput = section.querySelector('[data-help-support]');
        if (supportInput) supportInput.value = data.support || '';

        const host = document.getElementById('pfHelpEditor');
        if (!host) return;

        if (this._helpEditor) { try { this._helpEditor.destroy(); } catch (_) { /* noop */ } this._helpEditor = null; }
        this._helpRaw = null;

        if (typeof MarkdownEditor !== 'undefined') {
            this._helpEditor = new MarkdownEditor('pfHelpEditor', {
                onChange: () => this.setHelpMsg('', '')
            });
            this._helpEditor.load(data.content || '');
        } else {
            // Block editor unavailable — fall back to a raw markdown textarea.
            const ta = document.createElement('textarea');
            ta.className = 'md-raw-textarea';
            ta.spellcheck = false;
            ta.value = data.content || '';
            host.appendChild(ta);
            this._helpRaw = ta;
        }
    },

    readHelpContent() {
        if (this._helpEditor) return this._helpEditor.content();
        if (this._helpRaw) return this._helpRaw.value;
        return '';
    },

    async onSaveHelp(button) {
        const section = document.getElementById('sec-help');
        if (!section) return;
        const supportInput = section.querySelector('[data-help-support]');
        button.disabled = true;
        this.setHelpMsg('Saving…', '');
        try {
            await apiSend(`${API}/help`, 'PUT', {
                content: this.readHelpContent(),
                support: supportInput ? supportInput.value.trim() : ''
            });
            this.setHelpMsg('Saved.', 'ok');
            // Make the drawer pick up the new content on its next open.
            helpController.invalidate();
        } catch (err) {
            this.setHelpMsg(err.message || 'Could not save help.', 'err');
        } finally {
            button.disabled = false;
        }
    },

    setHelpMsg(text, kind) {
        const msg = document.querySelector('#sec-help [data-help-msg]');
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'pf-help-msg' + (kind ? ' ' + kind : '');
    },

    // ---- Headline editor (admin only) -------------------------------------

    /**
     * Load the global headline. The server returns `canEdit` (computed from the
     * user's roles). When the user may edit, reveal the section + rail entries
     * and fill the input; otherwise keep them hidden.
     */
    async loadHeadline() {
        const section = document.getElementById('sec-headline');
        if (!section) return;
        const railLink = document.querySelector('.pf-rail [data-rail="headline"]');
        const systemHead = document.querySelector('.pf-rail [data-head="system"]');
        const setVisible = (visible) => {
            const display = visible ? '' : 'none';
            section.style.display = display;
            if (railLink) railLink.style.display = display;
            // The "System" header is shared by help/headline/what's-new, so only
            // ever reveal it here — never hide it (another section may need it).
            if (visible && systemHead) systemHead.style.display = '';
        };

        let data;
        try {
            const res = await fetch(`${API}/headline`, { credentials: 'include' });
            data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
            console.error('[Profile] failed to load headline:', err);
            setVisible(false);
            return;
        }

        if (!data.canEdit) { setVisible(false); return; }
        setVisible(true);

        const input = section.querySelector('[data-headline-input]');
        if (input) input.value = data.headline || '';
    },

    async onSaveHeadline(button) {
        const section = document.getElementById('sec-headline');
        if (!section) return;
        const input = section.querySelector('[data-headline-input]');
        button.disabled = true;
        this.setHeadlineMsg('Saving…', '');
        try {
            await apiSend(`${API}/headline`, 'PUT', {
                headline: input ? input.value.trim() : ''
            });
            this.setHeadlineMsg('Saved.', 'ok');
            // Update the live banner without a reload.
            headlineController.refresh();
        } catch (err) {
            this.setHeadlineMsg(err.message || 'Could not save headline.', 'err');
        } finally {
            button.disabled = false;
        }
    },

    setHeadlineMsg(text, kind) {
        const msg = document.querySelector('#sec-headline [data-headline-msg]');
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'pf-help-msg' + (kind ? ' ' + kind : '');
    },

    // ---- Client cache epoch (admin only) ----------------------------------

    /**
     * Load the current client cache version. The server returns `canEdit`
     * (computed from the user's roles); the section stays hidden otherwise.
     */
    async loadClientCache() {
        const section = document.getElementById('sec-clientcache');
        if (!section) return;
        const railLink = document.querySelector('.pf-rail [data-rail="clientcache"]');
        const systemHead = document.querySelector('.pf-rail [data-head="system"]');
        const setVisible = (visible) => {
            const display = visible ? '' : 'none';
            section.style.display = display;
            if (railLink) railLink.style.display = display;
            // Shared with help/headline/what's-new — only ever reveal it here.
            if (visible && systemHead) systemHead.style.display = '';
        };

        let data;
        try {
            const res = await fetch(`${API}/admin/client-cache-version`, { credentials: 'include' });
            data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
            console.error('[Profile] failed to load client cache version:', err);
            setVisible(false);
            return;
        }

        if (!data.canEdit) { setVisible(false); return; }
        setVisible(true);

        const input = section.querySelector('[data-cache-version]');
        if (input) input.value = data.clientCacheVersion || '';
    },

    /**
     * Bump the client cache epoch. Confirmed first: it reaches every user's
     * browser, and the cost lands on them (one full tree fetch each) rather than
     * on the admin clicking the button.
     */
    async onBumpClientCache(button) {
        const section = document.getElementById('sec-clientcache');
        if (!section) return;
        const ok = window.confirm(
            'Refresh cached navigation for ALL users?\n\n' +
            'Every browser will drop its cached navigation trees the next time it ' +
            'loads the wiki, and rebuild them from the server. Sign-ins, layouts, ' +
            'preferences and dismissed announcements are not affected.'
        );
        if (!ok) return;

        button.disabled = true;
        this.setClientCacheMsg('Bumping…', '');
        try {
            const data = await apiSend(`${API}/admin/client-cache-version`, 'POST');
            const input = section.querySelector('[data-cache-version]');
            if (input) input.value = data.clientCacheVersion || '';
            this.setClientCacheMsg(
                'Done. Every browser will refresh its cached navigation on its next page load.',
                'ok'
            );
        } catch (err) {
            this.setClientCacheMsg(err.message || 'Could not bump the cache version.', 'err');
        } finally {
            button.disabled = false;
        }
    },

    setClientCacheMsg(text, kind) {
        const msg = document.querySelector('#sec-clientcache [data-cache-msg]');
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'pf-help-msg' + (kind ? ' ' + kind : '');
    },

    // ---- What's New editor (admin only) -----------------------------------

    /**
     * Load the global "What's New" message. The server returns `canEdit`
     * (computed from the user's roles). When the user may edit, reveal the
     * section + rail entries and mount a MarkdownEditor; otherwise keep them
     * hidden.
     */
    async loadWhatsNew() {
        const section = document.getElementById('sec-whatsnew');
        if (!section) return;
        const railLink = document.querySelector('.pf-rail [data-rail="whatsnew"]');
        const systemHead = document.querySelector('.pf-rail [data-head="system"]');
        const setVisible = (visible) => {
            const display = visible ? '' : 'none';
            section.style.display = display;
            if (railLink) railLink.style.display = display;
            // The "System" header is shared by help/headline/what's-new, so only
            // ever reveal it here — never hide it (another section may need it).
            if (visible && systemHead) systemHead.style.display = '';
        };

        let data;
        try {
            const res = await fetch(`${API}/whats-new`, { credentials: 'include' });
            data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
            console.error('[Profile] failed to load What\'s New:', err);
            setVisible(false);
            return;
        }

        if (!data.canEdit) { setVisible(false); return; }
        setVisible(true);

        const host = document.getElementById('pfWhatsNewEditor');
        if (!host) return;

        if (this._whatsNewEditor) { try { this._whatsNewEditor.destroy(); } catch (_) { /* noop */ } this._whatsNewEditor = null; }
        this._whatsNewRaw = null;

        if (typeof MarkdownEditor !== 'undefined') {
            this._whatsNewEditor = new MarkdownEditor('pfWhatsNewEditor', {
                onChange: () => this.setWhatsNewMsg('', '')
            });
            this._whatsNewEditor.load(data.content || '');
        } else {
            // Block editor unavailable — fall back to a raw markdown textarea.
            const ta = document.createElement('textarea');
            ta.className = 'md-raw-textarea';
            ta.spellcheck = false;
            ta.value = data.content || '';
            host.appendChild(ta);
            this._whatsNewRaw = ta;
        }
    },

    readWhatsNewContent() {
        if (this._whatsNewEditor) return this._whatsNewEditor.content();
        if (this._whatsNewRaw) return this._whatsNewRaw.value;
        return '';
    },

    async onSaveWhatsNew(button) {
        const section = document.getElementById('sec-whatsnew');
        if (!section) return;
        button.disabled = true;
        this.setWhatsNewMsg('Saving…', '');
        try {
            await apiSend(`${API}/whats-new`, 'PUT', {
                content: this.readWhatsNewContent()
            });
            this.setWhatsNewMsg('Saved. It will appear for users on their next login.', 'ok');
        } catch (err) {
            this.setWhatsNewMsg(err.message || 'Could not save What\'s New.', 'err');
        } finally {
            button.disabled = false;
        }
    },

    setWhatsNewMsg(text, kind) {
        const msg = document.querySelector('#sec-whatsnew [data-whatsnew-msg]');
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'pf-help-msg' + (kind ? ' ' + kind : '');
    },

    renderError(kind) {
        const section = document.querySelector(`.pf-section[data-section="${kind}"]`);
        if (!section) return;
        section.querySelector('[data-list]').innerHTML =
            `<div class="pf-empty">Could not load this section.</div>`;
    },

    updateCount(kind, count) {
        const section = document.querySelector(`.pf-section[data-section="${kind}"]`);
        if (section) {
            const c = section.querySelector('h2 .count');
            if (c) c.textContent = count;
        }
        const num = document.querySelector(`.pf-rail [data-num="${kind}"]`);
        if (num) num.textContent = count;
        const statKey = STAT_OF[kind];
        if (statKey) {
            const stat = document.querySelector(`.pf-stats [data-stat="${statKey}"]`);
            if (stat) stat.textContent = count;
        }
    },

    /** Recompute a section's count from the rows currently in the DOM. */
    syncCount(section) {
        const kind = section.dataset.section;
        const rows = section.querySelectorAll('.pf-row');
        this.updateCount(kind, rows.length);
        if (!rows.length) {
            section.querySelector('[data-list]').innerHTML =
                `<div class="pf-empty">Nothing here yet.</div>`;
        }
    },

    // ---- Events ------------------------------------------------------------

    bindShell(container) {
        // Rail jump links — smooth-scroll the main content area to a section.
        container.querySelectorAll('.pf-rail a[data-jump]').forEach(a => {
            a.addEventListener('click', () => {
                const target = document.getElementById(a.dataset.jump);
                const main = document.getElementById('mainContent');
                if (target && main) {
                    main.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
                }
                if (a.dataset.jump === 'sec-swagger') {
                    this.loadSwagger();
                }
            });
        });

        // Auto-trigger swagger load when the section scrolls into view (covers
        // cases where the user scrolls rather than clicking the nav link).
        const swaggerSection = document.getElementById('sec-swagger');
        if (swaggerSection) {
            const scrollRoot = document.getElementById('mainContent') || null;
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    observer.disconnect();
                    this.loadSwagger();
                }
            }, { root: scrollRoot, threshold: 0.05 });
            observer.observe(swaggerSection);
        }

        // Delegated row interactions (checkbox, open, delete). #profileContent
        // is a persistent element, so bind this exactly once — re-binding on
        // every render would stack duplicate handlers.
        if (!this._contentBound) {
            container.addEventListener('click', (e) => this.onContentClick(e));
            this._contentBound = true;
        }

        // Profile picture upload (the controls are rebuilt on every render).
        const avatarBtn = container.querySelector('[data-avatar-edit]');
        const avatarInput = container.querySelector('[data-avatar-input]');
        if (avatarBtn && avatarInput) {
            avatarBtn.addEventListener('click', () => avatarInput.click());
            avatarInput.addEventListener('change', (e) => this.onAvatarSelected(e));
        }

        // Password form.
        const form = container.querySelector('#pfPasswordForm');
        if (form) {
            form.addEventListener('submit', (e) => this.onPasswordSubmit(e));
            form.querySelector('[data-pw-cancel]')?.addEventListener('click', () => {
                form.reset();
                this.setStrength(form, 0);
                this.setPasswordMsg('', '');
            });
            form.querySelector('input[name="next"]')?.addEventListener('input', (e) => {
                this.setStrength(form, this.passwordStrength(e.target.value));
            });
        }

        // API token generator (the form is rebuilt each render, like the password form).
        const tokenForm = container.querySelector('#pfTokenForm');
        if (tokenForm) {
            tokenForm.addEventListener('submit', (e) => this.onGenerateToken(e));
        }
    },

    onContentClick(e) {
        const tokenRefresh = e.target.closest('[data-token-refresh]');
        if (tokenRefresh) { this.loadApiTokens(); return; }

        const tokenCopy = e.target.closest('[data-token-copy]');
        if (tokenCopy) { this.onCopyToken(tokenCopy); return; }

        const tokenDismiss = e.target.closest('[data-token-dismiss]');
        if (tokenDismiss) { this.hideTokenReveal(); return; }

        const tokenDel = e.target.closest('[data-token-del]');
        if (tokenDel) { this.onDeleteToken(tokenDel.dataset.tokenId); return; }

        const tplOpen = e.target.closest('[data-tpl-open]');
        if (tplOpen) { this.onOpenTemplate(tplOpen); return; }

        const tplSave = e.target.closest('[data-tpl-save]');
        if (tplSave) { this.onSaveTemplate(tplSave); return; }

        const tplDelete = e.target.closest('[data-tpl-delete]');
        if (tplDelete) { this.onDeleteTemplate(tplDelete); return; }

        const tplRefresh = e.target.closest('[data-tpl-refresh]');
        if (tplRefresh) { this.loadTemplates(); return; }

        const helpSave = e.target.closest('[data-help-save]');
        if (helpSave) { this.onSaveHelp(helpSave); return; }

        const headlineSave = e.target.closest('[data-headline-save]');
        if (headlineSave) { this.onSaveHeadline(headlineSave); return; }

        const whatsNewSave = e.target.closest('[data-whatsnew-save]');
        if (whatsNewSave) { this.onSaveWhatsNew(whatsNewSave); return; }

        const cacheBump = e.target.closest('[data-cache-bump]');
        if (cacheBump) { this.onBumpClientCache(cacheBump); return; }

        const cb = e.target.closest('[data-cb]');
        if (cb) { cb.classList.toggle('on'); return; }

        const bulkSelect = e.target.closest('[data-bulk-select]');
        if (bulkSelect) {
            const list = bulkSelect.closest('.pf-section').querySelector('[data-list]');
            const cbs = [...list.querySelectorAll('[data-cb]')];
            const allOn = cbs.length > 0 && cbs.every(c => c.classList.contains('on'));
            cbs.forEach(c => c.classList.toggle('on', !allOn));
            return;
        }

        const bulkDelete = e.target.closest('[data-bulk-delete]');
        if (bulkDelete) { this.onBulkDelete(bulkDelete.closest('.pf-section')); return; }

        const openReview = e.target.closest('[data-open-review]');
        if (openReview) {
            try { documentController.openDocumentByPath(openReview.dataset.path, openReview.dataset.space); }
            catch (err) { console.error('[Profile] open review failed:', err); }
            return;
        }

        const openBtn = e.target.closest('[data-open]');
        if (openBtn) { this.onOpenRow(openBtn.closest('.pf-row')); return; }

        const delBtn = e.target.closest('[data-del]');
        if (delBtn) { this.onDeleteRow(delBtn.closest('.pf-row')); return; }
    },

    rowItem(row) {
        return (this.data[row.dataset.kind] || [])[Number(row.dataset.idx)];
    },

    onOpenRow(row) {
        const item = this.rowItem(row);
        if (!item || !item.path) return;
        const space = item.spaceName || this.app?.currentSpace?.name;
        try {
            documentController.openDocumentByPath(item.path, space);
        } catch (err) {
            console.error('[Profile] open failed:', err);
        }
    },

    async onDeleteRow(row) {
        const item = this.rowItem(row);
        if (!item) return;
        try {
            await this.deleteItem(row.dataset.kind, item);
        } catch (err) {
            alert(`Could not remove item: ${err.message}`);
            return;
        }
        const section = row.closest('.pf-section');
        this.animateOut([row], () => this.syncCount(section));
    },

    async onBulkDelete(section) {
        const rows = [...section.querySelectorAll('.pf-row')];
        const selected = rows.filter(r => r.querySelector('.cb.on'));
        const targets = selected.length ? selected : rows;
        if (!targets.length) return;
        if (!confirm(`Remove ${targets.length} item${targets.length === 1 ? '' : 's'} from this section?`)) return;

        const kind = section.dataset.section;
        const done = [];
        for (const row of targets) {
            const item = this.rowItem(row);
            if (!item) continue;
            try {
                await this.deleteItem(kind, item);
                done.push(row);
            } catch (err) {
                console.error('[Profile] bulk delete failed for one item:', err);
            }
        }
        this.animateOut(done, () => this.syncCount(section));
        if (done.length !== targets.length) {
            alert(`${targets.length - done.length} item(s) could not be removed.`);
        }
    },

    /** Issue the right API call to remove an item for the given section. */
    deleteItem(kind, item) {
        switch (kind) {
            case 'pinned':
                return apiSend(`${API}/pins`, 'DELETE',
                    { type: item.type, path: item.path, spaceName: item.spaceName });
            case 'subs':
                return apiSend(`${API}/notifications/subscriptions`, 'DELETE',
                    { type: item.type, path: item.path, spaceName: item.spaceName });
            case 'viewed':
                return apiSend(`${API}/user/visit`, 'DELETE',
                    { path: item.path, spaceName: item.spaceName });
            case 'starred':
                return apiSend(`${API}/user/star`, 'POST',
                    { path: item.path, spaceName: item.spaceName, title: item.title || basename(item.path), action: 'unstar' });
            case 'comments':
                return apiSend(`${API}/comments`, 'DELETE',
                    { spaceName: item.spaceName, path: item.path, date: item.date, text: item.text });
            case 'annotations':
                return apiSend(`${API}/annotations`, 'DELETE',
                    { spaceName: item.spaceName, path: item.path, id: item.id });
            case 'reviews':
                return apiSend(`${API}/reviews`, 'DELETE',
                    { spaceName: item.spaceName, path: item.path, id: item.id });
            case 'likes':
                return apiSend(`${API}/likes`, 'DELETE',
                    { spaceName: item.spaceName, path: item.path });
            default:
                return Promise.reject(new Error('Unknown section'));
        }
    },

    animateOut(rows, done) {
        if (!rows.length) { if (done) done(); return; }
        let pending = rows.length;
        rows.forEach(row => {
            row.style.transition = 'opacity .2s ease, transform .2s ease';
            row.style.opacity = '0';
            row.style.transform = 'translateX(-8px)';
            setTimeout(() => {
                row.remove();
                if (--pending === 0 && done) done();
            }, 210);
        });
    },

    // ---- Profile picture -----------------------------------------------------

    /** Upload the chosen image as the user's profile picture, then refresh
     *  the profile header and the top-bar badge in place. */
    async onAvatarSelected(e) {
        const input = e.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;

        if (!/^image\/(png|jpeg|gif)$/i.test(file.type)) {
            alert('Please choose a PNG, JPEG or GIF image.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            alert('Profile pictures must be 5MB or smaller.');
            return;
        }

        // Let the user position and zoom the image inside the circle first.
        // Resolves null on cancel; the result is always a square PNG.
        const blob = await openAvatarCropper(file);
        if (!blob) return;

        const formData = new FormData();
        formData.append('avatar', blob, 'avatar.png');

        let data = {};
        try {
            const res = await fetch(`${API}/profile/avatar`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            try { data = await res.json(); } catch (_) { /* empty body */ }
            if (!res.ok || data.success === false) {
                throw new Error(data.error || `Upload failed (${res.status})`);
            }
        } catch (err) {
            alert(`Could not upload profile picture: ${err.message}`);
            return;
        }

        if (this.app?.userProfile) {
            this.app.userProfile.avatar = data.avatarUrl || this.app.userProfile.avatar;
            this.app.userProfile.avatarVersion = Date.now();
        }
        this.refreshAvatarImage();
        userController.updateUserProfileUI();
    },

    /** Swap the profile-header image for the freshly uploaded one without
     *  re-rendering the whole shell (which would blank the loaded sections). */
    refreshAvatarImage() {
        const profile = this.app?.userProfile || {};
        if (!profile.email) return;
        const box = document.querySelector('#profileContent .avatar-xl');
        if (!box) return;
        box.querySelector('img')?.remove();
        const img = document.createElement('img');
        img.alt = '';
        img.src = `/applications/wiki/avatars/${encodeURIComponent(profile.email)}?v=${profile.avatarVersion || Date.now()}`;
        img.addEventListener('error', () => img.remove());
        box.appendChild(img);
    },

    // ---- Password ----------------------------------------------------------

    passwordStrength(pw) {
        let score = 0;
        if (pw.length >= 6) score++;
        if (pw.length >= 12) score++;
        if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
        if (/[^a-zA-Z0-9]/.test(pw)) score++;
        return score;
    },

    setStrength(form, score) {
        const bars = form.querySelectorAll('.pf-strength .bar');
        bars.forEach((bar, i) => {
            bar.classList.remove('ok', 'warn');
            if (i < score) bar.classList.add(score >= 3 ? 'ok' : 'warn');
        });
    },

    setPasswordMsg(text, kind) {
        const msg = document.getElementById('pfPasswordMsg');
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'pf-msg' + (kind ? ' ' + kind : '');
    },

    async onPasswordSubmit(e) {
        e.preventDefault();
        const form = e.currentTarget;
        const current = form.current.value;
        const next = form.next.value;
        const confirm = form.confirm.value;

        if (next.length < 6) {
            this.setPasswordMsg('New password must be at least 6 characters.', 'err');
            return;
        }
        if (next !== confirm) {
            this.setPasswordMsg('New password and confirmation do not match.', 'err');
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        this.setPasswordMsg('Updating…', '');
        try {
            const data = await apiSend('/api/auth/change-password', 'POST',
                { currentPassword: current, newPassword: next });
            this.setPasswordMsg(data.message || 'Password changed successfully.', 'ok');
            form.reset();
            this.setStrength(form, 0);
        } catch (err) {
            this.setPasswordMsg(err.message || 'Could not change password.', 'err');
        } finally {
            submitBtn.disabled = false;
        }
    },

    // ---- API tokens --------------------------------------------------------

    /** Load the user's personal access tokens from the core auth service. */
    async loadApiTokens() {
        try {
            const data = await apiSend('/services/authservice/api/profile/tokens', 'GET');
            this.data.tokens = Array.isArray(data.data) ? data.data : [];
        } catch (err) {
            console.error('[Profile] failed to load API tokens:', err);
            this.data.tokens = [];
            const list = document.querySelector('#sec-tokens [data-token-list]');
            if (list) list.innerHTML = `<div class="pf-empty">Could not load tokens.</div>`;
            return;
        }
        this.renderApiTokens();
    },

    renderApiTokens() {
        const section = document.getElementById('sec-tokens');
        if (!section) return;
        const list = section.querySelector('[data-token-list]');
        if (!list) return;
        const tokens = this.data.tokens || [];

        if (!tokens.length) {
            list.innerHTML = `<div class="pf-empty">No API tokens yet. Generate one above to use the API.</div>`;
            this.updateCount('tokens', 0);
            return;
        }

        const now = Date.now();
        list.innerHTML = tokens.map((t) => {
            const expMs = t.expiresAt ? new Date(t.expiresAt).getTime() : null;
            const expired = expMs !== null && expMs < now;
            const expiry = expMs === null
                ? `<span class="pf-token-tag">Never expires</span>`
                : (expired
                    ? `<span class="pf-token-tag danger">Expired ${esc(fmtDate(t.expiresAt))}</span>`
                    : `<span class="pf-token-tag">Expires ${esc(fmtDate(t.expiresAt))}</span>`);
            return `
              <div class="pf-token-item${expired ? ' expired' : ''}">
                <span class="pf-token-ico"><i class="bi bi-key"></i></span>
                <div class="pf-token-meta">
                  <div class="pf-token-name">${esc(t.name || 'Unnamed token')}</div>
                  <div class="pf-token-sub">
                    <code>${esc(t.tokenPrefix || 'dtk_…')}</code>
                    <span>Created ${esc(fmtDate(t.createdAt))}</span>
                    <span>${t.lastUsed ? 'Last used ' + esc(fmtDate(t.lastUsed)) : 'Never used'}</span>
                    ${expiry}
                  </div>
                </div>
                <div class="pf-token-acts">
                  <button class="pf-btn sm" data-token-del data-token-id="${esc(t.id)}"><i class="bi bi-trash"></i> Revoke</button>
                </div>
              </div>`;
        }).join('');

        this.updateCount('tokens', tokens.length);
    },

    async onGenerateToken(e) {
        e.preventDefault();
        const form = e.currentTarget;
        // NB: `form.name` resolves to the form's own name attribute, so read the
        // named controls explicitly rather than through `form.name`.
        const nameInput = form.querySelector('[name="name"]');
        const daysSelect = form.querySelector('[name="expiresInDays"]');
        const name = (nameInput?.value || '').trim();
        const daysVal = daysSelect?.value || '';

        if (!name) { this.setTokenMsg('Please give the token a name.', 'err'); return; }

        const body = { name };
        if (daysVal) body.expiresInDays = Number(daysVal);

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        this.setTokenMsg('Generating…', '');
        try {
            const data = await apiSend('/services/authservice/api/profile/tokens', 'POST', body);
            this.showTokenReveal(data.data || {});
            this.setTokenMsg('Token created. Copy it now.', 'ok');
            form.reset();
            await this.loadApiTokens();
        } catch (err) {
            this.setTokenMsg(err.message || 'Could not create token.', 'err');
        } finally {
            submitBtn.disabled = false;
        }
    },

    /** Reveal a freshly created token once — it cannot be retrieved again. */
    showTokenReveal(tok) {
        const section = document.getElementById('sec-tokens');
        if (!section) return;
        const box = section.querySelector('[data-token-reveal]');
        const valueEl = section.querySelector('[data-token-value]');
        const noteEl = section.querySelector('[data-token-expiry-note]');
        if (!box || !valueEl) return;
        valueEl.value = tok.token || '';
        if (noteEl) {
            noteEl.textContent = tok.expiresAt
                ? `Expires ${new Date(tok.expiresAt).toLocaleString()}.`
                : 'This token never expires.';
        }
        box.style.display = '';
        valueEl.focus();
        valueEl.select();
    },

    hideTokenReveal() {
        const section = document.getElementById('sec-tokens');
        const box = section?.querySelector('[data-token-reveal]');
        const valueEl = section?.querySelector('[data-token-value]');
        if (valueEl) valueEl.value = '';
        if (box) box.style.display = 'none';
    },

    async onCopyToken(btn) {
        const valueEl = document.querySelector('#sec-tokens [data-token-value]');
        if (!valueEl || !valueEl.value) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(valueEl.value);
            } else {
                valueEl.select();
                document.execCommand('copy');
            }
            const original = btn.innerHTML;
            btn.innerHTML = `<i class="bi bi-check2"></i> Copied`;
            setTimeout(() => { btn.innerHTML = original; }, 1500);
        } catch (_) {
            valueEl.select();
            try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        }
    },

    async onDeleteToken(tokenId) {
        if (!tokenId) return;
        if (!confirm('Revoke this token? Any app or script using it will stop working immediately.')) return;
        try {
            await apiSend(`/services/authservice/api/profile/tokens/${encodeURIComponent(tokenId)}`, 'DELETE');
        } catch (err) {
            alert(`Could not revoke token: ${err.message}`);
            return;
        }
        await this.loadApiTokens();
    },

    setTokenMsg(text, kind) {
        const msg = document.getElementById('pfTokenMsg');
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'pf-msg' + (kind ? ' ' + kind : '');
    }
};
