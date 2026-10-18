import { spacesController } from "./modules/spacescontroller.js";
import { navigationController } from "./modules/navigationcontroller.js";
import { documentController } from "./modules/documentcontroller.js";
import { searchController } from "./modules/searchcontroller.js";
import { pinController } from "./modules/pinController.js";
import { notesController } from "./modules/notesController.js";
import { userController } from "./modules/usercontroller.js";
import { settingsController } from "./modules/settingscontroller.js";
import { aiChatController } from "./modules/aichatcontroller.js";
import { notificationController } from "./modules/notificationController.js";
import { onboardingController } from "./modules/onboardingController.js";
import { layoutController } from "./modules/layoutController.js";
import { profileController } from "./modules/profilecontroller.js";
import { helpController } from "./modules/helpController.js";
import { headlineController } from "./modules/headlineController.js";
import { whatsNewController } from "./modules/whatsNewController.js";
import { annotationController } from "./modules/annotationcontroller.js";
import { userContentController } from "./modules/userContentController.js";
import { reviewController } from "./modules/reviewcontroller.js";
import { templatesController } from "./modules/templatescontroller.js";
import { continuousExplorationController } from "./modules/continuousExplorationController.js";
import { continuousExplorationWizard } from "./modules/continuousExplorationWizard.js";
import { visualisationController } from "./modules/visualisationController.js";
import { paneController } from "./modules/paneController.js";
import { linkedDocumentsController } from "./modules/linkedDocumentsController.js";
import { recentChangesController } from "./modules/recentChangesController.js";
import { clientCache } from "./modules/clientCache.js";
import documentOutline from "./modules/documentOutline.js";
import { readViewPref, writeViewPref, VK } from "./modules/viewPrefs.js";
import { parseSearchUrl, normaliseViewMode } from "./shared/search-url.js";

import socketService from "./services/socketService.js";
import {
    createTreeCache,
    spaceHomeCandidates as coreSpaceHomeCandidates
} from "./shared/navigation-core.js";
// Note: documentationController is only used on landing page, not in wiki app

/**
 * Cache-busting URL hook. Visiting any wiki page with `?clearCache=...` wipes the
 * browser-side caches before the app boots, then strips the param from the URL
 * (via replaceState, preserving the path so deep links still work) so reloads and
 * bookmarks don't keep re-clearing.
 *
 *   ?clearCache=tree   (or =1)  → drop the cached space trees in localStorage
 *   ?clearCache=all             → also drop every other `wiki`-prefixed localStorage
 *                                 entry (view prefs, sidebar state, etc.)
 *
 * The server-side caches/search index are cleared separately by the
 * "Maintenance: Rebuild Caches & Search Index" workflow.
 */
function handleClearCacheParam() {
    let mode;
    try {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('clearCache')) return;
        mode = (params.get('clearCache') || 'tree').toLowerCase();
    } catch {
        return;
    }

    // The post-clear URL with the trigger params removed, so neither the in-place
    // strip (mode=tree) nor the reload (mode=all) can re-trigger the clear.
    const cleanUrl = () => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('clearCache');
            url.searchParams.delete('t');
            return url.pathname + url.search + url.hash;
        } catch {
            return window.location.pathname;
        }
    };

    // --- Client-side caches (synchronous) ---
    try {
        const removed = createTreeCache().clear();
        let extra = 0;

        if (mode === 'all' && typeof localStorage !== 'undefined') {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                // Tree keys are already gone; sweep the rest of the wiki keyspace.
                if (k && (k.startsWith('wiki:') || (k.startsWith('wiki') && !k.startsWith('wiki-tree')))) {
                    toRemove.push(k);
                }
            }
            toRemove.forEach((k) => { try { localStorage.removeItem(k); extra++; } catch { /* ignore */ } });
        }

        console.info(`[Wiki] clearCache=${mode}: removed ${removed} tree cache key(s)` +
            (mode === 'all' ? ` + ${extra} other wiki key(s)` : ''));
    } catch (err) {
        console.warn('[Wiki] clearCache failed:', err);
    }

    // --- mode=tree (default): client-only. Strip the param in place and let the
    // app boot with the cleared cache — no server round-trip or reload needed. ---
    if (mode !== 'all') {
        try { window.history.replaceState({}, document.title, cleanUrl()); } catch { /* ignore */ }
        return;
    }

    // --- mode=all: ALSO purge the SERVER-side tree cache, then hard-reload so the
    // app re-fetches freshly-rebuilt trees. This is what makes a bare
    // ?clearCache=all (typed in the address bar) fix *server*-stale trees — e.g.
    // after files change on disk outside the API (symlinks, rebuild workflows).
    // The client clears above only touch this browser; without this the server
    // keeps serving its cached tree. Mirrors window.wikiClearAllCache()'s server
    // call. Native fetch is used because the credentialed wrapper below isn't
    // installed yet at module-load time. ---
    const serverClear = fetch('/applications/wiki/api/admin/clear-tree-cache', {
        method: 'POST',
        credentials: 'include',
    })
        .then((r) => r.json().catch(() => ({})))
        .then((res) => console.info('[Wiki] clearCache=all: server tree cache cleared',
            res && res.message ? `(${res.message})` : ''))
        .catch((err) => console.warn('[Wiki] clearCache=all: server clear failed (continuing):', err));

    // Also drop any Cache Storage (service-worker) entries holding stale assets.
    let swClear = Promise.resolve();
    if ('caches' in window) {
        swClear = caches.keys()
            .then((names) => Promise.all(names.map((n) => caches.delete(n))))
            .catch(() => { /* ignore */ });
    }

    Promise.allSettled([serverClear, swClear]).then(() => {
        // Re-clear the client tree cache in case the booting app re-cached a stale
        // tree during the async window above, then navigate to the param-free URL.
        // location.replace() reloads fresh (no clearCache param → no loop) and
        // replaces history so Back doesn't re-run the clear.
        try { createTreeCache().clear(); } catch { /* ignore */ }
        window.location.replace(cleanUrl());
    });
}

// Run before the app reads any cached tree.
handleClearCacheParam();

/* ==========================================================================
 * Server-driven cache purge (the "cache epoch")
 *
 * `?clearCache=` above is the manual door — someone has to type it. This is the
 * automatic one: the backend publishes a `clientCacheVersion` on /api/config and
 * every browser records the value it last acted on, so an admin bumping the
 * stamp (Profile → System → Client caches) makes all 1500 clients drop their
 * cached navigation trees on their next load. Nobody opens devtools; nobody gets
 * logged out; nobody re-runs the welcome wizard. What is and is not cleared is
 * declared in modules/clientCache.js.
 * ========================================================================== */

/** Message to show the user once the app exists, or null. */
let cachePurgeNotice = null;

/**
 * The /api/config body. index.html starts this fetch in <head> and parks the
 * promise on `window`, so by the time this module evaluates the request is
 * usually already in flight (or done) and the await below costs ~nothing. The
 * direct fetch is the fallback for a host that serves its own shell — the Teams
 * embed — rather than a second request in the normal case.
 */
async function loadClientConfig() {
    if (window.__wikiConfigPromise) return await window.__wikiConfigPromise;
    const res = await fetch('/applications/wiki/api/config', {
        credentials: 'include',
        cache: 'no-store',
    });
    return res.ok ? await res.json() : null;
}

/**
 * Compare the server's epoch against this browser's and purge on a mismatch.
 *
 * Awaited at module scope, which delays the rest of boot — that is the point,
 * since a purge that lands after the tree has been read fixes nothing until the
 * next reload. Bounded by a hard timeout so a slow or dead config endpoint can
 * never stop the app from starting: the wiki working with a stale cache beats
 * the wiki not working at all.
 */
async function syncClientCacheVersion() {
    const CONFIG_TIMEOUT_MS = 2500;
    let config = null;
    try {
        config = await Promise.race([
            loadClientConfig(),
            new Promise((resolve) => setTimeout(() => resolve(null), CONFIG_TIMEOUT_MS)),
        ]);
    } catch (err) {
        console.warn('[Wiki] cache version check failed (continuing):', err);
        return;
    }
    if (!config) return;

    let result;
    try {
        result = clientCache.syncWithServer(config);
    } catch (err) {
        console.warn('[Wiki] cache purge failed (continuing):', err);
        return;
    }

    if (result.reason === 'version-changed') {
        console.info(`[Wiki] cache epoch ${result.from || '(none)'} → ${result.to}: ` +
            `purged ${result.removed.length} cached key(s)`);
        // Only speak up when something was actually removed — an epoch bump that
        // finds nothing cached is invisible housekeeping, not news.
        if (result.purged) {
            cachePurgeNotice = 'The wiki was updated — your cached navigation has been refreshed.';
        }
    }
}

await syncClientCacheVersion();

// Global fetch wrapper to automatically include credentials
const originalFetch = window.fetch;
window.fetch = function(...args) {
    const [resource, config] = args;

    // Only add credentials if it's an API call (not external)
    if (typeof resource === 'string' && (resource.startsWith('/') || resource.includes('localhost'))) {
        const newConfig = {
            ...config,
            credentials: 'include'
        };
        return originalFetch.call(window, resource, newConfig);
    }

    return originalFetch.apply(window, args);
};
console.log('[Wiki] Global fetch wrapper installed - all API calls will include credentials');

/**
 * @fileoverview Updated Wiki Application with new layout
 * Handles the new collapsible sidebar design with folders and files
 * 
 *@author Digital Techonolgies Team
 * @version 2.0.0
 * @since 2025-08-26
 */
class WikiApp {

    constructor() {
        // Capture the URL before any pushState can mutate it. The auto-select in
        // spacesController.renderSpacesList() pushes state synchronously, so reading
        // window.location.pathname later loses the original deep-link path.
        const initialPath = window.location.pathname || '';
        const isDeepLink = initialPath.startsWith('/applications/wiki/') &&
            initialPath !== '/applications/wiki/' &&
            initialPath !== '/applications/wiki';
        this._pendingDeepLinkPath = isDeepLink ? initialPath : null;

        // Search deep link: `?q=…` (plus facets and `?view=`). Captured here for
        // the same reason as the path — searchController writes the URL as soon as
        // results land, so reading location.search later can see its own output
        // rather than what the user pasted. Null when this is not a search URL.
        this._pendingSearch = parseSearchUrl(window.location.search);

        // `?view=` on a NON-search URL selects the list mode for whatever surface
        // the link opens (a folder, Recent, Starred). Held separately because the
        // search path consumes its own copy.
        this._pendingViewMode = this._pendingSearch
            ? null
            : normaliseViewMode(new URLSearchParams(window.location.search).get('view'));

        this.currentView = 'login';
        this.currentSpace = null;
        // Bumped every time a space is selected. Space loading is a long async
        // chain (tree → home → dashboard) and several can be in flight at once —
        // the boot auto-select, a deep link, and a user click all route through
        // selectSpace. Each step carries the token it started with and drops its
        // result once a newer selection exists, so the LAST selection wins
        // instead of whichever request happened to finish last. See
        // beginSpaceSelection / isSpaceCurrent.
        this.spaceGeneration = 0;
        this.currentDocument = null;
        this.currentFolder = null;
        this.isEditing = false;
        this.isPublicMode = false;
        this.data = {
            spaces: [],
            documents: [],
            folders: [],
            recent: [],
            starred: []
        };
        // Load sidebar state from localStorage, or use defaults
        this.sidebarState = {
            shortcuts: localStorage.getItem('sidebarState_shortcuts') !== 'false', // default true
            spaces: localStorage.getItem('sidebarState_spaces') !== 'false',  // default true
            isLeftSidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true' // default false
        };
        // View-mode preferences — hydrated from localStorage so they survive reloads.
        // Home blocks have their own preference, separate from the full Recent/Starred pages.
        this.homeRecentViewMode = readViewPref(VK.homeRecent, 'details');
        this.homeStarredViewMode = readViewPref(VK.homeStarred, 'details');
        this.homeFolderViewMode = readViewPref(VK.homeFolder, 'details');
        this.recentViewMode = readViewPref(VK.pageRecent);
        this.starredViewMode = readViewPref(VK.pageStarred);
        this.searchViewMode = readViewPref(VK.pageSearch);

        // Initialize controllers
        spacesController.init(this);
        navigationController.init(this);
        documentController.init(this);
        searchController.init(this);
        pinController.init(this);
        notesController.init(this);
        userController.init(this);
        settingsController.init(this);
        aiChatController.init(this);
        layoutController.init(this);
        onboardingController.init(this);
        profileController.init(this);
        helpController.init(this);
        headlineController.init(this);
        whatsNewController.init(this);
        annotationController.init(this);
        userContentController.init(this);
        reviewController.init(this);
        templatesController.init(this);
        continuousExplorationController.init(this);
        continuousExplorationWizard.init(this);
        visualisationController.init(this);
        paneController.init(this);
        linkedDocumentsController.init(this);
        recentChangesController.init(this);

        this.init();
    }

