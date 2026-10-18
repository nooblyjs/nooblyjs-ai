import { spacesController } from "./modules/spacescontroller.js";
import { navigationController } from "./modules/navigationcontroller.js";
import { documentController } from "./modules/documentcontroller.js";
import { searchController } from "./modules/searchcontroller.js";
import { userController } from "./modules/usercontroller.js";
import { settingsController } from "./modules/settingscontroller.js";
import { aiChatController } from "./modules/aichatcontroller.js";
import { tabManager } from "./modules/tabManager.js";
import { tabUIManager } from "./modules/tabUIManager.js";

import socketService from "./services/socketService.js";
// Note: documentationController is only used on landing page, not in wiki app

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
        this.currentView = 'login';
        this.currentSpace = null;
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
        this.sidebarState = {
            shortcuts: true,
            spaces: true
        };
        this.recentViewMode = 'cards';
        this.starredViewMode = 'cards';
        this.searchViewMode = 'cards';

        // Initialize tab manager and UI manager
        this.tabManager = tabManager;
        this.tabUIManager = tabUIManager;

        // Initialize controllers
        spacesController.init(this);
        navigationController.init(this);
        documentController.init(this);
        searchController.init(this);
        userController.init(this);
        settingsController.init(this);
        aiChatController.init(this);

        this.init();
    }

    init() {
        userController.checkAuth();
        this.bindEvents();
        this.initMarkdown();
        this.initSidebar();
        this.initSidebarResize();

        // Initialize tab manager
        this.tabManager.init();

        // Initialize tab UI manager
        this.tabUIManager.init();

        // Set navigation controller reference for event bus integration
        socketService.setNavigationController(navigationController);

        // Initialize Socket.IO for real-time updates
        socketService.init();

        // Deep link: handle browser back/forward
        window.addEventListener('popstate', () => this.handleDeepLink(window.location.pathname));
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

        // Hide/show create dropdown in header
        const createDropdown = document.getElementById('createDropdown');
        if (createDropdown) {
            createDropdown.parentElement.style.display = isReadOnly ? 'none' : 'block';
        }

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

        // Sidebar collapsible sections
        document.getElementById('shortcutsHeader')?.addEventListener('click', () => {
            this.toggleSidebarSection('shortcuts');
        });

        document.getElementById('spacesHeader')?.addEventListener('click', () => {
            this.toggleSidebarSection('spaces');
        });

        // Shortcuts navigation
        document.getElementById('shortcutHome')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showHome();
        });

        document.getElementById('shortcutRecent')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showRecent();
        });

        document.getElementById('shortcutStarred')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showStarred();
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


        // Header Create Dropdown Menu Items
        document.getElementById('createFolderMenuItem')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleContextualCreateFolder();
        });

        document.getElementById('createFileMenuItem')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleContextualCreateFile();
        });

        document.getElementById('uploadFileMenuItem')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleContextualUpload();
        });

        // Space actions
        document.getElementById('createSpaceBtn')?.addEventListener('click', () => {
            spacesController.showCreateSpaceModal();
        });

        // Modal events
        this.bindModalEvents();

        // Global search with suggestions
        searchController.initSearchFunctionality();

        // Refresh recent files button
        document.getElementById('refreshRecentBtn')?.addEventListener('click', async () => {
            await this.loadRecentFiles();
        });

        // Home page view mode toggles for Recent and Starred sections
        document.querySelectorAll('.view-mode-switcher[data-target="recentHome"] .view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.recentViewMode = btn.dataset.view;
                // Update active state on buttons
                btn.closest('.view-mode-switcher').querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadRecentFiles();
            });
        });

        document.querySelectorAll('.view-mode-switcher[data-target="starredHome"] .view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.starredViewMode = btn.dataset.view;
                btn.closest('.view-mode-switcher').querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loadStarredFiles();
            });
        });

        // Context menu functionality
        navigationController.initContextMenu();

        // Initialize activity tracking
        userController.ensureActivityData();
    }

    showLoginButton() {
        // Hide logout and create buttons for unauthenticated users
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
            logoutBtn.classList.add('hidden');
            logoutBtn.remove();
        }
        const createDropdown = document.getElementById('createDropdown');
        if (createDropdown && createDropdown.parentElement) {
            createDropdown.parentElement.style.display = 'none';
            createDropdown.parentElement.classList.add('hidden');
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

        // Load saved width from localStorage
        const savedWidth = localStorage.getItem('sidebarWidth');
        if (savedWidth) {
            sidebar.style.width = savedWidth + 'px';
        }

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

            // Save to localStorage
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

    toggleSidebarSection(section) {
        this.sidebarState[section] = !this.sidebarState[section];
        this.updateSidebarSection(section, this.sidebarState[section]);
    }

    updateSidebarSection(section, isExpanded) {
        const header = document.getElementById(`${section}Header`);
        const content = document.getElementById(`${section}Content`);
        
        if (!header || !content) return;

        if (isExpanded) {
            header.classList.remove('collapsed');
            content.classList.remove('collapsed');
            content.style.maxHeight = 'none'; // Allow natural height when expanded
        } else {
            header.classList.add('collapsed');
            content.classList.add('collapsed');
            content.style.maxHeight = '0px';
        }
    }

    async loadInitialData() {
        try {
            // Only load user-specific data if authenticated
            if (!this.isPublicMode) {
                // Load user profile first
                await userController.loadUserProfile();

                // Load user activity (starred and recent)
                await userController.loadUserActivity();

                // Load folder view preferences now that the user is authenticated
                await navigationController.loadFolderViewPreferences();

                // Load AI chat data after authentication
                if (aiChatController && aiChatController.loadAfterAuth) {
                    await aiChatController.loadAfterAuth();
                }
            }

            // Load spaces (API filters based on auth status)
            const spacesResponse = await fetch('/applications/wiki/api/spaces');
            this.data.spaces = await spacesResponse.json();

            // Load documents
            const documentsResponse = await fetch('/applications/wiki/api/documents');
            this.data.documents = await documentsResponse.json();

            spacesController.renderSpacesList();
            navigationController.loadFileTree();

            // Handle deep-link URL if present
            const deepPath = window.location.pathname;
            if (deepPath && deepPath !== '/applications/wiki/' && deepPath !== '/applications/wiki') {
                Promise.resolve().then(() => this.handleDeepLink(deepPath));
            }


        } catch (error) {
            console.error('Error loading initial data:', error);
        }
    }

    async loadSpaces() {
        try {
            // Fetch updated spaces data
            const spacesResponse = await fetch('/applications/wiki/api/spaces');
            this.data.spaces = await spacesResponse.json();
            spacesController.renderSpacesList();

        } catch (error) {
            console.error('Error loading spaces:', error);
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

        this._suppressPushState = true;
        try {
            await spacesController.selectSpace(space.id);

            if (!itemPath) {
                history.replaceState({ type: 'space', spaceName: space.name }, '',
                    `${BASE}${encodeURIComponent(space.name)}/`);
                return;
            }

            await this._waitForFileTree();

            const lastSegment = decodedSegments[decodedSegments.length - 1];
            const isFile = lastSegment.includes('.');

            if (isFile) {
                await documentController.openDocumentByPath(itemPath, space.name);
            } else {
                await navigationController.loadFolderContent(itemPath);
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

    populateFileLocationSelect() {
        const select = document.getElementById('fileLocation');
        if (!select) return;

        // Clear existing options except root
        select.innerHTML = '<option value="">Root</option>';
        
        // Add existing folders as options
        // This would be populated from the current folder tree
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
    async showHome() {
        this.setActiveView('home');
        this.setActiveShortcut('shortcutHome');
        this.currentView = 'home';

        // Restore full home view
        this.restoreHomeView();

        // Load home.md content if it exists
        await this.loadHomeContent();

        // Load recent files for the homepage
        await this.loadRecentFiles();
        this.loadStarredFiles();

    }

    /**
     * Render view mode toggle buttons
     * @param {string} currentMode - Current view mode (details|grid|cards)
     * @returns {string} HTML for the view toggle buttons
     */
    renderViewToggle(currentMode) {
        return `
            <div class="view-mode-switcher">
                <button class="view-mode-btn ${currentMode === 'details' ? 'active' : ''}" data-view="details" title="List view">
                    <i class="bi bi-list-ul"></i>
                </button>
                <button class="view-mode-btn ${currentMode === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
                    <i class="bi bi-grid-3x3-gap"></i>
                </button>
                <button class="view-mode-btn ${currentMode === 'cards' ? 'active' : ''}" data-view="cards" title="Cards view">
                    <i class="bi bi-card-image"></i>
                </button>
            </div>
        `;
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
        if (files.length === 0) return '';
        const cardColClass = options.colClass || 'col-md-4 col-lg-3';

        const dateFieldMap = { recent: 'visitedAt', starred: 'starredAt', search: 'modifiedAt' };
        const dateLabelMap = { recent: 'Visited', starred: 'Starred', search: 'Modified' };
        const dateField = dateFieldMap[type] || 'modifiedAt';
        const dateLabel = dateLabelMap[type] || 'Modified';

        if (viewMode === 'details') {
            const rows = files.map(file => {
                const fileTypeInfo = navigationController.getFileTypeInfo(file.path);
                const iconClass = navigationController.getFileTypeIconClass(fileTypeInfo.category);
                const iconColor = fileTypeInfo.color;
                const fileName = file.title || navigationController.getFileNameFromPath(file.path);
                const spaceName = file.spaceName || 'Unknown Space';
                const dateStr = file[dateField] ? this.formatDate(file[dateField]) : '';
                const escapedPath = (file.path || '').replace(/"/g, '&quot;');
                const escapedSpaceName = spaceName.replace(/"/g, '&quot;');

                // Determine which action button to show based on type
                let actionButton = '';
                if (type === 'recent') {
                    actionButton = `<button class="btn btn-sm btn-outline-danger delete-recent-btn" data-document-path="${escapedPath}" title="Remove from recent">
                        <i class="bi bi-clock-history"></i>
                    </button>`;
                } else if (type === 'starred') {
                    actionButton = `<button class="btn btn-sm btn-outline-warning unstar-file-btn" data-document-path="${escapedPath}" title="Unstar file">
                        <i class="bi bi-star"></i>
                    </button>`;
                }

                return `
                    <tr class="file-row" data-document-path="${escapedPath}" data-space-name="${escapedSpaceName}" style="cursor:pointer;">
                        <td style="width:30px;"><i class="bi ${iconClass}" style="color: ${iconColor};"></i></td>
                        <td>${fileName}</td>
                        <td>${spaceName}</td>
                        <td>${dateStr}</td>
                        <td style="width:80px; text-align: right;">${actionButton}</td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="items-details">
                    <table class="table table-hover mb-0">
                        <thead>
                            <tr>
                                <th style="width:30px;"></th>
                                <th>Name</th>
                                <th>Space</th>
                                <th>${dateLabel}</th>
                                <th style="width:80px;"></th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }

        if (viewMode === 'grid') {
            const items = files.map(file => {
                const fileTypeInfo = navigationController.getFileTypeInfo(file.path);
                const iconClass = navigationController.getFileTypeIconClass(fileTypeInfo.category);
                const iconColor = fileTypeInfo.color;
                const fileName = file.title || navigationController.getFileNameFromPath(file.path);
                const dateStr = file[dateField] ? this.formatDate(file[dateField]) : '';
                const escapedPath = (file.path || '').replace(/"/g, '&quot;');
                const escapedSpaceName = (file.spaceName || '').replace(/"/g, '&quot;');

                // Determine which action button to show based on type
                let actionButton = '';
                if (type === 'recent') {
                    actionButton = `<button class="btn btn-sm btn-outline-danger delete-recent-btn" data-document-path="${escapedPath}" title="Remove from recent" style="position: absolute; top: 8px; right: 8px;">
                        <i class="bi bi-clock-history"></i>
                    </button>`;
                } else if (type === 'starred') {
                    actionButton = `<button class="btn btn-sm btn-outline-warning unstar-file-btn" data-document-path="${escapedPath}" title="Unstar file" style="position: absolute; top: 8px; right: 8px;">
                        <i class="bi bi-star"></i>
                    </button>`;
                }

                return `
                    <div class="item-card file-card" data-document-path="${escapedPath}" data-space-name="${escapedSpaceName}" style="position: relative;">
                        <i class="bi ${iconClass} item-icon" style="color: ${iconColor}; font-size: 24px;"></i>
                        <div class="item-info">
                            <div class="item-name">${fileName}</div>
                            <div class="item-meta">File &bull; ${fileTypeInfo.category} &bull; ${dateLabel} ${dateStr}</div>
                        </div>
                        ${actionButton}
                    </div>
                `;
            }).join('');

            return `<div class="items-grid">${items}</div>`;
        }

        // cards view (default) - uses card-preview with loading spinner, same as folder view
        const cards = files.map(file => {
            const fileTypeInfo = navigationController.getFileTypeInfo(file.path);
            const viewer = fileTypeInfo.category;
            const fileName = file.title || navigationController.getFileNameFromPath(file.path);
            const spaceName = file.spaceName || 'Unknown Space';
            const dateStr = file[dateField] ? this.formatDate(file[dateField]) : '';
            const escapedPath = (file.path || '').replace(/"/g, '&quot;');
            const escapedSpaceName = spaceName.replace(/"/g, '&quot;');
            const fileExt = navigationController.getFileTypeFromExtension(file.path || '');

            // Determine which action button to show based on type
            let actionButtons = '';
            if (type === 'recent') {
                actionButtons = `<button class="btn btn-sm btn-outline-danger delete-recent-btn" data-document-path="${escapedPath}" title="Remove from recent">
                    <i class="bi bi-clock-history"></i>
                </button>`;
            } else if (type === 'starred') {
                actionButtons = `<button class="btn btn-sm btn-outline-warning unstar-file-btn" data-document-path="${escapedPath}" title="Unstar file">
                    <i class="bi bi-star"></i>
                </button>`;
            }

            return `
                <div class="${cardColClass} mb-4">
                    <div class="card file-card-bootstrap" data-document-path="${escapedPath}" data-space-name="${escapedSpaceName}" data-viewer="${viewer}">
                        <div class="card-body text-center">
                            <div class="card-preview card-preview-loading" data-file-path="${escapedPath}" data-space-name="${escapedSpaceName}">
                                <div class="spinner-border text-secondary" role="status">
                                    <span class="visually-hidden">Loading...</span>
                                </div>
                            </div>
                        </div>
                        <div class="card-footer">
                            <div class="card-title-text"><strong>${fileName}</strong></div>
                            <small class="text-muted">${fileExt} &bull; ${spaceName}</small><br>
                            <small class="text-muted">${dateLabel} ${dateStr}</small>
                            <div class="mt-2">${actionButtons}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `<div class="items-cards"><div class="row">${cards}</div></div>`;
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
            // Load card previews (images, markdown, PDF) like the folder view
            if (container.querySelectorAll('.card-preview-loading').length > 0) {
                navigationController.loadCardPreviews();
            }
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
            const allRecentFiles = this.data.recent || [];
            const recentFiles = currentSpaceName
                ? allRecentFiles.filter(file => file.spaceName === currentSpaceName)
                : allRecentFiles;

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
                    ${this.renderFileItems(sortedRecentFiles, this.recentViewMode, 'recent')}
                </div>
            `;

            this.bindRenderedFileEvents(container);

            // Bind view toggle buttons
            container.querySelectorAll('.view-mode-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.recentViewMode = btn.dataset.view;
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
            const allStarredFiles = this.data.starred || [];
            const starredFiles = currentSpaceName
                ? allStarredFiles.filter(file => file.spaceName === currentSpaceName)
                : allStarredFiles;

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
                    ${this.renderFileItems(sortedStarredFiles, this.starredViewMode, 'starred')}
                </div>
            `;

            this.bindRenderedFileEvents(container);

            // Bind view toggle buttons
            container.querySelectorAll('.view-mode-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.starredViewMode = btn.dataset.view;
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

        // Update titles with current space information
        const workspaceTitle = document.getElementById('workspaceTitle');
        const workspaceSubtitle = document.getElementById('workspaceSubtitle');
        if (this.currentSpace) {
            if (workspaceTitle) workspaceTitle.textContent = `Welcome to ${this.currentSpace.name}`;
            if (workspaceSubtitle) workspaceSubtitle.textContent = this.currentSpace.description || 'Your documentation workspace';
        } else {
            if (workspaceTitle) workspaceTitle.textContent = 'Welcome to the wiki';
            if (workspaceSubtitle) workspaceSubtitle.textContent = 'Your documentation workspace dashboard';
        }

    }

    setActiveView(viewName) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.add('hidden');
        });
        
        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.remove('hidden');
        }
    }

    setActiveShortcut(shortcutId) {
        document.querySelectorAll('.shortcut-item').forEach(item => {
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
            
            // Clean up context menu prefilled paths and show location dropdowns again
            if (modalId === 'createFolderModal') {
                this.prefilledFolderPath = null;
                const folderLocationSelect = document.getElementById('folderLocation');
                const locationGroup = folderLocationSelect?.parentElement;
                if (locationGroup) {
                    locationGroup.style.display = 'block';
                }
            } else if (modalId === 'createFileModal') {
                this.prefilledFilePath = null;
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
    async loadHomeContent() {
        const homeContentArea = document.getElementById('homeContentArea');
        const homeContentBody = document.getElementById('homeContentBody');

        if (!homeContentArea || !homeContentBody) return;

        // Hide by default
        homeContentArea.classList.add('hidden');

        // Only try to load if we have a current space
        if (!this.currentSpace) return;

        try {
            // Try .home.md first, then fall back to home.md
            const filenamesToTry = ['.home.md', 'home.md'];

            for (const filename of filenamesToTry) {
                // Check if the file exists to avoid 404 errors in console
                const existsResponse = await fetch('/applications/wiki/api/documents/exists', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        spaceName: this.currentSpace.name,
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
                        spaceName: this.currentSpace.name,
                        path: filename
                    })
                });

                if (!contentResponse.ok) continue;

                const data = await contentResponse.json();

                if (data.content) {
                    // Render markdown content
                    homeContentBody.innerHTML = parseMarkdown(data.content);
                    homeContentArea.classList.remove('hidden');
                    return;
                }
            }

        } catch (error) {
            // Silently fail - home.md is optional
            // Don't log to avoid cluttering console
        }
    }

    // Placeholder methods for not-yet-implemented features
    async loadRecentFiles() {
        const container = document.getElementById('recentFilesContent');
        if (!container) return;

        try {
            const allRecentFiles = this.data.recent || [];
            const currentSpaceName = this.currentSpace ? this.currentSpace.name : null;

            const filteredRecentFiles = currentSpaceName
                ? allRecentFiles.filter(file => file.spaceName === currentSpaceName)
                : allRecentFiles;

            const recentFiles = filteredRecentFiles.slice(0, 6);

            if (filteredRecentFiles.length === 0) {
                const noFilesMessage = currentSpaceName
                    ? `No recent files in ${currentSpaceName}`
                    : 'No recent files found';
                const helpText = currentSpaceName
                    ? `Files you access in ${currentSpaceName} will appear here`
                    : 'Files you access will appear here';

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

            container.innerHTML = this.renderFileItems(recentFiles, this.recentViewMode, 'recent', { colClass: 'col-md-6' });
            this.bindRenderedFileEvents(container);

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
            const allStarredFiles = this.data.starred || [];
            const currentSpaceName = this.currentSpace ? this.currentSpace.name : null;

            const filteredStarredFiles = currentSpaceName
                ? allStarredFiles.filter(file => file.spaceName === currentSpaceName)
                : allStarredFiles;

            const starredFiles = filteredStarredFiles.slice(0, 6);

            if (filteredStarredFiles.length === 0) {
                const noFilesMessage = currentSpaceName
                    ? `No starred files in ${currentSpaceName}`
                    : 'No starred files found';
                const helpText = currentSpaceName
                    ? `Files you star in ${currentSpaceName} will appear here`
                    : 'Star files to see them here';

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

            container.innerHTML = this.renderFileItems(starredFiles, this.starredViewMode, 'starred', { colClass: 'col-md-6' });
            this.bindRenderedFileEvents(container);

        } catch (error) {
            console.error('Error loading starred files:', error);
            container.innerHTML = `
                <div class="error-message">
                    <p>Error loading starred files</p>
                </div>
            `;
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
    deleteRecentFile(documentPath) {
        try {
            if (!this.data.recent) this.data.recent = [];
            const index = this.data.recent.findIndex(file => file.path === documentPath);

            if (index !== -1) {
                this.data.recent.splice(index, 1);
                // Refresh the recent view
                if (this.currentView === 'recent') {
                    this.showRecent();
                }
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
    unstarFile(documentPath) {
        try {
            if (!this.data.starred) this.data.starred = [];
            const index = this.data.starred.findIndex(file => file.path === documentPath);

            if (index !== -1) {
                this.data.starred.splice(index, 1);
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
