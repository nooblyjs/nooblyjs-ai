/**
 * File Helper Utilities
 * Handles file type detection, icon mapping, and file-related utilities
 */

export const FileHelpers = {
    /**
     * Get Bootstrap icon class for a file based on its extension
     * @param {string} filename - The filename with extension
     * @returns {object} Icon class and color
     */
    getFileIcon(filename) {
        const extension = filename.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'md':
            case 'markdown':
                return { icon: 'bi-file-text', color: '' };
            case 'txt':
                return { icon: 'bi-file-text', color: '' };
            case 'pdf':
                return { icon: 'bi-file-pdf', color: '' };
            case 'doc':
            case 'docx':
                return { icon: 'bi-file-word', color: '' };
            case 'xls':
            case 'xlsx':
                return { icon: 'bi-file-excel', color: '' };
            case 'ppt':
            case 'pptx':
                return { icon: 'bi-file-ppt', color: '' };
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
            case 'svg':
                return { icon: 'bi-file-image', color: '' };
            case 'mp4':
            case 'webm':
            case 'ogg':
            case 'ogv':
            case 'mov':
            case 'avi':
            case 'mkv':
            case 'flv':
            case 'wmv':
            case 'm4v':
                return { icon: 'bi-play-circle', color: '' };
            case 'mp3':
            case 'wav':
            case 'flac':
            case 'aac':
            case 'm4a':
            case 'oga':
            case 'weba':
            case 'opus':
                return { icon: 'bi-music-note-beamed', color: '' };
            case 'js':
            case 'ts':
            case 'jsx':
            case 'tsx':
                return { icon: 'bi-file-code', color: '' };
            case 'html':
            case 'htm':
                return { icon: 'bi-file-code', color: '' };
            case 'css':
            case 'scss':
            case 'sass':
                return { icon: 'bi-file-code', color: '' };
            case 'json':
            case 'xml':
                return { icon: 'bi-file-code', color: '' };
            default:
                return { icon: 'bi-file', color: '' };
        }
    },

    /**
     * Get human-readable file type from extension
     * @param {string} filename - The filename with extension
     * @returns {string} Human-readable file type
     */
    getFileTypeFromExtension(filename) {
        const extension = filename.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'md':
            case 'markdown':
                return 'Markdown';
            case 'txt':
                return 'Text';
            case 'pdf':
                return 'PDF';
            case 'doc':
            case 'docx':
                return 'Word Document';
            case 'xls':
            case 'xlsx':
                return 'Excel';
            case 'ppt':
            case 'pptx':
                return 'PowerPoint';
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
            case 'svg':
                return 'Image';
            case 'mp4':
            case 'webm':
            case 'ogg':
            case 'ogv':
            case 'mov':
            case 'avi':
            case 'mkv':
            case 'flv':
            case 'wmv':
            case 'm4v':
                return 'Video';
            case 'mp3':
            case 'wav':
            case 'flac':
            case 'aac':
            case 'm4a':
            case 'oga':
            case 'weba':
            case 'opus':
                return 'Audio';
            case 'js':
            case 'ts':
                return 'JavaScript';
            case 'jsx':
            case 'tsx':
                return 'React';
            case 'html':
            case 'htm':
                return 'HTML';
            case 'css':
            case 'scss':
            case 'sass':
                return 'CSS';
            case 'json':
                return 'JSON';
            case 'xml':
                return 'XML';
            default:
                return 'File';
        }
    },

    /**
     * Get space icon class from space name
     * @param {string} spaceName - Name of the space
     * @returns {string} Bootstrap icon class
     */
    getSpaceIcon(spaceName) {
        const iconMap = {
            'Personal Space': 'bi bi-person-fill',
            'Shared Space': 'bi bi-people-fill',
            'Team Space': 'bi bi-briefcase-fill',
            'Archive': 'bi bi-archive-fill',
            'Projects': 'bi bi-folder-fill',
            'Resources': 'bi bi-book-fill'
        };

        return iconMap[spaceName] || 'bi bi-folder-fill';
    },

    /**
     * Format file size in human-readable format
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted file size
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    },

    /**
     * Format date to relative time
     * @param {string|Date} date - Date to format
     * @returns {string} Relative time string
     */
    formatRelativeTime(date) {
        const now = new Date();
        const then = new Date(date);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return then.toLocaleDateString();
    }
};
