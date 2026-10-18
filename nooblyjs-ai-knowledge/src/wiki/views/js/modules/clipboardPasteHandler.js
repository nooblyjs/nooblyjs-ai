/**
 * @fileoverview Clipboard Paste Handler Module
 * Handles clipboard paste operations for images and files
 * Automatically extracts images from clipboard and initiates upload
 * Supports multiple image formats and generates intelligent filenames
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-01
 */

export const clipboardPasteHandler = {
    // Configuration
    config: {
        enabledFormats: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'],
        maxImageSize: 50 * 1024 * 1024, // 50 MB
        autoGenerateFilenames: true,
        uploadOnPaste: true,
        showPasteNotification: true
    },

    // State
    isEnabled: false,
    isWikiAppVisible: false,

    // Callbacks
    onImageDetected: null,
    onImagePasted: null,
    onError: null,
    onPasteAttempt: null,

    /**
     * Initialize clipboard paste handler
     * @param {Object} options - Configuration options
     */
    init(options = {}) {
        if (options.config) {
            this.config = { ...this.config, ...options.config };
        }

        this.onImageDetected = options.onImageDetected || (() => {});
        this.onImagePasted = options.onImagePasted || (() => {});
        this.onError = options.onError || (() => {});
        this.onPasteAttempt = options.onPasteAttempt || (() => {});

        // Bind paste event listener to document
        this.bindPasteListener();

        console.log('[ClipboardPasteHandler] Initialized with config:', this.config);
    },

    /**
     * Bind paste event listener to document
     */
    bindPasteListener() {
        // Listen for paste events on the entire document
        document.addEventListener('paste', (event) => this.handlePasteEvent(event), true);

        console.log('[ClipboardPasteHandler] Paste event listener bound to document');
    },

    /**
     * Handle paste event
     * @param {ClipboardEvent} event - Paste event
     */
    handlePasteEvent(event) {
        // Only process if enabled and wiki app is visible
        if (!this.isEnabled || !this.isWikiAppVisible) {
            console.log('[ClipboardPasteHandler] Paste handler disabled or wiki app not visible');
            return;
        }

        const target = event.target;

        // Skip if a text input, password input, search input, or textarea is focused
        if (target instanceof HTMLInputElement) {
            const inputType = target.type.toLowerCase();
            if (inputType === 'text' || inputType === 'password' || inputType === 'search' || inputType === 'email') {
                console.log('[ClipboardPasteHandler] Skipping paste: text input field has focus');
                return;
            }
        }

        if (target instanceof HTMLTextAreaElement) {
            console.log('[ClipboardPasteHandler] Skipping paste: textarea has focus');
            return;
        }

        // Skip if any contentEditable element is focused
        if (target.contentEditable === 'true') {
            console.log('[ClipboardPasteHandler] Skipping paste: contentEditable element has focus');
            return;
        }

        const clipboardData = event.clipboardData || window.clipboardData;
        if (!clipboardData) {
            console.warn('[ClipboardPasteHandler] Clipboard data not available');
            return;
        }

        this.onPasteAttempt({ timestamp: Date.now() });

        // Check for files in clipboard
        const files = clipboardData.files;
        if (files && files.length > 0) {
            this.processPastedFiles(files);
            event.preventDefault();
            return;
        }

        // Check for images in clipboard items (for systems that support it)
        const items = clipboardData.items;
        if (items && items.length > 0) {
            this.processPastedItems(items);
            event.preventDefault();
            return;
        }

        console.log('[ClipboardPasteHandler] No files or items found in clipboard');
    },

    /**
     * Process pasted files from clipboard
     * @param {FileList} files - Files from clipboard
     */
    processPastedFiles(files) {
        console.log('[ClipboardPasteHandler] Processing pasted files:', files.length);

        const fileArray = Array.from(files);
        const imageFiles = fileArray.filter(file => this.isImageFile(file));

        if (imageFiles.length === 0) {
            const errorMsg = 'No image files found in clipboard paste';
            console.warn('[ClipboardPasteHandler]', errorMsg);
            this.onError({
                type: 'no_images',
                message: errorMsg
            });
            return;
        }

        this.onImageDetected({
            count: imageFiles.length,
            files: imageFiles,
            totalSize: imageFiles.reduce((sum, f) => sum + f.size, 0)
        });

        // Process each image
        imageFiles.forEach((file, index) => {
            this.processImageFile(file, index, imageFiles.length);
        });
    },

    /**
     * Process pasted items from clipboard (supports more image sources)
     * @param {DataTransferItemList} items - Clipboard items
     */
    processPastedItems(items) {
        console.log('[ClipboardPasteHandler] Processing pasted items:', items.length);

        const imageItems = [];
        const promises = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // Handle file items (images)
            if (item.kind === 'file' && this.isImageMimeType(item.type)) {
                const file = item.getAsFile();
                if (file) {
                    imageItems.push(file);
                    promises.push(Promise.resolve(file));
                }
            }
            // Handle HTML content that might contain images
            else if (item.kind === 'string' && item.type === 'text/html') {
                promises.push(
                    new Promise((resolve) => {
                        item.getAsString((html) => {
                            const extractedImages = this.extractImagesFromHTML(html);
                            resolve(extractedImages);
                        });
                    })
                );
            }
            // Handle plain URLs that might point to images
            else if (item.kind === 'string' && item.type === 'text/plain') {
                promises.push(
                    new Promise((resolve) => {
                        item.getAsString((url) => {
                            if (this.isImageURL(url)) {
                                console.log('[ClipboardPasteHandler] Image URL detected:', url);
                                resolve([{ url, isUrl: true }]);
                            } else {
                                resolve([]);
                            }
                        });
                    })
                );
            }
        }

        Promise.all(promises).then((results) => {
            const allImages = results.flat().filter(Boolean);

            if (allImages.length === 0) {
                const errorMsg = 'No image data found in clipboard paste';
                console.warn('[ClipboardPasteHandler]', errorMsg);
                this.onError({
                    type: 'no_images',
                    message: errorMsg
                });
                return;
            }

            this.onImageDetected({
                count: allImages.length,
                items: allImages,
                totalSize: allImages.reduce((sum, item) => sum + (item.size || 0), 0)
            });

            // Process each image
            allImages.forEach((item, index) => {
                if (item instanceof File) {
                    this.processImageFile(item, index, allImages.length);
                } else if (item.isUrl) {
                    this.processImageURL(item.url, index, allImages.length);
                }
            });
        });
    },

    /**
     * Process a single image file from clipboard
     * @param {File} file - Image file
     * @param {number} index - File index
     * @param {number} total - Total number of files
     */
    processImageFile(file, index, total) {
        console.log(`[ClipboardPasteHandler] Processing image file: ${file.name} (${index + 1}/${total})`);

        // Validate file size
        if (file.size > this.config.maxImageSize) {
            const errorMsg = `Image too large: ${this.getReadableSize(file.size)} (max: ${this.getReadableSize(this.config.maxImageSize)})`;
            console.error('[ClipboardPasteHandler]', errorMsg);
            this.onError({
                type: 'file_too_large',
                message: errorMsg,
                file: file.name,
                size: file.size
            });
            return;
        }

        // Generate filename if needed
        let filename = file.name;
        if (!filename || filename === 'image.png' || filename === 'image.jpg') {
            filename = this.generateImageFilename(file.type);
        }

        console.log(`[ClipboardPasteHandler] Image file ready: ${filename} (${this.getReadableSize(file.size)})`);

        // Emit pasted image event
        this.onImagePasted({
            file: file,
            filename: filename,
            type: file.type,
            size: file.size,
            index: index,
            total: total,
            timestamp: Date.now(),
            source: 'clipboard-paste'
        });
    },

    /**
     * Process image from URL
     * @param {string} url - Image URL
     * @param {number} index - Image index
     * @param {number} total - Total number of images
     */
    processImageURL(url, index, total) {
        console.log(`[ClipboardPasteHandler] Processing image URL: ${url} (${index + 1}/${total})`);

        // Download image from URL
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.blob();
            })
            .then(blob => {
                const filename = this.generateImageFilenameFromURL(url);
                const file = new File([blob], filename, { type: blob.type });

                console.log(`[ClipboardPasteHandler] Image downloaded from URL: ${filename} (${this.getReadableSize(file.size)})`);

                this.onImagePasted({
                    file: file,
                    filename: filename,
                    type: blob.type,
                    size: blob.size,
                    index: index,
                    total: total,
                    timestamp: Date.now(),
                    source: 'clipboard-url'
                });
            })
            .catch(error => {
                const errorMsg = `Failed to download image from URL: ${error.message}`;
                console.error('[ClipboardPasteHandler]', errorMsg);
                this.onError({
                    type: 'url_download_failed',
                    message: errorMsg,
                    url: url,
                    error: error.message
                });
            });
    },

    /**
     * Extract images from HTML content
     * @param {string} html - HTML string
     * @returns {Array} Array of extracted image URLs
     */
    extractImagesFromHTML(html) {
        console.log('[ClipboardPasteHandler] Extracting images from HTML');

        const images = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Find all img tags
        const imgElements = doc.querySelectorAll('img');
        imgElements.forEach(img => {
            const src = img.src;
            if (src && this.isImageURL(src)) {
                images.push({ url: src, isUrl: true });
            }
        });

        console.log(`[ClipboardPasteHandler] Found ${images.length} images in HTML`);
        return images;
    },

    /**
     * Check if file is an image file
     * @param {File} file - File to check
     * @returns {boolean} Whether file is an image
     */
    isImageFile(file) {
        return this.isImageMimeType(file.type);
    },

    /**
     * Check if MIME type is an image
     * @param {string} mimeType - MIME type to check
     * @returns {boolean} Whether MIME type is an image
     */
    isImageMimeType(mimeType) {
        return this.config.enabledFormats.includes(mimeType) ||
               (mimeType && mimeType.startsWith('image/'));
    },

    /**
     * Check if string is an image URL
     * @param {string} url - URL to check
     * @returns {boolean} Whether URL appears to be an image
     */
    isImageURL(url) {
        if (!url || typeof url !== 'string') return false;

        // Check for common image extensions
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
        const urlLower = url.toLowerCase();

        return imageExtensions.some(ext => urlLower.includes(ext));
    },

    /**
     * Generate intelligent filename for pasted image
     * @param {string} mimeType - MIME type of image
     * @returns {string} Generated filename
     */
    generateImageFilename(mimeType = 'image/png') {
        const timestamp = this.getTimestamp();
        const extension = this.getImageExtension(mimeType);

        return `pasted-image-${timestamp}.${extension}`;
    },

    /**
     * Generate filename from image URL
     * @param {string} url - Image URL
     * @returns {string} Generated filename
     */
    generateImageFilenameFromURL(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();

            if (filename && filename.length > 0 && filename.includes('.')) {
                // Clean up filename
                return filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
            }
        } catch (e) {
            // Invalid URL, fall back to generated name
        }

        // Fall back to generated filename
        return this.generateImageFilename('image/png');
    },

    /**
     * Get image file extension from MIME type
     * @param {string} mimeType - MIME type
     * @returns {string} File extension
     */
    getImageExtension(mimeType) {
        const mimeMap = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/svg+xml': 'svg'
        };

        return mimeMap[mimeType] || 'png';
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
     * Get current timestamp for filename generation
     * @returns {string} Timestamp string (YYYYMMDD-HHMMSS-ms)
     */
    getTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');

        return `${year}${month}${day}-${hours}${minutes}${seconds}-${ms}`;
    },

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('[ClipboardPasteHandler] Configuration updated:', this.config);
    },

    /**
     * Get current configuration
     * @returns {Object} Current configuration
     */
    getConfig() {
        return { ...this.config };
    },

    /**
     * Enable or disable clipboard paste handling
     * @param {boolean} enabled - Whether to enable paste handling
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log('[ClipboardPasteHandler] Paste handling ' + (enabled ? 'enabled' : 'disabled'));
    },

    /**
     * Set wiki app visibility state
     * Call this when the wiki app becomes visible or hidden
     * @param {boolean} visible - Whether the wiki app is visible
     */
    setWikiAppVisibility(visible) {
        this.isWikiAppVisible = visible;
        console.log('[ClipboardPasteHandler] Wiki app visibility set to: ' + (visible ? 'visible' : 'hidden'));
    }
};
