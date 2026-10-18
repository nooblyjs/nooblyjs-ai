/**
 * @fileoverview Error Handler Module
 * Centralized error handling and recovery for file uploads
 * Manages error types, messages, retry logic, and user recovery options
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-01
 */

export const errorHandler = {
    // Error type definitions
    errorTypes: {
        NETWORK_ERROR: 'network_error',
        FILE_TOO_LARGE: 'file_too_large',
        UNSUPPORTED_TYPE: 'unsupported_type',
        DISK_QUOTA_EXCEEDED: 'disk_quota_exceeded',
        PERMISSION_DENIED: 'permission_denied',
        DUPLICATE_FILE: 'duplicate_file',
        SERVER_ERROR: 'server_error',
        INVALID_RESPONSE: 'invalid_response',
        TIMEOUT: 'timeout',
        UNKNOWN: 'unknown'
    },

    // Error messages and recovery suggestions
    errorMessages: {
        network_error: {
            title: 'Network Error',
            message: 'Connection to server lost. Please check your internet connection.',
            suggestion: 'Try uploading again. The system will automatically retry.',
            recoverable: true,
            retryable: true
        },
        file_too_large: {
            title: 'File Too Large',
            message: 'The file exceeds the maximum allowed size.',
            suggestion: 'Reduce the file size or split it into smaller parts.',
            recoverable: false,
            retryable: false,
            maxSize: '100 MB'
        },
        unsupported_type: {
            title: 'Unsupported File Type',
            message: 'This file type is not supported.',
            suggestion: 'Try uploading a different file type.',
            recoverable: false,
            retryable: false
        },
        disk_quota_exceeded: {
            title: 'Storage Space Full',
            message: 'The storage space is full. Cannot complete upload.',
            suggestion: 'Delete some files to free up space or contact your administrator.',
            recoverable: true,
            retryable: true
        },
        permission_denied: {
            title: 'Permission Denied',
            message: 'You do not have permission to upload files to this location.',
            suggestion: 'Try uploading to a different folder or contact your administrator.',
            recoverable: true,
            retryable: true
        },
        duplicate_file: {
            title: 'File Already Exists',
            message: 'A file with this name already exists in the target folder.',
            suggestion: 'Choose to overwrite, rename, or skip this file.',
            recoverable: true,
            retryable: true,
            action: 'prompt'
        },
        server_error: {
            title: 'Server Error',
            message: 'An error occurred on the server.',
            suggestion: 'Try uploading again. If the problem persists, contact support.',
            recoverable: true,
            retryable: true
        },
        invalid_response: {
            title: 'Invalid Response',
            message: 'The server returned an unexpected response.',
            suggestion: 'Try uploading again. If the problem persists, contact support.',
            recoverable: true,
            retryable: true
        },
        timeout: {
            title: 'Upload Timeout',
            message: 'The upload took too long to complete.',
            suggestion: 'Try uploading again or check your internet connection.',
            recoverable: true,
            retryable: true
        },
        unknown: {
            title: 'Unknown Error',
            message: 'An unexpected error occurred during upload.',
            suggestion: 'Try uploading again or contact support.',
            recoverable: true,
            retryable: true
        }
    },

    /**
     * Classify error based on message or HTTP status
     * @param {Error|string} error - Error object or message
     * @param {number} statusCode - HTTP status code (optional)
     * @returns {Object} Classified error with type and details
     */
    classifyError(error, statusCode = null) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        let errorType = this.errorTypes.UNKNOWN;
        let details = {};

        // Network errors
        if (errorMessage.includes('Network') || errorMessage.includes('Failed to fetch')) {
            errorType = this.errorTypes.NETWORK_ERROR;
        }
        // Timeout errors
        else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
            errorType = this.errorTypes.TIMEOUT;
        }
        // File size errors
        else if (errorMessage.includes('too large') || errorMessage.includes('exceeds')) {
            errorType = this.errorTypes.FILE_TOO_LARGE;
            const sizeMatch = errorMessage.match(/(\d+)\s*(MB|GB|B)/i);
            if (sizeMatch) {
                details.fileSize = sizeMatch[0];
            }
        }
        // Unsupported type
        else if (errorMessage.includes('not supported') || errorMessage.includes('unsupported')) {
            errorType = this.errorTypes.UNSUPPORTED_TYPE;
            const typeMatch = errorMessage.match(/(\.\w+)/);
            if (typeMatch) {
                details.fileType = typeMatch[0];
            }
        }
        // Duplicate file
        else if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
            errorType = this.errorTypes.DUPLICATE_FILE;
        }
        // Disk quota
        else if (errorMessage.includes('quota') || errorMessage.includes('space')) {
            errorType = this.errorTypes.DISK_QUOTA_EXCEEDED;
        }
        // Permission errors
        else if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
            errorType = this.errorTypes.PERMISSION_DENIED;
        }

        // HTTP status code classification
        if (statusCode) {
            if (statusCode === 413) {
                errorType = this.errorTypes.FILE_TOO_LARGE;
            } else if (statusCode === 403) {
                errorType = this.errorTypes.PERMISSION_DENIED;
            } else if (statusCode === 409) {
                errorType = this.errorTypes.DUPLICATE_FILE;
            } else if (statusCode === 507) {
                errorType = this.errorTypes.DISK_QUOTA_EXCEEDED;
            } else if (statusCode >= 500) {
                errorType = this.errorTypes.SERVER_ERROR;
            } else if (statusCode === 400) {
                if (!Object.values(this.errorTypes).includes(errorType)) {
                    errorType = this.errorTypes.INVALID_RESPONSE;
                }
            }
        }

        return {
            type: errorType,
            message: errorMessage,
            statusCode,
            details,
            ...this.errorMessages[errorType]
        };
    },

    /**
     * Calculate retry delay with exponential backoff
     * @param {number} attempt - Current attempt number (1-indexed)
     * @param {number} maxDelay - Maximum delay in milliseconds
     * @returns {number} Delay in milliseconds
     */
    calculateRetryDelay(attempt, maxDelay = 30000) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
        const delay = Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), maxDelay);
        // Add jitter (±10%)
        const jitter = delay * 0.1 * (Math.random() * 2 - 1);
        return Math.floor(delay + jitter);
    },

    /**
     * Check if error is retryable
     * @param {Object} classifiedError - Classified error object
     * @returns {boolean} Whether the error can be retried
     */
    isRetryable(classifiedError) {
        return classifiedError.retryable === true;
    },

    /**
     * Check if error is recoverable
     * @param {Object} classifiedError - Classified error object
     * @returns {boolean} Whether the error can be recovered from
     */
    isRecoverable(classifiedError) {
        return classifiedError.recoverable === true;
    },

    /**
     * Get user-friendly error message
     * @param {Object} classifiedError - Classified error object
     * @returns {string} Formatted error message for display
     */
    getDisplayMessage(classifiedError) {
        const { title, message, suggestion, details } = classifiedError;

        let displayMsg = `${title}: ${message}`;

        // Add specific details based on error type
        if (classifiedError.type === this.errorTypes.FILE_TOO_LARGE && details.fileSize) {
            displayMsg += ` (Maximum: ${classifiedError.maxSize || '100 MB'})`;
        }

        if (suggestion) {
            displayMsg += `\n${suggestion}`;
        }

        return displayMsg;
    },

    /**
     * Get recovery action for an error
     * @param {Object} classifiedError - Classified error object
     * @returns {Object} Recovery action with type and options
     */
    getRecoveryAction(classifiedError) {
        const { type, action } = classifiedError;

        // Duplicate file requires special handling
        if (type === this.errorTypes.DUPLICATE_FILE) {
            return {
                type: 'prompt',
                options: [
                    { label: 'Overwrite', value: 'overwrite', icon: 'bi-arrow-repeat' },
                    { label: 'Rename', value: 'rename', icon: 'bi-pencil' },
                    { label: 'Skip', value: 'skip', icon: 'bi-skip-forward' }
                ],
                message: 'A file with this name already exists. What would you like to do?'
            };
        }

        // Most errors can be retried
        if (classifiedError.retryable) {
            return {
                type: 'retry',
                autoRetry: true,
                maxAttempts: 3
            };
        }

        // Non-recoverable errors
        return {
            type: 'failed',
            autoRetry: false
        };
    },

    /**
     * Parse server error response
     * @param {Response} response - Fetch API response object
     * @returns {Promise<Object>} Parsed error details
     */
    async parseServerError(response) {
        try {
            const errorData = await response.json();
            return {
                statusCode: response.status,
                error: errorData.error || response.statusText,
                details: errorData
            };
        } catch (e) {
            // If response is not JSON, use status text
            return {
                statusCode: response.status,
                error: response.statusText || 'Unknown server error',
                details: {}
            };
        }
    },

    /**
     * Format error for logging
     * @param {Object} classifiedError - Classified error object
     * @param {Object} uploadInfo - Upload information (file, uploadId, etc.)
     * @returns {Object} Formatted log entry
     */
    formatErrorLog(classifiedError, uploadInfo = {}) {
        return {
            timestamp: new Date().toISOString(),
            errorType: classifiedError.type,
            title: classifiedError.title,
            message: classifiedError.message,
            uploadId: uploadInfo.uploadId,
            fileName: uploadInfo.fileName,
            fileSize: uploadInfo.fileSize,
            statusCode: classifiedError.statusCode,
            details: classifiedError.details,
            retryable: classifiedError.retryable,
            recoverable: classifiedError.recoverable
        };
    },

    /**
     * Get supported file types for error messages
     * @returns {string} Comma-separated list of supported types
     */
    getSupportedFileTypes() {
        return 'Images (JPG, PNG, GIF), Documents (PDF, DOC, DOCX), ' +
               'Spreadsheets (XLS, XLSX), Code (JS, PY, etc), ' +
               'Archives (ZIP, RAR, 7Z), Audio (MP3, WAV), Video (MP4, MOV)';
    },

    /**
     * Check if error is due to storage space
     * @param {Object} classifiedError - Classified error object
     * @returns {boolean} Whether error is storage-related
     */
    isStorageError(classifiedError) {
        return classifiedError.type === this.errorTypes.DISK_QUOTA_EXCEEDED;
    },

    /**
     * Check if error is permission-related
     * @param {Object} classifiedError - Classified error object
     * @returns {boolean} Whether error is permission-related
     */
    isPermissionError(classifiedError) {
        return classifiedError.type === this.errorTypes.PERMISSION_DENIED;
    },

    /**
     * Create a detailed error report
     * @param {Array<Object>} errors - Array of classified error objects
     * @returns {string} Formatted error report
     */
    createErrorReport(errors) {
        if (!errors || errors.length === 0) {
            return 'No errors to report.';
        }

        const grouped = {};
        errors.forEach(err => {
            if (!grouped[err.type]) {
                grouped[err.type] = [];
            }
            grouped[err.type].push(err);
        });

        let report = '## Upload Error Report\n\n';

        Object.entries(grouped).forEach(([type, typeErrors]) => {
            const errorInfo = this.errorMessages[type] || {};
            report += `### ${errorInfo.title || type}\n`;
            report += `**Count:** ${typeErrors.length}\n`;
            report += `**Message:** ${errorInfo.message}\n`;
            report += `**Suggestion:** ${errorInfo.suggestion}\n\n`;
        });

        return report;
    }
};
