/**
 * @fileoverview Wiki Application API Client Module
 * Provides centralized API communication layer for all Wiki application endpoints.
 * Uses modern async/await syntax for cleaner asynchronous code.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2025-08-24
 */

const BASE_URL = '/applications/wiki/api';
const FILING_URL = '/services/filing/api';

export const WikiAPI = {
    /**
     * Authentication APIs
     */
    auth: {
        async check() {
            const response = await fetch(`${BASE_URL}/auth/check`);
            return response.json();
        }
    },

    /**
     * Space APIs
     */
    spaces: {
        async getAll() {
            const response = await fetch(`${BASE_URL}/spaces`);
            return response.json();
        },

        async create(data) {
            const response = await fetch(`${BASE_URL}/spaces`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        },

        async getFolders(spaceId) {
            const response = await fetch(`${BASE_URL}/spaces/${spaceId}/folders`);
            return response.json();
        },

    },

    /**
     * Folder APIs
     */
    folders: {
        async create(data) {
            const response = await fetch(`${BASE_URL}/folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        },

        async rename(data) {
            const response = await fetch(`${BASE_URL}/folders/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        },

        async delete(path, spaceId) {
            const response = await fetch(`${BASE_URL}/folders/${encodeURIComponent(path)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spaceId })
            });
            return response.json();
        }
    },

    /**
     * Document APIs
     */
    documents: {
        async getAll() {
            const response = await fetch(`${BASE_URL}/documents`);
            return response.json();
        },

        async create(data) {
            const response = await fetch(`${BASE_URL}/documents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        },

        async getContent(path, spaceName, enhanced = false) {
            const url = `${BASE_URL}/documents/content?path=${encodeURIComponent(path)}&spaceName=${encodeURIComponent(spaceName)}${enhanced ? '&enhanced=true' : ''}`;
            const response = await fetch(url);
            return response.json();
        },

        async saveContent(path, spaceName, content) {
            const response = await fetch(`${BASE_URL}/documents/content`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, spaceName, content })
            });
            return response.json();
        },

        async rename(data) {
            const response = await fetch(`${BASE_URL}/documents/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        },

        async delete(path, spaceId) {
            const response = await fetch(`${BASE_URL}/documents/${encodeURIComponent(path)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spaceId })
            });
            return response.json();
        }
    },

    /**
     * File Upload API
     */
    async uploadFile(formData, targetPath, spaceName) {
        const response = await fetch(`${BASE_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        return response.json();
    },

    /**
     * Publish API
     */
    async publish(data) {
        const response = await fetch(`${BASE_URL}/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    },

    /**
     * Activity APIs
     */
    activity: {
        async get() {
            const response = await fetch(`${BASE_URL}/activity`);
            return response.json();
        },

        async update(data) {
            const response = await fetch(`${BASE_URL}/activity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        },

        async getUserActivity() {
            const response = await fetch(`${BASE_URL}/user/activity`);
            return response.json();
        },

        async recordVisit(data) {
            const response = await fetch(`${BASE_URL}/user/visit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        },

        async toggleStar(data) {
            const response = await fetch(`${BASE_URL}/user/star`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        }
    },

    /**
     * User Profile APIs
     */
    profile: {
        async get() {
            const response = await fetch(`${BASE_URL}/profile`);
            return response.json();
        },

        async update(data) {
            const response = await fetch(`${BASE_URL}/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.json();
        }
    },

    /**
     * Direct Filing Service APIs
     * Calls core filing service directly for binary content (images, PDFs, videos, etc.)
     * Each space is registered as instance "space-{id}"
     */
    filing: {
        /**
         * Browse files in a space directory
         * @param {string|number} spaceId - The space ID
         * @param {string} dirPath - Directory path to browse
         * @returns {Promise<Object>} Browse results with items array
         */
        async browse(spaceId, dirPath = '') {
            const encodedPath = dirPath.split('/').map(encodeURIComponent).join('/');
            const response = await fetch(`${FILING_URL}/space-${spaceId}/browse/${encodedPath}`);
            return response.json();
        },

        /**
         * Download a file from a space - returns raw Response for binary handling
         * @param {string|number} spaceId - The space ID
         * @param {string} filePath - File path within the space
         * @returns {Promise<Response>} Raw fetch Response (caller handles binary vs text)
         */
        async download(spaceId, filePath) {
            const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
            return fetch(`${FILING_URL}/space-${spaceId}/download/${encodedPath}`);
        },

        /**
         * Upload a file to a space
         * @param {string|number} spaceId - The space ID
         * @param {string} filePath - Target file path
         * @param {*} data - File data (FormData, Buffer, etc.)
         * @returns {Promise<Object>} Upload result
         */
        async upload(spaceId, filePath, data) {
            const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
            const response = await fetch(`${FILING_URL}/space-${spaceId}/upload/${encodedPath}`, {
                method: 'POST',
                body: data
            });
            return response.json();
        },

        /**
         * Remove a file from a space
         * @param {string|number} spaceId - The space ID
         * @param {string} filePath - File path to remove
         * @returns {Promise<Object>} Remove result
         */
        async remove(spaceId, filePath) {
            const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
            const response = await fetch(`${FILING_URL}/space-${spaceId}/remove/${encodedPath}`, {
                method: 'DELETE'
            });
            return response.json();
        },

        /**
         * Get a direct URL for binary content (img/video/audio/iframe src attributes)
         * @param {string|number} spaceId - The space ID
         * @param {string} filePath - File path within the space
         * @returns {string} Direct URL string for use in src attributes
         */
        getDirectUrl(spaceId, filePath) {
            const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
            return `${FILING_URL}/space-${spaceId}/download/${encodedPath}`;
        }
    }
};
