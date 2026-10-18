/**
 * @fileoverview Tab UI Manager Module
 * Handles all tab UI rendering, DOM manipulation, and event binding
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-31
 */

import { tabManager } from './tabManager.js';

export const tabUIManager = {
    /**
     * DOM elements
     */
    tabList: null,
    tabBar: null,
    newTabBtn: null,

    /**
     * Configuration
     */
    config: {
        iconMap: {
            '.md': 'bi-file-earmark-text',
            '.markdown': 'bi-file-earmark-text',
            '.pdf': 'bi-file-earmark-pdf',
            '.txt': 'bi-file-earmark',
            '.doc': 'bi-file-earmark-word',
            '.docx': 'bi-file-earmark-word',
            '.xls': 'bi-file-earmark-excel',
            '.xlsx': 'bi-file-earmark-excel',
            '.ppt': 'bi-file-earmark-presentation',
            '.pptx': 'bi-file-earmark-presentation',
            '.jpg': 'bi-file-earmark-image',
            '.jpeg': 'bi-file-earmark-image',
            '.png': 'bi-file-earmark-image',
            '.gif': 'bi-file-earmark-image',
            '.svg': 'bi-file-earmark-image',
            '.zip': 'bi-file-earmark-zip',
            '.rar': 'bi-file-earmark-zip',
            '.js': 'bi-file-earmark-code',
            '.ts': 'bi-file-earmark-code',
            '.py': 'bi-file-earmark-code',
            '.java': 'bi-file-earmark-code',
            '.json': 'bi-file-earmark-code',
            '.html': 'bi-file-earmark-code',
            '.css': 'bi-file-earmark-code'
        }
    },

    /**
     * Initialize tab UI manager
     */
    init() {
        console.log('[TabUIManager] Initializing...');

        // Get DOM elements
        this.tabList = document.getElementById('documentTabs');
        this.tabBar = document.getElementById('tabBar');

        if (!this.tabList || !this.tabBar) {
            console.error('[TabUIManager] Required DOM elements not found');
            return;
        }

        // Bind events from tabManager
        this.bindTabManagerEvents();

        // Bind UI events
        this.bindUIEvents();

        // Render any existing tabs (from persistence or already added)
        this.renderExistingTabs();

        console.log('[TabUIManager] Initialized successfully');
    },

    /**
     * Render all existing tabs that are already in tabManager
     */
    renderExistingTabs() {
        const allTabs = tabManager.getAllTabs();
        console.log(`[TabUIManager] Rendering ${allTabs.length} existing tabs`);

        allTabs.forEach(tab => {
            this.renderTab(tab);
        });

        // Show tab bar if there are any tabs
        if (allTabs.length > 0) {
            this.showTabBar();
        }
    },

    /**
     * Bind events from tab manager
     */
    bindTabManagerEvents() {
        // Tab opened
        tabManager.on('tabOpened', ({ tab }) => {
            this.renderTab(tab);
            this.scrollToTab(tab.id);
        });

        // Tab closed
        tabManager.on('tabClosed', ({ tab, remainingTabs }) => {
            this.removeTabElement(tab.id);
            if (remainingTabs === 0) {
                this.hideTabBar();
            }
        });

        // Tab switched
        tabManager.on('tabSwitched', ({ tab, index }) => {
            this.updateActiveTab(tab.id);
            // Show the document content for this tab
            this.showTabContent(tab);
        });

        // Tab updated
        tabManager.on('tabUpdated', ({ tab }) => {
            this.updateTabElement(tab.id, tab);
        });

        // Tab marked dirty
        tabManager.on('tabDirtied', ({ tab }) => {
            this.markTabDirty(tab.id);
        });

        // Tab saved
        tabManager.on('tabSaved', ({ tab }) => {
            this.markTabSaved(tab.id);
        });
    },

    /**
     * Bind UI events
     */
    bindUIEvents() {
        // Tab list delegation for tab clicks
        this.tabList.addEventListener('click', (e) => {
            const navLink = e.target.closest('.nav-link');
            if (!navLink) return;

            const tabId = navLink.dataset.tabId;
            if (!tabId) return;

            // Close button clicked
            if (e.target.closest('.tab-close')) {
                e.stopPropagation();
                e.preventDefault();
                this.closeTab(tabId);
                return;
            }

            // Tab clicked (switch to it)
            e.preventDefault();
            tabManager.switchTab(tabId);
        });

        // Tab hover for preview
        this.tabList.addEventListener('mouseenter', (e) => {
            const navLink = e.target.closest('.nav-link');
            if (!navLink) return;

            const tabId = navLink.dataset.tabId;
            if (tabId) {
                this.showTabPreview(navLink, tabId);
            }
        }, true);

        // Hide preview on mouse leave
        this.tabList.addEventListener('mouseleave', (e) => {
            const navLink = e.target.closest('.nav-link');
            if (!navLink) return;
            this.hideTabPreview();
        }, true);

        // Context menu (right-click) on tabs
        this.tabList.addEventListener('contextmenu', (e) => {
            const navLink = e.target.closest('.nav-link');
            if (!navLink) return;

            e.preventDefault();
            const tabId = navLink.dataset.tabId;
            if (tabId) {
                this.showTabContextMenu(e, tabId);
            }
        });
    },

    /**
     * Render a tab element
     * @param {object} tab - Tab object
     */
    renderTab(tab) {
        // Check if tab already exists
        const existing = this.tabList.querySelector(`[data-tab-id="${tab.id}"]`);
        if (existing) {
            console.log(`[TabUIManager] Tab already rendered: ${tab.id}`);
            return;
        }

        // Create Bootstrap nav-item and nav-link
        const tabEl = document.createElement('li');
        tabEl.className = 'nav-item';

        const link = document.createElement('a');
        link.className = 'nav-link';
        if (tab.isActive) {
            link.classList.add('active');
        }
        if (tab.isDirty) {
            link.classList.add('unsaved');
        }
        link.dataset.tabId = tab.id;
        link.href = '#';
        link.role = 'tab';

        // Build tab content
        link.innerHTML = this.getTabHTML(tab);

        tabEl.appendChild(link);
        this.tabList.appendChild(tabEl);

        console.log(`[TabUIManager] Tab rendered: ${tab.id} (${tab.title})`);

        // Show tab bar if hidden
        if (this.tabBar.classList.contains('hidden')) {
            this.showTabBar();
        }
    },

    /**
     * Get HTML for a tab
     * @param {object} tab - Tab object
     * @returns {string} HTML content
     */
    getTabHTML(tab) {
        const icon = this.getTabIcon(tab.path);
        const isDirty = tab.isDirty ? ' unsaved' : '';

        return `
            <i class="tab-icon bi ${icon}"></i>
            <span class="tab-title" title="${tab.title}">${this.escapeHtml(tab.title)}</span>
            <div class="tab-unsaved-indicator"></div>
            <button class="tab-close" type="button" title="Close tab">
                <i class="tab-close-icon bi bi-x"></i>
            </button>
        `;
    },

    /**
     * Update active tab styling
     * @param {string} tabId - Tab ID to make active
     */
    updateActiveTab(tabId) {
        // Remove active from all tabs
        this.tabList.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });

        // Add active to target tab
        const tabEl = this.tabList.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabEl) {
            tabEl.classList.add('active');
            console.log(`[TabUIManager] Updated active tab: ${tabId}`);
        }
    },

    /**
     * Mark tab as dirty (unsaved)
     * @param {string} tabId - Tab ID
     */
    markTabDirty(tabId) {
        const tabEl = this.tabList.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabEl) {
            tabEl.classList.add('unsaved');
            console.log(`[TabUIManager] Marked tab dirty: ${tabId}`);
        }
    },

    /**
     * Mark tab as saved
     * @param {string} tabId - Tab ID
     */
    markTabSaved(tabId) {
        const tabEl = this.tabList.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabEl) {
            tabEl.classList.remove('unsaved');
            console.log(`[TabUIManager] Marked tab saved: ${tabId}`);
        }
    },

    /**
     * Update tab element
     * @param {string} tabId - Tab ID
     * @param {object} tab - Updated tab object
     */
    updateTabElement(tabId, tab) {
        const tabEl = this.tabList.querySelector(`[data-tab-id="${tabId}"]`);
        if (!tabEl) return;

        // Update title if changed
        const titleEl = tabEl.querySelector('.tab-title');
        if (titleEl && titleEl.textContent !== tab.title) {
            titleEl.textContent = tab.title;
            titleEl.title = tab.title;
        }

        // Update dirty state
        if (tab.isDirty && !tabEl.classList.contains('unsaved')) {
            tabEl.classList.add('unsaved');
        } else if (!tab.isDirty && tabEl.classList.contains('unsaved')) {
            tabEl.classList.remove('unsaved');
        }

        console.log(`[TabUIManager] Updated tab element: ${tabId}`);
    },

    /**
     * Remove tab element from DOM
     * @param {string} tabId - Tab ID
     */
    removeTabElement(tabId) {
        const link = this.tabList.querySelector(`[data-tab-id="${tabId}"]`);
        if (link) {
            const navItem = link.parentElement;
            navItem.classList.add('tab-exit');
            setTimeout(() => {
                navItem.remove();
                console.log(`[TabUIManager] Removed tab element: ${tabId}`);
            }, 200);
        }
    },

    /**
     * Close tab with unsaved changes confirmation
     * @param {string} tabId - Tab ID to close
     */
    closeTab(tabId) {
        const tab = tabManager.findTabById(tabId);
        if (!tab) return;

        // Check for unsaved changes
        if (tab.isDirty) {
            const confirmed = confirm(`"${tab.title}" has unsaved changes. Do you want to close it anyway?`);
            if (!confirmed) {
                console.log(`[TabUIManager] Close cancelled for tab: ${tabId}`);
                return;
            }
        }

        const closed = tabManager.closeTab(tabId, { skipConfirm: true });
        if (closed) {
            console.log(`[TabUIManager] Closed tab: ${tabId}`);
        }
    },

    /**
     * Scroll tab into view
     * @param {string} tabId - Tab ID to scroll to
     */
    scrollToTab(tabId) {
        const tabEl = this.tabList.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabEl) {
            tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            console.log(`[TabUIManager] Scrolled to tab: ${tabId}`);
        }
    },

    /**
     * Show tab context menu
     * @param {event} e - Right-click event
     * @param {string} tabId - Tab ID
     */
    showTabContextMenu(e, tabId) {
        const tab = tabManager.findTabById(tabId);
        if (!tab) return;

        console.log(`[TabUIManager] Showing context menu for tab: ${tabId}`);

        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'tab-context-menu';
        menu.innerHTML = `
            <a class="tab-context-menu-item" data-action="close">
                <i class="bi bi-x me-2"></i>Close Tab
            </a>
            <a class="tab-context-menu-item" data-action="closeOthers">
                <i class="bi bi-x-circle me-2"></i>Close Other Tabs
            </a>
            <a class="tab-context-menu-item" data-action="closeAll">
                <i class="bi bi-x-square me-2"></i>Close All Tabs
            </a>
            <hr style="margin: 4px 0;">
            <a class="tab-context-menu-item" data-action="copyPath">
                <i class="bi bi-files me-2"></i>Copy Path
            </a>
        `;

        // Position menu
        menu.style.position = 'fixed';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        document.body.appendChild(menu);

        // Handle menu clicks
        menu.querySelectorAll('.tab-context-menu-item').forEach(item => {
            item.addEventListener('click', (evt) => {
                evt.preventDefault();
                const action = item.dataset.action;

                switch (action) {
                    case 'close':
                        this.closeTab(tabId);
                        break;
                    case 'closeOthers':
                        this.closeOtherTabs(tabId);
                        break;
                    case 'closeAll':
                        this.closeAllTabs();
                        break;
                    case 'copyPath':
                        navigator.clipboard.writeText(tab.path);
                        console.log(`[TabUIManager] Copied path: ${tab.path}`);
                        break;
                }

                menu.remove();
            });
        });

        // Close menu on click outside
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    },

    /**
     * Close all tabs except one
     * @param {string} tabId - Tab ID to keep open
     */
    closeOtherTabs(tabId) {
        const tabs = tabManager.getAllTabs();
        let closedCount = 0;

        tabs.forEach(tab => {
            if (tab.id !== tabId && !tab.isDirty) {
                if (tabManager.closeTab(tab.id, { skipConfirm: true })) {
                    closedCount++;
                }
            }
        });

        console.log(`[TabUIManager] Closed ${closedCount} other tabs`);
    },

    /**
     * Close all tabs
     */
    closeAllTabs() {
        const tabs = tabManager.getAllTabs();
        const dirtyTabs = tabs.filter(t => t.isDirty);

        if (dirtyTabs.length > 0) {
            const confirmed = confirm(`${dirtyTabs.length} tab(s) have unsaved changes. Close anyway?`);
            if (!confirmed) {
                console.log('[TabUIManager] Close all cancelled');
                return;
            }
        }

        tabManager.closeAllTabs({ skipConfirm: true });
        console.log('[TabUIManager] Closed all tabs');
    },

    /**
     * Show tab bar
     */
    showTabBar() {
        if (this.tabBar) {
            this.tabBar.classList.remove('hidden');
            console.log('[TabUIManager] Tab bar shown');
        }
    },

    /**
     * Hide tab bar
     */
    hideTabBar() {
        if (this.tabBar) {
            this.tabBar.classList.add('hidden');
            console.log('[TabUIManager] Tab bar hidden');
        }
    },

    /**
     * Get icon class for file type
     * @param {string} path - File path
     * @returns {string} Icon class name
     */
    getTabIcon(path) {
        if (!path) return 'bi-file-earmark';

        const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
        return this.config.iconMap[ext] || 'bi-file-earmark';
    },

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, char => map[char]);
    },

    /**
     * Get tab count
     * @returns {number} Number of open tabs
     */
    getTabCount() {
        return this.tabList.querySelectorAll('.tab').length;
    },

    /**
     * Clear all tabs from UI
     */
    clearAllTabs() {
        this.tabList.innerHTML = '';
        this.hideTabBar();
        console.log('[TabUIManager] Cleared all tabs');
    },

    /**
     * Get active tab element
     * @returns {element|null} Active tab element
     */
    getActiveTabElement() {
        return this.tabList.querySelector('.tab.active');
    },

    /**
     * Get all tab elements
     * @returns {array} Array of tab elements
     */
    getAllTabElements() {
        return Array.from(this.tabList.querySelectorAll('.nav-link'));
    },

    /**
     * Show the content of a specific tab
     * @param {object} tab - Tab object
     */
    showTabContent(tab) {
        // Import documentController to show the document content
        import('./documentcontroller.js').then(({ documentController }) => {
            if (documentController && tab.path && tab.spaceName) {
                // Create a document object from tab data
                const document = {
                    title: tab.title,
                    path: tab.path,
                    spaceName: tab.spaceName,
                    content: tab.content,
                    metadata: tab.metadata
                };

                // Show the enhanced document view with the tab's content
                documentController.showEnhancedDocumentView(document);

                console.log(`[TabUIManager] Showing content for tab: ${tab.id}`);
            }
        }).catch(err => {
            console.error('[TabUIManager] Failed to show tab content:', err);
        });
    },

    /**
     * Show tab preview on hover
     * @param {element} tabElement - Tab nav-link element
     * @param {string} tabId - Tab ID
     */
    async showTabPreview(tabElement, tabId) {
        const tab = tabManager.findTabById(tabId);
        if (!tab) return;

        // Create or get preview tooltip
        let preview = document.getElementById('tabPreview');
        if (!preview) {
            preview = document.createElement('div');
            preview.id = 'tabPreview';
            preview.className = 'tab-preview-tooltip';
            document.body.appendChild(preview);
        }

        // Show loading state
        preview.innerHTML = '<div class="file-preview-loading"><span class="spinner-border spinner-border-sm me-2"></span>Loading preview...</div>';
        preview.classList.add('show');

        // Position near tab
        const rect = tabElement.getBoundingClientRect();
        preview.style.position = 'fixed';
        preview.style.top = (rect.bottom + 10) + 'px';
        preview.style.left = rect.left + 'px';
        preview.style.zIndex = '10000';

        try {
            // If we have content in the tab, use it directly
            if (tab.content) {
                this.renderTabPreviewContent(preview, tab);
                return;
            }

            // Otherwise fetch from API
            const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(tab.path)}&spaceName=${encodeURIComponent(tab.spaceName)}&enhanced=true`);
            if (!response.ok) throw new Error('Failed to load preview');

            const data = await response.json();
            const { content: fileContent, metadata } = data;

            // Create tab object with content for rendering
            const tabWithContent = { ...tab, content: fileContent, metadata };
            this.renderTabPreviewContent(preview, tabWithContent);
        } catch (error) {
            console.error('[TabUIManager] Error loading tab preview:', error);
            preview.innerHTML = '<div class="alert alert-danger m-0">Failed to load preview</div>';
        }
    },

    /**
     * Render preview content based on file type
     * @param {element} preview - Preview element
     * @param {object} tab - Tab object with content
     */
    renderTabPreviewContent(preview, tab) {
        const viewer = tab.metadata?.viewer || 'default';
        let previewHtml = '';

        switch (viewer) {
            case 'image':
                const imageUrl = `/applications/wiki/api/documents/content?path=${encodeURIComponent(tab.path)}&spaceName=${encodeURIComponent(tab.spaceName)}`;
                previewHtml = `<img src="${imageUrl}" alt="Preview" style="max-width: 300px; max-height: 300px;" />`;
                break;

            case 'markdown':
                if (typeof marked !== 'undefined') {
                    // Show first 500 characters of rendered markdown
                    const preview = tab.content.substring(0, 500) + (tab.content.length > 500 ? '...' : '');
                    previewHtml = `<div class="markdown-preview" style="max-height: 300px; overflow-y: auto;">${parseMarkdown(preview)}</div>`;
                } else {
                    // Fallback to plain text
                    const preview = tab.content.substring(0, 300) + (tab.content.length > 300 ? '...' : '');
                    previewHtml = `<pre style="max-height: 300px; overflow: auto;">${this.escapeHtml(preview)}</pre>`;
                }
                break;

            case 'text':
            case 'code':
            case 'web':
                const textPreview = tab.content.substring(0, 400) + (tab.content.length > 400 ? '...' : '');
                previewHtml = `<pre style="max-height: 300px; overflow: auto; font-size: 11px;">${this.escapeHtml(textPreview)}</pre>`;
                break;

            case 'pdf':
            case 'word':
            case 'excel':
            case 'powerpoint':
                previewHtml = `<div class="alert alert-info m-0"><small>${viewer.toUpperCase()} file - Click to view full content</small></div>`;
                break;

            default:
                const defaultPreview = tab.content ? tab.content.substring(0, 300) + (tab.content.length > 300 ? '...' : '') : 'No preview available';
                previewHtml = `<pre style="max-height: 300px; overflow: auto;">${this.escapeHtml(defaultPreview)}</pre>`;
        }

        preview.innerHTML = previewHtml;
    },

    /**
     * Hide tab preview
     */
    hideTabPreview() {
        const preview = document.getElementById('tabPreview');
        if (preview) {
            preview.classList.remove('show');
        }
    }
};

export default tabUIManager;
