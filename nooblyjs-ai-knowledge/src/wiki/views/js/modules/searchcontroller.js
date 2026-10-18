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

export const searchController = {
    app: null,
    searchTimeout: null,
    currentSuggestionIndex: -1,
    isShowingSuggestions: false,

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
    },

    /**
     * Fetch search suggestions from the API
     */
    async fetchSuggestions(query) {
        try {
            const response = await fetch(`/applications/wiki/api/search/suggestions?q=${encodeURIComponent(query)}&limit=8`);
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

        try {
            // Build URL with space filter if a space is selected (id-based, like the rest of the API)
            let url = `/applications/wiki/api/search?q=${encodeURIComponent(query)}&includeContent=false`;
            if (this.app.currentSpace) {
                url += `&spaceId=${encodeURIComponent(this.app.currentSpace.id)}`;
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
     * Display search results in the results view
     */
    showSearchResults(query, results) {
        // Update search query display
        const queryElement = document.getElementById('searchQuery');
        if (queryElement) {
            queryElement.textContent = `"${query}"`;
        }

        // Show search results view
        if (this.app && this.app.setActiveView) {
            this.app.setActiveView('search');
        }

        const container = document.getElementById('searchResults');
        if (!container) return;

        if (!results || results.length === 0) {
            container.innerHTML = `
                <div class="no-content-message">
                    <svg width="48" height="48" class="no-content-icon">
                        <use href="#icon-search"></use>
                    </svg>
                    <p>No results found for "${query}"</p>
                    <p class="text-muted">Try different keywords or check your spelling</p>
                </div>
            `;
            return;
        }

        // Normalize search results to file item format for renderFileItems
        const files = results.map(result => ({
            path: result.path || result.relativePath || '',
            spaceName: result.spaceName || 'Unknown Space',
            modifiedAt: result.modifiedAt || '',
            excerpt: result.excerpt || 'No description available',
            title: result.title || result.name || 'Untitled'
        }));

        // Store results for re-render on view toggle
        this._lastSearchFiles = files;
        this._lastSearchQuery = query;

        this.renderSearchWithViewMode(container, files, query);
    },

    /**
     * Render search results using the current view mode
     */
    renderSearchWithViewMode(container, files, query) {
        const app = this.app;
        const viewMode = app.searchViewMode || 'cards';

        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h2 class="mb-0">Found ${files.length} result${files.length === 1 ? '' : 's'}</h2>
                ${app.renderViewToggle(viewMode)}
            </div>
            <div id="searchViewContent">
                ${app.renderFileItems(files, viewMode, 'search')}
            </div>
        `;

        app.bindRenderedFileEvents(container);

        // Bind view toggle buttons
        container.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                app.searchViewMode = btn.dataset.view;
                this.renderSearchWithViewMode(container, files, query);
            });
        });
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
                const { path, spaceName } = item.dataset;

                // Click event
                item.addEventListener('click', () => {
                    // Ensure we exit editor mode before loading new content
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
        });
    }
};
