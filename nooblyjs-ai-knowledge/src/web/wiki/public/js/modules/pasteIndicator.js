/**
 * @fileoverview Paste Indicator Module
 * Provides visual feedback for clipboard paste operations
 * Shows overlay animations and status indicators when images are pasted
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-01
 */

export const pasteIndicator = {
    // Configuration
    config: {
        showOverlay: true,
        animationDuration: 500,
        displayDuration: 3000,
        useSound: false
    },

    // State
    currentOverlay: null,
    isActive: false,

    /**
     * Initialize paste indicator
     * @param {Object} options - Configuration options
     */
    init(options = {}) {
        if (options.config) {
            this.config = { ...this.config, ...options.config };
        }

        this.addStyles();
        console.log('[PasteIndicator] Initialized');
    },

    /**
     * Show paste detection indicator
     * @param {Object} pasteData - Information about the paste
     */
    showPasteDetected(pasteData) {
        const { count, source } = pasteData;

        if (!this.config.showOverlay) return;

        console.log('[PasteIndicator] Showing paste detected indicator');

        // Show animated overlay
        this.showOverlay(`📋 Pasted ${count} image${count > 1 ? 's' : ''}`);

        // Play notification sound if enabled
        if (this.config.useSound) {
            this.playSound('paste');
        }
    },

    /**
     * Show upload progress indicator for pasted file
     * @param {Object} uploadData - Upload information
     */
    showUploadProgress(uploadData) {
        const { filename, progress } = uploadData;

        console.log(`[PasteIndicator] Upload progress: ${filename} - ${progress}%`);
    },

    /**
     * Show upload success indicator
     * @param {Object} successData - Success information
     */
    showUploadSuccess(successData) {
        const { filename } = successData;

        console.log('[PasteIndicator] Upload success:', filename);

        // Show success overlay
        this.showOverlay(`✅ Image uploaded: ${filename}`, 'success');
    },

    /**
     * Show upload error indicator
     * @param {Object} errorData - Error information
     */
    showUploadError(errorData) {
        const { error, filename } = errorData;

        console.error('[PasteIndicator] Upload error:', error);

        // Show error overlay
        this.showOverlay(`❌ Upload failed: ${error}`, 'error', 5000);
    },

    /**
     * Show animated overlay with message
     * @param {string} message - Message to display
     * @param {string} type - Type of message (default, success, error, warning)
     * @param {number} duration - How long to display (ms)
     */
    showOverlay(message, type = 'default', duration = this.config.displayDuration) {
        // Remove existing overlay if present
        if (this.currentOverlay) {
            this.removeOverlay();
        }

        // Create overlay element
        const overlay = document.createElement('div');
        overlay.className = `paste-indicator paste-indicator-${type} paste-indicator-show`;
        overlay.innerHTML = `
            <div class="paste-indicator-content">
                <div class="paste-indicator-message">${this.escapeHtml(message)}</div>
            </div>
        `;

        // Add to document
        document.body.appendChild(overlay);
        this.currentOverlay = overlay;
        this.isActive = true;

        // Remove after duration
        setTimeout(() => {
            this.removeOverlay();
        }, duration);
    },

    /**
     * Remove the current overlay
     */
    removeOverlay() {
        if (!this.currentOverlay) return;

        this.currentOverlay.classList.add('paste-indicator-hide');

        setTimeout(() => {
            if (this.currentOverlay && this.currentOverlay.parentNode) {
                this.currentOverlay.parentNode.removeChild(this.currentOverlay);
            }
            this.currentOverlay = null;
            this.isActive = false;
        }, this.config.animationDuration);
    },

    /**
     * Play notification sound
     * @param {string} type - Type of sound (paste, success, error)
     */
    playSound(type) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            if (type === 'paste') {
                // Beep sound
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = 800;
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.1);
            } else if (type === 'success') {
                // Success sound
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
                oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.2);
            } else if (type === 'error') {
                // Error sound
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
                oscillator.frequency.setValueAtTime(200, audioContext.currentTime + 0.1);
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.2);
            }
        } catch (error) {
            console.warn('[PasteIndicator] Could not play sound:', error);
        }
    },

    /**
     * Show paste hint in the UI
     * @param {string} location - Where to show hint (center, top, bottom)
     */
    showPasteHint(location = 'center') {
        const hint = document.createElement('div');
        hint.className = `paste-hint paste-hint-${location}`;
        hint.innerHTML = `
            <div class="hint-content">
                <strong>💡 Tip:</strong> You can paste images directly with Ctrl+V (Cmd+V on Mac)
            </div>
        `;

        document.body.appendChild(hint);

        // Remove after 5 seconds
        setTimeout(() => {
            hint.classList.add('hint-hide');
            setTimeout(() => {
                if (hint.parentNode) {
                    hint.parentNode.removeChild(hint);
                }
            }, 300);
        }, 5000);
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
     * Add CSS styles for paste indicator
     */
    addStyles() {
        if (document.getElementById('pasteIndicatorStyles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'pasteIndicatorStyles';
        style.textContent = `
            .paste-indicator {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) scale(0.8);
                background: white;
                border-radius: 12px;
                padding: 24px 32px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                z-index: 2000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                pointer-events: none;
                opacity: 0;
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }

            .paste-indicator.paste-indicator-show {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }

            .paste-indicator.paste-indicator-hide {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.8);
            }

            .paste-indicator-content {
                display: flex;
                flex-direction: column;
                gap: 12px;
                align-items: center;
            }

            .paste-indicator-message {
                font-size: 16px;
                font-weight: 500;
                color: #212529;
                text-align: center;
                max-width: 300px;
            }

            /* Success state */
            .paste-indicator.paste-indicator-success {
                background: #d4edda;
                border: 1px solid #c3e6cb;
            }

            .paste-indicator.paste-indicator-success .paste-indicator-message {
                color: #155724;
            }

            /* Error state */
            .paste-indicator.paste-indicator-error {
                background: #f8d7da;
                border: 1px solid #f5c6cb;
            }

            .paste-indicator.paste-indicator-error .paste-indicator-message {
                color: #721c24;
            }

            /* Warning state */
            .paste-indicator.paste-indicator-warning {
                background: #fff3cd;
                border: 1px solid #ffeaa7;
            }

            .paste-indicator.paste-indicator-warning .paste-indicator-message {
                color: #856404;
            }

            /* Default state */
            .paste-indicator.paste-indicator-default {
                background: #e7f3ff;
                border: 1px solid #b3d9ff;
            }

            .paste-indicator.paste-indicator-default .paste-indicator-message {
                color: #0066cc;
            }

            /* Paste hint */
            .paste-hint {
                position: fixed;
                padding: 12px 16px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                border-radius: 6px;
                font-size: 13px;
                z-index: 1999;
                opacity: 1;
                transition: opacity 0.3s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                pointer-events: none;
            }

            .paste-hint-center {
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
            }

            .paste-hint-top {
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
            }

            .paste-hint-bottom {
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
            }

            .paste-hint.hint-hide {
                opacity: 0;
            }

            .hint-content {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .hint-content strong {
                font-weight: 600;
            }

            @media (max-width: 768px) {
                .paste-indicator {
                    padding: 16px 24px;
                }

                .paste-indicator-message {
                    font-size: 14px;
                    max-width: 250px;
                }

                .paste-hint {
                    font-size: 12px;
                    padding: 10px 14px;
                }
            }
        `;

        document.head.appendChild(style);
    },

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('[PasteIndicator] Configuration updated:', this.config);
    },

    /**
     * Get current configuration
     * @returns {Object} Current configuration
     */
    getConfig() {
        return { ...this.config };
    }
};
