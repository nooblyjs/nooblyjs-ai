/**
 * @fileoverview The spaces controller
 * Handles the all the client side javascript for spaces management
 *
 *@author Digital Techonolgies Team
 * @version 2.0.0
 * @since 2025-08-26
 */

import { navigationController } from "./navigationcontroller.js";
import { documentController } from "./documentcontroller.js";

export const spacesController = {

    selectedSpaceIds: null, // null = show all (default), array = show only selected

    init(app) {
        this.app = app;
    },

    /**
     * Render the spaces
     * @returns 
     */
    renderSpacesList() {
        console.log('[SpacesController] renderSpacesList() called');
        console.log('[SpacesController] Spaces available:', this.app.data.spaces);
        const spacesList = document.getElementById('spacesList');
        if (!spacesList) {
            console.warn('[SpacesController] spacesList container not found!');
            return;
        }

        if (!this.app.data.spaces || this.app.data.spaces.length === 0) {
            console.log('[SpacesController] No spaces to render');
            spacesList.innerHTML = '<div class="no-spaces">No spaces available</div>';
            return;
        }

        // Filter by selected spaces if user has preferences
        const spacesToRender = this.selectedSpaceIds
            ? this.app.data.spaces.filter(s => this.selectedSpaceIds.includes(s.id))
            : this.app.data.spaces;

        // Hide the entire spaces section if only one space is available
        const spacesSection = spacesList.closest('.kr-side-section');
        if (spacesSection) {
            spacesSection.style.display = spacesToRender.length === 1 ? 'none' : '';
        }

        console.log('[SpacesController] Rendering', spacesToRender.length, 'of', this.app.data.spaces.length, 'spaces');

        spacesList.innerHTML = spacesToRender.map(space => `
            <a href="#" class="nav-link d-flex align-items-center py-2 px-2 rounded ${this.app.currentSpace?.id === space.id ? 'active bg-secondary text-white' : 'text-dark'}"
               data-space-id="${space.id}">
                <i class="${this.getBootstrapSpaceIcon(space)} me-2"></i>
                <span>${space.name}</span>
            </a>
        `).join('');

        // Update spaces count
        const spacesCount = document.querySelector('.spaces-count');
        if (spacesCount) {
            spacesCount.textContent = spacesToRender.length;
        }

        // Bind click events
        spacesList.querySelectorAll('[data-space-id]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const spaceId = parseInt(item.dataset.spaceId);
                this.selectSpace(spaceId);
            });
        });

        // Auto-select first space if none selected (or if current space was deselected).
        // Skip when a deep link is pending — handleDeepLink() will select the correct
        // space, and auto-selecting first would pushState over the deep-link URL and
        // race with handleDeepLink's own selectSpace/showHome calls.
        const currentStillVisible = this.app.currentSpace && spacesToRender.some(s => s.id === this.app.currentSpace.id);
        if (!currentStillVisible && spacesToRender.length > 0 && !this.app._pendingDeepLinkPath) {
            console.log('[SpacesController] Auto-selecting first visible space:', spacesToRender[0].name);
            this.selectSpace(spacesToRender[0].id);
        } else if (spacesToRender.length === 0) {
            if (!this.app.currentSpace) {
                console.log('[SpacesController] No current space set, but no spaces available to auto-select');
            }
        }
    },

    /**
     * Select a space and render its details
     * @param {} spaceId 
     * @returns 
     */
    async selectSpace(spaceId) {
        console.log('[SpacesController] selectSpace() called with ID:', spaceId);
        // Handle type coercion - spaceId might come as string from HTML attribute
        const spacesArray = Array.isArray(this.app.data.spaces)
            ? this.app.data.spaces
            : (this.app.data.spaces?.data || []);
        const space = spacesArray.find(s => String(s.id) === String(spaceId));
        if (!space) {
            console.warn('[SpacesController] Space not found:', spaceId);
            return;
        }

        console.log('[SpacesController] Setting current space to:', space.name);
        this.app.currentSpace = space;

        // Claim this selection. Everything below is async and several chains can
        // be in flight at once — the boot auto-select, a deep link and a user
        // click all land here — so each step checks it is still the newest
        // before doing work or painting. Without it the slowest chain wins,
        // which is what made one space's home page appear and then be replaced
        // by another's.
        const token = this.app.beginSpaceSelection();

        // EVERYTHING VISIBLE HAPPENS HERE, IN ONE SYNCHRONOUS BLOCK, so the
        // browser paints the new brand and every placeholder in the same frame.
        // The order below is load-bearing: the first `await` is the file-tree
        // fetch, and anything visual left after it turns one state change into
        // a staircase — colour, then placeholders a round trip later, then
        // content. Keep new work above it, or make it async and let the
        // placeholders cover it.
        this.app.enterSpaceLoadingState(space);

        // Brand the app for this space (spaces.json `theme` key). A space
        // without a theme reverts to the default, so leaving a branded space
        // un-brands correctly. /js/theme.js is a classic script loaded in
        // <head>; guard anyway so a host page that omits it still navigates.
        window.KRTheme?.applyForSpace(space);

        // Public spaces force-collapse the sidebar (the file tree doesn't fit
        // the public-reader view). For team/private spaces we respect the
        // user's own toggle — calling expandSidebar() here would overwrite
        // their saved sidebarCollapsed=true preference every time they
        // navigate, making it impossible to keep the nav hidden.
        const visibility = space.visibility?.toLowerCase() || '';
        if (visibility === 'public') {
            console.log('[SpacesController] Public space detected - hiding sidebar');
            this.app.collapseSidebar();
        }

        // Update URL for deep linking
        if (!this.app._suppressPushState) {
            const newUrl = `/applications/wiki/${encodeURIComponent(space.name)}/`;
            if (window.location.pathname !== newUrl) {
                history.pushState({ type: 'space', spaceName: space.name }, '', newUrl);
            }
        }

        this.renderSpacesList(); // Re-render to show selection

        // Update UI permissions based on space type
        this.app.updateUIPermissions();

        console.log('[SpacesController] Loading file tree for space:', space.name);
        await navigationController.loadFileTree();

        if (!this.app.isSpaceCurrent(token)) {
            console.log('[SpacesController] Superseded by a newer space selection, abandoning:', space.name);
            return;
        }

        // Dispatch space change event
        window.dispatchEvent(new CustomEvent('spaceChanged', {
            detail: { space: space }
        }));

        // Load the space's home page
        console.log('[SpacesController] Loading home page for space:', space.name);
        await this.app.showHome(token);
        console.log('[SpacesController] Space loaded successfully');
    },
    
    /**
     * Ensure the workspace echos the selected space
     */
    updateWorkspaceHeader() {
        const titleEl = document.getElementById('workspaceTitle');
        const subtitleEl = document.getElementById('workspaceSubtitle');

        if (this.app.currentSpace) {
            if (titleEl) titleEl.textContent = `Welcome to ${this.app.currentSpace.name}`;
            if (subtitleEl) subtitleEl.textContent = this.app.currentSpace.description || 'Your documentation workspace dashboard';
        } else {
            if (titleEl) titleEl.textContent = 'Welcome to the Wiki';
            if (subtitleEl) subtitleEl.textContent = 'Your documentation workspace dashboard';
        }
    },

    /**
     * Display the Create workspace modal should the user want to create one
     */
    showCreateSpaceModal() {
        this.app.showModal('createSpaceModal');
    },

    /**
     * From the modal create the requestd space
     */
    async handleCreateSpace() {
        const form = document.getElementById('createSpaceForm');
        const formData = new FormData(form);

        try {
            const response = await fetch('/applications/wiki/api/spaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.get('spaceName'),
                    description: formData.get('spaceDescription'),
                    visibility: formData.get('spaceVisibility'),
                    type: formData.get('spaceType'),
                    path: formData.get('spacePath')
                })
            });

            const result = await response.json();

            if (result.success) {
                this.app.hideModal('createSpaceModal');
                form.reset();
                await this.app.loadInitialData();
                this.app.showNotification('Space created successfully!', 'success');
            } else {
                throw new Error(result.message || 'Failed to create space');
            }
        } catch (error) {
            console.error('Error creating space:', error);
            this.app.showNotification('Failed to create space', 'error');
        }
    },

    /**
     * Handle browse folder button click
     */
    handleBrowseFolder() {
        // Placeholder for folder browser functionality
        // In a real implementation, this would open a file system dialog
        alert('Folder browser not implemented. Please type or paste the folder path manually.');
    },

    /**
     * Ensure the space has the most relevant icon
     * @param {} space 
     * @returns 
     */
    getBootstrapSpaceIcon(space) {
        // Use consistent Bootstrap icons for all spaces based on type first
        if (space.type) {
            const typeIconMappings = {
                'personal': 'bi bi-person-fill',
                'shared': 'bi bi-people-fill',
                'readonly': 'bi bi-book-fill',
                'team': 'bi bi-people',
                'public': 'bi bi-globe'
            };
            if (typeIconMappings[space.type]) {
                return typeIconMappings[space.type];
            }
        }

        // Fallback: map space names to Bootstrap icons
        const iconMappings = {
            'Personal Space': 'bi bi-person-fill',
            'Shared Space': 'bi bi-people-fill',
            'Read-Only Space': 'bi bi-book-fill'
        };

        if (iconMappings[space.name]) {
            return iconMappings[space.name];
        }

        // Default fallback
        return 'bi bi-folder-fill';
    },

    /**
     * Once the space is selected load its data
     *
     * DEAD — nothing calls this, and `loadSpaceRecentFiles` below reads
     * `app.data.documents`, which is now always empty: the boot-time
     * `GET /api/documents` that filled it walked every space's content root
     * from disk and was dropped. Rebuild these off the file tree
     * (navigationController.fullFileTree) or the recent-files API before
     * wiring them up to anything.
     *
     * @param {} space
     */
    async loadSpaceContent(space) {
        try {
            // Load recent files for this space
            await this.loadSpaceRecentFiles(space);
            
            // Load starred files for this space (placeholder for now)
            this.loadSpaceStarredFiles(space);
            
            // Load root files and folders
            await this.loadSpaceRootItems(space);
            
        } catch (error) {
            console.error('Error loading space content:', error);
        }
    },

    /**
     * Once the space has been selected load the relevant view and data
     * @param {} space 
     * @returns 
     */
    async loadSpaceRecentFiles(space) {
        const container = document.getElementById('spaceRecentFiles');
        if (!container) return;
        
        // Filter documents that belong to this space and sort by modification date
        const recentFiles = this.app.data.documents
            .filter(doc => doc.spaceId === space.id)
            .sort((a, b) => new Date(b.modifiedAt || b.createdAt) - new Date(a.modifiedAt || a.createdAt))
            .slice(0, 6); // Show only 6 most recent
        
        if (recentFiles.length === 0) {
            container.innerHTML = `
                <div class="no-content-message">
                    <svg width="48" height="48" class="no-content-icon">
                        <use href="#icon-history"></use>
                    </svg>
                    <p>No recent files in this space</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = recentFiles.map(file => {
            const fileTypeInfo = this.app.getFileTypeInfo(file.path || file.title);
            const iconClass = this.app.getFileTypeIconClass(fileTypeInfo.category);
            const iconColor = fileTypeInfo.color;
            
            const escapedPath = (file.path || file.title || '').replace(/"/g, '&quot;');
            return `
                <div class="file-card" data-document-path="${escapedPath}" data-space-name="${file.spaceName}" style="position: relative;">
                    <i class="bi ${iconClass} file-card-icon" style="color: ${iconColor};"></i>
                    <div class="file-card-info">
                        <div class="file-card-name">${file.title}</div>
                        <div class="file-card-meta">Modified ${this.app.formatDate(file.modifiedAt || file.createdAt)}</div>
                    </div>
                    <button class="btn btn-sm btn-outline-danger delete-recent-btn" data-document-path="${escapedPath}" title="Remove from recent" style="position: absolute; top: 8px; right: 8px;">
                        <i class="bi bi-clock-history"></i>
                    </button>
                </div>
            `;
        }).join('');
        
        // Bind click events and preview
        this.bindFileCardEvents(container.querySelectorAll('.file-card'));

        // Bind delete recent buttons
        container.querySelectorAll('.delete-recent-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const docPath = btn.dataset.documentPath;
                this.app.deleteRecentFile(docPath);
            });
        });
    },

    /**
     * Load the spaces starred files
     * @param {} space 
     * @returns 
     */
    loadSpaceStarredFiles(space) {
        const container = document.getElementById('spaceStarredFiles');
        if (!container) return;

        try {
            // Get starred files for this specific space
            const allStarredFiles = this.app.data.starred || [];
            const starredFiles = allStarredFiles
                .filter(file => file.spaceName === space.name)
                .slice(0, 6); // Limit to 6 items for home page

            if (starredFiles.length === 0) {
                container.innerHTML = `
                    <div class="no-content-message">
                        <svg width="48" height="48" class="no-content-icon">
                            <use href="#icon-star"></use>
                        </svg>
                        <p>No starred files in ${space.name}</p>
                        <small>Star files to see them here</small>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="items-grid">
                    ${starredFiles.map(file => {
                        const fileTypeInfo = this.app.getFileTypeInfo(file.path);
                        const iconClass = this.app.getFileTypeIconClass(fileTypeInfo.category);
                        const iconColor = fileTypeInfo.color;
                        const fileName = this.app.getFileNameFromPath(file.path);

                        const escapedPath = (file.path || '').replace(/"/g, '&quot;');
                        return `
                            <div class="item-card file-card" data-document-path="${escapedPath}" data-space-name="${file.spaceName}" style="position: relative;">
                                <i class="bi ${iconClass} item-icon" style="color: ${iconColor}; font-size: 24px;"></i>
                                <div class="item-info">
                                    <div class="item-name">${fileName}</div>
                                    <div class="item-meta">Starred ${this.app.formatDate(file.starredAt)}</div>
                                </div>
                                <button class="btn btn-sm btn-outline-warning unstar-file-btn" data-document-path="${escapedPath}" title="Unstar file" style="position: absolute; top: 8px; right: 8px;">
                                    <i class="bi bi-star"></i>
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            // Bind click events and preview
            this.bindFileCardEvents(container.querySelectorAll('.file-card'));

            // Bind unstar buttons
            container.querySelectorAll('.unstar-file-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const docPath = btn.dataset.documentPath;
                    this.app.unstarFile(docPath);
                });
            });

        } catch (error) {
            console.error('Error loading starred files for space:', error);
            container.innerHTML = `
                <div class="error-message">
                    <p>Error loading starred files</p>
                </div>
            `;
        }
    },

    /**
     * Not sure what this is 
     * @param {*} space 
     * @returns 
     */
    async loadSpaceRootItems(space) {
        const container = document.getElementById('spaceRootItems');
        if (!container) return;
        
        try {
            // Get the folder tree for this space
            const response = await fetch(`/applications/wiki/api/spaces/${space.id}/folders`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: API endpoint not available`);
            }
            const tree = await response.json();
            
            if (tree.length === 0) {
                container.innerHTML = `
                    <div class="no-content-message">
                        <svg width="48" height="48" class="no-content-icon">
                            <use href="#icon-folder"></use>
                        </svg>
                        <p>No files or folders in this space</p>
                        <button id="createFirstFile" class="btn btn-secondary" style="margin-top: 12px;">Create First File</button>
                    </div>
                `;
                
                // Bind create first file button
                document.getElementById('createFirstFile')?.addEventListener('click', () => {
                    this.app.showCreateFileModal();
                });
                return;
            }
            
            // Render root level items only
            const rootItems = tree.filter(item => !item.path.includes('/') || item.path.split('/').length === 1);
            
            container.innerHTML = `
                <div class="items-grid">
                    ${rootItems.map(item => {
                        if (item.type === 'folder') {
                            const childCount = item.children ? item.children.length : 0;
                            return `
                                <div class="item-card folder-card" data-folder-path="${item.path}">
                                    <i class="bi bi-folder item-icon" style="color: var(--text-secondary); font-size: 24px;"></i>
                                    <div class="item-info">
                                        <div class="item-name">${item.name}</div>
                                        <div class="item-meta">Folder • ${childCount} item${childCount !== 1 ? 's' : ''}</div>
                                    </div>
                                </div>
                            `;
                        } else if (item.type === 'document') {
                            const fileTypeInfo = this.app.getFileTypeInfo(item.path || item.name);
                            const iconClass = this.app.getFileTypeIconClass(fileTypeInfo.category);
                            const iconColor = fileTypeInfo.color;
                            
                            return `
                                <div class="item-card file-card" data-document-path="${item.path}" data-space-name="${item.spaceName}">
                                    <i class="fas ${iconClass} item-icon" style="color: ${iconColor}; font-size: 24px;"></i>
                                    <div class="item-info">
                                        <div class="item-name">${item.title || item.name}</div>
                                        <div class="item-meta">File • ${fileTypeInfo.category}</div>
                                    </div>
                                </div>
                            `;
                        }
                        return '';
                    }).join('')}
                </div>
            `;
            
            // Bind click events for folders and files
            container.querySelectorAll('.folder-card').forEach(card => {
                card.addEventListener('click', () => {
                    const folderPath = card.dataset.folderPath;
                    // navigationController, not app — `app.loadFolderContent`
                    // has never existed, so this threw a TypeError on click.
                    navigationController.loadFolderContent(folderPath);
                });
            });

            // Bind click events and preview for files
            this.bindFileCardEvents(container.querySelectorAll('.file-card'));

        } catch (error) {
            console.log('Space root items API not available, showing placeholder');
            container.innerHTML = `
                <div class="no-content-message">
                    <svg width="48" height="48" class="no-content-icon">
                        <use href="#icon-folder"></use>
                    </svg>
                    <p>Space content will appear when backend is connected</p>
                    <button id="createFirstFile" class="btn btn-secondary" style="margin-top: 12px;">Create First File</button>
                </div>
            `;
            
            // Bind create first file button
            document.getElementById('createFirstFile')?.addEventListener('click', () => {
                this.app.showCreateFileModal();
            });
        }
    },

    /**
     * Load selected spaces from user preferences
     */
    async loadSelectedSpaces() {
        try {
            const response = await fetch('/applications/wiki/api/user/selected-spaces', {
                credentials: 'include'
            });
            if (!response.ok) return;
            const data = await response.json();
            // Empty array means "show all" (first-time user)
            this.selectedSpaceIds = data.selectedSpaces && data.selectedSpaces.length > 0
                ? data.selectedSpaces
                : null;
        } catch (error) {
            console.warn('[SpacesController] Could not load selected spaces:', error);
            this.selectedSpaceIds = null;
        }
    },

    /**
     * Show the Space Manager modal
     */
    async showSpaceManager() {
        // Load latest selected spaces
        await this.loadSelectedSpaces();

        const allSpaces = this.app.data.spaces || [];
        const listContainer = document.getElementById('spaceManagerList');
        if (!listContainer) return;

        if (allSpaces.length === 0) {
            listContainer.innerHTML = '<div class="text-center text-muted py-3">No spaces available.</div>';
            this.app.showModal('spaceManagerModal');
            return;
        }

        listContainer.innerHTML = allSpaces.map(space => {
            const isSelected = !this.selectedSpaceIds || this.selectedSpaceIds.includes(space.id);
            const icon = this.getBootstrapSpaceIcon(space);
            const visibilityBadge = space.visibility === 'public'
                ? '<span class="badge bg-success ms-2">Public</span>'
                : space.visibility === 'team'
                    ? '<span class="badge bg-primary ms-2">Team</span>'
                    : '<span class="badge bg-secondary ms-2">Private</span>';

            return `
                <div class="d-flex align-items-center justify-content-between py-2 px-2 border-bottom" data-manager-space-id="${space.id}">
                    <div class="d-flex align-items-center flex-grow-1 me-3" style="min-width: 0;">
                        <i class="${icon} me-2 flex-shrink-0" style="font-size: 16.8px;"></i>
                        <div style="min-width: 0;">
                            <div class="fw-semibold text-truncate">${space.name}${visibilityBadge}</div>
                            ${space.description ? `<div class="text-muted small text-truncate">${space.description}</div>` : ''}
                        </div>
                    </div>
                    <div class="form-check form-switch flex-shrink-0">
                        <input class="form-check-input space-toggle" type="checkbox" role="switch"
                            data-space-id="${space.id}" ${isSelected ? 'checked' : ''}>
                    </div>
                </div>
            `;
        }).join('');

        // Bind toggle events
        listContainer.querySelectorAll('.space-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const spaceId = parseInt(e.target.dataset.spaceId);
                this.toggleSpaceSelection(spaceId, e.target.checked);
            });
        });

        this.app.showModal('spaceManagerModal');
    },

    /**
     * Toggle a space in/out of the sidebar selection
     */
    async toggleSpaceSelection(spaceId, isSelected) {
        const allSpaces = this.app.data.spaces || [];

        // If selectedSpaceIds is null (show all), initialize with all IDs
        if (!this.selectedSpaceIds) {
            this.selectedSpaceIds = allSpaces.map(s => s.id);
        }

        if (isSelected) {
            if (!this.selectedSpaceIds.includes(spaceId)) {
                this.selectedSpaceIds.push(spaceId);
            }
        } else {
            this.selectedSpaceIds = this.selectedSpaceIds.filter(id => id !== spaceId);
        }

        // If all spaces are selected, reset to null (show all)
        if (this.selectedSpaceIds.length === allSpaces.length) {
            this.selectedSpaceIds = null;
        }

        // Save to backend
        try {
            await fetch('/applications/wiki/api/user/selected-spaces', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    spaceIds: this.selectedSpaceIds || []
                })
            });
        } catch (error) {
            console.error('[SpacesController] Failed to save selected spaces:', error);
        }

        // Re-render sidebar
        this.renderSpacesList();
    },

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
};
