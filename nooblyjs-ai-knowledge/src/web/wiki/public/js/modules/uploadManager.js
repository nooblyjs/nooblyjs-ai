/**
 * @fileoverview Upload Manager Module
 * Handles file uploads to the server with progress tracking and error handling
 * Supports multiple simultaneous uploads with configurable concurrency
 * Integrates centralized error handling with classification and retry logic
 *
 *@author Digital Techonolgies Team
 * @version 1.0.1
 * @since 2025-11-01
 */

import { errorHandler } from './errorHandler.js';

export const uploadManager = {
    // Configuration
    config: {
        maxConcurrentUploads: 3,
        retryAttempts: 3,
        retryDelay: 1000, // ms
        uploadEndpoint: '/applications/wiki/api/documents/upload'
    },

    // State management
    uploads: new Map(), // Track active uploads
    uploadQueue: [], // Queue for pending uploads
    isProcessing: false,

    // Callbacks
    onProgress: null,
    onSuccess: null,
    onError: null,
    onComplete: null,
    onUploadStarted: null,
    onRetry: null,
    onErrorRecovery: null,

    /**
     * Initialize the upload manager
     * @param {Object} options - Configuration options
     */
    init(options = {}) {
        if (options.config) {
            this.config = { ...this.config, ...options.config };
        }

        this.onProgress = options.onProgress || (() => {});
        this.onSuccess = options.onSuccess || (() => {});
        this.onError = options.onError || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onUploadStarted = options.onUploadStarted || (() => {});
        this.onRetry = options.onRetry || (() => {});
        this.onErrorRecovery = options.onErrorRecovery || (() => {});

        console.log('[UploadManager] Initialized with config:', this.config);
    },

    /**
     * Upload files to the server
     * @param {Array<File>} files - Files to upload
     * @param {Object} options - Upload options
     * @param {number} options.spaceId - Target space ID
     * @param {string} options.folderPath - Target folder path (optional)
     * @returns {Promise<Array>} Upload results
     */
    async uploadFiles(files, options = {}) {
        const { spaceId, folderPath = '' } = options;

        if (!spaceId) {
            throw new Error('Space ID is required for upload');
        }

        if (!files || files.length === 0) {
            throw new Error('No files provided for upload');
        }

        console.log('[UploadManager] Starting upload of', files.length, 'files to space', spaceId);

        // Create upload tasks for each file
        const fileArray = Array.isArray(files) ? files : Array.from(files);
        const uploadTasks = fileArray.map(file => ({
            file,
            uploadId: this.generateUploadId(),
            spaceId,
            folderPath,
            status: 'pending',
            progress: 0,
            error: null,
            attempts: 0
        }));

        // Add to queue
        this.uploadQueue.push(...uploadTasks);

        // Notify that uploads have been queued
        this.onUploadStarted({
            totalFiles: uploadTasks.length,
            uploadIds: uploadTasks.map(t => t.uploadId)
        });

        // Start processing queue
        return this.processQueue();
    },

    /**
     * Process upload queue with concurrency limit
     * @returns {Promise<Array>} Results of all uploads
     */
    async processQueue() {
        const results = [];

        while (this.uploadQueue.length > 0 || this.uploads.size > 0) {
            // Fill up concurrent upload slots
            while (this.uploads.size < this.config.maxConcurrentUploads && this.uploadQueue.length > 0) {
                const task = this.uploadQueue.shift();
                const uploadPromise = this.performUpload(task);

                this.uploads.set(task.uploadId, uploadPromise);

                uploadPromise
                    .then(result => {
                        results.push(result);
                        this.uploads.delete(task.uploadId);
                    })
                    .catch(error => {
                        results.push({
                            uploadId: task.uploadId,
                            file: task.file.name,
                            success: false,
                            error: error.message
                        });
                        this.uploads.delete(task.uploadId);
                    });
            }

            // Wait for at least one upload to complete
            if (this.uploads.size > 0) {
                await Promise.race(Array.from(this.uploads.values()));
            }
        }

        // All uploads complete
        this.onComplete({ results, totalUploads: results.length });

        return results;
    },

    /**
     * Perform a single file upload with intelligent retry logic and error handling
     * @param {Object} task - Upload task
     * @returns {Promise<Object>} Upload result
     */
    async performUpload(task) {
        const { uploadId, file, spaceId, folderPath } = task;

        console.log(`[UploadManager] Starting upload for file: ${file.name} (${uploadId})`);

        while (task.attempts < this.config.retryAttempts) {
            try {
                task.attempts++;

                const result = await this.uploadFileToServer(file, spaceId, folderPath, uploadId);

                console.log(`[UploadManager] Upload successful: ${file.name}`);

                this.onSuccess({
                    uploadId,
                    file: file.name,
                    size: file.size,
                    result
                });

                return {
                    uploadId,
                    file: file.name,
                    success: true,
                    size: file.size,
                    ...result
                };
            } catch (error) {
                console.error(`[UploadManager] Upload attempt ${task.attempts} failed for ${file.name}:`, error);

                // Classify the error using errorHandler
                const uploadInfo = {
                    uploadId,
                    fileName: file.name,
                    fileSize: file.size
                };
                const classifiedError = errorHandler.classifyError(error);
                task.error = classifiedError;

                // Check if error is retryable
                const isRetryable = errorHandler.isRetryable(classifiedError);

                if (isRetryable && task.attempts < this.config.retryAttempts) {
                    // Calculate delay with exponential backoff
                    const retryDelay = errorHandler.calculateRetryDelay(task.attempts);

                    console.log(`[UploadManager] Error is retryable (${classifiedError.type}). Retrying in ${retryDelay}ms...`);

                    // Notify about retry attempt
                    this.onRetry({
                        uploadId,
                        file: file.name,
                        attempt: task.attempts,
                        maxAttempts: this.config.retryAttempts,
                        errorType: classifiedError.type,
                        retryDelay
                    });

                    await this.delay(retryDelay);
                    continue;
                }

                // Error not retryable or retries exhausted
                const recoveryAction = errorHandler.getRecoveryAction(classifiedError);
                const displayMessage = errorHandler.getDisplayMessage(classifiedError);

                console.log(`[UploadManager] Upload failed for ${file.name}. Recovery action: ${recoveryAction.type}`);

                // Notify about error with recovery options
                this.onErrorRecovery({
                    uploadId,
                    file: file.name,
                    classifiedError,
                    recoveryAction,
                    displayMessage,
                    attempts: task.attempts,
                    maxAttempts: this.config.retryAttempts
                });

                // Also call legacy onError callback for backward compatibility
                this.onError({
                    uploadId,
                    file: file.name,
                    error: displayMessage,
                    attempts: task.attempts,
                    classifiedError
                });

                // Log error for debugging
                const errorLog = errorHandler.formatErrorLog(classifiedError, uploadInfo);
                console.log('[UploadManager] Error log:', errorLog);

                throw classifiedError;
            }
        }
    },

    /**
     * Upload a single file to the server
     * @param {File} file - File to upload
     * @param {number} spaceId - Target space ID
     * @param {string} folderPath - Target folder path
     * @param {string} uploadId - Upload ID for tracking
     * @returns {Promise<Object>} Server response
     */
    async uploadFileToServer(file, spaceId, folderPath, uploadId) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('spaceId', spaceId);
        formData.append('folderPath', folderPath);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const uploadStartTime = Date.now();

            // Track upload progress
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    this.onProgress({
                        uploadId,
                        file: file.name,
                        loaded: event.loaded,
                        total: event.total,
                        percentComplete
                    });
                }
            });

            // Handle completion
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response.success) {
                            resolve(response);
                        } else {
                            // Server returned success but with error property
                            const errorObj = new Error(response.error || 'Upload failed');
                            errorObj.statusCode = xhr.status;
                            reject(errorObj);
                        }
                    } catch (error) {
                        const errorObj = new Error('Invalid server response');
                        errorObj.statusCode = xhr.status;
                        reject(errorObj);
                    }
                } else {
                    // HTTP error response
                    try {
                        const errorResponse = JSON.parse(xhr.responseText);
                        const errorObj = new Error(errorResponse.error || `HTTP ${xhr.status}`);
                        errorObj.statusCode = xhr.status;
                        reject(errorObj);
                    } catch {
                        const errorObj = new Error(`HTTP ${xhr.status}: ${xhr.statusText}`);
                        errorObj.statusCode = xhr.status;
                        reject(errorObj);
                    }
                }
            });

            // Handle network errors
            xhr.addEventListener('error', () => {
                const errorObj = new Error('Network error during upload');
                reject(errorObj);
            });

            // Handle timeouts
            xhr.addEventListener('timeout', () => {
                const errorObj = new Error('Upload timeout - server took too long to respond');
                reject(errorObj);
            });

            // Handle aborts
            xhr.addEventListener('abort', () => {
                const errorObj = new Error('Upload was cancelled by user');
                reject(errorObj);
            });

            // Set timeout for upload (5 minutes)
            xhr.timeout = 300000;

            // Send the request
            try {
                xhr.open('POST', this.config.uploadEndpoint, true);
                xhr.send(formData);
            } catch (error) {
                const errorObj = new Error(`Failed to initiate upload: ${error.message}`);
                reject(errorObj);
            }
        });
    },

    /**
     * Get upload status
     * @param {string} uploadId - Upload ID
     * @returns {Object|null} Upload status or null if not found
     */
    getUploadStatus(uploadId) {
        const queuedTask = this.uploadQueue.find(t => t.uploadId === uploadId);
        if (queuedTask) {
            return {
                uploadId,
                status: 'queued',
                progress: 0
            };
        }

        // Check active uploads
        if (this.uploads.has(uploadId)) {
            return {
                uploadId,
                status: 'uploading',
                progress: 'in progress'
            };
        }

        return null;
    },

    /**
     * Cancel an upload
     * @param {string} uploadId - Upload ID to cancel
     * @returns {boolean} True if cancelled, false if not found
     */
    cancelUpload(uploadId) {
        // Try to remove from queue
        const queueIndex = this.uploadQueue.findIndex(t => t.uploadId === uploadId);
        if (queueIndex > -1) {
            this.uploadQueue.splice(queueIndex, 1);
            console.log(`[UploadManager] Cancelled queued upload: ${uploadId}`);
            return true;
        }

        // Can't cancel active uploads with this simple implementation
        // Would need to store abort controllers in production
        console.log(`[UploadManager] Cannot cancel active upload: ${uploadId}`);
        return false;
    },

    /**
     * Clear all pending uploads
     */
    clearQueue() {
        const count = this.uploadQueue.length;
        this.uploadQueue = [];
        console.log(`[UploadManager] Cleared ${count} pending uploads from queue`);
    },

    /**
     * Get queue status
     * @returns {Object} Queue status
     */
    getQueueStatus() {
        return {
            queued: this.uploadQueue.length,
            active: this.uploads.size,
            total: this.uploadQueue.length + this.uploads.size
        };
    },

    /**
     * Generate a unique upload ID
     * @returns {string} Unique ID
     */
    generateUploadId() {
        return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Delay execution
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Get human-readable upload speed
     * @param {number} bytes - Bytes transferred
     * @param {number} ms - Milliseconds elapsed
     * @returns {string} Speed in readable format
     */
    getUploadSpeed(bytes, ms) {
        const seconds = ms / 1000;
        const bytesPerSecond = bytes / seconds;

        const units = ['B/s', 'KB/s', 'MB/s'];
        let speed = bytesPerSecond;
        let unitIndex = 0;

        while (speed >= 1024 && unitIndex < units.length - 1) {
            speed /= 1024;
            unitIndex++;
        }

        return `${speed.toFixed(2)} ${units[unitIndex]}`;
    },

    /**
     * Estimate time remaining for upload
     * @param {number} remaining - Bytes remaining
     * @param {number} bytesPerSecond - Upload speed in bytes per second
     * @returns {string} ETA in readable format
     */
    getETA(remaining, bytesPerSecond) {
        if (bytesPerSecond === 0) return 'calculating...';

        const secondsRemaining = remaining / bytesPerSecond;

        if (secondsRemaining < 60) {
            return `${Math.ceil(secondsRemaining)}s`;
        }

        const minutesRemaining = secondsRemaining / 60;
        if (minutesRemaining < 60) {
            return `${Math.ceil(minutesRemaining)}m`;
        }

        const hoursRemaining = minutesRemaining / 60;
        return `${Math.ceil(hoursRemaining)}h`;
    },

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('[UploadManager] Configuration updated:', this.config);
    },

    /**
     * Get current configuration
     * @returns {Object} Current configuration
     */
    getConfig() {
        return { ...this.config };
    }
};
