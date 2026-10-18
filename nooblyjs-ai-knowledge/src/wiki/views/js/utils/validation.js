/**
 * Validation Utilities
 * Handles input validation for folders, files, and other entities
 */

export const Validator = {
    /**
     * Invalid characters for file/folder names
     */
    INVALID_CHARS: /[<>:"|?*\\/]/,
    INVALID_CHARS_MESSAGE: '< > : " | ? * \\ /',

    /**
     * Validate folder name
     * @param {string} name - Folder name to validate
     * @returns {object} { valid: boolean, error: string|null }
     */
    validateFolderName(name) {
        const trimmed = name?.trim();

        if (!trimmed) {
            return { valid: false, error: 'Folder name cannot be empty' };
        }

        if (this.INVALID_CHARS.test(trimmed)) {
            return { valid: false, error: `Folder name cannot contain: ${this.INVALID_CHARS_MESSAGE}` };
        }

        if (trimmed.startsWith('.')) {
            return { valid: false, error: 'Folder name cannot start with a dot' };
        }

        if (trimmed.length > 255) {
            return { valid: false, error: 'Folder name is too long (max 255 characters)' };
        }

        return { valid: true, error: null };
    },

    /**
     * Validate file name
     * @param {string} name - File name to validate
     * @returns {object} { valid: boolean, error: string|null }
     */
    validateFileName(name) {
        const trimmed = name?.trim();

        if (!trimmed) {
            return { valid: false, error: 'File name cannot be empty' };
        }

        if (this.INVALID_CHARS.test(trimmed)) {
            return { valid: false, error: `File name cannot contain: ${this.INVALID_CHARS_MESSAGE}` };
        }

        if (!trimmed.includes('.')) {
            return { valid: false, error: 'File name must have an extension' };
        }

        if (trimmed.length > 255) {
            return { valid: false, error: 'File name is too long (max 255 characters)' };
        }

        return { valid: true, error: null };
    },

    /**
     * Validate space name
     * @param {string} name - Space name to validate
     * @returns {object} { valid: boolean, error: string|null }
     */
    validateSpaceName(name) {
        const trimmed = name?.trim();

        if (!trimmed) {
            return { valid: false, error: 'Space name cannot be empty' };
        }

        if (trimmed.length < 3) {
            return { valid: false, error: 'Space name must be at least 3 characters' };
        }

        if (trimmed.length > 50) {
            return { valid: false, error: 'Space name is too long (max 50 characters)' };
        }

        return { valid: true, error: null };
    },

    /**
     * Check if a name is a valid path component
     * @param {string} name - Name to check
     * @returns {boolean} True if valid
     */
    isValidPathComponent(name) {
        return !this.INVALID_CHARS.test(name) && name.trim().length > 0;
    }
};
