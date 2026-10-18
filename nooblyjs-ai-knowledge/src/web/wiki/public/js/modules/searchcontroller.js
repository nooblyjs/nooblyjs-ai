/**
 * @fileoverview The search controller
 * Handles all search functionality including suggestions and results
 *
 *@author Digital Techonolgies Team
 * @version 2.0.0
 * @since 2025-10-01
 */

import { documentController } from "./documentcontroller.js";
import { navigationController } from "./navigationcontroller.js";
import { writeViewPref, VK } from "./viewPrefs.js";
import { buildSearchUrl, normaliseViewMode } from "../shared/search-url.js";

/* --------------------------------------------------------------------------
 * Faceting (client-side)
 *
 * The core search engine stays generic; the wiki decides how to facet. Each
 * result already carries its space name and space-relative path, so we derive
 * the four facet axes right here. (The backend also stamps folderL1/folderL2/
 * docType onto results — we prefer those when present, else derive from the
 * path — so this works immediately, without waiting for a re-index.)
 *
 *   Space          → space name
 *   Folder Level 1 → first folder segment beneath the space root
 *   Folder Level 2 → second folder segment
 *   Type           → file name without extension (".home.md" → "Home")
 * ------------------------------------------------------------------------ */

function facetSegments(result) {
    const p = String(result.path || result.relativePath || '')
        .replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return p ? p.split('/') : [];
}

function facetFolder(result, level) {
    const folders = facetSegments(result).slice(0, -1);
    return folders[level] || null;
}

function facetDocType(result) {
    const segs = facetSegments(result);
    const base = segs.length ? segs[segs.length - 1] : '';
    if (!base) return null;
    if (/^\.?home\.md$/i.test(base) || /^\.home(\.|$)/i.test(base)) return 'Home';
    return base.replace(/\.[^.]+$/, '') || base;
}

// The four facets, in display order. `get` returns the value (null → skip).
// Their URL parameter names live in shared/search-url.js (FACET_PARAMS) so the
// link contract is declared once; adding a facet means adding it in both places.
const SEARCH_FACETS = [
    { key: 'space',    label: 'Space',          get: (r) => (r.spaceName && r.spaceName !== 'Unknown Space') ? r.spaceName : null },
    { key: 'folderL1', label: 'Folder Level 1', get: (r) => r.folderL1 || facetFolder(r, 0) },
    { key: 'folderL2', label: 'Folder Level 2', get: (r) => r.folderL2 || facetFolder(r, 1) },
    { key: 'docType',  label: 'Type',           get: (r) => r.docType || facetDocType(r) }
];

const FACET_VISIBLE_LIMIT = 8;    // rows shown per facet before "Show more"
const SEARCH_RESULT_LIMIT = 1000; // facet universe fetched from the backend

