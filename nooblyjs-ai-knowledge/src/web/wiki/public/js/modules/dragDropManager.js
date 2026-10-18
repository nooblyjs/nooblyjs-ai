/**
 * @fileoverview Drag and Drop Manager Module
 * Handles drag and drop functionality for uploading files into the wiki
 * Supports dragging files into the document view area and navigation panel
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-01
 */

import { fileValidator } from "./fileValidator.js";
import { uploadManager } from "./uploadManager.js";

export const dragDropManager = {
    isDropZoneActive: false,
    dropZoneElement: null,
    currentHighlightedElement: null,
    fileTransferEffect: 'copy',
    dropZoneConfig: {},
    targetFolderInfo: null,
    enableValidation: true,
    onValidationError: null,
    onValidationWarning: null,

    /**
     * Initialize drag and drop handlers on specified drop zones
     * @param {Array<string>} dropZoneSelectors - CSS selectors for drop zones
     * @param {Object} options - Configuration options
     * @param {Function} options.onFilesDropped - Callback when files are dropped
     * @param {boolean} options.enableVisualFeedback - Whether to show visual feedback (default: true)
     * @param {boolean} options.enableValidation - Whether to validate files (default: true)
     * @param {Object} options.dropZoneConfig - Configuration for specific drop zones
     * @param {Function} options.onTargetFolderDetected - Callback when target folder is detected
     * @param {Function} options.onValidationError - Callback for validation errors
     * @param {Function} options.onValidationWarning - Callback for validation warnings
     */
    init(dropZoneSelectors = [], options = {}) {
        this.onFilesDropped = options.onFilesDropped || (() => {});
        this.enableVisualFeedback = options.enableVisualFeedback !== false;
        this.enableValidation = options.enableValidation !== false;
        this.dropZoneConfig = options.dropZoneConfig || {};
        this.onTargetFolderDetected = options.onTargetFolderDetected || (() => {});
        this.onValidationError = options.onValidationError || (() => {});
        this.onValidationWarning = options.onValidationWarning || (() => {});

        // Create drop zone overlay if visual feedback is enabled
        if (this.enableVisualFeedback) {
            this.createDropZoneOverlay();
        }

        // Register drop zones
        if (dropZoneSelectors.length === 0) {
            // Default drop zones if none specified
            dropZoneSelectors = ['#mainContent', '#documentView', '#navigationPanel', '#fileTree'];
        }

        this.registerDropZones(dropZoneSelectors);

        // Prevent default browser drag behavior at document level
        this.preventDefaultBrowserDragBehavior();

        console.log('[DragDropManager] Initialized with drop zones:', dropZoneSelectors);
    },

    /**
     * Register drop zones with drag and drop event handlers
     * @param {Array<string>} selectors - CSS selectors for drop zones
     */
    registerDropZones(selectors) {
        selectors.forEach(selector => {
            const element = document.querySelector(selector);
            if (element) {
                element.addEventListener('dragover', (e) => this.handleDragOver(e));
                element.addEventListener('dragleave', (e) => this.handleDragLeave(e));
                element.addEventListener('drop', (e) => this.handleDrop(e));
                element.addEventListener('dragend', (e) => this.handleDragEnd(e));
            }
        });
    },

    /**
     * Handle dragover event
     * - Prevents default browser behavior
     * - Shows visual feedback (highlight and cursor)
     * - Sets transfer effect to "copy"
     * - Detects target folder if dragging over file tree
     * @param {DragEvent} event - The drag event
     */
    handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();

        // Check if the dragged items contain files
        if (!event.dataTransfer || !event.dataTransfer.types.includes('Files')) {
            return;
        }

        // Detect target folder if dragging over file tree
        this.detectTargetFolder(event);

        // Phase 8: Check for read-only folder and set appropriate cursor feedback
        if (this.targetFolderInfo) {
            let isReadOnly = false;

            if (typeof this.targetFolderInfo === 'string') {
                isReadOnly = this.targetFolderInfo.toLowerCase().includes('read-only');
            } else if (typeof this.targetFolderInfo === 'object') {
                // Check if folder name or path contains 'read-only'
                const name = this.targetFolderInfo.name || '';
                const path = this.targetFolderInfo.path || '';
                const source = this.targetFolderInfo.source || '';
                isReadOnly = name.toLowerCase().includes('read-only') ||
                             path.toLowerCase().includes('read-only') ||
                             source.includes('readonly');
            }

            if (isReadOnly) {
                event.dataTransfer.dropEffect = 'none';
                console.log('[Phase 8] Prevented drop on read-only folder:', this.targetFolderInfo);
                return;
            }
        }

        // Set transfer effect
        event.dataTransfer.dropEffect = this.fileTransferEffect;

        // Show visual feedback
        if (this.enableVisualFeedback && !this.isDropZoneActive) {
            this.showDropZoneOverlay();
            this.highlightDropZone(event.currentTarget);
        }

        this.isDropZoneActive = true;
    },

    /**
     * Handle dragleave event
     * - Removes visual feedback when leaving drop zone
     * - Only removes feedback if leaving the actual drop zone element
     * @param {DragEvent} event - The drag event
     */
    handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();

        // Only hide if we're leaving the drop zone container itself
        // This prevents hiding when moving over child elements
        if (event.currentTarget === event.target) {
            this.isDropZoneActive = false;

            if (this.enableVisualFeedback) {
                this.hideDropZoneOverlay();
                this.unhighlightDropZone(event.currentTarget);
            }
        }
    },

    /**
     * Handle drop event
     * - Prevents default browser behavior
     * - Extracts files from dataTransfer
     * - Validates files if validation enabled
     * - Calls upload handler with files and target folder information
     * @param {DragEvent} event - The drag event
     */
    handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();

        // Reset state
        this.isDropZoneActive = false;
        if (this.enableVisualFeedback) {
            this.hideDropZoneOverlay();
            this.unhighlightDropZone(event.currentTarget);
            this.unhighlightAllDropZones();
        }

        // Phase 8: Check for read-only mode
        if (this.targetFolderInfo) {
            let isReadOnly = false;

            if (typeof this.targetFolderInfo === 'string') {
                isReadOnly = this.targetFolderInfo.toLowerCase().includes('read-only');
            } else if (typeof this.targetFolderInfo === 'object') {
                // Check if folder name or path contains 'read-only'
                const name = this.targetFolderInfo.name || '';
                const path = this.targetFolderInfo.path || '';
                const source = this.targetFolderInfo.source || '';
                isReadOnly = name.toLowerCase().includes('read-only') ||
                             path.toLowerCase().includes('read-only') ||
                             source.includes('readonly');
            }

            if (isReadOnly) {
                console.warn('[Phase 8] Attempted drop into read-only folder');
                if (window.app && window.app.showNotification) {
                    window.app.showNotification('Cannot upload to read-only folders', 'error');
                }
                return;
            }
        }

        // Extract files from dataTransfer
        let filesToProcess = event.dataTransfer.files;
        if (!filesToProcess || filesToProcess.length === 0) {
            console.warn('[DragDropManager] Drop event received but no files found');
            return;
        }

        // Validate files if validation is enabled
        if (this.enableValidation) {
            const validationResult = fileValidator.validateFiles(filesToProcess);

            console.log('[DragDropManager] File validation result:', validationResult);

            // Handle validation errors
            if (!validationResult.valid) {
                this.onValidationError(validationResult);
                console.warn('[DragDropManager] Files rejected due to validation errors');
                return;
            }

            // Handle validation warnings
            if (validationResult.warnings && validationResult.warnings.length > 0) {
                this.onValidationWarning(validationResult);
            }

            // Use only valid files for upload
            filesToProcess = validationResult.validFiles;
        }

        // Determine target folder information
        const dropTarget = {
            element: event.currentTarget,
            selector: this.getElementSelector(event.currentTarget),
            position: { x: event.clientX, y: event.clientY },
            folderInfo: this.targetFolderInfo
        };

        console.log('[DragDropManager] Files dropped:', {
            fileCount: filesToProcess.length,
            files: Array.from(filesToProcess).map(f => ({ name: f.name, size: f.size, type: f.type })),
            dropTarget: dropTarget.selector,
            targetFolder: this.targetFolderInfo
        });

        // Call the files dropped callback with files and drop target info
        this.onFilesDropped(filesToProcess, dropTarget);
    },

    /**
     * Handle dragend event
     * - Cleans up visual feedback
     * @param {DragEvent} event - The drag event
     */
    handleDragEnd(event) {
        event.preventDefault();
        event.stopPropagation();

        // Reset all visual feedback
        this.isDropZoneActive = false;
        if (this.enableVisualFeedback) {
            this.hideDropZoneOverlay();
            this.unhighlightAllDropZones();
        }

        console.log('[DragDropManager] Drag ended, cleanup complete');
    },

    /**
     * Create the drop zone overlay element
     * Used for displaying visual feedback during drag operations
     */
    createDropZoneOverlay() {
        // Check if overlay already exists
        if (document.getElementById('dropZoneOverlay')) {
            this.dropZoneElement = document.getElementById('dropZoneOverlay');
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'dropZoneOverlay';
        overlay.className = 'drop-zone-overlay hidden';
        overlay.innerHTML = `
            <div class="drop-zone-content">
                <i class="bi bi-cloud-arrow-up"></i>
                <p class="drop-zone-text">Drop files here to upload</p>
                <p class="drop-zone-target hidden" id="dropZoneTarget"></p>
            </div>
        `;

        // Add styles if they don't exist
        if (!document.getElementById('dropZoneStyles')) {
            const style = document.createElement('style');
            style.id = 'dropZoneStyles';
            style.textContent = `
                .drop-zone-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 120, 215, 0.1);
                    border: 2px dashed #0078d7;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    pointer-events: none;
                }

                .drop-zone-overlay.hidden {
                    display: none;
                }

                .drop-zone-content {
                    text-align: center;
                    background: white;
                    padding: 40px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    border: 2px dashed #0078d7;
                }

                .drop-zone-overlay i {
                    font-size: 48px;
                    color: #0078d7;
                    margin-bottom: 16px;
                    display: block;
                }

                .drop-zone-text {
                    margin: 0;
                    color: #333;
                    font-size: 16px;
                    font-weight: 500;
                }

                .drop-zone-highlight {
                    background-color: rgba(0, 120, 215, 0.05) !important;
                    outline: 2px dashed #0078d7 !important;
                    outline-offset: -2px;
                }

                .drop-target-folder {
                    background-color: rgba(0, 120, 215, 0.15) !important;
                    border-left: 3px solid #0078d7 !important;
                }

                .drop-zone-target {
                    font-size: 13px;
                    color: #666;
                    margin-top: 8px;
                    font-style: italic;
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);
        this.dropZoneElement = overlay;
    },

    /**
     * Show the drop zone overlay
     */
    showDropZoneOverlay() {
        if (this.dropZoneElement) {
            this.dropZoneElement.classList.remove('hidden');

            // Phase 8: Show target folder info if available
            const dropZoneTarget = document.getElementById('dropZoneTarget');
            if (dropZoneTarget && this.targetFolderInfo) {
                // Handle both string and object targetFolderInfo
                let folderDisplayName = '';
                if (typeof this.targetFolderInfo === 'string') {
                    folderDisplayName = this.targetFolderInfo;
                } else if (typeof this.targetFolderInfo === 'object' && this.targetFolderInfo.name) {
                    folderDisplayName = this.targetFolderInfo.name;
                } else if (typeof this.targetFolderInfo === 'object' && this.targetFolderInfo.path) {
                    folderDisplayName = this.targetFolderInfo.path || 'root';
                }

                if (folderDisplayName) {
                    dropZoneTarget.textContent = `Uploading to: ${folderDisplayName}`;
                    dropZoneTarget.classList.remove('hidden');
                    console.log(`[Phase 8] Showing drop zone for: ${folderDisplayName}`);
                }
            }
        }
    },

    /**
     * Hide the drop zone overlay
     */
    hideDropZoneOverlay() {
        if (this.dropZoneElement) {
            this.dropZoneElement.classList.add('hidden');

            // Phase 8: Hide target folder info
            const dropZoneTarget = document.getElementById('dropZoneTarget');
            if (dropZoneTarget) {
                dropZoneTarget.classList.add('hidden');
                dropZoneTarget.textContent = '';
            }
            this.targetFolderInfo = null;
        }
    },

    /**
     * Highlight a drop zone element
     * @param {HTMLElement} element - The element to highlight
     */
    highlightDropZone(element) {
        if (element && this.enableVisualFeedback) {
            element.classList.add('drop-zone-highlight');
        }
    },

    /**
     * Remove highlight from a drop zone element
     * @param {HTMLElement} element - The element to unhighlight
     */
    unhighlightDropZone(element) {
        if (element && this.enableVisualFeedback) {
            element.classList.remove('drop-zone-highlight');
        }
    },

    /**
     * Remove highlight from all drop zone elements
     */
    unhighlightAllDropZones() {
        if (this.enableVisualFeedback) {
            document.querySelectorAll('.drop-zone-highlight').forEach(element => {
                element.classList.remove('drop-zone-highlight');
            });
        }
    },

    /**
     * Prevent default browser drag behavior
     * Blocks browser from navigating to dropped files or opening in new tab
     */
    preventDefaultBrowserDragBehavior() {
        // Prevent navigation to dropped files
        document.addEventListener('dragover', (event) => {
            if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
            }
        });

        document.addEventListener('drop', (event) => {
            if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault();
            }
        });
    },

    /**
     * Get a CSS selector for an element
     * Used for identifying which drop zone was targeted
     * @param {HTMLElement} element - The element to get selector for
     * @returns {string} CSS selector string
     */
    getElementSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }
        if (element.className) {
            return `.${element.className.split(' ').join('.')}`;
        }
        return element.tagName.toLowerCase();
    },

    /**
     * Convert FileList to Array
     * @param {FileList} fileList - The FileList to convert
     * @returns {Array<File>} Array of File objects
     */
    fileListToArray(fileList) {
        return Array.from(fileList);
    },

    /**
     * Get detailed information about files
     * @param {FileList|Array<File>} files - Files to analyze
     * @returns {Array<Object>} Array of file information objects
     */
    getFileInfo(files) {
        const fileArray = Array.isArray(files) ? files : this.fileListToArray(files);
        return fileArray.map(file => ({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            lastModifiedDate: new Date(file.lastModified)
        }));
    },

    /**
     * Detect target folder based on drag position
     * Smart detection for file tree items vs content area
     * @param {DragEvent} event - The drag event
     */
    detectTargetFolder(event) {
        // Check if dragging over file tree
        const fileTree = document.getElementById('fileTree');
        if (fileTree && fileTree.contains(event.target)) {
            const folderItem = event.target.closest('.nav-folder-item');
            if (folderItem) {
                this.targetFolderInfo = this.extractFolderInfo(folderItem);
                this.highlightTargetFolder(folderItem);
                this.onTargetFolderDetected(this.targetFolderInfo);
                return;
            }
        }

        // Check if dragging over document view
        const documentView = document.getElementById('documentView');
        if (documentView && documentView.contains(event.target)) {
            // Use current active folder from app state
            this.targetFolderInfo = this.getCurrentFolderInfo();
            this.onTargetFolderDetected(this.targetFolderInfo);
            return;
        }

        // Default: use current folder or root
        this.targetFolderInfo = this.getCurrentFolderInfo();
        this.onTargetFolderDetected(this.targetFolderInfo);
    },

    /**
     * Extract folder information from a folder element
     * @param {HTMLElement} folderElement - The folder item element
     * @returns {Object} Folder information
     */
    extractFolderInfo(folderElement) {
        let folderPath = folderElement.getAttribute('data-folder-path');
        const folderId = folderElement.getAttribute('data-folder-id');
        // Prefer the explicit name: a collapsed chain row's label reads
        // "Parent › Child", and the drop target is the CHILD, so the visible
        // text is not the folder's name. Falls back for rows without the attr.
        const folderName = folderElement.getAttribute('data-folder-name')
            || folderElement.querySelector('.nav-folder-item-text')?.textContent
            || '';

        // If no data attribute, try to extract from the element's position in the tree
        if (!folderPath && folderElement.getAttribute('data-level')) {
            // Build path from parent folders if needed
            folderPath = this.buildPathFromElement(folderElement);
        }

        return {
            path: folderPath || '',
            id: folderId || '',
            name: folderName,
            type: 'folder',
            source: 'file-tree'
        };
    },

    /**
     * Build folder path from element hierarchy
     * @param {HTMLElement} element - The folder element
     * @returns {string} Folder path
     */
    buildPathFromElement(element) {
        const paths = [];
        let current = element;

        // Walk up the tree collecting folder names
        while (current) {
            const folderText = current.querySelector('.nav-folder-item-text');
            if (folderText) {
                paths.unshift(folderText.textContent);
            }
            current = current.parentElement?.closest('.nav-folder-item');
        }

        return paths.join('/');
    },

    /**
     * Get current folder information from global state
     * Falls back to root folder if no current folder
     * @returns {Object} Current folder information
     */
    getCurrentFolderInfo() {
        // Try to get from global app state if available
        if (window.app && window.app.currentFolder) {
            return {
                path: window.app.currentFolder.path,
                name: window.app.currentFolder.name || 'Current Folder',
                type: 'folder',
                source: 'current-view'
            };
        }

        // Fallback to root
        return {
            path: '',
            name: 'Root',
            type: 'folder',
            source: 'root'
        };
    },

    /**
     * Highlight a folder item when it's the drop target
     * @param {HTMLElement} folderElement - The folder element to highlight
     */
    highlightTargetFolder(folderElement) {
        // Remove previous highlight
        if (this.currentHighlightedElement && this.currentHighlightedElement !== folderElement) {
            this.currentHighlightedElement.classList.remove('drop-target-folder');
        }

        // Add highlight to new target
        if (folderElement) {
            folderElement.classList.add('drop-target-folder');
            this.currentHighlightedElement = folderElement;
        }
    },

    /**
     * Add drop zone configuration for specific areas
     * @param {Object} config - Configuration object with zone selectors and properties
     */
    configureDropZone(selector, config) {
        this.dropZoneConfig[selector] = config;
    },

    /**
     * Get drop zone configuration for a selector
     * @param {string} selector - CSS selector
     * @returns {Object|null} Configuration or null if not found
     */
    getDropZoneConfig(selector) {
        return this.dropZoneConfig[selector] || null;
    },

    /**
     * Update file validation configuration
     * @param {Object} config - New validation configuration
     */
    updateValidationConfig(config) {
        fileValidator.updateConfig(config);
    },

    /**
     * Get current file validation configuration
     * @returns {Object} Current validation configuration
     */
    getValidationConfig() {
        return fileValidator.getConfig();
    },

    /**
     * Toggle file validation on/off
     * @param {boolean} enabled - Whether validation should be enabled
     */
    setValidationEnabled(enabled) {
        this.enableValidation = enabled;
    },

    /**
     * Get file validator instance for direct use
     * @returns {Object} The fileValidator module
     */
    getValidator() {
        return fileValidator;
    },

    /**
     * Get upload manager instance for direct use
     * @returns {Object} The uploadManager module
     */
    getUploadManager() {
        return uploadManager;
    },

    /**
     * Initialize upload manager with callbacks
     * @param {Object} callbacks - Upload callbacks
     */
    initializeUploadManager(callbacks) {
        uploadManager.init(callbacks);
    },

    /**
     * Start uploading files using the upload manager
     * @param {Array<File>} files - Files to upload
     * @param {Object} uploadOptions - Upload options
     * @returns {Promise<Array>} Upload results
     */
    async startUpload(files, uploadOptions) {
        try {
            console.log('[DragDropManager] Starting file upload with options:', uploadOptions);
            return await uploadManager.uploadFiles(files, uploadOptions);
        } catch (error) {
            console.error('[DragDropManager] Upload failed:', error);
            throw error;
        }
    }
};
