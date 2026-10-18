/**
 * @fileoverview Upload Progress UI Module
 * Displays real-time upload progress with visual feedback
 * Shows progress bars, file status, speed, and ETA
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-01
 */

export const uploadProgressUI = {
    // DOM elements
    uploadPanel: null,
    fileListContainer: null,
    isVisible: false,

    // Track active uploads
    activeUploads: new Map(), // uploadId -> upload state
    startTime: null,
    totalSize: 0,
    totalLoaded: 0,

    /**
     * Initialize the upload progress UI
     * @param {Object} options - Configuration options
     */
    init(options = {}) {
        console.log('[UploadProgressUI] Initializing upload progress UI');
        this.createUploadPanel();
    },

    /**
     * Create the upload progress panel DOM structure
     */
    createUploadPanel() {
        // Check if panel already exists
        if (document.getElementById('uploadProgressPanel')) {
            this.uploadPanel = document.getElementById('uploadProgressPanel');
            return;
        }

        // Create panel HTML
        const panelHTML = `
            <div id="uploadProgressPanel" class="upload-progress-panel hidden">
                <div class="upload-panel-header">
                    <div class="upload-panel-title">
                        <i class="bi bi-cloud-arrow-up"></i>
                        <span id="uploadPanelTitle">Upload Progress</span>
                    </div>
                    <button id="uploadPanelClose" class="upload-panel-close" title="Close">
                        <i class="bi bi-x"></i>
                    </button>
                </div>

                <div class="upload-panel-content">
                    <!-- Overall progress -->
                    <div class="upload-overall-progress hidden" id="uploadOverallProgress">
                        <div class="progress-info">
                            <div class="progress-label">
                                <span id="uploadProgressLabel">Uploading...</span>
                                <span id="uploadProgressPercent" class="progress-percent">0%</span>
                            </div>
                            <div class="progress-bar-container">
                                <div id="uploadProgressBar" class="progress-bar" style="width: 0%"></div>
                            </div>
                            <div class="progress-details">
                                <span id="uploadProgressSize">0 B / 0 B</span>
                                <span id="uploadProgressSpeed">-</span>
                                <span id="uploadProgressETA">ETA: --:--</span>
                            </div>
                        </div>
                    </div>

                    <!-- File list -->
                    <div class="upload-files-list">
                        <div id="uploadFilesList" class="files-list-container">
                            <!-- Individual file uploads will be added here -->
                        </div>
                    </div>
                </div>

                <div class="upload-panel-footer">
                    <button id="uploadCancelAllBtn" class="btn btn-sm btn-outline-danger" title="Cancel all uploads">
                        <i class="bi bi-stop"></i> Cancel All
                    </button>
                    <button id="uploadClearBtn" class="btn btn-sm btn-outline-secondary hidden" title="Clear completed uploads">
                        <i class="bi bi-trash"></i> Clear
                    </button>
                </div>
            </div>
        `;

        // Insert panel before main content
        const mainContent = document.getElementById('mainContent');
        if (mainContent) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = panelHTML;
            mainContent.parentNode.insertBefore(tempDiv.firstElementChild, mainContent);
        }

        this.uploadPanel = document.getElementById('uploadProgressPanel');
        this.fileListContainer = document.getElementById('uploadFilesList');

        // Bind events
        this.bindPanelEvents();

        // Add CSS styles
        this.addStyles();
    },

    /**
     * Bind panel button events
     */
    bindPanelEvents() {
        const closeBtn = document.getElementById('uploadPanelClose');
        const cancelAllBtn = document.getElementById('uploadCancelAllBtn');
        const clearBtn = document.getElementById('uploadClearBtn');

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        if (cancelAllBtn) {
            cancelAllBtn.addEventListener('click', () => this.handleCancelAll());
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.handleClear());
        }
    },

    /**
     * Show the upload progress panel
     */
    show() {
        if (this.uploadPanel) {
            this.uploadPanel.classList.remove('hidden');
            this.isVisible = true;
            console.log('[UploadProgressUI] Panel shown');
        }
    },

    /**
     * Hide the upload progress panel
     */
    hide() {
        if (this.uploadPanel) {
            this.uploadPanel.classList.add('hidden');
            this.isVisible = false;
            console.log('[UploadProgressUI] Panel hidden');
        }
    },

    /**
     * Toggle panel visibility
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    },

    /**
     * Add file to upload list
     * @param {Object} fileInfo - File information
     */
    addFileUpload(fileInfo) {
        const { uploadId, file, size } = fileInfo;

        if (!this.activeUploads.has(uploadId)) {
            this.activeUploads.set(uploadId, {
                uploadId,
                fileName: file,
                fileSize: size,
                status: 'uploading',
                progress: 0,
                loaded: 0,
                speed: 0,
                eta: null,
                startTime: Date.now(),
                error: null,
                attempts: 0
            });

            this.renderFileUpload(uploadId);
            this.show();
        }
    },

    /**
     * Render a file upload item in the list
     * @param {string} uploadId - Upload ID
     */
    renderFileUpload(uploadId) {
        const upload = this.activeUploads.get(uploadId);
        if (!upload) return;

        const fileItemHTML = `
            <div class="upload-file-item" id="upload-file-${uploadId}">
                <div class="file-item-header">
                    <div class="file-item-info">
                        <i class="bi bi-file"></i>
                        <div class="file-item-details">
                            <div class="file-name">${this.escapeHtml(upload.fileName)}</div>
                            <div class="file-size">${this.getReadableSize(upload.fileSize)}</div>
                        </div>
                    </div>
                    <div class="file-item-status">
                        <span id="upload-status-${uploadId}" class="file-status uploading">
                            <i class="bi bi-hourglass-split"></i> Uploading
                        </span>
                    </div>
                </div>

                <div class="file-item-progress">
                    <div class="progress-bar-small">
                        <div id="upload-progress-${uploadId}" class="progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="progress-info-small">
                        <span id="upload-percent-${uploadId}" class="progress-text">0%</span>
                        <span id="upload-speed-${uploadId}" class="speed-text">-</span>
                        <span id="upload-eta-${uploadId}" class="eta-text">--:--</span>
                    </div>
                </div>

                <div class="file-item-actions" id="upload-actions-${uploadId}">
                    <!-- Retry button will appear on error -->
                </div>
            </div>
        `;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = fileItemHTML;
        this.fileListContainer.appendChild(tempDiv.firstElementChild);
    },

    /**
     * Update file upload progress
     * @param {string} uploadId - Upload ID
     * @param {Object} progressData - Progress information
     */
    updateFileProgress(uploadId, progressData) {
        const upload = this.activeUploads.get(uploadId);
        if (!upload) return;

        const { loaded, total, percentComplete } = progressData;

        upload.loaded = loaded;
        upload.progress = percentComplete;

        // Calculate speed and ETA
        const elapsed = (Date.now() - upload.startTime) / 1000; // seconds
        const speed = elapsed > 0 ? loaded / elapsed : 0; // bytes per second
        upload.speed = speed;

        const remaining = total - loaded;
        const eta = speed > 0 ? remaining / speed : 0; // seconds
        upload.eta = eta;

        // Update progress bar
        const progressBar = document.getElementById(`upload-progress-${uploadId}`);
        if (progressBar) {
            progressBar.style.width = `${percentComplete}%`;
        }

        // Update percentage text
        const percentText = document.getElementById(`upload-percent-${uploadId}`);
        if (percentText) {
            percentText.textContent = `${percentComplete.toFixed(0)}%`;
        }

        // Update speed text
        const speedText = document.getElementById(`upload-speed-${uploadId}`);
        if (speedText) {
            speedText.textContent = this.getReadableSpeed(speed);
        }

        // Update ETA text
        const etaText = document.getElementById(`upload-eta-${uploadId}`);
        if (etaText) {
            etaText.textContent = `ETA: ${this.getReadableETA(eta)}`;
        }

        // Update overall progress
        this.updateOverallProgress();
    },

    /**
     * Mark file upload as successful
     * @param {string} uploadId - Upload ID
     */
    markUploadSuccess(uploadId) {
        const upload = this.activeUploads.get(uploadId);
        if (!upload) return;

        upload.status = 'success';

        const statusEl = document.getElementById(`upload-status-${uploadId}`);
        if (statusEl) {
            statusEl.className = 'file-status success';
            statusEl.innerHTML = '<i class="bi bi-check-circle"></i> Complete';
        }

        // Hide progress bar on success
        const progressItem = document.getElementById(`upload-file-${uploadId}`);
        if (progressItem) {
            progressItem.classList.add('completed');
        }

        console.log(`[UploadProgressUI] Upload success: ${uploadId}`);
    },

    /**
     * Mark file upload as failed with detailed error info
     * @param {string} uploadId - Upload ID
     * @param {Object} errorInfo - Error information (message, classifiedError, recoveryAction, etc.)
     */
    markUploadError(uploadId, errorInfo) {
        const upload = this.activeUploads.get(uploadId);
        if (!upload) return;

        // Handle both string message (backward compatibility) and error object
        const isString = typeof errorInfo === 'string';
        const errorMessage = isString ? errorInfo : (errorInfo.displayMessage || errorInfo.error || 'Unknown error');
        const classifiedError = !isString ? errorInfo.classifiedError : null;
        const recoveryAction = !isString ? errorInfo.recoveryAction : null;
        const attempts = !isString ? (errorInfo.attempts || 0) : 0;

        upload.status = 'error';
        upload.error = errorMessage;
        upload.classifiedError = classifiedError;
        upload.recoveryAction = recoveryAction;
        upload.attempts = attempts;

        const statusEl = document.getElementById(`upload-status-${uploadId}`);
        if (statusEl) {
            statusEl.className = 'file-status error';
            statusEl.innerHTML = `<i class="bi bi-x-circle"></i> Failed`;
            statusEl.title = errorMessage;
        }

        // Show error message with details
        const progressItem = document.getElementById(`upload-file-${uploadId}`);
        if (progressItem && classifiedError) {
            this.showErrorDetails(progressItem, uploadId, classifiedError);
        }

        // Add recovery action buttons
        const actionsEl = document.getElementById(`upload-actions-${uploadId}`);
        if (actionsEl && recoveryAction) {
            this.createRecoveryButtons(actionsEl, uploadId, recoveryAction, attempts);
        }

        // Show error indicator
        if (progressItem) {
            progressItem.classList.add('failed');
        }

        console.log(`[UploadProgressUI] Upload error: ${uploadId} - ${errorMessage}`);
    },

    /**
     * Display detailed error information
     * @param {HTMLElement} progressItem - Progress item element
     * @param {string} uploadId - Upload ID
     * @param {Object} classifiedError - Classified error object
     */
    showErrorDetails(progressItem, uploadId, classifiedError) {
        let errorDetailsHTML = progressItem.querySelector('.error-details');
        if (!errorDetailsHTML) {
            errorDetailsHTML = document.createElement('div');
            errorDetailsHTML.className = 'error-details';
            progressItem.appendChild(errorDetailsHTML);
        }

        const details = `
            <div class="error-message">
                <strong>${this.escapeHtml(classifiedError.title || 'Error')}:</strong>
                ${this.escapeHtml(classifiedError.message || '')}
            </div>
            ${classifiedError.suggestion ? `
                <div class="error-suggestion">
                    <strong>Suggestion:</strong> ${this.escapeHtml(classifiedError.suggestion)}
                </div>
            ` : ''}
        `;

        errorDetailsHTML.innerHTML = details;
    },

    /**
     * Create recovery action buttons based on error type
     * @param {HTMLElement} actionsEl - Actions container element
     * @param {string} uploadId - Upload ID
     * @param {Object} recoveryAction - Recovery action object
     * @param {number} attempts - Number of attempts so far
     */
    createRecoveryButtons(actionsEl, uploadId, recoveryAction, attempts) {
        actionsEl.innerHTML = '';

        if (recoveryAction.type === 'retry') {
            // Retry button for retryable errors
            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn btn-sm btn-outline-warning';
            retryBtn.title = `Retry upload (attempt ${(attempts || 0) + 1})`;
            retryBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Retry';
            retryBtn.addEventListener('click', () => this.handleRetry(uploadId));
            actionsEl.appendChild(retryBtn);
        } else if (recoveryAction.type === 'prompt') {
            // Prompt buttons for duplicate file handling
            if (recoveryAction.options && Array.isArray(recoveryAction.options)) {
                recoveryAction.options.forEach(option => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-sm btn-outline-primary';
                    btn.title = option.description || '';
                    btn.innerHTML = `<i class="bi ${option.icon || ''}"></i> ${option.label}`;
                    btn.addEventListener('click', () => this.handleRecoveryAction(uploadId, option.value));
                    actionsEl.appendChild(btn);
                });
            }
        }

        // Always show a remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-sm btn-outline-secondary';
        removeBtn.title = 'Remove from list';
        removeBtn.innerHTML = '<i class="bi bi-trash"></i>';
        removeBtn.addEventListener('click', () => this.removeFileUpload(uploadId));
        actionsEl.appendChild(removeBtn);
    },

    /**
     * Handle recovery action for duplicate files
     * @param {string} uploadId - Upload ID
     * @param {string} action - Recovery action (overwrite, rename, skip)
     */
    handleRecoveryAction(uploadId, action) {
        console.log(`[UploadProgressUI] Recovery action: ${action} for ${uploadId}`);
        // Dispatch event or call callback to be handled by documentController
        const event = new CustomEvent('uploadRecoveryAction', {
            detail: { uploadId, action }
        });
        document.dispatchEvent(event);
    },

    /**
     * Update overall progress
     */
    updateOverallProgress() {
        const uploads = Array.from(this.activeUploads.values());
        if (uploads.length === 0) return;

        const totalSize = uploads.reduce((sum, u) => sum + u.fileSize, 0);
        const totalLoaded = uploads.reduce((sum, u) => sum + u.loaded, 0);
        const overallPercent = totalSize > 0 ? (totalLoaded / totalSize) * 100 : 0;

        // Calculate overall speed and ETA
        let overallSpeed = 0;
        const activeUploads = uploads.filter(u => u.status === 'uploading');
        if (activeUploads.length > 0) {
            overallSpeed = activeUploads.reduce((sum, u) => sum + u.speed, 0);
        }

        const remaining = totalSize - totalLoaded;
        const overallETA = overallSpeed > 0 ? remaining / overallSpeed : 0;

        // Update overall progress bar
        const overallBar = document.getElementById('uploadProgressBar');
        if (overallBar) {
            overallBar.style.width = `${overallPercent}%`;
        }

        const overallPercentEl = document.getElementById('uploadProgressPercent');
        if (overallPercentEl) {
            overallPercentEl.textContent = `${overallPercent.toFixed(0)}%`;
        }

        const sizeEl = document.getElementById('uploadProgressSize');
        if (sizeEl) {
            sizeEl.textContent = `${this.getReadableSize(totalLoaded)} / ${this.getReadableSize(totalSize)}`;
        }

        const speedEl = document.getElementById('uploadProgressSpeed');
        if (speedEl) {
            speedEl.textContent = this.getReadableSpeed(overallSpeed);
        }

        const etaEl = document.getElementById('uploadProgressETA');
        if (etaEl) {
            etaEl.textContent = `ETA: ${this.getReadableETA(overallETA)}`;
        }
    },

    /**
     * Remove file from upload list
     * @param {string} uploadId - Upload ID
     */
    removeFileUpload(uploadId) {
        const fileEl = document.getElementById(`upload-file-${uploadId}`);
        if (fileEl) {
            fileEl.remove();
        }
        this.activeUploads.delete(uploadId);

        // Hide panel if no more uploads
        if (this.activeUploads.size === 0) {
            setTimeout(() => this.hide(), 1000);
        }
    },

    /**
     * Handle cancel all uploads
     */
    handleCancelAll() {
        if (confirm('Cancel all uploads?')) {
            const uploadIds = Array.from(this.activeUploads.keys());
            uploadIds.forEach(id => {
                this.markUploadError(id, 'Cancelled by user');
            });
            console.log('[UploadProgressUI] All uploads cancelled');
        }
    },

    /**
     * Handle retry upload
     * @param {string} uploadId - Upload ID
     */
    handleRetry(uploadId) {
        const upload = this.activeUploads.get(uploadId);
        if (!upload) return;

        console.log(`[UploadProgressUI] Retry initiated for ${uploadId} (attempt ${upload.attempts + 1})`);

        // Reset error state and show uploading status
        upload.status = 'uploading';
        upload.progress = 0;
        upload.error = null;

        // Reset visual state
        const statusEl = document.getElementById(`upload-status-${uploadId}`);
        if (statusEl) {
            statusEl.className = 'file-status uploading';
            statusEl.innerHTML = '<i class="bi bi-hourglass-split"></i> Retrying...';
        }

        const progressItem = document.getElementById(`upload-file-${uploadId}`);
        if (progressItem) {
            progressItem.classList.remove('failed');
            const errorDetails = progressItem.querySelector('.error-details');
            if (errorDetails) {
                errorDetails.remove();
            }

            const actionsEl = progressItem.querySelector('.file-item-actions');
            if (actionsEl) {
                actionsEl.innerHTML = '';
            }
        }

        // Dispatch retry event to be handled by documentController
        const event = new CustomEvent('uploadRetry', {
            detail: { uploadId }
        });
        document.dispatchEvent(event);
    },

    /**
     * Mark retry attempt in progress
     * @param {string} uploadId - Upload ID
     * @param {Object} retryInfo - Retry information
     */
    showRetryInProgress(uploadId, retryInfo) {
        const upload = this.activeUploads.get(uploadId);
        if (!upload) return;

        const { attempt, maxAttempts, retryDelay } = retryInfo;

        const statusEl = document.getElementById(`upload-status-${uploadId}`);
        if (statusEl) {
            const delaySeconds = Math.ceil(retryDelay / 1000);
            statusEl.className = 'file-status uploading';
            statusEl.innerHTML = `<i class="bi bi-hourglass-split"></i> Retrying (${attempt}/${maxAttempts}) in ${delaySeconds}s...`;
        }

        console.log(`[UploadProgressUI] Retry in progress: ${uploadId} (attempt ${attempt}/${maxAttempts})`);
    },

    /**
     * Handle clear completed uploads
     */
    handleClear() {
        const completedIds = Array.from(this.activeUploads.entries())
            .filter(([, upload]) => upload.status !== 'uploading')
            .map(([id]) => id);

        completedIds.forEach(id => this.removeFileUpload(id));
        console.log(`[UploadProgressUI] Cleared ${completedIds.length} completed uploads`);
    },

    /**
     * Get human-readable file size
     * @param {number} bytes - Size in bytes
     * @returns {string} Readable size
     */
    getReadableSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    },

    /**
     * Get human-readable speed
     * @param {number} bytesPerSecond - Speed in bytes per second
     * @returns {string} Readable speed
     */
    getReadableSpeed(bytesPerSecond) {
        if (bytesPerSecond === 0) return '-';
        return `${this.getReadableSize(bytesPerSecond)}/s`;
    },

    /**
     * Get human-readable ETA
     * @param {number} seconds - Seconds remaining
     * @returns {string} Readable ETA
     */
    getReadableETA(seconds) {
        if (seconds === 0 || isNaN(seconds)) return '--:--';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }

        return `${minutes}:${String(secs).padStart(2, '0')}`;
    },

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Add CSS styles for upload progress UI
     */
    addStyles() {
        if (document.getElementById('uploadProgressStyles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'uploadProgressStyles';
        style.textContent = `
            .upload-progress-panel {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 450px;
                max-height: 600px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                display: flex;
                flex-direction: column;
                z-index: 1000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }

            .upload-progress-panel.hidden {
                display: none;
            }

            .upload-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid #e9ecef;
                background: #f8f9fa;
                border-radius: 8px 8px 0 0;
            }

            .upload-panel-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
                color: #212529;
            }

            .upload-panel-title i {
                color: #0078d7;
                font-size: 18px;
            }

            .upload-panel-close {
                background: none;
                border: none;
                cursor: pointer;
                font-size: 18px;
                color: #6c757d;
                padding: 0;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
            }

            .upload-panel-close:hover {
                background: #e9ecef;
                color: #212529;
            }

            .upload-panel-content {
                flex: 1;
                overflow-y: auto;
                padding: 0;
            }

            .upload-overall-progress {
                padding: 12px 16px;
                border-bottom: 1px solid #e9ecef;
                background: #f8f9fa;
            }

            .upload-overall-progress.hidden {
                display: none;
            }

            .progress-info {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .progress-label {
                display: flex;
                justify-content: space-between;
                font-size: 13px;
                font-weight: 500;
            }

            .progress-percent {
                color: #0078d7;
                font-weight: 600;
            }

            .progress-bar-container {
                width: 100%;
                height: 6px;
                background: #e9ecef;
                border-radius: 3px;
                overflow: hidden;
            }

            .progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #0078d7, #0066b3);
                border-radius: 3px;
                transition: width 0.2s ease;
            }

            .progress-details {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                color: #6c757d;
                margin-top: 4px;
            }

            .upload-files-list {
                padding: 8px 0;
            }

            .upload-file-item {
                padding: 12px 16px;
                border-bottom: 1px solid #f0f0f0;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .upload-file-item.completed {
                opacity: 0.7;
            }

            .upload-file-item.failed {
                background: #fff5f5;
            }

            .file-item-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }

            .file-item-info {
                display: flex;
                gap: 10px;
                flex: 1;
            }

            .file-item-info i {
                color: #0078d7;
                margin-top: 2px;
            }

            .file-item-details {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .file-name {
                font-size: 13px;
                font-weight: 500;
                color: #212529;
                word-break: break-word;
            }

            .file-size {
                font-size: 12px;
                color: #6c757d;
            }

            .file-item-status {
                margin-left: 8px;
            }

            .file-status {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                font-weight: 500;
                white-space: nowrap;
            }

            .file-status.uploading {
                color: #ffc107;
            }

            .file-status.success {
                color: #28a745;
            }

            .file-status.error {
                color: #dc3545;
            }

            .file-item-progress {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .progress-bar-small {
                width: 100%;
                height: 4px;
                background: #e9ecef;
                border-radius: 2px;
                overflow: hidden;
            }

            .progress-fill {
                height: 100%;
                background: #0078d7;
                border-radius: 2px;
                transition: width 0.2s ease;
            }

            .progress-info-small {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                color: #6c757d;
            }

            .file-item-actions {
                display: flex;
                gap: 6px;
                justify-content: flex-end;
                flex-wrap: wrap;
                row-gap: 6px;
            }

            .file-item-actions .btn {
                padding: 4px 8px;
                font-size: 11px;
                white-space: nowrap;
            }

            .error-details {
                padding: 8px 0;
                font-size: 11px;
                border-top: 1px solid #ffe9e9;
                margin-top: 4px;
            }

            .error-message {
                color: #dc3545;
                margin-bottom: 4px;
                line-height: 1.4;
            }

            .error-message strong {
                display: block;
                margin-bottom: 2px;
            }

            .error-suggestion {
                color: #856404;
                background: #fff3cd;
                padding: 6px 8px;
                border-radius: 3px;
                margin-top: 4px;
                line-height: 1.4;
            }

            .error-suggestion strong {
                display: block;
                margin-bottom: 2px;
            }

            .upload-panel-footer {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                padding: 12px 16px;
                border-top: 1px solid #e9ecef;
                background: #f8f9fa;
                border-radius: 0 0 8px 8px;
            }

            .upload-panel-footer .btn {
                padding: 6px 12px;
                font-size: 13px;
            }

            @media (max-width: 768px) {
                .upload-progress-panel {
                    width: calc(100vw - 40px);
                    max-height: 400px;
                    bottom: 10px;
                    right: 10px;
                    left: 10px;
                }
            }
        `;

        document.head.appendChild(style);
    }
};
