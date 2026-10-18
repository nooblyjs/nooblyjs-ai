import { documentController } from "./documentcontroller.js";
import documentOutline from "./documentOutline.js";
import folderViewerState from "./folderViewerState.js";
import navigationState from "./navigationState.js";
import { WikiAPI } from "./apiClient.js";
import { readViewPref, writeViewPref, VK } from "./viewPrefs.js";
import { pinController } from "./pinController.js";
import { notesController } from "./notesController.js";
import { paneController } from "./paneController.js";
import { visualisationController } from "./visualisationController.js";
import { linkedDocumentsController } from "./linkedDocumentsController.js";
import { recentChangesController } from "./recentChangesController.js";
// Shared, DOM-free navigation logic (single source of truth, also used by the
// Teams wiki). The render*/bind* methods below stay DOM-specific.
import {
    findNodeInTree as coreFindNodeInTree,
    normalizeDrillPath as coreNormalizeDrillPath,
    isVisibleNode as coreIsVisibleNode,
    getDrillChildren as coreGetDrillChildren,
    sortVisibleChildren as coreSortVisibleChildren,
    resolveDrill as coreResolveDrill,
    buildBreadcrumbSegments as coreBuildBreadcrumbSegments,
    createTreeCache as coreCreateTreeCache,
} from "../shared/navigation-core.js";

