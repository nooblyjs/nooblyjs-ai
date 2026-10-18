/**
 * @fileoverview The document controller
 * Handles all document viewing, editing, and management functionality
 *
 *@author Digital Techonolgies Team
 * @version 2.0.0
 * @since 2025-10-01
 */

import { navigationController } from "./navigationcontroller.js";
import { userController } from "./usercontroller.js";
import documentViewerState from "./documentViewerState.js";
import navigationState from "./navigationState.js";
import { dragDropManager } from "./dragDropManager.js";
import { uploadManager } from "./uploadManager.js";
import { uploadProgressUI } from "./uploadProgressUI.js";
import { errorHandler } from "./errorHandler.js";
import { clipboardPasteHandler } from "./clipboardPasteHandler.js";
import { pasteIndicator } from "./pasteIndicator.js";
import { WikiAPI } from "./apiClient.js";

export const documentController = {
    isReadOnlyMode: false,
    autoSaveTimer: null,
    lastSavedContent: null,

    init(app) {
        this.app = app;
        uploadProgressUI.init();
        pasteIndicator.init();
        this.initializeDragDrop();
        this.initializeClipboardPaste();
    },

    /**
     * Initialize drag and drop functionality
     */
    initializeDragDrop() {
        // Initialize upload manager first
        dragDropManager.initializeUploadManager({
            onProgress: (progressData) => this.handleUploadProgress(progressData),
            onSuccess: (successData) => this.handleUploadSuccess(successData),
            onError: (errorData) => this.handleUploadError(errorData),
            onComplete: (completeData) => this.handleUploadComplete(completeData),
            onUploadStarted: (startData) => this.handleUploadStarted(startData),
            onRetry: (retryData) => this.handleUploadRetry(retryData),
            onErrorRecovery: (recoveryData) => this.handleUploadErrorRecovery(recoveryData)
        });

        dragDropManager.init(
            ['#mainContent', '#documentView', '#fileTree'],
            {
                enableVisualFeedback: true,
                enableValidation: true,
                onFilesDropped: (files, dropTarget) => this.handleFilesDropped(files, dropTarget),
                onTargetFolderDetected: (folderInfo) => this.handleTargetFolderDetected(folderInfo),
                onValidationError: (validationResult) => this.handleValidationErrors(validationResult),
                onValidationWarning: (validationResult) => this.handleValidationWarnings(validationResult)
            }
        );

        // Configure drop zones with specific behavior
        dragDropManager.configureDropZone('#fileTree', {
            type: 'file-tree',
            detectFolderFromItem: true,
            readOnlyFoldersDisabled: true
        });

        dragDropManager.configureDropZone('#documentView', {
            type: 'content-area',
            useCurrentFolder: true
        });

        dragDropManager.configureDropZone('#mainContent', {
            type: 'main-area',
            useCurrentFolder: true
        });
    },

    /**
     * Initialize clipboard paste functionality
     */
    initializeClipboardPaste() {
        clipboardPasteHandler.init({
            config: {
                enabledFormats: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
                maxImageSize: 50 * 1024 * 1024, // 50 MB
                autoGenerateFilenames: true,
                uploadOnPaste: true,
                showPasteNotification: true
            },
            onImageDetected: (detectionData) => this.handleImageDetected(detectionData),
            onImagePasted: (pasteData) => this.handleImagePasted(pasteData),
            onError: (errorData) => this.handleClipboardError(errorData),
            onPasteAttempt: (attemptData) => this.handlePasteAttempt(attemptData)
        });

        // Enable the paste handler and set wiki app as visible
        clipboardPasteHandler.setEnabled(true);
        clipboardPasteHandler.setWikiAppVisibility(true);

        console.log('[DocumentController] Clipboard paste handler initialized and enabled');
    },

    /**
     * Handle image detected in clipboard
     * @param {Object} detectionData - Detection information
     */
    handleImageDetected(detectionData) {
        const { count } = detectionData;
        console.log(`[DocumentController] Image(s) detected in clipboard: ${count}`);

        // Show visual feedback
        pasteIndicator.showPasteDetected(detectionData);

        if (this.app && this.app.showNotification) {
            this.app.showNotification(
                `${count} image(s) found in clipboard. Pasting...`,
                'info'
            );
        }
    },

    /**
     * Handle image pasted from clipboard
     * @param {Object} pasteData - Paste information
     */
    handleImagePasted(pasteData) {
        const { file, filename, source, index, total } = pasteData;

        console.log(`[DocumentController] Image pasted: ${filename} (${index + 1}/${total}) from ${source}`);

        // Add image to upload progress UI
        uploadProgressUI.addFileUpload({
            uploadId: `clipboard_${Date.now()}_${index}`,
            file: filename,
            size: file.size
        });

        // Get current upload destination
        const spaceId = this.getCurrentSpaceId();
        const folderPath = this.app && this.app.currentFolder ? this.app.currentFolder : '';

        if (!spaceId) {
            console.error('[DocumentController] No space ID available for clipboard paste upload');
            if (this.app && this.app.showNotification) {
                this.app.showNotification('Cannot upload: no space selected', 'error');
            }
            return;
        }

        // Create a file-like object for upload
        const fileInfo = {
            uploadId: `clipboard_${Date.now()}_${index}`,
            file: file,
            size: file.size,
            source: source
        };

        // Trigger upload
        this.uploadPastedImage(fileInfo, spaceId, folderPath);
    },

    /**
     * Upload pasted image file
     * @param {Object} fileInfo - File information
     * @param {number} spaceId - Target space ID
     * @param {string} folderPath - Target folder path
     */
    async uploadPastedImage(fileInfo, spaceId, folderPath) {
        const { uploadId, file } = fileInfo;

        try {
            // Initialize upload manager if not already done
            if (!uploadManager.onProgress) {
                uploadManager.init({
                    onProgress: (progressData) => this.handleUploadProgress(progressData),
                    onSuccess: (successData) => this.handleUploadSuccess(successData),
                    onError: (errorData) => this.handleUploadError(errorData),
                    onComplete: (completeData) => this.handleUploadComplete(completeData),
                    onUploadStarted: (startData) => this.handleUploadStarted(startData),
                    onRetry: (retryData) => this.handleUploadRetry(retryData),
                    onErrorRecovery: (recoveryData) => this.handleUploadErrorRecovery(recoveryData)
                });
            }

            // Upload the file
            const results = await uploadManager.uploadFiles([file], {
                spaceId: spaceId,
                folderPath: folderPath
            });

            console.log('[DocumentController] Pasted image upload results:', results);

        } catch (error) {
            console.error('[DocumentController] Error uploading pasted image:', error);
            uploadProgressUI.markUploadError(uploadId, {
                error: error.message,
                displayMessage: `Failed to upload pasted image: ${error.message}`
            });

            if (this.app && this.app.showNotification) {
                this.app.showNotification(
                    `Failed to upload pasted image: ${error.message}`,
                    'error'
                );
            }
        }
    },

    /**
     * Handle clipboard paste error
     * @param {Object} errorData - Error information
     */
    handleClipboardError(errorData) {
        const { type, message, file } = errorData;

        console.error('[DocumentController] Clipboard paste error:', type, message);

        // Show visual feedback for error
        pasteIndicator.showUploadError({
            error: message,
            filename: file ? file.name : 'Unknown'
        });

        if (this.app && this.app.showNotification) {
            let displayMessage = message;

            if (type === 'no_images') {
                displayMessage = 'No images found in clipboard. You can paste PNG, JPEG, GIF, or WebP images.';
            } else if (type === 'file_too_large') {
                displayMessage = `Image too large (${file ? file.name : 'unknown'}). Maximum size is 50 MB.`;
            } else if (type === 'url_download_failed') {
                displayMessage = `Failed to download image from URL.`;
            }

            this.app.showNotification(displayMessage, 'warning');
        }
    },

    /**
     * Handle paste attempt (user pressed Ctrl+V or Cmd+V)
     * @param {Object} attemptData - Attempt information
     */
    handlePasteAttempt(attemptData) {
        console.log('[DocumentController] Paste attempt detected');
    },

    /**
     * Handle target folder detection during drag
     * Updates UI to show where files will be uploaded
     * @param {Object} folderInfo - Folder information
     */
    handleTargetFolderDetected(folderInfo) {
        const targetElement = document.getElementById('dropZoneTarget');
        if (targetElement && folderInfo) {
            const targetText = folderInfo.name || 'Root';
            targetElement.textContent = `📁 Uploading to: ${targetText}`;
            targetElement.classList.remove('hidden');
        }
    },

    /**
     * Handle validation errors
     * @param {Object} validationResult - Result from file validation
     */
    handleValidationErrors(validationResult) {
        console.error('[DocumentController] File validation failed:', validationResult);

        const validator = dragDropManager.getValidator();
        const errorMessage = validator.formatErrorMessage(validationResult);

        // Show error notification to user
        if (this.app && this.app.showNotification) {
            this.app.showNotification(
                `File validation failed: ${validationResult.rejectedCount} file(s) were rejected.`,
                'error'
            );
        }

        // Log detailed error information
        console.warn('[DocumentController] Validation Details:\n' + errorMessage);

        // You can also display errors in a modal or detailed error panel
        this.showValidationErrorDetails(validationResult);
    },

    /**
     * Handle validation warnings
     * @param {Object} validationResult - Result from file validation
     */
    handleValidationWarnings(validationResult) {
        if (!validationResult.warnings || validationResult.warnings.length === 0) {
            return;
        }

        console.warn('[DocumentController] File validation warnings:', validationResult.warnings);

        const validator = dragDropManager.getValidator();
        const warningMessage = validator.formatWarningMessage(validationResult.warnings);

        // Show warning notification to user
        if (this.app && this.app.showNotification) {
            this.app.showNotification(
                `${validationResult.warnings.length} file(s) have warnings but will be processed.`,
                'warning'
            );
        }

        // Log detailed warning information
        console.info('[DocumentController] Validation Warnings:\n' + warningMessage);
    },

    /**
     * Show detailed validation error information
     * @param {Object} validationResult - Validation result object
     */
    showValidationErrorDetails(validationResult) {
        const validator = dragDropManager.getValidator();
        const errorMessage = validator.formatErrorMessage(validationResult);

        // Format error details
        const errorDetails = {
            totalFiles: validationResult.totalFiles,
            validFiles: validationResult.validCount,
            rejectedFiles: validationResult.rejectedCount,
            totalSize: validator.getReadableFileSize(validationResult.totalSize),
            errors: validationResult.errors
        };

        console.table(errorDetails);
        console.warn('Detailed error messages:\n' + errorMessage);
    },

    /**
     * Handle files dropped into the application
     * @param {FileList|Array<File>} files - Files that were dropped
     * @param {Object} dropTarget - Information about where files were dropped
     */
    async handleFilesDropped(files, dropTarget) {
        console.log('[DocumentController] Handling dropped files:', {
            count: files.length,
            dropTarget: dropTarget.selector,
            targetFolder: dropTarget.folderInfo
        });

        const fileInfo = dragDropManager.getFileInfo(files);
        console.log('[DocumentController] File details:', fileInfo);

        // Store file info for later use in progress UI
        this.droppedFilesInfo = fileInfo;

        // Determine target folder path
        let folderPath = '';
        let folderMessage = '';

        // First, check if files were dropped directly on a folder item in the file tree
        if (dropTarget.folderInfo && dropTarget.folderInfo.path !== undefined && dropTarget.folderInfo.path !== '') {
            folderPath = dropTarget.folderInfo.path;
            folderMessage = ` to folder: "${dropTarget.folderInfo.name}"`;
            console.log('[DocumentController] Uploading to drop target folder:', folderPath);
        }
        // If not, check if there's a current folder (regardless of view type)
        // This handles folder views, cards view, etc.
        else if (this.app && this.app.currentFolder) {
            folderPath = this.app.currentFolder;
            const folderName = this.app.currentFolder.split('/').pop() || 'Root';
            folderMessage = ` to folder: "${folderName}"`;
            console.log('[DocumentController] Uploading to current folder:', folderPath, '(view:', this.app.currentView, ')');
        }
        // Fallback to root if no folder context
        else {
            console.log('[DocumentController] Uploading to root folder (no folder context)');
            console.log('[DocumentController] currentView:', this.app?.currentView);
            console.log('[DocumentController] currentFolder:', this.app?.currentFolder);
        }

        // Show notification that upload is starting
        if (this.app && this.app.showNotification) {
            this.app.showNotification(
                `Uploading ${files.length} file(s)${folderMessage}...`,
                'info'
            );
        }

        // Prepare upload options
        const uploadOptions = {
            spaceId: this.getCurrentSpaceId(),
            folderPath: folderPath
        };

        console.log('[DocumentController] Upload options:', uploadOptions);

        // Start the upload
        try {
            const results = await dragDropManager.startUpload(files, uploadOptions);
            console.log('[DocumentController] Upload results:', results);
        } catch (error) {
            console.error('[DocumentController] Upload failed:', error);
            if (this.app && this.app.showNotification) {
                this.app.showNotification(
                    `Upload failed: ${error.message}`,
                    'error'
                );
            }
        }
    },

    /**
     * Get current space ID for uploads
     * @returns {number} Current space ID
     */
    getCurrentSpaceId() {
        if (this.app && this.app.currentSpace) {
            return this.app.currentSpace.id;
        }
        // Default to space 1 (Personal Space)
        return 1;
    },

    /**
     * Handle upload started event
     * @param {Object} startData - Start data with total files and upload IDs
     */
    handleUploadStarted(startData) {
        console.log('[DocumentController] Upload started:', startData);

        // Show upload progress UI
        uploadProgressUI.show();

        // Add each file to the progress UI
        startData.uploadIds.forEach((uploadId, index) => {
            const fileInfo = this.droppedFilesInfo && this.droppedFilesInfo[index]
                ? this.droppedFilesInfo[index]
                : { name: 'Unknown', size: 0 };

            uploadProgressUI.addFileUpload({
                uploadId,
                file: fileInfo.name || 'Unknown',
                size: fileInfo.size || 0
            });
        });

        if (this.app && this.app.showNotification) {
            this.app.showNotification(
                `Starting upload of ${startData.totalFiles} file(s)...`,
                'info'
            );
        }
    },

    /**
     * Handle upload progress event
     * @param {Object} progressData - Progress information
     */
    handleUploadProgress(progressData) {
        const percentComplete = progressData.percentComplete.toFixed(0);
        console.log(`[DocumentController] Upload progress for ${progressData.file}: ${percentComplete}%`);

        // Update progress UI
        uploadProgressUI.updateFileProgress(progressData.uploadId, {
            loaded: progressData.loaded,
            total: progressData.total,
            percentComplete: progressData.percentComplete
        });
    },

    /**
     * Handle individual upload success
     * @param {Object} successData - Success information
     */
    handleUploadSuccess(successData) {
        console.log('[DocumentController] File uploaded successfully:', successData);

        // Mark as successful in progress UI
        uploadProgressUI.markUploadSuccess(successData.uploadId);

        // Show visual feedback for pasted images
        if (successData.uploadId && successData.uploadId.includes('clipboard')) {
            pasteIndicator.showUploadSuccess({
                filename: successData.file
            });
        }

        // Optionally refresh the file tree or notify the user
        if (navigationController && navigationController.refreshFileTree) {
            navigationController.refreshFileTree();
        }
    },

    /**
     * Handle upload error for a file
     * @param {Object} errorData - Error information
     */
    handleUploadError(errorData) {
        console.error('[DocumentController] Upload error:', errorData);

        // Mark as error in progress UI with full error object
        uploadProgressUI.markUploadError(errorData.uploadId, errorData);

        if (this.app && this.app.showNotification) {
            const displayMessage = errorData.displayMessage || errorData.error || 'Upload failed';
            this.app.showNotification(
                `Failed to upload ${errorData.file}: ${displayMessage}`,
                'error'
            );
        }
    },

    /**
     * Handle upload retry in progress
     * @param {Object} retryData - Retry information
     */
    handleUploadRetry(retryData) {
        const { uploadId, file, attempt, maxAttempts, errorType, retryDelay } = retryData;

        console.log(`[DocumentController] Upload retry: ${file} (${attempt}/${maxAttempts})`);

        // Update progress UI to show retry in progress
        uploadProgressUI.showRetryInProgress(uploadId, { attempt, maxAttempts, retryDelay });

        if (this.app && this.app.showNotification) {
            const delaySeconds = Math.ceil(retryDelay / 1000);
            this.app.showNotification(
                `Retrying ${file}... (attempt ${attempt}/${maxAttempts}) in ${delaySeconds}s`,
                'info'
            );
        }
    },

    /**
     * Handle error recovery with user action options
     * @param {Object} recoveryData - Recovery information
     */
    handleUploadErrorRecovery(recoveryData) {
        const { uploadId, file, classifiedError, recoveryAction, displayMessage } = recoveryData;

        console.log(`[DocumentController] Upload error recovery: ${file} (${classifiedError.type})`);

        // Pass to UI for user interaction
        uploadProgressUI.markUploadError(uploadId, recoveryData);

        if (this.app && this.app.showNotification) {
            this.app.showNotification(
                `${file}: ${classifiedError.title}`,
                'warning'
            );
        }
    },

    /**
     * Handle all uploads complete
     * @param {Object} completeData - Completion data with results
     */
    async handleUploadComplete(completeData) {
        console.log('[DocumentController] All uploads complete:', completeData);

        const { results } = completeData;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        let message = `Upload complete: ${successful} file(s) uploaded`;
        let type = 'success';

        if (failed > 0) {
            message += `, ${failed} file(s) failed`;
            type = 'warning';
        }

        if (this.app && this.app.showNotification) {
            this.app.showNotification(message, type);
        }

        // Granular update: add each successful upload to the tree without full refresh
        for (const result of results) {
            const uploadPath = result.filePath || result.path;
            if (result.success && uploadPath) {
                const fileName = result.fileName || uploadPath.split('/').pop();
                const spaceName = this.app && this.app.currentSpace ? this.app.currentSpace.name : '';
                const fileElement = navigationState.addFileToTree(fileName, uploadPath, spaceName);
                if (fileElement && navigationController && navigationController.bindFileItemEvents_Single) {
                    navigationController.bindFileItemEvents_Single(fileElement);
                }
            }
        }

        // If files were uploaded to a specific folder (not root), switch to folder view to show them
        if (this.app && this.app.currentFolder && this.app.currentFolder.trim() !== '') {
            console.log('[DocumentController] Switching to folder view to display uploaded files:', this.app.currentFolder);
            if (navigationController && navigationController.loadFolderContent) {
                navigationController.loadFolderContent(this.app.currentFolder);
            }
        }

        // Trigger file tree update via Socket.IO if available
        // The socketService manages the socket connection
        try {
            if (this.app && this.app.socketService && this.app.socketService.socket) {
                results.forEach(result => {
                    if (result.success) {
                        this.app.socketService.socket.emit('file-created', {
                            path: result.path,
                            name: result.file,
                            size: result.size
                        });
                    }
                });
            }
        } catch (error) {
            console.warn('[DocumentController] Could not emit file-created event:', error);
        }
    },

    /**
     * Set read-only mode for documents
     * @param {boolean} isReadOnly - Whether documents should be in read-only mode
     */
    setReadOnlyMode(isReadOnly) {
        this.isReadOnlyMode = isReadOnly;
        this.updateEditButtonVisibility();
    },

    /**
     * Update edit button visibility based on read-only mode
     */
    updateEditButtonVisibility() {
        const editBtn = document.getElementById('editBtn');
        if (editBtn) {
            editBtn.style.display = this.isReadOnlyMode ? 'none' : 'inline-block';
        }
    },

    /**
     * Open a document by path and render it
     * @param {string} documentPath - Path to the document
     * @param {string} spaceName - Name of the space
     * @param {number|null} providedSpaceId - Optional space ID provided by caller (e.g., from search results)
     */
    async openDocumentByPath(documentPath, spaceName, providedSpaceId = null) {
        // Show loading placeholder immediately
        this.showLoadingPlaceholder(documentPath, spaceName);

        try {
            // Determine spaceId from: providedSpaceId > currentSpace > lookup by name
            let spaceId = null;

            // First, try provided spaceId if available
            if (providedSpaceId && typeof providedSpaceId === 'number') {
                spaceId = providedSpaceId;
                console.log('[DocumentController] Using provided spaceId:', spaceId);
            }
            // Then try currentSpace if it matches the spaceName
            else if (this.app.currentSpace && this.app.currentSpace.name === spaceName) {
                spaceId = this.app.currentSpace.id;
                console.log('[DocumentController] Using currentSpace:', spaceId);
            }
            // Finally, look up space by name from the spaces list
            else {
                // Fetch spaces if not already loaded
                if (!this.app.spaces || this.app.spaces.length === 0) {
                    try {
                        const spacesResponse = await fetch('/api/spaces');
                        if (spacesResponse.ok) {
                            const spacesData = await spacesResponse.json();
                            // Handle both direct array and wrapped response
                            this.app.spaces = spacesData.data || spacesData;
                        }
                    } catch (error) {
                        console.warn('[DocumentController] Failed to fetch spaces:', error.message);
                    }
                }

                // Find space by name
                if (this.app.spaces && this.app.spaces.length > 0) {
                    const space = this.app.spaces.find(s => s.name === spaceName);
                    if (space) {
                        spaceId = space.id;
                        // Update currentSpace to the found space
                        this.app.currentSpace = space;
                        console.log('[DocumentController] Found space by name:', spaceId);
                    }
                }
            }

            if (!spaceId) {
                throw new Error(`Space "${spaceName}" not found. Available spaces: ${this.app.spaces ? this.app.spaces.map(s => s.name).join(', ') : 'none'}`);
            }

            const encodedPath = encodeURIComponent(documentPath);

            console.log('[DocumentController] Opening document via filing service:', {
                spaceId: spaceId,
                spaceName: spaceName,
                documentPath: documentPath
            });

            // Call new space-specific filing endpoint
            const response = await fetch(
                `/applications/wiki/api/spaces/${spaceId}/file-content/${encodedPath}`,
                {
                    method: 'GET',
                    credentials: 'include'
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to load document: ${response.statusText}`);
            }

            // Parse response based on content-type
            const contentType = response.headers.get('content-type');
            let content, metadata, viewerType;

            if (contentType && contentType.includes('application/json')) {
                // Text file - JSON response with content and metadata
                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.error || 'Failed to load document');
                }

                content = data.content;
                metadata = data.metadata;
                viewerType = metadata?.viewer || 'text';
            } else {
                // Binary file - server returns raw binary
                // Don't store content in memory - viewers use URL directly
                // Determine viewer type from file extension
                const ext = documentPath.split('.').pop().toLowerCase();
                viewerType = this.getViewerTypeFromExtension(ext);

                content = '';  // Empty for binary files - loaded via URL from viewers
                metadata = {
                    size: response.headers.get('content-length') || 0,
                    viewer: viewerType
                };
            }

            const document = {
                title: documentPath.split('/').pop(),
                path: documentPath,
                spaceName: spaceName,
                spaceId: spaceId,
                content: content,
                metadata: {
                    ...metadata,
                    viewer: viewerType,
                    fileName: documentPath.split('/').pop()
                }
            };

            this.app.currentDocument = document;

            // Update URL for deep linking
            if (this.app && !this.app._suppressPushState && this.app.currentSpace) {
                const spaceName = this.app.currentSpace.name;
                const newUrl = `/applications/wiki/${encodeURIComponent(spaceName)}/${documentPath}`;
                if (window.location.pathname !== newUrl) {
                    history.pushState({ type: 'document', spaceName, path: documentPath }, '', newUrl);
                }
            }

            // Track the currently viewed file in documentViewerState
            const viewMode = document.metadata?.viewer || 'markdown';
            documentViewerState.setCurrentFile(documentPath, viewMode, false);

            // Add to tab manager (will create tab or switch to existing)
            const tab = this.app.tabManager.addTab(documentPath, spaceName, {
                title: document.title,
                content: content,
                metadata: document.metadata,
                viewMode: viewMode
            });

            if (tab) {
                // Update tab with full content after loaded
                this.app.tabManager.updateTab(tab.id, content, { metadata: document.metadata, isSaving: true });
            }

            this.showEnhancedDocumentView(document);

            console.log('[DocumentController] Document loaded successfully:', {
                size: metadata?.size,
                provider: metadata?.provider
            });

            // Track document view for recent files
            await this.trackDocumentView(documentPath, spaceName);
        } catch (error) {
            console.error('[DocumentController] Error loading document by path:', error);

            // Fallback: create a basic document structure
            const document = {
                title: documentPath.split('/').pop(),
                path: documentPath,
                spaceName: spaceName,
                content: `# ${documentPath.split('/').pop()}\n\nFailed to load content from ${documentPath}\n\nError: ${error.message}`,
                metadata: { category: 'markdown', viewer: 'markdown' }
            };

            this.app.currentDocument = document;

            // Track the currently viewed file in documentViewerState
            documentViewerState.setCurrentFile(documentPath, 'markdown', false);

            // Still add to tab manager even on error
            const tab = this.app.tabManager.addTab(documentPath, spaceName, {
                title: document.title,
                content: document.content,
                metadata: document.metadata,
                viewMode: 'markdown'
            });

            this.showEnhancedDocumentView(document);
            this.app.showNotification(`Failed to load document: ${error.message}`, 'error');

            // Track document view for recent files (even if failed to load)
            await this.trackDocumentView(documentPath, spaceName);
        }
    },

    /**
     * Show loading placeholder while document is being fetched
     */
    showLoadingPlaceholder(documentPath, spaceName) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        // Show tab bar when viewing documents
        const tabBar = document.getElementById('tabBar');
        if (tabBar) {
            tabBar.classList.remove('hidden');
        }

        // Update header with placeholder
        const docTitle = document.getElementById('currentDocTitle');
        if (docTitle) {
            docTitle.textContent = documentPath.split('/').pop();
        }

        const backToSpace = document.getElementById('docBackToSpace');
        if (backToSpace) {
            backToSpace.textContent = spaceName || 'Space';
        }

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        // Remove any existing content
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        // Create Bootstrap placeholder skeleton
        const placeholderWrapper = document.createElement('div');
        placeholderWrapper.className = 'document-content-wrapper loading-placeholder';
        placeholderWrapper.innerHTML = `
            <div class="placeholder-glow" style="padding: 20px;">
                <div class="placeholder col-12" style="height: 400px; border-radius: 8px;"></div>
            </div>
        `;

        contentElement.appendChild(placeholderWrapper);
    },

    /**
     * Helper: Build the correct filing service URL for a document
     * For text files: returns /file-content endpoint (JSON response)
     * For binary files: returns /download endpoint (raw binary)
     * @param {Object} doc - Document object with spaceId, path
     * @returns {string} The correct API endpoint URL
     */
    getDocumentContentUrl(doc) {
        if (!doc.spaceId || !doc.path) {
            console.warn('[DocumentController] Missing spaceId or path for content URL', doc);
            return null;
        }

        // Use direct filing service for binary files (images, PDFs, videos, audio)
        // This bypasses the wiki middleware and calls the core filing API directly
        const viewerType = doc.metadata?.viewer || this.getViewerTypeFromExtension(doc.path.split('.').pop());
        if (['image', 'pdf', 'video', 'audio'].includes(viewerType)) {
            return WikiAPI.filing.getDirectUrl(doc.spaceId, doc.path);
        }

        // Use wiki middleware for text files (returns JSON with content + metadata)
        const encodedPath = encodeURIComponent(doc.path);
        return `/applications/wiki/api/spaces/${doc.spaceId}/file-content/${encodedPath}`;
    },

    /**
     * Enhanced document viewer that routes to appropriate viewer based on file type
     */
    showEnhancedDocumentView(document) {
        const viewer = document.metadata?.viewer || 'default';

        switch (viewer) {
            case 'pdf':
                this.showPdfViewer(document);
                break;
            case 'image':
                this.showImageViewer(document);
                break;
            case 'video':
                this.showVideoViewer(document);
                break;
            case 'audio':
                this.showAudioViewer(document);
                break;
            case 'text':
                this.showTextViewer(document);
                break;
            case 'code':
                this.showCodeViewer(document);
                break;
            case 'markdown':
                this.showMarkdownViewer(document);
                break;
            default:
                this.showDefaultViewer(document);
                break;
        }

        // Update edit button visibility after showing document
        this.updateEditButtonVisibility();
    },

    /**
     * PDF Viewer Implementation - uses native browser PDF viewer via embed tag
     */
    showPdfViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        const pdfUrl = this.getDocumentContentUrl(doc);
        if (!pdfUrl) {
            this.app.showNotification('Error: Invalid document location', 'error');
            return;
        }
        const downloadUrl = pdfUrl + '?download=true';

        // Remove any existing content after header and add PDF viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper pdf-viewer';
        contentWrapper.innerHTML = `
            <div class="pdf-container" style="width: 100%; height: 700px; border-radius: 8px; overflow: hidden;">
                <embed
                    src="${pdfUrl}"
                    type="application/pdf"
                    width="100%"
                    height="100%"
                    title="${doc.title || 'PDF Document'}"
                />
            </div>
        `;

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        this.setupDownloadButton(downloadUrl, doc.metadata.fileName);

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        this.bindDocumentViewEvents();
    },

    /**
     * Image Viewer Implementation
     */
    showImageViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        const imageUrl = this.getDocumentContentUrl(doc);
        if (!imageUrl) {
            this.app.showNotification('Error: Invalid document location', 'error');
            return;
        }
        const downloadUrl = imageUrl + '?download=true';

        // Remove any existing content after header and add image viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper image-viewer';
        contentWrapper.innerHTML = `
            <div class="image-info-bar" style="display:none">
                <div class="file-info">
                    <i class="fas fa-image" style="color: #17a2b8;"></i>
                    <span class="file-name">${doc.metadata.fileName}</span>
                    <span class="file-size">${this.formatFileSize(doc.metadata.size)}</span>
                </div>
            </div>
            <div class="image-container">
                <img src="${imageUrl}" alt="${doc.metadata.fileName}" class="image-content" />
            </div>
        `;

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        this.setupDownloadButton(downloadUrl, doc.metadata.fileName);

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        this.bindDocumentViewEvents();
    },

    /**
     * Determine viewer type from file extension
     */
    getViewerTypeFromExtension(ext) {
        const ext_lower = ext.toLowerCase();

        // Images
        if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'].includes('.' + ext_lower)) {
            return 'image';
        }

        // PDF
        if (ext_lower === 'pdf') {
            return 'pdf';
        }

        // Video
        if (['.mp4', '.webm', '.avi', '.mov', '.mkv'].includes('.' + ext_lower)) {
            return 'video';
        }

        // Audio
        if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes('.' + ext_lower)) {
            return 'audio';
        }

        // Markdown
        if (['.md', '.markdown'].includes('.' + ext_lower)) {
            return 'markdown';
        }

        // Code
        if (['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cs', '.cpp', '.c', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sh', '.bash', '.json', '.xml', '.yaml', '.yml', '.html', '.css', '.scss', '.less'].includes('.' + ext_lower)) {
            return 'code';
        }

        // Web
        if (['.html', '.htm', '.css', '.scss', '.less'].includes('.' + ext_lower)) {
            return 'web';
        }

        // Text
        if (['.txt', '.csv', '.log', '.rtf'].includes('.' + ext_lower)) {
            return 'text';
        }

        // Default
        return 'text';
    },

    /**
     * Get MIME type for video based on file extension
     */
    getVideoMimeType(filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';

        const mimeTypes = {
            'mp4': 'video/mp4',
            'm4v': 'video/x-m4v',
            'webm': 'video/webm',
            'ogg': 'video/ogg',
            'ogv': 'video/ogg',
            'mov': 'video/quicktime',
            'avi': 'video/x-msvideo',
            'mkv': 'video/x-matroska',
            'flv': 'video/x-flv',
            'wmv': 'video/x-ms-wmv'
        };

        return mimeTypes[ext] || 'video/mp4'; // Default to mp4
    },

    /**
     * Get MIME type for audio based on file extension
     */
    getAudioMimeType(filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';

        const mimeTypes = {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'flac': 'audio/flac',
            'aac': 'audio/aac',
            'm4a': 'audio/mp4',
            'ogg': 'audio/ogg',
            'oga': 'audio/ogg',
            'weba': 'audio/webp',
            'opus': 'audio/opus'
        };

        return mimeTypes[ext] || 'audio/mpeg'; // Default to mp3
    },

    /**
     * Video Viewer Implementation (HTML5)
     */
    showVideoViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        const videoUrl = this.getDocumentContentUrl(doc);
        if (!videoUrl) {
            this.app.showNotification('Error: Invalid document location', 'error');
            return;
        }
        const downloadUrl = videoUrl + '?download=true';
        const mimeType = this.getVideoMimeType(doc.path);

        // Remove any existing content after header and add video viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper video-viewer';
        contentWrapper.innerHTML = `
            <div class="video-info-bar">
                <div class="file-info">
                    <i class="bi bi-play-circle" style="color: #6f42c1;"></i>
                    <span class="file-name">${doc.metadata.fileName}</span>
                    <span class="file-size">${this.formatFileSize(doc.metadata.size)}</span>
                </div>
            </div>
            <div class="video-container">
                <video id="videoPlayer" class="video-content" controls style="width: 100%; max-height: 600px; background-color: #000;">
                    <source src="${videoUrl}" type="${mimeType}">
                    Your browser does not support the video tag.
                </video>
            </div>
        `;

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        this.setupDownloadButton(downloadUrl, doc.metadata.fileName);

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        this.bindDocumentViewEvents();
    },

    /**
     * Audio Viewer Implementation (HTML5)
     */
    showAudioViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        const audioUrl = this.getDocumentContentUrl(doc);
        if (!audioUrl) {
            this.app.showNotification('Error: Invalid document location', 'error');
            return;
        }
        const downloadUrl = audioUrl + '?download=true';
        const mimeType = this.getAudioMimeType(doc.path);

        // Remove any existing content after header and add audio viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper audio-viewer';
        contentWrapper.innerHTML = `
            <div class="audio-info-bar">
                <div class="file-info">
                    <i class="bi bi-music-note-beamed" style="color: #fd7e14;"></i>
                    <span class="file-name">${doc.metadata.fileName}</span>
                    <span class="file-size">${this.formatFileSize(doc.metadata.size)}</span>
                </div>
            </div>
            <div class="audio-container">
                <audio id="audioPlayer" class="audio-content" controls style="width: 100%; margin: 20px 0;">
                    <source src="${audioUrl}" type="${mimeType}">
                    Your browser does not support the audio tag.
                </audio>
            </div>
        `;

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        this.setupDownloadButton(downloadUrl, doc.metadata.fileName);

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        this.bindDocumentViewEvents();
    },

    /**
     * Text File Viewer Implementation
     */
    showTextViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        const lines = doc.content.split('\n');
        const numberedLines = lines.map((line, index) => `${(index + 1).toString().padStart(4, ' ')}: ${this.escapeHtml(line)}`).join('\n');

        // Remove any existing content after header and add text viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper text-viewer';
        contentWrapper.innerHTML = `
            <div class="text-info-bar">
                <div class="file-info">
                    <i class="fas fa-file-text" style="color: #6c757d;"></i>
                    <span class="file-name">${doc.metadata.fileName}</span>
                    <span class="file-size">${this.formatFileSize(doc.metadata.size)}</span>
                    <span class="line-count">${lines.length} lines</span>
                </div>
                <div class="text-controls">
                    <label class="control-label">
                        <input type="checkbox" id="showLineNumbers" checked> Line Numbers
                    </label>
                    <label class="control-label">
                        <input type="checkbox" id="wrapText"> Line Wrap
                    </label>
                </div>
            </div>
            <div class="text-container">
                <pre id="textContent" class="text-content with-numbers">${numberedLines}</pre>
            </div>
        `;

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        const downloadUrl = this.getDocumentContentUrl(doc);
        if (downloadUrl) {
            this.setupDownloadButton(downloadUrl + '?download=true', doc.metadata.fileName);
        }

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        // Bind text viewer controls
        const showLineNumbersCheckbox = document.getElementById('showLineNumbers');
        const wrapTextCheckbox = document.getElementById('wrapText');
        const textContent = document.getElementById('textContent');

        showLineNumbersCheckbox?.addEventListener('change', (e) => {
            if (e.target.checked) {
                textContent.textContent = numberedLines;
                textContent.className = 'text-content with-numbers';
            } else {
                textContent.textContent = doc.content;
                textContent.className = 'text-content';
            }
        });

        wrapTextCheckbox?.addEventListener('change', (e) => {
            if (e.target.checked) {
                textContent.style.whiteSpace = 'pre-wrap';
            } else {
                textContent.style.whiteSpace = 'pre';
            }
        });

        this.bindDocumentViewEvents();
    },

    /**
     * Code Viewer Implementation
     */
    showCodeViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        const language = this.getLanguageFromExtension(doc.metadata.extension);
        const lines = doc.content.split('\n').length;

        // Remove any existing content after header and add code viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper code-viewer';
        contentWrapper.innerHTML = `
            <div class="code-info-bar">
                <div class="file-info">
                    <i class="fas fa-file-code" style="color: #28a745;"></i>
                    <span class="file-name">${doc.metadata.fileName}</span>
                    <span class="file-size">${this.formatFileSize(doc.metadata.size)}</span>
                    <span class="line-count">${lines} lines</span>
                    <span class="language-badge">${language}</span>
                </div>
            </div>
            <div class="code-container">
                <pre class="line-numbers"><code class="language-${language}" id="codeContent">${this.escapeHtml(doc.content)}</code></pre>
            </div>
        `;

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        const downloadUrl = this.getDocumentContentUrl(doc);
        if (downloadUrl) {
            this.setupDownloadButton(downloadUrl + '?download=true', doc.metadata.fileName);
        }

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        // Apply syntax highlighting
        if (typeof Prism !== 'undefined') {
            setTimeout(() => {
                Prism.highlightAllUnder(contentWrapper);
            }, 100);
        }

        this.bindDocumentViewEvents();
    },

    /**
     * Markdown Viewer Implementation
     */
    showMarkdownViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        // Remove any existing content after header and add markdown viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper markdown-viewer';

        if (typeof marked !== 'undefined') {
            // Process wiki-code blocks before rendering
            const processedContent = this.processWikiCodeBlocks(doc.content);
            const renderedContent = parseMarkdown(processedContent);
            contentWrapper.innerHTML = `
                <div class="markdown-content">
                    ${renderedContent}
                </div>
            `;

            // Apply syntax highlighting to code blocks
            if (typeof Prism !== 'undefined') {
                setTimeout(() => Prism.highlightAllUnder(contentWrapper), 100);
            }
        } else {
            contentWrapper.innerHTML = `<pre class="markdown-fallback">${this.escapeHtml(doc.content)}</pre>`;
        }

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        const downloadUrl = this.getDocumentContentUrl(doc);
        if (downloadUrl) {
            this.setupDownloadButton(downloadUrl + '?download=true', doc.metadata.fileName);
        }

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        // Setup TODO checkbox click handlers
        this.setupTodoCheckboxHandlers(doc);

        this.bindDocumentViewEvents();
    },

    /**
     * Default/Fallback Viewer Implementation
     */
    showDefaultViewer(doc) {
        this.app.setActiveView('document');
        this.app.currentView = 'document';

        this.updateDocumentHeader(doc);

        const contentElement = document.querySelector('#documentView .document-container');
        if (!contentElement) return;

        const downloadUrl = this.getDocumentContentUrl(doc);
        if (!downloadUrl) {
            this.app.showNotification('Error: Invalid document location', 'error');
            return;
        }

        // Remove any existing content after header and add default viewer
        const existingContent = contentElement.querySelector('.document-content-wrapper');
        if (existingContent) existingContent.remove();

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'document-content-wrapper default-viewer';
        contentWrapper.innerHTML = `
            <div class="default-content">
                <div class="file-icon-large">
                    <i class="fas fa-file" style="font-size: 4rem; color: #6c757d;"></i>
                </div>
                <div class="file-details">
                    <h3>${doc.metadata.fileName}</h3>
                    <p class="file-meta">
                        <span>Size: ${this.formatFileSize(doc.metadata.size)}</span><br>
                        <span>Modified: ${this.app.formatDate(doc.metadata.modified)}</span><br>
                        <span>Type: ${doc.metadata.extension || 'Unknown'}</span>
                    </p>
                    <p class="file-description">
                        This file type is not supported for inline viewing. You can download it to view with an appropriate application.
                    </p>
                </div>
            </div>
        `;

        contentElement.appendChild(contentWrapper);

        // Setup download button functionality
        this.setupDownloadButton(downloadUrl, doc.metadata.fileName);

        // Setup convert button functionality
        this.setupConvertButton(doc);

        // Setup star button functionality
        this.setupStarButton(doc);

        // Track document visit
        this.trackDocumentVisit(doc, 'viewed');

        this.bindDocumentViewEvents();
    },

    /**
     * Helper method to update document header
     */
    updateDocumentHeader(doc) {
        const docTitle = document.getElementById('currentDocTitle');
        if (docTitle) {
            docTitle.textContent = doc.title;
        }

        const backToSpace = document.getElementById('docBackToSpace');
        if (backToSpace) {
            backToSpace.textContent = doc.spaceName || 'Space';
        }

        // Show/hide edit button based on file type
        this.updateEditButton(doc);
    },

    /**
     * Helper method to setup download button functionality
     */
    setupDownloadButton(downloadUrl, fileName) {
        const downloadBtn = document.getElementById('downloadDocBtn');
        if (downloadBtn) {
            downloadBtn.onclick = (e) => {
                e.preventDefault();
                // Create temporary link for download
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            };
        }
    },

    /**
     * Helper method to setup convert to markdown button functionality
     */
    setupConvertButton(documentData) {
        const convertBtn = document.getElementById('convertToMarkdownBtn');
        if (!convertBtn) return;

        // Check if file is convertible (docx, pptx, xlsx, pdf)
        const ext = documentData.metadata?.extension?.toLowerCase();
        const isConvertible = ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.pdf'].includes(ext);

        if (isConvertible) {
            convertBtn.style.display = 'inline-block';
            convertBtn.onclick = async (e) => {
                e.preventDefault();
                await this.convertToMarkdown(documentData);
            };
        } else {
            convertBtn.style.display = 'none';
        }
    },

    /**
     * Convert document to markdown
     */
    async convertToMarkdown(documentData) {
        try {
            this.app.showNotification('Converting to markdown...', 'info');

            const response = await fetch('/applications/wiki/api/documents/convert-to-markdown', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: documentData.path,
                    spaceName: documentData.spaceName
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                this.app.showNotification('Document converted successfully!', 'success');

                // Granular update: add the new markdown file to the tree
                if (result.markdownPath) {
                    const mdName = result.markdownPath.split('/').pop();
                    const fileElement = navigationState.addFileToTree(mdName, result.markdownPath, documentData.spaceName);
                    if (fileElement && navigationController && navigationController.bindFileItemEvents_Single) {
                        navigationController.bindFileItemEvents_Single(fileElement);
                    }
                }

                // Open the newly created markdown file
                this.openDocumentByPath(result.markdownPath, documentData.spaceName);
            } else {
                throw new Error(result.error || 'Conversion failed');
            }
        } catch (error) {
            console.error('Error converting to markdown:', error);
            this.app.showNotification('Failed to convert document: ' + error.message, 'error');
        }
    },

    /**
     * Helper method to setup star button functionality
     */
    setupStarButton(documentData) {
        const starBtn = document.getElementById('starDocBtn');
        if (starBtn) {
            // Remove existing event listener
            starBtn.onclick = null;

            // Update UI based on current star status
            this.updateStarButtonUI(documentData);

            // Add click handler
            starBtn.onclick = (e) => {
                e.preventDefault();
                this.toggleDocumentStar(documentData);
            };
        }
    },

    /**
     * Setup TODO checkbox click handlers in markdown content
     * This also works for wiki-code rendered content
     */
    setupTodoCheckboxHandlers(doc) {
        // Setup handlers for markdown-rendered content
        const markdownContent = document.querySelector('.markdown-content');
        if (markdownContent) {
            this.bindTodoCheckboxes(markdownContent, doc);
        }

        // Also setup global delegated event handler for wiki-code rendered TODOs
        this.setupWikiCodeTodoHandlers();
    },

    /**
     * Bind TODO checkboxes in a container
     */
    bindTodoCheckboxes(container, doc) {
        // Find all task list items (rendered checkboxes)
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');

        checkboxes.forEach((checkbox, index) => {
            // Find the parent list item
            const listItem = checkbox.closest('li');
            if (!listItem) return;

            // Get the text content to help identify the line in the source
            const taskText = listItem.textContent.trim();

            // Add click handler
            checkbox.addEventListener('click', async (e) => {
                console.log('🔵 [TODO] Checkbox clicked');

                // Prevent default to control the checkbox state ourselves
                e.preventDefault();

                // Store the current state (BEFORE the would-be toggle)
                const wasChecked = checkbox.checked;
                console.log('🔵 [TODO] Checkbox wasChecked:', wasChecked);
                console.log('🔵 [TODO] Task text:', taskText);
                console.log('🔵 [TODO] Document path:', doc.path);
                console.log('🔵 [TODO] Space name:', doc.spaceName);

                // Show loading state
                const originalDisabled = checkbox.disabled;
                checkbox.disabled = true;

                try {
                    // Find the line number in the original content
                    // Use wasChecked (current state) to find the right line
                    const lineNumber = this.findTodoLineNumber(doc.content, taskText, wasChecked);
                    console.log('🔵 [TODO] Found line number:', lineNumber);

                    if (lineNumber === -1) {
                        console.error('❌ [TODO] Could not find TODO item in source');
                        console.log('🔵 [TODO] Document content:', doc.content);
                        this.app.showNotification('Failed to locate TODO item', 'error');
                        checkbox.disabled = originalDisabled;
                        return;
                    }

                    console.log('🔵 [TODO] Calling API to toggle TODO at line', lineNumber);

                    // Call the API to toggle the TODO
                    const response = await fetch('/applications/wiki/api/documents/toggle-todo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: doc.path,
                            spaceName: doc.spaceName,
                            lineNumber: lineNumber
                        })
                    });

                    console.log('🔵 [TODO] API response status:', response.status);
                    const result = await response.json();
                    console.log('🔵 [TODO] API response:', result);

                    if (result.success) {
                        console.log('✅ [TODO] Successfully toggled TODO');

                        // Toggle the checkbox visually on success
                        checkbox.checked = !wasChecked;
                        console.log('🔵 [TODO] Checkbox now checked:', checkbox.checked);

                        // Update the document content in memory
                        doc.content = await this.fetchUpdatedContent(doc.path, doc.spaceName, doc.spaceId);
                        console.log('🔵 [TODO] Updated document content in memory');


                    } else {
                        throw new Error(result.error || 'Failed to toggle TODO');
                    }
                } catch (error) {
                    console.error('❌ [TODO] Error toggling TODO:', error);
                    this.app.showNotification('Failed to toggle TODO: ' + error.message, 'error');
                } finally {
                    checkbox.disabled = originalDisabled;
                    console.log('🔵 [TODO] Checkbox click handler completed');
                }
            });
        });
    },

    /**
     * Find the line number of a TODO item in the source content
     */
    findTodoLineNumber(content, taskText, currentlyChecked) {
        const lines = content.split('\n');

        // Remove common markdown formatting from task text for matching
        const cleanTaskText = taskText
            .replace(/^\s*[-*]\s*\[[ x]\]\s*/i, '')
            .trim()
            .toLowerCase();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if this line contains a TODO checkbox
            const isTodoLine = /^\s*[-*]\s+\[[ x]\]/i.test(line);
            if (!isTodoLine) continue;

            // Extract the task text from the line
            const lineTaskText = line
                .replace(/^\s*[-*]\s*\[[ x]\]\s*/i, '')
                .trim()
                .toLowerCase();

            // Match the task text
            if (lineTaskText === cleanTaskText) {
                return i;
            }
        }

        return -1; // Not found
    },

    /**
     * Fetch updated content from server
     */
    async fetchUpdatedContent(documentPath, spaceName, spaceId) {
        try {
            // Use spaceId if provided, otherwise need to look it up
            let contentUrl;
            if (spaceId) {
                const encodedPath = encodeURIComponent(documentPath);
                contentUrl = `/applications/wiki/api/spaces/${spaceId}/file-content/${encodedPath}`;
            } else {
                // Fallback: try to find spaceId from current document or spaces
                const space = this.app.currentDocument?.spaceId ||
                    (this.app.spaces?.find(s => s.name === spaceName)?.id);
                if (!space) {
                    throw new Error(`Cannot find space for ${spaceName}`);
                }
                const encodedPath = encodeURIComponent(documentPath);
                contentUrl = `/applications/wiki/api/spaces/${space}/file-content/${encodedPath}`;
            }

            const response = await fetch(contentUrl);
            if (!response.ok) throw new Error('Failed to fetch content');

            // This method is only used for text files, so expect JSON
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                return data.content;
            } else {
                console.warn('[DocumentController] Expected JSON response for text file:', documentPath);
                return null;
            }
        } catch (error) {
            console.error('Error fetching updated content:', error);
            return null;
        }
    },

    /**
     * Setup global wiki-code TODO handlers
     * Uses event delegation for dynamically rendered content
     */
    setupWikiCodeTodoHandlers() {
        // Only setup once
        if (this.wikiCodeTodoHandlerSetup) return;
        this.wikiCodeTodoHandlerSetup = true;

        // Use delegated event on document body
        document.body.addEventListener('click', async (e) => {
            const checkbox = e.target;

            // Check if clicked element is a checkbox
            if (checkbox.tagName !== 'INPUT' || checkbox.type !== 'checkbox') return;

            // Check if it has wiki-code data attributes
            const todoPath = checkbox.dataset.todoPath;
            const todoSpace = checkbox.dataset.todoSpace;
            const todoLine = checkbox.dataset.todoLine;

            if (!todoPath || !todoSpace || todoLine === undefined) return;

            // This is a wiki-code TODO checkbox
            e.preventDefault();

            // Store the current state (BEFORE the would-be toggle)
            const wasChecked = checkbox.checked;

            // Show loading state
            const originalDisabled = checkbox.disabled;
            checkbox.disabled = true;

            try {
                // Call the API to toggle the TODO
                const response = await fetch('/applications/wiki/api/documents/toggle-todo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: todoPath,
                        spaceName: todoSpace,
                        lineNumber: parseInt(todoLine)
                    })
                });

                const result = await response.json();

                if (result.success) {
                    // Toggle the checkbox visually
                    checkbox.checked = !wasChecked;


                } else {
                    throw new Error(result.error || 'Failed to toggle TODO');
                }
            } catch (error) {
                console.error('Error toggling wiki-code TODO:', error);
                this.app.showNotification('Failed to toggle TODO: ' + error.message, 'error');
            } finally {
                checkbox.disabled = originalDisabled;
            }
        });
    },

    /**
     * Helper method to update edit button visibility
     */
    updateEditButton(doc) {
        const editBtn = document.getElementById('editDocBtn');
        if (!editBtn) return;

        // Check if file type is editable
        const viewer = doc.metadata?.viewer || 'default';
        const isEditable = ['markdown', 'text', 'code', 'web', 'data'].includes(viewer);

        if (isEditable) {
            editBtn.style.display = 'flex';
        } else {
            editBtn.style.display = 'none';
        }
    },

    /**
     * Bind document view events
     */
    bindDocumentViewEvents() {
        // Edit document button
        const editBtn = document.getElementById('editDocBtn');
        if (editBtn) {
            editBtn.onclick = () => {
                this.editCurrentDocument();
            };
        }

        // Back to space button
        const backBtn = document.getElementById('docBackToSpace');
        if (backBtn) {
            backBtn.onclick = (e) => {
                e.preventDefault();
                this.app.showHome();
            };
        }
    },

    /**
     * Edit current document
     */
    editCurrentDocument() {
        // Get the currently active tab
        const activeTab = this.app.tabManager.getActiveTab();

        if (activeTab) {
            // Prefer currentDocument when it matches the active tab — it has the latest
            // saved content and all required properties (spaceId, etc.)
            const doc = (this.app.currentDocument?.path === activeTab.path)
                ? this.app.currentDocument
                : {
                    title: activeTab.title,
                    path: activeTab.path,
                    spaceName: activeTab.spaceName,
                    spaceId: this.app.currentSpace?.id,
                    content: activeTab.content,
                    metadata: activeTab.metadata
                };

            // Switch to editor view with the currently viewed document
            this.showEditorView(doc);
        } else if (this.app.currentDocument) {
            // Fallback to currentDocument if no active tab
            this.showEditorView(this.app.currentDocument);
        }
    },

    /**
     * Show editor view based on document type
     */
    showEditorView(doc) {
        const viewer = doc.metadata?.viewer || 'default';

        switch (viewer) {
            case 'markdown':
                this.showMarkdownEditor(doc);
                break;
            case 'text':
            case 'code':
            case 'web':
            case 'data':
                this.showTextCodeEditor(doc);
                break;
            default:
                this.app.showNotification('This file type cannot be edited', 'warning');
                return;
        }
    },

    /**
     * Markdown Editor Implementation using Toast UI Editor
     */
    async showMarkdownEditor(doc) {
        this.app.setActiveView('editor');
        this.app.currentView = 'editor';
        this.app.isEditing = true;

        // Track edit mode in documentViewerState
        documentViewerState.setCurrentFile(doc.path, 'markdown', true);

        // Update editor breadcrumb
        const spaceLink = document.getElementById('editorBackToSpace');
        const titleElement = document.getElementById('editorDocTitle');

        if (spaceLink) {
            spaceLink.textContent = doc.spaceName || 'Space';
            spaceLink.onclick = (e) => {
                e.preventDefault();
                this.app.showHome();
            };
        }

        if (titleElement) {
            titleElement.textContent = doc.title || doc.metadata?.fileName || 'Untitled';
        }

        // Show markdown editor pane
        document.getElementById('markdownEditor')?.classList.remove('hidden');

        // Fetch the latest content from the server
        let freshContent = doc.content || '';
        try {
            const contentUrl = this.getDocumentContentUrl(doc);
            if (contentUrl) {
                const response = await fetch(contentUrl);
                if (response.ok) {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const data = await response.json();
                        freshContent = data.content || '';
                        // Update the doc object with fresh content
                        doc.content = freshContent;
                    }
                }
            }
        } catch (error) {
            console.warn('[DocumentController] Failed to fetch fresh content, using cached content:', error);
        }

        // Initialize or update Toast UI Editor
        const editorEl = document.getElementById('editorTextarea');
        if (editorEl) {
            // Store document reference for later use
            this.currentEditingDoc = doc;

            // Destroy existing editor if any
            if (this.toastEditorInstance) {
                this.toastEditorInstance.destroy();
                this.toastEditorInstance = null;
            }

            try {
                // Initialize Toast UI Editor
                this.toastEditorInstance = new toastui.Editor({
                    el: editorEl,
                    height: '100%',
                    initialEditType: 'markdown',
                    previewStyle: 'vertical',
                    initialValue: doc.content || '',
                    toolbarItems: [
                        ['heading', 'bold', 'italic', 'strike'],
                        ['hr', 'quote'],
                        ['ul', 'ol', 'task', 'indent', 'outdent'],
                        ['table', 'image', 'link'],
                        ['code', 'codeblock'],
                        ['scrollSync']
                    ]
                });

                // Update on changes
                this.toastEditorInstance.on('change', () => {
                    this.app.tabManager.markTabDirty(this.currentEditingDoc.path);
                });

                console.log('[DocumentController] Toast UI Editor initialized successfully');
            } catch (error) {
                console.error('[DocumentController] Error initializing Toast UI Editor:', error);
            }
        }

        // Bind editor events (save and close buttons)
        this.bindEditorEvents(doc);

        // Start auto-save timer
        this.startAutoSave(doc);
    },

    /**
     * Text/Code Editor Implementation
     */
    async showTextCodeEditor(doc) {
        this.app.setActiveView('editor');
        this.app.currentView = 'editor';
        this.app.isEditing = true;

        // Track edit mode in documentViewerState
        const viewMode = doc.metadata?.viewer || 'text';
        documentViewerState.setCurrentFile(doc.path, viewMode, true);

        // Update editor breadcrumb
        const spaceLink = document.getElementById('editorBackToSpace');
        const titleElement = document.getElementById('editorDocTitle');

        if (spaceLink) {
            spaceLink.textContent = doc.spaceName || 'Space';
            spaceLink.onclick = (e) => {
                e.preventDefault();
                this.app.showHome();
            };
        }

        if (titleElement) {
            titleElement.textContent = doc.title || doc.metadata?.fileName || 'Untitled';
        }

        // Fetch the latest content from the server
        let freshContent = doc.content || '';
        try {
            const contentUrl = this.getDocumentContentUrl(doc);
            if (contentUrl) {
                const response = await fetch(contentUrl);
                if (response.ok) {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const data = await response.json();
                        freshContent = data.content || '';
                        // Update the doc object with fresh content
                        doc.content = freshContent;
                    }
                }
            }
        } catch (error) {
            console.warn('[DocumentController] Failed to fetch fresh content, using cached content:', error);
        }

        const textarea = document.getElementById('editorTextarea');
        if (textarea) {
            textarea.value = doc.content || '';
            // Set appropriate styling for code
            textarea.style.fontFamily = 'Monaco, Consolas, "Courier New", monospace';
            textarea.style.fontSize = '14px';
            textarea.style.lineHeight = '1.5';
            // Auto-resize textarea
            this.autoResizeTextarea(textarea);
        }

        // Show editor pane
        document.getElementById('markdownEditor')?.classList.remove('hidden');

        // Bind editor events
        this.bindEditorEvents(doc);

        // Start auto-save timer
        this.startAutoSave(doc);
    },

    /**
     * Auto-resize textarea to fit content
     */
    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, window.innerHeight * 0.7) + 'px';

        // Add input listener for dynamic resizing
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, window.innerHeight * 0.7) + 'px';
        });
    },

    /**
     * Bind editor events
     */
    bindEditorEvents(doc) {
        // Save button
        const saveBtn = document.getElementById('saveDoc');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                const saved = await this.saveDocument(doc);
                if (saved) {
                    // Close editor and return to document view
                    // Use the updated currentDocument which now has the saved content
                    this.closeEditor(this.app.currentDocument);
                }
            };
        }

        // Close button
        const closeBtn = document.getElementById('closeEditor');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeEditor(doc);
        }

        // Auto-save on Ctrl+S
        document.addEventListener('keydown', (e) => {
            if (this.app.isEditing && (e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveDocument(doc);
            }
        });

        // Bind toolbar buttons for markdown
        if (doc.metadata?.viewer === 'markdown') {
            this.bindMarkdownToolbar();
        }

        // Track changes for unsaved indicator
        this.trackContentChanges();
    },

    /**
     * Bind markdown toolbar functionality
     */
    bindMarkdownToolbar() {
        const textarea = document.getElementById('editorTextarea');
        if (!textarea) return;

        // Bold button
        document.getElementById('boldBtn')?.addEventListener('click', () => {
            this.wrapSelection('**', '**', 'bold text');
        });

        // Italic button
        document.getElementById('italicBtn')?.addEventListener('click', () => {
            this.wrapSelection('*', '*', 'italic text');
        });

        // Code button
        document.getElementById('codeBtn')?.addEventListener('click', () => {
            this.wrapSelection('`', '`', 'code');
        });

        // Heading buttons
        document.getElementById('h1Btn')?.addEventListener('click', () => {
            this.insertHeading(1);
        });

        document.getElementById('h2Btn')?.addEventListener('click', () => {
            this.insertHeading(2);
        });

        document.getElementById('h3Btn')?.addEventListener('click', () => {
            this.insertHeading(3);
        });

        // List buttons
        document.getElementById('listBtn')?.addEventListener('click', () => {
            this.insertList('- ');
        });

        document.getElementById('numberedListBtn')?.addEventListener('click', () => {
            this.insertList('1. ');
        });

        // Link button
        document.getElementById('linkBtn')?.addEventListener('click', () => {
            this.insertLink();
        });
    },

    /**
     * Helper method to wrap selected text
     */
    wrapSelection(before, after, placeholder) {
        const textarea = document.getElementById('editorTextarea');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);
        const replacement = selectedText || placeholder;

        const newText = textarea.value.substring(0, start) +
                        before + replacement + after +
                        textarea.value.substring(end);

        textarea.value = newText;

        // Set cursor position
        const newCursorPos = start + before.length + replacement.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
    },

    /**
     * Insert heading
     */
    insertHeading(level) {
        const textarea = document.getElementById('editorTextarea');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end) || 'Heading';

        const hashmarks = '#'.repeat(level);
        const replacement = `${hashmarks} ${selectedText}`;

        // If we're not at the start of a line, add a newline before
        const beforeCursor = textarea.value.substring(0, start);
        const needsNewlineBefore = beforeCursor.length > 0 && !beforeCursor.endsWith('\n');

        const newText = textarea.value.substring(0, start) +
                        (needsNewlineBefore ? '\n' : '') +
                        replacement +
                        textarea.value.substring(end);

        textarea.value = newText;

        // Set cursor at end of heading
        const newCursorPos = start + (needsNewlineBefore ? 1 : 0) + replacement.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
    },

    /**
     * Insert list
     */
    insertList(prefix) {
        const textarea = document.getElementById('editorTextarea');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const selectedText = textarea.value.substring(start, textarea.selectionEnd) || 'List item';

        const lines = selectedText.split('\n');
        const listItems = lines.map(line => prefix + (line.trim() || 'List item')).join('\n');

        // If we're not at the start of a line, add a newline before
        const beforeCursor = textarea.value.substring(0, start);
        const needsNewlineBefore = beforeCursor.length > 0 && !beforeCursor.endsWith('\n');

        const newText = textarea.value.substring(0, start) +
                        (needsNewlineBefore ? '\n' : '') +
                        listItems +
                        textarea.value.substring(textarea.selectionEnd);

        textarea.value = newText;

        // Set cursor at end of list
        const newCursorPos = start + (needsNewlineBefore ? 1 : 0) + listItems.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
    },

    /**
     * Insert link
     */
    insertLink() {
        const textarea = document.getElementById('editorTextarea');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end) || 'link text';

        const linkText = `[${selectedText}](url)`;

        const newText = textarea.value.substring(0, start) +
                        linkText +
                        textarea.value.substring(end);

        textarea.value = newText;

        // Select the URL part for easy editing
        const urlStart = start + selectedText.length + 3; // position after ](
        const urlEnd = urlStart + 3; // length of 'url'
        textarea.setSelectionRange(urlStart, urlEnd);
        textarea.focus();
    },

    /**
     * Track content changes
     */
    trackContentChanges() {
        const textarea = document.getElementById('editorTextarea');
        const titleInput = document.getElementById('docTitle');
        const statusElement = document.getElementById('editingStatus');

        if (!textarea || !titleInput || !statusElement) return;

        let hasUnsavedChanges = false;

        const updateStatus = () => {
            if (hasUnsavedChanges) {
                statusElement.textContent = 'Unsaved changes';
                statusElement.style.display = 'block';
            } else {
                statusElement.style.display = 'none';
            }
        };

        const markAsChanged = () => {
            hasUnsavedChanges = true;
            updateStatus();
        };

        this.app.markAsSaved = () => {
            hasUnsavedChanges = false;
            updateStatus();
        };

        textarea.addEventListener('input', markAsChanged);
        titleInput.addEventListener('input', markAsChanged);

        updateStatus();
    },

    /**
     * Save document
     */
    async saveDocument(doc, isAutoSave = false) {
        // Get content from Toast UI Editor if available
        let content;

        if (this.toastEditorInstance) {
            content = this.toastEditorInstance.getMarkdown();
        } else {
            const editorEl = document.getElementById('editorTextarea');
            if (!editorEl) {
                console.error('Editor element not found');
                return false;
            }
            content = editorEl.textContent || '';
        }

        // Skip auto-save if content hasn't changed
        if (isAutoSave && content === this.lastSavedContent) {
            return true;
        }

        try {
            const contentUrl = this.getDocumentContentUrl(doc);
            if (!contentUrl) {
                throw new Error('Invalid document location - missing spaceId or path');
            }

            const response = await fetch(contentUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: content
                })
            });

            const result = await response.json();

            if (result.success) {
                // Update current document
                this.app.currentDocument = {
                    ...doc,
                    content: content
                };

                // Store last saved content for auto-save comparison
                this.lastSavedContent = content;

                // Keep active tab in sync so re-opening the editor shows fresh content
                const activeTab = this.app.tabManager?.getActiveTab();
                if (activeTab && activeTab.path === doc.path) {
                    this.app.tabManager.updateTab(activeTab.id, content, {});
                }

                // Update last saved timestamp
                this.updateLastSavedTime();

                // Show notification only for manual saves
                if (!isAutoSave) {
                    this.app.showNotification('Document saved successfully!', 'success');
                }

                // Mark as saved to hide unsaved changes indicator
                if (this.app.markAsSaved) {
                    this.app.markAsSaved();
                }

                // Save doesn't change tree structure - no tree refresh needed

                return true;
            } else {
                throw new Error(result.message || 'Failed to save document');
            }
        } catch (error) {
            console.error('Error saving document:', error);
            if (!isAutoSave) {
                this.app.showNotification('Failed to save document: ' + error.message, 'error');
            }
            return false;
        }
    },

    /**
     * Update last saved time indicator
     */
    updateLastSavedTime() {
        const indicator = document.getElementById('lastSavedIndicator');
        const timeElement = document.getElementById('lastSavedTime');

        if (indicator && timeElement) {
            indicator.style.display = 'inline';
            const now = new Date();
            timeElement.textContent = `Saved at ${now.toLocaleTimeString()}`;
        }
    },

    /**
     * Start auto-save timer
     */
    startAutoSave(doc) {
        // Clear any existing timer
        this.stopAutoSave();

        // Set initial last saved content
        this.lastSavedContent = doc.content || '';

        // Start auto-save timer (every 60 seconds = 1 minute)
        this.autoSaveTimer = setInterval(async () => {
            if (this.app.isEditing && this.app.currentDocument) {
                await this.saveDocument(this.app.currentDocument, true);
            }
        }, 10000); // 10000 milliseconds = 10 seconds

        console.log('Auto-save enabled: saving every 1 minute');
    },

    /**
     * Stop auto-save timer
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
            this.lastSavedContent = null;
            console.log('Auto-save disabled');
        }
    },

    /**
     * Exit editor mode without returning to previous document
     */
    exitEditorMode() {
        if (this.app.isEditing) {
            this.app.isEditing = false;

            // Stop auto-save
            this.stopAutoSave();

            // Remove event listeners
            document.removeEventListener('keydown', this.app.handleKeyDown);

            // Clear editor content
            const titleInput = document.getElementById('docTitle');
            const textarea = document.getElementById('editorTextarea');

            if (titleInput) titleInput.value = '';
            if (textarea) textarea.value = '';

            // Clear current document reference
            this.app.currentDocument = null;
        }
    },

    /**
     * Close editor
     */
    closeEditor(doc) {
        this.app.isEditing = false;

        // Stop auto-save
        this.stopAutoSave();

        // Destroy Toast UI Editor instance
        if (this.toastEditorInstance) {
            this.toastEditorInstance.destroy();
            this.toastEditorInstance = null;
        }

        // Remove event listeners
        document.removeEventListener('keydown', this.app.handleKeyDown);

        // Prefer currentDocument (has latest saved content) over the original doc reference
        const docToShow = this.app.currentDocument || doc;

        // Update documentViewerState to reflect exit from edit mode
        if (docToShow) {
            const viewMode = docToShow.metadata?.viewer || 'markdown';
            documentViewerState.setCurrentFile(docToShow.path, viewMode, false);
        }

        // Return to document view
        this.showEnhancedDocumentView(docToShow);
    },

    /**
     * Track document view for recent files
     */
    async trackDocumentView(documentPath, spaceName) {
        try {
            // Ensure we have activity data
            userController.ensureActivityData();

            // Remove existing entry if it exists (to move it to the top)
            this.app.data.recent = this.app.data.recent.filter(item =>
                !(item.path === documentPath && item.space === spaceName)
            );

            // Add new entry at the beginning
            const activity = {
                path: documentPath,
                space: spaceName,
                lastVisited: new Date().toISOString(),
                title: documentPath.split('/').pop()
            };

            this.app.data.recent.unshift(activity);

            // Keep only last 10 items
            this.app.data.recent = this.app.data.recent.slice(0, 10);

            // Save to server
            await userController.saveActivityToServer();

        } catch (error) {
            console.error('Error tracking document view:', error);
        }
    },

    /**
     * Track document visit
     */
    async trackDocumentVisit(document, action = 'viewed') {
        try {
            const response = await fetch('/applications/wiki/api/user/visit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: document.path,
                    spaceName: document.spaceName,
                    title: document.title,
                    action: action
                })
            });

            if (response.ok) {
                const result = await response.json();
                this.app.userActivity.recent = result.recent;
            }
        } catch (error) {
            console.error('Error tracking document visit:', error);
        }
    },

    /**
     * Toggle document star status
     */
    async toggleDocumentStar(documentData) {
        if (!documentData) return;

        const isStarred = this.isDocumentStarred(documentData);
        const action = isStarred ? 'unstar' : 'star';

        try {
            const response = await fetch('/applications/wiki/api/user/star', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: documentData.path,
                    spaceName: documentData.spaceName,
                    title: documentData.title,
                    action: action
                })
            });

            if (response.status === 401) {
                this.app.showNotification('Please log in to star documents', 'error');
                return;
            }

            const result = await response.json();

            if (result.success) {
                this.app.userActivity.starred = result.starred;
                this.app.data.starred = result.starred; // Sync with data.starred
                this.updateStarButtonUI(documentData);
                this.app.showNotification(
                    isStarred ? 'Document unstarred' : 'Document starred',
                    'success'
                );

                // Reload starred files if on starred view
                if (this.app.currentView === 'starred' || this.app.currentView === 'home') {
                    this.app.loadStarredFiles();
                }
            } else {
                throw new Error(result.error || 'Failed to update star status');
            }
        } catch (error) {
            console.error('Error toggling star:', error);
            this.app.showNotification('Failed to update star status: ' + error.message, 'error');
        }
    },

    /**
     * Check if document is starred
     */
    isDocumentStarred(documentData) {
        if (!this.app.userActivity || !this.app.userActivity.starred) return false;
        return this.app.userActivity.starred.some(item =>
            item.path === documentData.path && item.spaceName === documentData.spaceName
        );
    },

    /**
     * Update star button UI
     */
    updateStarButtonUI(documentData) {
        const starBtn = document.getElementById('starDocBtn');
        const starText = starBtn?.querySelector('.star-text');

        if (!starBtn || !starText) return;

        const isStarred = this.isDocumentStarred(documentData);

        if (isStarred) {
            starBtn.classList.add('starred');
            starText.textContent = 'Starred';
        } else {
            starBtn.classList.remove('starred');
            starText.textContent = 'Star';
        }
    },

    /**
     * Utility Methods
     */

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    getLanguageFromExtension(extension) {
        const languageMap = {
            'js': 'javascript',
            'jsx': 'jsx',
            'ts': 'typescript',
            'tsx': 'tsx',
            'py': 'python',
            'rb': 'ruby',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'cs': 'csharp',
            'php': 'php',
            'go': 'go',
            'rs': 'rust',
            'swift': 'swift',
            'kt': 'kotlin',
            'sh': 'bash',
            'yml': 'yaml',
            'yaml': 'yaml',
            'json': 'json',
            'xml': 'xml',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'sql': 'sql',
            'md': 'markdown',
            'markdown': 'markdown'
        };
        return languageMap[extension.replace('.', '')] || extension.replace('.', '');
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    /**
     * Process wiki-code blocks in markdown content
     * Executes javascript code blocks with 'wiki-code' language tag and replaces them with the returned HTML
     */
    processWikiCodeBlocks(content) {
        // Match code blocks with wiki-code language tag
        const wikiCodeRegex = /```wiki-code\s*\n([\s\S]*?)```/g;

        return content.replace(wikiCodeRegex, (match, code) => {
            try {
                // Create a function from the code and execute it
                // Wrap the code in a return statement if it's just an expression
                const trimmedCode = code.trim();

                // Create and execute the function
                const func = new Function('return ' + trimmedCode);
                const result = func()();

                // Return the result (should be a string)
                return result || '';
            } catch (error) {
                console.error('Error executing wiki-code block:', error);
                return `<div class="alert alert-danger">
                    <strong>Wiki-code execution error:</strong> ${this.escapeHtml(error.message)}
                </div>`;
            }
        });
    },

    /**
     * Reload the currently viewed file content
     * Called when file update event is received from event bus
     * Updates the document viewer with fresh content while maintaining view mode
     */
    async reloadCurrentFileContent() {
        const currentPath = documentViewerState.getCurrentFilePath();

        if (!currentPath || !this.app.currentDocument) {
            console.warn('[DocumentController] No file currently being viewed');
            return;
        }

        try {
            // Fetch updated file content
            const contentUrl = this.getDocumentContentUrl(this.app.currentDocument);
            if (!contentUrl) {
                throw new Error('Invalid document location - missing spaceId or path');
            }

            const response = await fetch(contentUrl);

            if (!response.ok) {
                throw new Error(`Failed to reload document: ${response.statusText}`);
            }

            // Handle both JSON (text files) and binary (images, PDFs, etc.) responses
            const contentType = response.headers.get('content-type');
            let updatedDoc;

            if (contentType && contentType.includes('application/json')) {
                // Text file response
                const data = await response.json();
                const { content, metadata } = data;

                updatedDoc = {
                    title: currentPath.split('/').pop(),
                    path: currentPath,
                    spaceName: this.app.currentDocument.spaceName,
                    spaceId: this.app.currentDocument.spaceId,
                    content: content,
                    metadata: metadata
                };
            } else {
                // Binary file response - no content to store, loaded via URL
                const ext = currentPath.split('.').pop().toLowerCase();
                const viewerType = this.getViewerTypeFromExtension(ext);

                updatedDoc = {
                    title: currentPath.split('/').pop(),
                    path: currentPath,
                    spaceName: this.app.currentDocument.spaceName,
                    spaceId: this.app.currentDocument.spaceId,
                    content: '',
                    metadata: {
                        viewer: viewerType,
                        size: response.headers.get('content-length') || 0,
                        fileName: currentPath.split('/').pop()
                    }
                };
            }

            this.app.currentDocument = updatedDoc;

            // Re-render with the appropriate viewer
            this.showEnhancedDocumentView(updatedDoc);

            // Show bootstrap alert that file was updated
            const alertContainer = document.querySelector('#documentView .document-container');
            if (alertContainer) {
                const alertHtml = `
                    <div class="alert alert-info alert-dismissible fade show" role="alert" style="margin-bottom: 20px; animation: slideInDown 0.3s ease-in-out;">
                        <i class="bi bi-info-circle-fill" style="margin-right: 8px;"></i>
                        <strong>File Updated!</strong> The file content has been reloaded with the latest changes.
                        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                    </div>
                `;

                // Insert alert at the top of the document container
                const existingAlert = alertContainer.querySelector('.alert-info');
                if (existingAlert) {
                    existingAlert.remove();
                }

                alertContainer.insertAdjacentHTML('afterbegin', alertHtml);

                // Auto-dismiss alert after 5 seconds
                setTimeout(() => {
                    const alert = alertContainer.querySelector('.alert-info');
                    if (alert) {
                        const bsAlert = new bootstrap.Alert(alert);
                        bsAlert.close();
                    }
                }, 5000);
            }
        } catch (error) {
            console.error('Error reloading document content:', error);

            // Show error alert
            const alertContainer = document.querySelector('#documentView .document-container');
            if (alertContainer) {
                const alertHtml = `
                    <div class="alert alert-danger alert-dismissible fade show" role="alert" style="margin-bottom: 20px; animation: slideInDown 0.3s ease-in-out;">
                        <i class="bi bi-exclamation-triangle-fill" style="margin-right: 8px;"></i>
                        <strong>Error!</strong> Failed to reload file content: ${this.escapeHtml(error.message)}
                        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                    </div>
                `;

                const existingAlert = alertContainer.querySelector('.alert-danger');
                if (existingAlert) {
                    existingAlert.remove();
                }

                alertContainer.insertAdjacentHTML('afterbegin', alertHtml);

                // Auto-dismiss error alert after 7 seconds
                setTimeout(() => {
                    const alert = alertContainer.querySelector('.alert-danger');
                    if (alert) {
                        const bsAlert = new bootstrap.Alert(alert);
                        bsAlert.close();
                    }
                }, 7000);
            }

            this.app.showNotification('Failed to reload file content', 'error');
        }
    },

    /**
     * Handle file update conflict when user is in edit mode
     * Shows a confirmation dialog asking if user wants to reload the file
     * If yes: closes editor and reloads content
     * If no: keeps user in edit mode
     * @return {void}
     */
    handleEditModeConflict() {
        // Create modal HTML for the conflict dialog
        const conflictHtml = `
            <div class="modal fade" id="editConflictModal" tabindex="-1" role="dialog" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered" role="document">
                    <div class="modal-content">
                        <div class="modal-header border-bottom-0 pb-0">
                            <h5 class="modal-title" id="editConflictLabel">
                                <i class="bi bi-exclamation-triangle-fill" style="color: #ff9800; margin-right: 8px;"></i>
                                File Changed
                            </h5>
                            <button type="button" class="btn-close" id="closeConflictModal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p>The file you are editing has been changed by another source.</p>
                            <p><strong>Would you like to reload the file?</strong></p>
                            <small class="text-muted">If you reload, your unsaved changes will be lost. If you continue editing, you may overwrite the external changes.</small>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="continueEditingBtn">Continue Editing</button>
                            <button type="button" class="btn btn-secondary" id="reloadFileBtn">Reload File</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove any existing conflict modal and backdrops
        const existingModal = document.getElementById('editConflictModal');
        if (existingModal) {
            existingModal.remove();
        }
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', conflictHtml);

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('editConflictModal'), {
            keyboard: false,
            backdrop: 'static'
        });
        modal.show();

        // Helper function to properly close modal and clean up
        const closeModalAndCleanup = () => {
            modal.hide();
            // Remove modal from DOM after hide animation completes
            setTimeout(() => {
                const modalEl = document.getElementById('editConflictModal');
                if (modalEl) {
                    modalEl.remove();
                }
                // Remove any lingering backdrops
                document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            }, 300);
        };

        // Handle continue editing button click
        const continueBtn = document.getElementById('continueEditingBtn');
        if (continueBtn) {
            continueBtn.onclick = (e) => {
                e.preventDefault();
                closeModalAndCleanup();
            };
        }

        // Handle close button click
        const closeBtn = document.getElementById('closeConflictModal');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.preventDefault();
                closeModalAndCleanup();
            };
        }

        // Handle reload button click
        const reloadBtn = document.getElementById('reloadFileBtn');
        if (reloadBtn) {
            reloadBtn.onclick = async () => {
                // Close the modal and clean up
                closeModalAndCleanup();

                // Close the editor (returns to document view)
                this.closeEditor();

                // Reload the document content
                await this.reloadCurrentFileContent();
            };
        }
    }
};