    init() {
        userController.checkAuth();
        this.bindEvents();
        this.initMarkdown();
        this.initImageLightbox();
        this.initSidebar();
        this.initSidebarResize();

        // Apply saved sidebar states from localStorage
        this.applySavedSidebarStates();

        // Set navigation controller reference for event bus integration
        socketService.setNavigationController(navigationController);

        // Initialize Socket.IO for real-time updates
        socketService.init();

        // Initialize notification controller
        notificationController.init();
        notificationController.setDocumentController(documentController);
        socketService.setNotificationController(notificationController);

        // Emit user:join event for notification subscriptions after auth
        // This happens after the socket connects (delayed slightly to ensure socket is ready)
        setTimeout(() => {
            this.emitUserJoinForNotifications();
        }, 500);

        // Tell the user their cached navigation was refreshed, if the epoch check
        // at module scope purged anything. Deferred: the purge happens before the
        // app object exists, and a toast thrown at a still-empty page is missed.
        if (cachePurgeNotice) {
            const message = cachePurgeNotice;
            cachePurgeNotice = null;
            setTimeout(() => this.showNotification(message, 'info'), 1500);
        }

        // Deep link: handle browser back/forward. A search URL is restored from
        // the query INSTEAD of the path — the path of a search is just the space
        // root, so handing it to handleDeepLink would drop the user on the space
        // home and lose the results they pressed Back to reach.
        window.addEventListener('popstate', () => {
            const search = parseSearchUrl(window.location.search);
            if (search) {
                searchController.applyUrlState(search)
                    .catch(err => console.warn('[Wiki] search history restore failed:', err));
                return;
            }
            this.handleDeepLink(window.location.pathname);
        });
    }


    /**
     * Check if the current space is read-only
     * @returns {boolean} True if current space has read-only permissions
     */
    isCurrentSpaceReadOnly() {
        if (!this.currentSpace) {
            return false;
        }
        const isReadOnly = this.currentSpace.permissions === 'read-only' || this.currentSpace.type === 'readonly';
        return isReadOnly;
    }

    /**
     * Update UI elements visibility based on current space permissions
     */
    updateUIPermissions() {
        // Public mode users are always read-only
        const isReadOnly = this.isPublicMode || this.isCurrentSpaceReadOnly();

        // Hide/show file action buttons in left sidebar
        const uploadBtn = document.getElementById('uploadBtn');
        const createFolderBtn = document.getElementById('createFolderBtn');
        const createFileBtn = document.getElementById('createFileBtn');

        if (uploadBtn) {
            uploadBtn.style.display = isReadOnly ? 'none' : 'inline-block';
        }
        if (createFolderBtn) {
            createFolderBtn.style.display = isReadOnly ? 'none' : 'inline-block';
        }
        if (createFileBtn) {
            createFileBtn.style.display = isReadOnly ? 'none' : 'inline-block';
        }

        // Disable context menu actions in navigation controller
        if (navigationController && navigationController.setReadOnlyMode) {
            navigationController.setReadOnlyMode(isReadOnly);
        }

        // Disable edit button in document controller
        if (documentController && documentController.setReadOnlyMode) {
            documentController.setReadOnlyMode(isReadOnly);
        }
    }