export const navigationController = {
    app: null,
    fullFileTree: null,
    contextMenuTargetPath: null,
    contextMenuTargetType: null,
    contextMenuTargetSpaceName: null,
    uploadTargetPath: null,
    prefilledFolderPath: null,
    prefilledFilePath: null,
    renameItemPath: null,
    renameItemType: null,
    isReadOnlyMode: false,
    currentViewMode: 'grid', // 'grid', 'details', 'cards' - default/fallback view mode
    lastGlobalViewMode: 'grid', // Tracks the last globally used view mode

    // Drill-down left nav: the folder whose children are currently listed.
    // '' = space root. The parent of this folder shows as a back/breadcrumb
    // row above the list; clicking a child folder drills one level deeper.
    drillPath: '',

    // When true, the left-nav tree hides folders with no real content (only
    // hidden dotfiles such as .home.md / .settings don't count as content).
    // Persisted in localStorage under HIDE_EMPTY_KEY via the checkbox below
    // the tree; loaded once in init().
    hideEmptyFolders: false,

    // When true, a run of folders that each hold nothing but one subfolder is
    // drawn as ONE row ("Commercial Services › Technology") standing for the
    // deepest folder in the run. Display only — every segment keeps its real
    // path and stays clickable, so nothing becomes unreachable. Persisted in
    // localStorage under COLLAPSE_CHAINS_KEY; loaded once in init().
    collapseChains: true,

    // Phase 8: Drag-drop UI state
    dragOverFolder: null,
    dragExpandTimeout: null,
    dragExpandDelay: 800, // ms before auto-expanding folder on hover

    async init(app) {
        this.app = app;
        // Preferences load after authentication during initial data fetch
        this.initHideEmptyToggle();
        this.initCollapseChainsToggle();
    },

    /** localStorage key for the "collapse single-folder chains" tree preference. */
    COLLAPSE_CHAINS_KEY: 'wiki:nav:collapseChains',

    /**
     * Restore the "collapse single-folder chains" preference, reflect it on the
     * checkbox below the tree, and re-render on toggle.
     *
     * Defaults to ON (note the `!== 'false'` read, the inverse of the
     * hide-empty toggle above): compression is the behaviour we want people to
     * meet, and the escape hatch is the checkbox rather than a default that
     * nobody discovers. A storage failure also lands on ON so the nav looks the
     * same in private mode.
     */
    initCollapseChainsToggle() {
        try {
            this.collapseChains = localStorage.getItem(this.COLLAPSE_CHAINS_KEY) !== 'false';
        } catch (_) {
            this.collapseChains = true;
        }

        const checkbox = document.getElementById('collapseChainsToggle');
        if (!checkbox) return;
        checkbox.checked = this.collapseChains;
        checkbox.addEventListener('change', () => {
            this.collapseChains = checkbox.checked;
            try {
                localStorage.setItem(this.COLLAPSE_CHAINS_KEY, String(this.collapseChains));
            } catch (_) { /* non-fatal */ }
            this.refreshDrillView();
        });
    },

    /** localStorage key for the "hide empty folders" tree preference. */
    HIDE_EMPTY_KEY: 'wiki:nav:hideEmptyFolders',

    /**
     * Restore the "hide empty folders" preference from localStorage, reflect it
     * on the checkbox below the tree, and re-render the drill view whenever the
     * user toggles it. Safe to call before the tree has loaded.
     */
    initHideEmptyToggle() {
        try {
            this.hideEmptyFolders = localStorage.getItem(this.HIDE_EMPTY_KEY) === 'true';
        } catch (_) {
            this.hideEmptyFolders = false; // private mode / quota — default to showing all
        }

        const checkbox = document.getElementById('hideEmptyFoldersToggle');
        if (!checkbox) return;
        checkbox.checked = this.hideEmptyFolders;
        checkbox.addEventListener('change', () => {
            this.hideEmptyFolders = checkbox.checked;
            try {
                localStorage.setItem(this.HIDE_EMPTY_KEY, String(this.hideEmptyFolders));
            } catch (_) { /* non-fatal */ }
            this.refreshDrillView();
        });
    },

    /**
     * True when a folder contains real content: at least one visible (non-dot)
     * document anywhere in its subtree, or a visible subfolder that itself has
     * content. Hidden dotfiles (.home.md, .settings, …) never count as content,
     * so a folder holding only those reads as empty. Used by the "hide empty
     * folders" toggle to decide which folder rows to drop.
     */
    _folderHasContent(node) {
        if (!node) return false;
        // Not listed yet (lazy tree) — assume content rather than hiding a
        // folder the user could never then open to prove otherwise.
        if (node.truncated) return true;
        if (!node.children) return false;
        for (const child of node.children) {
            if (!coreIsVisibleNode(child)) continue;
            if (child.type === 'document') return true;
            if (child.type === 'folder' && this._folderHasContent(child)) return true;
        }
        return false;
    },

    /**
     * Find a node in the fullFileTree by path
     * @private
     */
    _findNodeInTree(nodes, targetPath) {
        return coreFindNodeInTree(nodes, targetPath);
    },

    /**
     * Recursively update child paths when a parent is renamed/moved
     * @private
     */
    _updateChildPaths(children, oldBasePath, newBasePath) {
        if (!children) return;
        for (const child of children) {
            if (child.path && child.path.startsWith(oldBasePath + '/')) {
                child.path = newBasePath + child.path.substring(oldBasePath.length);
            }
            if (child.children) {
                this._updateChildPaths(child.children, oldBasePath, newBasePath);
            }
        }
    },

    /**
     * Get the preferred view mode for a specific folder, scoped to the current space.
     * Persisted in localStorage under wiki:view:folder:<spaceId>:<path>.
     * Also covers folders with a `.home.md` (the "pathed homepage" view) since the
     * file listing under the home content uses this same preference.
     * @param {string} folderPath - The folder path (empty string for root)
     * @returns {string|null} - The preferred view mode or null if no preference set
     */
    getFolderViewPreference(folderPath) {
        if (!this.app.currentSpace) return null;
        const spaceId = this.app.currentSpace.id;
        return readViewPref(VK.folder(spaceId, folderPath || ''), null);
    },

    /**
     * Wire the folder-view "Subscribe" button to the notifications API, which
     * natively supports folder subscriptions (`type: 'folder'`). Reflects the
     * current subscription state on load and toggles it on click, mirroring the
     * document toolbar's Subscribe button but scoped to the whole folder subtree.
     * @param {string} spaceName
     * @param {string} folderPath
     */
    async wireFolderSubscribeButton(spaceName, folderPath) {
        const btn = document.getElementById('subscribeFolderBtn');
        if (!btn) return;
        if (!spaceName || !folderPath || folderPath === '/') {
            btn.style.display = 'none';
            return;
        }

        const setState = (subscribed) => {
            btn.dataset.subscribed = subscribed ? 'true' : 'false';
            const icon = subscribed ? 'bi-bell-fill' : 'bi-bell';
            const text = subscribed ? 'Subscribed' : 'Subscribe';
            btn.innerHTML = `<i class="bi ${icon}"></i> <span class="subscribe-text">${text}</span>`;
            btn.classList.toggle('active', subscribed);
        };

        // Reflect the current subscription state.
        try {
            const qs = `?space=${encodeURIComponent(spaceName)}`;
            const res = await fetch(`/applications/wiki/api/notifications/subscriptions${qs}`);
            if (res.ok) {
                const result = await res.json();
                const subs = result.data || [];
                setState(subs.some(s => s.type === 'folder' && s.path === folderPath));
            } else {
                setState(false);
            }
        } catch (_) {
            setState(false);
        }

        btn.onclick = async (e) => {
            e.preventDefault();
            const subscribed = btn.dataset.subscribed === 'true';
            try {
                const res = await fetch('/applications/wiki/api/notifications/subscriptions', {
                    method: subscribed ? 'DELETE' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'folder', path: folderPath, spaceName }),
                });
                if (!res.ok) {
                    this.app.showNotification('Failed to update folder subscription', 'error');
                    return;
                }
                setState(!subscribed);
                this.app.showNotification(
                    subscribed ? 'Unsubscribed from folder changes' : 'Subscribed to folder changes',
                    'success'
                );
            } catch (err) {
                console.error('[FolderSubscribe] toggle failed:', err);
                this.app.showNotification('Failed to update folder subscription', 'error');
            }
        };
    },

    /**
     * Save the view mode preference for a specific folder to localStorage.
     * @param {string} folderPath - The folder path (empty string for root)
     * @param {string} viewMode - The view mode to save
     */
    saveFolderViewPreference(folderPath, viewMode) {
        if (!this.app.currentSpace) return;
        const spaceId = this.app.currentSpace.id;
        writeViewPref(VK.folder(spaceId, folderPath || ''), viewMode);
    },

    /**
     * Set read-only mode for navigation
     * @param {boolean} isReadOnly - Whether navigation should be in read-only mode
     */
    setReadOnlyMode(isReadOnly) {
        this.isReadOnlyMode = isReadOnly;
    },

    // File Tree Methods
    async loadFileTree() {
        if (!this.app.currentSpace) {
            console.log('[NavigationController] No space selected, rendering empty tree');
            this.renderEmptyFileTree();
            return;
        }

        // A fresh tree load means a (re)entry into a space — always start the
        // drill-down nav at the space root.
        this.drillPath = '';

        const spaceId = this.app.currentSpace.id;
        const spaceName = this.app.currentSpace.name;

        // 1) Render cached tree immediately (if any) so the UI feels instant.
        const cached = this.readCachedTree(spaceId);
        console.log(`[NavigationController] Cache lookup for space ${spaceId}:`, {
            hasCached: !!cached,
            isArray: cached ? Array.isArray(cached.tree) : false,
            treeLength: cached?.tree?.length || 0,
            etag: cached?.etag || 'none'
        });

        if (cached && Array.isArray(cached.tree) && cached.tree.length > 0) {
            console.log(`[NavigationController] Rendering cached tree for space ${spaceId} (${cached.tree.length} root items)`);
            // Cached in the LEAN shape it arrived in, so it needs the same
            // hydration as a fresh response.
            this.renderFileTree(this.rehydrateTree(cached.tree, spaceName));
            // Usable content is on screen; a thin progress line is honest about
            // the revalidation without throwing it away.
            this.setTreeRefreshing(true);
        } else {
            console.warn(`[NavigationController] No valid cached tree for space ${spaceId}, will wait for server response`);
            // Nothing to show for THIS space — so show that we are working on
            // it. Leaving the previous space's tree in the rail is worse than
            // blank: it looks like the click failed, and the folders belong to
            // a space the user just left.
            this.renderTreeSkeleton(spaceName);
        }

        // 2) Validate against the server with If-None-Match.
        //
        // Timed in four segments — server, download+parse, rehydrate, render —
        // because "the tree is slow" has had a different answer at each of them
        // and guessing which one costs a round of code reading. Logged as one
        // line per load; `performance.now()` is a no-op cost next to the work
        // being measured.
        const t = { start: performance.now() };
        try {
            const headers = {};
            if (cached && cached.etag) headers['If-None-Match'] = cached.etag;

            let response = await fetch(
                `/applications/wiki/api/spaces/${spaceId}/folder-tree?depth=${this.TREE_DEPTH}`,
                { method: 'GET', credentials: 'include', headers }
            );
            t.headers = performance.now();

            // 304 → cached tree is current; nothing to do.
            if (response.status === 304) {
                console.log(`[NavigationController] Cached tree is up-to-date (304) for space ${spaceId}`);

                // Failsafe: If cached tree hasn't been rendered yet, render it now
                if (!this.fullFileTree || this.fullFileTree.length === 0) {
                    console.warn(`[NavigationController] 304 response but fullFileTree not rendered, rendering cached tree now`);
                    const cachedData = this.readCachedTree(spaceId);
                    if (cachedData && Array.isArray(cachedData.tree) && cachedData.tree.length > 0) {
                        this.renderFileTree(cachedData.tree);
                    }
                }

                console.log(`[NavigationController] fullFileTree set to:`, {
                    isSet: !!this.fullFileTree,
                    isArray: Array.isArray(this.fullFileTree),
                    length: this.fullFileTree?.length || 0
                });
                return;
            }

            let tree = [];

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    tree = data.tree || [];
                    t.parsed = performance.now();
                    const newEtag = response.headers.get('ETag');
                    // Cache the LEAN tree — it is a third of the size, which is
                    // the difference between fitting the localStorage quota and
                    // not. Hydrate afterwards, for use.
                    this.writeCachedTree(spaceId, tree, newEtag);
                    t.cached = performance.now();
                    tree = this.rehydrateTree(tree, spaceName);
                    t.hydrated = performance.now();
                    console.log('[NavigationController] File tree loaded via filing service:', {
                        itemCount: tree.length,
                        folders: tree.filter(t => t.type === 'folder').length,
                        files: tree.filter(t => t.type === 'document').length,
                        etag: newEtag
                    });
                } else {
                    console.warn('[NavigationController] Filing endpoint returned error:', data.error);
                    response = await fetch(`/applications/wiki/api/spaces/${spaceId}/folders`, {
                        credentials: 'include'
                    });
                    tree = await response.json();
                }
            } else {
                console.warn(`[NavigationController] Filing endpoint failed with status ${response.status}`);
                response = await fetch(`/applications/wiki/api/spaces/${spaceId}/folders`, {
                    credentials: 'include'
                });
                tree = await response.json();
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: API endpoint not available`);
            }

            // A space switch during the fetch makes this the WRONG tree. Drop
            // it rather than painting the previous space's folders into the
            // nav — the newer selection has its own load in flight.
            if (this.app.currentSpace?.id !== spaceId) {
                console.log(`[NavigationController] Space changed while loading tree for ${spaceId}; discarding`);
                return;
            }

            console.log('[NavigationController] Rendering file tree with', tree.length, 'items');
            this.renderFileTree(tree);
            t.rendered = performance.now();

            const ms = (from, to) => (to == null || from == null ? '—' : `${Math.round(to - from)}ms`);
            console.log(
                `%c[NavigationController] tree timing — total ${ms(t.start, t.rendered)}`
                + ` | server+download ${ms(t.start, t.parsed ?? t.headers)}`
                + ` (headers at ${ms(t.start, t.headers)})`
                + ` | cache write ${ms(t.parsed, t.cached)}`
                + ` | rehydrate ${ms(t.cached, t.hydrated)}`
                + ` | render ${ms(t.hydrated ?? t.parsed, t.rendered)}`,
                'color: #12284B; font-weight: bold'
            );

        } catch (error) {
            console.error('[NavigationController] Error loading file tree:', error);
            // If we already rendered from cache, leave it; otherwise show empty state.
            if (!cached || !Array.isArray(cached.tree) || cached.tree.length === 0) {
                this.renderEmptyFileTree();
            }
        } finally {
            // Every exit — success, 304, fallback, discard-on-space-change and
            // error — has to clear this, or the rail keeps announcing work that
            // finished. Hence `finally` rather than a call per branch.
            this.setTreeRefreshing(false);
        }
    },

    // ===================== Lazy tree loading =====================
    //
    // The folder tree is fetched LEVEL BY LEVEL, not all at once. The server
    // walks `TREE_DEPTH` levels and flags anything below the cut `truncated`;
    // this controller fills those in as the user navigates into them. The full
    // walk used to run on every space open, and on a content root of symlinked
    // repositories it grew past the point where the request would finish at all.
    //
    // Two levels is the minimum that works, because the root drill view paints
    // top-level folders AND their children (see resolveDrill's `twoLevel`), and
    // the folder overview needs a child count for each child folder — which is
    // one level below the folder being shown.
    //
    // The invariant every reader depends on: `truncated: true` means NOT LISTED
    // YET, which is not the same as empty. Anything deciding "this folder has no
    // children" has to check it — _folderHasContent, _effectiveFolderStatus,
    // _homeOnlyDocument and navigation-core's hasVisibleChildren all do.

    /** Levels the server walks per request. Keep >= 2 (see above). */
    TREE_DEPTH: 2,

    /** path -> in-flight fetch, so concurrent callers share one request. */
    _subtreeLoads: new Map(),

    /**
     * Dim the nav row whose folder is being fetched, so a click that has to wait
     * for the network doesn't read as a click that did nothing. Deliberately
     * only after a short delay — a fast subtree lands well inside it and a
     * flicker would be worse than no feedback at all.
     *
     * @param {string} folderPath
     * @returns {function(): void} call to clear the state
     * @private
     */
    _markRowBusy(folderPath) {
        if (!folderPath || typeof document === 'undefined') return () => {};
        let row = null;
        const timer = setTimeout(() => {
            row = document.querySelector(
                `.kr-drill-row[data-folder-path="${CSS.escape(folderPath)}"]`
            );
            if (row) row.classList.add('is-loading');
        }, 150);
        return () => {
            clearTimeout(timer);
            if (row) row.classList.remove('is-loading');
        };
    },

    /**
     * Fetch one folder's subtree and graft it into `fullFileTree`.
     *
     * @param {string} folderPath space-relative folder ('' = space root)
     * @returns {Promise<boolean>} true when the tree changed
     * @private
     */
    async _loadSubtree(folderPath) {
        const spaceId = this.app?.currentSpace?.id;
        if (spaceId == null) return false;

        const key = `${spaceId}:${folderPath}`;
        if (this._subtreeLoads.has(key)) return this._subtreeLoads.get(key);

        const spaceName = this.app?.currentSpace?.name || '';
        const load = (async () => {
            const query = new URLSearchParams({ depth: String(this.TREE_DEPTH) });
            if (folderPath) query.set('path', folderPath);
            const url = `/applications/wiki/api/spaces/${spaceId}/folder-tree?${query}`;

            const busy = this._markRowBusy(folderPath);
            let data;
            try {
                const response = await fetch(url, { credentials: 'include' });
                if (!response.ok) {
                    console.warn(`[NavigationController] Subtree fetch for "${folderPath}" failed: HTTP ${response.status}`);
                    return false;
                }
                data = await response.json();
            } catch (error) {
                console.warn(`[NavigationController] Subtree fetch for "${folderPath}" failed:`, error);
                return false;
            } finally {
                busy();
            }
            if (!data || !data.success) return false;

            // The space may have changed while this was in flight — grafting the
            // old space's folders into the new space's tree would corrupt it.
            if (this.app?.currentSpace?.id !== spaceId) return false;

            const children = this.rehydrateTree(data.tree || [], spaceName, folderPath);
            if (!folderPath) {
                this.fullFileTree = children;
                return true;
            }

            const node = this._findNodeInTree(this.fullFileTree || [], folderPath);
            if (!node) return false;
            node.children = children;
            delete node.truncated;
            return true;
        })().finally(() => this._subtreeLoads.delete(key));

        this._subtreeLoads.set(key, load);
        return load;
    },

    /**
     * Make sure every folder along `path` has been listed, so the node at the
     * end of it can be found in `fullFileTree`.
     *
     * Walks the path root-first and loads each level that is still truncated.
     * Because a load brings back TREE_DEPTH levels, this is roughly one request
     * per two path segments, and none at all once a branch has been visited.
     *
     * @param {string} path folder or document path, space-relative
     */
    async ensurePathLoaded(path) {
        const normalized = this._normalizeDrillPath(path || '');
        if (!normalized || !Array.isArray(this.fullFileTree)) return;

        const segments = normalized.split('/').filter(Boolean);
        let prefix = '';
        for (const segment of segments) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            const node = this._findNodeInTree(this.fullFileTree, prefix);
            // Missing means the parent listing genuinely doesn't contain it (a
            // deleted or mistyped path); a document is the end of the walk.
            if (!node || node.type !== 'folder') return;
            if (node.truncated) {
                const loaded = await this._loadSubtree(prefix);
                if (!loaded) return;
            }
        }
    },

    /**
     * Make sure a folder is ready to be DISPLAYED — its own children plus one
     * level below them, which is what the folder overview needs to show a child
     * count against each subfolder.
     *
     * @param {string} folderPath '' or '/' for the space root
     */
    async ensureFolderLoaded(folderPath) {
        const normalized = this._normalizeDrillPath(
            folderPath === '/' ? '' : (folderPath || '')
        );
        await this.ensurePathLoaded(normalized);

        const children = normalized
            ? (this._findNodeInTree(this.fullFileTree || [], normalized) || {}).children
            : this.fullFileTree;
        if (!Array.isArray(children)) return;

        // Grandchildren missing → re-fetch rooted here, which returns both
        // levels in one request rather than one per child folder.
        const needsGrandchildren = children.some(
            child => child.type === 'folder' && child.truncated
        );
        if (needsGrandchildren) await this._loadSubtree(normalized);
    },

    /** True when any folder in the loaded tree is still unlisted. */
    treeIsPartial(nodes = this.fullFileTree) {
        if (!Array.isArray(nodes)) return false;
        for (const node of nodes) {
            if (node.type !== 'folder') continue;
            if (node.truncated) return true;
            if (this.treeIsPartial(node.children)) return true;
        }
        return false;
    },

    /**
     * Per-space tree cache (localStorage + LRU eviction). The implementation
     * lives in the shared navigation-core module; these methods are thin
     * delegators kept for the existing call sites. Defaults match the historical
     * keys (`wiki-tree-<id>` / `wiki-tree-index`, cap 5) so existing caches load.
     *
     * Only the ROOT-depth tree is written here — lazily loaded subtrees are not,
     * so the cached entry keeps matching the ETag the server issued for it. A
     * reload therefore starts shallow again and re-fetches branches as they're
     * visited, which is cheap and always correct.
     */
    _treeCache: coreCreateTreeCache(),

    readCachedTree(spaceId) {
        return this._treeCache.read(spaceId);
    },

    writeCachedTree(spaceId, tree, etag) {
        this._treeCache.write(spaceId, tree, etag);
    },

    invalidateCachedTree(spaceId) {
        this._treeCache.invalidate(spaceId);
    },

    /** Remove all cached space trees from localStorage. @returns {number} keys removed */
    clearCachedTrees() {
        return this._treeCache.clear();
    },

    /**
     * Put back the fields the folder-tree response leaves out.
     *
     * The server sends a LEAN tree (filingRoutes.leanTree): no `path` — it is
     * implied by the nesting — and no `title`/`fileName`/`spaceName`, which are
     * copies of `name` or constant for the whole response. On a large space that
     * is a 17 MB response reduced to 6 MB; rebuilding it here costs one pass
     * (~40ms for 42k nodes). Every consumer downstream still sees the full node
     * shape, so nothing else had to change.
     *
     * MUST stay in step with leanTree() on the server: a field dropped there and
     * not restored here is simply undefined everywhere it is read.
     *
     * Mutates in place and returns the same array — the tree is freshly parsed
     * from JSON, so there is nothing to share it with.
     *
     * @param {Array} nodes
     * @param {string} spaceName
     * @param {string} [prefix] parent path ('' at the space root)
     * @returns {Array} the same nodes, hydrated
     */
    rehydrateTree(nodes, spaceName, prefix = '') {
        if (!Array.isArray(nodes)) return [];
        for (const node of nodes) {
            node.path = prefix ? `${prefix}/${node.name}` : node.name;
            if (node.status === undefined) node.status = null;
            if (node.type === 'folder') {
                this.rehydrateTree(node.children || (node.children = []), spaceName, node.path);
            } else {
                node.title = node.name;
                node.fileName = node.name;
                node.spaceName = spaceName;
            }
        }
        return nodes;
    },

    renderFileTree(tree) {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) {
            console.warn('[NavigationController] fileTree DOM element not found!');
            return;
        }

        console.log('[NavigationController] renderFileTree called with:', {
            itemCount: tree.length,
            treeArray: Array.isArray(tree),
            firstItem: tree[0]
        });

        if (!tree || tree.length === 0) {
            console.log('[NavigationController] Tree is empty, showing empty state');
            // Clear the stored tree too. Leaving the previous space's tree in
            // place made everything that reads it — the drill view, the folder
            // lookups, the home document count — answer for the space the user
            // just left.
            this.fullFileTree = [];
            this.app?.updateHomeHeroStats?.();
            this.renderEmptyFileTree();
            return;
        }

        // Store the full tree data for later use
        this.fullFileTree = tree;
        console.log('[NavigationController] Stored full tree with', tree.length, 'items');

        // The home hero's document count is derived from this tree (see
        // app.documentCount), so refresh it now that the tree has landed —
        // loadFileTree is fired without an await during boot.
        this.app?.updateHomeHeroStats?.();

        // Populate window.documents array for wiki-code access
        this.populateWindowDocuments(tree);

        // Render the drill-down nav at the current level (root after a fresh
        // load). renderDrillView falls back to root if drillPath no longer
        // exists in the new tree (e.g. the folder was deleted/renamed).
        this.renderDrillView(this.drillPath || '');
    },

    /**
     * Expand only the first level of folders (direct children of the space).
     * Their children are shown but remain collapsed until clicked.
     */
    expandInitialLevels(tree) {
        if (!Array.isArray(tree) || tree.length === 0) return;

        const expand = (folderPath) => {
            const folderId = `folder-${folderPath.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const folderItem = document.querySelector(`[data-folder-id="${folderId}"]`);
            const folderChildren = document.querySelector(`[data-folder-children="${folderId}"]`);
            if (!folderItem || !folderChildren) return;
            if (folderItem.classList.contains('expanded')) return;

            folderItem.classList.add('expanded');
            folderChildren.classList.add('expanded');
            const chevron = folderItem.querySelector('.chevron-icon');
            if (chevron) chevron.className = 'bi bi-chevron-down chevron-icon';
        };

        const isVisibleFolder = (n) => n.type === 'folder' && !n.name.startsWith('.');

        // Only expand top-level folders. Their children are shown but remain collapsed.
        for (const top of tree) {
            if (!isVisibleFolder(top)) continue;
            expand(top.path);
        }

        // Re-apply any folders the user had expanded prior to this render so a
        // tree refresh (e.g. after a folder-order change) doesn't collapse them.
        if (navigationState.expandedFolders && navigationState.expandedFolders.size > 0) {
            navigationState.expandedFolders.forEach(folderId => {
                const item = document.querySelector(`[data-folder-id="${folderId}"]`);
                if (item && item.dataset.folderPath) expand(item.dataset.folderPath);
            });
        }
    },

    renderEmptyFileTree() {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        fileTree.innerHTML = `
            <div class="empty-tree">
                <div class="empty-message">
                    ${this.app.currentSpace ? 'No files or folders' : 'Select a space to view files'}
                </div>
            </div>
        `;
    },

    /**
     * The file tree's loading placeholder — the SAME `.placeholder-glow` block
     * index.html ships for the first paint, so a space switch and a cold load
     * look identical.
     *
     * Kept byte-identical to the static copy in index.html on purpose; the two
     * are asserted equal by tests/backend/components/loadingIndicators.test.js.
     * The static one has to exist for the paint before any JS runs, and this one
     * for every load after that, so neither can simply be deleted.
     */
    TREE_PLACEHOLDER_ROWS:
        '<div class="placeholder col-10 mb-2"></div>' +
        '<div class="placeholder col-8 mb-2 ms-3"></div>' +
        '<div class="placeholder col-9 mb-2 ms-3"></div>' +
        '<div class="placeholder col-7 mb-2"></div>' +
        '<div class="placeholder col-11 mb-2 ms-3"></div>',

    /**
     * Show that placeholder while a space's tree is being fetched.
     *
     * Shown whenever there is nothing cached to paint — switching to a space
     * for the first time used to leave the PREVIOUS space's folders sitting in
     * the rail until the new tree landed, which reads as "the click did
     * nothing" and, worse, as the wrong space's content.
     *
     * @param {string} [spaceName] named in the header line while loading
     */
    renderTreeSkeleton(spaceName = this.app?.currentSpace?.name || '') {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        // Idempotent: app.enterSpaceLoadingState paints this at the instant of
        // the click and loadFileTree re-asserts it a moment later. Rewriting
        // the markup would restart the glow mid-pulse, which looks like a
        // second, separate loading state.
        const existing = fileTree.querySelector('.kr-tree-loading');
        if (existing && existing.dataset.space === spaceName) return;

        // On a SWITCH (unlike the cold first paint) which space is arriving is
        // the useful part, so the bars get a header line naming it.
        fileTree.innerHTML = `
            <div class="kr-tree-loading" role="status" aria-live="polite" data-space="${this.escapeHtml(spaceName)}">
                <div class="kr-tree-loading-head">
                    <span class="kr-spinner" aria-hidden="true"></span>
                    <span class="kr-tree-loading-text">${
                        spaceName ? `Loading ${this.escapeHtml(spaceName)}…` : 'Loading…'
                    }</span>
                </div>
                <div class="placeholder-glow" aria-hidden="true">${this.TREE_PLACEHOLDER_ROWS}</div>
            </div>
        `;
    },

    /**
     * Mark the nav as revalidating on top of an already-rendered (cached) tree.
     * A thin progress line rather than a skeleton — the content on screen is
     * usable and probably correct, so replacing it would be a downgrade.
     * @param {boolean} busy
     */
    setTreeRefreshing(busy) {
        const section = document.getElementById('fileTree')?.closest('.kr-side-section')
            || document.getElementById('fileTree')?.parentElement;
        if (section) section.classList.toggle('is-tree-refreshing', !!busy);
    },

    // ===================== Drill-down navigation =====================
    // The left nav shows one folder level at a time, iOS-style: the current
    // folder is a header, its direct children are listed below, and the parent
    // collapses into a back row above. Clicking a child folder drills one level
    // deeper; clicking the back row pops one level up. This replaces the old
    // fully-expanding tree so deep hierarchies stay readable in a narrow rail.

    /** Strip leading/trailing slashes; '' and '/' both mean the space root. */
    _normalizeDrillPath(path) {
        return coreNormalizeDrillPath(path);
    },

    /** True when a node is shown in the nav (folders + documents, no dotfiles). */
    _isVisibleNode(node) {
        return coreIsVisibleNode(node);
    },

    /**
     * Resolve the children to list for a given drill path.
     * Returns { children, exists }. At root, children are the tree's top level.
     */
    _getDrillChildren(normalizedPath) {
        return coreGetDrillChildren(this.fullFileTree, normalizedPath);
    },

    /**
     * Render the drill-down nav at the given folder path. Falls back to the
     * space root if the path no longer exists in the current tree. All the
     * level/ordering decisions (two-level root, drill-in, ancestor fallback)
     * come from the shared core resolveDrill() — this method only builds markup.
     */
    renderDrillView(path = '') {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        const spaceName = this.app?.currentSpace?.name || 'Space';
        const view = coreResolveDrill(this.fullFileTree, spaceName, path, {
            collapseChains: this.collapseChains,
        });
        this.drillPath = view.drillPath;

        const backRow = view.parentLabel !== null ? `
            <div class="kr-drill-back" data-parent-path="${this.escapeHtml(view.parentPath)}" title="Back to ${this.escapeHtml(view.parentLabel)}">
                <i class="bi bi-chevron-left"></i>
                <span class="kr-drill-back-text">${this.escapeHtml(view.parentLabel)}</span>
            </div>
        ` : '';

        // The header is the folder you're currently in. Clicking it loads that
        // folder's overview in the central view — same as clicking the matching
        // segment in the top breadcrumb. Root maps to '/' for loadFolderContent.
        const headerLoadPath = view.headerIsRoot ? '/' : view.drillPath;
        const headerRow = `
            <div class="kr-drill-head kr-drill-head-clickable" data-folder-path="${this.escapeHtml(headerLoadPath)}" role="button" tabindex="0" title="Open ${this.escapeHtml(view.headerLabel)}">
                <i class="bi ${view.headerIsRoot ? 'bi-hdd-stack' : 'bi-folder-fill'} kr-drill-head-icon"></i>
                <span class="kr-drill-head-text">${this.escapeHtml(view.headerLabel)}</span>
            </div>
        `;

        // When the "hide empty folders" toggle is on, drop folder rows whose
        // subtree has no real content (only hidden dotfiles). File rows are
        // always content, so they're kept. This also removes the expanded
        // level-1 children that the root view inlines under an empty group.
        const visibleRows = this.hideEmptyFolders
            ? view.rows.filter(row => row.kind !== 'folder' || this._folderHasContent(row.node))
            : view.rows;

        let rows = '';
        for (const row of visibleRows) {
            rows += row.kind === 'folder'
                ? this._renderDrillFolderRow(row.node, row.level, row.isGroup, row.chain)
                : this._renderDrillFileRow(row.node, row.level);
        }
        if (!rows) rows = `<div class="kr-drill-empty">This folder is empty</div>`;

        fileTree.innerHTML = `
            <div class="kr-drill">
                <div class="kr-drill-pinned">
                    ${backRow}
                    ${headerRow}
                </div>
                <div class="kr-drill-list">${rows}</div>
            </div>
        `;

        this.bindDrillEvents();
    },

    /** Split a node's children into visible folders + files, each sorted A→Z. */
    _sortVisibleChildren(children) {
        return coreSortVisibleChildren(children);
    },

    /**
     * Render a folder row.
     * @param {Object} node   The folder node.
     * @param {number} level  Indent level (0 = group header, 1 = nested child).
     * @param {boolean} isGroup  True for the expanded level-0 group header (no
     *   drill chevron, since its children are already shown inline). Nested
     *   level-1 folders get a "›" when they have children to drill into.
     */
    /**
     * The status colour to render for a folder. An explicit assignment (from the
     * right-click submenu, stored server-side) always wins. Otherwise an *empty*
     * folder — one with no children other than hidden dot-entries (.settings,
     * .home.md, …) — defaults to "light", so empty folders read as muted. Returns
     * null when the folder has visible content and no explicit status.
     * @param {Object} node - A folder tree node.
     * @returns {string|null}
     */
    _effectiveFolderStatus(node) {
        if (!node) return null;
        if (node.status) return node.status;
        // Unlisted folder: no basis for the "empty → muted" default yet.
        if (node.truncated) return null;
        const children = node.children || [];
        const hasVisibleChild = children.some(c => c && c.name && !c.name.startsWith('.'));
        if (hasVisibleChild) return null;
        // A folder whose only content is a hidden home page (.home.md) still has
        // a landing page to show, so render it as active rather than muted.
        const hasHome = children.some(c => c && c.name && /^\.?home\.md$/i.test(c.name));
        if (hasHome) return null;
        return 'light';
    },

    /**
     * @param {Array<{label:string,path:string}>|null} chain  When set, this row
     *   stands for a collapsed run of single-child folders and `node` is the
     *   run's DEEPEST folder. The label renders as `A › B`, each segment
     *   separately clickable so the skipped rungs keep a way in from the nav as
     *   well as from the top breadcrumb.
     */
    _renderDrillFolderRow(node, level = 0, isGroup = false, chain = null) {
        const folderId = `folder-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
        // `truncated` = not listed yet, so assume drillable (see TREE_DEPTH).
        const hasVisibleChildren = node.truncated
            || (node.children || []).some(c => this._isVisibleNode(c));
        const safeName = this.escapeHtml(node.name);
        const groupClass = isGroup ? ' kr-drill-group' : '';
        const status = this._effectiveFolderStatus(node);
        const ftypeClass = status ? ` kr-ftype-${status}` : '';
        const indent = 8 + (level * 16);
        // Home-only folders open their home page on click rather than drilling
        // in, so they don't get a drill chevron even if home.md is "visible".
        const isHomeOnly = !!this._homeOnlyDocument(node);
        const chevron = (!isGroup && hasVisibleChildren && !isHomeOnly)
            ? '<i class="bi bi-chevron-right kr-drill-into"></i>' : '';

        const isChain = Array.isArray(chain) && chain.length > 1;
        // Segments carry no whitespace between them — the gap is a CSS margin
        // on the separator, so it can't be collapsed away or wrapped on.
        const label = isChain
            ? chain.map((seg, i) => {
                const last = i === chain.length - 1;
                const sep = i === 0 ? '' : '<span class="kr-chain-sep" aria-hidden="true">›</span>';
                return `${sep}<span class="kr-chain-seg${last ? ' kr-chain-seg-last' : ''}" data-chain-path="${this.escapeHtml(seg.path)}" title="Open ${this.escapeHtml(seg.label)}">${this.escapeHtml(seg.label)}</span>`;
            }).join('')
            : safeName;
        const rowTitle = isChain
            ? this.escapeHtml(chain.map(s => s.label).join(' › '))
            : safeName;
        // Every path the row stands for. `selectFolder` matches against these
        // as well as data-folder-path, so arriving at a SKIPPED rung (via the
        // top breadcrumb or a deep link) still highlights the row that holds
        // it instead of silently highlighting nothing.
        const chainPaths = isChain
            ? ` data-chain-paths="${this.escapeHtml(chain.map(s => s.path).join('|'))}"`
            : '';

        return `
            <div class="nav-folder-item kr-drill-row${groupClass}${ftypeClass}${isChain ? ' kr-drill-chain' : ''}" data-folder-path="${this.escapeHtml(node.path)}" data-folder-id="${folderId}" data-folder-name="${safeName}"${chainPaths}${status ? ` data-ftype="${status}"` : ''} title="${rowTitle}" style="padding-left: ${indent}px;">
                <i class="bi bi-folder folder-icon"></i>
                <span class="nav-folder-item-text">${label}</span>
                ${chevron}
            </div>
        `;
    },

    _renderDrillFileRow(node, level = 0) {
        const documentPath = node.path || node.name || '';
        const spaceName = node.spaceName || this.app?.currentSpace?.name || '';
        const fileName = this.escapeHtml(node.title || node.name);
        const fileIcon = this.getFileIcon(documentPath);
        const indent = 8 + (level * 16);
        // A file can carry the same status accent as a folder (assigned in its
        // parent's .system/file-types.json). When set, recolour icon + label.
        const status = node.status || null;
        const ftypeClass = status ? ` kr-ftype-${status}` : '';
        return `
            <div class="nav-file-item kr-drill-row${ftypeClass}" data-document-path="${this.escapeHtml(documentPath)}" data-space-name="${this.escapeHtml(spaceName)}"${status ? ` data-ftype="${status}"` : ''} title="${fileName}" style="padding-left: ${indent}px;">
                <i class="bi ${fileIcon.icon} ${fileIcon.color}"></i>
                <span class="nav-file-item-text">${fileName}</span>
            </div>
        `;
    },

    /** Re-render the drill view at the current level (used after live edits). */
    refreshDrillView() {
        this.renderDrillView(this.drillPath || '');
    },

    /**
     * Wire up the drill rows: folders drill in (and open their overview),
     * files open, the back row pops up a level, and context-menu + drag-drop
     * keep working via the shared handlers (they key off data-* attributes).
     */
    bindDrillEvents() {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        // Back / breadcrumb row → navigate one level up.
        const backRow = fileTree.querySelector('.kr-drill-back');
        if (backRow) {
            backRow.addEventListener('click', () => {
                const parentPath = backRow.dataset.parentPath || '';
                this.loadFolderContent(parentPath || '/');
            });
            // Allow dropping items onto the back row to move them up a level.
            if (!this.isReadOnlyMode) {
                backRow.addEventListener('dragover', (e) => this.handleDragOver(e));
                backRow.addEventListener('dragenter', (e) => this.handleDragEnter(e, backRow));
                backRow.addEventListener('dragleave', (e) => this.handleDragLeave(e, backRow));
                backRow.addEventListener('drop', (e) => this.handleDrop(e, backRow.dataset.parentPath || '', 'folder'));
            }
        }

        // Header row (the current folder) → load its overview in the central
        // view, mirroring a click on the matching top-breadcrumb segment. Stays
        // at the same drill level since you're already inside this folder.
        const headRow = fileTree.querySelector('.kr-drill-head-clickable');
        if (headRow) {
            const openHeader = () => this.loadFolderContent(headRow.dataset.folderPath || '/');
            headRow.addEventListener('click', openHeader);
            headRow.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHeader(); }
            });
            // Dropping items onto the header moves them into the current folder.
            if (!this.isReadOnlyMode) {
                const headerDropPath = headRow.dataset.folderPath === '/' ? '' : (headRow.dataset.folderPath || '');
                headRow.addEventListener('dragover', (e) => this.handleDragOver(e));
                headRow.addEventListener('dragenter', (e) => this.handleDragEnter(e, headRow));
                headRow.addEventListener('dragleave', (e) => this.handleDragLeave(e, headRow));
                headRow.addEventListener('drop', (e) => this.handleDrop(e, headerDropPath, 'folder'));
            }
        }

        // Folder rows → drill in + load overview (home-only folders open their
        // home page directly instead; see navigateToTreeFolder).
        fileTree.querySelectorAll('.nav-folder-item').forEach(folderItem => {
            folderItem.addEventListener('click', (e) => {
                e.stopPropagation();
                // On a collapsed chain row ("A › B"), clicking a specific
                // segment goes to THAT folder — otherwise the intermediate
                // rungs would be reachable only from the top breadcrumb. The
                // last segment's path is the row's own, so clicking the row
                // background and clicking the end of the label agree.
                const segment = e.target.closest?.('[data-chain-path]');
                const folderPath = (segment && folderItem.contains(segment))
                    ? segment.dataset.chainPath
                    : folderItem.dataset.folderPath;
                this.navigateToTreeFolder(folderPath);
            });

            folderItem.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                this.showContextMenu(e, folderItem.dataset.folderPath, 'folder');
            });

            folderItem.setAttribute('draggable', 'true');
            folderItem.addEventListener('dragstart', (e) => {
                if (this.isReadOnlyMode) { e.preventDefault(); return; }
                this.handleDragStart(e, folderItem.dataset.folderPath, 'folder');
            });
            folderItem.addEventListener('dragover', (e) => { if (!this.isReadOnlyMode) this.handleDragOver(e); });
            folderItem.addEventListener('dragenter', (e) => { if (!this.isReadOnlyMode) this.handleDragEnter(e, folderItem); });
            folderItem.addEventListener('dragleave', (e) => { if (!this.isReadOnlyMode) this.handleDragLeave(e, folderItem); });
            folderItem.addEventListener('drop', (e) => { if (!this.isReadOnlyMode) this.handleDrop(e, folderItem.dataset.folderPath, 'folder'); });
        });

        // File rows → open the document.
        fileTree.querySelectorAll('.nav-file-item').forEach(fileItem => {
            fileItem.addEventListener('click', () => {
                documentController.openDocumentByPath(fileItem.dataset.documentPath, fileItem.dataset.spaceName);
            });

            fileItem.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                this.contextMenuTargetSpaceName = fileItem.dataset.spaceName;
                this.showContextMenu(e, fileItem.dataset.documentPath, 'file');
            });

            fileItem.setAttribute('draggable', 'true');
            fileItem.addEventListener('dragstart', (e) => {
                if (this.isReadOnlyMode) { e.preventDefault(); return; }
                this.handleDragStart(e, fileItem.dataset.documentPath, 'file');
            });
        });

        // Right-click on empty rail space → root-level context menu.
        fileTree.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.nav-folder-item') && !e.target.closest('.nav-file-item') && !e.target.closest('.kr-drill-back')) {
                this.showContextMenu(e, this.drillPath || null, 'folder');
            }
        });
    },

    renderTreeNodes(nodes, level = 0, isRoot = false) {
        return nodes.filter(node => {
            // Hide system folders and dotfiles (.home.md, .config, etc.).
            // The folder-home loader still reads .home.md for the in-view
            // banner; an edit button on the folder view lets users edit it.
            if (node.name && node.name.startsWith('.')) {
                return false;
            }
            return true;
        }).map(node => {
            if (node.type === 'folder') {
                const hasChildren = node.children && node.children.length > 0;
                const folderId = `folder-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
                const folderName = node.name;
                const status = this._effectiveFolderStatus(node);
                const ftypeClass = status ? ` kr-ftype-${status}` : '';
                const isLink = node.isSymbolicLink === true;
                const linkClass = isLink ? ' is-symlink' : '';
                const linkBadge = isLink ? '<i class="bi bi-link-45deg nav-symlink-badge" title="Symbolic link"></i>' : '';

                return `
                    <div class="nav-folder-item${ftypeClass}${linkClass}" data-folder-path="${node.path}" data-folder-id="${folderId}"${status ? ` data-ftype="${status}"` : ''} style="padding-left: ${level * 16}px" title="${folderName}${isLink ? ' (linked)' : ''}">
                        <i class="bi ${hasChildren ? 'bi-chevron-right' : ''} chevron-icon"></i>
                        <i class="bi bi-folder folder-icon"></i>
                        <span class="nav-folder-item-text">${folderName}</span>
                        ${linkBadge}
                    </div>
                    ${hasChildren ? `
                        <div class="nav-folder-children" data-folder-children="${folderId}">
                            ${this.renderTreeNodes(node.children, level + 1, false)}
                        </div>
                    ` : ''}
                `;
            } else if (node.type === 'document') {
                // Only show root-level documents initially
                if (isRoot || level > 0) {
                    const fileIcon = this.getFileIcon(node.path || node.name);
                    const documentPath = node.path || node.name || '';
                    const spaceName = node.spaceName || '';
                    const fileName = node.title || node.name;
                    const status = node.status || null;
                    const ftypeClass = status ? ` kr-ftype-${status}` : '';
                    const isLink = node.isSymbolicLink === true;
                    const linkClass = isLink ? ' is-symlink' : '';
                    const linkBadge = isLink ? '<i class="bi bi-link-45deg nav-symlink-badge" title="Symbolic link"></i>' : '';

                    return `
                        <div class="nav-file-item${ftypeClass}${linkClass}" data-document-path="${documentPath}" data-space-name="${spaceName}"${status ? ` data-ftype="${status}"` : ''} style="padding-left: ${(level * 16) + 16}px" title="${fileName}${isLink ? ' (linked)' : ''}">
                            <i class="bi ${fileIcon.icon} ${fileIcon.color}"></i>
                            <span class="nav-file-item-text">${fileName}</span>
                            ${linkBadge}
                        </div>
                    `;
                }
            }
            return '';
        }).join('');
    },

    /**
     * Bind events to a single file item in the file tree (for dynamic elements)
     * @param {HTMLElement} fileItem - The file item element
     */
    bindFileItemEvents_Single(fileItem) {
        if (!fileItem) return;

        // Click event
        fileItem.addEventListener('click', () => {
            const documentPath = fileItem.dataset.documentPath;
            const spaceName = fileItem.dataset.spaceName;
            documentController.openDocumentByPath(documentPath, spaceName);
        });

        // Context menu
        fileItem.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
            const filePath = fileItem.dataset.documentPath;
            const spaceName = fileItem.dataset.spaceName;
            this.contextMenuTargetSpaceName = spaceName;
            this.showContextMenu(e, filePath, 'file');
        });

        // Drag and drop
        fileItem.setAttribute('draggable', 'true');
        fileItem.addEventListener('dragstart', (e) => {
            if (this.isReadOnlyMode) {
                e.preventDefault();
                return;
            }
            this.handleDragStart(e, fileItem.dataset.documentPath, 'file');
        });
    },

    /**
     * Bind events to a single file item in the folder viewer (for dynamic elements)
     * @param {HTMLElement} fileItem - The file item element
     */
    bindFolderViewFileItem_Single(fileItem) {
        if (!fileItem) return;

        // Click event to open document
        fileItem.addEventListener('click', () => {
            const documentPath = fileItem.dataset.documentPath;
            const spaceName = fileItem.dataset.spaceName;
            documentController.openDocumentByPath(documentPath, spaceName);
        });

        // Context menu for files
        fileItem.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
            const filePath = fileItem.dataset.documentPath;
            const spaceName = fileItem.dataset.spaceName;
            this.contextMenuTargetSpaceName = spaceName;
            this.showContextMenu(e, filePath, 'file');
        });

        // Preview on hover for file items
        fileItem.addEventListener('mouseenter', (e) => {
            const documentPath = fileItem.dataset.documentPath;
            const spaceName = fileItem.dataset.spaceName;

            this.previewTimeout = setTimeout(() => {
                this.currentPreviewCard = fileItem;
                this.showFilePreview(fileItem, documentPath, spaceName);
            }, 500);
        });

        fileItem.addEventListener('mouseleave', (e) => {
            clearTimeout(this.previewTimeout);
            this.hideFilePreview();
        });
    },

    /**
     * Bind events to a single folder item in the folder viewer (for dynamic elements)
     * @param {HTMLElement} folderItem - The folder item element
     */
    bindFolderViewFolderItem_Single(folderItem) {
        if (!folderItem) return;

        // Click event to load folder
        folderItem.addEventListener('click', () => {
            const folderPath = folderItem.dataset.folderPath;
            this.loadFolderContent(folderPath);
        });

        // Context menu for folders
        folderItem.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
            const folderPath = folderItem.dataset.folderPath;
            this.showContextMenu(e, folderPath, 'folder');
        });

        // Drag and drop for folder items
        if (!this.isReadOnlyMode) {
            folderItem.setAttribute('draggable', 'true');

            folderItem.addEventListener('dragstart', (e) => {
                this.handleDragStart(e, folderItem.dataset.folderPath, 'folder');
            });

            folderItem.addEventListener('dragover', (e) => {
                this.handleDragOver(e);
            });

            folderItem.addEventListener('dragenter', (e) => {
                this.handleDragEnter(e, folderItem);
            });

            folderItem.addEventListener('dragleave', (e) => {
                this.handleDragLeave(e, folderItem);
            });

            folderItem.addEventListener('drop', (e) => {
                this.handleDrop(e, folderItem.dataset.folderPath, 'folder');
            });
        }
    },

    /**
     * Bind events to a single folder item (for dynamic elements)
     * @param {HTMLElement} folderItem - The folder item element
     */
    bindFolderItemEvents_Single(folderItem) {
        if (!folderItem) return;

        // Toggle folder
        folderItem.addEventListener('click', (e) => {
            e.stopPropagation();
            const folderId = folderItem.dataset.folderId;
            const hasChildren = document.querySelector(`[data-folder-children="${folderId}"]`);
            if (hasChildren) {
                this.toggleFolder(folderId);
            }
        });

        // Load folder content (home-only folders open their home page instead)
        folderItem.addEventListener('click', (e) => {
            if (e.target.closest('.chevron-icon')) return;

            const folderPath = folderItem.dataset.folderPath;
            this.navigateToTreeFolder(folderPath);
        });

        // Context menu
        folderItem.addEventListener('contextmenu', (e) => {
            const folderPath = folderItem.dataset.folderPath;
            this.showContextMenu(e, folderPath, 'folder');
        });

        // Drag and drop
        folderItem.setAttribute('draggable', 'true');

        folderItem.addEventListener('dragstart', (e) => {
            if (this.isReadOnlyMode) {
                e.preventDefault();
                return;
            }
            this.handleDragStart(e, folderItem.dataset.folderPath, 'folder');
        });

        folderItem.addEventListener('dragover', (e) => {
            if (this.isReadOnlyMode) return;
            this.handleDragOver(e);
        });

        folderItem.addEventListener('dragenter', (e) => {
            if (this.isReadOnlyMode) return;
            this.handleDragEnter(e, folderItem);
        });

        folderItem.addEventListener('dragleave', (e) => {
            if (this.isReadOnlyMode) return;
            this.handleDragLeave(e, folderItem);
        });

        folderItem.addEventListener('drop', (e) => {
            if (this.isReadOnlyMode) return;
            this.handleDrop(e, folderItem.dataset.folderPath, 'folder');
        });
    },

    bindFileTreeEvents() {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        // Handle folder item clicks for toggling
        fileTree.querySelectorAll('.nav-folder-item').forEach(folderItem => {
            folderItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const folderId = folderItem.dataset.folderId;
                // Check if this folder has children
                const hasChildren = document.querySelector(`[data-folder-children="${folderId}"]`);
                if (hasChildren) {
                    this.toggleFolder(folderId);
                }
            });
        });

        // Handle folder item clicks (for content loading; home-only folders
        // open their home page instead of drilling in)
        fileTree.querySelectorAll('.nav-folder-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking the toggle
                if (e.target.closest('.chevron-icon')) return;

                const folderPath = item.dataset.folderPath;
                this.navigateToTreeFolder(folderPath);
            });
        });

        // Handle file item clicks
        fileTree.querySelectorAll('.nav-file-item').forEach(item => {
            item.addEventListener('click', () => {
                const documentPath = item.dataset.documentPath;
                const spaceName = item.dataset.spaceName;
                documentController.openDocumentByPath(documentPath, spaceName);
            });
        });

        // Add context menu functionality to folder items
        fileTree.querySelectorAll('.nav-folder-item').forEach(folderItem => {
            folderItem.addEventListener('contextmenu', (e) => {
                const folderPath = folderItem.dataset.folderPath;
                this.showContextMenu(e, folderPath, 'folder');
            });
        });

        // Add context menu functionality to file items
        fileTree.querySelectorAll('.nav-file-item').forEach(fileItem => {
            fileItem.addEventListener('contextmenu', (e) => {
                e.stopPropagation(); // Prevent folder context menu from firing
                const filePath = fileItem.dataset.documentPath;
                const spaceName = fileItem.dataset.spaceName;
                // Store both path and space name for file operations
                this.contextMenuTargetSpaceName = spaceName;
                this.showContextMenu(e, filePath, 'file');
            });
        });

        // Add context menu for file tree root (empty space)
        fileTree.addEventListener('contextmenu', (e) => {
            // Only show context menu if not clicking on a folder or file item
            if (!e.target.closest('.nav-folder-item') && !e.target.closest('.nav-file-item')) {
                this.showContextMenu(e, null, 'folder'); // null means root directory
            }
        });

        // Drag and drop for folders
        fileTree.querySelectorAll('.nav-folder-item').forEach(folderItem => {
            folderItem.setAttribute('draggable', 'true');

            folderItem.addEventListener('dragstart', (e) => {
                if (this.isReadOnlyMode) {
                    e.preventDefault();
                    return;
                }
                this.handleDragStart(e, folderItem.dataset.folderPath, 'folder');
            });

            folderItem.addEventListener('dragover', (e) => {
                if (this.isReadOnlyMode) return;
                this.handleDragOver(e);
            });

            folderItem.addEventListener('dragenter', (e) => {
                if (this.isReadOnlyMode) return;
                this.handleDragEnter(e, folderItem);
            });

            folderItem.addEventListener('dragleave', (e) => {
                if (this.isReadOnlyMode) return;
                this.handleDragLeave(e, folderItem);
            });

            folderItem.addEventListener('drop', (e) => {
                if (this.isReadOnlyMode) return;
                this.handleDrop(e, folderItem.dataset.folderPath, 'folder');
            });
        });

        // Drag and drop for files
        fileTree.querySelectorAll('.nav-file-item').forEach(fileItem => {
            fileItem.setAttribute('draggable', 'true');

            fileItem.addEventListener('dragstart', (e) => {
                if (this.isReadOnlyMode) {
                    e.preventDefault();
                    return;
                }
                this.handleDragStart(e, fileItem.dataset.documentPath, 'file');
            });
        });
    },

    // Selective tree update methods
    async updateTreeNode(targetPath = '') {
        if (!this.app.currentSpace) return;

        try {
            // Fetch only the updated tree data from API
            const response = await fetch(`/applications/wiki/api/spaces/${this.app.currentSpace.id}/folders`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: API endpoint not available`);
            }
            const fullTree = await response.json();

            // The drill-down nav renders one level at a time from fullFileTree,
            // so incremental per-node DOM patching no longer applies. Re-render
            // the current drill level (renderFileTree preserves this.drillPath
            // and refreshes window.documents); it falls back to the nearest
            // surviving ancestor if the current folder was removed.
            this.renderFileTree(fullTree);
        } catch (error) {
            console.log('Tree update failed, falling back to full refresh:', error);
            await this.loadFileTree();
        }
    },

    updateSpecificTreeNode(targetPath, fullTree) {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        // Find the folder element to update
        const folderElement = fileTree.querySelector(`[data-folder-path="${targetPath}"]`);
        if (!folderElement) {
            // If we can't find the specific folder, refresh the whole tree
            this.renderFileTree(fullTree);
            return;
        }

        // Find the folder data in the tree
        const folderData = this.findNodeInTree(fullTree, targetPath);
        if (!folderData) {
            // If we can't find the folder data, refresh the whole tree
            this.renderFileTree(fullTree);
            return;
        }

        // Find the children container for this folder
        const folderId = folderElement.dataset.folderId;
        const childrenContainer = fileTree.querySelector(`[data-folder-children="${folderId}"]`);

        if (childrenContainer && folderData.children) {
            // Update the children content
            const level = parseInt(folderElement.dataset.level || '0') + 1;
            childrenContainer.innerHTML = this.renderTreeNodes(folderData.children, level);

            // Rebind events for new elements
            this.bindFileTreeEvents();
        }
    },

    findNodeInTree(tree, targetPath) {
        for (const node of tree) {
            if (node.path === targetPath) {
                return node;
            }
            if (node.children) {
                const found = this.findNodeInTree(node.children, targetPath);
                if (found) return found;
            }
        }
        return null;
    },

    addItemToTree(targetPath, newItem) {
        // Add a new item to the tree without full refresh
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        if (targetPath === '' || targetPath === null) {
            // Adding to root - insert at the beginning
            const firstChild = fileTree.firstElementChild;
            const newElement = this.createTreeNodeElement(newItem, 0);
            if (firstChild) {
                firstChild.insertAdjacentHTML('beforebegin', newElement);
            } else {
                fileTree.innerHTML = newElement;
            }
        } else {
            // Adding to specific folder
            const folderElement = fileTree.querySelector(`[data-folder-path="${targetPath}"]`);
            if (folderElement) {
                const folderId = folderElement.dataset.folderId;
                const childrenContainer = fileTree.querySelector(`[data-folder-children="${folderId}"]`);

                if (childrenContainer) {
                    const level = parseInt(folderElement.dataset.level || '0') + 1;
                    const newElement = this.createTreeNodeElement(newItem, level);
                    childrenContainer.insertAdjacentHTML('beforeend', newElement);
                }
            }
        }

        // Rebind events for new elements
        this.bindFileTreeEvents();
    },

    createTreeNodeElement(node, level) {
        if (node.type === 'folder') {
            const hasChildren = node.children && node.children.length > 0;
            return `
                <div class="nav-folder-item" data-folder-path="${node.path}" data-folder-id="${node.path}" data-level="${level}" style="padding-left: ${level * 20}px;">
                    <div class="folder-header">
                        <i class="bi bi-chevron-${hasChildren ? 'right' : 'right'} chevron-icon"></i>
                        <i class="bi bi-folder folder-icon"></i>
                        <span class="folder-name">${node.name}</span>
                    </div>
                    ${hasChildren ? `<div class="nav-folder-children collapsed" data-folder-children="${node.path}"></div>` : ''}
                </div>
            `;
        } else {
            const fileIcon = this.getFileIcon(node.name);
            return `
                <div class="nav-file-item" data-document-path="${node.path}" data-space-name="${this.app.currentSpace?.name}" style="padding-left: ${(level + 1) * 20}px;">
                    <i class="bi ${fileIcon.icon} ${fileIcon.color}"></i>
                    <span>${node.title || node.name}</span>
                </div>
            `;
        }
    },

    selectFolder(folderPath) {
        this.app.currentFolder = folderPath;
        // Update file tree selection. A collapsed chain row stands for several
        // folders, so it also matches on any path in its run (data-chain-paths)
        // — otherwise landing on a skipped rung highlights nothing at all.
        document.querySelectorAll('.nav-folder-item').forEach(item => {
            const chainPaths = item.dataset.chainPaths;
            const isSelected = item.dataset.folderPath === folderPath
                || (!!chainPaths && chainPaths.split('|').includes(folderPath));
            item.classList.toggle('selected', isSelected);
        });

        // Dispatch folder change event
        window.dispatchEvent(new CustomEvent('folderChanged', {
            detail: { folderPath: folderPath }
        }));
    },

    /**
     * The nav row standing for a folder path.
     *
     * A collapsed chain row stands for SEVERAL folders, so a rung it skipped
     * has no row of its own to match on `data-folder-path` — it is listed in
     * `data-chain-paths` instead. Opening `Commercial Services/.home.md` would
     * otherwise highlight nothing at all, since the only row on that level is
     * the one labelled `Commercial Services › Technology`.
     */
    _findNavRow(folderPath) {
        const direct = document.querySelector(`[data-folder-path="${folderPath}"]`);
        if (direct) return direct;
        return Array.from(document.querySelectorAll('[data-chain-paths]'))
            .find(el => (el.dataset.chainPaths || '').split('|').includes(folderPath)) || null;
    },

    toggleFolder(folderId) {
        const folderItem = document.querySelector(`[data-folder-id="${folderId}"]`);
        const folderChildren = document.querySelector(`[data-folder-children="${folderId}"]`);

        if (!folderItem || !folderChildren) return;

        const isExpanded = folderItem.classList.contains('expanded');
        const chevronIcon = folderItem.querySelector('.chevron-icon');

        if (isExpanded) {
            // Collapse
            folderItem.classList.remove('expanded');
            folderChildren.classList.remove('expanded');
            if (chevronIcon) {
                chevronIcon.className = 'bi bi-chevron-right chevron-icon';
            }
        } else {
            // Expand
            folderItem.classList.add('expanded');
            folderChildren.classList.add('expanded');
            if (chevronIcon) {
                chevronIcon.className = 'bi bi-chevron-down chevron-icon';
            }
        }
    },

    // Folder View Methods
    /**
     * @param {string} folderPath '/' for the space root
     * @param {number} [token] from app.beginSpaceSelection(), when this is part
     *   of a space switch — a superseded switch stops before painting.
     */
    async loadFolderContent(folderPath, token = this.app?.spaceGeneration) {
        // Navigating to a folder means no document is open. Clear the
        // current-document reference so downstream consumers (e.g. the AI
        // chat) don't keep treating a previously-viewed file as the context.
        if (this.app) {
            this.app.currentDocument = null;
        }

        // The tree is lazy: this folder's children (and their children, for the
        // per-folder item counts) may not have been fetched yet. Everything
        // below reads them straight out of fullFileTree, so load first.
        await this.ensureFolderLoaded(folderPath);
        if (this.app?.isSpaceCurrent && !this.app.isSpaceCurrent(token)) return;

        // Update window.currentDocuments for wiki-code access
        this.updateCurrentDocuments(folderPath);

        // Handle root folder specially
        let folder;
        if (folderPath === '/') {
            // Create a virtual root folder object containing all root-level items
            const rootFolders = this.fullFileTree.filter(item => item.type === 'folder');
            const rootFiles = this.fullFileTree.filter(item => item.type === 'file');
            folder = {
                type: 'folder',
                path: '/',
                title: this.app?.currentSpace?.name || 'Root',
                spaceName: this.app?.currentSpace?.name || 'Spaces',
                children: this.fullFileTree,
                folders: rootFolders,
                files: rootFiles
            };
        } else {
            folder = this.findFolderInTree(this.fullFileTree, folderPath);
        }

        if (!folder) return;

        // A folder marked 'continuous-exploration' opens the continuous exploration workspace instead of
        // the normal folder view (falls back here if no .continuous-exploration.json found).
        if (folder.status === 'continuous-exploration' && folderPath !== '/') {
            const space = this.app?.currentSpace;
            if (space) {
                const module = await import('./continuousExplorationController.js');
                const opened = await module.continuousExplorationController.openProjectByPath(space, folderPath);
                if (opened) return;
            }
        }

        // Update URL up-front so that any code path that re-reads window.location
        // (or a popstate triggered during the async load below) sees the new
        // folder URL rather than the previous document/deep-link URL.
        if (this.app && !this.app._suppressPushState && this.app.currentSpace) {
            const spaceName = this.app.currentSpace.name;
            const encodedFolderPath = folderPath === '/'
                ? ''
                : folderPath.split('/').map(encodeURIComponent).join('/');
            const newUrl = `/applications/wiki/${encodeURIComponent(spaceName)}/${encodedFolderPath}`;
            if (window.location.pathname !== newUrl) {
                history.pushState({ type: 'folder', spaceName, path: folderPath }, '', newUrl);
            }
        }

        // Determine which view mode to use:
        // 1. First priority: folder-specific preference
        // 2. Second priority: last used global view mode
        // 3. Third priority: default (grid)
        const folderPreference = this.getFolderViewPreference(folderPath);
        if (folderPreference) {
            this.currentViewMode = folderPreference;
            console.log(`Using folder-specific preference: ${folderPreference} for ${folderPath || 'root'}`);
        } else {
            // Use the last global view mode (already set in currentViewMode)
            console.log(`Using last global view mode: ${this.currentViewMode} for ${folderPath || 'root'}`);
        }

        // Create a folder overview view. At the root, loadFolderHomeContent
        // resolves the space's OWN configured landing page first — and carries
        // the selection token, so a space switch that happened while it was in
        // flight discards this render instead of painting over the newer one.
        const folderContent = this.createFolderOverview(folder);
        const folderHome = await this.loadFolderHomeContent(folderPath, token);
        if (this.app?.isSpaceCurrent && !this.app.isSpaceCurrent(token)) return;
        this.showFolderView(folderContent, folderHome);

        // Sync the drill-down nav to the loaded folder (root included).
        this.expandPathInNav(folderPath || '/');
    },

    findFolderInTree(nodes, targetPath) {
        for (const node of nodes) {
            if (node.type === 'folder' && node.path === targetPath) {
                return node;
            }
            if (node.children) {
                const found = this.findFolderInTree(node.children, targetPath);
                if (found) return found;
            }
        }
        return null;
    },

    /**
     * Return the home document node (home.md / .home.md) when a folder's only
     * *visible* content is a home page, otherwise null. Hidden helper folders
     * (.aicontext, .context, …) are ignored since they never show in the nav.
     * A visible subfolder or any non-home document means the folder has real
     * content and is not "home-only". When both home.md and .home.md exist,
     * .home.md wins (mirrors loadFolderHomeContent's lookup order).
     */
    _homeOnlyDocument(folder) {
        if (!folder || folder.type !== 'folder' || !Array.isArray(folder.children)) {
            return null;
        }
        // Unlisted (lazy tree): its children are unknown, so it cannot be shown
        // to hold nothing but a home page. Callers drill in and re-ask once the
        // folder has actually been loaded.
        if (folder.truncated) return null;

        let homeDoc = null;
        for (const child of folder.children) {
            if (child.type === 'folder') {
                // A visible subfolder is real content → not home-only.
                if (!(child.name || '').startsWith('.')) return null;
            } else if (/^\.?home\.md$/i.test(child.name || '')) {
                if (!homeDoc || (child.name || '').startsWith('.')) homeDoc = child;
            } else {
                return null; // any other document → not home-only
            }
        }

        return homeDoc;
    },

    /**
     * Handle a folder click in the LEFT navigation. Folders whose only content
     * is a home page open that page as a document instead of drilling into the
     * (otherwise empty) folder and showing the folder overview. The nav stays
     * on the folder's parent level with the folder highlighted — see the
     * home-page branch in expandPathInNav. All other folders behave as before.
     */
    async navigateToTreeFolder(folderPath) {
        // Lazy tree: a folder shown as drillable may not have been listed yet,
        // and "is this home-only?" cannot be answered until it has been.
        if (folderPath && folderPath !== '/') await this.ensurePathLoaded(folderPath);

        const folder = (folderPath && folderPath !== '/')
            ? this.findFolderInTree(this.fullFileTree || [], folderPath)
            : null;
        const homeDoc = this._homeOnlyDocument(folder);
        if (homeDoc) {
            const spaceName = homeDoc.spaceName || this.app?.currentSpace?.name || '';
            documentController.openDocumentByPath(homeDoc.path, spaceName);
            return;
        }

        this.selectFolder(folderPath);
        this.loadFolderContent(folderPath);
    },

    createFolderOverview(folder) {
        const spaceName = this.app.currentSpace?.name || 'Unknown Space';

        // Add spaceName to each file so it's available in the view. Hide
        // dotfiles (.home.md, .draft.md, …) — they're loaded via dedicated
        // code paths (folder-home banner) and edited via the edit-home button.
        const childFiles = folder.children
            ? folder.children
                .filter(c => c.type === 'document' && !(c.name || '').startsWith('.'))
                .map(file => ({
                    ...file,
                    spaceName: file.spaceName || spaceName
                }))
            : [];

        // Filter out system folders (those starting with .)
        const childFolders = folder.children ? folder.children.filter(c => c.type === 'folder' && !c.name.startsWith('.')) : [];

        // Add child count to each folder for display
        const foldersWithCounts = childFolders.map(childFolder => ({
            ...childFolder,
            childCount: childFolder.children ? childFolder.children.length : 0
        }));

        return {
            title: folder.name,
            path: folder.path,
            spaceName: spaceName,
            stats: {
                files: childFiles.length,
                folders: childFolders.length
            },
            files: childFiles,
            folders: foldersWithCounts
        };
    },

    /**
     * Truncate a breadcrumb label for display only — the underlying path and
     * navigation data are never changed. Labels longer than `max` characters
     * are cut to the first `max` and suffixed with an ellipsis; the full text
     * is carried on a `title` attribute by callers so it stays visible on hover.
     * @param {string} text
     * @param {number} [max=20]
     * @returns {string}
     */
    truncateLabel(text, max = 20) {
        const str = String(text == null ? '' : text);
        return str.length > max ? str.slice(0, max) + '…' : str;
    },

    /**
     * Render the breadcrumb segments after the leading "Spaces" link.
     * Produces: Space name (link to space root) / folder1 (link) / folder2 (link) / activeFolder (muted).
     * Each link carries data-folder-path so bindFolderViewEvents can wire navigation.
     */
    renderFolderBreadcrumbSegments(spaceName, folderPath) {
        // Segment data (Space / A / B / current) comes from the shared core;
        // this method only turns it into the web's breadcrumb markup.
        const segments = coreBuildBreadcrumbSegments(spaceName || '', folderPath);
        const parts = [];
        segments.forEach((seg, idx) => {
            if (idx > 0) parts.push('<span class="breadcrumb-separator">/</span>');
            const safe = this.escapeHtml(this.truncateLabel(seg.label));
            const full = this.escapeHtml(seg.label);
            if (!seg.isLink) {
                // Current (last) segment, or the space root when at root — muted.
                parts.push(`<span class="text-muted" title="${full}">${safe}</span>`);
            } else if (seg.isRoot) {
                parts.push(`<a href="#" class="breadcrumb-folder-link text-decoration-none" data-folder-path="" title="${full}" style="color: var(--kr-teal-600, #12284b); font-weight: bold;">${safe}</a>`);
            } else {
                parts.push(`<a href="#" class="breadcrumb-folder-link text-decoration-none" data-folder-path="${this.escapeHtml(seg.path)}" title="${full}" style="color: var(--kr-teal-600, #12284b);">${safe}</a>`);
            }
        });
        return parts.join('');
    },

    /**
     * Load a folder's home page — including the SPACE ROOT, where the answer
     * comes from the space's own configuration first.
     *
     * Root resolution order (`app.spaceHomeCandidates`): the page the space
     * NAMES (`theme.home` in spaces.json, e.g. `".retail.md"`), then a
     * top-level `home` on the space record, then `.home.md`, then `home.md`.
     * First one that EXISTS wins, so a space whose named page hasn't been
     * created yet still falls back cleanly.
     *
     * PINNED TO ONE SPACE. `space` is captured once and used for the candidate
     * list AND every request, and the generation token is re-checked before the
     * result is handed back. Re-reading `this.app.currentSpace` per fetch — what
     * this used to do — lets two overlapping space loads interleave, so the
     * candidates belong to one space and the lookups hit another. These spaces
     * share a content root, so the other space's landing page genuinely exists
     * there and renders instead of 404ing: that is why Engineering would load and
     * then flip to Retail.
     *
     * @param {string} folderPath '' or '/' for the space root
     * @param {number} [token] from app.beginSpaceSelection()
     * @returns {Promise<{html: string, path: string, content: string}|null>}
     */
    async loadFolderHomeContent(folderPath, token = this.app?.spaceGeneration) {
        // Load home content for any folder, including root.
        // Returns { html, path } when a home file exists, or null. The caller
        // uses `path` to wire up an edit button (since .home.md is hidden
        // from the tree, the edit button is the only way to reach it).
        const space = this.app?.currentSpace;
        if (!folderPath || !space) {
            return null;
        }

        const normalizedPath = folderPath.replace(/^\/+|\/+$/g, '');

        let filenamesToTry;
        if (!normalizedPath) {
            // Space root — the space configuration decides, with .home.md /
            // home.md as the fallback for spaces that name nothing.
            filenamesToTry = this.app.spaceHomeCandidates(space);
        } else {
            // Inside a folder: .home.md first, then home.md.
            filenamesToTry = [`${normalizedPath}/.home.md`, `${normalizedPath}/home.md`];
        }

        const stale = () => this.app.isSpaceCurrent && !this.app.isSpaceCurrent(token);

        try {
            for (const documentPath of filenamesToTry) {
                if (stale()) return null;

                // Check if the file exists for this folder
                const existsResponse = await fetch('/applications/wiki/api/documents/exists', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        spaceName: space.name,
                        path: documentPath
                    })
                });

                if (!existsResponse.ok) {
                    continue;
                }

                const existsData = await existsResponse.json();
                if (!existsData.exists) {
                    continue;
                }

                // Load the markdown content for rendering
                const contentResponse = await fetch('/applications/wiki/api/documents/content', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        spaceName: space.name,
                        path: documentPath
                    })
                });

                if (!contentResponse.ok) {
                    continue;
                }

                const data = await contentResponse.json();
                if (!data.content) {
                    continue;
                }

                // A superseded load must not hand content back to a caller that
                // is about to render it.
                if (stale()) return null;

                // Render markdown if available, fallback to raw text
                const html = (typeof marked !== 'undefined' && typeof marked.parse === 'function')
                    ? parseMarkdown(data.content)
                    : data.content;

                return { html, path: documentPath, content: data.content };
            }

            return null;
        } catch (error) {
            // Silently ignore errors; folder home content is optional
            return null;
        }
    },

    /**
     * Open an existing folder-home file (.home.md or home.md) for editing.
     * The file is loaded via the normal openDocumentByPath path so the editor
     * gets a fully-populated doc object, then we switch into edit mode.
     */
    async editFolderHome(homePath) {
        if (!homePath || !this.app.currentSpace) return;
        try {
            await documentController.openDocumentByPath(homePath, this.app.currentSpace.name);
            documentController.editCurrentDocument();
        } catch (error) {
            console.error('[NavigationController] editFolderHome failed:', error);
            this.app.showNotification('Could not open folder home for editing', 'error');
        }
    },

    /**
     * Create a hidden .home.md for the given folder and open it for editing.
     * The leading dot keeps it out of the tree and the folder listing; the
     * loadFolderHomeContent path will pick it up on the next folder load.
     */
    async createFolderHome(folderPath) {
        if (!this.app.currentSpace) {
            this.app.showNotification('No space selected', 'error');
            return;
        }

        const normalizedFolder = (folderPath || '').replace(/^\/+|\/+$/g, '');
        const fullPath = normalizedFolder ? `${normalizedFolder}/.home.md` : '.home.md';
        const folderLabel = normalizedFolder
            ? normalizedFolder.split('/').pop()
            : (this.app.currentSpace.name || 'this space');
        const seedContent = `# Welcome to ${folderLabel}\n\nThis is the folder home. It shows at the top of the folder view but is hidden from the file tree.\n`;

        try {
            const response = await fetch('/applications/wiki/api/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: '.home',
                    path: fullPath,
                    spaceId: this.app.currentSpace.id,
                    content: seedContent
                })
            });

            const result = await response.json();

            // 409 means a folder home is already there — the create menu item
            // can still be reached from a stale tree. Editing the existing one
            // is what the user wanted either way, and it is the only branch
            // where "already exists" is not a problem to report.
            if (response.status === 409) {
                await this.editFolderHome(fullPath);
                return;
            }
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to create folder home');
            }

            // Open the new file straight into the editor.
            await this.editFolderHome(fullPath);
        } catch (error) {
            console.error('[NavigationController] createFolderHome failed:', error);
            this.app.showNotification(error.message || 'Failed to create folder home', 'error');
        }
    },

    /**
     * Delete the folder's home page (`.home.md` / `home.md`).
     *
     * A folder home is hidden from the tree and the folder listing, so the normal
     * right-click → Delete never reaches it — this button beside Edit is its only
     * way out. That matters beyond tidiness: the context build seeds a `.home.md`
     * and thereafter only rewrites one it can prove it wrote, so deleting is how a
     * reader hands a hand-edited (or simply unwanted) page back to the build.
     *
     * Deliberately NOT routed through `handleDeleteItem`: that helper only reloads
     * the folder view when `currentFolder === parentPath`, which is false at the
     * space root (the view holds '/' while the home file's parent is ''), and its
     * generic "this action cannot be undone" wording says nothing about what a
     * reader actually wants to know here — whether the folder's documents go too.
     */
    async deleteFolderHome() {
        const homePath = this.currentFolderHomePath;
        if (!homePath || !this.app.currentSpace) return;

        const folderPath = this.app.currentFolder;
        const folderLabel = (folderPath && folderPath !== '/')
            ? (folderPath.split('/').pop() || folderPath)
            : (this.app.currentSpace.name || 'this space');

        const confirmed = window.confirm(
            `Delete the home page for "${folderLabel}"?\n\n`
            + 'Only the landing page is removed — the folder and everything in it stay '
            + 'exactly as they are. If this page was generated from the folder context, '
            + 'the next context rebuild will write a fresh one.'
        );
        if (!confirmed) return;

        try {
            const response = await fetch(
                `/applications/wiki/api/documents/${encodeURIComponent(homePath)}`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        spaceId: this.app.currentSpace.id,
                        spaceName: this.app.currentSpace.name,
                        path: homePath
                    })
                }
            );
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || `Failed to delete the folder home (${response.status})`);
            }

            this.app.showNotification('Folder home deleted', 'success');

            // The tree tracks it even though it never shows it: `_effectiveFolderStatus`
            // reads `.home.md` out of a folder's children to decide that an otherwise
            // empty folder still has something to show, so a stale node would keep the
            // folder rendering as active.
            const parentPath = folderPath === '/' ? '' : (folderPath || '');
            await this.updateTreeNode(parentPath);
            await this.loadFolderContent(folderPath);
        } catch (error) {
            console.error('[NavigationController] deleteFolderHome failed:', error);
            this.app.showNotification(error.message || 'Failed to delete the folder home', 'error');
        }
    },

    showFolderView(folderContent, folderHome = null) {
        // Backwards-compatible: old callers passed a plain html string.
        if (typeof folderHome === 'string') {
            folderHome = { html: folderHome, path: null };
        }

        // Store the current folder path for context menu
        this.app.currentFolder = folderContent.path;
        // Mark that the folder grid is the active view. Multiple gates
        // (optimistic post-create/delete reloads, event-bus updaters in
        // navigationUpdater.js) check `currentView === 'folder'` to decide
        // whether to re-render the grid; without this assignment those
        // checks were silently false and the grid drifted out of sync
        // with fullFileTree on event-driven changes.
        this.app.currentView = 'folder';

        // Stash the home file path so the edit/add buttons can find it on click.
        this.currentFolderHomePath = folderHome?.path || null;

        // Update folder viewer state so event bus knows what's being viewed
        folderViewerState.setCurrentFolder(folderContent.path, this.currentViewMode);

        // Initialize item counts from folderContent
        folderViewerState.itemCount.files = folderContent.stats.files;
        folderViewerState.itemCount.folders = folderContent.stats.folders;

        // Stash so the presentation mode can read the folder's files in order.
        this.currentFolderContent = folderContent;

        // Update the main content to show folder overview
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) return;

        // Calculate total items for each type
        const totalFiles = folderContent.stats.files;
        const totalFolders = folderContent.stats.folders;

        // Markdown files (in folder order) are what "Present" cycles through.
        const presentableFiles = (folderContent.files || [])
            .filter(f => /\.md$/i.test(f.path || f.name || ''));

        // Create folder view HTML with Bootstrap styling
        const folderViewHtml = `
            <div id="folderView" class="view">
                <div class="folder-header">
                    <nav class="breadcrumb mb-3">
                        <a href="#" id="spacesLink" style="color: var(--kr-teal-600, #12284b); font-weight: bold;" class="text-decoration-none">Spaces</a>
                        <span class="breadcrumb-separator">/</span>
                        ${this.renderFolderBreadcrumbSegments(folderContent.spaceName, folderContent.path)}
                    </nav>

                    ${folderContent.path !== '/' ? `
                        <div class="kr-doc-toolbar folder-title-section">
                            <div class="lhs">
                                <div class="doc-icon folder-main-icon"><i class="bi bi-folder" style="font-size: 18px;"></i></div>
                                <div class="folder-title-info">
                                    <h2>${folderContent.title}</h2>
                                    <div class="meta folder-stats">
                                        ${totalFiles > 0 ? `<span class="stat-badge">${totalFiles} file${totalFiles !== 1 ? 's' : ''}</span>` : ''}
                                        ${totalFolders > 0 ? `<span class="stat-badge">${totalFolders} folder${totalFolders !== 1 ? 's' : ''}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            <div class="rhs">
                                ${presentableFiles.length > 0 ? `
                                    <button class="btn btn-ghost btn-sm" id="presentFolderBtn" title="Present every markdown file in this folder full-screen (← → to navigate, Esc to exit)">
                                        <i class="bi bi-easel"></i>
                                        <span>Present</span>
                                    </button>
                                ` : ''}
                                <button class="btn btn-ghost btn-sm" id="refreshFolderBtn" style="display: none;" title="Refresh content based on workflow">
                                    <i class="bi bi-arrow-clockwise"></i>
                                    <span>Refresh</span>
                                </button>
                                <button class="btn btn-ghost btn-sm pin-btn" id="pinFolderBtn">
                                    <i class="bi bi-pin-angle"></i>
                                    <span class="pin-text">Pin</span>
                                </button>
                                <button class="btn btn-ghost btn-sm" id="shareFolderBtn" title="Copy a shareable link to this folder">
                                    <i class="bi bi-share"></i>
                                    <span>Share</span>
                                </button>
                                <button class="btn btn-ghost btn-sm" id="subscribeFolderBtn" title="Subscribe to changes in this folder">
                                    <i class="bi bi-bell"></i>
                                    <span class="subscribe-text">Subscribe</span>
                                </button>
                                ${!folderHome && !this.isReadOnlyMode ? `
                                    <button class="btn btn-ghost btn-sm" id="addFolderHomeBtn" title="Create a hidden .home.md introduction for this folder">
                                        <i class="bi bi-plus-lg"></i> Add folder home
                                    </button>
                                ` : ''}
                                ${!this.isReadOnlyMode ? `
                                    <button class="btn btn-ghost btn-sm" id="rebuildContextBtn" title="Regenerate the AI context for this folder and every folder beneath it, overwriting what is there. Runs as a workflow — track it in Datasources → Executions.">
                                        <i class="bi bi-stars"></i>
                                        <span>Rebuild context</span>
                                    </button>
                                ` : ''}
                                ${!folderHome ? `
                                    <button type="button" class="btn btn-ghost btn-sm kr-notes-chip" data-notes-toggle
                                            title="Your private notes about this folder">
                                        <i class="bi bi-journal-text"></i> <span>Notes</span>
                                        <span class="kr-notes-count" data-notes-count hidden>0</span>
                                    </button>
                                ` : ''}
                                <div class="kr-seg view-mode-switcher">
                                    <button class="view-mode-btn ${this.currentViewMode === 'details' ? 'active' : ''}" data-view="details" title="List view">
                                        <i class="bi bi-list-ul"></i> List
                                    </button>
                                    <button class="view-mode-btn ${this.currentViewMode === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
                                        <i class="bi bi-grid-3x3-gap"></i> Grid
                                    </button>
                                    <button class="view-mode-btn ${this.currentViewMode === 'feature' ? 'active' : ''}" data-view="feature" title="Feature view — cover image and headline">
                                        <i class="bi bi-view-stacked"></i> Feature
                                    </button>
                                    <button class="view-mode-btn ${this.currentViewMode === 'cards' ? 'active' : ''}" data-view="cards" title="Cards view">
                                        <i class="bi bi-card-image"></i> Cards
                                    </button>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>

                ${folderHome ? `
                    <div class="folder-home-content kr-surface mb-3" style="position: relative;">
                        <!-- Notes sits beside Edit on the content itself (see
                             notesController): the actions belong to the page a
                             reader is looking at, not to the folder toolbar. -->
                        <div class="kr-content-actions">
                            ${!this.isReadOnlyMode && folderHome.path ? `
                                <button type="button" class="btn btn-ghost btn-sm" data-link-documents
                                        data-link-path="${this.escapeHtml(folderHome.path)}"
                                        data-link-space="${this.escapeHtml(folderContent.spaceName || this.app?.currentSpace?.name || '')}"
                                        data-link-title="${this.escapeHtml(folderContent.title || '')}"
                                        title="Link related documents and folders to this page">
                                    <i class="bi bi-diagram-3"></i> Link documents
                                </button>
                            ` : ''}
                            <button type="button" class="btn btn-ghost btn-sm kr-notes-chip" data-notes-toggle
                                    title="Your private notes about this folder">
                                <i class="bi bi-journal-text"></i> <span>Notes</span>
                                <span class="kr-notes-count" data-notes-count hidden>0</span>
                            </button>
                            ${!this.isReadOnlyMode ? `
                                <button class="btn btn-ghost btn-sm" id="editFolderHomeBtn"
                                    title="Edit ${this.escapeHtml(folderHome.path || 'folder home')}">
                                    <i class="bi bi-pencil"></i> Edit
                                </button>
                                <button class="btn btn-ghost btn-sm" id="deleteFolderHomeBtn"
                                    title="Delete this folder's home page. The folder's documents are not affected, and a page the context build seeded is regenerated on the next rebuild.">
                                    <i class="bi bi-trash"></i> Delete
                                </button>
                            ` : ''}
                        </div>
                        <div class="kr-surface-body markdown-content" style="padding: 24px 28px;">
                            ${folderHome.html}
                        </div>
                    </div>
                ` : ''}

                <div class="folder-content">
                    ${folderContent.folders.length === 0 && folderContent.files.length === 0 ? `
                        <div class="empty-folder">
                            <i class="bi bi-folder empty-folder-icon"></i>
                            <p>This folder is empty</p>
                        </div>
                    ` : this.renderFolderContentByMode(folderContent)}
                </div>
            </div>
        `;

        // Remove existing folder view if any
        const existingFolderView = document.getElementById('folderView');
        if (existingFolderView) {
            existingFolderView.remove();
        }

        // Add the new folder view
        mainContent.insertAdjacentHTML('beforeend', folderViewHtml);

        // NOW switch to the folder view (after it's been created in DOM)
        this.app.setActiveView('folder');

        // Extract workflow metadata from folder home content and set up refresh button
        if (folderHome && folderHome.content) {
            this.currentFolderWorkflowMeta = this.extractFolderWorkflowMeta(folderHome.content);
            if (this.currentFolderWorkflowMeta) {
                const refreshBtn = document.getElementById('refreshFolderBtn');
                if (refreshBtn) {
                    refreshBtn.style.display = '';
                }
            }
        } else {
            this.currentFolderWorkflowMeta = null;
        }

        // Bind events for the folder view
        this.bindFolderViewEvents();

        // Point the notes panel at this folder. The space root arrives as '/',
        // which the controller normalises to '' — the same key the space home
        // uses when it has no landing page, so both reach one set of notes.
        notesController.setTarget({
            type: 'folder',
            path: folderContent.path === '/' ? '' : folderContent.path,
            title: folderContent.title || this.app?.currentSpace?.name || '',
            spaceName: folderContent.spaceName || this.app?.currentSpace?.name
        });

        // Build the left-nav "On this page" outline from the folder-home
        // (.home.md / home.md) content, so a folder landing page is navigable
        // just like a normal document. setActiveView('folder') above cleared
        // any previous outline, so this runs last.
        if (folderHome) {
            const homeContent = document.querySelector('#folderView .folder-home-content');
            if (homeContent) {
                documentOutline.build(homeContent);
                // The folder-home markdown can contain ```pane``` / ```visualisation```
                // blocks. The parser only emits inert placeholders, so hydrate them
                // here exactly as the normal document view does (documentcontroller),
                // otherwise an embedded pane never pulls in its source content.
                const homeDoc = {
                    spaceName: this.app.currentSpace?.name,
                    path: folderHome.path,
                    content: folderHome.content
                };
                paneController.hydrate(homeContent, homeDoc);
                visualisationController.hydrate(homeContent, homeDoc);
                linkedDocumentsController.hydrate(homeContent, homeDoc);
                recentChangesController.hydrate(homeContent, homeDoc);
            }
        }
    },

    renderFolderContentByMode(folderContent) {
        return this.renderUnifiedFileList(folderContent, this.currentViewMode, {
            type: 'folder',
            draggable: !this.isReadOnlyMode,
        });
    },

    renderGridView(folderContent) {
        return `
            <div class="items-cards row">
                ${folderContent.folders.map(folder => {
                    const childCount = folder.childCount || 0;
                    const created = folder.created || folder.createdAt || '';
                    const formattedDate = created ? new Date(created).toLocaleDateString() : 'N/A';

                    return `
                        <div class="col-md-4 col-lg-3 mb-4">
                            <div class="card folder-card-bootstrap" data-folder-path="${folder.path}" draggable="${!this.isReadOnlyMode}">
                                <div class="card-body text-center">
                                    <div class="card-preview card-preview-folder">
                                        <i class="bi bi-folder" style="font-size: 56px; color: #6c757d;"></i>
                                    </div>
                                </div>
                                <div class="card-footer">
                                    <div class="card-title-text"><strong>${folder.name}</strong></div>
                                    <small class="text-muted">${childCount} item${childCount !== 1 ? 's' : ''}</small><br>
                                    <small class="text-muted">${formattedDate}</small>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
                ${folderContent.files.map(file => {
                    const fileTypeInfo = this.getFileTypeInfo(file.path || file.name);
                    const iconClass = this.getFileTypeIconClass(fileTypeInfo.category);
                    const iconColor = fileTypeInfo.color;
                    const size = file.size || file.metadata?.size || 0;
                    const formattedSize = this.formatFileSize(size);
                    const created = file.created || file.createdAt || file.metadata?.created || '';
                    const formattedDate = created ? new Date(created).toLocaleDateString() : 'N/A';
                    const fileExt = this.getFileTypeFromExtension(file.path || file.name);
                    const viewer = fileTypeInfo.category;

                    return `
                        <div class="col-md-4 col-lg-3 mb-4">
                            <div class="card file-card-bootstrap"
                                data-document-path="${file.path}"
                                data-space-name="${file.spaceName}"
                                data-viewer="${viewer}"
                                draggable="${!this.isReadOnlyMode}">
                                <div class="card-body text-center">
                                    <div class="card-preview card-preview-loading" data-file-path="${file.path}" data-space-name="${file.spaceName}">
                                        <div class="spinner-border text-secondary" role="status">
                                            <span class="visually-hidden">Loading...</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="card-footer">
                                    <div class="card-title-text"><strong>${file.title || file.name}</strong></div>
                                    <small class="text-muted">${fileExt} • ${formattedSize}</small><br>
                                    <small class="text-muted">${formattedDate}</small>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderDetailsView(folderContent) {
        return `
            <div class="items-details">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th style="width: 40px;"></th>
                            <th>Name</th>
                            <th style="width: 120px;">Size</th>
                            <th style="width: 180px;">Date Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${folderContent.folders.map(folder => {
                            const childCount = folder.childCount || 0;
                            const created = folder.created || folder.createdAt || '';
                            const formattedDate = created ? new Date(created).toLocaleDateString() : 'N/A';

                            return `
                                <tr class="folder-row" data-folder-path="${folder.path}" draggable="${!this.isReadOnlyMode}">
                                    <td><i class="bi bi-folder" style="color: #6c757d; font-size: 16.8px;"></i></td>
                                    <td><strong>${folder.name}</strong></td>
                                    <td class="text-muted">${childCount} item${childCount !== 1 ? 's' : ''}</td>
                                    <td class="text-muted">${formattedDate}</td>
                                </tr>
                            `;
                        }).join('')}
                        ${folderContent.files.map(file => {
                            const fileTypeInfo = this.getFileTypeInfo(file.path || file.name);
                            const iconClass = this.getFileTypeIconClass(fileTypeInfo.category);
                            const iconColor = fileTypeInfo.color;
                            const size = file.size || file.metadata?.size || 0;
                            const formattedSize = this.formatFileSize(size);
                            const created = file.created || file.createdAt || file.metadata?.created || '';
                            const formattedDate = created ? new Date(created).toLocaleDateString() : 'N/A';

                            return `
                                <tr class="file-row" data-document-path="${file.path}" data-space-name="${file.spaceName}" draggable="${!this.isReadOnlyMode}">
                                    <td><i class="bi ${iconClass}" style="color: ${iconColor}; font-size: 16.8px;"></i></td>
                                    <td>${file.title || file.name}</td>
                                    <td class="text-muted">${formattedSize}</td>
                                    <td class="text-muted">${formattedDate}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    renderCardsView(folderContent) {
        return `
            <div class="items-preview-cards">
                ${folderContent.folders.map(folder => {
                    const childCount = folder.childCount || 0;
                    const created = folder.created || folder.createdAt || '';
                    const formattedDate = created ? new Date(created).toLocaleDateString() : '';
                    return `
                        <div class="preview-card preview-folder-card" data-folder-path="${folder.path}">
                            <div class="preview-card-header">
                                <i class="bi bi-folder preview-card-icon" style="color:#6c757d;"></i>
                                <span class="preview-card-title">${folder.name}</span>
                                <button class="preview-card-open-btn" data-folder-path="${folder.path}" title="Open folder">
                                    <i class="bi bi-arrow-right-circle-fill"></i>
                                </button>
                            </div>
                            <div class="preview-card-content preview-folder-content">
                                <div class="folder-preview-info">
                                    <i class="bi bi-folder" style="font-size:56px;color:#6c757d;"></i>
                                    <div class="mt-3 fw-semibold">${folder.name}</div>
                                    <div class="text-muted">${childCount} item${childCount !== 1 ? 's' : ''}</div>
                                    ${formattedDate ? `<small class="text-muted">${formattedDate}</small>` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
                ${folderContent.files.map(file => {
                    const fileTypeInfo = this.getFileTypeInfo(file.path || file.name);
                    const iconClass = this.getFileTypeIconClass(fileTypeInfo.category);
                    const iconColor = fileTypeInfo.color;
                    const fileExt = this.getFileTypeFromExtension(file.path || file.name);
                    return `
                        <div class="preview-card preview-file-card" data-document-path="${file.path}" data-space-name="${file.spaceName}">
                            <div class="preview-card-header">
                                <i class="bi ${iconClass} preview-card-icon" style="color:${iconColor};"></i>
                                <span class="preview-card-title">${file.title || file.name}</span>
                                <small class="text-muted me-3">${fileExt}</small>
                                <button class="preview-card-open-btn" data-document-path="${file.path}" data-space-name="${file.spaceName}" title="Open file">
                                    <i class="bi bi-arrow-right-circle-fill"></i>
                                </button>
                            </div>
                            <div class="preview-card-content preview-card-content-loading" data-file-path="${file.path}" data-space-name="${file.spaceName}">
                                <div class="d-flex align-items-center justify-content-center h-100">
                                    <div class="spinner-border text-secondary" role="status">
                                        <span class="visually-hidden">Loading...</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderUnifiedFileList(items, viewMode, context = {}) {
        const ctx = this._buildRenderContext(context);
        const folders = (!Array.isArray(items) && items.folders) ? items.folders : [];
        const files   = Array.isArray(items) ? items : (items.files || []);
        switch (viewMode) {
            case 'details': return this._renderKrRows(folders, files, ctx);
            case 'cards':   return this._renderUnifiedCards(folders, files, ctx);
            case 'feature': return this._renderFeatureCards(folders, files, ctx);
            case 'grid':
            default:        return this._renderUnifiedGrid(folders, files, ctx);
        }
    },

    // --- Shared result-presentation helpers (list / grid / cards) ---------

    _escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    /** True when the path points at a folder-home file (.home.md / home.md). */
    _isFolderHome(path) {
        const base = (this.getFileNameFromPath(path) || '').toLowerCase();
        return base === '.home.md' || base === 'home.md';
    },

    /**
     * Display name for a file. A folder-home file shows its folder's name
     * (e.g. ".../Engineering/.home.md" → "Engineering", or "Home" at the root)
     * rather than the literal ".home.md".
     */
    _displayName(file) {
        const path = file.path || '';
        if (this._isFolderHome(path)) {
            const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
            const folder = dir ? dir.substring(dir.lastIndexOf('/') + 1) : '';
            return folder || 'Home';
        }
        const title = file.title;
        if (title && title !== '.home' && title !== '.home.md') return title;
        return this.getFileNameFromPath(path) || file.name || 'Untitled';
    },

    /** Small "Folder home" pill, shown only for folder-home files. */
    _folderHomeBadge(file) {
        return this._isFolderHome(file.path) ? '<span class="kr-home-badge">Folder home</span>' : '';
    },

    /**
     * Breadcrumb for a file:
     * Space › Folder Level 1 › Folder Level 2 › … › <highlighted parent folder>.
     *
     * The first two folder levels are always spelled out — they are the same
     * axes the search Filters sidebar facets on, so a reader can tell which
     * bucket a result came from without opening it. Search results carry
     * `folderL1`/`folderL2` stamped by the indexer; the other lists (recent /
     * starred / folder) carry no facet fields, so both are derived from the
     * path instead. Only the segments BETWEEN level 2 and the parent folder
     * collapse into "…", and a level is never repeated as the parent folder:
     * a file at the space root shows just the space, and one directly under a
     * top-level folder shows "Space › Folder".
     */
    _renderResultPath(file) {
        const esc = this._escapeHtml.bind(this);
        const space = file.spaceName && file.spaceName !== 'Unknown Space' ? file.spaceName : '';
        const path = file.path || '';
        const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
        const segs = dir.split('/').filter(Boolean);

        const parts = [];
        if (space) parts.push(`<span class="kr-bc-space"><i class="bi bi-grid-3x3-gap"></i> ${esc(space)}</span>`);

        // The deepest folder is rendered below as the highlighted parent, so
        // only show the levels that sit above it.
        const levels = [file.folderL1 || segs[0] || '', file.folderL2 || segs[1] || ''].filter(Boolean);
        for (const level of levels.slice(0, Math.max(0, segs.length - 1))) {
            parts.push(`<span class="kr-bc-level" title="${esc(level)}">${esc(level)}</span>`);
        }

        if (segs.length) {
            if (segs.length > 3) parts.push('<span class="kr-bc-ellipsis">…</span>');
            parts.push(`<span class="kr-bc-folder">${esc(segs[segs.length - 1])}</span>`);
        }
        return parts.join('<span class="kr-bc-sep">›</span>');
    },

    /**
     * Excerpt block showing the matched content, when present. Returns '' for
     * lists that carry no excerpt (recent/starred/folder) or the search
     * placeholder so nothing renders.
     */
    _resultExcerpt(file) {
        // Prefer the search engine's match-centered snippet (it highlights the
        // hit with <mark> and clamps to a sentence around it). Non-search lists
        // (recent / starred / folder) carry no snippet, so they fall through to
        // the document excerpt below.
        if (file.snippet && String(file.snippet).trim()) {
            const snip = this._resultSnippet(file);
            if (snip) return snip;
        }
        const ex = (file.excerpt || '').trim();
        if (!ex || ex === 'No description available') return '';
        const inner = this._isRenderableMarkdown(ex)
            ? this._renderInlineMarkdown(ex)              // clean markdown → render (inline)
            : this._escapeHtml(this._stripMarkdown(ex));  // noisy/broken → strip control chars
        if (!inner) return '';
        return `<div class="kr-result-excerpt">${inner}</div>`;
    },

    /**
     * Render the search engine's context snippet. The core search service hands
     * us plain text with the matched terms already wrapped in <mark>…</mark>.
     * We strip markdown noise, escape the whole string, then re-enable ONLY our
     * own <mark> tags — so any stray angle brackets or markup in the source
     * content can never inject HTML while the highlight still renders.
     */
    _resultSnippet(file) {
        const raw = String(file.snippet || '').trim();
        if (!raw) return '';
        const escaped = this._escapeHtml(this._stripMarkdown(raw))
            .replace(/&lt;mark&gt;/gi, '<mark>')
            .replace(/&lt;\/mark&gt;/gi, '</mark>');
        // Nothing but tags/whitespace/ellipses left → render nothing.
        if (!escaped.replace(/<\/?mark>/gi, '').replace(/…/g, '').trim()) return '';
        return `<div class="kr-result-excerpt kr-result-snippet">${escaped}</div>`;
    },

    /**
     * Heuristic for whether an excerpt is clean, inline-level markdown that is
     * safe to render. Block/structural markdown — most often a flattened or
     * truncated table from a search snippet — is rejected so it goes down the
     * strip path instead. Returns true only when there's actual inline markdown
     * worth rendering (emphasis, code, links).
     */
    _isRenderableMarkdown(text) {
        if (/\|/.test(text)) return false;                      // table pipes
        if (/-{2,}/.test(text)) return false;                   // table rules / hr
        if (/(^|\n)\s{0,3}#{1,6}\s/.test(text)) return false;   // headings
        if (/```/.test(text)) return false;                     // fenced code (often truncated)
        return /(\*\*|__|\*|_|`|\[[^\]]+\]\([^)]+\))/.test(text);
    },

    /**
     * Render inline-level markdown via the shared markdown parser, then keep
     * only a safe inline subset (emphasis, code, links) — block elements,
     * tables, images and scripts are dropped so the excerpt stays single-line
     * friendly. Falls back to stripped plain text if the parser is unavailable.
     */
    _renderInlineMarkdown(text) {
        try {
            if (typeof window === 'undefined' || typeof window.parseMarkdown !== 'function' || typeof document === 'undefined') {
                return this._escapeHtml(this._stripMarkdown(text));
            }
            const tmp = document.createElement('div');
            tmp.innerHTML = window.parseMarkdown(text);
            tmp.querySelectorAll('script,style,table,thead,tbody,tr,td,th,pre,img,h1,h2,h3,h4,h5,h6').forEach(el => el.remove());
            const inline = this._sanitizeInline(tmp).replace(/\s{2,}/g, ' ').trim();
            return inline || this._escapeHtml(this._stripMarkdown(text));
        } catch (_) {
            return this._escapeHtml(this._stripMarkdown(text));
        }
    },

    /**
     * Recursively serialise a node to escaped text, preserving only a small
     * whitelist of inline tags. Disallowed elements are unwrapped (their text
     * is kept). Used to sanitise parser output for inline excerpt display.
     */
    _sanitizeInline(node) {
        const ALLOWED = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', CODE: 'code', DEL: 'del', MARK: 'mark', A: 'a' };
        let out = '';
        node.childNodes.forEach(child => {
            if (child.nodeType === 3) {
                out += this._escapeHtml(child.nodeValue);
            } else if (child.nodeType === 1) {
                const tag = ALLOWED[child.tagName];
                const inner = this._sanitizeInline(child);
                if (tag === 'a') {
                    const href = child.getAttribute('href') || '';
                    out += `<a href="${this._escapeHtml(href)}" target="_blank" rel="noopener">${inner}</a>`;
                } else if (tag) {
                    out += `<${tag}>${inner}</${tag}>`;
                } else {
                    out += inner; // unwrap unknown/block tags, keep their content
                }
            }
        });
        return out;
    },

    /** Strip markdown control characters, leaving clean readable plain text. */
    _stripMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                                   // images
            .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => { const x = m.match(/\[([^\]]*)\]/); return x ? x[1] : ''; }) // links → text
            .replace(/```[\s\S]*?```/g, '')                                          // fenced code
            .replace(/`([^`]+)`/g, '$1')                                             // inline code
            .replace(/#{1,6}\s+/g, '')                                               // headings
            .replace(/(\*\*|__)(.*?)\1/g, '$2')                                      // bold
            .replace(/(\*|_)(.*?)\1/g, '$2')                                         // italic
            .replace(/~~(.*?)~~/g, '$1')                                             // strikethrough
            .replace(/^\s*[-*+]\s+/gm, '')                                           // unordered list markers
            .replace(/^\s*\d+\.\s+/gm, '')                                           // ordered list markers
            .replace(/^\s*>\s+/gm, '')                                               // blockquotes
            .replace(/\|/g, ' ')                                                     // table pipes
            .replace(/-{2,}/g, ' ')                                                  // table rules / hr
            .replace(/[*`]/g, '')                                                    // stray emphasis/code chars
            .replace(/\n+/g, ' ')                                                    // newlines → space
            .replace(/\s{2,}/g, ' ')                                                 // collapse whitespace
            .trim();
    },

    _renderKrRows(folders, files, ctx) {
        const escape = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const folderRows = folders.map(folder => {
            const childCount = folder.childCount || 0;
            const fDateRaw   = folder[ctx.dateField] || folder.modified || folder.created || '';
            const fDateStr   = fDateRaw ? this._formatRelativeTime(fDateRaw) : '';
            const fDateTitle = fDateRaw ? this._formatAbsoluteTime(fDateRaw) : '';
            const fDatePrefix= (ctx.showDateLabel && fDateStr) ? `${ctx.dateLabel} ` : '';
            return `
                <div class="kr-file-row nav-folder-item" data-folder-path="${escape(folder.path)}" draggable="${ctx.draggable}">
                    <div class="ftype" style="background: var(--kr-teal-100); color: var(--kr-teal-700);"><i class="bi bi-folder"></i></div>
                    <div>
                        <div class="fname">${escape(folder.name)}</div>
                        <div class="fpath"><i class="bi bi-folder2"></i> ${childCount} item${childCount!==1?'s':''}</div>
                    </div>
                    <span></span>
                    <span class="ftime" title="${escape(fDateTitle)}">${escape(fDatePrefix + fDateStr)}</span>
                    <button class="frow-act"><i class="bi bi-three-dots"></i></button>
                </div>`;
        }).join('');

        const fileRows = files.map(file => {
            const fileTypeInfo = this.getFileTypeInfo(file.path || file.name || '');
            const rawName      = file.path || file.name || '';
            const lastDot      = rawName.lastIndexOf('.');
            const fileExt      = (lastDot >= 0 ? rawName.slice(lastDot + 1) : 'doc').toLowerCase();
            const fileName     = this._displayName(file);
            const path         = file.path || '';
            const dateRaw      = file[ctx.dateField] || file.modified || file.modifiedAt || file.created || file.createdAt || '';
            const dateStr      = dateRaw ? this._formatRelativeTime(dateRaw) : '';
            const dateTitle    = dateRaw ? this._formatAbsoluteTime(dateRaw) : '';
            const datePrefix   = (ctx.showDateLabel && dateStr) ? `${ctx.dateLabel} ` : '';
            const space        = file.spaceName || '';
            const viewer       = fileTypeInfo.category;
            const excerptHtml  = this._resultExcerpt(file);
            const pathHtml     = this._renderResultPath(file);

            return `
                <div class="kr-file-row nav-file-item" data-document-path="${escape(path)}" data-space-name="${escape(space)}" data-viewer="${viewer}" draggable="${ctx.draggable}">
                    <div class="ftype">${escape(fileExt.slice(0, 4))}</div>
                    <div>
                        <div class="fname">${escape(fileName)}${this._folderHomeBadge(file)}</div>
                        ${excerptHtml}
                        <div class="fpath">${pathHtml}</div>
                    </div>
                    <span></span>
                    <span class="ftime" title="${escape(dateTitle)}">${escape(datePrefix + dateStr)}</span>
                    <button class="frow-act"><i class="bi bi-three-dots"></i></button>
                </div>`;
        }).join('');

        if (!folderRows && !fileRows) return '';
        return `<div class="kr-file-rows">${folderRows}${fileRows}</div>`;
    },

    _formatRelativeTime(dateInput) {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return '';
        const now = Date.now();
        const diff = Math.max(0, now - d.getTime());
        const min = 60_000, hr = 60 * min, day = 24 * hr;
        if (diff < min) return 'just now';
        if (diff < hr)  return `${Math.floor(diff / min)} min ago`;
        if (diff < day) return `${Math.floor(diff / hr)} hour${Math.floor(diff / hr) === 1 ? '' : 's'} ago`;
        if (diff < 2 * day) return 'Yesterday';
        if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
        return d.toLocaleDateString();
    },

    /** Absolute, full timestamp for hover tooltips (e.g. "15/07/2026, 14:03"). */
    _formatAbsoluteTime(dateInput) {
        const d = new Date(dateInput);
        return isNaN(d.getTime()) ? '' : d.toLocaleString();
    },

    _buildRenderContext(context) {
        const type = context.type || 'folder';
        // Folder browsing shows each item's last-updated (modified) time, so a
        // reader can tell at a glance which documents changed recently. The
        // recent/starred/search lists keep their own context-specific date.
        const dateFields  = { recent: 'visitedAt', starred: 'starredAt', search: 'modifiedAt', folder: 'modified' };
        const dateLabels  = { recent: 'Visited',   starred: 'Starred',   search: 'Modified',  folder: 'Updated'  };
        return {
            type,
            dateField:    context.dateField    || dateFields[type]  || 'modified',
            dateLabel:    context.dateLabel    || dateLabels[type]  || 'Updated',
            // Prefix the date with its label ("Updated …") in folder browsing so
            // it's unambiguous. Off by default for the other lists, which keep
            // their existing bare-date presentation.
            showDateLabel:context.showDateLabel!== undefined ? context.showDateLabel: (type === 'folder'),
            showPath:     context.showPath     !== undefined ? context.showPath     : (type !== 'folder'),
            showSpaceName:context.showSpaceName!== undefined ? context.showSpaceName: (type !== 'folder'),
            draggable:    context.draggable    !== undefined ? context.draggable    : (type === 'folder'),
            colClass:     context.colClass     || 'col-md-4 col-lg-3',
            actionType:   context.actionType   || null,
        };
    },

    _renderUnifiedGrid(folders, files, ctx) {
        const folderCards = folders.map(folder => {
            const childCount = folder.childCount || 0;
            const dateRaw    = folder[ctx.dateField] || folder.modified || folder.created || folder.createdAt || '';
            const dateStr    = dateRaw ? new Date(dateRaw).toLocaleDateString() : 'N/A';
            const datePrefix = (ctx.showDateLabel && dateRaw) ? `${ctx.dateLabel} ` : '';
            const dateTitle  = dateRaw ? this._formatAbsoluteTime(dateRaw) : '';
            return `
                <div class="${ctx.colClass} mb-4">
                    <div class="card folder-card-bootstrap" data-folder-path="${folder.path}" draggable="${ctx.draggable}">
                        <div class="card-body kr-tile-body">
                            <div class="card-preview kr-tile-cover" data-cover-pending
                                 data-folder-path="${this._escapeHtml(folder.path || '')}"
                                 data-space-id="${this._escapeHtml(this.app?.currentSpace?.id || '')}">
                                ${this._featureGenericCover('', true)}
                            </div>
                        </div>
                        <div class="card-footer">
                            <div class="card-title-text"><strong>${folder.name}</strong></div>
                            <small class="text-muted">${childCount} item${childCount!==1?'s':''}</small><br>
                            <small class="text-muted" title="${dateTitle}">${datePrefix}${dateStr}</small>
                        </div>
                    </div>
                </div>`;
        }).join('');

        const fileCards = files.map(file => {
            const fileTypeInfo = this.getFileTypeInfo(file.path || file.name || '');
            const iconClass    = this.getFileTypeIconClass(fileTypeInfo.category);
            const iconColor    = fileTypeInfo.color;
            const fileExt      = this.getFileTypeFromExtension(file.path || file.name || '');
            const size         = file.size || file.metadata?.size || 0;
            const formattedSize = this.formatFileSize(size);
            const dateRaw      = file[ctx.dateField] || file.modified || file.created || file.createdAt || file.metadata?.created || '';
            const dateStr      = dateRaw ? new Date(dateRaw).toLocaleDateString() : 'N/A';
            const datePrefix   = (ctx.showDateLabel && dateRaw) ? `${ctx.dateLabel} ` : '';
            const dateTitle    = dateRaw ? this._formatAbsoluteTime(dateRaw) : '';
            const escapedPath  = (file.path || '').replace(/"/g, '&quot;');
            const escapedSpace = (file.spaceName || '').replace(/"/g, '&quot;');
            const viewer       = fileTypeInfo.category;
            const actionBtn    = this._buildActionButton(file, ctx, 'grid');
            const subtitle     = ctx.showPath
                ? `${this._resultExcerpt(file)}<div class="kr-result-path">${this._renderResultPath(file)}</div>`
                : `<small class="text-muted">${fileExt} • ${formattedSize}</small><br><small class="text-muted" title="${dateTitle}">${datePrefix}${dateStr}</small>`;
            return `
                <div class="${ctx.colClass} mb-4">
                    <div class="card file-card-bootstrap" data-document-path="${escapedPath}" data-space-name="${escapedSpace}" data-viewer="${viewer}" draggable="${ctx.draggable}" style="position:relative;">
                        <div class="card-body kr-tile-body">
                            <div class="card-preview kr-tile-cover" data-cover-pending
                                 data-document-path="${escapedPath}" data-space-name="${escapedSpace}">
                                ${this._featureGenericCover(file.path || file.name || '', false)}
                            </div>
                        </div>
                        <div class="card-footer">
                            <div class="card-title-text"><strong>${this._escapeHtml(this._displayName(file))}</strong>${this._folderHomeBadge(file)}</div>
                            ${subtitle}
                            ${actionBtn ? `<div class="mt-2">${actionBtn}</div>` : ''}
                        </div>
                    </div>
                </div>`;
        }).join('');

        return `<div class="items-cards row">${folderCards}${fileCards}</div>`;
    },

    _renderUnifiedDetails(folders, files, ctx) {
        const isFolderCtx = ctx.type === 'folder';

        const thead = isFolderCtx
            ? `<tr><th style="width:40px;"></th><th>Name</th><th style="width:120px;">Size</th><th style="width:180px;">Date Created</th></tr>`
            : `<tr><th style="width:30px;"></th><th>Name &amp; Path</th><th>Space</th><th>${ctx.dateLabel}</th>${ctx.actionType ? '<th style="width:80px;"></th>' : ''}</tr>`;

        const folderRows = folders.map(folder => {
            const childCount = folder.childCount || 0;
            const created    = folder.created || folder.createdAt || '';
            const dateStr    = created ? new Date(created).toLocaleDateString() : 'N/A';
            return `<tr class="folder-row" data-folder-path="${folder.path}" draggable="${ctx.draggable}">
                <td><i class="bi bi-folder" style="color:#6c757d;font-size:16.8px;"></i></td>
                <td><strong>${folder.name}</strong></td>
                <td class="text-muted">${childCount} item${childCount!==1?'s':''}</td>
                <td class="text-muted">${dateStr}</td>
            </tr>`;
        }).join('');

        const fileRows = files.map(file => {
            const fileTypeInfo = this.getFileTypeInfo(file.path || file.name || '');
            const iconClass    = this.getFileTypeIconClass(fileTypeInfo.category);
            const iconColor    = fileTypeInfo.color;
            const fileName     = file.title || this.getFileNameFromPath(file.path);
            const spaceName    = file.spaceName || 'Unknown Space';
            const size         = file.size || file.metadata?.size || 0;
            const formattedSize = this.formatFileSize(size);
            const dateRaw      = file[ctx.dateField] || file.created || file.createdAt || file.metadata?.created || '';
            const dateStr      = dateRaw ? new Date(dateRaw).toLocaleDateString() : 'N/A';
            const escapedPath  = (file.path || '').replace(/"/g, '&quot;');
            const escapedSpace = spaceName.replace(/"/g, '&quot;');
            const actionBtn    = this._buildActionButton(file, ctx, 'table');

            if (isFolderCtx) {
                return `<tr class="file-row" data-document-path="${escapedPath}" data-space-name="${escapedSpace}" draggable="${ctx.draggable}">
                    <td><i class="bi ${iconClass}" style="color:${iconColor};font-size:16.8px;"></i></td>
                    <td>${fileName}</td>
                    <td class="text-muted">${formattedSize}</td>
                    <td class="text-muted">${dateStr}</td>
                </tr>`;
            }
            return `<tr class="file-row" data-document-path="${escapedPath}" data-space-name="${escapedSpace}" style="cursor:pointer;">
                <td><i class="bi ${iconClass}" style="color:${iconColor};"></i></td>
                <td>
                    <div>${fileName}</div>
                    <small class="text-muted" style="font-size:10.5px;display:block;margin-top:4px;">📁 ${file.path||''}</small>
                </td>
                <td>${spaceName}</td>
                <td>${dateStr}</td>
                ${ctx.actionType ? `<td style="width:80px;text-align:right;">${actionBtn}</td>` : ''}
            </tr>`;
        }).join('');

        return `<div class="items-details">
            <table class="table table-hover mb-0">
                <thead>${thead}</thead>
                <tbody>${folderRows}${fileRows}</tbody>
            </table>
        </div>`;
    },

    _renderUnifiedCards(folders, files, ctx) {
        const folderCards = folders.map(folder => {
            const childCount = folder.childCount || 0;
            const dateRaw    = folder[ctx.dateField] || folder.modified || folder.created || folder.createdAt || '';
            const dateStr    = dateRaw ? new Date(dateRaw).toLocaleDateString() : '';
            const datePrefix = (ctx.showDateLabel && dateStr) ? `${ctx.dateLabel} ` : '';
            const dateTitle  = dateRaw ? this._formatAbsoluteTime(dateRaw) : '';
            const escapedPath = (folder.path || '').replace(/"/g, '&quot;');
            return `
                <div class="preview-card preview-folder-card" data-folder-path="${folder.path}" data-space-id="${this.app?.currentSpace?.id || ''}">
                    <div class="preview-card-header">
                        <i class="bi bi-folder preview-card-icon" style="color:#6c757d;"></i>
                        <span class="preview-card-title">${folder.name}</span>
                        <button class="preview-card-open-btn" data-folder-path="${folder.path}" title="Open folder">
                            <i class="bi bi-arrow-right-circle-fill"></i>
                        </button>
                    </div>
                    <div class="preview-card-content preview-folder-content preview-card-content-loading" data-folder-path="${escapedPath}" data-space-id="${this.app?.currentSpace?.id || ''}">
                        <div class="folder-preview-info">
                            <i class="bi bi-folder" style="font-size:56px;color:#6c757d;"></i>
                            <div class="mt-3 fw-semibold">${folder.name}</div>
                            <div class="text-muted">${childCount} item${childCount!==1?'s':''}</div>
                            ${dateStr ? `<small class="text-muted" title="${dateTitle}">${datePrefix}${dateStr}</small>` : ''}
                        </div>
                    </div>
                </div>`;
        }).join('');

        const fileCards = files.map(file => {
            const fileTypeInfo = this.getFileTypeInfo(file.path || file.name || '');
            const iconClass    = this.getFileTypeIconClass(fileTypeInfo.category);
            const iconColor    = fileTypeInfo.color;
            const fileExt      = this.getFileTypeFromExtension(file.path || file.name || '');
            const escapedPath  = (file.path || '').replace(/"/g, '&quot;');
            const escapedSpace = (file.spaceName || '').replace(/"/g, '&quot;');
            const actionBtn    = this._buildActionButton(file, ctx, 'card');
            const homeBadge    = this._folderHomeBadge(file);
            const pathLine     = ctx.showPath ? `<div class="kr-result-path">${this._renderResultPath(file)}</div>` : '';
            const dateRaw      = file[ctx.dateField] || file.modified || file.created || file.createdAt || file.metadata?.created || '';
            const dateStr      = dateRaw ? new Date(dateRaw).toLocaleDateString() : '';
            const dateLine     = (ctx.showDateLabel && dateStr)
                ? `<div class="kr-card-updated"><small class="text-muted" title="${this._formatAbsoluteTime(dateRaw)}">${ctx.dateLabel} ${this._escapeHtml(dateStr)}</small></div>`
                : '';
            return `
                <div class="preview-card preview-file-card" data-document-path="${escapedPath}" data-space-name="${escapedSpace}">
                    <div class="preview-card-header">
                        <i class="bi ${iconClass} preview-card-icon" style="color:${iconColor};"></i>
                        <span class="preview-card-title">${this._escapeHtml(this._displayName(file))}</span>
                        ${homeBadge}
                        <small class="text-muted me-2">${fileExt}</small>
                        ${this._renderCardQuickActions(file, ctx)}
                        ${actionBtn}
                        <button class="preview-card-open-btn" data-document-path="${escapedPath}" data-space-name="${escapedSpace}" title="Open file">
                            <i class="bi bi-arrow-right-circle-fill"></i>
                        </button>
                    </div>
                    ${pathLine}
                    ${dateLine}
                    <div class="preview-card-content preview-card-content-loading" data-file-path="${escapedPath}" data-space-name="${escapedSpace}">
                        <div class="d-flex align-items-center justify-content-center h-100">
                            <div class="spinner-border text-secondary" role="status"><span class="visually-hidden">Loading...</span></div>
                        </div>
                    </div>
                </div>`;
        }).join('');

        return `<div class="items-preview-cards">${folderCards}${fileCards}</div>`;
    },

    /**
     * "Feature" view — one wide cover-image + headline card per item, stacked.
     *
     * The cover and headline come from each document's own ```document metadata
     * block (`icon`, `headline`, plus optional `eyebrow` / `meta` / `title`),
     * which is fetched lazily per card by {@link loadFeatureCards}; a folder
     * uses its folder-home document for the same purpose. Everything here is
     * just the shell + placeholder, so the list paints immediately and the
     * per-item fetches stream in as cards scroll into view.
     *
     * Shares the `.kr-doc-card` visual with the document Card tab so the two
     * surfaces stay identical; `.kr-feature-card` adds the clickable framing.
     */
    _renderFeatureCards(folders, files, ctx) {
        const spaceId = this.app?.currentSpace?.id || '';
        const spaceName = this.app?.currentSpace?.name || '';

        const shell = (attrs, eyebrow, title, footHtml, coverHtml) => `
            <article class="kr-feature-card kr-doc-card" ${attrs} data-feature-pending="1">
                <div class="kr-card-cover">${coverHtml}</div>
                <div class="kr-card-body">
                    <div class="kr-card-eyebrow">${this._escapeHtml(eyebrow)}</div>
                    <h3 class="kr-card-title">${this._escapeHtml(title)}</h3>
                    <p class="kr-card-headline kr-card-headline--loading"></p>
                    <div class="kr-card-foot">${footHtml}</div>
                </div>
            </article>`;

        // `isFile` picks the foot's location line: result lists (search / recent
        // / starred) get the full Space › Folder L1 › Folder L2 › … breadcrumb,
        // which also carries each result's own space — the current space is only
        // meaningful while browsing a folder.
        const footFor = (item, isFile) => {
            const dateRaw = item[ctx.dateField] || item.modified || item.created || item.createdAt || '';
            const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString() : '';
            const parts = [];
            if (isFile && ctx.showPath) {
                parts.push(`<span class="kr-result-path kr-card-path">${this._renderResultPath(item)}</span>`);
            } else if (spaceName) {
                parts.push(`<span class="kr-card-space">${this._escapeHtml(spaceName)}</span>`);
            }
            if (parts.length && dateStr) parts.push('<span class="kr-card-dot">·</span>');
            if (dateStr) {
                parts.push(`<span class="kr-card-meta" title="${this._formatAbsoluteTime(dateRaw)}">`
                    + `${ctx.showDateLabel ? this._escapeHtml(ctx.dateLabel) + ' ' : 'updated '}`
                    + `${this._escapeHtml(dateStr)}</span>`);
            }
            return parts.join('');
        };

        const folderCards = folders.map((folder) => {
            const escapedPath = this._escapeHtml(folder.path || '');
            const count = folder.childCount || 0;
            return shell(
                `data-folder-path="${escapedPath}" data-space-id="${this._escapeHtml(spaceId)}"`,
                `Folder · ${count} item${count !== 1 ? 's' : ''}`,
                folder.name || '',
                footFor(folder, false),
                this._featureGenericCover('', true)
            );
        }).join('');

        const fileCards = files.map((file) => {
            const escapedPath = this._escapeHtml(file.path || '');
            const escapedSpace = this._escapeHtml(file.spaceName || spaceName);
            return shell(
                `data-document-path="${escapedPath}" data-space-name="${escapedSpace}"`,
                this.getFileTypeFromExtension(file.path || file.name || '') || 'Document',
                this._displayName(file),
                footFor(file, true),
                this._featureGenericCover(file.path || file.name || '', false)
            );
        }).join('');

        if (!folderCards && !fileCards) return '';
        return `<div class="kr-feature-list">${folderCards}${fileCards}</div>`;
    },

    /**
     * Fill each Feature card's cover + headline from its document's ```document
     * metadata block, lazily as cards approach the viewport. Uses the same
     * bounded/lazy pool as the other preview loaders so a large folder doesn't
     * fire hundreds of fetches at once.
     */
    async loadFeatureCards(root = document) {
        const cards = (root || document).querySelectorAll('.kr-feature-card[data-feature-pending]');
        await this._runPreviewPool(cards, (card) => this._renderFeatureCard(card));
    },

    /**
     * Resolve one Feature card: fetch its source (a file's own content, or a
     * folder's home document), pull the ```document metadata out of it and
     * paint the cover/eyebrow/headline. Degrades quietly at every step — the
     * shell's generic file-type cover and the card's own title stay put when
     * there is no metadata to improve on.
     */
    async _renderFeatureCard(card) {
        if (!card || !card.isConnected) return;
        card.removeAttribute('data-feature-pending');

        const spaceName = card.dataset.spaceName || this.app?.currentSpace?.name || '';
        const { content, sourcePath, viewer } = await this._fetchCoverSource({
            docPath: card.dataset.documentPath,
            folderPath: card.dataset.folderPath,
            spaceId: card.dataset.spaceId || this.app?.currentSpace?.id,
            spaceName
        });

        this._paintFeatureCard(card, content, sourcePath, spaceName, viewer);
    },

    /**
     * Fetch the source behind a cover: a document's own markdown, or a folder's
     * home document. Shared by the Feature cards and the Grid tiles. Never
     * throws — callers keep their generic cover when this comes back empty.
     * @returns {Promise<{content:string, sourcePath:string, viewer:string}>}
     */
    async _fetchCoverSource({ docPath, folderPath, spaceId, spaceName }) {
        let content = '';
        let sourcePath = '';
        let viewer = '';
        try {
            if (docPath) {
                sourcePath = docPath;
                // `enhanced=true` is required: without it this endpoint streams
                // the raw file instead of returning {content, metadata} JSON.
                const res = await fetch(
                    `/applications/wiki/api/documents/content?path=${encodeURIComponent(docPath)}`
                    + `&spaceName=${encodeURIComponent(spaceName || '')}&enhanced=true`,
                    { credentials: 'include' }
                );
                if (res.ok) {
                    const data = await res.json();
                    viewer = data.metadata?.viewer || 'text';
                    // Binary viewers return base64 — only keep text we can parse.
                    if (['markdown', 'text', 'code', 'web', 'data'].includes(viewer)) {
                        content = data.content || '';
                    }
                }
            } else if (folderPath !== undefined && folderPath !== null) {
                const found = await this._fetchFolderHome(folderPath, spaceId);
                content = found.content;
                sourcePath = found.path;
                viewer = found.path ? 'markdown' : '';
            }
        } catch (_) {
            /* leave the generic cover in place */
        }
        return { content, sourcePath, viewer };
    },

    /** Read the ```document metadata out of markdown; null when unavailable. */
    _documentMetaOf(content) {
        try {
            if (content && typeof markdownParser !== 'undefined' && markdownParser
                && typeof markdownParser.extractDocumentMeta === 'function') {
                return markdownParser.extractDocumentMeta(content);
            }
        } catch (_) { /* fall through */ }
        return null;
    },

    /**
     * Paint a cover panel in the standard order: authored `icon:` → the
     * Cards-style preview → the generic type cover already in the markup.
     * Shared by the Feature cards and the Grid tiles so the two can't drift.
     */
    _paintCover(cover, { meta, content, viewer, sourcePath, spaceName }) {
        if (!cover) return;
        const icon = String((meta && meta.icon) || '').trim();
        if (!icon) {
            this._paintFeaturePreviewCover(cover, { viewer, filePath: sourcePath, spaceName, content });
            return;
        }
        const generic = cover.innerHTML;
        const src = documentController.resolveEmbeddedMediaUrl(icon, { path: sourcePath, spaceName });
        cover.innerHTML = '';
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        img.addEventListener('error', () => {
            // Broken cover reference — restore the generic type cover rather
            // than leaving an empty panel.
            cover.innerHTML = generic;
        }, { once: true });
        img.src = src;
        cover.appendChild(img);
    },

    /**
     * Lazily fill every pending cover panel (the Grid view's tiles). Feature
     * cards use their own loader because they also paint title/headline text.
     */
    async loadCoverPanels(root = document) {
        const panels = (root || document).querySelectorAll('[data-cover-pending]');
        await this._runPreviewPool(panels, (el) => this._renderCoverPanel(el));
    },

    async _renderCoverPanel(cover) {
        if (!cover || !cover.isConnected) return;
        cover.removeAttribute('data-cover-pending');

        const spaceName = cover.dataset.spaceName || this.app?.currentSpace?.name || '';
        const { content, sourcePath, viewer } = await this._fetchCoverSource({
            docPath: cover.dataset.documentPath,
            folderPath: cover.dataset.folderPath,
            spaceId: cover.dataset.spaceId || this.app?.currentSpace?.id,
            spaceName
        });
        if (!cover.isConnected) return;

        this._paintCover(cover, {
            meta: this._documentMetaOf(content), content, viewer, sourcePath, spaceName
        });
    },

    /**
     * Fetch a folder's home document (home.md / .home.md / Home.md). The
     * single home lookup for every card view — Cards previews and Grid /
     * Feature covers both come through here so their probe order can't drift.
     *
     * Each candidate is probed with HEAD before it is fetched: most folders
     * have no home file at all, and a folder view fires one lookup per card,
     * so the common case now costs headers only. A GET (and its body) is
     * spent only on a name that actually exists.
     *
     * @returns {Promise<{content: string, path: string}>} empty strings if none.
     */
    async _fetchFolderHome(folderPath, spaceId) {
        if (!spaceId) return { content: '', path: '' };
        for (const fileName of ['home.md', '.home.md', 'Home.md']) {
            const tryPath = folderPath ? `${folderPath}/${fileName}` : fileName;
            const url = `/applications/wiki/api/spaces/${spaceId}/file-content/${encodeURIComponent(tryPath)}`;
            try {
                const head = await fetch(url, { method: 'HEAD', credentials: 'include' });
                if (!head.ok) continue;
                const res = await fetch(url, { method: 'GET', credentials: 'include' });
                if (!res.ok) continue;
                const contentType = res.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) continue;
                const data = await res.json();
                if (data.success && data.content) return { content: data.content, path: tryPath };
            } catch (_) {
                continue;
            }
        }
        return { content: '', path: '' };
    },

    /**
     * Apply the ```document metadata of `content` to an already-rendered
     * Feature card shell.
     * @param {string} viewer - the source's viewer type, used to pick the
     *   fallback cover preview when no `icon:` was authored.
     */
    _paintFeatureCard(card, content, sourcePath, spaceName, viewer) {
        if (!card.isConnected) return;

        const meta = this._documentMetaOf(content);
        const val = (k) => String((meta && meta[k]) || '').trim();

        // Cover: authored `icon:` → Cards-style preview → generic type cover.
        this._paintCover(card.querySelector('.kr-card-cover'), {
            meta, content, viewer, sourcePath, spaceName
        });

        const titleEl = card.querySelector('.kr-card-title');
        if (titleEl && val('title')) titleEl.textContent = val('title');

        const eyebrowEl = card.querySelector('.kr-card-eyebrow');
        if (eyebrowEl && val('eyebrow')) eyebrowEl.textContent = val('eyebrow');

        // Headline: the authored `headline:`, else the ```summary block, else a
        // plain-text excerpt of the body — so the view stays useful on documents
        // that have no card metadata yet.
        const headlineEl = card.querySelector('.kr-card-headline');
        if (headlineEl) {
            const headline = val('headline')
                || this._featureExcerpt(this.extractSummaryBlock(content) || content);
            headlineEl.classList.remove('kr-card-headline--loading');
            headlineEl.textContent = headline;
            if (!headline) headlineEl.remove();
        }

        // An authored `meta:` replaces the default date line. The shell only
        // renders a .kr-card-meta when the item had a date, so create one when
        // it didn't (otherwise the authored value would be silently dropped).
        if (val('meta')) {
            let metaEl = card.querySelector('.kr-card-meta');
            if (!metaEl) {
                const foot = card.querySelector('.kr-card-foot');
                if (foot) {
                    if (foot.querySelector('.kr-card-space')) {
                        const dot = document.createElement('span');
                        dot.className = 'kr-card-dot';
                        dot.textContent = '·';
                        foot.appendChild(dot);
                    }
                    metaEl = document.createElement('span');
                    metaEl.className = 'kr-card-meta';
                    foot.appendChild(metaEl);
                }
            }
            if (metaEl) {
                metaEl.textContent = val('meta');
                metaEl.removeAttribute('title');
            }
        }
    },

    /**
     * The always-available Feature cover: a file-type icon (and extension)
     * reflecting what is being viewed, mirroring the grid view's iconography.
     * Rendered into the shell up front so a card never shows an empty panel,
     * and restored whenever a richer cover fails to load.
     * @param {string} pathOrName - used to derive the type; ignored for folders
     * @param {boolean} isFolder
     * @returns {string} HTML for the inside of `.kr-card-cover`
     */
    _featureGenericCover(pathOrName, isFolder) {
        if (isFolder) {
            return '<div class="kr-cover-generic"><i class="bi bi-folder"></i></div>';
        }
        const info = this.getFileTypeInfo(pathOrName || '');
        const iconClass = this.getFileTypeIconClass(info.category);
        const ext = String(this.getFileTypeFromExtension(pathOrName || '') || '').toUpperCase();
        return '<div class="kr-cover-generic">'
            + `<i class="bi ${iconClass}"></i>`
            + (ext ? `<span class="kr-cover-ext">${this._escapeHtml(ext)}</span>` : '')
            + '</div>';
    },

    /**
     * Fallback cover for a document with no authored `icon:` — the same preview
     * the Cards view renders: the image itself, the PDF, or the ```summary
     * markdown (full body when there is no summary block). Leaves the shell's
     * generic type cover in place when there is nothing better to show.
     * @param {HTMLElement} cover - the `.kr-card-cover` element
     */
    _paintFeaturePreviewCover(cover, { viewer, filePath, spaceName, content }) {
        if (!cover || !filePath) return;

        const spaceId = this.app?.currentSpace?.id;
        const directUrl = () => (spaceId
            ? WikiAPI.filing.getDirectUrl(spaceId, filePath)
            : `/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}`
              + `&spaceName=${encodeURIComponent(spaceName || '')}`);

        const generic = cover.innerHTML;
        const restore = () => { cover.innerHTML = generic; };

        if (viewer === 'image') {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';
            img.addEventListener('error', restore, { once: true });
            img.src = directUrl();
            cover.innerHTML = '';
            cover.appendChild(img);
            return;
        }

        if (viewer === 'pdf') {
            cover.innerHTML = `<div class="kr-cover-doc kr-cover-doc--pdf">`
                + `<embed src="${this._escapeHtml(directUrl())}#toolbar=0&navpanes=0" type="application/pdf">`
                + '</div>';
            return;
        }

        if (viewer === 'markdown') {
            // Prefer the author's ```summary block, else the body — sanitised
            // (heavy fenced blocks stripped) and capped, since this is a
            // thumbnail, not a reading surface.
            const summary = this.extractSummaryBlock(content);
            let source = summary;
            if (!source) {
                source = this._excerptMarkdown(
                    String(this.sanitizeSummaryForPreview(content || '') || '')
                        // sanitizeSummaryForPreview leaves the interaction blocks
                        // alone; as a thumbnail they are pure noise.
                        .replace(/```(?:comments|liked|reviews|sharedlinkvisits|document)\s*\n[\s\S]*?\n```/gi, ''),
                    1200
                );
            }
            if (!source.trim()) return;
            cover.innerHTML = '<div class="kr-cover-doc"><div class="markdown-content">'
                + parseMarkdown(source) + '</div></div>';
            return;
        }

        if (['text', 'code', 'web', 'data'].includes(viewer)) {
            const text = String(content || '').slice(0, 800);
            if (!text.trim()) return;
            cover.innerHTML = '<div class="kr-cover-doc"><pre class="kr-cover-pre">'
                + this._escapeHtml(text) + '</pre></div>';
            return;
        }
        // Anything else keeps the generic type cover.
    },

    /**
     * Cap markdown to `limit` characters WITHOUT cutting an image in half.
     *
     * A naive slice was landing inside inline base64 images — a single
     * `![alt](data:image/png;base64,…)` runs to hundreds of KB on one line, so
     * it both swallowed the whole budget and got truncated mid-URI. The parser
     * then saw an unterminated image and printed the raw base64 as body text
     * (walls of `iVBORw0KGgo…` in the covers).
     *
     * So images are lifted onto a shelf first — each costing a few characters
     * of budget instead of hundreds of thousands — the text is cut, and the
     * images that survived are put back intact. They then render as real
     * images, scaled down with the rest of the preview subtree.
     * @param {string} markdown
     * @param {number} limit
     * @returns {string}
     */
    _excerptMarkdown(markdown, limit = 1200) {
        const src = String(markdown || '');
        // A URL part that tolerates no ')' is safe here: data URIs are base64
        // (A-Z a-z 0-9 + / = ; , :) and never contain one.
        const IMG = /!\[[^\]]*\]\([^)]*\)/g;
        // What an image costs against the budget, whatever its real length —
        // nominal, so a single inline base64 URI can't consume the excerpt.
        const IMAGE_COST = 12;

        let out = '';
        let budget = limit;
        let last = 0;
        let m;

        IMG.lastIndex = 0;
        while ((m = IMG.exec(src)) !== null) {
            const text = src.slice(last, m.index);
            if (text.length >= budget) return out + text.slice(0, budget);
            out += text;
            budget -= text.length;

            // The image is copied WHOLE, never sliced — which is the whole
            // point of walking the string instead of cutting it.
            out += m[0];
            budget -= IMAGE_COST;
            if (budget <= 0) return out;

            last = m.index + m[0].length;
        }
        return out + src.slice(last, last + budget);
    },

    /**
     * Reduce markdown to a short single-paragraph plain-text excerpt for a
     * Feature card headline. Drops fenced blocks, headings, images and inline
     * markup so the card shows prose rather than syntax.
     */
    _featureExcerpt(markdown, limit = 240) {
        if (!markdown) return '';
        const text = String(markdown)
            .replace(/```[\s\S]*?```/g, ' ')      // fenced blocks (incl. ```document)
            .replace(/^\s*#{1,6}\s+.*$/gm, ' ')   // headings
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')// images
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
            .replace(/[*_`>#|-]+/g, ' ')          // leftover inline markup
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length <= limit) return text;
        const cut = text.slice(0, limit);
        const lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
    },

    /**
     * Compact per-card quick actions (Pin / Star / Share / Download) for the
     * preview-card header — parity with the document toolbar without leaving the
     * folder. Shown only during normal folder browsing; recent/starred cards keep
     * their own remove/unstar affordance (`_buildActionButton`). Wired by
     * `_wireCardActions` (which also stops these clicks from opening the card).
     * @param {Object} file
     * @param {Object} ctx - render context from `_buildRenderContext`
     * @returns {string}
     */
    _renderCardQuickActions(file, ctx) {
        if (ctx && ctx.actionType) return '';
        const path  = (file.path || '').replace(/"/g, '&quot;');
        const space = (file.spaceName || '').replace(/"/g, '&quot;');
        const title = this._escapeHtml(this._displayName(file));
        return `<span class="preview-card-actions" data-document-path="${path}" data-space-name="${space}" data-title="${title}">
            <button type="button" class="pc-act" data-act="pin" title="Pin to home"><i class="bi bi-pin-angle"></i><span>Pin</span></button>
            <button type="button" class="pc-act" data-act="star" title="Star"><i class="bi bi-star"></i><span>Star</span></button>
            <button type="button" class="pc-act" data-act="share" title="Copy a shareable link"><i class="bi bi-share"></i><span>Share</span></button>
            <button type="button" class="pc-act" data-act="download" title="Download"><i class="bi bi-download"></i><span>Download</span></button>
        </span>`;
    },

    /**
     * Wire the per-card quick actions rendered by `_renderCardQuickActions`.
     * Each cluster stops its clicks/hover from bubbling to the card (so acting on
     * a card never opens it), reflects pin/star state, and toggles or fires the
     * matching action. Reuses the same controllers the document toolbar uses.
     * @param {HTMLElement} container
     */
    _wireCardActions(container) {
        container.querySelectorAll('.preview-card-actions').forEach(box => {
            // Acting on a card must not open it or trigger the hover preview.
            box.addEventListener('click', (e) => e.stopPropagation());
            box.addEventListener('mouseenter', (e) => e.stopPropagation());

            const path = box.dataset.documentPath;
            const spaceName = box.dataset.spaceName;
            const title = box.dataset.title || (path ? path.split('/').pop() : '');
            const item = { type: 'document', path, spaceName, title };

            const pinBtn = box.querySelector('[data-act="pin"]');
            const starBtn = box.querySelector('[data-act="star"]');

            const renderPin = () => {
                if (!pinBtn) return;
                const pinned = pinController.isPinned(item);
                pinBtn.classList.toggle('active', pinned);
                pinBtn.title = pinned ? 'Unpin from home' : 'Pin to home';
                pinBtn.innerHTML = `<i class="bi ${pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle'}"></i><span>${pinned ? 'Pinned' : 'Pin'}</span>`;
            };
            const renderStar = () => {
                if (!starBtn) return;
                const starred = documentController.isDocumentStarred(item);
                starBtn.classList.toggle('active', starred);
                starBtn.title = starred ? 'Unstar' : 'Star';
                starBtn.innerHTML = `<i class="bi ${starred ? 'bi-star-fill' : 'bi-star'}"></i><span>${starred ? 'Starred' : 'Star'}</span>`;
            };
            renderPin();
            renderStar();

            pinBtn?.addEventListener('click', async (e) => {
                e.preventDefault(); e.stopPropagation();
                pinBtn.disabled = true;
                try { await pinController.togglePin(item); } catch (_) { /* noop */ }
                pinBtn.disabled = false;
                renderPin();
            });
            starBtn?.addEventListener('click', async (e) => {
                e.preventDefault(); e.stopPropagation();
                starBtn.disabled = true;
                try { await documentController.toggleDocumentStar(item); } catch (_) { /* noop */ }
                starBtn.disabled = false;
                renderStar();
            });
            box.querySelector('[data-act="share"]')?.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                documentController.copyShareUrl(spaceName, path, { title });
            });
            box.querySelector('[data-act="download"]')?.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (!path || !spaceName) return;
                const url = `/applications/wiki/api/documents/content?path=${encodeURIComponent(path)}&spaceName=${encodeURIComponent(spaceName)}&download=true`;
                const a = document.createElement('a');
                a.href = url;
                a.download = title || '';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
        });
    },

    _buildActionButton(file, ctx, placement = 'card') {
        const escapedPath = (file.path || '').replace(/"/g, '&quot;');
        if (ctx.actionType === 'recent') {
            const posStyle = placement === 'grid' ? ' style="position:absolute;top:8px;right:8px;"' : '';
            return `<button class="btn btn-sm btn-outline-danger delete-recent-btn" data-document-path="${escapedPath}" title="Remove from recent"${posStyle}>
                <i class="bi bi-clock-history"></i>
            </button>`;
        }
        if (ctx.actionType === 'starred') {
            const posStyle = placement === 'grid' ? ' style="position:absolute;top:8px;right:8px;"' : '';
            return `<button class="btn btn-sm btn-outline-warning unstar-file-btn" data-document-path="${escapedPath}" title="Unstar file"${posStyle}>
                <i class="bi bi-star"></i>
            </button>`;
        }
        return '';
    },

    loadViewPreviews(viewMode, root = document) {
        // A new render supersedes any in-flight lazy observers from the previous
        // one so they stop watching detached cards (and don't leak).
        if (this._previewObservers) {
            this._previewObservers.forEach((o) => { try { o.disconnect(); } catch (_) { /* noop */ } });
        }
        this._previewObservers = [];

        if (viewMode === 'grid') {
            // Grid tiles use the shared cover panels (same treatment as the
            // Feature view). loadCardPreviews still runs for any legacy
            // `.card-preview-loading` markup rendered elsewhere.
            this.loadCoverPanels(root);
            this.loadCardPreviews(root);
        } else if (viewMode === 'cards') {
            this.loadFolderCardPreviews(root);
            this.loadPreviewCardContent(root);
        } else if (viewMode === 'feature') {
            this.loadFeatureCards(root);
        }
    },

    /**
     * Lazily run an async per-element worker over a node list as each element
     * scrolls near the viewport, with bounded concurrency.
     *
     * Previously every preview fetched eagerly: a search returning 200 results
     * fired 200 `enhanced=true` content fetches at once, so the handful of cards
     * actually on screen were starved behind ~190 off-screen ones and their
     * spinners ran "forever" (switching view re-rendered and resolved them from
     * cache). Now an IntersectionObserver only enqueues a card's worker when it
     * approaches the viewport, so visible cards load first and off-screen cards
     * wait until scrolled to — keeping the first paint fast at any result count.
     *
     * A small worker pool (the browser caps ~6 connections per host anyway)
     * drains the queue so no one slow card stalls the rest. Detached nodes are
     * skipped so a superseded render does no work. Falls back to an eager pool
     * when IntersectionObserver is unavailable.
     * @param {Iterable<HTMLElement>} elements
     * @param {(el: HTMLElement) => Promise<void>} worker
     * @param {number} concurrency
     */
    async _runPreviewPool(elements, worker, concurrency = 6) {
        const items = Array.from(elements).filter((el) => el && el.isConnected);
        if (items.length === 0) return;

        // Fallback: no IntersectionObserver — drain eagerly with a bounded pool.
        if (typeof IntersectionObserver === 'undefined') {
            let cursor = 0;
            const drain = async () => {
                while (cursor < items.length) {
                    const el = items[cursor++];
                    if (!el.isConnected) continue;
                    try { await worker(el); } catch (_) { /* worker renders its own fallback */ }
                }
            };
            await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => drain()));
            return;
        }

        // Lazy: enqueue a card's worker only once it nears the viewport.
        const queue = [];
        let active = 0;
        const pump = () => {
            while (active < concurrency && queue.length) {
                const el = queue.shift();
                if (!el.isConnected) continue;
                active++;
                Promise.resolve()
                    .then(() => worker(el))
                    .catch(() => { /* worker renders its own fallback */ })
                    .finally(() => { active -= 1; pump(); });
            }
        };

        const io = new IntersectionObserver((entries, obs) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                obs.unobserve(entry.target);
                if (entry.target.isConnected) queue.push(entry.target);
            }
            pump();
        }, { rootMargin: '600px 0px' });

        (this._previewObservers = this._previewObservers || []).push(io);
        items.forEach((el) => io.observe(el));
    },

    bindListEvents(container, context = {}) {
        const ctx = this._buildRenderContext(context);
        const viewMode = context.viewMode || this.currentViewMode || 'grid';

        // --- Files: click to open, hover preview ---
        container.querySelectorAll('.file-card, .file-row, .file-card-bootstrap, .kr-file-row[data-document-path], .kr-feature-card[data-document-path]').forEach(item => {
            item.addEventListener('click', () => {
                documentController.openDocumentByPath(item.dataset.documentPath, item.dataset.spaceName);
            });
            item.addEventListener('mouseenter', () => {
                this.previewTimeout = setTimeout(() => {
                    this.currentPreviewCard = item;
                    this.showFilePreview(item, item.dataset.documentPath, item.dataset.spaceName);
                }, 500);
            });
            item.addEventListener('mouseleave', () => {
                if (this.previewTimeout) { clearTimeout(this.previewTimeout); this.previewTimeout = null; }
                this.hideFilePreview();
            });
            if (ctx.draggable) {
                item.setAttribute('draggable', 'true');
                item.addEventListener('dragstart', (e) => this.handleDragStart(e, item.dataset.documentPath, 'file'));
            }
        });

        // --- Folders: click to navigate, drag-drop (folder context only) ---
        if (ctx.type === 'folder') {
            container.querySelectorAll('.folder-card, .folder-row, .folder-card-bootstrap, .kr-file-row[data-folder-path], .kr-feature-card[data-folder-path]').forEach(item => {
                item.addEventListener('click', () => this.loadFolderContent(item.dataset.folderPath));
                item.addEventListener('contextmenu', (e) => {
                    e.stopPropagation();
                    this.showContextMenu(e, item.dataset.folderPath, 'folder');
                });
                if (ctx.draggable) {
                    item.setAttribute('draggable', 'true');
                    item.addEventListener('dragstart',  (e) => this.handleDragStart(e,  item.dataset.folderPath, 'folder'));
                    if (item.classList.contains('kr-file-row')) {
                        item.addEventListener('dragover',  (e) => this._handleRowDragOver(e, item, 'folder'));
                        item.addEventListener('dragleave', (e) => this._handleRowDragLeave(e, item));
                        item.addEventListener('drop',      (e) => this._handleRowDrop(e, item, 'folder'));
                    } else {
                        item.addEventListener('dragover',   (e) => this.handleDragOver(e));
                        item.addEventListener('dragenter',  (e) => this.handleDragEnter(e, item));
                        item.addEventListener('dragleave',  (e) => this.handleDragLeave(e, item));
                        item.addEventListener('drop',       (e) => this.handleDrop(e, item.dataset.folderPath, 'folder'));
                    }
                }
            });
            // File rows in the list view also accept drops for before/after reorder
            if (ctx.draggable) {
                container.querySelectorAll('.kr-file-row[data-document-path]').forEach(item => {
                    item.addEventListener('dragover',  (e) => this._handleRowDragOver(e, item, 'file'));
                    item.addEventListener('dragleave', (e) => this._handleRowDragLeave(e, item));
                    item.addEventListener('drop',      (e) => this._handleRowDrop(e, item, 'file'));
                });
            }
        }

        // --- Preview card open buttons (all contexts) ---
        container.querySelectorAll('.preview-card-open-btn[data-document-path]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                documentController.openDocumentByPath(btn.dataset.documentPath, btn.dataset.spaceName);
            });
        });

        // --- Per-card quick actions (Pin / Star / Share / Download) ---
        this._wireCardActions(container);
        if (ctx.type === 'folder') {
            container.querySelectorAll('.preview-card-open-btn[data-folder-path]').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this.loadFolderContent(btn.dataset.folderPath); });
            });
            container.querySelectorAll('.preview-folder-card').forEach(card => {
                card.addEventListener('contextmenu', (e) => { e.stopPropagation(); this.showContextMenu(e, card.dataset.folderPath, 'folder'); });
            });
            container.querySelectorAll('.preview-file-card').forEach(card => {
                card.addEventListener('contextmenu', (e) => {
                    e.stopPropagation();
                    this.contextMenuTargetSpaceName = card.dataset.spaceName;
                    this.showContextMenu(e, card.dataset.documentPath, 'file');
                });
            });
        }

        // --- Action buttons (recent / starred) ---
        container.querySelectorAll('.delete-recent-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.app.deleteRecentFile(btn.dataset.documentPath); });
            btn.addEventListener('mouseenter', (e) => e.stopPropagation());
        });
        container.querySelectorAll('.unstar-file-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.app.unstarFile(btn.dataset.documentPath); });
            btn.addEventListener('mouseenter', (e) => e.stopPropagation());
        });

        // --- File context menus ---
        container.querySelectorAll('.file-card-bootstrap, .file-card, .file-row, .kr-file-row[data-document-path], .kr-feature-card[data-document-path]').forEach(item => {
            item.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                this.contextMenuTargetSpaceName = item.dataset.spaceName;
                this.showContextMenu(e, item.dataset.documentPath, 'file');
            });
        });

        // --- Folder status accents (success/danger/warning/light) ---
        this._applyFolderTypeAccents(container);

        // --- Preview loading (scoped to this container so a render in one view
        //     can't sweep up still-loading cards from another, hidden view) ---
        this.loadViewPreviews(viewMode, container);
    },

    /**
     * Apply each folder's status accent to its centre-view element. The status
     * lives on the folder node in the cached tree; folder elements carry their
     * path in data-folder-path, so we look the status up and toggle a
     * `kr-ftype-<status>` class. Render-time CSS does the colouring. This runs
     * after every folder render (and after an optimistic status change), and is
     * a no-op for elements whose folder has no status.
     * @param {HTMLElement} container
     */
    _applyFolderTypeAccents(container) {
        if (!container) return;
        const selector = '.folder-card, .folder-row, .folder-card-bootstrap, .preview-folder-card, .kr-file-row[data-folder-path]';
        container.querySelectorAll(selector).forEach((el) => {
            const node = this.findFolderInTree(this.fullFileTree || [], el.dataset.folderPath);
            const status = this._effectiveFolderStatus(node);
            el.classList.remove('kr-ftype-success', 'kr-ftype-danger', 'kr-ftype-warning', 'kr-ftype-light', 'kr-ftype-continuous-exploration');
            if (status) {
                el.classList.add(`kr-ftype-${status}`);
                el.dataset.ftype = status;
            } else {
                delete el.dataset.ftype;
            }
        });

        // Files carry the same accent (explicit status only — no empty-folder
        // default), looked up by document path in the cached tree.
        const fileSelector = '.file-card, .file-row, .file-card-bootstrap, .preview-file-card, .kr-file-row[data-document-path]';
        container.querySelectorAll(fileSelector).forEach((el) => {
            const node = this.findNodeInTree(this.fullFileTree || [], el.dataset.documentPath);
            const status = node && node.status ? node.status : null;
            el.classList.remove('kr-ftype-success', 'kr-ftype-danger', 'kr-ftype-warning', 'kr-ftype-light', 'kr-ftype-continuous-exploration');
            if (status) {
                el.classList.add(`kr-ftype-${status}`);
                el.dataset.ftype = status;
            } else {
                delete el.dataset.ftype;
            }
        });
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    bindFolderViewEvents() {
        // Initialize file preview
        this.initFilePreview();

        // Spaces link - navigate to spaces view
        document.getElementById('spacesLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.app.showSpacesView();
        });

        // Breadcrumb folder segments — navigate to that folder (or space root if empty path)
        document.querySelectorAll('.breadcrumb-folder-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetPath = link.dataset.folderPath || '';
                if (!targetPath) {
                    this.app.showHome();
                } else {
                    this.loadFolderContent(targetPath);
                }
            });
        });

        // Back to space button
        document.getElementById('backToSpace')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.app.showHome();
        });

        // Edit folder home — opens the existing .home.md / home.md in the editor.
        document.getElementById('editFolderHomeBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.currentFolderHomePath) {
                this.editFolderHome(this.currentFolderHomePath);
            }
        });

        // Add folder home — creates an empty .home.md for the current folder
        // and opens it in the editor.
        document.getElementById('addFolderHomeBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.createFolderHome(this.app.currentFolder);
        });

        // Delete folder home — the only way to remove a page the tree never shows.
        document.getElementById('deleteFolderHomeBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.deleteFolderHome();
        });

        // Present — full-screen slideshow of every markdown file in the folder.
        document.getElementById('presentFolderBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.startPresentation();
        });

        // Share folder — copy a deep link to this folder (a Teams deeplink when
        // embedded in Teams, else the web URL). Reuses the document share logic;
        // the web wiki's deep-link handler opens the folder path as a folder.
        document.getElementById('shareFolderBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            const folderPath = this.app.currentFolder;
            const spaceName = this.app?.currentSpace?.name;
            if (folderPath && spaceName && folderPath !== '/') {
                documentController.copyShareUrl(spaceName, folderPath, {
                    title: folderPath.split('/').pop() || folderPath,
                });
            } else {
                documentController.showShareToast('Nothing to share', 'error');
            }
        });

        // Rebuild context — regenerate this folder's AI context and everything
        // beneath it, bottom-up, overwriting what is there.
        document.getElementById('rebuildContextBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.rebuildFolderContext(e.currentTarget);
        });

        // Subscribe to changes in this folder (notifications support type:'folder').
        this.wireFolderSubscribeButton(this.app?.currentSpace?.name, this.app.currentFolder);

        // Pin folder — adds/removes the folder from the user's home pins.
        const pinFolderBtn = document.getElementById('pinFolderBtn');
        if (pinFolderBtn) {
            const folderPath = this.app.currentFolder;
            const spaceName = this.app?.currentSpace?.name;
            if (folderPath && spaceName && folderPath !== '/') {
                pinController.wirePinButton(pinFolderBtn, {
                    type: 'folder',
                    path: folderPath,
                    spaceName,
                    title: folderPath.split('/').pop() || folderPath
                });
            } else {
                pinFolderBtn.style.display = 'none';
            }
        }

        // Refresh folder — triggered by workflow metadata in .home.md/home.md
        const refreshFolderBtn = document.getElementById('refreshFolderBtn');
        if (refreshFolderBtn && this.currentFolderWorkflowMeta) {
            refreshFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.runFolderWorkflow(
                    this.currentFolderWorkflowMeta.workflow,
                    this.currentFolderWorkflowMeta.payload,
                    refreshFolderBtn
                );
            });
        }

        // View mode switcher buttons
        document.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const newMode = btn.dataset.view;
                if (newMode !== this.currentViewMode) {
                    this.currentViewMode = newMode;
                    this.lastGlobalViewMode = newMode; // Track the last globally used mode

                    // Update folder viewer state with new view mode
                    folderViewerState.currentViewMode = newMode;

                    // Save this preference for the current folder
                    await this.saveFolderViewPreference(this.app.currentFolder, newMode);

                    // Reload the current folder with new view mode
                    this.loadFolderContent(this.app.currentFolder);
                }
            });
        });

        // Unified event binding + preview loading
        const folderContentEl = document.querySelector('#folderView .folder-content');
        if (folderContentEl) {
            this.bindListEvents(folderContentEl, {
                type: 'folder',
                viewMode: this.currentViewMode,
                draggable: !this.isReadOnlyMode,
            });
        }
    },

    bindFolderItemEvents() {
        // Handle both grid cards, table rows, and Bootstrap cards
        const folderItems = document.querySelectorAll(
            '#folderView .folder-card, #folderView .folder-row, #folderView .folder-card-bootstrap'
        );

        folderItems.forEach(item => {
            item.addEventListener('click', () => {
                const folderPath = item.dataset.folderPath;
                this.loadFolderContent(folderPath);
            });

            // Context menu for folders
            item.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                const folderPath = item.dataset.folderPath;
                this.showContextMenu(e, folderPath, 'folder');
            });

            // Drag and drop for folder items
            if (!this.isReadOnlyMode) {
                item.setAttribute('draggable', 'true');

                item.addEventListener('dragstart', (e) => {
                    this.handleDragStart(e, item.dataset.folderPath, 'folder');
                });

                item.addEventListener('dragover', (e) => {
                    this.handleDragOver(e);
                });

                item.addEventListener('dragenter', (e) => {
                    this.handleDragEnter(e, item);
                });

                item.addEventListener('dragleave', (e) => {
                    this.handleDragLeave(e, item);
                });

                item.addEventListener('drop', (e) => {
                    this.handleDrop(e, item.dataset.folderPath, 'folder');
                });
            }
        });
    },

    bindFileItemEvents() {
        // Handle both grid cards, table rows, and Bootstrap cards
        const fileItems = document.querySelectorAll(
            '#folderView .file-card, #folderView .file-row, #folderView .file-card-bootstrap'
        );

        fileItems.forEach(item => {
            item.addEventListener('click', () => {
                const documentPath = item.dataset.documentPath;
                const spaceName = item.dataset.spaceName;
                documentController.openDocumentByPath(documentPath, spaceName);
            });

            // Context menu for files
            item.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                const filePath = item.dataset.documentPath;
                const spaceName = item.dataset.spaceName;
                this.contextMenuTargetSpaceName = spaceName;
                this.showContextMenu(e, filePath, 'file');
            });

            // Preview on hover for file items
            item.addEventListener('mouseenter', (e) => {
                const documentPath = item.dataset.documentPath;
                const spaceName = item.dataset.spaceName;

                // Add small delay before showing preview
                this.previewTimeout = setTimeout(() => {
                    this.currentPreviewCard = item;
                    this.showFilePreview(item, documentPath, spaceName);
                }, 500); // 500ms delay
            });

            item.addEventListener('mouseleave', () => {
                // Clear timeout if mouse leaves before preview shows
                if (this.previewTimeout) {
                    clearTimeout(this.previewTimeout);
                    this.previewTimeout = null;
                }

                // Hide preview
                this.hideFilePreview();
            });

            // Drag and drop for file items
            if (!this.isReadOnlyMode) {
                item.setAttribute('draggable', 'true');

                item.addEventListener('dragstart', (e) => {
                    this.handleDragStart(e, item.dataset.documentPath, 'file');
                });
            }
        });

        // Context menu for the entire folder view — right-click anywhere in the
        // breadcrumb, header, empty space below cards, etc. Card-level handlers
        // call e.stopPropagation() so this won't double-fire on individual items.
        const folderView = document.getElementById('folderView');
        if (folderView) {
            folderView.addEventListener('contextmenu', (e) => {
                // Bail out if the click landed on a card or row that has its own menu
                if (e.target.closest('.item-card, .file-card, .file-card-bootstrap, .folder-card, .folder-card-bootstrap, .file-row, .folder-row, .kr-file-row[data-document-path], .kr-file-row[data-folder-path]')) {
                    return;
                }
                e.preventDefault();
                const currentFolderPath = this.app.currentFolder || '';
                this.showContextMenu(e, currentFolderPath, 'folder');
            });
        }
    },

    async loadCardPreviews(root = document) {
        const previewElements = (root || document).querySelectorAll('.card-preview-loading');
        await this._runPreviewPool(previewElements, (previewEl) => this._renderCardPreview(previewEl));
    },

    async _renderCardPreview(previewEl) {
        const filePath = previewEl.dataset.filePath;
        const spaceName = previewEl.dataset.spaceName;

        if (!filePath || !spaceName) return;

        {
            try {
                const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}&enhanced=true`);

                // 404 = stale reference (e.g. starred file from a previous space layout).
                // Render the file-type icon and move on without logging an error.
                if (response.status === 404) {
                    const fileTypeInfo = this.getFileTypeInfo(filePath);
                    const iconClass = this.getFileTypeIconClass(fileTypeInfo.category);
                    const iconColor = fileTypeInfo.color;
                    previewEl.innerHTML = `<i class="bi ${iconClass}" style="font-size: 56px; color: ${iconColor};"></i>`;
                    previewEl.classList.remove('card-preview-loading');
                    previewEl.dataset.missing = 'true';
                    return;
                }

                if (!response.ok) {
                    throw new Error(`Failed to load preview (HTTP ${response.status})`);
                }

                const data = await response.json();
                const { content: fileContent, metadata } = data;
                const viewer = metadata?.viewer || 'default';

                let previewHtml = '';

                switch (viewer) {
                    case 'image': {
                        const previewSpaceId = this.app.currentSpace && this.app.currentSpace.id;
                        const imageUrl = previewSpaceId ? WikiAPI.filing.getDirectUrl(previewSpaceId, filePath) : `/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}`;
                        previewHtml = `<img src="${imageUrl}" alt="Preview" style="max-width: 100%; max-height: 150px; object-fit: contain; border-radius: 4px;" />`;
                        break;
                    }

                    case 'markdown': {
                        // If a ```summary block is present, that is the
                        // author's canonical preview — render it directly.
                        // Otherwise strip images and show a snippet.
                        const summary = this.extractSummaryBlock(fileContent);
                        if (summary) {
                            previewHtml = `<div class="markdown-preview-card">${parseMarkdown(summary)}</div>`;
                        } else {
                            const cleanedContent = fileContent
                                .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
                                .replace(/\n{3,}/g, '\n\n');
                            if (typeof marked !== 'undefined') {
                                const preview = cleanedContent.substring(0, 200) + (cleanedContent.length > 200 ? '...' : '');
                                const rendered = parseMarkdown(preview);
                                previewHtml = `<div class="markdown-preview-card">${rendered}</div>`;
                            } else {
                                const preview = cleanedContent.substring(0, 150) + (cleanedContent.length > 150 ? '...' : '');
                                previewHtml = `<pre style="font-size: 9.8px; text-align: left; margin: 0; padding: 7px;">${this.escapeHtml(preview)}</pre>`;
                            }
                        }
                        break;
                    }

                    case 'text':
                    case 'code':
                    case 'web':
                    case 'data':
                        const preview = fileContent.substring(0, 150) + (fileContent.length > 150 ? '...' : '');
                        previewHtml = `<pre style="font-size: 9.8px; text-align: left; margin: 0; padding: 7px; white-space: pre-wrap;">${this.escapeHtml(preview)}</pre>`;
                        break;

                    case 'pdf':
                        const pdfPreviewUrl = `/applications/wiki/api/documents/pdf-preview?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}&page=1`;
                        previewHtml = `<img src="${pdfPreviewUrl}" alt="PDF Preview" style="max-width: 100%; max-height: 150px; object-fit: contain; border-radius: 4px;" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2220%22 text-anchor=%22middle%22 fill=%22%23dc3545%22%3EPDF%3C/text%3E%3C/svg%3E';" />`;
                        break;

                    default:
                        const fileTypeInfo = this.getFileTypeInfo(filePath);
                        const iconClass = this.getFileTypeIconClass(fileTypeInfo.category);
                        const iconColor = fileTypeInfo.color;
                        previewHtml = `<i class="bi ${iconClass}" style="font-size: 56px; color: ${iconColor};"></i>`;
                        break;
                }

                previewEl.innerHTML = previewHtml;
                previewEl.classList.remove('card-preview-loading');
            } catch (error) {
                console.error('Error loading preview for', filePath, error);
                // Show error icon
                const fileTypeInfo = this.getFileTypeInfo(filePath);
                const iconClass = this.getFileTypeIconClass(fileTypeInfo.category);
                const iconColor = fileTypeInfo.color;
                previewEl.innerHTML = `<i class="bi ${iconClass}" style="font-size: 56px; color: ${iconColor};"></i>`;
                previewEl.classList.remove('card-preview-loading');
            }
        }
    },

    async loadPreviewCardContent(root = document) {
        const loadingCards = (root || document).querySelectorAll('.preview-card-content-loading');
        await this._runPreviewPool(loadingCards, (container) => this._renderPreviewCardContent(container));
    },

    async _renderPreviewCardContent(container) {
        {
            const filePath = container.dataset.filePath;
            const spaceName = container.dataset.spaceName;

            if (!filePath || !spaceName) return;

            try {
                const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}&enhanced=true`);

                if (response.status === 404 || !response.ok) {
                    this.showPreviewNotAvailable(container, filePath);
                    return;
                }

                const data = await response.json();
                const { content: fileContent, metadata } = data;
                const viewer = metadata?.viewer || 'text';
                let html = '';

                if (viewer === 'image') {
                    const spaceId = this.app.currentSpace?.id;
                    const imageUrl = spaceId
                        ? WikiAPI.filing.getDirectUrl(spaceId, filePath)
                        : `/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}`;
                    html = `<img src="${imageUrl}" alt="${filePath.split('/').pop()}" style="max-width:100%;height:auto;object-fit:contain;" />`;
                } else if (viewer === 'markdown') {
                    // Prefer the author-supplied ```summary block when present;
                    // otherwise render the full body. The wrapper carries the
                    // doc context so the comment form + like button work here,
                    // and the kr-doc-paper class scopes their styling (its paper
                    // chrome is reset in CSS so the card stays flush).
                    const summary = this.extractSummaryBlock(fileContent);
                    const previewSource = summary || fileContent;
                    const ctxPath = this.escapeHtml(filePath);
                    const ctxSpace = this.escapeHtml(spaceName);
                    html = `<div class="kr-doc-paper markdown-content" data-doc-ctx-path="${ctxPath}" data-doc-ctx-space="${ctxSpace}">${parseMarkdown(previewSource)}</div>`;
                } else if (viewer === 'pdf') {
                    const spaceId = this.app.currentSpace?.id;
                    const pdfUrl = spaceId
                        ? WikiAPI.filing.getDirectUrl(spaceId, filePath)
                        : `/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}`;
                    html = `<embed src="${pdfUrl}" type="application/pdf" width="100%" height="100%" style="border:none;" />`;
                } else if (['text','code','web','data'].includes(viewer)) {
                    const escaped = fileContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    html = `<pre class="preview-text-content">${escaped}</pre>`;
                } else {
                    this.showPreviewNotAvailable(container, filePath);
                    return;
                }

                container.classList.remove('preview-card-content-loading');
                container.innerHTML = html;

                // Make the like + comment blocks always appear and work here too
                // (the wrapper above supplies the doc context). Mirrors the reader.
                if (viewer === 'markdown') {
                    documentController.ensureCommentsBlock(container);
                    documentController.ensureLikedBlock(container);
                    documentController.refreshLikeButtonStates(container);
                }

                // Syntax highlighting for code
                if (viewer === 'code' && typeof Prism !== 'undefined') {
                    setTimeout(() => Prism.highlightAllUnder(container), 100);
                }
            } catch (error) {
                console.error('Error loading preview for', filePath, error);
                this.showPreviewNotAvailable(container, filePath);
            }
        }
    },

    async loadFolderCardPreviews(root = document) {
        const folderCards = (root || document).querySelectorAll('.preview-folder-card .preview-card-content-loading');
        await this._runPreviewPool(folderCards, (container) => this._renderFolderCardPreview(container));
    },

    async _renderFolderCardPreview(container) {
        const folderPath = container.dataset.folderPath;
        const spaceId = container.dataset.spaceId;

        if (!folderPath || !spaceId) return;

        try {
            // HEAD-probes the home names and only downloads one that exists.
            const { content, path: filePath } = await this._fetchFolderHome(folderPath, spaceId);

            if (!content) {
                // No home file found, show folder info
                this.showFolderPreviewDefault(container, folderPath);
                return;
            }

            // If the home file declares a ```summary block, that is
            // the author's chosen card preview — render only that.
            // Otherwise fall back to the full home content. The wrapper
            // carries the home doc's context so its like + comment blocks
            // work (see loadPreviewCardContent).
            const summary = this.extractSummaryBlock(content);
            const previewSource = summary || content;
            const ctxPath = this.escapeHtml(filePath);
            const ctxSpace = this.escapeHtml(this.app?.currentSpace?.name || '');
            const html = `<div class="kr-doc-paper markdown-content" data-doc-ctx-path="${ctxPath}" data-doc-ctx-space="${ctxSpace}">${parseMarkdown(previewSource)}</div>`;
            container.classList.remove('preview-card-content-loading');
            container.innerHTML = html;
            documentController.ensureCommentsBlock(container);
            documentController.ensureLikedBlock(container);
            documentController.refreshLikeButtonStates(container);
        } catch (error) {
            console.error('Error loading folder preview for', folderPath, error);
            this.showFolderPreviewDefault(container, folderPath);
        }
    },

    /**
     * If the markdown contains a ```summary fenced block, extract its inner
     * markdown and return it. Returns null if no summary block is present.
     * The summary block is the canonical card-preview content per the wiki
     * authoring convention — when present it replaces the snippet/full-body
     * preview so authors control exactly what appears on a card.
     *
     * The extracted content is sanitized for card-sized rendering: any nested
     * heavy custom-block fences (mermaid, swagger, tabs, accordion, etc.)
     * are replaced with a small placeholder. Cards are too small for those
     * components to render meaningfully and they can be expensive to render
     * many times in a folder view.
     */
    extractSummaryBlock(markdown) {
        if (!markdown || typeof markdown !== 'string') return null;
        const m = markdown.match(/```summary\s*\n([\s\S]*?)\n```/i);
        if (!m) return null;
        const inner = (m[1] || '').trim();
        if (!inner) return null;
        return this.sanitizeSummaryForPreview(inner);
    },

    /**
     * Strip fenced custom blocks of "heavy" types from a summary so card
     * previews stay cheap and visually compact. Plain code blocks
     * (```js, ```python, ```bash, …) are preserved.
     */
    sanitizeSummaryForPreview(markdown) {
        const HEAVY = new Set([
            'mermaid', 'swagger', 'tabs', 'accordion',
            'three-column', 'two-col-3-1', 'two-col-1-3',
            'hero-banner', 'cards', 'header', 'footer',
            'landing-hero', 'news', 'tiles', 'stories', 'cta', // landing bands
            'wiki-link', 'wiki-links', 'menu', 'container',
            'visualisation', // interactive canvas — meaningless in a card preview
            'linked-documents', // a band of cards inside a card preview

            'summary' // a nested summary makes no sense in a preview
        ]);
        return markdown.replace(/```([\w-]+)\s*\n[\s\S]*?\n```/g, (whole, lang) => {
            return HEAVY.has(String(lang).toLowerCase())
                ? `_[${lang} block hidden in preview]_`
                : whole;
        });
    },

    showFolderPreviewDefault(container, folderPath) {
        const folderName = folderPath ? folderPath.split('/').pop() : 'Folder';
        container.classList.remove('preview-card-content-loading');

        // When there's no .home.md, prefer showing the folder's contents as a
        // list instead of an empty icon — far more useful at a glance.
        const folderNode = folderPath
            ? this.findFolderInTree(this.fullFileTree || [], folderPath)
            : { children: this.fullFileTree || [] };

        const visibleChildren = (folderNode && Array.isArray(folderNode.children))
            ? folderNode.children.filter(c => !(c.name && c.name.startsWith('.')))
            : [];

        if (visibleChildren.length === 0) {
            container.innerHTML = `
                <div class="folder-preview-info">
                    <i class="bi bi-folder" style="font-size:56px;color:#6c757d;"></i>
                    <div class="mt-3 fw-semibold">${this.escapeHtml(folderName)}</div>
                    <div class="text-muted small mt-1">Empty folder</div>
                </div>`;
            return;
        }

        // Folders first, then files, both alphabetical.
        visibleChildren.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        const MAX_ITEMS = 12;
        const shown = visibleChildren.slice(0, MAX_ITEMS);
        const overflow = visibleChildren.length - shown.length;
        const spaceName = this.app?.currentSpace?.name || '';

        // Render the children as rich rows (the same .kr-file-row markup the
        // details/list view uses) so the card preview matches the main views.
        const folders = shown
            .filter(c => c.type === 'folder')
            .map(c => ({
                name: c.name,
                path: c.path,
                childCount: c.childCount != null
                    ? c.childCount
                    : (Array.isArray(c.children) ? c.children.length : 0),
            }));
        const files = shown
            .filter(c => c.type !== 'folder')
            .map(c => ({ title: c.name, name: c.name, path: c.path, spaceName }));

        const rowsHtml = this._renderKrRows(
            folders, files, this._buildRenderContext({ type: 'folder', draggable: false })
        );

        const overflowHtml = overflow > 0
            ? `<div class="folder-preview-overflow text-muted small">+${overflow} more</div>`
            : '';

        container.innerHTML = `
            <div class="folder-preview-list">
                <div class="folder-preview-list-header">
                    <i class="bi bi-folder folder-preview-list-header-icon"></i>
                    <span class="fw-semibold">${this.escapeHtml(folderName)}</span>
                </div>
                ${rowsHtml}
                ${overflowHtml}
            </div>`;

        // These rows are injected after bindListEvents ran, so wire their own
        // handlers. Stop propagation so the parent card's "open folder"
        // handler doesn't also fire when a child row is clicked.
        container.querySelectorAll('.kr-file-row').forEach(row => {
            const docPath = row.dataset.documentPath;
            const childFolderPath = row.dataset.folderPath;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                if (docPath) {
                    documentController.openDocumentByPath(docPath, row.dataset.spaceName);
                } else if (childFolderPath) {
                    this.loadFolderContent(childFolderPath);
                }
            });
            const actBtn = row.querySelector('.frow-act');
            if (actBtn) {
                actBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showContextMenu(e, docPath || childFolderPath, docPath ? 'file' : 'folder');
                });
            }
        });
    },

    showPreviewNotAvailable(container, filePath) {
        const fileTypeInfo = this.getFileTypeInfo(filePath);
        const iconClass = this.getFileTypeIconClass(fileTypeInfo.category);
        const iconColor = fileTypeInfo.color;
        container.classList.remove('preview-card-content-loading');
        container.innerHTML = `
            <div class="preview-not-available">
                <i class="bi ${iconClass}" style="font-size:42px;color:${iconColor};"></i>
                <div class="mt-3 text-muted">Preview not available</div>
            </div>`;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Context Menu Methods
    initContextMenu() {
        // Prevent browser context menu on file tree
        document.getElementById('fileTree')?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Add right-click event listeners to file tree items (will be added dynamically when tree is built)
        this.contextMenuTargetPath = null;

        // Context menu item clicks
        document.getElementById('contextCreateFolder')?.addEventListener('click', () => {
            // Save the value before hiding the menu, as hideContextMenu() resets it
            const targetPath = this.contextMenuTargetPath;
            this.hideContextMenu();
            this.showCreateFolderModal(targetPath);
        });

        document.getElementById('contextCreateFile')?.addEventListener('click', () => {
            // Save the value before hiding the menu, as hideContextMenu() resets it
            const targetPath = this.contextMenuTargetPath;
            this.hideContextMenu();
            this.showCreateFileModal(targetPath);
        });

        document.getElementById('contextUpload')?.addEventListener('click', () => {
            // Save the value before hiding the menu, as hideContextMenu() resets it
            const targetPath = this.contextMenuTargetPath;
            this.hideContextMenu();
            this.showUploadDialog(targetPath);
        });

        document.getElementById('contextCreateContinuousExploration')?.addEventListener('click', () => {
            // Save the values before hiding the menu, as hideContextMenu() resets them
            const targetPath = this.contextMenuTargetPath;
            const targetType = this.contextMenuTargetType;
            this.hideContextMenu();
            // The continuous exploration becomes a visible folder inside the right-clicked
            // folder (a right-clicked file means its parent folder).
            let parentPath = targetType === 'folder' ? (targetPath || '') : (targetPath || '');
            if (targetType === 'file') {
                const idx = parentPath.lastIndexOf('/');
                parentPath = idx > 0 ? parentPath.slice(0, idx) : '';
            }
            // Lazy import (same pattern as the AI chat entry).
            import('./continuousExplorationWizard.js').then(module => {
                module.continuousExplorationWizard.openForCurrentSpace(parentPath);
            });
        });

        document.getElementById('contextAddFileContext')?.addEventListener('click', () => {
            // Save the values before hiding the menu, as hideContextMenu() resets them
            const targetPath = this.contextMenuTargetPath;
            const targetType = this.contextMenuTargetType;
            this.hideContextMenu();

            // Only allow file context for files
            if (targetType === 'file' && targetPath) {
                // Import aiChatController and call the method
                import('./aichatcontroller.js').then(module => {
                    module.aiChatController.openFileContext(targetPath);
                });
            }
        });

        document.getElementById('contextRename')?.addEventListener('click', () => {
            // Save the values before hiding the menu, as hideContextMenu() resets them
            const targetPath = this.contextMenuTargetPath;
            const targetType = this.contextMenuTargetType;
            this.hideContextMenu();
            this.showRenameModal(targetPath, targetType);
        });

        document.getElementById('contextDelete')?.addEventListener('click', () => {
            // Save the values before hiding the menu, as hideContextMenu() resets them
            const targetPath = this.contextMenuTargetPath;
            const targetType = this.contextMenuTargetType;
            this.hideContextMenu();
            this.handleDeleteItem(targetPath, targetType);
        });

        // Folder File Type submenu: the parent item reveals the submenu on hover
        // (CSS), so it needs no click handler. Each option applies (or clears)
        // the status; it reads the target path before hideContextMenu() clears it.
        const folderTypeParent = document.getElementById('contextSetFolderType');
        folderTypeParent?.addEventListener('mouseenter', () => this._positionFolderTypeSubmenu(folderTypeParent));
        document.querySelectorAll('#folderTypeSubmenu .folder-type-option').forEach((opt) => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetPath = this.contextMenuTargetPath;
                const status = opt.dataset.status;
                this.hideContextMenu();
                if (targetPath) this.setFolderType(targetPath, status);
            });
        });

        // File upload handling
        document.getElementById('fileUploadInput')?.addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files, this.uploadTargetPath || this.contextMenuTargetPath);
        });

        // Hide context menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
            }
        });
    },

    showContextMenu(e, targetPath = null, targetType = 'folder') {
        e.preventDefault();
        e.stopPropagation();

        // Don't show context menu in read-only mode
        if (this.isReadOnlyMode) {
            return;
        }

        const contextMenu = document.getElementById('fileContextMenu');

        // Only use empty string for root folders, otherwise store the actual path (even if falsy)
        if (targetType === 'folder' && (targetPath === null || targetPath === undefined)) {
            this.contextMenuTargetPath = ''; // Empty string for root folder
        } else {
            this.contextMenuTargetPath = targetPath;
        }

        this.contextMenuTargetType = targetType;

        // Show/hide the "Add Context" menu item based on whether it's a file or folder
        const addContextMenuItem = document.getElementById('contextAddFileContext');
        if (addContextMenuItem) {
            if (targetType === 'file') {
                addContextMenuItem.classList.remove('hidden');
            } else {
                addContextMenuItem.classList.add('hidden');
            }
        }

        // Show "Folder File Type" only for a real (non-root) folder — the status
        // is stored against the folder's name in its parent, so the space root
        // (empty path) has no parent to record it in.
        const setTypeItem = document.getElementById('contextSetFolderType');
        if (setTypeItem) {
            const isRealFolder = targetType === 'folder' && !!this.contextMenuTargetPath;
            setTypeItem.classList.toggle('hidden', !isRealFolder);
        }

        // Position the context menu using clientX/clientY for viewport positioning
        const x = e.clientX;
        const y = e.clientY;

        // Show menu first to get dimensions
        contextMenu.classList.remove('hidden');

        // Get menu dimensions
        const menuRect = contextMenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Adjust position if menu would go off screen
        let left = x;
        let top = y;

        if (x + menuRect.width > viewportWidth) {
            left = viewportWidth - menuRect.width - 10;
        }

        if (y + menuRect.height > viewportHeight) {
            top = viewportHeight - menuRect.height - 10;
        }

        contextMenu.style.left = left + 'px';
        contextMenu.style.top = top + 'px';
    },

    hideContextMenu() {
        const contextMenu = document.getElementById('fileContextMenu');
        contextMenu?.classList.add('hidden');
        this.contextMenuTargetPath = null;
    },

    /**
     * Flip the Folder File Type submenu to the left of the menu item when it
     * would otherwise overflow the right edge of the viewport. Called on hover,
     * by which point CSS :hover has made the submenu measurable.
     * @param {HTMLElement} parentItem - The #contextSetFolderType menu item.
     */
    _positionFolderTypeSubmenu(parentItem) {
        const submenu = document.getElementById('folderTypeSubmenu');
        if (!submenu || !parentItem) return;
        submenu.classList.remove('submenu-left');
        const rect = parentItem.getBoundingClientRect();
        const width = submenu.offsetWidth || 168;
        if (rect.right + width + 8 > window.innerWidth) {
            submenu.classList.add('submenu-left');
        }
    },

    /**
     * Persist a folder's status colour and reflect it immediately. The status is
     * saved server-side in the parent's .system/file-types.json; on success we
     * optimistically update the in-memory tree node and re-render the left nav +
     * open folder view, so the accent appears without a full tree reload (which
     * would reset the drill position). The server's change event also busts the
     * tree cache, so subsequent loads stay consistent.
     * @param {string} folderPath - Path of the folder to colour.
     * @param {string} status - One of success/danger/warning/light, or 'default' to clear.
     */
    async setFolderType(folderPath, status) {
        const space = this.app.currentSpace;
        if (!space) {
            this.app.showNotification('Select a space first', 'warning');
            return;
        }
        try {
            const resp = await fetch(`/applications/wiki/api/spaces/${space.id}/folder-type`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath, status })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) {
                this.app.showNotification(data.message || 'Failed to set folder type', 'error');
                return;
            }

            const applied = data.status || null;

            // Optimistic in-memory update + targeted re-render (preserves drill).
            const node = this.findFolderInTree(this.fullFileTree || [], folderPath);
            if (node) node.status = applied;
            this.refreshDrillView();
            if (this.app.currentView === 'folder' && this.app.currentFolder != null) {
                this.loadFolderContent(this.app.currentFolder === '' ? '/' : this.app.currentFolder);
            }

            // Keep the client tree cache in step with the optimistic change; the
            // ETag stays the same so the next load still revalidates against the
            // (now cache-busted) server and reconciles if needed.
            try {
                const cached = this.readCachedTree(space.id);
                this.writeCachedTree(space.id, this.fullFileTree, cached && cached.etag);
            } catch (_) { /* cache is best-effort */ }

            this.app.showNotification(applied ? `Folder marked “${applied}”` : 'Folder colour cleared', 'success');
        } catch (err) {
            console.error('[NavigationController] setFolderType failed:', err);
            this.app.showNotification('Failed to set folder type', 'error');
        }
    },

    // Folder Operations
    showCreateFolderModal(prefilledPath = null) {
        if (window.wikiConfig?.editingEnabled === false) {
            this.app.showNotification('Editing is disabled', 'warning');
            return;
        }

        // Auto-select first space if none is selected
        if (!this.app.currentSpace && this.app.data.spaces.length > 0) {
            spacesController.selectSpace(this.app.data.spaces[0].id);
        }

        if (!this.app.currentSpace) {
            this.app.showNotification('Please create a space first', 'warning');
            return;
        }

        // Store the parent path for form submission
        this.prefilledFolderPath = prefilledPath || '';

        // Update the location info text
        const locationInfo = document.getElementById('folderLocationInfo');
        const locationText = document.getElementById('folderLocationText');

        if (prefilledPath) {
            locationInfo.style.display = 'block';
            locationText.textContent = prefilledPath;
        } else {
            locationInfo.style.display = 'block';
            locationText.textContent = 'Root';
        }

        this.app.showModal('createFolderModal');

        // Focus the folder name input
        setTimeout(() => {
            document.getElementById('folderName')?.focus();
        }, 100);
    },

    async handleCreateFolder() {
        const form = document.getElementById('createFolderForm');
        const formData = new FormData(form);

        try {
            // Validate folder name
            const folderName = formData.get('folderName').trim();
            if (!folderName) {
                this.app.showNotification('Folder name cannot be empty', 'error');
                return;
            }

            // Check for invalid characters
            const invalidChars = /[<>:"|?*\\/]/;
            if (invalidChars.test(folderName)) {
                this.app.showNotification('Folder name cannot contain: < > : " | ? * \\ /', 'error');
                return;
            }

            // Use the prefilled path that was set when modal was opened
            const parentPath = this.prefilledFolderPath || '';

            const response = await fetch('/applications/wiki/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: folderName,
                    spaceId: this.app.currentSpace.id,
                    parentPath: parentPath
                })
            });

            const result = await response.json();

            if (result.success) {
                this.app.hideModal('createFolderModal');
                form.reset();

                // Granular update: add the new folder to the tree without full refresh
                const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
                const folderElement = navigationState.addFolderToTree(folderName, folderPath);
                if (folderElement) {
                    this.bindFolderItemEvents_Single(folderElement);
                }
                // Also update fullFileTree data. Dedupe: a fast Socket.IO
                // event can land before this optimistic update runs, in which
                // case the path is already present and we'd be pushing a
                // duplicate that the folder grid would render as a second card.
                if (this.fullFileTree) {
                    const lastSlash = folderPath.lastIndexOf('/');
                    const collection = lastSlash === -1
                        ? this.fullFileTree
                        : (() => {
                            const parentNode = this._findNodeInTree(this.fullFileTree, folderPath.substring(0, lastSlash));
                            if (!parentNode) return null;
                            parentNode.children = parentNode.children || [];
                            return parentNode.children;
                        })();
                    if (collection && !collection.some(n => n.path === folderPath)) {
                        collection.push({ name: folderName, path: folderPath, type: 'folder', children: [] });
                    }
                }

                // If we're currently viewing a folder, refresh the folder view
                if (this.app.currentView === 'folder' && this.app.currentFolder === parentPath) {
                    await this.loadFolderContent(parentPath);
                }

                this.app.showNotification('Folder created successfully!', 'success');
            } else {
                throw new Error(result.message || 'Failed to create folder');
            }
        } catch (error) {
            console.error('Error creating folder:', error);
            this.app.showNotification('Failed to create folder', 'error');
        }
    },

    // File Operations
    showCreateFileModal(prefilledPath = null) {
        if (window.wikiConfig?.editingEnabled === false) {
            this.app.showNotification('Editing is disabled', 'warning');
            return;
        }

        // Auto-select first space if none is selected
        if (!this.app.currentSpace && this.app.data.spaces.length > 0) {
            spacesController.selectSpace(this.app.data.spaces[0].id);
        }

        if (!this.app.currentSpace) {
            this.app.showNotification('Please create a space first', 'warning');
            return;
        }

        this.app.showModal('createFileModal');

        if (prefilledPath !== null) {
            // Hide the location dropdown when pre-filled from context menu
            const fileLocationSelect = document.getElementById('fileLocation');
            const locationGroup = fileLocationSelect?.parentElement;
            if (locationGroup) {
                locationGroup.style.display = 'none';
            }
            // Store the path for form submission
            this.prefilledFilePath = prefilledPath;
        } else {
            // Show the location dropdown for normal creation
            const fileLocationSelect = document.getElementById('fileLocation');
            const locationGroup = fileLocationSelect?.parentElement;
            if (locationGroup) {
                locationGroup.style.display = 'block';
            }
            this.app.populateFileLocationSelect();
            this.prefilledFilePath = null;
        }

        // Reset selected template and offer the templates that apply where the
        // file is actually going — the folder's own first, then its ancestors'.
        const hiddenInput = document.getElementById('selectedTemplatePath');
        if (hiddenInput) hiddenInput.value = '';
        this.populateTemplateChips(this.app.currentSpace.id, this.createFileTargetFolder());

        // Changing the destination changes which templates apply, so re-resolve.
        // One listener for the lifetime of the page — the modal is reused, not
        // rebuilt, so binding on every open would stack duplicates.
        const locationSelect = document.getElementById('fileLocation');
        if (locationSelect && !locationSelect.dataset.tplBound) {
            locationSelect.dataset.tplBound = '1';
            locationSelect.addEventListener('change', () => {
                const hidden = document.getElementById('selectedTemplatePath');
                if (hidden) hidden.value = '';
                if (this.app.currentSpace) {
                    this.populateTemplateChips(this.app.currentSpace.id, this.createFileTargetFolder());
                }
            });
        }
    },

    applyTemplatePlaceholders(content, ctx) {
        if (!content) return content;

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const dateTime = `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const profile = this.app?.userProfile || {};
        const username = profile.name && profile.name !== 'User'
            ? profile.name
            : (profile.email || 'User');

        const spaceName = ctx?.spaceName || '';
        const filePath = ctx?.filePath || '';
        const folderPath = ctx?.folderPath || '';

        const encodePath = p => String(p || '').split('/').map(encodeURIComponent).join('/');
        const urlFile = spaceName
            ? `/applications/wiki/${encodeURIComponent(spaceName)}/${encodePath(filePath)}`
            : '';
        const urlFolder = spaceName
            ? `/applications/wiki/${encodeURIComponent(spaceName)}${folderPath ? '/' + encodePath(folderPath) : ''}`
            : '';

        const map = {
            '{date}': date,
            '{date-time}': dateTime,
            '{username}': username,
            '{url-file}': urlFile,
            '{url-folder}': urlFolder
        };

        return content.replace(/\{date-time\}|\{date\}|\{username\}|\{url-file\}|\{url-folder\}/g,
            m => map[m] ?? m);
    },

    /** The folder the Create File dialog is currently aimed at ('' = space root). */
    createFileTargetFolder() {
        if (this.prefilledFilePath !== null && this.prefilledFilePath !== undefined) {
            return this.prefilledFilePath || '';
        }
        return document.getElementById('fileLocation')?.value || '';
    },

    /**
     * Fill the template chip row for the folder the new file is going into.
     *
     * The server resolves the CASCADE for that folder — its own `.system/templates/`,
     * then each ancestor's, ending at the space root — with a nearer template of the
     * same name hiding the ones above it. Chips are rendered in that order and
     * labelled with where each one came from, so "closest wins" is visible rather
     * than merely true.
     *
     * Personal templates are space-wide and sit outside the distance ordering, so
     * they keep their own leading group.
     */
    async populateTemplateChips(spaceId, folderPath = '') {
        const container = document.getElementById('fileTemplateChips');
        if (!container) return;

        // Late replies from a previous folder must not overwrite the current one:
        // changing the Location dropdown fires this again while a fetch is open.
        const token = (this._templateChipToken = (this._templateChipToken || 0) + 1);
        container.innerHTML = '<div class="kr-tpl-chips-empty">Loading templates…</div>';

        try {
            const query = folderPath ? `?folderPath=${encodeURIComponent(folderPath)}` : '';
            const res = await fetch(`/applications/wiki/api/spaces/${spaceId}/templates${query}`,
                { credentials: 'include' });
            const templates = await res.json();
            if (token !== this._templateChipToken) return;

            if (!Array.isArray(templates) || templates.length === 0) {
                container.innerHTML = '<div class="kr-tpl-chips-empty">No templates available for this space.</div>';
                return;
            }

            const personal = templates.filter(t => t.scope === 'personal');
            // Already closest-first from the server; grouped by origin so each
            // distance gets one label rather than one per chip.
            const inherited = templates.filter(t => t.scope !== 'personal');
            const groups = [];
            for (const t of inherited) {
                // The space tier must not share a key with a FOLDER, and a folder at
                // the space root has folderPath '' — so the sentinel is prefixed with a
                // NUL, which no path can contain. Written as the ESCAPE, never the raw
                // byte: a literal NUL makes git and ripgrep treat this whole file as
                // binary, dropping it out of diffs and code searches.
                const key = t.scope === 'folder' ? (t.folderPath || '') : '\u0000space';
                const last = groups[groups.length - 1];
                if (last && last.key === key) last.items.push(t);
                else groups.push({ key, scope: t.scope, template: t, items: [t] });
            }

            const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            const chip = (t, icon) => `
                <button type="button" class="kr-tpl-chip" data-scope="${esc(t.scope || 'space')}"
                        data-template-path="${esc(t.path)}"
                        title="${esc(t.title || t.name)}${t.scope === 'folder' ? ` — from ${esc(t.folderPath)}` : ''}">
                    <i class="bi ${icon}"></i>
                    <span>${esc(t.title || t.name)}</span>
                </button>`;
            const section = (label, items, icon) => items.length
                ? `<span class="kr-tpl-chip-label" style="align-self:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--kr-ink-400);margin-right:4px;">${esc(label)}</span>`
                  + items.map(t => chip(t, icon)).join('')
                : '';

            // Label the nearest folder group "This folder"; further ancestors by
            // their own name, so an inherited template says where it comes from.
            const groupLabel = (g) => {
                if (g.scope !== 'folder') return 'Space';
                if (g.key === folderPath) return 'This folder';
                return g.template.folderName || g.key;
            };
            const showLabels = personal.length + groups.length > 1;

            container.innerHTML =
                section(showLabels ? 'Mine' : '', personal, 'bi-person-fill') +
                groups.map(g => section(
                    showLabels ? groupLabel(g) : '',
                    g.items,
                    g.scope === 'folder' ? 'bi-folder-fill' : 'bi-tag-fill'
                )).join('');

            container.querySelectorAll('.kr-tpl-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const wasActive = chip.classList.contains('active');
                    container.querySelectorAll('.kr-tpl-chip.active').forEach(c => c.classList.remove('active'));
                    const hidden = document.getElementById('selectedTemplatePath');
                    if (wasActive) {
                        if (hidden) hidden.value = '';
                    } else {
                        chip.classList.add('active');
                        if (hidden) hidden.value = chip.dataset.templatePath;
                    }
                });
            });
        } catch (err) {
            if (token !== this._templateChipToken) return;
            console.error('Failed to load templates for chips:', err);
            container.innerHTML = '<div class="kr-tpl-chips-empty">Could not load templates.</div>';
        }
    },

    async handleCreateFile() {
        const form = document.getElementById('createFileForm');
        const formData = new FormData(form);

        try {
            // Use prefilled path if available, otherwise use form selection
            const folderPath = this.prefilledFilePath !== null ?
                this.prefilledFilePath :
                (formData.get('fileLocation') || '');

            // If a template is selected, fetch its content to seed the new file
            let initialContent = '';
            const templatePath = formData.get('selectedTemplatePath');
            if (templatePath) {
                try {
                    const tplRes = await fetch(
                        `/applications/wiki/api/documents/content?path=${encodeURIComponent(templatePath)}&spaceName=${encodeURIComponent(this.app.currentSpace.name)}&enhanced=true`,
                        { credentials: 'include' }
                    );
                    const tplData = await tplRes.json();
                    if (tplData && typeof tplData.content === 'string') {
                        const fileName = formData.get('fileName');
                        const newFilePath = folderPath ? `${folderPath}/${fileName}` : fileName;
                        initialContent = this.applyTemplatePlaceholders(tplData.content, {
                            spaceName: this.app.currentSpace.name,
                            filePath: newFilePath,
                            folderPath: folderPath
                        });
                    }
                } catch (tplErr) {
                    console.warn('Could not load template content; creating empty file:', tplErr);
                }
            }

            // Send the name EXACTLY as typed. This used to post
            // `fileName.replace('.md', '')` as the `title`, which the server then
            // slugified — so `.Engineering.md` was created as `engineering.md`.
            // (The strip was wrong on its own terms too: `.replace` hits the
            // first occurrence anywhere, so `Read.mdx` lost its middle.) The
            // server owns extension defaulting and validation now.
            const response = await fetch('/applications/wiki/api/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: formData.get('fileName'),
                    spaceId: this.app.currentSpace.id,
                    folderPath: folderPath,
                    content: initialContent
                })
            });

            const result = await response.json();

            if (result.success) {
                this.app.hideModal('createFileModal');
                form.reset();

                // Reuse the `folderPath` resolved at the top. This used to
                // re-derive it HERE, after hideModal() — which clears
                // prefilledFilePath — so the second read fell through to the
                // form's location select. For a context-menu create that select
                // is hidden and holds an unrelated value, so the tree refresh
                // and the folder-view check below both aimed at the wrong
                // folder: the new file appeared nowhere until a manual reload.
                // (It survived only because the reset in hideModal was landing
                // on the wrong object and never actually cleared anything.)

                // Update only the affected tree node
                await this.updateTreeNode(folderPath);

                // If we're currently viewing a folder, refresh the folder view
                if (this.app.currentView === 'folder' && this.app.currentFolder === folderPath) {
                    await this.loadFolderContent(folderPath);
                }

                // Open what the server actually created. Re-deriving the path
                // from the typed name assumed the two always matched, and they
                // did not: the old slug meant every auto-open after a create
                // asked for a file that did not exist. `result.path` is now the
                // one answer to "where did it go", and it is also what the
                // notification reports, so a name the server had to adjust (a
                // missing extension) is visible rather than a surprise.
                const createdPath = result.path
                    || (folderPath ? `${folderPath}/${formData.get('fileName')}` : formData.get('fileName'));

                this.app.showNotification(`Created ${createdPath.split('/').pop()}`, 'success');

                documentController.openDocumentByPath(createdPath, this.app.currentSpace.name);
            } else {
                throw new Error(result.message || 'Failed to create file');
            }
        } catch (error) {
            console.error('Error creating file:', error);
            // Surface the server's reason (an unusable name answers 400 with
            // one) instead of a blanket failure the user cannot act on.
            this.app.showNotification(error.message || 'Failed to create file', 'error');
        }
    },

    showUploadDialog(targetPath = null) {
        if (window.wikiConfig?.editingEnabled === false) {
            this.app.showNotification('Editing is disabled', 'warning');
            return;
        }
        this.uploadTargetPath = targetPath || '';
        const fileInput = document.getElementById('fileUploadInput');
        fileInput?.click();
    },

    async handleFileUpload(files, targetPath = '') {
        if (!files || files.length === 0) return;

        const uploadPath = targetPath || '';

        for (const file of files) {
            try {
                // Create FormData for multipart upload
                const formData = new FormData();
                formData.append('file', file);
                formData.append('spaceId', this.app.currentSpace.id);
                formData.append('folderPath', uploadPath);

                // Upload using the proper upload endpoint
                const response = await fetch('/applications/wiki/api/documents/upload', {
                    method: 'POST',
                    body: formData
                    // Don't set Content-Type header - browser will set it with boundary
                });

                const result = await response.json();

                if (result.success) {
                    this.app.showNotification(`File "${file.name}" uploaded successfully`, 'success');
                } else {
                    throw new Error(result.error || 'Failed to upload file');
                }
            } catch (error) {
                console.error('Upload error:', error);
                this.app.showNotification(`Failed to upload "${file.name}": ${error.message}`, 'error');
            }
        }

        // Reset the file input
        const fileInput = document.getElementById('fileUploadInput');
        if (fileInput) {
            fileInput.value = '';
        }

        // Update only the affected tree node
        await this.updateTreeNode(uploadPath);

        // If we're currently viewing a folder, refresh the folder view
        if (this.app.currentView === 'folder' && this.app.currentFolder === uploadPath) {
            await this.loadFolderContent(uploadPath);
        }
    },

    async readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                resolve(e.target.result);
            };

            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };

            // Check if it's a text file or binary
            if (file.type.startsWith('text/') ||
                file.name.endsWith('.md') ||
                file.name.endsWith('.txt') ||
                file.name.endsWith('.json') ||
                file.name.endsWith('.xml') ||
                file.name.endsWith('.js') ||
                file.name.endsWith('.css') ||
                file.name.endsWith('.html')) {
                reader.readAsText(file);
            } else {
                // For binary files, read as data URL
                reader.readAsDataURL(file);
            }
        });
    },

    // Rename and Delete Operations
    showRenameModal(itemPath, itemType) {
        this.renameItemPath = itemPath;
        this.renameItemType = itemType;

        // Extract current name from path
        const currentName = itemPath ? itemPath.split('/').pop() : '';

        // Update modal title and prefill current name
        const itemTypeText = itemType === 'folder' ? 'Folder' : 'File';
        document.getElementById('renameItemType').textContent = itemTypeText;
        document.getElementById('newItemName').value = currentName;

        this.app.showModal('renameModal');

        // Focus the input
        setTimeout(() => {
            const input = document.getElementById('newItemName');
            input?.focus();
            input?.select();
        }, 100);
    },

    async handleRename() {
        const form = document.getElementById('renameForm');
        const formData = new FormData(form);

        try {
            // Validate new name
            const newName = formData.get('newItemName').trim();
            if (!newName) {
                this.app.showNotification('Name cannot be empty', 'error');
                return;
            }

            // Check for invalid characters
            const invalidChars = /[<>:"|?*\\/]/;
            if (invalidChars.test(newName)) {
                this.app.showNotification('Name cannot contain: < > : " | ? * \\ /', 'error');
                return;
            }

            const oldPath = this.renameItemPath;
            const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';

            if (this.renameItemType === 'folder') {
                // Rename folder via API
                const response = await fetch(`/applications/wiki/api/folders/rename`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spaceId: this.app.currentSpace.id,
                        oldPath: oldPath,
                        newName: newName
                    })
                });

                const result = await response.json();

                if (result.success) {
                    this.app.hideModal('renameModal');
                    form.reset();

                    // Granular update: rename folder in tree without full refresh
                    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
                    navigationState.renameFolderInTree(oldPath, newPath, newName);

                    // Update fullFileTree data
                    if (this.fullFileTree) {
                        const node = this._findNodeInTree(this.fullFileTree, oldPath);
                        if (node) {
                            node.name = newName;
                            node.path = newPath;
                            if (node.children) {
                                this._updateChildPaths(node.children, oldPath, newPath);
                            }
                        }
                    }

                    // Re-bind events on renamed folder
                    const renamedFolderEl = document.querySelector(`[data-folder-id="${navigationState.getFolderId(newPath)}"]`);
                    if (renamedFolderEl) {
                        this.bindFolderItemEvents_Single(renamedFolderEl);
                    }

                    // If we're currently viewing a folder, refresh the folder view
                    if (this.app.currentView === 'folder' && this.app.currentFolder === parentPath) {
                        await this.loadFolderContent(parentPath);
                    }

                    this.app.showNotification('Folder renamed successfully!', 'success');
                } else {
                    throw new Error(result.message || 'Failed to rename folder');
                }
            } else {
                // Rename file via API
                const response = await fetch(`/applications/wiki/api/documents/rename`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spaceName: this.app.currentSpace.name,
                        oldPath: oldPath,
                        newName: newName
                    })
                });

                const result = await response.json();

                if (result.success) {
                    this.app.hideModal('renameModal');
                    form.reset();

                    // Granular update: rename file in tree without full refresh
                    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
                    navigationState.renameFileInTree(oldPath, newPath, newName);

                    // Update fullFileTree data
                    if (this.fullFileTree) {
                        const node = this._findNodeInTree(this.fullFileTree, oldPath);
                        if (node) {
                            node.name = newName;
                            node.path = newPath;
                        }
                    }

                    // Re-bind events on renamed file
                    const renamedFileEl = document.querySelector(`[data-document-path="${newPath}"]`);
                    if (renamedFileEl) {
                        this.bindFileItemEvents_Single(renamedFileEl);
                    }

                    // If we're currently viewing a folder, refresh the folder view
                    if (this.app.currentView === 'folder' && this.app.currentFolder === parentPath) {
                        await this.loadFolderContent(parentPath);
                    }

                    this.app.showNotification('File renamed successfully!', 'success');
                } else {
                    throw new Error(result.message || 'Failed to rename file');
                }
            }
        } catch (error) {
            console.error('Error renaming item:', error);
            this.app.showNotification(`Failed to rename ${this.renameItemType}`, 'error');
        }
    },

    async handleDeleteItem(itemPath, itemType) {
        if (!itemPath && itemType === 'folder') {
            this.app.showNotification('Cannot delete root folder', 'error');
            return;
        }

        if (!itemPath || itemPath === '' || itemPath === 'undefined') {
            this.app.showNotification('Cannot delete: path is missing', 'error');
            return;
        }

        const itemName = itemPath ? itemPath.split('/').pop() : 'item';
        const itemTypeDisplay = itemType === 'folder' ? 'folder' : 'file';

        // Show confirmation dialog
        const confirmed = confirm(`Are you sure you want to delete the ${itemTypeDisplay} "${itemName}"?\n\nThis action cannot be undone.${itemType === 'folder' ? ' All contents will be deleted.' : ''}`);

        if (!confirmed) {
            return;
        }

        try {
            let response;

            if (itemType === 'folder') {
                // Delete folder
                response = await fetch(`/applications/wiki/api/folders/${encodeURIComponent(itemPath)}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        spaceId: this.app.currentSpace?.id,
                        path: itemPath
                    })
                });
            } else {
                // Delete file - use the stored space name or current space
                const spaceName = this.contextMenuTargetSpaceName || this.app.currentSpace?.name;

                response = await fetch(`/applications/wiki/api/documents/${encodeURIComponent(itemPath)}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        spaceId: this.app.currentSpace?.id,
                        spaceName: spaceName,
                        path: itemPath
                    })
                });
            }

            const result = await response.json();

            if (response.ok && result.success) {
                this.app.showNotification(`${itemTypeDisplay.charAt(0).toUpperCase() + itemTypeDisplay.slice(1)} "${itemName}" deleted successfully`, 'success');

                // Update only the parent tree node
                const parentPath = itemPath ? itemPath.substring(0, itemPath.lastIndexOf('/')) : '';
                await this.updateTreeNode(parentPath);

                // If we're currently viewing a folder, refresh the folder view
                if (this.app.currentView === 'folder' && this.app.currentFolder === parentPath) {
                    await this.loadFolderContent(parentPath);
                } else if (this.app.currentView === 'folder' && itemType === 'folder' && itemPath === this.app.currentFolder) {
                    // If we deleted the folder we're currently viewing, go back to parent or home
                    if (parentPath) {
                        await this.loadFolderContent(parentPath);
                    } else {
                        this.app.showHome();
                    }
                }

                // If we're currently viewing the deleted item, go back to home
                if (this.app.currentDocument && itemType === 'file' && this.app.currentDocument.path === itemPath) {
                    this.app.showHome();
                }
            } else {
                throw new Error(result.message || `Failed to delete ${itemTypeDisplay}`);
            }
        } catch (error) {
            console.error(`Error deleting ${itemTypeDisplay}:`, error);
            this.app.showNotification(`Failed to delete ${itemTypeDisplay}`, 'error');
        }
    },

    // File utility methods
    getFileIcon(filename) {
        const extension = filename.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'md':
            case 'markdown':
                return { icon: 'bi-file-text', color: '' };
            case 'txt':
                return { icon: 'bi-file-text', color: '' };
            case 'pdf':
                return { icon: 'bi-file-pdf', color: '' };
            case 'doc':
            case 'docx':
                return { icon: 'bi-file-word', color: '' };
            case 'xls':
            case 'xlsx':
                return { icon: 'bi-file-excel', color: '' };
            case 'ppt':
            case 'pptx':
                return { icon: 'bi-file-ppt', color: '' };
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
            case 'svg':
                return { icon: 'bi-file-image', color: '' };
            case 'mp4':
            case 'webm':
            case 'ogg':
            case 'ogv':
            case 'mov':
            case 'avi':
            case 'mkv':
            case 'flv':
            case 'wmv':
            case 'm4v':
                return { icon: 'bi-play-circle', color: '' };
            case 'mp3':
            case 'wav':
            case 'flac':
            case 'aac':
            case 'm4a':
            case 'oga':
            case 'weba':
            case 'opus':
                return { icon: 'bi-music-note-beamed', color: '' };
            case 'js':
            case 'ts':
            case 'jsx':
            case 'tsx':
                return { icon: 'bi-file-code', color: '' };
            case 'html':
            case 'htm':
                return { icon: 'bi-file-code', color: '' };
            case 'css':
            case 'scss':
            case 'sass':
                return { icon: 'bi-file-code', color: '' };
            case 'json':
            case 'xml':
                return { icon: 'bi-file-code', color: '' };
            default:
                return { icon: 'bi-file', color: '' };
        }
    },

    getFileTypeFromExtension(filename) {
        const extension = filename.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'md':
            case 'markdown':
                return 'Markdown';
            case 'txt':
                return 'Text';
            case 'pdf':
                return 'PDF';
            case 'doc':
            case 'docx':
                return 'Word Document';
            case 'xls':
            case 'xlsx':
                return 'Excel';
            case 'ppt':
            case 'pptx':
                return 'PowerPoint';
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
            case 'svg':
                return 'Image';
            case 'mp4':
            case 'webm':
            case 'ogg':
            case 'ogv':
            case 'mov':
            case 'avi':
            case 'mkv':
            case 'flv':
            case 'wmv':
            case 'm4v':
                return 'Video';
            case 'mp3':
            case 'wav':
            case 'flac':
            case 'aac':
            case 'm4a':
            case 'oga':
            case 'weba':
            case 'opus':
                return 'Audio';
            case 'js':
            case 'ts':
                return 'JavaScript';
            case 'jsx':
            case 'tsx':
                return 'React';
            case 'html':
            case 'htm':
                return 'HTML';
            case 'css':
            case 'scss':
            case 'sass':
                return 'CSS';
            case 'json':
                return 'JSON';
            case 'xml':
                return 'XML';
            default:
                return 'File';
        }
    },

    getFileTypeInfo(filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const fileName = filePath.split('/').pop() || '';

        // File category mappings matching backend - all icons now use consistent gray color
        const categories = {
            pdf: {
                category: 'pdf',
                viewer: 'pdf',
                extensions: ['pdf'],
                icon: 'file-pdf',
                color: '#666666'
            },
            image: {
                category: 'image',
                viewer: 'image',
                extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'],
                icon: 'image',
                color: '#666666'
            },
            video: {
                category: 'video',
                viewer: 'video',
                extensions: ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'flv', 'm4v'],
                icon: 'film',
                color: '#666666'
            },
            audio: {
                category: 'audio',
                viewer: 'audio',
                extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'weba', 'opus'],
                icon: 'music',
                color: '#666666'
            },
            text: {
                category: 'text',
                viewer: 'text',
                extensions: ['txt', 'csv', 'dat', 'log', 'ini', 'cfg', 'conf'],
                icon: 'file-alt',
                color: '#666666'
            },
            markdown: {
                category: 'markdown',
                viewer: 'markdown',
                extensions: ['md', 'markdown'],
                icon: 'file-alt',
                color: '#666666'
            },
            code: {
                category: 'code',
                viewer: 'code',
                extensions: ['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'r', 'm', 'mm', 'pl', 'sh', 'bash', 'ps1', 'bat', 'cmd'],
                icon: 'file-code',
                color: '#666666'
            },
            web: {
                category: 'web',
                viewer: 'code',
                extensions: ['html', 'htm', 'css', 'scss', 'sass', 'less'],
                icon: 'code',
                color: '#666666'
            },
            data: {
                category: 'data',
                viewer: 'code',
                extensions: ['json', 'xml', 'yaml', 'yml', 'toml', 'properties'],
                icon: 'file-code',
                color: '#666666'
            }
        };

        // Check by extension
        for (const info of Object.values(categories)) {
            if (info.extensions.includes(ext)) {
                return {
                    category: info.category,
                    viewer: info.viewer,
                    extension: ext,
                    fileName: fileName,
                    icon: info.icon,
                    color: info.color
                };
            }
        }

        // Default fallback
        return {
            category: 'other',
            viewer: 'default',
            extension: ext,
            fileName: fileName,
            icon: 'file',
            color: '#666666'
        };
    },

    getFileTypeIconClass(category) {
        const iconMap = {
            'pdf': 'bi-file-pdf',
            'image': 'bi-file-image',
            'video': 'bi-play-circle',
            'audio': 'bi-music-note-beamed',
            'text': 'bi-file-text',
            'markdown': 'bi-markdown',
            'code': 'bi-file-code',
            'web': 'bi-code-slash',
            'data': 'bi-filetype-json',
            'other': 'bi-file-earmark'
        };

        return iconMap[category] || 'bi-file-earmark';
    },

    getFileNameFromPath(filePath) {
        if (!filePath) return 'Untitled';
        return filePath.split('/').pop() || filePath;
    },

    // File Preview Methods
    initFilePreview() {
        // Create preview tooltip element if it doesn't exist
        if (!document.getElementById('filePreviewTooltip')) {
            const tooltip = document.createElement('div');
            tooltip.id = 'filePreviewTooltip';
            tooltip.className = 'file-preview-tooltip';
            tooltip.innerHTML = '<div class="file-preview-content"></div>';
            document.body.appendChild(tooltip);
        }

        this.previewTimeout = null;
        this.currentPreviewCard = null;
    },

    async showFilePreview(card, documentPath, spaceName) {
        const tooltip = document.getElementById('filePreviewTooltip');
        if (!tooltip) return;

        const content = tooltip.querySelector('.file-preview-content');

        // Show loading state
        content.innerHTML = '<div class="file-preview-loading"><span class="spinner-border spinner-border-sm me-2"></span>Loading preview...</div>';

        // Position tooltip near the card
        this.positionPreviewTooltip(tooltip, card);

        // Show tooltip
        tooltip.classList.add('show');

        try {
            // Fetch file metadata and content preview
            const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(documentPath)}&spaceName=${encodeURIComponent(spaceName)}&enhanced=true`);

            if (!response.ok) {
                throw new Error('Failed to load preview');
            }

            const data = await response.json();
            const { content: fileContent, metadata } = data;

            // Generate preview based on file type
            const viewer = metadata?.viewer || 'default';
            let previewHtml = '';

            switch (viewer) {
                case 'image': {
                    const previewSpaceId = this.app.currentSpace && this.app.currentSpace.id;
                    const imageUrl = previewSpaceId ? WikiAPI.filing.getDirectUrl(previewSpaceId, documentPath) : `/applications/wiki/api/documents/content?path=${encodeURIComponent(documentPath)}&spaceName=${encodeURIComponent(spaceName)}`;
                    previewHtml = `<img src="${imageUrl}" alt="Preview" />`;
                    break;
                }

                case 'markdown': {
                    // Strip image markdown entirely before preview truncation
                    const cleanedContent = fileContent
                        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
                        .replace(/\n{3,}/g, '\n\n');
                    if (typeof marked !== 'undefined') {
                        const preview = cleanedContent.substring(0, 500) + (cleanedContent.length > 500 ? '...' : '');
                        previewHtml = `<div class="markdown-preview">${parseMarkdown(preview)}</div>`;
                    } else {
                        const preview = cleanedContent.substring(0, 300) + (cleanedContent.length > 300 ? '...' : '');
                        previewHtml = `<pre>${this.escapeHtml(preview)}</pre>`;
                    }
                    break;
                }

                case 'text':
                case 'code':
                case 'web':
                case 'data':
                    // Show first 300 characters with line numbers
                    const lines = fileContent.split('\n').slice(0, 10);
                    const preview = lines.join('\n') + (fileContent.split('\n').length > 10 ? '\n...' : '');
                    previewHtml = `<pre>${this.escapeHtml(preview)}</pre>`;
                    break;

                case 'pdf':
                    const fileName = metadata?.fileName || documentPath.split('/').pop() || 'PDF Document';
                    const pdfPreviewUrl = `/applications/wiki/api/documents/pdf-preview?path=${encodeURIComponent(documentPath)}&spaceName=${encodeURIComponent(spaceName)}&page=1`;
                    previewHtml = `
                        <div class="pdf-preview-container">
                            <img src="${pdfPreviewUrl}" alt="PDF Preview" style="max-width: 100%; max-height: 250px; border-radius: 4px;"
                                 onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'text-center p-3\\'><i class=\\'bi bi-file-earmark-pdf\\' style=\\'font-size: 42px; color: #dc3545;\\'></i><p class=\\'mt-2 mb-0\\'>PDF Preview Failed</p><small class=\\'text-muted\\'>${fileName}</small></div>';" />
                            <p class="mt-2 mb-0 text-center"><small class="text-muted">${fileName}</small></p>
                        </div>
                    `;
                    break;

                default:
                    const defaultFileName = metadata?.fileName || documentPath.split('/').pop() || 'Unknown';
                    previewHtml = `
                        <div class="text-center p-3">
                            <i class="bi bi-file-earmark" style="font-size: 42px; color: #6c757d;"></i>
                            <p class="mt-2 mb-0">${defaultFileName}</p>
                            <small class="text-muted">No preview available</small>
                        </div>
                    `;
                    break;
            }

            content.innerHTML = previewHtml;

        } catch (error) {
            console.error('Error loading preview:', error);
            content.innerHTML = '<div class="preview-error">Failed to load preview</div>';
        }
    },

    positionPreviewTooltip(tooltip, card) {
        const cardRect = card.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        // Position to the right of the card by default
        let left = cardRect.right + 10;
        let top = cardRect.top;

        // If tooltip would go off screen to the right, show on left
        if (left + tooltipRect.width > window.innerWidth) {
            left = cardRect.left - tooltipRect.width - 10;
        }

        // If tooltip would go off screen at bottom, adjust top position
        if (top + tooltipRect.height > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - 10;
        }

        // Ensure tooltip doesn't go off top of screen
        if (top < 10) {
            top = 10;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    },

    hideFilePreview() {
        const tooltip = document.getElementById('filePreviewTooltip');
        if (tooltip) {
            tooltip.classList.remove('show');
        }

        if (this.previewTimeout) {
            clearTimeout(this.previewTimeout);
            this.previewTimeout = null;
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Drag and Drop Methods
    handleDragStart(e, itemPath, itemType) {
        e.stopPropagation();

        console.log('[Phase 8] Drag started:', { itemPath, itemType, spaceId: this.app.currentSpace.id });

        // Store drag data
        e.dataTransfer.setData('text/plain', JSON.stringify({
            sourcePath: itemPath,
            itemType: itemType,
            spaceId: this.app.currentSpace.id
        }));

        e.dataTransfer.effectAllowed = 'move';

        // Add visual feedback - make the dragged element semi-transparent
        e.target.style.opacity = '0.5';
        e.target.classList.add('dragging');
    },

    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
    },

    _computeDropZone(e, row, targetType) {
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height || 1;
        const ratio = y / h;
        if (targetType === 'folder') {
            if (ratio < 0.25) return 'before';
            if (ratio > 0.75) return 'after';
            return 'into';
        }
        return ratio < 0.5 ? 'before' : 'after';
    },

    _clearDropIndicators(container) {
        const root = container || document;
        root.querySelectorAll('.kr-file-row.drag-insert-before, .kr-file-row.drag-insert-after')
            .forEach(el => el.classList.remove('drag-insert-before', 'drag-insert-after'));
    },

    _rowsContainerFor(row) {
        return row.closest('.kr-file-rows') || row.parentElement;
    },

    _rowName(row) {
        const p = row.dataset.folderPath || row.dataset.documentPath || '';
        return p.split('/').pop();
    },

    _handleRowDragOver(e, row, targetType) {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const zone = this._computeDropZone(e, row, targetType);
        const rowsContainer = this._rowsContainerFor(row);
        this._clearDropIndicators(rowsContainer);
        if (zone === 'into' && targetType === 'folder') {
            row.classList.add('drag-over');
        } else {
            row.classList.remove('drag-over');
            row.classList.add(zone === 'before' ? 'drag-insert-before' : 'drag-insert-after');
        }
    },

    _handleRowDragLeave(e, row) {
        e.stopPropagation();
        const rect = row.getBoundingClientRect();
        const x = e.clientX, y = e.clientY;
        if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
            row.classList.remove('drag-over', 'drag-insert-before', 'drag-insert-after');
        }
    },

    async _handleRowDrop(e, row, targetType) {
        e.preventDefault();
        e.stopPropagation();

        const zone = this._computeDropZone(e, row, targetType);
        const rowsContainer = this._rowsContainerFor(row);
        this._clearDropIndicators(rowsContainer);
        row.classList.remove('drag-over');

        // External file drop = upload (no reorder semantics)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            if (targetType === 'folder') {
                return this.handleExternalFileDrop(e, row.dataset.folderPath);
            }
            return;
        }

        // Parse internal drag payload
        let dragData;
        try { dragData = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); }
        catch (_) { return; }
        const { sourcePath, itemType } = dragData;
        if (!sourcePath || !itemType) return;

        // "into" on a folder → existing move-into-folder flow
        if (zone === 'into' && targetType === 'folder') {
            return this.handleDrop(e, row.dataset.folderPath, 'folder');
        }

        // before/after → reorder within the current parent folder
        await this._reorderRelativeTo(row, sourcePath, zone);
    },

    async _reorderRelativeTo(targetRow, sourcePath, zone) {
        const space = this.app?.currentSpace;
        if (!space) return;
        const parentFolderPath = this.app.currentFolder || '';

        // Reorder only makes sense when source lives in the folder being viewed.
        const sourceParent = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
        if (sourceParent !== parentFolderPath) {
            this.app.showNotification && this.app.showNotification(
                'Drop on the centre of a folder to move into it; drop between rows only reorders items already in this folder.',
                'warning'
            );
            return;
        }
        if (sourcePath === (targetRow.dataset.folderPath || targetRow.dataset.documentPath)) return;

        // Build new order from current DOM, excluding the source, then insert at the target slot.
        const rowsContainer = this._rowsContainerFor(targetRow);
        const allRows = Array.from(rowsContainer.querySelectorAll('.kr-file-row'));
        const sourceName = sourcePath.split('/').pop();
        const targetName = this._rowName(targetRow);
        const names = allRows.map(r => this._rowName(r)).filter(n => n && n !== sourceName);
        let idx = names.indexOf(targetName);
        if (idx === -1) idx = names.length;
        names.splice(zone === 'after' ? idx + 1 : idx, 0, sourceName);

        try {
            const res = await fetch(`/applications/wiki/api/spaces/${space.id}/folder-order`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath: parentFolderPath, order: names }),
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok || !out.success) throw new Error(out.message || `HTTP ${res.status}`);
            await this.loadFileTree();
            await this.loadFolderContent(parentFolderPath);
            this.app.showNotification && this.app.showNotification('Order saved', 'success');
        } catch (err) {
            console.error('[folder-order] Failed to save order:', err);
            this.app.showNotification && this.app.showNotification('Failed to save order: ' + err.message, 'error');
        }
    },

    handleDragEnter(e, targetElement) {
        e.preventDefault();
        e.stopPropagation();

        const targetPath = targetElement.dataset.folderPath || targetElement.dataset.documentPath;
        console.log('[Phase 8] Drag enter:', { targetPath, elementClass: targetElement.className });

        // Add visual feedback to drop target
        targetElement.classList.add('drag-over');

        // Phase 8: Auto-expand folder on drag-over-hold
        // Only expand folders, not files
        if (targetElement.classList.contains('folder-item') || targetElement.classList.contains('folder-card')) {
            // Clear any existing timeout
            if (this.dragExpandTimeout) {
                clearTimeout(this.dragExpandTimeout);
            }

            // Set timeout to expand folder after delay
            this.dragExpandTimeout = setTimeout(() => {
                const folderId = targetElement.dataset.folderId;

                // For file tree folders
                if (targetElement.classList.contains('folder-item')) {
                    const hasChildren = document.querySelector(`[data-folder-children="${folderId}"]`);

                    // Only expand if folder has children and isn't already expanded
                    if (hasChildren && !targetElement.classList.contains('expanded')) {
                        this.toggleFolder(folderId);
                        console.log(`[Phase 8] Auto-expanded file tree folder on drag-over: ${targetElement.dataset.folderPath}`);
                    }
                }
                // For folder viewer cards - handled by loadFolderContent
                else if (targetElement.classList.contains('folder-card')) {
                    const folderPath = targetElement.dataset.folderPath;
                    console.log(`[Phase 8] Would expand folder viewer folder on drag-over: ${folderPath}`);
                }
            }, this.dragExpandDelay);

            this.dragOverFolder = targetElement;
        }
    },

    handleDragLeave(e, targetElement) {
        e.stopPropagation();

        // Remove visual feedback only if actually leaving the element
        const rect = targetElement.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;

        if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
            targetElement.classList.remove('drag-over');

            // Phase 8: Cancel auto-expand timeout when leaving folder
            if (this.dragExpandTimeout && this.dragOverFolder === targetElement) {
                clearTimeout(this.dragExpandTimeout);
                this.dragExpandTimeout = null;
                this.dragOverFolder = null;
            }
        }
    },

    async handleDrop(e, targetPath, targetType) {
        e.preventDefault();
        e.stopPropagation();

        // Phase 8: Clear drag state
        if (this.dragExpandTimeout) {
            clearTimeout(this.dragExpandTimeout);
            this.dragExpandTimeout = null;
        }
        this.dragOverFolder = null;

        // Check if this is an external file drag (from file system) or internal drag (from app)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            // External file drag - handle file upload to target folder
            console.log('[Phase 8] External file drop detected:', { targetPath, fileCount: e.dataTransfer.files.length });
            this.handleExternalFileDrop(e, targetPath);
            return;
        }

        // Get drag data for internal drag-drop
        let dragData;
        try {
            const dragDataText = e.dataTransfer.getData('text/plain');
            if (!dragDataText) {
                console.warn('[Phase 8] No drag data found');
                this.app.showNotification('No drag data found', 'error');
                return;
            }
            dragData = JSON.parse(dragDataText);
        } catch (parseError) {
            console.error('[Phase 8] Failed to parse drag data:', parseError);
            this.app.showNotification('Failed to process drag and drop', 'error');
            return;
        }

        const { sourcePath, itemType, spaceId } = dragData;

        // Validate drag data
        if (!sourcePath || !itemType || !spaceId) {
            console.error('[Phase 8] Invalid drag data:', dragData);
            this.app.showNotification('Failed to process drag and drop', 'error');
            return;
        }

        // Remove visual feedback from all elements
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        document.querySelectorAll('.dragging').forEach(el => {
            el.style.opacity = '';
            el.classList.remove('dragging');
        });

        // Validate drop target
        if (targetType !== 'folder') {
            console.log('Can only drop into folders');
            return;
        }

        // Phase 8: Check if target folder is read-only
        const targetFolderElement = document.querySelector(`[data-folder-path="${targetPath}"]`);
        if (targetFolderElement && targetFolderElement.classList.contains('read-only')) {
            this.app.showNotification('Cannot drop files into read-only folders', 'error');
            return;
        }

        // Prevent dropping into the same location
        const sourceParent = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
        console.log('[Phase 8] Drop location check:', { sourcePath, sourceParent, targetPath, isSame: sourceParent === targetPath });
        if (sourceParent === targetPath) {
            console.log('Already in this folder');
            this.app.showNotification('Item is already in this folder', 'warning');
            return;
        }

        // Prevent dropping folder into itself or its children
        if (itemType === 'folder' && (targetPath === sourcePath || targetPath.startsWith(sourcePath + '/'))) {
            this.app.showNotification('Cannot move a folder into itself', 'error');
            return;
        }

        try {
            // Call the move API
            const response = await fetch('/applications/wiki/api/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourcePath: sourcePath,
                    targetPath: targetPath,
                    spaceId: spaceId,
                    itemType: itemType
                })
            });

            const result = await response.json();

            // Log the response for debugging
            console.log('[Phase 8] Move API response:', { status: response.status, result });

            if (result.success) {
                this.app.showNotification(`${itemType === 'folder' ? 'Folder' : 'File'} moved successfully`, 'success');

                // Granular update: move node in tree without full refresh
                const newPath = result.newPath;
                if (itemType === 'file') {
                    const moved = navigationState.moveFileInTree(sourcePath, newPath, this.app.currentSpace.name);
                    if (moved) {
                        const fileEl = document.querySelector(`[data-document-path="${newPath}"]`);
                        if (fileEl) this.bindFileItemEvents_Single(fileEl);
                    }
                } else {
                    const moved = navigationState.moveFolderInTree(sourcePath, newPath);
                    if (moved) {
                        const folderEl = document.querySelector(`[data-folder-id="${navigationState.getFolderId(newPath)}"]`);
                        if (folderEl) this.bindFolderItemEvents_Single(folderEl);
                    }
                }

                // Update fullFileTree data
                if (this.fullFileTree) {
                    const node = this._findNodeInTree(this.fullFileTree, sourcePath);
                    if (node) {
                        // Remove from old location
                        const oldLastSlash = sourcePath.lastIndexOf('/');
                        const oldParentPath = oldLastSlash === -1 ? null : sourcePath.substring(0, oldLastSlash);
                        if (!oldParentPath) {
                            const idx = this.fullFileTree.findIndex(n => n.path === sourcePath);
                            if (idx !== -1) this.fullFileTree.splice(idx, 1);
                        } else {
                            const oldParent = this._findNodeInTree(this.fullFileTree, oldParentPath);
                            if (oldParent && oldParent.children) {
                                const idx = oldParent.children.findIndex(n => n.path === sourcePath);
                                if (idx !== -1) oldParent.children.splice(idx, 1);
                            }
                        }
                        // Update path
                        const oldNodePath = node.path;
                        node.path = newPath;
                        node.name = newPath.split('/').pop();
                        if (node.children) this._updateChildPaths(node.children, oldNodePath, newPath);
                        // Add to new location
                        const newLastSlash = newPath.lastIndexOf('/');
                        const newParentPath = newLastSlash === -1 ? null : newPath.substring(0, newLastSlash);
                        if (!newParentPath) {
                            this.fullFileTree.push(node);
                        } else {
                            const newParent = this._findNodeInTree(this.fullFileTree, newParentPath);
                            if (newParent) {
                                if (!newParent.children) newParent.children = [];
                                newParent.children.push(node);
                            }
                        }
                    }
                }

                // Reload the current folder view if we're in it
                if (this.currentFolderPath !== undefined) {
                    await this.loadFolderContent(this.currentFolderPath);
                }
            } else {
                // Handle API errors including 409 Conflict
                const errorMessage = result.message || `Failed to move item (HTTP ${response.status})`;
                console.error(`[Phase 8] Move operation failed:`, errorMessage, 'Data:', {
                    sourcePath, targetPath, itemType, spaceId
                });
                this.app.showNotification(errorMessage, 'error');
            }
        } catch (error) {
            console.error('[Phase 8] Error moving item:', error);
            this.app.showNotification('Failed to move item: ' + error.message, 'error');
        }
    },

    /**
     * Handle external file drop from file system into left navigation
     * @param {DragEvent} e - The drag event
     * @param {string} targetPath - The target folder path in navigation
     * @private
     */
    async handleExternalFileDrop(e, targetPath) {
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) {
            return;
        }

        console.log('[Phase 8] Processing external file drop:', { targetPath, files: Array.from(files).map(f => f.name) });

        // Check if target folder is read-only
        const targetFolderElement = document.querySelector(`[data-folder-path="${targetPath}"]`);
        if (targetFolderElement && targetFolderElement.classList.contains('read-only')) {
            this.app.showNotification('Cannot upload files to read-only folders', 'error');
            return;
        }

        // Get the current space
        if (!this.app.currentSpace) {
            this.app.showNotification('No space selected', 'error');
            return;
        }

        // Upload each file to the target folder
        const uploadPromises = Array.from(files).map(file => {
            return this.uploadFileToFolder(file, targetPath);
        });

        try {
            const results = await Promise.all(uploadPromises);
            const successCount = results.filter(r => r).length;

            if (successCount > 0) {
                this.app.showNotification(`${successCount} file${successCount !== 1 ? 's' : ''} uploaded successfully`, 'success');

                // Granular update: add each uploaded file to the tree
                for (const file of Array.from(files)) {
                    const filePath = targetPath ? `${targetPath}/${file.name}` : file.name;
                    const fileElement = navigationState.addFileToTree(file.name, filePath, this.app.currentSpace.name);
                    if (fileElement) {
                        this.bindFileItemEvents_Single(fileElement);
                    }
                }

                // Reload the current folder view if we're in it
                if (this.currentFolderPath !== undefined) {
                    await this.loadFolderContent(this.currentFolderPath);
                }
            }
        } catch (error) {
            console.error('[Phase 8] Error uploading files:', error);
            this.app.showNotification('Failed to upload files: ' + error.message, 'error');
        }
    },

    /**
     * Upload a single file to a specific folder
     * @param {File} file - The file to upload
     * @param {string} folderPath - The target folder path
     * @return {Promise<boolean>} True if upload succeeded
     * @private
     */
    async uploadFileToFolder(file, folderPath) {
        try {
            const fileName = file.name;

            // Create form data for file upload
            const formData = new FormData();
            formData.append('file', file);
            formData.append('spaceId', this.app.currentSpace.id);
            formData.append('folderPath', folderPath || '');

            console.log('[Phase 8] Uploading file:', { fileName, folderPath, spaceId: this.app.currentSpace.id });

            // Upload the file
            const response = await fetch('/applications/wiki/api/documents/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(`Upload failed: ${errorData.error || response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                console.log('[Phase 8] File uploaded successfully:', fileName);
                return true;
            } else {
                console.error('[Phase 8] Upload failed for file:', fileName, result.error || result.message);
                return false;
            }
        } catch (error) {
            console.error('[Phase 8] Error uploading file:', file.name, error);
            return false;
        }
    },

    /**
     * Populate window.documents array for wiki-code access
     * Converts the file tree into a structured format accessible from wiki-code blocks
     */
    populateWindowDocuments(tree) {
        const convertNodeToDocument = (node) => {
            const doc = {
                name: node.name || node.title,
                type: node.type,
                created: node.created || node.createdAt || new Date().toISOString(),
                path: node.path,
                space: this.app.currentSpace?.id?.toString() || '1',
                icon: this.getFileIcon(node.path || node.name)
            };

            if (node.type === 'folder') {
                doc.icon = 'bg-1 folder';
                doc.children = (node.children || []).map(child => convertNodeToDocument(child));
            } else {
                doc.icon = 'bg-1 file';
                doc.children = [];
            }

            return doc;
        };

        // Populate window.documents with the full tree structure
        window.documents = tree.map(node => convertNodeToDocument(node));

        // Initialize window.currentDocuments as empty array (will be populated by loadFolderContent)
        if (!window.currentDocuments) {
            window.currentDocuments = [];
        }

    },

    /**
     * Update window.currentDocuments when a folder is loaded
     */
    updateCurrentDocuments(folderPath) {
        if (!this.fullFileTree) {
            window.currentDocuments = [];
            return;
        }

        // Find the folder in the tree
        const findFolder = (nodes, path) => {
            for (const node of nodes) {
                if (node.type === 'folder' && node.path === path) {
                    return node;
                }
                if (node.type === 'folder' && node.children) {
                    const found = findFolder(node.children, path);
                    if (found) return found;
                }
            }
            return null;
        };

        // If folderPath is null or empty, use root level
        if (!folderPath) {
            window.currentDocuments = this.fullFileTree.map(node => ({
                name: node.name || node.title,
                type: node.type,
                created: node.created || node.createdAt || new Date().toISOString(),
                path: node.path,
                space: this.app.currentSpace?.id?.toString() || '1',
                icon: node.type === 'folder' ? 'bg-1 folder' : 'bg-1 file'
            }));
        } else {
            const folder = findFolder(this.fullFileTree, folderPath);
            if (folder && folder.children) {
                window.currentDocuments = folder.children.map(node => ({
                    name: node.name || node.title,
                    type: node.type,
                    created: node.created || node.createdAt || new Date().toISOString(),
                    path: node.path,
                    space: this.app.currentSpace?.id?.toString() || '1',
                    icon: node.type === 'folder' ? 'bg-1 folder' : 'bg-1 file'
                }));
            } else {
                window.currentDocuments = [];
            }
        }

        console.log('window.currentDocuments updated for path:', folderPath, window.currentDocuments);
    },

    /**
     * Reload the currently viewed file content
     * Delegates to documentController's reloadCurrentFileContent method
     * Called when file update event is received from event bus
     */
    reloadCurrentFileContent() {
        console.log('[NavigationController] reloadCurrentFileContent() called');

        if (documentController && documentController.reloadCurrentFileContent) {
            return documentController.reloadCurrentFileContent();
        } else {
            console.warn('[NavigationController] documentController or reloadCurrentFileContent not available');
        }
    },

    handleEditModeConflict() {
        console.log('[NavigationController] handleEditModeConflict() called');

        if (documentController && documentController.handleEditModeConflict) {
            return documentController.handleEditModeConflict();
        } else {
            console.warn('[NavigationController] documentController or handleEditModeConflict not available');
        }
    },

    // ===================== Presentation mode =====================
    // Full-screen slideshow of every markdown file in the current folder, in
    // folder order. Each slide is the rendered markdown shown as a card; arrow
    // keys / on-screen arrows slide between them, Esc exits. The horizontal
    // track translateX gives the sliding animation; slides load lazily.

    async startPresentation() {
        const folderContent = this.currentFolderContent;
        const fallbackSpace = this.app?.currentSpace?.name || folderContent?.spaceName || '';
        const files = (folderContent?.files || [])
            .filter(f => /\.md$/i.test(f.path || f.name || ''));

        if (!files.length) {
            this.app?.showNotification?.('No markdown files to present in this folder', 'info');
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'presentationOverlay';
        overlay.className = 'kr-present';
        overlay.innerHTML = `
            <div class="kr-present-stage">
                <div class="kr-present-track" id="krPresentTrack">
                    ${files.map((f, i) => `
                        <section class="kr-present-slide" data-index="${i}">
                            <article class="kr-present-card">
                                <div class="markdown-content kr-present-body" id="krPresentBody-${i}">
                                    <div class="kr-present-loading"><div class="spinner-border text-secondary" role="status"></div></div>
                                </div>
                            </article>
                        </section>
                    `).join('')}
                </div>
            </div>
            <button class="kr-present-nav prev" id="krPresentPrev" title="Previous (←)"><i class="bi bi-chevron-left"></i></button>
            <button class="kr-present-nav next" id="krPresentNext" title="Next (→)"><i class="bi bi-chevron-right"></i></button>
            <button class="kr-present-exit" id="krPresentExit" title="Exit (Esc)"><i class="bi bi-x-lg"></i></button>
            <div class="kr-present-counter" id="krPresentCounter"></div>
        `;
        document.body.appendChild(overlay);

        this._present = { files, spaceName: fallbackSpace, index: 0, cache: new Map() };

        document.getElementById('krPresentPrev').addEventListener('click', () => this._presentPrev());
        document.getElementById('krPresentNext').addEventListener('click', () => this._presentNext());
        document.getElementById('krPresentExit').addEventListener('click', () => this._presentClose());

        this._present.keyHandler = (e) => {
            if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); this._presentNext(); }
            else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this._presentPrev(); }
            else if (e.key === 'Escape') { e.preventDefault(); this._presentClose(); }
        };
        document.addEventListener('keydown', this._present.keyHandler);

        // No OS fullscreen — the overlay is a 95% panel over the browser window.

        // Trigger the entrance transition on the next frame.
        requestAnimationFrame(() => overlay.classList.add('is-open'));

        this._presentGoTo(0);
    },

    _presentGoTo(index) {
        const p = this._present;
        if (!p) return;
        index = Math.max(0, Math.min(index, p.files.length - 1));
        p.index = index;

        const track = document.getElementById('krPresentTrack');
        if (track) track.style.transform = `translateX(-${index * 100}%)`;

        const counter = document.getElementById('krPresentCounter');
        if (counter) {
            const f = p.files[index];
            counter.textContent = `${index + 1} / ${p.files.length} · ${f.title || f.name}`;
        }

        document.getElementById('krPresentPrev')?.toggleAttribute('disabled', index === 0);
        document.getElementById('krPresentNext')?.toggleAttribute('disabled', index === p.files.length - 1);

        // Load the current slide plus its neighbours so navigation feels instant.
        this._presentLoadSlide(index);
        this._presentLoadSlide(index + 1);
        this._presentLoadSlide(index - 1);
    },

    _presentNext() { if (this._present) this._presentGoTo(this._present.index + 1); },
    _presentPrev() { if (this._present) this._presentGoTo(this._present.index - 1); },

    async _presentLoadSlide(i) {
        const p = this._present;
        if (!p || i < 0 || i >= p.files.length || p.cache.has(i)) return;
        p.cache.set(i, true); // mark in-flight to avoid duplicate fetches
        const f = p.files[i];
        const body = document.getElementById(`krPresentBody-${i}`);
        try {
            const resp = await fetch('/applications/wiki/api/documents/content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spaceName: f.spaceName || p.spaceName, path: f.path || f.name })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const content = data.content || '';
            const html = (typeof parseMarkdown === 'function') ? parseMarkdown(content) : content;
            if (body) body.innerHTML = html;
        } catch (err) {
            console.error('[Presentation] Failed to load slide:', f.path, err);
            if (body) body.innerHTML = `<div class="kr-present-error">Could not load <strong>${this.escapeHtml(f.title || f.name)}</strong></div>`;
            p.cache.delete(i); // allow a retry if revisited
        }
    },

    _presentClose() {
        const p = this._present;
        if (!p) return;
        this._present = null;
        document.removeEventListener('keydown', p.keyHandler);
        const overlay = document.getElementById('presentationOverlay');
        if (overlay) {
            overlay.classList.remove('is-open');
            // Let the fade-out play before removing.
            setTimeout(() => overlay.remove(), 220);
        }
    },

    /**
     * Extract workflow metadata from folder home content.
     * Reads the ```document block from raw markdown and returns the workflow config.
     * @param {string} content - Raw markdown content
     * @returns {Object|null} { workflow: string, payload: object } or null
     */
    extractFolderWorkflowMeta(content) {
        if (!content) return null;
        try {
            // Use the global markdown parser if available
            if (typeof markdownParser !== 'undefined' && markdownParser
                && typeof markdownParser.extractDocumentMeta === 'function') {
                const meta = markdownParser.extractDocumentMeta(content);
                if (!meta) return null;

                const workflowName = meta.workflow ? String(meta.workflow).trim() : '';
                let payload = null;
                if (meta['workflow-filter']) {
                    try { payload = JSON.parse(meta['workflow-filter']); }
                    catch (e) { payload = null; }
                }

                // Only return if both workflow name and payload are present
                if (workflowName && payload) {
                    return { workflow: workflowName, payload };
                }
            }
        } catch (e) {
            console.error('[NavigationController] Failed to extract folder workflow meta:', e);
        }
        return null;
    },

    /**
     * Run a workflow for folder refresh. Similar to documentController.runDocumentWorkflow
     * but adapted for folder-level operations.
     * @param {string} workflowName - Workflow display name
     * @param {object} payload - The /api/workflows/start payload
     * @param {HTMLElement} btn - The refresh button to animate
     */
    async runFolderWorkflow(workflowName, payload, btn) {
        if (btn.disabled) return;
        this._startFolderRefresh(btn);
        try {
            const res = await fetch('/api/workflows/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ workflowName, payload }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.executionId) {
                this._stopFolderRefresh(btn);
                const msg = res.status === 403
                    ? 'You do not have permission to run this workflow'
                    : (data.error || data.message || `Failed to start refresh (${res.status})`);
                this.app?.showNotification?.(msg, 'error');
                return;
            }
            this.app?.showNotification?.('Refresh started — rebuilding content…', 'info');
            this.pollFolderWorkflowStatus(data.executionId, btn);
        } catch (err) {
            this._stopFolderRefresh(btn);
            this.app?.showNotification?.('Failed to start refresh: ' + (err?.message || err), 'error');
        }
    },

    /**
     * Regenerate the AI context for the current folder and everything beneath
     * it, overwriting what is there.
     *
     * The backend runs the system-context group's on-demand workflow in FOLDER
     * mode, which walks the subtree bottom-up: the deepest folders are rebuilt
     * first, then each parent's roll-up is built from freshly-rebuilt children,
     * finishing at the folder the user is standing in.
     *
     * Confirmed first, and deliberately so: this overwrites existing context and
     * costs one AI call per document plus one per folder, so on a large subtree
     * it is minutes of work and not something to trigger by a stray click.
     *
     * @param {HTMLElement} btn - The button to animate while the run is in flight.
     */
    async rebuildFolderContext(btn) {
        if (!btn || btn.disabled) return;

        const folderPath = this.app.currentFolder;
        const spaceId = this.app?.currentSpace?.id;
        if (!spaceId) {
            this.app?.showNotification?.('No space selected', 'error');
            return;
        }

        const folderLabel = (folderPath && folderPath !== '/')
            ? (folderPath.split('/').pop() || folderPath)
            : 'this space';
        const confirmed = window.confirm(
            `Rebuild the AI context for "${folderLabel}" and every folder beneath it?\n\n`
            + 'Existing context will be overwritten. This runs in the background and '
            + 'can take several minutes on a large folder — you can keep working, and '
            + 'track progress in Datasources → Executions.'
        );
        if (!confirmed) return;

        this._startFolderRefresh(btn);
        try {
            const res = await fetch(
                `/applications/wiki/api/spaces/${encodeURIComponent(spaceId)}/context/rebuild`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    // The API treats '' and '/' alike; send the raw value so the
                    // space root works from the folder view as well as a subfolder.
                    body: JSON.stringify({ folderPath: folderPath === '/' ? '' : (folderPath || '') }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.executionId) {
                this._stopFolderRefresh(btn);
                this.app?.showNotification?.(
                    data.error || data.message || `Could not start the context rebuild (${res.status})`,
                    'error'
                );
                return;
            }
            this.app?.showNotification?.(
                'Context rebuild started — working bottom-up through the folder…', 'info');
            this.pollFolderWorkflowStatus(data.executionId, btn, {
                // A subtree rebuild is one AI call per document plus one per
                // folder; 5 minutes (the refresh default) would give up on all
                // but the smallest folders. ~40 min, after which we stop watching
                // but say plainly that the run itself continues.
                maxAttempts: 1200,
                successMessage: 'Context rebuilt for this folder and its subfolders',
                failurePrefix: 'Context rebuild failed',
                timeoutMessage: 'Context rebuild is still running — check Datasources → Executions for progress',
            });
        } catch (err) {
            this._stopFolderRefresh(btn);
            this.app?.showNotification?.(
                'Could not start the context rebuild: ' + (err?.message || err), 'error');
        }
    },

    /**
     * Poll a folder workflow execution until it completes.
     * @param {string} executionId - From the /start 202 response
     * @param {HTMLElement} btn - The refresh button
     * @param {object} [options] - Message/duration overrides. Defaults describe the
     *   .home.md-declared "Refresh" workflow, the original caller. A context
     *   rebuild walks a whole subtree and needs a far longer ceiling, so the cap
     *   is a parameter rather than a shared constant.
     */
    pollFolderWorkflowStatus(executionId, btn, options = {}) {
        const {
            maxAttempts = 150, // ~5 minutes at 2s
            successMessage = 'Content rebuilt successfully',
            failurePrefix = 'Refresh failed',
            timeoutMessage = 'Refresh is taking longer than expected; it may still be running',
        } = options;
        const INTERVAL_MS = 2000;
        const MAX_ATTEMPTS = maxAttempts;
        let attempts = 0;
        let inFlight = false;

        const timer = setInterval(async () => {
            if (inFlight) return;
            inFlight = true;
            attempts += 1;
            try {
                const res = await fetch(
                    `/api/workflows/executions/${encodeURIComponent(executionId)}/status`,
                    { credentials: 'include', cache: 'no-store' }
                );
                const data = await res.json().catch(() => ({}));
                if (this._folderWorkflowPollTimer !== timer) return; // superseded
                if (!res.ok) {
                    this._stopFolderRefresh(btn);
                    this.app?.showNotification?.('Lost track of the refresh run', 'error');
                    return;
                }
                if (data.status && data.status !== 'running') {
                    this._stopFolderRefresh(btn);
                    const ok = data.status === 'completed' && data.outcome !== 'failed';
                    this.app?.showNotification?.(
                        ok ? successMessage
                           : failurePrefix + (data.error ? ': ' + data.error : ''),
                        ok ? 'success' : 'error'
                    );
                    // Optionally reload the folder to show updated content
                    if (ok) {
                        await this.loadFolderContent(this.app.currentFolder);
                    }
                    return;
                }
                if (attempts >= MAX_ATTEMPTS) {
                    this._stopFolderRefresh(btn);
                    this.app?.showNotification?.(timeoutMessage, 'warning');
                }
            } catch (e) {
                // Transient network error — keep polling
            } finally {
                inFlight = false;
            }
        }, INTERVAL_MS);
        this._folderWorkflowPollTimer = timer;
    },

    /** Enter the animated, click-guarded "refreshing" state for folder button. */
    _startFolderRefresh(btn) {
        if (!btn) return;
        btn.disabled = true;
        btn.classList.add('is-refreshing');
    },

    /** Leave the "refreshing" state and cancel any active poll timer. */
    _stopFolderRefresh(btn) {
        if (this._folderWorkflowPollTimer) {
            clearInterval(this._folderWorkflowPollTimer);
            this._folderWorkflowPollTimer = null;
        }
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-refreshing');
        }
    },

    /**
     * Sync the drill-down nav to a target path. For a file we drill to its
     * parent folder and highlight the file; for a folder we drill into it so
     * its children become the listed level. Root is '' or '/'.
     */
    async expandPathInNav(targetPath) {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        const normalized = this._normalizeDrillPath(targetPath || '');
        // Lazy tree: nothing below is findable until the ancestors are listed.
        await this.ensurePathLoaded(normalized);
        // Prefer the tree to decide file vs folder (handles folders whose names
        // contain a dot, e.g. "v1.0"); fall back to the dot heuristic when the
        // node isn't found (e.g. a just-deleted path).
        const node = normalized ? this._findNodeInTree(this.fullFileTree, normalized) : null;
        const lastSegment = normalized.split('/').filter(Boolean).pop() || '';
        const isFile = node ? node.type !== 'folder' : lastSegment.includes('.');

        // A folder's home page (home.md / .home.md) represents the folder
        // itself. Opening it should leave the nav on the folder's parent level
        // with the folder highlighted — not drill inside the folder (which
        // would show a near-empty level). Only applies to a folder's home page;
        // a root-level home falls through to the normal handling below.
        if (isFile && /^\.?home\.md$/i.test(lastSegment)) {
            const lastSlash = normalized.lastIndexOf('/');
            const folderPath = lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
            if (folderPath) {
                const grandSlash = folderPath.lastIndexOf('/');
                const parentPath = grandSlash === -1 ? '' : folderPath.slice(0, grandSlash);
                this.renderDrillView(parentPath);

                const folderEl = this._findNavRow(folderPath);
                if (folderEl) {
                    folderEl.classList.add('selected');
                    folderEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
                return;
            }
        }

        if (isFile) {
            // Drill to the file's parent folder, then highlight the file row.
            const lastSlash = normalized.lastIndexOf('/');
            const parentPath = lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
            this.renderDrillView(parentPath);

            const fileEl = document.querySelector(`[data-document-path="${normalized}"]`);
            if (fileEl) {
                fileEl.classList.add('active');
                fileEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        } else {
            // Drill into the folder — its children become the listed level.
            this.renderDrillView(normalized);
        }
    }
};
