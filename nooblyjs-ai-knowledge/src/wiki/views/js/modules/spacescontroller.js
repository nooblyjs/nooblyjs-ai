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

    init(app) {
        this.app = app;
    },

    /**
     * Render the spaces
     * @returns 
     */
    renderSpacesList() {
        const spacesList = document.getElementById('spacesList');
        if (!spacesList) return;

        if (this.app.data.spaces.length === 0) {
            spacesList.innerHTML = '<div class="no-spaces">No spaces available</div>';
            return;
        }

        spacesList.innerHTML = this.app.data.spaces.map(space => `
            <a href="#" class="nav-link d-flex align-items-center py-2 px-2 rounded ${this.app.currentSpace?.id === space.id ? 'active bg-secondary text-white' : 'text-dark'}"
               data-space-id="${space.id}">
                <i class="${this.getBootstrapSpaceIcon(space)} me-2"></i>
                <span>${space.name}</span>
            </a>
        `).join('');

        // Update spaces count
        const spacesCount = document.querySelector('.spaces-count');
        if (spacesCount) {
            spacesCount.textContent = this.app.data.spaces.length;
        }

        // Bind click events
        spacesList.querySelectorAll('[data-space-id]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const spaceId = parseInt(item.dataset.spaceId);
                this.selectSpace(spaceId);
            });
        });

        // Auto-select first space if none selected
        if (!this.app.currentSpace && this.app.data.spaces.length > 0) {
            this.selectSpace(this.app.data.spaces[0].id);
        }
    },

    /**
     * Select a space and render its details
     * @param {} spaceId 
     * @returns 
     */
    async selectSpace(spaceId) {
        const space = this.app.data.spaces.find(s => s.id === spaceId);
        if (!space) return;

        this.app.currentSpace = space;

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

        await navigationController.loadFileTree();

        // Dispatch space change event
        window.dispatchEvent(new CustomEvent('spaceChanged', {
            detail: { space: space }
        }));

        // Load the space's home page
        await this.app.showHome();
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

            return `
                <div class="file-card" data-document-path="${file.path || file.title}" data-space-name="${file.spaceName}">
                    <i class="bi ${iconClass} file-card-icon" style="color: ${iconColor};"></i>
                    <div class="file-card-info">
                        <div class="file-card-name">${file.title}</div>
                        <div class="file-card-meta">Modified ${this.app.formatDate(file.modifiedAt || file.createdAt)}</div>
                    </div>
                    <button class="btn btn-sm btn-outline-danger delete-recent-btn" data-document-path="${file.path || file.title}" title="Remove from recent">
                        <i class="bi bi-clock-history"></i>
                    </button>
                </div>
            `;
        }).join('');

        // Bind delete recent button events
        container.querySelectorAll('.delete-recent-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const docPath = btn.dataset.documentPath;
                this.deleteRecentFile(docPath, space);
            });
        });

        // Bind click events and preview
        this.bindFileCardEvents(container.querySelectorAll('.file-card'));
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

                        return `
                            <div class="item-card file-card" data-document-path="${file.path}" data-space-name="${file.spaceName}">
                                <i class="bi ${iconClass} item-icon" style="color: ${iconColor}; font-size: 24px;"></i>
                                <div class="item-info">
                                    <div class="item-name">${fileName}</div>
                                    <div class="item-meta">Starred ${this.app.formatDate(file.starredAt)}</div>
                                </div>
                                <button class="btn btn-sm btn-outline-warning unstar-file-btn" data-document-path="${file.path}" title="Unstar file">
                                    <i class="bi bi-star"></i>
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            // Bind unstar button events
            container.querySelectorAll('.unstar-file-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const docPath = btn.dataset.documentPath;
                    this.unstarFile(docPath);
                });
            });

            // Bind click events and preview
            this.bindFileCardEvents(container.querySelectorAll('.file-card'));

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
                                    <i class="fas fa-folder item-icon" style="color: var(--text-secondary); font-size: 24px;"></i>
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
                    this.app.loadFolderContent(folderPath);
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
     * Bind click and preview events to file cards
     */
    /**
     * Delete a file from recent activity
     */
    deleteRecentFile(documentPath, space) {
        try {
            // Remove from data
            const index = this.app.data.documents.findIndex(doc =>
                (doc.path || doc.title) === documentPath && doc.spaceId === space.id
            );

            if (index !== -1) {
                // Mark as not recently accessed by setting a very old modification date
                this.app.data.documents[index].modifiedAt = new Date(0).toISOString();

                // Save changes
                this.app.saveData();

                // Reload the recent files list
                this.loadSpaceRecentFiles(space);

                this.app.showNotification('Removed from recent files', 'success');
            }
        } catch (error) {
            console.error('Error deleting recent file:', error);
            this.app.showNotification('Failed to remove from recent', 'error');
        }
    }

    /**
     * Unstar a file
     */
    unstarFile(documentPath) {
        try {
            // Remove from starred list
            const starredIndex = (this.app.data.starred || []).findIndex(file => file.path === documentPath);

            if (starredIndex !== -1) {
                this.app.data.starred.splice(starredIndex, 1);

                // Save changes
                this.app.saveData();

                // Reload all starred views
                this.app.loadStarredFiles();

                this.app.showNotification('File unstarred', 'success');
            }
        } catch (error) {
            console.error('Error unstarring file:', error);
            this.app.showNotification('Failed to unstar file', 'error');
        }
    }

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