export const searchController = {
    app: null,
    searchTimeout: null,
    currentSuggestionIndex: -1,
    isShowingSuggestions: false,
    // Active folder scope for search: { folderPath, folderName, spaceName } or null
    // (null = search the whole wiki). Cleared when the user dismisses the chip.
    folderScope: null,

    init(app) {
        this.app = app;
    },

    /**
     * Initialize search functionality with event listeners
     */
    initSearchFunctionality() {
        const searchInput = document.getElementById('globalSearch');
        const suggestionsContainer = document.getElementById('searchSuggestions');

        if (!searchInput || !suggestionsContainer) {
            console.error('Search initialization failed - missing elements:', {
                searchInput: !!searchInput,
                suggestionsContainer: !!suggestionsContainer
            });
            return;
        }

        // Initialize search state variables
        this.searchTimeout = null;
        this.currentSuggestionIndex = -1;
        this.isShowingSuggestions = false;

        // Handle input changes for suggestions
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();

            clearTimeout(this.searchTimeout);

            if (query.length === 0) {
                this.hideSuggestions();
                return;
            }

            if (query.length >= 2) {
                this.searchTimeout = setTimeout(() => {
                    this.fetchSuggestions(query);
                }, 300);
            }
        });

        // Handle key navigation
        searchInput.addEventListener('keydown', (e) => {
            const suggestionItems = suggestionsContainer.querySelectorAll('.suggestion-item');

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (this.isShowingSuggestions && suggestionItems.length > 0) {
                        this.currentSuggestionIndex = Math.min(this.currentSuggestionIndex + 1, suggestionItems.length - 1);
                        this.highlightSuggestion(this.currentSuggestionIndex);
                    }
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    if (this.isShowingSuggestions && suggestionItems.length > 0) {
                        this.currentSuggestionIndex = Math.max(this.currentSuggestionIndex - 1, -1);
                        this.highlightSuggestion(this.currentSuggestionIndex);
                    }
                    break;

                case 'Enter':
                    e.preventDefault();
                    // Always perform full search when Enter is pressed
                    this.performSearch();
                    break;

                case 'Escape':
                    this.hideSuggestions();
                    searchInput.blur();
                    break;
            }
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
                this.hideSuggestions();
            }
        });

        // Show suggestions when focusing if there's a query
        searchInput.addEventListener('focus', () => {
            const query = searchInput.value.trim();
            if (query.length >= 2) {
                this.fetchSuggestions(query);
            }
        });

        // Folder-scope chip: dismiss to fall back to whole-wiki search.
        document.getElementById('searchScopeChip')?.addEventListener('click', () => {
            this.scopeDismissed = true;
            this.folderScope = null;
            this.updateScopeChip();
            // Widening the search changes what a shared link would reproduce.
            if (this.facetState) this._syncUrl();
            // Re-run any active query against the whole wiki.
            const q = searchInput.value.trim();
            if (q.length >= 2 && this.isShowingSuggestions) this.fetchSuggestions(q);
        });

        // Auto-scope the search bar to the current folder as the user navigates,
        // mirroring the chat panel. Entering a new folder re-enables scope even if
        // it was dismissed in the previous one.
        window.addEventListener('folderChanged', () => {
            this.scopeDismissed = false;
            this.syncFolderScopeFromApp();
        });
        window.addEventListener('spaceChanged', () => {
            this.scopeDismissed = false;
            this.syncFolderScopeFromApp();
        });

        // A ```landing-hero``` block's search pill submits here.
        this.initLandingSearch();

        // Reflect wherever we already are at startup.
        this.syncFolderScopeFromApp();
    },

    /**
     * Wire the search pill rendered by a ```landing-hero``` block to the real
     * search. The parser emits a `<form data-landing-search>`, so Enter and the
     * button both raise a submit — we don't bind keys ourselves.
     *
     * The query is pushed into the top-bar `#globalSearch` input before running
     * `performSearch()`: that function reads the box directly, and copying the
     * term across also leaves it visible where a user expects to find and edit
     * it once the results view opens.
     *
     * Delegated from `document.body` because the block is re-rendered on every
     * navigation and lives in two different hosts — the space home
     * (`app.loadHomeContent`) and the document reader
     * (`documentcontroller.renderContentTab`) — so there is no stable element
     * to bind once.
     */
    initLandingSearch() {
        document.body.addEventListener('submit', (e) => {
            const form = e.target.closest && e.target.closest('form[data-landing-search]');
            if (!form) return;
            e.preventDefault();

            const field = form.querySelector('input[type="search"], input');
            const query = (field?.value || '').trim();
            if (!query) {
                field?.focus();
                return;
            }

            const globalSearch = document.getElementById('globalSearch');
            if (globalSearch) globalSearch.value = query;

            documentController.exitEditorMode();
            this.performSearch();
        });
    },

    /**
     * Read the current folder/space from app state into this.folderScope and
     * refresh the chip. A user-dismissed scope stays cleared until navigation.
     */
    syncFolderScopeFromApp() {
        if (this.scopeDismissed) { this.updateScopeChip(); return; }
        const app = this.app || {};
        let folderPath = app.currentFolder || '';
        folderPath = String(folderPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (folderPath) {
            const parts = folderPath.split('/');
            this.folderScope = {
                folderPath,
                folderName: parts[parts.length - 1] || folderPath,
                spaceName: (app.currentSpace && app.currentSpace.name) || ''
            };
        } else {
            this.folderScope = null;
        }
        this.updateScopeChip();
    },

    /** Show/hide and relabel the folder-scope chip next to the search box. */
    updateScopeChip() {
        const chip = document.getElementById('searchScopeChip');
        const text = document.getElementById('searchScopeChipText');
        if (!chip) return;
        if (this.folderScope) {
            if (text) text.textContent = `in: ${this.folderScope.folderName}`;
            chip.classList.remove('hidden');
            chip.style.display = 'inline-flex';
            chip.title = `Searching within “${this.folderScope.folderName}” and its subfolders. Click to clear and search the whole wiki.`;
        } else {
            chip.classList.add('hidden');
            chip.style.display = 'none';
        }
    },

    /**
     * Fetch search suggestions from the API
     */
    async fetchSuggestions(query) {
        try {
            let url = `/applications/wiki/api/search/suggestions?q=${encodeURIComponent(query)}&limit=8`;
            // Filter by current space if one is selected (id-based, like the rest of the API)
            if (this.app && this.app.currentSpace) {
                url += `&spaceId=${encodeURIComponent(this.app.currentSpace.id)}`;
            }
            // Constrain to the active folder subtree when scope is on.
            if (this.folderScope) {
                url += `&folderPath=${encodeURIComponent(this.folderScope.folderPath)}`;
            }
            const response = await fetch(url);
            const suggestions = await response.json();

            this.displaySuggestions(suggestions);
        } catch (error) {
            console.error('Suggestions error:', error);
            this.hideSuggestions();
        }
    },

    /**
     * Display search suggestions in the dropdown
     */
    displaySuggestions(suggestions) {
        const container = document.getElementById('searchSuggestions');

        if (!suggestions || suggestions.length === 0) {
            this.hideSuggestions();
            return;
        }

        const html = suggestions.map(suggestion => {
            // Handle both string and object suggestions
            let title, iconClass, iconColor, dataPath, dataSpaceName, dataType, subtitle;

            if (typeof suggestion === 'string') {
                // Simple string suggestion - use it as the search term
                title = suggestion;
                iconClass = 'bi-search';
                iconColor = '#666666';
                dataPath = '';
                dataSpaceName = '';
                dataType = 'search-term';
                subtitle = 'Search for this term';
            } else {
                // Object suggestion with metadata
                title = suggestion.title || suggestion.name || 'Untitled';
                dataPath = suggestion.path || suggestion.relativePath || '';
                dataSpaceName = suggestion.spaceName || suggestion.baseType || '';
                dataType = suggestion.type || 'document';
                subtitle = suggestion.spaceName ? `in ${suggestion.spaceName}` : '';

                // Get file type icon using navigationController
                const fileTypeInfo = navigationController.getFileTypeInfo(dataPath || title);
                iconClass = navigationController.getFileTypeIconClass(fileTypeInfo.category);
                iconColor = fileTypeInfo.color;
            }

            return `
                <div class="suggestion-item"
                     data-path="${dataPath}"
                     data-space-name="${dataSpaceName}"
                     data-title="${title}"
                     data-type="${dataType}">
                    <div class="suggestion-icon">
                        <i class="bi ${iconClass}" style="color: ${iconColor}; font-size: 16px;"></i>
                    </div>
                    <div class="suggestion-text">
                        <div class="suggestion-title">${title}</div>
                        ${subtitle ? `<div class="suggestion-subtitle">${subtitle}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Add click handlers to suggestions
        container.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectSuggestion(item.dataset);
            });
        });

        container.classList.remove('hidden');
        this.isShowingSuggestions = true;
        this.currentSuggestionIndex = -1;
    },

    /**
     * Get icon for suggestion type
     */
    getSuggestionIcon(type) {
        switch (type) {
            case 'markdown':
            case 'wiki-document':
                return 'icon-file';
            case 'folder':
                return 'icon-folder';
            case 'code':
                return 'icon-edit';
            case 'image':
                return 'icon-eye';
            case 'search-term':
                return 'icon-search';
            default:
                return 'icon-file';
        }
    },

    /**
     * Highlight a suggestion at the given index
     */
    highlightSuggestion(index) {
        const container = document.getElementById('searchSuggestions');
        const items = container.querySelectorAll('.suggestion-item');

        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    },

    /**
     * Handle selection of a suggestion
     */
    selectSuggestion(suggestionData) {
        const { path, spaceName, title, type } = suggestionData;

        this.hideSuggestions();

        // If it's a search term or no specific document, update search box and perform search
        if (type === 'search-term' || (!path || !spaceName)) {
            const searchInput = document.getElementById('globalSearch');
            if (searchInput && title) {
                searchInput.value = title;
            }
            this.performSearch();
        } else {
            // It's a specific document, ensure we exit editor mode and load it cleanly
            documentController.exitEditorMode();
            documentController.openDocumentByPath(path, spaceName);
        }
    },

    /**
     * Hide search suggestions dropdown
     */
    hideSuggestions() {
        const container = document.getElementById('searchSuggestions');
        container.classList.add('hidden');
        container.innerHTML = '';
        this.isShowingSuggestions = false;
        this.currentSuggestionIndex = -1;
    },

    /**
     * Perform a full search and display results
     */
    async performSearch() {
        const searchInput = document.getElementById('globalSearch');
        const query = searchInput.value.trim();

        if (!query) {
            return;
        }

        this.hideSuggestions();

        // Record the term for the search-first layout's "Previous searches" list.
        try { this.app?.layoutController?.recordSearch(query); } catch (_) { /* optional */ }

        try {
            // Build URL with space filter if a space is selected (id-based, like the rest of the API).
            // Pull a generous slice so the facet counts reflect the whole matched set, not just a page.
            let url = `/applications/wiki/api/search?q=${encodeURIComponent(query)}&includeContent=false&limit=${SEARCH_RESULT_LIMIT}`;
            if (this.app.currentSpace) {
                url += `&spaceId=${encodeURIComponent(this.app.currentSpace.id)}`;
            }
            // Constrain to the active folder subtree when scope is on.
            if (this.folderScope) {
                url += `&folderPath=${encodeURIComponent(this.folderScope.folderPath)}`;
            }
            const response = await fetch(url);
            const results = await response.json();

            this.showSearchResults(query, results);
        } catch (error) {
            console.error('Search error:', error);
            if (this.app && this.app.showNotification) {
                this.app.showNotification('Search failed', 'error');
            }
        }
    },

    /**
     * Write the current search state into the address bar.
     *
     * The PATH is pinned to the space root rather than left wherever the user
     * happened to be. If it kept a document path, reloading the link would open
     * that document and then have the search land on top of it — the URL would
     * describe two different views at once. Path = which space, query = the
     * search.
     *
     * @param {{push?: boolean}} [opts] `push` for a NEW query, which is a real
     *   navigation and belongs in history. Facet and view changes replace, or
     *   every checkbox click would add an entry and Back would take a dozen
     *   presses to escape one search.
     */
    _syncUrl({ push = false } = {}) {
        if (!this.facetState) return;

        // No embed special-case needed: embed-bootstrap patches pushState /
        // replaceState to re-attach its own params, and buildSearchUrl is handed
        // the current query string so anything it does not own (?embed=1,
        // ?sharedBy=) survives the rewrite.
        try {
            const facets = {};
            for (const f of SEARCH_FACETS) facets[f.key] = [...this.facetState.active[f.key]];

            const search = buildSearchUrl({
                query: this.facetState.query,
                facets,
                view: this.app.searchViewMode,
                folderPath: this.folderScope ? this.folderScope.folderPath : null
            }, window.location.search);

            const space = this.app.currentSpace;
            const path = space
                ? `/applications/wiki/${encodeURIComponent(space.name)}/`
                : '/applications/wiki/';
            const url = `${path}${search}`;
            if (url === window.location.pathname + window.location.search) return;

            const entry = { type: 'search', query: this.facetState.query };
            if (push) history.pushState(entry, '', url);
            else history.replaceState(entry, '', url);
        } catch (err) {
            // A bad history call must never take the results down with it.
            console.warn('[Search] could not sync the URL:', err);
        }
    },

    /**
     * Run a search described by a URL: fill the box, restore the folder scope and
     * view, run it, then re-apply the facet selections on the results.
     *
     * Facets can only be applied AFTER the results arrive — they are computed
     * client-side from the matched set, so there is nothing to select against
     * until `performSearch` has populated `facetState`. A value in the URL that
     * no longer matches anything is kept in `active` regardless: `getFacetCounts`
     * already back-fills selected-but-absent values at count 0, so it shows as a
     * ticked box with no results rather than vanishing silently.
     *
     * @param {{query: string, facets: Object, view: string|null, folderPath: string|null}} state
     */
    async applyUrlState(state) {
        if (!state || !state.query) return;

        const input = document.getElementById('globalSearch');
        if (input) input.value = state.query;

        if (state.view) {
            this.app.searchViewMode = state.view;
            writeViewPref(VK.pageSearch, state.view);
        }

        // Restore the folder-scope chip before searching — performSearch reads it
        // to constrain the request, so setting it afterwards would search wide and
        // then merely relabel the results.
        if (state.folderPath) {
            const name = state.folderPath.split('/').filter(Boolean).pop() || state.folderPath;
            this.folderScope = {
                folderPath: state.folderPath,
                folderName: name,
                spaceName: this.app.currentSpace ? this.app.currentSpace.name : ''
            };
        } else {
            this.folderScope = null;
        }

        // Suppress the URL write this search would otherwise do: we are restoring
        // FROM the URL, and rewriting it here would drop the facets still to come.
        this._restoringFromUrl = true;
        try {
            await this.performSearch();
        } finally {
            this._restoringFromUrl = false;
        }

        if (!this.facetState) return;

        // `showSearchResults` assigns facetState and THEN returns early when the
        // query matched nothing, leaving the "No results" message on screen.
        // Re-rendering here would replace that message with an empty faceted
        // shell, so a link whose query now matches nothing would look broken
        // rather than simply empty.
        if (!this.facetState.results.length) { this._syncUrl(); return; }

        let applied = 0;
        for (const f of SEARCH_FACETS) {
            const values = (state.facets && state.facets[f.key]) || [];
            for (const v of values) { this.facetState.active[f.key].add(v); applied++; }
        }
        if (applied) this.renderFacetedResults();
        this._syncUrl();
    },

    /** Small HTML escaper for facet labels / query echoes. */
    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /**
     * Display search results in the faceted results view: a Filters sidebar
     * (Space / Folder L1 / Folder L2 / Type) beside the result cards. All
     * faceting is client-side and instant — the backend just returns the
     * matched set with facet fields attached.
     */
    showSearchResults(query, results) {
        const queryElement = document.getElementById('searchQuery');
        if (queryElement) queryElement.textContent = `"${query}"`;

        if (this.app && this.app.setActiveView) {
            this.app.setActiveView('search');
        }

        const container = document.getElementById('searchResults');
        if (!container) return;

        // Fresh facet state for this query.
        this.facetState = {
            query,
            results: Array.isArray(results) ? results : [],
            active: { space: new Set(), folderL1: new Set(), folderL2: new Set(), docType: new Set() }
        };
        this._facetExpanded = {};

        // A new query is a navigation — it goes in history so Back returns to the
        // previous search. Skipped while restoring, where the URL is the source.
        if (!this._restoringFromUrl) this._syncUrl({ push: true });

        if (!this.facetState.results.length) {
            // Nothing to facet — clear any facets left in the left-nav slot.
            const slot = document.getElementById('searchFacetsSlot');
            if (slot) slot.innerHTML = '';
            container.innerHTML = `
                <div class="no-content-message">
                    <svg width="48" height="48" class="no-content-icon">
                        <use href="#icon-search"></use>
                    </svg>
                    <p>No results found for "${this._esc(query)}"</p>
                    <p class="text-muted">${/["“]/.test(query)
                        ? 'Quoted text must appear word-for-word. Remove the quotes to match the words anywhere in a document.'
                        : 'Try different keywords or check your spelling'}</p>
                </div>
            `;
            return;
        }

        this.renderFacetedResults();
    },

    /** Results left after applying every active facet selection. */
    getFilteredResults() {
        const { results, active } = this.facetState;
        return results.filter((r) => SEARCH_FACETS.every((f) => {
            const sel = active[f.key];
            if (!sel.size) return true;
            const v = f.get(r);
            return v != null && sel.has(v);
        }));
    },

    /**
     * Value → count buckets for one facet, computed with the OTHER facets'
     * selections applied (classic drill-down faceting), so counts stay useful
     * as filters are combined. Currently-selected values are always kept.
     */
    getFacetCounts(facetKey) {
        const { results, active } = this.facetState;
        const others = SEARCH_FACETS.filter((f) => f.key !== facetKey);
        const self = SEARCH_FACETS.find((f) => f.key === facetKey);

        const base = results.filter((r) => others.every((f) => {
            const sel = active[f.key];
            if (!sel.size) return true;
            const v = f.get(r);
            return v != null && sel.has(v);
        }));

        const map = new Map();
        for (const r of base) {
            const v = self.get(r);
            if (v == null || v === '') continue;
            map.set(v, (map.get(v) || 0) + 1);
        }
        for (const v of active[facetKey]) if (!map.has(v)) map.set(v, 0);

        return [...map.entries()]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    },

    /** Build the Filters sidebar groups. */
    renderFacetGroups() {
        return SEARCH_FACETS.map((f) => {
            const counts = this.getFacetCounts(f.key);
            if (!counts.length) return '';

            const active = this.facetState.active[f.key];
            const expanded = !!this._facetExpanded[f.key];
            const visible = expanded ? counts : counts.slice(0, FACET_VISIBLE_LIMIT);
            const hidden = counts.length - visible.length;

            const rows = visible.map(({ value, count }) => {
                const checked = active.has(value);
                return `
                    <label class="kr-facet-row${checked ? ' checked' : ''}">
                        <input type="checkbox" class="kr-facet-cb" data-facet="${f.key}" value="${this._esc(value)}" ${checked ? 'checked' : ''}>
                        <span class="kr-facet-label" title="${this._esc(value)}">${this._esc(value)}</span>
                        <span class="kr-facet-num">${count}</span>
                    </label>`;
            }).join('');

            let moreBtn = '';
            if (hidden > 0) {
                moreBtn = `<button type="button" class="kr-facet-more" data-facet="${f.key}">Show ${hidden} more</button>`;
            } else if (expanded && counts.length > FACET_VISIBLE_LIMIT) {
                moreBtn = `<button type="button" class="kr-facet-more" data-facet="${f.key}" data-collapse="1">Show less</button>`;
            }

            return `
                <div class="kr-facet-group" data-facet-group="${f.key}">
                    <div class="kr-facet-grouphead">${this._esc(f.label)}</div>
                    <div class="kr-facet-rows">${rows}</div>
                    ${moreBtn}
                </div>`;
        }).join('');
    },

    /** True when the wiki is in the search-first persona layout. */
    _isSearchLayout() {
        try {
            return document.getElementById('wikiApp')?.dataset?.layout === 'search';
        } catch { return false; }
    },

    /** Facets sidebar markup. */
    _renderFacetsPanel() {
        const hasActive = SEARCH_FACETS.some((f) => this.facetState.active[f.key].size);
        return `
            <div class="kr-facets" id="krFacetSidebar">
                <div class="kr-facets-head">
                    <span class="kr-facets-title">Filters</span>
                    <button type="button" class="kr-facets-clear${hasActive ? '' : ' hidden'}" id="krFacetClear">Clear all</button>
                </div>
                ${this.renderFacetGroups()}
            </div>`;
    },

    /** Results column markup (heading + count + cards). */
    _renderResultsPanel() {
        const app = this.app;
        const viewMode = app.searchViewMode || 'cards';
        const { query } = this.facetState;
        const filtered = this.getFilteredResults();

        const cards = filtered.length
            ? `<div class="kr-facet-cards">${navigationController.renderUnifiedFileList(
                    filtered.map((r) => ({
                        path: r.path || r.relativePath || '',
                        spaceName: r.spaceName || 'Unknown Space',
                        spaceId: r.spaceId,
                        modifiedAt: r.modifiedAt || '',
                        excerpt: r.excerpt || 'No description available',
                        snippet: r.snippet || '',
                        title: r.title || r.name || 'Untitled',
                        type: r.type,
                        // The cards spell the two folder levels out in their
                        // breadcrumb, matching the Filters sidebar. Fall back to
                        // the derived values so results from an index predating
                        // the facet fields still show them.
                        folderL1: r.folderL1 || facetFolder(r, 0),
                        folderL2: r.folderL2 || facetFolder(r, 1)
                    })), viewMode, { type: 'search' })}</div>`
            : `<div class="kr-facet-noresults">
                    <p>No results match the selected filters.</p>
                    <button type="button" class="kr-facets-clear" id="krFacetClear2">Clear all filters</button>
               </div>`;

        return `
            <div class="kr-facet-main">
                <div class="kr-facet-resulthead">
                    <div>
                        <h2 class="kr-facet-h">Search results</h2>
                        <p class="kr-facet-count">Found <b>${filtered.length}</b> result${filtered.length === 1 ? '' : 's'} for <b>"${this._esc(query)}"</b></p>
                    </div>
                    ${app.renderViewToggle ? app.renderViewToggle(viewMode) : ''}
                </div>
                <div id="searchViewContent">${cards}</div>
            </div>`;
    },

    /**
     * Render the faceted results. In the search-first layout the Filters panel
     * is moved into the left-nav sidebar and the results span the full width;
     * in every other layout the facets sit beside the results as a two-column
     * shell.
     */
    renderFacetedResults() {
        const container = document.getElementById('searchResults');
        if (!container || !this.facetState) return;

        const slot = document.getElementById('searchFacetsSlot');
        const facetsInNav = this._isSearchLayout() && slot;

        if (facetsInNav) {
            slot.innerHTML = this._renderFacetsPanel();
            container.innerHTML = `<div class="kr-facet-shell kr-facet-shell--full">${this._renderResultsPanel()}</div>`;
        } else {
            if (slot) slot.innerHTML = '';
            container.innerHTML = `<div class="kr-facet-shell">${this._renderFacetsPanel()}${this._renderResultsPanel()}</div>`;
        }

        this.bindFacetedEvents(container);
    },

    /** Wire the sidebar checkboxes / show-more / clear, plus result + view-toggle events. */
    bindFacetedEvents(container) {
        // The facets panel may live inside `container` (two-column shell) or in
        // the left-nav slot (search layout), so resolve it by id.
        const sidebar = document.getElementById('krFacetSidebar');
        if (sidebar) {
            sidebar.addEventListener('change', (e) => {
                const cb = e.target.closest('.kr-facet-cb');
                if (!cb) return;
                const sel = this.facetState.active[cb.dataset.facet];
                if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
                this.renderFacetedResults();
                this._syncUrl();
            });
            sidebar.addEventListener('click', (e) => {
                const more = e.target.closest('.kr-facet-more');
                if (more) {
                    this._facetExpanded[more.dataset.facet] = !more.dataset.collapse;
                    this.renderFacetedResults();
                    return;
                }
                if (e.target.closest('#krFacetClear')) this.clearFacets();
            });
        }

        const clr2 = container.querySelector('#krFacetClear2');
        if (clr2) clr2.addEventListener('click', () => this.clearFacets());

        // Result cards (click + hover preview) and the view-mode toggle.
        navigationController.bindListEvents(container, { type: 'search', viewMode: this.app.searchViewMode || 'cards' });
        container.querySelectorAll('.view-mode-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.app.searchViewMode = btn.dataset.view;
                writeViewPref(VK.pageSearch, this.app.searchViewMode);
                this.renderFacetedResults();
                this._syncUrl();
            });
        });
    },

    /** Clear every active facet selection and re-render. */
    clearFacets() {
        if (!this.facetState) return;
        for (const f of SEARCH_FACETS) this.facetState.active[f.key].clear();
        this.renderFacetedResults();
        this._syncUrl();
    },

    /**
     * Bind click and preview events to search result items
     */
    bindSearchResultEvents(resultItems) {
        // Import navigationController for preview
        import('./navigationcontroller.js').then(({ navigationController }) => {
            // Initialize preview tooltip if not already done
            navigationController.initFilePreview();

            resultItems.forEach(item => {
                const { path, spaceName, spaceId } = item.dataset;

                // Click event
                item.addEventListener('click', () => {
                    // Ensure we exit editor mode before loading new content
                    documentController.exitEditorMode();
                    // Pass spaceId if available (will be used as hint)
                    documentController.openDocumentByPath(path, spaceName, spaceId ? parseInt(spaceId) : null);
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
        });
    }
};
