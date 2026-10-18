/**
 * @fileoverview File Validator Module
 * Validates dropped files for type, size, and count
 * Provides user-friendly error messages and validation rules
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-01
 */

export const fileValidator = {
    // Configuration for validation
    config: {
        maxFileSize: 100 * 1024 * 1024, // 100 MB
        maxTotalUploadSize: 500 * 1024 * 1024, // 500 MB
        maxFilesPerDrop: 10,
        allowedExtensions: [
            // Images
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff',
            // Documents
            '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt',
            // Spreadsheets
            '.xls', '.xlsx', '.csv', '.ods',
            // Presentations
            '.ppt', '.pptx', '.odp',
            // Code/Text
            '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rb', '.php', '.cs', '.swift', '.kt',
            '.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.json', '.yaml', '.yml', '.toml', '.ini', '.conf',
            '.sh', '.bash', '.bat', '.ps1', '.perl', '.lua', '.sql',
            // Archives
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso',
            // Audio
            '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma', '.aiff',
            // Video
            '.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.3gp',
            // Data
            '.sql', '.sqlite', '.db', '.mdb', '.json', '.xml', '.parquet', '.avro'
        ],
        blockedExtensions: [
            // Executables
            '.exe', '.dll', '.so', '.dylib', '.bin', '.com', '.app', '.deb', '.rpm', '.msi',
            // Scripts that execute
            '.scr', '.vbs', '.ps1', '.bat', '.cmd', '.sh',
            // System files
            '.sys', '.drv', '.rom', '.ini', '.config',
            // Archives containing executables
            '.zip', // Allow some archives but warn on certain types
            // Other potentially dangerous
            '.jar', '.cab', '.msi'
        ],
        allowedMimeTypes: [
            // Images
            'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/tiff',
            // Documents
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'application/rtf', 'application/vnd.oasis.opendocument.text',
            // Spreadsheets
            'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv', 'application/vnd.oasis.opendocument.spreadsheet',
            // Presentations
            'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.oasis.opendocument.presentation',
            // Code/Text
            'text/javascript', 'text/typescript', 'text/x-python', 'text/x-java', 'text/x-c',
            'text/x-c++', 'text/x-go', 'text/x-ruby', 'text/x-php', 'text/x-csharp', 'text/x-swift',
            'text/html', 'text/css', 'text/scss', 'text/x-less', 'text/xml', 'application/json',
            'text/yaml', 'text/x-toml', 'text/x-sql', 'text/x-bash',
            // Archives
            'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
            'application/x-tar', 'application/gzip', 'application/x-bzip2',
            // Audio
            'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/flac', 'audio/ogg', 'audio/x-m4a',
            // Video
            'video/mp4', 'video/x-msvideo', 'video/quicktime', 'video/x-matroska', 'video/x-flv',
            'video/x-ms-wmv', 'video/webm', 'video/3gpp',
            // Data
            'application/sql', 'application/json', 'application/xml'
        ],
        blockedMimeTypes: [
            'application/x-msdownload',
            'application/x-msdos-program',
            'application/x-executable',
            'application/x-elf',
            'application/x-sharedlib',
            'application/x-sh',
            'application/x-shellscript'
        ]
    },

    /**
     * Validate a collection of dropped files
     * @param {FileList|Array<File>} files - Files to validate
     * @param {Object} options - Validation options
     * @returns {Object} Validation result with valid files and errors
     */
    validateFiles(files, options = {}) {
        const validFiles = [];
        const errors = [];
        const warnings = [];
        const fileArray = Array.isArray(files) ? files : Array.from(files);

        // Check file count
        const countValidation = this.validateFileCount(fileArray.length);
        if (!countValidation.valid) {
            errors.push(countValidation.error);
            // Don't return early - process all files for detailed feedback
        }

        // Validate individual files
        for (let i = 0; i < fileArray.length; i++) {
            const file = fileArray[i];
            const fileValidation = this.validateFile(file);

            if (!fileValidation.valid) {
                errors.push({
                    file: file.name,
                    message: fileValidation.error
                });
            } else {
                validFiles.push(file);
                if (fileValidation.warning) {
                    warnings.push({
                        file: file.name,
                        message: fileValidation.warning
                    });
                }
            }
        }

        // Check total size
        const totalSize = fileArray.reduce((sum, file) => sum + file.size, 0);
        const sizeValidation = this.validateTotalSize(totalSize);
        if (!sizeValidation.valid) {
            errors.push(sizeValidation.error);
        }

        return {
            valid: errors.length === 0 && validFiles.length > 0,
            validFiles: validFiles,
            errors: errors,
            warnings: warnings,
            totalFiles: fileArray.length,
            validCount: validFiles.length,
            rejectedCount: fileArray.length - validFiles.length,
            totalSize: totalSize
        };
    },

    /**
     * Validate a single file
     * @param {File} file - File to validate
     * @returns {Object} Validation result
     */
    validateFile(file) {
        // Check file type by extension
        const extension = this.getFileExtension(file.name);
        const typeValidation = this.validateFileType(file, extension);
        if (!typeValidation.valid) {
            return {
                valid: false,
                error: typeValidation.error
            };
        }

        // Check file size
        const sizeValidation = this.validateFileSize(file.size);
        if (!sizeValidation.valid) {
            return {
                valid: false,
                error: sizeValidation.error
            };
        }

        return {
            valid: true,
            warning: typeValidation.warning || null
        };
    },

    /**
     * Validate file type by MIME type and extension
     * @param {File} file - File to validate
     * @param {string} extension - File extension
     * @returns {Object} Validation result
     */
    validateFileType(file, extension) {
        const mimeType = file.type;

        // Check if extension is blocked
        if (this.config.blockedExtensions.some(ext => extension.toLowerCase() === ext.toLowerCase())) {
            return {
                valid: false,
                error: `File type ${extension} is not allowed. Executables and system files cannot be uploaded.`
            };
        }

        // Check if MIME type is blocked
        if (this.config.blockedMimeTypes.includes(mimeType)) {
            return {
                valid: false,
                error: `File type ${mimeType} is not allowed for security reasons.`
            };
        }

        // Check if extension is in allowed list
        const isAllowedExtension = this.config.allowedExtensions.some(
            ext => extension.toLowerCase() === ext.toLowerCase()
        );

        // Check if MIME type is in allowed list
        const isAllowedMime = mimeType && this.config.allowedMimeTypes.includes(mimeType);

        // File is valid if either extension or MIME type is allowed
        if (!isAllowedExtension && !isAllowedMime && mimeType) {
            // If MIME type doesn't match, it might be a custom or unknown type
            // Allow it but warn the user
            if (isAllowedExtension) {
                return {
                    valid: true,
                    warning: `File type ${extension} is allowed but MIME type ${mimeType} is not recognized.`
                };
            }

            return {
                valid: false,
                error: `File type ${extension} is not supported. Supported types: images, documents, code files, archives, audio, and video.`
            };
        }

        // Warning for known potentially problematic types
        if (extension.toLowerCase() === '.zip' || extension.toLowerCase() === '.rar' || extension.toLowerCase() === '.7z') {
            return {
                valid: true,
                warning: `Archive file detected. Contents will not be automatically extracted.`
            };
        }

        return { valid: true };
    },

    /**
     * Validate file size
     * @param {number} fileSize - Size of file in bytes
     * @returns {Object} Validation result
     */
    validateFileSize(fileSize) {
        if (fileSize > this.config.maxFileSize) {
            const maxMB = (this.config.maxFileSize / (1024 * 1024)).toFixed(0);
            const fileMB = (fileSize / (1024 * 1024)).toFixed(2);
            return {
                valid: false,
                error: `File is too large (${fileMB}MB). Maximum allowed size is ${maxMB}MB.`
            };
        }

        return { valid: true };
    },

    /**
     * Validate file count
     * @param {number} fileCount - Number of files
     * @returns {Object} Validation result
     */
    validateFileCount(fileCount) {
        if (fileCount > this.config.maxFilesPerDrop) {
            return {
                valid: false,
                error: `Too many files (${fileCount}). Maximum ${this.config.maxFilesPerDrop} files per upload.`
            };
        }

        if (fileCount === 0) {
            return {
                valid: false,
                error: 'No files provided.'
            };
        }

        return { valid: true };
    },

    /**
     * Validate total upload size
     * @param {number} totalSize - Total size of all files in bytes
     * @returns {Object} Validation result
     */
    validateTotalSize(totalSize) {
        if (totalSize > this.config.maxTotalUploadSize) {
            const maxMB = (this.config.maxTotalUploadSize / (1024 * 1024)).toFixed(0);
            const totalMB = (totalSize / (1024 * 1024)).toFixed(2);
            return {
                valid: false,
                error: `Total upload size too large (${totalMB}MB). Maximum combined size is ${maxMB}MB.`
            };
        }

        return { valid: true };
    },

    /**
     * Get file extension
     * @param {string} filename - Name of file
     * @returns {string} File extension with dot
     */
    getFileExtension(filename) {
        const lastDot = filename.lastIndexOf('.');
        if (lastDot === -1 || lastDot === 0) {
            return '';
        }
        return filename.substring(lastDot).toLowerCase();
    },

    /**
     * Get human-readable file size
     * @param {number} bytes - Size in bytes
     * @returns {string} Human-readable size
     */
    getReadableFileSize(bytes) {
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
     * Get list of supported file types as human-readable text
     * @returns {string} Comma-separated list of file types
     */
    getSupportedFileTypes() {
        return 'Images (JPG, PNG, GIF, SVG, WebP), Documents (PDF, DOC, DOCX, TXT), ' +
               'Spreadsheets (XLS, XLSX, CSV), Presentations (PPT, PPTX), ' +
               'Code files (JS, TS, PY, Java, C++), Archives (ZIP, RAR, 7Z), ' +
               'Audio (MP3, WAV, FLAC), Video (MP4, MOV, MKV)';
    },

    /**
     * Format validation errors for display
     * @param {Object} validationResult - Result from validateFiles()
     * @returns {string} Formatted error message
     */
    formatErrorMessage(validationResult) {
        if (validationResult.valid) {
            return '';
        }

        const messages = [];

        // Add main errors
        validationResult.errors.forEach(error => {
            if (error.file) {
                messages.push(`❌ ${error.file}: ${error.message}`);
            } else {
                messages.push(`❌ ${error.message}`);
            }
        });

        // Add summary if some files were rejected
        if (validationResult.rejectedCount > 0) {
            messages.unshift(
                `⚠️ ${validationResult.rejectedCount} of ${validationResult.totalFiles} file(s) rejected:`
            );
        }

        return messages.join('\n');
    },

    /**
     * Format validation warnings for display
     * @param {Array} warnings - Warnings from validateFiles()
     * @returns {string} Formatted warning message
     */
    formatWarningMessage(warnings) {
        if (!warnings || warnings.length === 0) {
            return '';
        }

        const messages = warnings.map(warning => {
            return `⚠️ ${warning.file}: ${warning.message}`;
        });

        return messages.join('\n');
    },

    /**
     * Update validation configuration
     * @param {Object} newConfig - New configuration values
     */
    updateConfig(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };
    },

    /**
     * Get current configuration
     * @returns {Object} Current configuration
     */
    getConfig() {
        return { ...this.config };
    },

    /**
     * Add allowed file extensions
     * @param {Array<string>} extensions - Extensions to add
     */
    addAllowedExtensions(extensions) {
        extensions.forEach(ext => {
            const normalized = ext.startsWith('.') ? ext : `.${ext}`;
            if (!this.config.allowedExtensions.includes(normalized)) {
                this.config.allowedExtensions.push(normalized);
            }
        });
    },

    /**
     * Remove allowed file extensions
     * @param {Array<string>} extensions - Extensions to remove
     */
    removeAllowedExtensions(extensions) {
        extensions.forEach(ext => {
            const normalized = ext.startsWith('.') ? ext : `.${ext}`;
            const index = this.config.allowedExtensions.indexOf(normalized);
            if (index > -1) {
                this.config.allowedExtensions.splice(index, 1);
            }
        });
    }
};