    bindEvents() {
        // Logout handler — visibility is managed by userController.checkAuth()
        document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            userController.handleLogout();
        });

        // Clicking the logo or "noobly Wiki" name returns to the
        // current space's home — same behaviour as clicking the space in the
        // sidebar. The sidebar toggle button lives inside .kr-brand too, so
        // skip clicks that originate from it.
        const brand = document.querySelector('.kr-topbar .kr-brand');
        if (brand) {
            const logoImg = brand.querySelector('img');
            const nameEl = brand.querySelector('.name');
            if (logoImg) {
                logoImg.style.cursor = 'pointer';
                logoImg.title = 'Go to space home';
            }
            if (nameEl) {
                nameEl.style.cursor = 'pointer';
                nameEl.title = 'Go to space home';
            }
            brand.addEventListener('click', (e) => {
                if (e.target.closest('#toggleSidebarBtn')) return;
                if (!e.target.closest('img, .name')) return;
                if (this.currentSpace?.id != null) {
                    spacesController.selectSpace(this.currentSpace.id);
                }
            });
        }

        // Sidebar collapsible sections
        document.getElementById('shortcutsHeader')?.addEventListener('click', () => {
            this.toggleSidebarSection('shortcuts');
        });


        // Shortcuts navigation
        document.getElementById('shortcutHome')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showHome();
        });

        // Home breadcrumb "Spaces" link — navigate to the spaces listing
        document.getElementById('homeBreadcrumbLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showSpacesView();
        });

        document.getElementById('shortcutRecent')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showRecent();
        });

        document.getElementById('shortcutStarred')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showStarred();
        });

        document.getElementById('shortcutTemplates')?.addEventListener('click', (e) => {
            e.preventDefault();
            templatesController.show();
        });

        // File actions
        document.getElementById('uploadBtn')?.addEventListener('click', () => {
            navigationController.showUploadDialog(null); // null = root directory
        });

        document.getElementById('createFolderBtn')?.addEventListener('click', () => {
            navigationController.showCreateFolderModal(null); // null = root directory
        });

        document.getElementById('createFileBtn')?.addEventListener('click', () => {
            navigationController.showCreateFileModal(null); // null = root directory
        });


        // Create Space button from spaces view
        document.getElementById('createSpaceFromView')?.addEventListener('click', () => {
            spacesController.showSpaceManager();
        });

        // Modal events
        this.bindModalEvents();

        // Global search with suggestions
        searchController.initSearchFunctionality();

        // Refresh recent files button
        document.getElementById('refreshRecentBtn')?.addEventListener('click', async () => {
            await this.loadRecentFiles();
        });

        // Refresh pinned items button
        document.getElementById('refreshPinnedBtn')?.addEventListener('click', () => {
            this.loadPinnedFiles();
        });

        // Home page view mode toggles for Recent and Starred sections.
        // Tracked separately from the full-page Recent/Starred views and persisted to localStorage.
        document.querySelectorAll('.view-mode-switcher[data-target="recentHome"] .view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.homeRecentViewMode = btn.dataset.view;
                writeViewPref(VK.homeRecent, this.homeRecentViewMode);
                btn.closest('.view-mode-switcher').querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadRecentFiles();
            });
        });

        document.querySelectorAll('.view-mode-switcher[data-target="starredHome"] .view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.homeStarredViewMode = btn.dataset.view;
                writeViewPref(VK.homeStarred, this.homeStarredViewMode);
                btn.closest('.view-mode-switcher').querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadStarredFiles();
            });
        });

        document.querySelectorAll('.view-mode-switcher[data-target="homeFolder"] .view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.homeFolderViewMode = btn.dataset.view;
                writeViewPref(VK.homeFolder, this.homeFolderViewMode);
                btn.closest('.view-mode-switcher').querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadHomeFolder();
            });
        });

        // Context menu functionality
        navigationController.initContextMenu();

        // Initialize activity tracking
        userController.ensureActivityData();

    }

    showLoginButton() {
        // Hide logout button for unauthenticated users
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
            logoutBtn.classList.add('hidden');
            logoutBtn.remove();
        }

        // Avoid adding duplicate login buttons
        if (document.getElementById('loginBtn')) return;

        const navDiv = document.querySelector('.navbar-nav');
        if (!navDiv) return;

        const returnUrl = encodeURIComponent(window.location.pathname || '/applications/wiki/');
        const loginBtn = document.createElement('a');
        loginBtn.id = 'loginBtn';
        loginBtn.href = `/services/authservice/views/login.html?returnUrl=${returnUrl}`;
        loginBtn.className = 'btn btn-sm d-flex align-items-center me-3';
        loginBtn.style.cssText = 'color: #fff; border: 1px solid #fff; text-decoration: none;';
        loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>Login';
        navDiv.appendChild(loginBtn);
    }

    bindModalEvents() {
        // Space Manager modal
        document.getElementById('closeSpaceManagerModal')?.addEventListener('click', () => {
            this.hideModal('spaceManagerModal');
        });

        document.getElementById('spaceManagerDoneBtn')?.addEventListener('click', () => {
            this.hideModal('spaceManagerModal');
        });

        document.getElementById('spaceManagerCreateBtn')?.addEventListener('click', () => {
            this.hideModal('spaceManagerModal');
            spacesController.showCreateSpaceModal();
        });

        // Create space modal
        document.getElementById('createSpaceForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            spacesController.handleCreateSpace();
        });

        document.getElementById('closeCreateSpaceModal')?.addEventListener('click', () => {
            this.hideModal('createSpaceModal');
        });

        document.getElementById('cancelCreateSpace')?.addEventListener('click', () => {
            this.hideModal('createSpaceModal');
        });

        document.getElementById('browseSpaceFolder')?.addEventListener('click', () => {
            spacesController.handleBrowseFolder();
        });

        // Create folder modal
        document.getElementById('createFolderForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            navigationController.handleCreateFolder();
        });

        document.getElementById('closeCreateFolderModal')?.addEventListener('click', () => {
            this.hideModal('createFolderModal');
        });

        document.getElementById('cancelCreateFolder')?.addEventListener('click', () => {
            this.hideModal('createFolderModal');
        });

        // Create file modal
        document.getElementById('createFileForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            navigationController.handleCreateFile();
        });

        document.getElementById('closeCreateFileModal')?.addEventListener('click', () => {
            this.hideModal('createFileModal');
        });

        document.getElementById('cancelCreateFile')?.addEventListener('click', () => {
            this.hideModal('createFileModal');
        });

        // Rename modal
        document.getElementById('renameForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            navigationController.handleRename();
        });

        document.getElementById('closeRenameModal')?.addEventListener('click', () => {
            this.hideModal('renameModal');
        });

        document.getElementById('cancelRename')?.addEventListener('click', () => {
            this.hideModal('renameModal');
        });

        // Overlay click to close modals
        document.getElementById('overlay')?.addEventListener('click', () => {
            this.hideAllModals();
        });
    }

    initSidebar() {
        // Set initial collapsed states
        this.updateSidebarSection('shortcuts', this.sidebarState.shortcuts);
        this.updateSidebarSection('spaces', this.sidebarState.spaces);
    }

    initSidebarResize() {
        const sidebar = document.getElementById('leftSidebar');
        const resizeHandle = document.getElementById('sidebarResizeHandle');

        if (!sidebar || !resizeHandle) return;

        const savedWidth = parseInt(localStorage.getItem('sidebarWidth'), 10);
        if (savedWidth) sidebar.style.width = savedWidth + 'px';

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        const startResize = (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(getComputedStyle(sidebar).width, 10);
            resizeHandle.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        };

        const resize = (e) => {
            if (!isResizing) return;

            const width = startWidth + (e.clientX - startX);
            const minWidth = 200;
            const maxWidth = 600;

            if (width >= minWidth && width <= maxWidth) {
                sidebar.style.width = width + 'px';
            }
        };

        const stopResize = () => {
            if (!isResizing) return;

            isResizing = false;
            resizeHandle.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            const currentWidth = parseInt(getComputedStyle(sidebar).width, 10);
            localStorage.setItem('sidebarWidth', currentWidth);
        };

        resizeHandle.addEventListener('mousedown', startResize);
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
    }

    initMarkdown() {
        if (typeof marked !== 'undefined') {
            // Configure marked with custom renderer for task lists
            const renderer = new marked.Renderer();

            // Override listitem rendering to make checkboxes NOT disabled
            const originalListitem = renderer.listitem.bind(renderer);
            renderer.listitem = function(text, task, checked) {
                if (task) {
                    // Remove the disabled attribute that marked adds by default
                    const checkbox = checked
                        ? '<input type="checkbox" checked>'
                        : '<input type="checkbox">';
                    return `<li class="task-list-item">${checkbox} ${text}</li>\n`;
                }
                return originalListitem(text, task, checked);
            };

            marked.setOptions({
                renderer: renderer,
                highlight: function(code, lang) {
                    if (typeof Prism !== 'undefined' && lang && Prism.languages[lang]) {
                        return Prism.highlight(code, Prism.languages[lang], lang);
                    }
                    return code;
                },
                breaks: true,
                gfm: true
            });
        }
    }

    /**
     * Install a singleton fullscreen image lightbox.
     * Uses event delegation on document so it works for any <img> that
     * ends up inside a .md-doc / .markdown-content / .markdown-preview block,
     * regardless of when the HTML is injected. Closes on Escape, overlay
     * click, or the explicit close button. Opt out per-image with
     * data-no-lightbox.
     */
    initImageLightbox() {
        if (window.__krImgLightboxInit) return;
        window.__krImgLightboxInit = true;

        const overlay = document.createElement('div');
        overlay.id = 'kr-img-lightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out;';

        const img = document.createElement('img');
        img.style.cssText = 'max-width:95vw;max-height:95vh;object-fit:contain;box-shadow:0 8px 32px rgba(0,0,0,.5);user-select:none;';
        overlay.appendChild(img);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = 'position:absolute;top:18px;right:24px;background:rgba(0,0,0,.4);color:#fff;border:none;font-size:32px;line-height:1;width:44px;height:44px;border-radius:50%;cursor:pointer;';
        overlay.appendChild(closeBtn);

        document.body.appendChild(overlay);

        // Cursor hint on clickable images.
        const style = document.createElement('style');
        style.textContent = '.md-doc img:not([data-no-lightbox]),.markdown-content img:not([data-no-lightbox]),.markdown-preview img:not([data-no-lightbox]){cursor:zoom-in;}';
        document.head.appendChild(style);

        const open = (src, alt) => {
            img.src = src;
            img.alt = alt || '';
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        };
        const close = () => {
            overlay.style.display = 'none';
            img.src = '';
            document.body.style.overflow = '';
        };

        overlay.addEventListener('click', close);
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display !== 'none') close();
        });

        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || t.tagName !== 'IMG') return;
            if (t.hasAttribute('data-no-lightbox')) return;
            // Match any of the markdown wrappers the wiki uses for rendered content.
            if (!t.closest('.md-doc, .markdown-content, .markdown-preview')) return;
            e.preventDefault();
            open(t.currentSrc || t.src, t.alt);
        });

        // Zoomable content images live inside a `.kr-image .ki-canvas` pan/zoom
        // canvas (markdown-parser.js). That canvas captures the pointer to pan on
        // drag, so the plain click handler above never sees the <img> (the click
        // retargets to the canvas div). Detect a clean tap instead — pointer down
        // and up on the canvas with negligible movement is a click, not a pan —
        // and open the lightbox with the canvas image. A real drag-pan moves past
        // the slop threshold and is ignored. Capture phase so we observe the
        // gesture regardless of the canvas's own pointer capture.
        const TAP_SLOP = 6; // px of movement still counted as a click, not a drag
        let tapStart = null;
        document.addEventListener('pointerdown', (e) => {
            const canvas = e.button === 0 && e.target.closest
                ? e.target.closest('.kr-image .ki-canvas')
                : null;
            tapStart = canvas ? { x: e.clientX, y: e.clientY, canvas } : null;
        }, true);
        document.addEventListener('pointerup', (e) => {
            const start = tapStart;
            tapStart = null;
            if (!start) return;
            if (Math.abs(e.clientX - start.x) > TAP_SLOP || Math.abs(e.clientY - start.y) > TAP_SLOP) return;
            const zoomImg = start.canvas.querySelector('.ki-img');
            if (!zoomImg) return;
            // Honour the same opt-out the plain-image path above honours. It was
            // only checked there, so a ZOOMABLE image could not opt out at all —
            // which matters for one already inside its own dialog (the notes
            // picture viewer), where this would stack a second overlay on top.
            if (zoomImg.hasAttribute('data-no-lightbox')) return;
            open(zoomImg.currentSrc || zoomImg.src, zoomImg.alt);
        }, true);
    }

    /**
     * Apply saved sidebar states from localStorage
     */
    applySavedSidebarStates() {
        // Apply shortcuts section state
        if (!this.sidebarState['shortcuts']) {
            this.updateSidebarSection('shortcuts', false);
        }

        // Apply spaces section state
        if (!this.sidebarState['spaces']) {
            this.updateSidebarSection('spaces', false);
        }

        // Apply left sidebar collapsed state
        if (this.sidebarState['isLeftSidebarCollapsed']) {
            this.collapseSidebar();
        }

        console.log('[Sidebar State] Applied saved states:', this.sidebarState);
    }

    toggleSidebarSection(section) {
        this.sidebarState[section] = !this.sidebarState[section];
        // Save to localStorage
        localStorage.setItem(`sidebarState_${section}`, this.sidebarState[section]);
        this.updateSidebarSection(section, this.sidebarState[section]);
    }

    updateSidebarSection(section, isExpanded) {
        const header = document.getElementById(`${section}Header`);
        const content = document.getElementById(`${section}Content`);

        if (!header || !content) return;

        if (isExpanded) {
            // Expanded state
            header.classList.remove('collapsed');
            content.classList.remove('collapsed');
            content.classList.add('show'); // Bootstrap collapse class
            content.style.maxHeight = 'none'; // Allow natural height when expanded
        } else {
            // Collapsed state
            header.classList.add('collapsed');
            content.classList.add('collapsed');
            content.classList.remove('show'); // Bootstrap collapse class
            content.style.maxHeight = '0px';
        }
    }

    /**
     * Collapse/hide the main left sidebar
     */
    collapseSidebar() {
        const sidebar = document.getElementById('leftSidebar');
        const resizeHandle = document.getElementById('sidebarResizeHandle');
        const filePreviewTooltip = document.getElementById('filePreviewTooltip');
        const toggleBtn = document.getElementById('toggleSidebarBtn');
        if (sidebar) {
            sidebar.classList.add('collapsed');
            if (resizeHandle) {
                resizeHandle.style.display = 'none';
            }
            if (filePreviewTooltip) {
                filePreviewTooltip.style.display = 'none';
            }
            localStorage.setItem('sidebarCollapsed', 'true');
            this.sidebarState['isLeftSidebarCollapsed'] = true;
            if (toggleBtn) {
                toggleBtn.classList.remove('active');
            }
        }
    }

    /**
     * Expand/show the main left sidebar
     */
    expandSidebar() {
        const sidebar = document.getElementById('leftSidebar');
        const resizeHandle = document.getElementById('sidebarResizeHandle');
        const toggleBtn = document.getElementById('toggleSidebarBtn');
        if (sidebar) {
            sidebar.classList.remove('collapsed');
            if (resizeHandle) {
                resizeHandle.style.display = '';
            }
            localStorage.setItem('sidebarCollapsed', 'false');
            this.sidebarState['isLeftSidebarCollapsed'] = false;
            if (toggleBtn) {
                toggleBtn.classList.add('active');
            }
        }
    }

    async loadInitialData() {
        try {
            // Only load user-specific data if authenticated
            if (!this.isPublicMode) {
                // Load user profile first
                try {
                    console.log('%c🔄 Loading user profile...', 'color: blue');
                    await userController.loadUserProfile();
                } catch (error) {
                    console.error('%c❌ Profile load failed:', 'color: red', error);
                }

                // Load user activity (starred and recent)
                try {
                    console.log('%c🔄 Loading user activity...', 'color: blue');
                    await userController.loadUserActivity();
                    // If the Spaces view is already showing, refresh its Quick
                    // Access section now that starred/recent are available.
                    if (this.currentView === 'spaces') this.renderQuickAccess();
                } catch (error) {
                    console.error('%c⚠️ Activity load failed (non-critical):', 'color: orange', error);
                }

                // Folder view preferences are persisted in localStorage (read on demand).

                // Load selected spaces preferences
                try {
                    console.log('%c🔄 Loading selected spaces preferences...', 'color: blue');
                    await spacesController.loadSelectedSpaces();
                } catch (error) {
                    console.error('%c⚠️ Selected spaces preferences failed (non-critical):', 'color: orange', error);
                }

                // Load AI chat data after authentication (non-blocking with timeout)
                if (aiChatController && aiChatController.loadAfterAuth) {
                    console.log('%c🔄 Loading AI chat data (background)...', 'color: blue');
                    // Load in background with 5 second timeout to avoid blocking space loading
                    const aiLoadPromise = Promise.race([
                        aiChatController.loadAfterAuth(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('AI chat load timeout')), 5000))
                    ]);

                    aiLoadPromise.then(() => {
                        console.log('%c✅ AI chat data loaded', 'color: green');
                    }).catch(error => {
                        console.warn('%c⚠️ AI chat load failed or timed out (non-critical):', 'color: orange', error.message);
                    });
                    // Don't await - continue immediately to space loading
                }
            }

            // Load spaces (API filters based on auth status)
            console.log('%c📂 SPACES: Loading spaces...', 'color: blue; font-weight: bold');
            const spacesResponse = await fetch('/applications/wiki/api/spaces', {
                credentials: 'include'
            });
            this.data.spaces = await spacesResponse.json();
            const spacesData = this.data.spaces.data || this.data.spaces;
            const spaceCount = Array.isArray(spacesData) ? spacesData.length : 0;
            console.log(`%c✅ SPACES LOADED: ${spaceCount} space(s) available`, 'color: green; font-weight: bold');
            if (spaceCount > 0) {
                spacesData.forEach(space => {
                    console.log(`   📍 ${space.name} (${space.visibility})`);
                });
            }

            // NOT loaded here: GET /applications/wiki/api/documents.
            //
            // That endpoint returns a flat list of EVERY file in EVERY space,
            // derived live from disk — for this content root roughly 6,000
            // directory listings and 30,000 entries, and it blocked boot behind
            // an `await`. Nothing needed the list: its only readers were two
            // stat counters and `spacesController.loadSpaceContent`, which
            // nothing calls. The counters now come from the space's own file
            // tree (documentCount below), which the nav loads regardless and
            // caches by ETag — so the number is per-space, which is what a
            // space's home screen should have been showing anyway.
            console.log('%c🎨 RENDERING: Rendering spaces list...', 'color: purple; font-weight: bold');
            spacesController.renderSpacesList();

            // renderSpacesList() auto-selects a space (or handleDeepLink does,
            // below) and selectSpace() loads the tree — so the explicit
            // loadFileTree() that used to sit here started a SECOND, identical
            // full tree build while the first was still running. On a large
            // space that is two multi-second walks racing each other on one
            // Node thread, both missing the server cache because neither had
            // finished. Only the no-space case needs handling here: selectSpace
            // sets currentSpace synchronously, before its first await, so this
            // check is reliable.
            if (!this.currentSpace && !this._pendingDeepLinkPath) {
                console.log('%c🌳 RENDERING: No space selected — empty file tree', 'color: purple; font-weight: bold');
                navigationController.renderEmptyFileTree();
            }
            console.log('%c✨ SUCCESS: Initial data loaded successfully!', 'color: green; font-weight: bold');

            // Handle deep-link URL if present. Use the path captured at construction
            // time — window.location.pathname here may already reflect the auto-select
            // pushState from renderSpacesList().
            const hadDeepLink = !!this._pendingDeepLinkPath;
            let deepLinkDone = Promise.resolve();
            if (this._pendingDeepLinkPath) {
                const deepPath = this._pendingDeepLinkPath;
                this._pendingDeepLinkPath = null;
                deepLinkDone = Promise.resolve().then(() => this.handleDeepLink(deepPath));
            }

            // A search deep link runs AFTER the path has been resolved, because
            // performSearch scopes by `currentSpace.id` — starting it earlier
            // would search the wrong space (or every space) and then have the
            // deep link redraw the view underneath it. selectSpace assigns
            // currentSpace synchronously before its first await, so by the time
            // this resolves the space is known even on the auto-select path.
            if (this._pendingSearch) {
                const search = this._pendingSearch;
                this._pendingSearch = null;
                deepLinkDone
                    .then(() => searchController.applyUrlState(search))
                    .catch(err => console.warn('[Wiki] search deep link failed:', err));
            }

            // Show onboarding wizard for new users (gated by localStorage,
            // skipped for public mode). Deferred so it doesn't block initial
            // render; if a deep link is in flight, give it a moment to land first.
            setTimeout(() => {
                try {
                    onboardingController.maybeShow();
                } catch (err) {
                    console.warn('[Onboarding] maybeShow failed:', err);
                }
                // After onboarding: surface the "What's New" modal if an admin has
                // published a message this user hasn't dismissed. whatsNewController
                // no-ops while the onboarding wizard is still on screen, so a
                // brand-new user sees it on their next login instead of stacked.
                try {
                    whatsNewController.maybeShow();
                } catch (err) {
                    console.warn('[WhatsNew] maybeShow failed:', err);
                }
            }, hadDeepLink ? 800 : 250);

        } catch (error) {
            console.error('%c❌ CRITICAL ERROR loading initial data:', 'color: red; font-weight: bold', error);
        }
    }

    /**
     * Re-fetch the space list when the server no longer recognises the space
     * this tab is holding, and swap the fresh record in.
     *
     * WHY THIS EXISTS. `spaces.json` is edited by hand, but `SpaceManager` only
     * re-reads it at boot — so a rename lands the moment the backend restarts,
     * while every open tab keeps the old record. From then on the tab sends a
     * space name the backend cannot resolve, and the failure is invisible:
     * `documents/exists` answers `{exists:false}` for an unknown space exactly
     * as it does for a missing file, so the space home just stops appearing
     * with nothing logged. Matching by ID is what recovers it — the id is
     * stable across a rename, which is the whole reason records elsewhere in
     * this app stopped keying on the display name.
     *
     * @param {Object} space the record this tab is holding
     * @return {Promise<Object|null>} the refreshed record, or null if the space
     *   is unchanged (so the miss was genuine) or could not be re-fetched
     */
    async refreshStaleSpace(space) {
        if (!space || space.id == null) return null;

        try {
            const response = await fetch('/applications/wiki/api/spaces', { credentials: 'include' });
            if (!response.ok) return null;

            const payload = await response.json();
            const list = Array.isArray(payload) ? payload : (payload.data || []);
            const fresh = list.find(s => String(s.id) === String(space.id));

            // Unknown id, or nothing actually changed — the miss was real.
            if (!fresh || fresh.name === space.name) return null;

            console.warn(
                `[Wiki] Space ${space.id} is now "${fresh.name}" (this tab had ` +
                `"${space.name}") — refreshing and retrying.`
            );

            this.data.spaces = payload;
            if (this.currentSpace && String(this.currentSpace.id) === String(space.id)) {
                this.currentSpace = fresh;
            }
            try { spacesController.renderSpacesList(); } catch (_) { /* cosmetic */ }
            return fresh;
        } catch (error) {
            console.warn('[Wiki] Could not refresh a stale space record:', error);
            return null;
        }
    }

    async loadSpaces() {
        try {
            console.log('%c🔄 SPACES: Reloading spaces...', 'color: blue; font-weight: bold');
            // Fetch updated spaces data
            const spacesResponse = await fetch('/applications/wiki/api/spaces', {
                credentials: 'include'
            });
            this.data.spaces = await spacesResponse.json();
            const spacesData = this.data.spaces.data || this.data.spaces;
            const spaceCount = Array.isArray(spacesData) ? spacesData.length : 0;
            console.log(`%c✅ SPACES RELOADED: ${spaceCount} space(s)`, 'color: green; font-weight: bold');
            spacesController.renderSpacesList();

        } catch (error) {
            console.error('%c❌ ERROR LOADING SPACES:', 'color: red; font-weight: bold', error);
        }
    }

    /**
     * Apply a `?view=` from the opening URL to the folder the link points at, and
     * clear it so it only ever affects the folder it was written for — following
     * a link with `?view=grid` and then browsing elsewhere must not silently
     * re-skin every folder you visit afterwards.
     *
     * @param {string} folderPath space-relative folder, '' for the space root
     */
    _consumePendingViewMode(folderPath) {
        if (!this._pendingViewMode) return;
        const mode = this._pendingViewMode;
        this._pendingViewMode = null;
        try {
            const path = folderPath || '';
            navigationController.saveFolderViewPreference(path, mode);
            // The space root is addressed as '' by the home view and as '/' by the
            // public-space file listing, and they key separate preferences. Write
            // both so a root link behaves the same in either kind of space.
            if (!path) navigationController.saveFolderViewPreference('/', mode);
        } catch (err) {
            console.warn('[Wiki] could not apply ?view= to the folder:', err);
        }
    }

    async handleDeepLink(pathname) {
        const BASE = '/applications/wiki/';
        if (!pathname.startsWith(BASE)) return;
        const remainder = pathname.slice(BASE.length);
        if (!remainder) return;

        const segments = remainder.split('/').filter(s => s.length > 0);
        if (segments.length === 0) return;

        const decodedSegments = segments.map(s => decodeURIComponent(s));
        const spaceName = decodedSegments[0];
        const itemPath = decodedSegments.slice(1).join('/');

        // Resolve spaces (API may return array or {data:[...]} wrapper)
        const spacesArray = Array.isArray(this.data.spaces)
            ? this.data.spaces
            : (this.data.spaces.data || []);

        const space = spacesArray.find(
            s => s.name.toLowerCase() === spaceName.toLowerCase()
        );

        if (!space) {
            this.showDeepLinkError(
                '404 - Space Not Found',
                `The space "${spaceName}" does not exist or you do not have access to it.`
            );
            return;
        }

        // Track this invocation so we can detect if the user navigates away
        // mid-flight (e.g. clicks a breadcrumb while we're still awaiting
        // openDocumentByPath / trackDocumentView). A newer URL means a newer
        // navigation has taken over — don't clobber it with replaceState.
        const invocationUrl = pathname;
        this._suppressPushState = true;
        try {
            await spacesController.selectSpace(space.id);

            if (!itemPath) {
                this._consumePendingViewMode('');
                if (window.location.pathname === invocationUrl) {
                    // Preserve the query — replaceState with a bare path would
                    // strip `?view=`/`?sharedBy=` off a link the moment it opened.
                    history.replaceState({ type: 'space', spaceName: space.name }, '',
                        `${BASE}${encodeURIComponent(space.name)}/${window.location.search}`);
                }
                return;
            }

            await this._waitForFileTree();

            const lastSegment = decodedSegments[decodedSegments.length - 1];
            const isFile = lastSegment.includes('.');

            if (isFile) {
                await documentController.openDocumentByPath(itemPath, space.name);
                this._logShareLinkVisit(space.name, itemPath);
            } else {
                // `?view=grid` on a folder link: recorded as this folder's stored
                // preference BEFORE the load, since loadFolderContent reads it via
                // getFolderViewPreference. Writing the preference rather than
                // holding a transient override keeps one source of truth for
                // "what view is this folder in" — the alternative snaps back to
                // the old mode the moment anything re-renders, which reads as the
                // link being ignored. The user can change it back with one click.
                this._consumePendingViewMode(itemPath);
                await navigationController.loadFolderContent(itemPath);
            }

            // If the user navigated elsewhere while the deep-link load was in
            // flight, skip the final highlight/replaceState — they'd just yank
            // the URL back to the deep link. We check both the URL (covers the
            // post-load case once _suppressPushState is off) and the active
            // view (covers the in-flight case where pushState was suppressed).
            const expectedView = isFile ? 'document' : 'folder';
            const userNavigatedAway =
                window.location.pathname !== invocationUrl ||
                (this.currentView && this.currentView !== expectedView);
            if (userNavigatedAway) {
                return;
            }

            await navigationController.expandPathInNav(itemPath);
            history.replaceState(
                { type: isFile ? 'document' : 'folder', spaceName: space.name, path: itemPath },
                '', pathname
            );
        } catch (error) {
            console.error('[DeepLink] Navigation error:', error);
            this.showDeepLinkError(
                '404 - Content Not Found',
                `The path "${itemPath}" could not be found in space "${spaceName}".`
            );
        } finally {
            this._suppressPushState = false;
        }
    }

    _logShareLinkVisit(spaceName, documentPath) {
        const params = new URLSearchParams(window.location.search);
        const sharedBy = params.get('sharedBy');
        fetch('/applications/wiki/api/documents/share-visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ spaceName, path: documentPath, sharedBy })
        }).catch(err => console.warn('[DeepLink] visit log failed:', err));
    }

    async _waitForFileTree(maxWaitMs = 3000) {
        const start = Date.now();
        while (!navigationController.fullFileTree || navigationController.fullFileTree.length === 0) {
            if (Date.now() - start > maxWaitMs) break;
            await new Promise(r => setTimeout(r, 100));
        }
    }

    showDeepLinkError(title, detail) {
        this.setActiveView('deepLinkError');
        this.currentView = 'deepLinkError';
        const titleEl = document.getElementById('deepLinkErrorTitle');
        const detailEl = document.getElementById('deepLinkErrorDetail');
        if (titleEl) titleEl.textContent = title;
        if (detailEl) detailEl.textContent = detail;
    }

    // Modal methods

    populateFolderLocationSelect() {
        const select = document.getElementById('folderLocation');
        if (!select) return;

        // Clear existing options except root
        select.innerHTML = '<option value="">Root</option>';
        
        // Add existing folders as options
        // This would be populated from the current folder tree
    }

    /**
     * Fill the Create File dialog's Location dropdown from the loaded nav tree.
     *
     * Drawn from `fullFileTree` rather than fetched: the tree is LAZY (see
     * navigationController), so this offers the folders already listed and grows
     * as the user browses — which beats forcing a full walk of a content root
     * made of symlinked git repositories just to populate a dropdown.
     *
     * The chosen folder decides which templates the dialog offers (the cascade in
     * populateTemplateChips), so this is not cosmetic — before it was filled, every
     * non-context-menu creation targeted the root and could only ever see the
     * space-wide templates.
     */
    populateFileLocationSelect() {
        const select = document.getElementById('fileLocation');
        if (!select) return;

        const previous = select.value;
        const options = ['<option value="">Root</option>'];
        const tree = navigationController.fullFileTree;

        if (Array.isArray(tree)) {
            const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            const walk = (nodes, depth) => {
                for (const node of nodes) {
                    if (node.type !== 'folder' || !node.path) continue;
                    options.push(
                        `<option value="${esc(node.path)}">${'  '.repeat(depth)}${esc(node.name)}</option>`);
                    if (Array.isArray(node.children)) walk(node.children, depth + 1);
                }
            };
            walk(tree, 1);
        }

        select.innerHTML = options.join('');
        // Default to where the user already is, so "New file" from a folder view
        // lands in that folder and offers that folder's templates.
        const preferred = previous || this.currentFolder || '';
        if (preferred && select.querySelector(`option[value="${CSS.escape(preferred)}"]`)) {
            select.value = preferred;
        }
    }
    

    async handlePublish() {
        if (!this.currentSpace) {
            this.showNotification('Please select a space first', 'warning');
            return;
        }

        try {
            const response = await fetch('/applications/wiki/api/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    spaceId: this.currentSpace.id
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification('Content published successfully!', 'success');
            } else {
                throw new Error(result.message || 'Failed to publish content');
            }
        } catch (error) {
            console.error('Publish error:', error);
            this.showNotification(error.message || 'Failed to publish content', 'error');
        }
    }


    // View methods
    /**
     * @param {number} [token] from beginSpaceSelection(), when this is part of a
     *   space switch. Passed down so a superseded switch stops rendering rather
     *   than racing the newer one into the same DOM.
     */
    async showHome(token = this.spaceGeneration) {
        // Sync the URL to the space root. Without this, clicking "back to
        // space" from a document view leaves the URL on the doc path — and
        // on the next refresh / popstate, handleDeepLink re-opens that doc,
        // making it look like the breadcrumb didn't navigate anywhere.
        if (this.currentSpace && !this._suppressPushState) {
            const newUrl = `/applications/wiki/${encodeURIComponent(this.currentSpace.name)}/`;
            if (window.location.pathname !== newUrl) {
                history.pushState({ type: 'space', spaceName: this.currentSpace.name }, '', newUrl);
            }
        }

        // Check if current space is public
        const isPublicSpace = this.currentSpace &&
                            this.currentSpace.visibility?.toLowerCase() === 'public';

        if (isPublicSpace) {
            // For public spaces, display the root folder (shows home.md + file explorer)
            navigationController.loadFolderContent('/', token);
        } else {
            // For team/private spaces, show the traditional home view
            this.setActiveView('home');
            this.setActiveShortcut('shortcutHome');
            this.currentView = 'home';

            // Reset the drill-down left nav back to the space root so the
            // breadcrumb's space/home segment navigates the nav too. (The
            // public-space branch above already resets it via loadFolderContent.)
            if (navigationController.fullFileTree) {
                navigationController.renderDrillView('');
            }

            // Ensure recent/starred sections are visible (might be hidden from public space view)
            const container = document.getElementById('homeView');
            if (container) {
                const recentCards = container.querySelectorAll('.col-12.col-lg-6');
                const spaceContentSections = container.querySelector('.space-content-sections');

                recentCards.forEach(card => {
                    card.style.display = '';
                });
                if (spaceContentSections) {
                    spaceContentSections.style.display = '';
                }
            }

            // Restore full home view
            this.restoreHomeView();

            // Placeholders FIRST, before any of the awaits below. Every section
            // on this page resolves from a different source at its own pace, so
            // without this the switch leaves the PREVIOUS space's landing page,
            // folders, pins, recents and stars on screen — which reads as this
            // space's content, not as loading. loadHomeContent re-asserts its
            // own; both calls are idempotent.
            this.showHomeContentPlaceholder();
            this.showHomeSectionPlaceholders(this.currentSpace);

            // Load the user's personal dashboard (.system/dashboards/{prefix}.md) if it exists
            await this.loadUserDashboard();
            if (!this.isSpaceCurrent(token)) return;

            // Load the space's landing page — its own configured page first,
            // then .home.md / home.md (see spaceHomeCandidates).
            await this.loadHomeContent(token);
            if (!this.isSpaceCurrent(token)) return;

            // Render the root folder browse list (between home.md and Recent)
            this.loadHomeFolder();

            // Load recent files for the homepage
            await this.loadRecentFiles();
            this.loadStarredFiles();
            this.loadPinnedFiles();
        }
    }

    /**
     * Show the spaces selection view
     */
    async showSpacesView() {
        this.setActiveView('spaces');
        this.currentView = 'spaces';

        // The spaces list is not a piece of content — the panel has nothing to
        // be about, and must not keep offering the last document's notes.
        notesController.clearTarget();

        // Load spaces if not already loaded
        if (!this.data.spaces) {
            await this.loadSpaces();
        } else {
            // Check if spaces array is empty (handle both array and {data: [...]} formats)
            const spacesArray = Array.isArray(this.data.spaces)
                ? this.data.spaces
                : (this.data.spaces?.data || []);
            if (spacesArray.length === 0) {
                await this.loadSpaces();
            }
        }

        // Render space cards
        this.renderSpacesCards();

        // Render the "Quick Access" section (starred + visited, grouped by space)
        this.renderQuickAccess();
    }

    /**
     * Get icon and color for a space based on its visibility/type
     */
    getSpaceIcon(space) {
        const greyColor = '#6c757d';
        // Check visibility first, then type
        const visibility = space.visibility?.toLowerCase() || '';
        const spaceType = space.type?.toLowerCase() || '';

        // Personal spaces - person icon
        if (visibility === 'personal' || spaceType === 'personal') {
            return { icon: 'bi-person-circle', color: greyColor };
        }

        // Team spaces - people icon
        if (visibility === 'team' || spaceType === 'team') {
            return { icon: 'bi-people-fill', color: greyColor };
        }

        // Public/collaboration spaces - book icon
        if (visibility === 'public' || spaceType === 'documentation' || spaceType === 'knowledge') {
            return { icon: 'bi-book', color: greyColor };
        }

        // Default to book icon for unknown types
        return { icon: 'bi-book', color: greyColor };
    }

    /**
     * Render space cards in the spaces grid
     */
    renderSpacesCards() {
        const container = document.getElementById('spacesGrid');
        if (!container) return;

        // Get spaces array (handle both array and {data: [...]} formats)
        const spacesArray = Array.isArray(this.data.spaces)
            ? this.data.spaces
            : (this.data.spaces?.data || []);

        if (!spacesArray || spacesArray.length === 0) {
            container.innerHTML = `
                <div class="kr-empty-tile">
                    <div class="ico"><i class="bi bi-grid-3x3-gap"></i></div>
                    <h4>No spaces available</h4>
                    <p>Create a space to start collecting documents and capabilities.</p>
                </div>
            `;
            return;
        }

        const html = spacesArray.map(space => {
            const spaceId   = space.id || space.name;
            const spaceName = space.name || 'Untitled Space';
            const description = space.description || '';
            const iconInfo  = this.getSpaceIcon(space);

            return `
                <div class="kr-space-card" data-space-id="${spaceId}">
                    <div class="ico" style="color: ${iconInfo.color};">
                        <i class="bi ${iconInfo.icon}"></i>
                    </div>
                    <div class="meta">
                        <div class="name">${spaceName}</div>
                        ${description ? `<div class="desc">${description}</div>` : ''}
                    </div>
                    <i class="bi bi-arrow-right arrow"></i>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Add click handlers to space cards
        container.querySelectorAll('.kr-space-card').forEach(card => {
            card.addEventListener('click', () => {
                const spaceId = card.dataset.spaceId;
                spacesController.selectSpace(spaceId);
            });
        });
    }

    /**
     * Render the "Quick Access" section on the Spaces view: the user's starred
     * and recently-visited documents, grouped by space. Ported from the Teams
     * wiki (SpacesView + ActivityDocumentCard). Reuses the already-loaded
     * this.data.starred / this.data.recent — no extra fetch. Hidden when the
     * user has no activity yet.
     */
    renderQuickAccess() {
        const container = document.getElementById('spacesQuickAccess');
        if (!container) return;

        const starred = Array.isArray(this.data.starred) ? this.data.starred : [];
        const recent  = Array.isArray(this.data.recent)  ? this.data.recent  : [];

        // Combine: every starred doc, then recent docs not already starred.
        const starredPaths = new Set(starred.map(d => d.path));
        const docs = [];
        starred.forEach(d => docs.push({ doc: d, activity: 'starred' }));
        recent.forEach(d => { if (!starredPaths.has(d.path)) docs.push({ doc: d, activity: 'visited' }); });

        // Cap to the most relevant handful (mirrors the Teams 12-item cap).
        const limited = docs.slice(0, 12);

        if (limited.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = '';

        // Group by space, preserving insertion order (starred first).
        const groups = new Map();
        limited.forEach(entry => {
            const space = entry.doc.spaceName || entry.doc.space || 'Other';
            if (!groups.has(space)) groups.set(space, []);
            groups.get(space).push(entry);
        });

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]
        ));

        let html = '<h2 class="kr-qa-heading">Quick Access</h2>';
        groups.forEach((entries, spaceName) => {
            html += '<div class="kr-qa-group">';
            html += `<div class="kr-qa-group-title">${esc(spaceName)}</div>`;
            html += '<div class="kr-qa-list">';
            entries.forEach(({ doc, activity }) => {
                const title = doc.title || doc.name || (doc.path || '').split('/').pop() || 'Document';
                const fileIcon = navigationController.getFileIcon(doc.path || doc.name || '');
                const badge = activity === 'starred'
                    ? '<i class="bi bi-star-fill kr-qa-badge-star" title="Starred"></i>'
                    : '<i class="bi bi-clock-history kr-qa-badge-visit" title="Visited"></i>';
                html += `
                    <div class="kr-qa-item" data-document-path="${esc(doc.path)}" data-space-name="${esc(doc.spaceName || doc.space || '')}" title="${esc(doc.path)}">
                        <div class="kr-qa-icon"><i class="bi ${esc(fileIcon.icon)} ${esc(fileIcon.color)}"></i></div>
                        <div class="kr-qa-info">
                            <div class="kr-qa-name">${esc(title)}</div>
                            <div class="kr-qa-path">${esc(doc.path)}</div>
                        </div>
                        <div class="kr-qa-badge">${badge}</div>
                    </div>`;
            });
            html += '</div></div>';
        });

        container.innerHTML = html;

        // Open the document on click (handles cross-space switching).
        container.querySelectorAll('.kr-qa-item').forEach(item => {
            item.addEventListener('click', () => {
                const path = item.dataset.documentPath;
                const spaceName = item.dataset.spaceName;
                if (path) documentController.openDocumentByPath(path, spaceName);
            });
        });
    }

    /**
     * Render view mode toggle buttons
     * @param {string} currentMode - Current view mode (details|grid|feature|cards)
     * @returns {string} HTML for the view toggle buttons
     */
    renderViewToggle(currentMode) {
        return `
            <div class="kr-seg view-mode-switcher">
                <button class="view-mode-btn ${currentMode === 'details' ? 'active' : ''}" data-view="details" title="List view">
                    <i class="bi bi-list-ul"></i> List
                </button>
                <button class="view-mode-btn ${currentMode === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
                    <i class="bi bi-grid-3x3-gap"></i> Grid
                </button>
                <button class="view-mode-btn ${currentMode === 'feature' ? 'active' : ''}" data-view="feature" title="Feature view — cover image and headline">
                    <i class="bi bi-view-stacked"></i> Feature
                </button>
                <button class="view-mode-btn ${currentMode === 'cards' ? 'active' : ''}" data-view="cards" title="Cards view">
                    <i class="bi bi-card-image"></i> Cards
                </button>
            </div>
        `;
    }

    // Reflect the persisted view mode on the static home-page toggle buttons
    // (their initial `active` class in index.html is hardcoded to 'cards').
    _syncHomeToggleActive(target, viewMode) {
        const switcher = document.querySelector(`.view-mode-switcher[data-target="${target}"]`);
        if (!switcher) return;
        switcher.querySelectorAll('.view-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === viewMode);
        });
    }

    /**
     * Strip markdown syntax from text to produce plain readable text
     * Removes images, links, bold, italic, code blocks, headings, etc.
     */
    stripMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')       // images ![alt](url)
            .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => {   // links [text](url) → text
                const match = m.match(/\[([^\]]*)\]/);
                return match ? match[1] : '';
            })
            .replace(/```[\s\S]*?```/g, '')              // fenced code blocks
            .replace(/`([^`]+)`/g, '$1')                 // inline code
            .replace(/#{1,6}\s+/g, '')                   // headings
            .replace(/(\*\*|__)(.*?)\1/g, '$2')          // bold
            .replace(/(\*|_)(.*?)\1/g, '$2')             // italic
            .replace(/~~(.*?)~~/g, '$1')                 // strikethrough
            .replace(/^\s*[-*+]\s+/gm, '')               // unordered list markers
            .replace(/^\s*\d+\.\s+/gm, '')               // ordered list markers
            .replace(/^\s*>\s+/gm, '')                   // blockquotes
            .replace(/\|/g, ' ')                         // table pipes
            .replace(/---+/g, '')                        // horizontal rules
            .replace(/\n{2,}/g, ' ')                     // multiple newlines → space
            .replace(/\n/g, ' ')                         // single newlines → space
            .replace(/\s{2,}/g, ' ')                     // collapse whitespace
            .trim();
    }

    /**
     * Render file items in the specified view mode
     * @param {Array} files - Array of file objects with path, spaceName, visitedAt/starredAt, excerpt
     * @param {string} viewMode - View mode (details|grid|cards)
     * @param {string} type - 'recent' or 'starred'
     * @returns {string} HTML for the rendered file items
     */
    renderFileItems(files, viewMode, type, options = {}) {
        return navigationController.renderUnifiedFileList(files, viewMode, {
            type,
            colClass:   options.colClass,
            actionType: (type === 'recent' || type === 'starred') ? type : null,
        });
    }

    /**
     * Bind events to file items rendered by renderFileItems (all view modes)
     * @param {HTMLElement} container - The container element holding the rendered items
     */
    bindRenderedFileEvents(container) {
        // Bind file-card items (grid view)
        const fileCards = container.querySelectorAll('.file-card');
        if (fileCards.length > 0) {
            this.bindFileCardEvents(fileCards);
        }

        // Bind file-card-bootstrap items (cards view) and load previews
        const bootstrapCards = container.querySelectorAll('.file-card-bootstrap');
        if (bootstrapCards.length > 0) {
            this.bindFileCardEvents(bootstrapCards);
            // Load card previews (images, markdown, PDF) like the folder view.
            // Scope to this container so we don't sweep up still-loading cards
            // from other (hidden) views.
            // Grid tiles render as cover panels (the Feature view's treatment);
            // `.card-preview-loading` remains for any legacy tile markup.
            if (container.querySelectorAll('[data-cover-pending]').length > 0) {
                navigationController.loadCoverPanels(container);
            }
            if (container.querySelectorAll('.card-preview-loading').length > 0) {
                navigationController.loadCardPreviews(container);
            }
        }

        // Feature cards. Recent/Starred render through this binder rather than
        // navigationController.bindListEvents (which the folder + search views
        // use and which wires this for them), so the click/hover behaviour and
        // the lazy cover+headline fill have to be hooked up here too.
        const featureCards = container.querySelectorAll('.kr-feature-card[data-document-path]');
        if (featureCards.length > 0) {
            this.bindFileCardEvents(featureCards);
        }
        if (container.querySelectorAll('.kr-feature-card[data-feature-pending]').length > 0) {
            navigationController.loadFeatureCards(container);
        }

        // Bind delete recent buttons
        container.querySelectorAll('.delete-recent-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const docPath = btn.dataset.documentPath;
                this.deleteRecentFile(docPath);
            });
            btn.addEventListener('mouseenter', (e) => e.stopPropagation());
        });

        // Bind unstar file buttons
        container.querySelectorAll('.unstar-file-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const docPath = btn.dataset.documentPath;
                this.unstarFile(docPath);
            });
            btn.addEventListener('mouseenter', (e) => e.stopPropagation());
        });

        // Bind file-row items (details view)
        const fileRows = container.querySelectorAll('.file-row');
        if (fileRows.length > 0) {
            navigationController.initFilePreview();
            fileRows.forEach(row => {
                row.addEventListener('click', () => {
                    const documentPath = row.dataset.documentPath;
                    const spaceName = row.dataset.spaceName;
                    documentController.openDocumentByPath(documentPath, spaceName);
                });
                row.addEventListener('mouseenter', () => {
                    const documentPath = row.dataset.documentPath;
                    const spaceName = row.dataset.spaceName;
                    navigationController.previewTimeout = setTimeout(() => {
                        navigationController.currentPreviewCard = row;
                        navigationController.showFilePreview(row, documentPath, spaceName);
                    }, 500);
                });
                row.addEventListener('mouseleave', () => {
                    if (navigationController.previewTimeout) {
                        clearTimeout(navigationController.previewTimeout);
                        navigationController.previewTimeout = null;
                    }
                    navigationController.hideFilePreview();
                });
            });
        }
    }

    showRecent() {
        this.setActiveView('search');
        this.setActiveShortcut('shortcutRecent');
        this.currentView = 'recent';

        const queryElement = document.getElementById('searchQuery');
        const currentSpaceName = this.currentSpace ? this.currentSpace.name : null;

        if (queryElement) {
            const spaceContext = currentSpaceName ? ` - ${currentSpaceName}` : '';
            queryElement.textContent = `Recent Documents${spaceContext}`;
        }

        this.showSearchLoadingPlaceholder();

        setTimeout(() => {
            // Server-scoped to this space already; records carry no space
            // stamp to filter on (see wiki/components/userArtifacts.js).
            const recentFiles = this.data.recent || [];

            const sortedRecentFiles = recentFiles.sort((a, b) => {
                const dateA = new Date(a.visitedAt || 0);
                const dateB = new Date(b.visitedAt || 0);
                return dateB - dateA;
            });

            const container = document.getElementById('searchResults');
            if (!container) return;

            if (sortedRecentFiles.length === 0) {
                const noFilesMessage = currentSpaceName
                    ? `No recent documents in ${currentSpaceName}`
                    : 'No recent documents found';
                const helpText = currentSpaceName
                    ? `Documents you access in ${currentSpaceName} will appear here`
                    : 'Documents you access will appear here';

                container.innerHTML = `
                    <div class="no-content-message">
                        <svg width="48" height="48" class="no-content-icon">
                            <use href="#icon-history"></use>
                        </svg>
                        <p>${noFilesMessage}</p>
                        <p class="text-muted">${helpText}</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h2 class="mb-0">Found ${sortedRecentFiles.length} recent document${sortedRecentFiles.length === 1 ? '' : 's'}</h2>
                    ${this.renderViewToggle(this.recentViewMode)}
                </div>
                <div id="recentViewContent">
                    ${navigationController.renderUnifiedFileList(sortedRecentFiles, this.recentViewMode, { type: 'recent', actionType: 'recent' })}
                </div>
            `;

            navigationController.bindListEvents(container, { type: 'recent', viewMode: this.recentViewMode, actionType: 'recent' });

            // Bind view toggle buttons
            container.querySelectorAll('.view-mode-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.recentViewMode = btn.dataset.view;
                    writeViewPref(VK.pageRecent, this.recentViewMode);
                    this.showRecent();
                });
            });

        }, 0);
    }

    showStarred() {
        this.setActiveView('search');
        this.setActiveShortcut('shortcutStarred');
        this.currentView = 'starred';

        const queryElement = document.getElementById('searchQuery');
        const currentSpaceName = this.currentSpace ? this.currentSpace.name : null;

        if (queryElement) {
            const spaceContext = currentSpaceName ? ` - ${currentSpaceName}` : '';
            queryElement.textContent = `Starred Documents${spaceContext}`;
        }

        this.showSearchLoadingPlaceholder();

        setTimeout(() => {
            // Server-scoped, as above.
            const starredFiles = this.data.starred || [];

            const sortedStarredFiles = starredFiles.sort((a, b) => {
                const dateA = new Date(a.starredAt || 0);
                const dateB = new Date(b.starredAt || 0);
                return dateB - dateA;
            });

            const container = document.getElementById('searchResults');
            if (!container) return;

            if (sortedStarredFiles.length === 0) {
                const noFilesMessage = currentSpaceName
                    ? `No starred documents in ${currentSpaceName}`
                    : 'No starred documents found';
                const helpText = currentSpaceName
                    ? `Documents you star in ${currentSpaceName} will appear here`
                    : 'Star documents to see them here';

                container.innerHTML = `
                    <div class="no-content-message">
                        <svg width="48" height="48" class="no-content-icon">
                            <use href="#icon-star"></use>
                        </svg>
                        <p>${noFilesMessage}</p>
                        <p class="text-muted">${helpText}</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h2 class="mb-0">Found ${sortedStarredFiles.length} starred document${sortedStarredFiles.length === 1 ? '' : 's'}</h2>
                    ${this.renderViewToggle(this.starredViewMode)}
                </div>
                <div id="starredViewContent">
                    ${navigationController.renderUnifiedFileList(sortedStarredFiles, this.starredViewMode, { type: 'starred', actionType: 'starred' })}
                </div>
            `;

            navigationController.bindListEvents(container, { type: 'starred', viewMode: this.starredViewMode, actionType: 'starred' });

            // Bind view toggle buttons
            container.querySelectorAll('.view-mode-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.starredViewMode = btn.dataset.view;
                    writeViewPref(VK.pageStarred, this.starredViewMode);
                    this.showStarred();
                });
            });

        }, 0);
    }

    showRecentOnlyView() {
        // Hide starred section, show only recent
        const starredSection = document.querySelector('.content-sections section:nth-child(2)');
        if (starredSection) starredSection.style.display = 'none';
        this.loadRecentFiles();
    }

    showStarredOnlyView() {
        // Hide recent section, show only starred
        const recentSection = document.querySelector('.content-sections section:nth-child(1)');
        if (recentSection) recentSection.style.display = 'none';
        this.loadStarredFiles();
    }
    
    restoreHomeView() {
        // Show all sections
        const sections = document.querySelectorAll('.content-sections section');
        sections.forEach(section => section.style.display = 'block');

        // Update titles + hero eyebrow with current space information
        const workspaceTitle = document.getElementById('workspaceTitle');
        const workspaceSubtitle = document.getElementById('workspaceSubtitle');
        const eyebrow = document.getElementById('homeHeroEyebrow');
        const breadcrumbLast = document.getElementById('homeBreadcrumbLast');
        if (this.currentSpace) {
            if (workspaceTitle) workspaceTitle.textContent = `Welcome to ${this.currentSpace.name}`;
            if (workspaceSubtitle) workspaceSubtitle.textContent = this.currentSpace.description || 'Your documentation workspace.';
            if (eyebrow) eyebrow.textContent = this.currentSpace.name + ' · Space';
            if (breadcrumbLast) breadcrumbLast.textContent = this.currentSpace.name;
        } else {
            if (workspaceTitle) workspaceTitle.textContent = 'Welcome to the wiki';
            if (workspaceSubtitle) workspaceSubtitle.textContent = 'Your documentation workspace dashboard.';
            if (eyebrow) eyebrow.textContent = 'Default Space';
            if (breadcrumbLast) breadcrumbLast.textContent = 'Home';
        }

        this.updateHomeHeroStats();
    }

    /**
     * How many documents the CURRENT space holds, counted from the file tree
     * the nav already has in memory.
     *
     * This replaced a boot-blocking `GET /api/documents` that walked every
     * space's content root from disk to produce a list nothing read. The tree
     * is loaded per space anyway and served from an ETag cache, so the count is
     * free; it returns null (rendered as "—") until the tree lands, rather than
     * flashing a wrong zero.
     *
     * The tree is now fetched level by level, so this counts what has been
     * LOADED. Rendered with a trailing "+" while any folder is still unlisted,
     * because a bare number that silently grows as you browse reads as a bug.
     *
     * @return {string|null}
     */
    documentCount() {
        const tree = navigationController.fullFileTree;
        if (!Array.isArray(tree)) return null;

        let count = 0;
        const walk = (nodes) => {
            for (const node of nodes) {
                if (node.type === 'folder') {
                    if (Array.isArray(node.children)) walk(node.children);
                } else {
                    count++;
                }
            }
        };
        walk(tree);
        return navigationController.treeIsPartial() ? `${count}+` : String(count);
    }

    updateHomeHeroStats() {
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (val == null ? '—' : String(val));
        };
        const docs    = this.documentCount();
        const recent  = Array.isArray(this.data?.recent)    ? this.data.recent.length    : null;
        const starred = Array.isArray(this.data?.starred)   ? this.data.starred.length   : null;
        const spaces  = (this.data?.spaces?.data?.length) ?? (Array.isArray(this.data?.spaces) ? this.data.spaces.length : null);
        set('statDocs', docs);
        set('statSpaces', spaces);
        set('statRecent', recent);
        set('statStarred', starred);
    }

    setActiveView(viewName) {
        // Leaving the document view while a Blocks/Markdown tab — or a PDF's
        // autosaving Extracted text tab — is open: flush those edits to disk and
        // tear the editor down (best-effort, async).
        if (viewName !== 'document' && viewName !== 'editor') {
            if (typeof documentController.teardownEditorTab === 'function') {
                try { documentController.teardownEditorTab(); } catch (_) { /* best effort */ }
            }
            if (typeof documentController.teardownDerivedTab === 'function') {
                try { documentController.teardownDerivedTab(); } catch (_) { /* best effort */ }
            }
        }

        // Reset the in-page outline on every view switch. For markdown docs,
        // showMarkdownViewer() calls this before renderContentTab(), which
        // rebuilds it; every other view (incl. non-markdown documents) stays
        // cleared.
        try { documentOutline.clear(); } catch (_) { /* best effort */ }

        document.querySelectorAll('.view').forEach(view => {
            view.classList.add('hidden');
        });

        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.remove('hidden');
        }
    }

    setActiveShortcut(shortcutId) {
        document.querySelectorAll('#shortcutsContent .kr-nav-item').forEach(item => {
            item.classList.remove('active');
        });

        const activeShortcut = document.getElementById(shortcutId);
        if (activeShortcut) {
            activeShortcut.classList.add('active');
        }
    }

    // Show loading placeholder in search results view
    showSearchLoadingPlaceholder() {
        const container = document.getElementById('searchResults');
        if (!container) return;

        const placeholders = Array(5).fill(0).map(() => `
            <div class="search-result-item placeholder-glow">
                <div class="search-result-icon">
                    <span class="placeholder col-12" style="width: 20px; height: 20px; display: inline-block;"></span>
                </div>
                <div class="search-result-content" style="flex: 1;">
                    <h3 class="search-result-title">
                        <span class="placeholder col-6"></span>
                    </h3>
                    <p class="search-result-excerpt">
                        <span class="placeholder col-12"></span>
                        <span class="placeholder col-8"></span>
                    </p>
                    <div class="search-result-meta">
                        <span class="placeholder col-3"></span>
                        <span class="placeholder col-4"></span>
                    </div>
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="search-results-header">
                <h2><span class="placeholder col-3"></span></h2>
            </div>
            <div class="search-results-list">
                ${placeholders}
            </div>
        `;
    }

    // Utility methods
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        const overlay = document.getElementById('overlay');

        if (modal && overlay) {
            modal.classList.remove('hidden');
            overlay.classList.remove('hidden');
        } else {
            console.error('Modal or overlay element not found!');
        }
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        const overlay = document.getElementById('overlay');
        
        if (modal && overlay) {
            modal.classList.add('hidden');
            overlay.classList.add('hidden');
            
            // Clean up context menu prefilled paths and show location dropdowns again.
            //
            // The two prefilled paths live on navigationController (which is what
            // sets them, in showCreateFolderModal/showCreateFileModal, and what
            // reads them back in handleCreateFolder/handleCreateFile). These
            // lines used to clear `this.prefilledFolderPath` / `this.prefilledFilePath`
            // — properties of WikiApp that nothing anywhere else touches — so the
            // reset silently landed on the wrong object and the context-menu path
            // survived closing the dialog. It has been masked so far only because
            // both show* methods reset on the way IN as well; a stale path would
            // otherwise send the next create into the last folder right-clicked,
            // which on a curated space answers 404 with no hint that the location
            // was not the one on screen.
            if (modalId === 'createFolderModal') {
                navigationController.prefilledFolderPath = null;
                const folderLocationSelect = document.getElementById('folderLocation');
                const locationGroup = folderLocationSelect?.parentElement;
                if (locationGroup) {
                    locationGroup.style.display = 'block';
                }
            } else if (modalId === 'createFileModal') {
                navigationController.prefilledFilePath = null;
                const fileLocationSelect = document.getElementById('fileLocation');
                const locationGroup = fileLocationSelect?.parentElement;
                if (locationGroup) {
                    locationGroup.style.display = 'block';
                }
            }
        }
    }

    hideAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.add('hidden');
        });
        document.getElementById('overlay')?.classList.add('hidden');
    }

    /**
     * Emit user:join event to Socket.IO to join user-specific notification room
     */
    emitUserJoinForNotifications() {
        try {
            // Get current user email from userController or DOM
            const userEmailElement = document.getElementById('userEmail');
            const userEmail = userEmailElement?.textContent || userEmailElement?.value;

            if (userEmail && socketService.socket) {
                socketService.socket.emit('user:join', userEmail);
                console.log('[Notifications] User joined notification room:', userEmail);
            }
        } catch (error) {
            console.warn('[Notifications] Failed to emit user:join:', error);
        }
    }

    showNotification(message, type = 'info') {
        // Create a simple notification system
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Load home.md content if it exists in the current space
    /**
     * Load and render the logged-in user's personal dashboard.
     *
     * Primary source is the user's activity folder
     * (`.system/useractivity/{email-prefix}/dashboard.md`), served by
     * `GET /applications/wiki/api/user/dashboard`. If no per-user copy exists we
     * fall back to the workflow-generated per-space `.system/dashboards/{prefix}.md`
     * (then the legacy `.dashboards/{prefix}.md`).
     * When neither exists the section stays hidden. Always rendered read-only —
     * no editor wiring.
     */
    async loadUserDashboard() {
        const section = document.getElementById('userDashboardSection');
        const body = document.getElementById('userDashboardBody');
        if (!section || !body) return;

        // Hidden until we confirm a dashboard exists for this user.
        section.classList.add('hidden');

        const render = (markdown) => {
            body.innerHTML = parseMarkdown(markdown);
            section.classList.remove('hidden');
        };

        // 1) Per-user dashboard from the current space's activity folder.
        try {
            const sp = this.currentSpace?.name;
            const dq = sp ? `?space=${encodeURIComponent(sp)}` : '';
            const res = await fetch(`/applications/wiki/api/user/dashboard${dq}`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.exists && data.content) { render(data.content); return; }
            }
        } catch (error) {
            // fall through to the per-space lookup
        }

        // 2) Fallback: workflow-generated per-space dashboard. Prefer the new
        //    `.system/dashboards/{prefix}.md`; fall back to the legacy
        //    `.dashboards/{prefix}.md` (older workflow output) so dashboards keep
        //    working until the generator is updated to the .system/ layout.
        if (!this.currentSpace) return;

        // Resolve the email — userProfile is set by userController; the header
        // #userName element (which shows the email) is a DOM fallback.
        const email = this.userProfile?.email
            || document.getElementById('userName')?.textContent
            || '';
        const prefix = email.split('@')[0].trim().toLowerCase();
        if (!prefix) return;

        // Fetch + render one candidate path. Returns true when a dashboard was
        // found and rendered, so the caller can stop at the first hit.
        const tryRenderDashboard = async (path) => {
            try {
                // Check existence first to avoid 404s in the console.
                const existsResponse = await fetch('/applications/wiki/api/documents/exists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spaceName: this.currentSpace.name, path })
                });
                if (!existsResponse.ok) return false;

                const existsData = await existsResponse.json();
                if (!existsData.exists) return false;

                const contentResponse = await fetch('/applications/wiki/api/documents/content', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spaceName: this.currentSpace.name, path })
                });
                if (!contentResponse.ok) return false;

                const data = await contentResponse.json();
                if (!data.content) return false;

                // Read-only render via the shared markdown parser.
                render(data.content);
                return true;
            } catch (error) {
                // Personal dashboard is optional — fail silently like home.md.
                return false;
            }
        };

        if (await tryRenderDashboard(`.system/dashboards/${prefix}.md`)) return;
        await tryRenderDashboard(`.dashboards/${prefix}.md`);
    }

    /**
     * Claim the current space selection.
     *
     * @returns {number} a token that goes stale the moment another selection starts
     */
    beginSpaceSelection() {
        return ++this.spaceGeneration;
    }

    /**
     * True while `token` is still the newest space selection. Anything that
     * writes a space's content into the DOM after an `await` must check this,
     * or a superseded load paints over the space the user actually chose.
     *
     * @param {number} token from beginSpaceSelection()
     * @returns {boolean}
     */
    isSpaceCurrent(token) {
        return token === this.spaceGeneration;
    }

    /**
     * The candidate landing-page documents for a space's ROOT, most specific
     * first — the space's own configuration (`theme.home`, then `home`) ahead of
     * `.home.md` / `home.md`. The rule itself lives in navigation-core so the
     * Teams wiki resolves identically; see it for why the order is load-bearing.
     *
     * ALWAYS PASS THE SPACE EXPLICITLY when resolving across an `await`. The
     * default reads `this.currentSpace` at call time, so a caller that builds
     * the list and then fetches against whatever `currentSpace` has become can
     * mix two spaces in one resolution — and because these spaces SHARE a
     * content root, a candidate belonging to another space still exists and
     * resolves happily instead of failing. That is how Engineering ended up
     * showing Retail's landing page.
     *
     * @param {Object} [space=this.currentSpace]
     * @return {string[]} space-relative paths, most specific first
     */
    spaceHomeCandidates(space = this.currentSpace) {
        return coreSpaceHomeCandidates(space);
    }

    /**
     * Render the space's landing page into the home view.
     *
     * PINNED TO ONE SPACE for the whole resolution. The space record is captured
     * once and used for both the candidate list and every request; the
     * generation token is re-checked before anything reaches the DOM. Without
     * that, two overlapping selectSpace() chains (boot auto-select + deep link,
     * or a fast second click) interleave: the candidates come from one space and
     * the fetches go to another, and since these spaces share a content root the
     * wrong page EXISTS and renders instead of 404ing. The visible symptom was
     * Engineering's home appearing and then being replaced by Retail's.
     *
     * @param {number} [token] from app.beginSpaceSelection(); defaults to the
     *   current generation for callers not part of a space switch.
     * @param {boolean} [retried] set on the one retry after a stale space
     *   record has been refreshed, so a space that genuinely has no landing
     *   page cannot loop.
     */
    async loadHomeContent(token = this.spaceGeneration, retried = false) {
        const homeContentArea = document.getElementById('homeContentArea');
        const homeContentBody = document.getElementById('homeContentBody');

        if (!homeContentArea || !homeContentBody) return;

        // Only try to load if we have a current space. Captured ONCE — read it
        // again after an await and it may be a different space entirely.
        const space = this.currentSpace;
        if (!space) {
            homeContentArea.classList.add('hidden');
            return;
        }

        // Paint the placeholder FIRST. Resolving a space landing page is two
        // round trips per candidate (exists, then content) and the pages are
        // large, so on a switch the home sat blank — or worse, still showing
        // the previous space's page — for the whole wait. Same
        // `.placeholder-glow` idiom as the nav rail and the document view.
        this.showHomeContentPlaceholder();

        try {
            // The space's own landing page if it names one, then .home.md / home.md
            const filenamesToTry = this.spaceHomeCandidates(space);

            for (const filename of filenamesToTry) {
                if (!this.isSpaceCurrent(token)) return;

                // Check if the file exists to avoid 404 errors in console
                const existsResponse = await fetch('/applications/wiki/api/documents/exists', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        spaceName: space.name,
                        path: filename
                    })
                });

                if (!existsResponse.ok) continue;

                const existsData = await existsResponse.json();

                // If file doesn't exist, try the next filename
                if (!existsData.exists) {
                    continue;
                }

                // File exists, now load the content
                const contentResponse = await fetch('/applications/wiki/api/documents/content', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        spaceName: space.name,
                        path: filename
                    })
                });

                if (!contentResponse.ok) continue;

                const data = await contentResponse.json();

                if (data.content) {
                    // Last check before painting — this is the write a stale
                    // load must never perform.
                    if (!this.isSpaceCurrent(token)) return;

                    // Render markdown content
                    homeContentBody.innerHTML = parseMarkdown(data.content);
                    homeContentArea.classList.remove('hidden');
                    // Notes follow the landing page's own file, so they stay
                    // with it however the space that shows it is named.
                    notesController.setTarget({
                        type: 'document',
                        path: filename,
                        title: space.name,
                        spaceName: space.name
                    });
                    // Hydrate ```pane``` / ```visualisation``` / ```linked-documents```
                    // placeholders so an embedded pane on the space-root home pulls
                    // in its source and a relationship band resolves into cards
                    // (the parser only emits inert placeholders).
                    const homeDoc = { spaceName: space.name, path: filename, content: data.content };
                    paneController.hydrate(homeContentBody, homeDoc);
                    visualisationController.hydrate(homeContentBody, homeDoc);
                    linkedDocumentsController.hydrate(homeContentBody, homeDoc);
                    recentChangesController.hydrate(homeContentBody, homeDoc);
                    return;
                }
            }

            // Nothing resolved. Before writing this off as "this space has no
            // landing page", check the server still KNOWS this space: every
            // document endpoint answers `exists: false` for a space name it
            // cannot resolve, so a renamed space looks exactly like a missing
            // home page. That is not hypothetical — spaces.json is renamed by
            // hand and `SpaceManager` only re-reads it on restart, so any tab
            // open across that restart is holding a name the backend has
            // forgotten, and every home candidate misses. Silently.
            if (!retried) {
                const fresh = await this.refreshStaleSpace(space);
                if (fresh && this.isSpaceCurrent(token)) {
                    return this.loadHomeContent(token, true);
                }
            }

            console.warn(
                `[Wiki] No landing page found for space "${space.name}" — tried:`,
                filenamesToTry
            );

            // Take the placeholder down rather than leaving it pulsing at
            // content that is never coming.
            this.clearHomeContentPlaceholder();
            // Nothing to hang notes off but the space root itself.
            notesController.setTarget({
                type: 'folder',
                path: '',
                title: space.name,
                spaceName: space.name
            });
        } catch (error) {
            // Silently fail - home.md is optional
            // Don't log to avoid cluttering console
            this.clearHomeContentPlaceholder();
        }
    }

    /**
     * Show the space-home loading placeholder, sized like a landing page
     * (heading, a couple of paragraphs, a band) so the view does not lurch when
     * the real markdown replaces it.
     *
     * Uses the same `.placeholder-glow` idiom as the nav rail, the spaces list
     * and the document view — one loading language across the app.
     */
    showHomeContentPlaceholder() {
        const homeContentArea = document.getElementById('homeContentArea');
        const homeContentBody = document.getElementById('homeContentBody');
        if (!homeContentArea || !homeContentBody) return;
        // Idempotent: showHome puts it up and loadHomeContent re-asserts it.
        // Re-writing the markup would restart the glow mid-pulse.
        if (homeContentBody.querySelector('.kr-home-loading')) {
            homeContentArea.classList.remove('hidden');
            return;
        }

        homeContentBody.innerHTML = `
            <div class="placeholder-glow kr-home-loading" role="status" aria-label="Loading space home">
                <div class="placeholder col-6 mb-3" style="height: 24px;"></div>
                <div class="placeholder col-12 mb-2"></div>
                <div class="placeholder col-11 mb-2"></div>
                <div class="placeholder col-9 mb-3"></div>
                <div class="placeholder col-12 mb-3" style="height: 120px;"></div>
                <div class="placeholder col-10 mb-2"></div>
                <div class="placeholder col-7"></div>
            </div>
        `;
        homeContentArea.classList.remove('hidden');
    }

    /**
     * Put the WHOLE app into its loading state for `space`, synchronously.
     *
     * Called at the very top of selectSpace, before the theme flip and before
     * any await, so every placeholder lands in the SAME FRAME as the palette
     * change. Previously the nav skeleton painted with the colour but the home
     * placeholders lived inside showHome(), which is only reached after
     * `await loadFileTree()` — so a click produced three separate visual steps:
     * colour, then (a network round trip later) placeholders, then content.
     *
     * MUST STAY FREE OF `await`. The point is that the browser paints once,
     * with everything already in its loading state; a single await anywhere in
     * here reintroduces the staircase.
     *
     * @param {Object} space the space being switched to
     */
    enterSpaceLoadingState(space) {
        try {
            // FIRST: drop the previous space's tree, because restoreHomeView()
            // below derives the hero's document count from it. Left in place it
            // shows the space you just left, and `null` (not []) makes
            // documentCount() read "unknown" → "—" rather than a confident zero.
            navigationController.fullFileTree = null;

            // The left rail. renderTreeSkeleton is idempotent, so loadFileTree
            // re-asserting it a moment later does not restart the glow.
            navigationController.renderTreeSkeleton(space?.name || '');

            // Show the destination immediately. Switching space always ends on
            // the home view, so staying on the previous document while
            // everything loads behind it is just a longer wait on stale content.
            // (A public space lands on the root folder view instead — leave that
            // path alone rather than flashing home first.)
            const isPublicSpace = (space?.visibility || '').toLowerCase() === 'public';
            if (isPublicSpace) return;

            this.setActiveView('home');
            this.setActiveShortcut('shortcutHome');
            this.currentView = 'home';
            // Names the hero/breadcrumb for the incoming space, so the headings
            // are right from the first frame too.
            this.restoreHomeView();

            this.showHomeContentPlaceholder();
            this.showHomeSectionPlaceholders(space);
        } catch (error) {
            // A placeholder is never worth failing a navigation over.
            console.warn('[App] Could not enter space loading state:', error);
        }
    }

    /**
     * Row-shaped loading placeholder for a home list section.
     *
     * @param {string} containerId
     * @param {number} [rows]
     * @param {string} [label] for screen readers
     */
    showListPlaceholder(containerId, rows = 4, label = 'Loading') {
        const container = document.getElementById(containerId);
        if (!container) return;
        // Idempotent, for the same reason as the others: this is painted once
        // at the click and re-asserted inside showHome.
        if (container.querySelector('.kr-rows-loading')) return;

        const row = `
            <div class="kr-row-loading">
                <span class="placeholder kr-row-loading-ico"></span>
                <span class="placeholder kr-row-loading-text"></span>
                <span class="placeholder kr-row-loading-meta"></span>
            </div>`;
        container.innerHTML = `
            <div class="placeholder-glow kr-rows-loading" role="status" aria-label="${this.escapeAttr(label)}">
                ${row.repeat(rows)}
            </div>`;
    }

    /** Minimal attribute escape for the placeholder labels above. */
    escapeAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Put every home section into its loading state at the START of a space
     * switch.
     *
     * Each of these sections renders from a different source — the folder tree,
     * the pins API, and the recent/starred lists — and each finishes at its own
     * pace. Until they do they were showing the PREVIOUS space's rows, which is
     * worse than showing nothing: they look like this space's content. The
     * Browse heading in particular was left reading "Browse Engineering Space"
     * while the rest of the page had already moved to another space, because
     * the title was only written at the END of loadHomeFolder — and the early
     * return for "tree not ready" never reached it.
     *
     * @param {Object} [space] the space being switched TO; pinned rather than
     *   read from this.currentSpace later, for the same reason as everything
     *   else in the switch path.
     */
    showHomeSectionPlaceholders(space = this.currentSpace) {
        // The heading is the one thing we can be correct about immediately.
        const titleEl = document.getElementById('homeFolderTitle');
        if (titleEl) titleEl.textContent = `Browse ${space?.name || ''}`.trim();

        // Browse hides itself when a space has no content; it is about to be
        // re-evaluated, so make sure it is visible to hold the placeholder.
        const sectionEl = document.getElementById('homeFolderSection');
        if (sectionEl) sectionEl.style.display = '';

        this.showListPlaceholder('homeFolderContent', 5, 'Loading folders');
        this.showListPlaceholder('pinnedFilesContent', 3, 'Loading pinned items');
        this.showListPlaceholder('recentFilesContent', 4, 'Loading recent files');
        this.showListPlaceholder('starredFilesContent', 3, 'Loading starred files');
    }

    /**
     * Remove the placeholder without disturbing real content. Only clears when
     * the placeholder is still what's in the box — a completed render replaced
     * it already, and blanking that would undo the load.
     */
    clearHomeContentPlaceholder() {
        const homeContentArea = document.getElementById('homeContentArea');
        const homeContentBody = document.getElementById('homeContentBody');
        if (!homeContentArea || !homeContentBody) return;
        if (!homeContentBody.querySelector('.kr-home-loading')) return;

        homeContentBody.innerHTML = '';
        homeContentArea.classList.add('hidden');
    }

    async loadRecentFiles() {
        const container = document.getElementById('recentFilesContent');
        if (!container) return;

        try {
            // Already scoped by the server to what THIS space exposes (see
            // wiki/components/userArtifacts.js). Filtering again on a
            // `spaceName` stamp here would drop everything — records no longer
            // carry one, because several spaces are views of one content root
            // and a rename used to orphan the lot.
            const allRecentFiles = this.data.recent || [];
            const recentFiles = allRecentFiles.slice(0, 6);

            if (allRecentFiles.length === 0) {
                const noFilesMessage = 'No recent files found';
                const helpText = 'Files you access will appear here';

                container.innerHTML = `
                    <div class="no-content-message">
                        <svg width="48" height="48" class="no-content-icon">
                            <use href="#icon-history"></use>
                        </svg>
                        <p>${noFilesMessage}</p>
                        <small>${helpText}</small>
                    </div>
                `;
                return;
            }

            container.innerHTML = navigationController.renderUnifiedFileList(recentFiles, this.homeRecentViewMode, { type: 'recent', colClass: 'col-md-6', actionType: 'recent' });
            navigationController.bindListEvents(container, { type: 'recent', viewMode: this.homeRecentViewMode, actionType: 'recent' });
            this._syncHomeToggleActive('recentHome', this.homeRecentViewMode);

        } catch (error) {
            console.error('Error loading recent files:', error);
            container.innerHTML = `
                <div class="error-message">
                    <p>Error loading recent files</p>
                </div>
            `;
        }
    }

    loadStarredFiles() {
        const container = document.getElementById('starredFilesContent');
        if (!container) return;

        try {
            // Server-scoped, like recent above — no client-side space filter.
            const allStarredFiles = this.data.starred || [];
            const starredFiles = allStarredFiles.slice(0, 6);

            if (allStarredFiles.length === 0) {
                const noFilesMessage = 'No starred files found';
                const helpText = 'Star files to see them here';

                container.innerHTML = `
                    <div class="no-content-message">
                        <svg width="48" height="48" class="no-content-icon">
                            <use href="#icon-star"></use>
                        </svg>
                        <p>${noFilesMessage}</p>
                        <small>${helpText}</small>
                    </div>
                `;
                return;
            }

            container.innerHTML = navigationController.renderUnifiedFileList(starredFiles, this.homeStarredViewMode, { type: 'starred', colClass: 'col-md-6', actionType: 'starred' });
            navigationController.bindListEvents(container, { type: 'starred', viewMode: this.homeStarredViewMode, actionType: 'starred' });
            this._syncHomeToggleActive('starredHome', this.homeStarredViewMode);

        } catch (error) {
            console.error('Error loading starred files:', error);
            container.innerHTML = `
                <div class="error-message">
                    <p>Error loading starred files</p>
                </div>
            `;
        }
    }

    /**
     * Render the root folder of the current space as a standard folder list
     * inside the home page. Lets the user browse without using the left nav.
     * Reuses navigationController.renderUnifiedFileList + bindListEvents so
     * the rows look and behave exactly like the regular folder view.
     */
    loadHomeFolder() {
        const container = document.getElementById('homeFolderContent');
        const titleEl = document.getElementById('homeFolderTitle');
        const sectionEl = document.getElementById('homeFolderSection');
        if (!container) return;

        // Name the space FIRST, on every path. This used to be written only at
        // the very end, so the two early returns below left the heading reading
        // "Browse <previous space>" — a confident, wrong label sitting above
        // the new space's folders.
        if (titleEl) titleEl.textContent = `Browse ${this.currentSpace?.name || ''}`.trim();

        const tree = navigationController.fullFileTree;
        if (!Array.isArray(tree) || tree.length === 0) {
            // No tree yet (still loading or empty space) — hide the section
            // rather than showing an empty state above Recent files.
            if (sectionEl) sectionEl.style.display = 'none';
            return;
        }
        if (sectionEl) sectionEl.style.display = '';

        // Mirror the dotfile filter the left tree applies so the home browse
        // doesn't leak hidden system files like .home.md or .aicontext.
        const visible = tree.filter(item => !(item.name && item.name.startsWith('.')));
        // Count of a folder's visible (non-dotfile) children. The render helpers
        // (_renderKrRows/_renderUnifiedGrid/_renderUnifiedCards) display
        // `folder.childCount`; raw tree nodes only carry `children`, so without
        // this the home browse always showed "0 items" (notably for symlinked
        // folders, whose children are resolved server-side but never counted here).
        const countVisibleChildren = (node) => Array.isArray(node.children)
            ? node.children.filter(c => !(c.name && c.name.startsWith('.'))).length
            : 0;
        const folders = visible
            .filter(item => item.type === 'folder')
            .map(folder => ({ ...folder, childCount: countVisibleChildren(folder) }));
        const files   = visible.filter(item => item.type === 'document' || item.type === 'file');

        if (folders.length === 0 && files.length === 0) {
            container.innerHTML = `
                <div class="kr-empty-tile">
                    <div class="ico"><i class="bi bi-folder2-open"></i></div>
                    <h4>This space is empty</h4>
                    <p>Folders and documents you create will show up here.</p>
                </div>`;
            return;
        }

        const folderContent = {
            type: 'folder',
            path: '/',
            title: this.currentSpace?.name || 'Root',
            spaceName: this.currentSpace?.name || 'Spaces',
            folders,
            files
        };

        const viewMode = this.homeFolderViewMode || 'details';
        container.innerHTML = navigationController.renderUnifiedFileList(folderContent, viewMode, {
            type: 'folder',
            // Read-only on the home browse — we don't want accidental drag-rearranges
            // away from the dedicated folder view.
            draggable: false
        });
        navigationController.bindListEvents(container, {
            type: 'folder',
            viewMode
        });
        // bindListEvents already triggers preview loading scoped to `container`;
        // a second unscoped call here re-ran the global sweep (double-fetching
        // every card and starving other views' cards), so it's removed.
        this._syncHomeToggleActive('homeFolder', viewMode);
    }

    /**
     * Load and render the user's pinned folders/documents on the home page.
     * Always pulls a fresh list from the server so the section reflects the
     * latest pin/unpin actions even when the home view is revisited.
     */
    async loadPinnedFiles() {
        const container = document.getElementById('pinnedFilesContent');
        if (!container) return;

        try {
            // loadPins() asks for the current space and the server returns only
            // what that space can see — a real visibility check rather than a
            // name match, so a pin now follows you into every view that exposes
            // its target.
            await pinController.loadPins();
            const pins = pinController.pins || [];

            if (pins.length === 0) {
                container.innerHTML = `
                    <div class="kr-empty-tile">
                        <div class="ico"><i class="bi bi-pin-angle"></i></div>
                        <h4>Nothing pinned yet</h4>
                        <p>Use the Pin button on a folder or document to anchor it here.</p>
                    </div>`;
                return;
            }

            // Sort newest pin first.
            const sorted = [...pins].sort((a, b) =>
                new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime()
            );

            // Build a simple list — we own click handling per-row so the same
            // row works for both folder and document targets without funneling
            // through renderUnifiedFileList's file-only assumptions.
            const escape = (s) => String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

            const rows = sorted.map((p, i) => {
                const isFolder = p.type === 'folder';
                const icon = isFolder ? 'bi-folder' : 'bi-file-earmark-text';
                const iconColor = isFolder ? 'var(--kr-teal-600)' : 'var(--kr-ink-500)';
                return `
                    <div class="kr-file-row pinned-row" data-pin-index="${i}" style="cursor:pointer;">
                        <div class="ftype" style="background: var(--kr-teal-50); color: ${iconColor};">
                            <i class="bi ${icon}"></i>
                        </div>
                        <div>
                            <div class="fname">${escape(p.title || p.path.split('/').pop())}</div>
                            <div class="fpath">${escape(p.spaceName)} / ${escape(p.path)}</div>
                        </div>
                        <span></span>
                        <span class="ftime">${p.pinnedAt ? new Date(p.pinnedAt).toLocaleDateString() : ''}</span>
                        <button class="frow-act unpin-btn" data-pin-index="${i}" title="Unpin">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>`;
            }).join('');

            container.innerHTML = `<div class="kr-file-rows">${rows}</div>`;

            container.querySelectorAll('.pinned-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.unpin-btn')) return;
                    const idx = parseInt(row.dataset.pinIndex, 10);
                    pinController.openPinned(sorted[idx]);
                });
            });
            container.querySelectorAll('.unpin-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.pinIndex, 10);
                    await pinController.togglePin(sorted[idx]);
                    this.loadPinnedFiles();
                });
            });
        } catch (error) {
            console.error('Error loading pinned files:', error);
            container.innerHTML = `<div class="error-message"><p>Error loading pinned items</p></div>`;
        }
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    /**
     * Bind click and preview events to file cards
     */
    bindFileCardEvents(fileCards) {
        // Initialize preview tooltip if not already done
        navigationController.initFilePreview();

        fileCards.forEach(card => {
            // Click event to open document
            card.addEventListener('click', () => {
                const documentPath = card.dataset.documentPath;
                const spaceName = card.dataset.spaceName;
                documentController.openDocumentByPath(documentPath, spaceName);
            });

            // Preview on hover
            card.addEventListener('mouseenter', () => {
                const documentPath = card.dataset.documentPath;
                const spaceName = card.dataset.spaceName;

                // Add small delay before showing preview
                navigationController.previewTimeout = setTimeout(() => {
                    navigationController.currentPreviewCard = card;
                    navigationController.showFilePreview(card, documentPath, spaceName);
                }, 500); // 500ms delay
            });

            card.addEventListener('mouseleave', () => {
                // Clear timeout if mouse leaves before preview shows
                if (navigationController.previewTimeout) {
                    clearTimeout(navigationController.previewTimeout);
                    navigationController.previewTimeout = null;
                }

                // Hide preview
                navigationController.hideFilePreview();
            });
        });
    }

    /**
     * Bind click and preview events to search result items
     */
    bindSearchResultEvents(resultItems) {
        // Initialize preview tooltip if not already done
        navigationController.initFilePreview();

        resultItems.forEach(item => {
            const { path, spaceName } = item.dataset;

            // Click event
            item.addEventListener('click', () => {
                documentController.exitEditorMode();
                documentController.openDocumentByPath(path, spaceName);
            });

            // Preview on hover
            item.addEventListener('mouseenter', () => {
                navigationController.previewTimeout = setTimeout(() => {
                    navigationController.currentPreviewCard = item;
                    navigationController.showFilePreview(item, path, spaceName);
                }, 500);
            });

            item.addEventListener('mouseleave', () => {
                if (navigationController.previewTimeout) {
                    clearTimeout(navigationController.previewTimeout);
                    navigationController.previewTimeout = null;
                }
                navigationController.hideFilePreview();
            });
        });
    }

    /**
     * Get the current contextual path based on the selected folder
     * Returns the folder path if a folder is selected, otherwise returns '' (root)
     */
    getCurrentContextPath() {
        // Check if we're viewing a folder in the content area
        if (this.currentView === 'folder' && this.currentFolder) {
            return this.currentFolder;
        }

        // Check if a folder is selected in the left navigation
        const selectedFolder = document.querySelector('.nav-folder-item.selected');
        if (selectedFolder) {
            return selectedFolder.dataset.folderPath || '';
        }

        // Default to root
        return '';
    }

    /**
     * Context-aware Create Folder handler
     */
    handleContextualCreateFolder() {
        const contextPath = this.getCurrentContextPath();
        navigationController.showCreateFolderModal(contextPath);
    }

    /**
     * Context-aware Create File handler
     */
    handleContextualCreateFile() {
        const contextPath = this.getCurrentContextPath();
        navigationController.showCreateFileModal(contextPath);
    }

    /**
     * Context-aware Upload handler
     */
    handleContextualUpload() {
        const contextPath = this.getCurrentContextPath();
        navigationController.showUploadDialog(contextPath);
    }

    /**
     * Delete a file from recent activity
     */
    async deleteRecentFile(documentPath) {
        try {
            if (!this.data.recent) this.data.recent = [];
            const index = this.data.recent.findIndex(file => file.path === documentPath);

            if (index !== -1) {
                const removed = this.data.recent[index];
                this.data.recent.splice(index, 1);
                // Persist via the per-user activity API
                await fetch('/applications/wiki/api/user/visit', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: removed.path, spaceName: removed.spaceName })
                });
                // Refresh the recent view
                if (this.currentView === 'recent') {
                    this.showRecent();
                }
                // Also refresh home page recent files
                this.loadRecentFiles();
                this.showNotification('Removed from recent files', 'success');
            }
        } catch (error) {
            console.error('Error deleting recent file:', error);
            this.showNotification('Failed to remove from recent', 'error');
        }
    }

    /**
     * Unstar a file
     */
    async unstarFile(documentPath) {
        try {
            if (!this.data.starred) this.data.starred = [];
            const index = this.data.starred.findIndex(file => file.path === documentPath);

            if (index !== -1) {
                const removed = this.data.starred[index];
                this.data.starred.splice(index, 1);
                // Persist via the per-user activity API
                await fetch('/applications/wiki/api/user/star', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: removed.path,
                        spaceName: removed.spaceName,
                        title: removed.title,
                        action: 'unstar'
                    })
                });
                // Refresh the starred view
                if (this.currentView === 'starred') {
                    this.showStarred();
                }
                // Also refresh the home/space view if visible
                this.loadStarredFiles();
                this.showNotification('File unstarred', 'success');
            }
        } catch (error) {
            console.error('Error unstarring file:', error);
            this.showNotification('Failed to unstar file', 'error');
        }
    }

}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.wikiApp = new WikiApp();
});
