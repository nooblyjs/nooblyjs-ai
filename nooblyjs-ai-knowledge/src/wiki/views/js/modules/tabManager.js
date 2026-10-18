/**
 * @fileoverview Tab Manager Module
 * Handles all tab management operations including creation, closing, switching, and persistence
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-31
 */

export const tabManager = {
    /**
     * Array of open tabs
     * Each tab object structure:
     * {
     *   id: string (unique identifier),
     *   title: string (display name),
     *   path: string (file path),
     *   spaceName: string (space identifier),
     *   content: string (file content),
     *   metadata: object (file metadata - type, size, modified, etc.),
     *   isDirty: boolean (has unsaved changes),
     *   isSaved: boolean (has been saved),
     *   viewMode: string (viewer type - markdown, pdf, image, code, text, etc.),
     *   createdAt: string (ISO timestamp when tab was opened),
     *   lastAccessedAt: string (ISO timestamp of last access),
     *   scrollPosition: number (scroll position in document),
     *   editorCursorPosition: number (cursor position in editor),
     *   isActive: boolean (is this the active tab)
     * }
     */
    tabs: [],

    /**
     * Index of the currently active tab (-1 if none)
     */
    activeTabIndex: -1,

    /**
     * Tab history for navigation (back/forward)
     */
    tabHistory: {
        previous: [],
        current: null,
        next: []
    },

    /**
     * Event listeners registry
     */
    eventListeners: {
        'tabOpened': [],
        'tabClosed': [],
        'tabSwitched': [],
        'tabUpdated': [],
        'tabDirtied': [],
        'tabSaved': []
    },

    /**
     * Configuration
     */
    config: {
        maxTabs: 50,
        persistTabs: false,  // Disabled: causes "undefined" content when restoring
        persistInterval: 5000, // ms
        storageKey: 'wikiTabs'
    },

    /**
     * Initialize tab manager
     */
    init() {
        console.log('[TabManager] Initializing...');
        this.loadPersistedTabs();
        this.startPersistenceInterval();
    },

    /**
     * Add a new tab or switch to existing tab if already open
     * @param {string} path - File path
     * @param {string} spaceName - Space name/id
     * @param {object} options - Additional options
     * @returns {object} The created or existing tab
     */
    addTab(path, spaceName, options = {}) {
        // Check for duplicate tab (duplicate tab detection)
        const existingTab = this.findTab(path, spaceName);
        if (existingTab) {
            console.log(`[TabManager] Tab already open: ${path}, switching to it`);
            this.switchTab(existingTab.id);
            return existingTab;
        }

        // Check tab limit
        if (this.tabs.length >= this.config.maxTabs) {
            console.warn(`[TabManager] Maximum tabs (${this.config.maxTabs}) reached`);
            return null;
        }

        // Create new tab
        const tab = {
            id: this.generateTabId(),
            title: options.title || path.split('/').pop(),
            path: path,
            spaceName: spaceName,
            content: options.content || '',
            metadata: options.metadata || {},
            isDirty: false,
            isSaved: true,
            viewMode: options.viewMode || 'default',
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            scrollPosition: 0,
            editorCursorPosition: 0,
            isActive: false,
            ...options
        };

        // Add tab to array
        this.tabs.push(tab);
        console.log(`[TabManager] Tab created: ${tab.id} (${path})`);

        // Switch to new tab
        this.switchTab(tab.id);

        // Emit event
        this.emit('tabOpened', { tab });

        return tab;
    },

    /**
     * Close a tab by ID
     * @param {string} tabId - Tab ID to close
     * @param {object} options - Close options (skipConfirm, etc.)
     * @returns {boolean} True if tab was closed
     */
    closeTab(tabId, options = {}) {
        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index === -1) {
            console.warn(`[TabManager] Tab not found: ${tabId}`);
            return false;
        }

        const tab = this.tabs[index];

        // Check for unsaved changes
        if (tab.isDirty && !options.skipConfirm) {
            console.log(`[TabManager] Tab has unsaved changes: ${tabId}`);
            return false; // Let UI handle the confirmation
        }

        // Remove from history
        if (this.tabHistory.current?.id === tabId) {
            this.tabHistory.current = null;
        }
        this.tabHistory.previous = this.tabHistory.previous.filter(t => t.id !== tabId);
        this.tabHistory.next = this.tabHistory.next.filter(t => t.id !== tabId);

        // Remove tab
        this.tabs.splice(index, 1);
        console.log(`[TabManager] Tab closed: ${tabId}`);

        // Switch to another tab
        if (this.activeTabIndex === index) {
            // If closing active tab, switch to next or previous
            if (this.tabs.length > 0) {
                const newIndex = index > 0 ? index - 1 : 0;
                this.switchTab(this.tabs[newIndex].id);
            } else {
                this.activeTabIndex = -1;
            }
        }

        // Emit event
        this.emit('tabClosed', { tab, remainingTabs: this.tabs.length });

        return true;
    },

    /**
     * Close all tabs
     * @param {object} options - Close options
     * @returns {boolean} True if all closed
     */
    closeAllTabs(options = {}) {
        const dirtyTabs = this.tabs.filter(t => t.isDirty);
        if (dirtyTabs.length > 0 && !options.skipConfirm) {
            console.log(`[TabManager] ${dirtyTabs.length} tabs have unsaved changes`);
            return false; // Let UI handle confirmation
        }

        const closedCount = this.tabs.length;
        this.tabs = [];
        this.activeTabIndex = -1;
        this.tabHistory = { previous: [], current: null, next: [] };

        console.log(`[TabManager] All tabs closed (${closedCount})`);
        this.emit('tabClosed', { allTabsClosed: true, closedCount });

        return true;
    },

    /**
     * Switch to a specific tab
     * @param {string} tabId - Tab ID to switch to
     * @returns {boolean} True if switch successful
     */
    switchTab(tabId) {
        const tab = this.findTabById(tabId);
        if (!tab) {
            console.warn(`[TabManager] Tab not found: ${tabId}`);
            return false;
        }

        // Save current tab state before switching
        if (this.activeTabIndex >= 0) {
            const previousTab = this.tabs[this.activeTabIndex];
            if (previousTab) {
                previousTab.isActive = false;
                previousTab.lastAccessedAt = new Date().toISOString();
                // Save scroll position and cursor position if editing
                previousTab.scrollPosition = document.querySelector('.document-content-wrapper')?.scrollTop || 0;
            }
        }

        // Find and activate new tab
        const newIndex = this.tabs.findIndex(t => t.id === tabId);
        if (newIndex === -1) {
            console.warn(`[TabManager] Tab index not found: ${tabId}`);
            return false;
        }

        // Deactivate all tabs
        this.tabs.forEach(t => t.isActive = false);

        // Activate new tab
        tab.isActive = true;
        tab.lastAccessedAt = new Date().toISOString();
        this.activeTabIndex = newIndex;

        // Update tab history
        this.updateTabHistory(tab);

        console.log(`[TabManager] Switched to tab: ${tabId}`);
        this.emit('tabSwitched', { tab, index: newIndex });

        return true;
    },

    /**
     * Get the currently active tab
     * @returns {object|null} Active tab or null
     */
    getActiveTab() {
        if (this.activeTabIndex === -1) return null;
        return this.tabs[this.activeTabIndex];
    },

    /**
     * Update a tab's content
     * @param {string} tabId - Tab ID
     * @param {string} content - New content
     * @param {object} options - Update options
     */
    updateTab(tabId, content, options = {}) {
        const tab = this.findTabById(tabId);
        if (!tab) {
            console.warn(`[TabManager] Tab not found: ${tabId}`);
            return;
        }

        tab.content = content;
        tab.isDirty = !options.isSaving;
        tab.lastAccessedAt = new Date().toISOString();

        if (options.metadata) {
            tab.metadata = { ...tab.metadata, ...options.metadata };
        }

        console.log(`[TabManager] Tab updated: ${tabId}${options.isSaving ? ' (saved)' : ' (unsaved)'}`);
        this.emit('tabUpdated', { tab });
    },

    /**
     * Mark a tab as dirty (has unsaved changes)
     * @param {string} tabId - Tab ID
     */
    markTabDirty(tabId) {
        const tab = this.findTabById(tabId);
        if (!tab) return;

        tab.isDirty = true;
        tab.isSaved = false;
        console.log(`[TabManager] Tab marked dirty: ${tabId}`);
        this.emit('tabDirtied', { tab });
    },

    /**
     * Mark a tab as saved
     * @param {string} tabId - Tab ID
     */
    markTabSaved(tabId) {
        const tab = this.findTabById(tabId);
        if (!tab) return;

        tab.isDirty = false;
        tab.isSaved = true;
        console.log(`[TabManager] Tab marked saved: ${tabId}`);
        this.emit('tabSaved', { tab });
    },

    /**
     * Find a tab by ID
     * @param {string} tabId - Tab ID
     * @returns {object|null} Tab or null
     */
    findTabById(tabId) {
        return this.tabs.find(t => t.id === tabId) || null;
    },

    /**
     * Find an open tab by path and space
     * @param {string} path - File path
     * @param {string} spaceName - Space name
     * @returns {object|null} Tab or null
     */
    findTab(path, spaceName) {
        return this.tabs.find(t => t.path === path && t.spaceName === spaceName) || null;
    },

    /**
     * Get all open tabs
     * @returns {array} Array of tabs
     */
    getAllTabs() {
        return [...this.tabs];
    },

    /**
     * Get all dirty (unsaved) tabs
     * @returns {array} Array of unsaved tabs
     */
    getDirtyTabs() {
        return this.tabs.filter(t => t.isDirty);
    },

    /**
     * Get tab by index
     * @param {number} index - Tab index
     * @returns {object|null} Tab or null
     */
    getTabByIndex(index) {
        return this.tabs[index] || null;
    },

    /**
     * Get tab index by ID
     * @param {string} tabId - Tab ID
     * @returns {number} Tab index or -1
     */
    getTabIndex(tabId) {
        return this.tabs.findIndex(t => t.id === tabId);
    },

    /**
     * Switch to next tab
     * @returns {boolean} True if switched
     */
    switchToNextTab() {
        if (this.tabs.length <= 1) return false;
        const nextIndex = (this.activeTabIndex + 1) % this.tabs.length;
        return this.switchTab(this.tabs[nextIndex].id);
    },

    /**
     * Switch to previous tab
     * @returns {boolean} True if switched
     */
    switchToPreviousTab() {
        if (this.tabs.length <= 1) return false;
        const prevIndex = this.activeTabIndex === 0 ? this.tabs.length - 1 : this.activeTabIndex - 1;
        return this.switchTab(this.tabs[prevIndex].id);
    },

    /**
     * Switch to tab by index (1-9)
     * @param {number} index - Index 1-9
     * @returns {boolean} True if switched
     */
    switchToTabByNumber(index) {
        // index should be 1-9, convert to 0-based
        const tabIndex = index === 9 ? this.tabs.length - 1 : index - 1;
        if (tabIndex < 0 || tabIndex >= this.tabs.length) {
            return false;
        }
        return this.switchTab(this.tabs[tabIndex].id);
    },

    /**
     * Update tab history for navigation
     * @param {object} tab - Tab to add to history
     */
    updateTabHistory(tab) {
        // Remove next history if we're navigating back
        if (this.tabHistory.next.length > 0) {
            this.tabHistory.next = [];
        }

        // Add current to previous
        if (this.tabHistory.current) {
            this.tabHistory.previous.push(this.tabHistory.current);
            // Limit history size
            if (this.tabHistory.previous.length > 50) {
                this.tabHistory.previous.shift();
            }
        }

        // Set as current
        this.tabHistory.current = tab;
    },

    /**
     * Navigate back in tab history
     * @returns {boolean} True if navigated
     */
    navigateBack() {
        if (this.tabHistory.previous.length === 0) return false;

        const previous = this.tabHistory.previous.pop();

        // Add current to next
        if (this.tabHistory.current) {
            this.tabHistory.next.unshift(this.tabHistory.current);
        }

        // Set previous as current
        this.tabHistory.current = previous;
        return this.switchTab(previous.id);
    },

    /**
     * Navigate forward in tab history
     * @returns {boolean} True if navigated
     */
    navigateForward() {
        if (this.tabHistory.next.length === 0) return false;

        const next = this.tabHistory.next.shift();

        // Add current to previous
        if (this.tabHistory.current) {
            this.tabHistory.previous.push(this.tabHistory.current);
        }

        // Set next as current
        this.tabHistory.current = next;
        return this.switchTab(next.id);
    },

    /**
     * Register event listener
     * @param {string} event - Event name
     * @param {function} callback - Callback function
     */
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    },

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {function} callback - Callback function
     */
    off(event, callback) {
        if (!this.eventListeners[event]) return;
        this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
    },

    /**
     * Emit event
     * @param {string} event - Event name
     * @param {object} data - Event data
     */
    emit(event, data) {
        if (!this.eventListeners[event]) return;
        this.eventListeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[TabManager] Error in event listener for ${event}:`, error);
            }
        });
    },

    /**
     * Generate unique tab ID
     * @returns {string} Unique ID
     */
    generateTabId() {
        return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Persist tabs to localStorage
     */
    persistTabs() {
        if (!this.config.persistTabs) return;

        try {
            const tabsData = this.tabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                path: tab.path,
                spaceName: tab.spaceName,
                viewMode: tab.viewMode,
                createdAt: tab.createdAt,
                isDirty: tab.isDirty
            }));

            const persistData = {
                tabs: tabsData,
                activeTabId: this.getActiveTab()?.id || null,
                timestamp: new Date().toISOString()
            };

            localStorage.setItem(this.config.storageKey, JSON.stringify(persistData));
            console.log(`[TabManager] Tabs persisted (${tabsData.length} tabs)`);
        } catch (error) {
            console.error('[TabManager] Error persisting tabs:', error);
        }
    },

    /**
     * Load persisted tabs from localStorage
     */
    loadPersistedTabs() {
        if (!this.config.persistTabs) return;

        try {
            const stored = localStorage.getItem(this.config.storageKey);
            if (!stored) {
                console.log('[TabManager] No persisted tabs found');
                return;
            }

            const persistData = JSON.parse(stored);
            const { tabs: tabsData, activeTabId } = persistData;

            // Restore tabs (metadata only, content will be loaded on demand)
            tabsData.forEach(tabData => {
                const tab = {
                    ...tabData,
                    content: '', // Will be loaded when tab is activated
                    metadata: {},
                    scrollPosition: 0,
                    editorCursorPosition: 0,
                    isActive: tabData.id === activeTabId,
                    lastAccessedAt: new Date().toISOString()
                };
                this.tabs.push(tab);
            });

            // Restore active tab
            if (activeTabId) {
                this.activeTabIndex = this.tabs.findIndex(t => t.id === activeTabId);
            }

            console.log(`[TabManager] Restored ${tabsData.length} persisted tabs`);
        } catch (error) {
            console.error('[TabManager] Error loading persisted tabs:', error);
        }
    },

    /**
     * Start periodic persistence of tabs
     */
    startPersistenceInterval() {
        setInterval(() => {
            this.persistTabs();
        }, this.config.persistInterval);
    },

    /**
     * Clear all persisted tabs
     */
    clearPersistedTabs() {
        try {
            localStorage.removeItem(this.config.storageKey);
            console.log('[TabManager] Persisted tabs cleared');
        } catch (error) {
            console.error('[TabManager] Error clearing persisted tabs:', error);
        }
    },

    /**
     * Get tab statistics
     * @returns {object} Statistics about tabs
     */
    getStats() {
        const dirtyTabs = this.getDirtyTabs();
        return {
            total: this.tabs.length,
            active: this.activeTabIndex,
            unsaved: dirtyTabs.length,
            dirtyTabs: dirtyTabs.map(t => t.title)
        };
    }
};

export default tabManager;
