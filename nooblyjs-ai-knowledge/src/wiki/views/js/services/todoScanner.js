/**
 * @fileoverview TODO Scanner Service
 * Scans markdown files for TODO items and builds window.todos object
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-09
 */

class TodoScanner {
    constructor() {
        this.lastScanTime = null;
        this.scanInterval = 300000; // 30 seconds
        this.scanTimer = null;
    }

    /**
     * Initialize the TODO scanner
     */
    init() {
        // Initialize window.todos as empty array
        window.todos = [];

        // Perform initial scan
        this.scanAllSpaces();

        // Start periodic scanning
        this.startPeriodicScanning();

        console.log('TODO Scanner initialized');
    }

    /**
     * Start periodic background scanning
     */
    startPeriodicScanning() {
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
        }

        this.scanTimer = setInterval(() => {
            this.scanAllSpaces();
        }, this.scanInterval);
    }

    /**
     * Stop periodic scanning
     */
    stopPeriodicScanning() {
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
    }

    /**
     * Scan all spaces for TODO items
     */
    async scanAllSpaces() {
        try {
            // Get all spaces from the API
            const response = await fetch('/applications/wiki/api/spaces');
            if (!response.ok) {
                throw new Error('Failed to fetch spaces');
            }

            const spaces = await response.json();
            const allTodos = [];

            // Scan each space
            for (const space of spaces) {
                const spaceTodos = await this.scanSpace(space);
                allTodos.push(...spaceTodos);
            }

            // Update window.todos
            window.todos = allTodos;
            this.lastScanTime = new Date().toISOString();

            console.log(`TODO scan complete: found ${allTodos.length} files with TODOs`);

            // Dispatch event for any listeners
            window.dispatchEvent(new CustomEvent('todos:updated', {
                detail: { todos: allTodos }
            }));

        } catch (error) {
            console.error('Error scanning for TODOs:', error);
        }
    }

    /**
     * Scan a specific space for TODO items
     */
    async scanSpace(space) {
        try {
            // Get folder structure for this space
            const response = await fetch(`/applications/wiki/api/spaces/${space.id}/folders`);
            if (!response.ok) {
                console.warn(`Failed to fetch folders for space ${space.name}`);
                return [];
            }

            const tree = await response.json();
            const todos = [];

            // Recursively scan all markdown files in the tree
            await this.scanTreeNodes(tree, space, todos);

            return todos;

        } catch (error) {
            console.error(`Error scanning space ${space.name}:`, error);
            return [];
        }
    }

    /**
     * Recursively scan tree nodes for markdown files
     */
    async scanTreeNodes(nodes, space, todos) {
        for (const node of nodes) {
            if (node.type === 'document' && this.isMarkdownFile(node.name || node.path)) {
                // Scan this markdown file
                const fileTodos = await this.scanMarkdownFile(node, space);
                if (fileTodos && fileTodos.todos.length > 0) {
                    todos.push(fileTodos);
                }
            } else if (node.type === 'folder' && node.children) {
                // Recursively scan folder
                await this.scanTreeNodes(node.children, space, todos);
            }
        }
    }

    /**
     * Check if a file is a markdown file
     */
    isMarkdownFile(filename) {
        return filename && (filename.endsWith('.md') || filename.endsWith('.markdown'));
    }

    /**
     * Scan a markdown file for TODO items
     */
    async scanMarkdownFile(fileNode, space) {
        try {
            const filePath = fileNode.path || fileNode.name;
            const spaceName = space.name;

            // Fetch file content
            const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}&enhanced=true`);

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            const content = data.content;
            const metadata = data.metadata;

            // Extract TODO items from content
            const todos = this.extractTodos(content);

            if (todos.length === 0) {
                return null;
            }

            // Build the file TODO object
            return {
                name: fileNode.title || fileNode.name,
                path: filePath,
                space: space.id.toString(),
                spaceName: spaceName,
                created: fileNode.created || fileNode.createdAt || metadata.created || new Date().toISOString(),
                modified: metadata.modified || new Date().toISOString(),
                todos: todos
            };

        } catch (error) {
            console.error(`Error scanning file ${fileNode.path}:`, error);
            return null;
        }
    }

    /**
     * Extract TODO items from markdown content
     */
    extractTodos(content) {
        const todos = [];
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for TODO checkbox patterns: - [ ] or - [x]
            const uncheckedMatch = line.match(/^\s*([-*])\s+\[\s\]\s+(.+)$/);
            const checkedMatch = line.match(/^\s*([-*])\s+\[x\]\s+(.+)$/i);

            if (uncheckedMatch) {
                todos.push({
                    text: uncheckedMatch[2].trim(),
                    status: 'unchecked',
                    line: i
                });
            } else if (checkedMatch) {
                todos.push({
                    text: checkedMatch[2].trim(),
                    status: 'checked',
                    line: i
                });
            }
        }

        return todos;
    }

    /**
     * Scan a single file (useful for incremental updates)
     */
    async scanSingleFile(filePath, spaceName) {
        try {
            // Find the space
            const spacesResponse = await fetch('/applications/wiki/api/spaces');
            if (!spacesResponse.ok) return;

            const spaces = await spacesResponse.json();
            const space = spaces.find(s => s.name === spaceName);
            if (!space) return;

            // Fetch file content
            const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(filePath)}&spaceName=${encodeURIComponent(spaceName)}&enhanced=true`);

            if (!response.ok) {
                // File might have been deleted - remove from window.todos
                this.removeFileFromTodos(filePath, spaceName);
                return;
            }

            const data = await response.json();
            const content = data.content;
            const metadata = data.metadata;

            // Extract TODO items
            const todos = this.extractTodos(content);

            // Update or remove from window.todos
            const existingIndex = window.todos.findIndex(t => t.path === filePath && t.spaceName === spaceName);

            if (todos.length === 0) {
                // Remove if no TODOs found
                if (existingIndex !== -1) {
                    window.todos.splice(existingIndex, 1);
                }
            } else {
                // Update or add
                const fileTodos = {
                    name: filePath.split('/').pop(),
                    path: filePath,
                    space: space.id.toString(),
                    spaceName: spaceName,
                    created: metadata.created || new Date().toISOString(),
                    modified: metadata.modified || new Date().toISOString(),
                    todos: todos
                };

                if (existingIndex !== -1) {
                    window.todos[existingIndex] = fileTodos;
                } else {
                    window.todos.push(fileTodos);
                }
            }

            // Dispatch update event
            window.dispatchEvent(new CustomEvent('todos:updated', {
                detail: { todos: window.todos }
            }));

        } catch (error) {
            console.error('Error scanning single file:', error);
        }
    }

    /**
     * Remove a file from window.todos
     */
    removeFileFromTodos(filePath, spaceName) {
        const index = window.todos.findIndex(t => t.path === filePath && t.spaceName === spaceName);
        if (index !== -1) {
            window.todos.splice(index, 1);
            window.dispatchEvent(new CustomEvent('todos:updated', {
                detail: { todos: window.todos }
            }));
        }
    }
}

// Create and export singleton instance
const todoScanner = new TodoScanner();
window.todoScanner = todoScanner;

export default todoScanner;
