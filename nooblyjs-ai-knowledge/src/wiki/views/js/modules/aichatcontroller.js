/**
 * AI Chat Controller
 * Handles AI chat panel interactions, resizing, and message display
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-03
 */

export const aiChatController = {
    app: null,
    isOpen: false,
    panelWidth: 400,
    chatHistory: [],
    isResizing: false,
    startX: 0,
    startWidth: 0,
    isConfigured: false,
    currentView: 'chat', // 'chat', 'context', or 'editor'
    contextFiles: [],
    currentContextPath: null,
    currentContextFolder: null,

    init(app) {
        this.app = app;
        // Expose controller on app for cross-controller communication
        this.app.aiChatController = this;
        this.loadSavedState();
        this.bindEventListeners();
        // Note: checkAIStatus() and loadChatHistory() are now called after authentication in loadAfterAuth()
    },

    /**
     * Load saved state from localStorage
     */
    loadSavedState() {
        const savedWidth = localStorage.getItem('aiChatPanelWidth');
        const savedCollapsed = localStorage.getItem('aiChatPanelCollapsed');

        if (savedWidth) {
            this.panelWidth = parseInt(savedWidth);
            const panel = document.getElementById('aiChatPanel');
            if (panel) {
                panel.style.width = `${this.panelWidth}px`;
            }
        }

        if (savedCollapsed === 'false') {
            this.openPanel();
        }
    },

    /**
     * Bind all event listeners
     */
    bindEventListeners() {
        // Toggle button
        document.getElementById('aiChatToggleBtn')?.addEventListener('click', () => {
            this.togglePanel();
        });

        // Collapse button inside panel
        document.getElementById('aiChatCollapseBtn')?.addEventListener('click', () => {
            this.closePanel();
        });

        // Clear chat history button
        document.getElementById('aiChatClearBtn')?.addEventListener('click', () => {
            this.clearChatHistory();
        });

        // Chat form submit
        document.getElementById('aiChatForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        // Auto-resize textarea
        const textarea = document.getElementById('aiChatInput');
        if (textarea) {
            textarea.addEventListener('input', () => {
                this.autoResizeTextarea(textarea);
            });

            // Enter to send, Shift+Enter for new line
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        // Resize handle
        const resizeHandle = document.getElementById('aiChatResizeHandle');
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => {
                this.startResize(e);
            });
        }

        // Document-level mouse events for resizing
        document.addEventListener('mousemove', (e) => {
            if (this.isResizing) {
                this.doResize(e);
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isResizing) {
                this.stopResize();
            }
        });

        // Context view toggle
        document.getElementById('aiContextViewToggleBtn')?.addEventListener('click', () => {
            this.toggleContextView();
        });

        // Create context button
        document.getElementById('createContextBtn')?.addEventListener('click', () => {
            this.showCreateContextDialog();
        });

        // Context editor back button
        document.getElementById('contextEditorBackBtn')?.addEventListener('click', () => {
            this.showContextView();
        });

        // Save context button
        document.getElementById('saveContextBtn')?.addEventListener('click', () => {
            this.saveContext();
        });

        // Listen for navigation events to update context view
        window.addEventListener('spaceChanged', (e) => {
            // If context view is open, reload context files for new space
            if (this.currentView === 'context') {
                this.loadContextFiles();
            }
        });

        window.addEventListener('folderChanged', (e) => {
            // If context view is open, reload context files for new folder
            if (this.currentView === 'context') {
                this.loadContextFiles();
            }
        });
    },

    /**
     * Load data that requires authentication
     * Called after user is authenticated from loadInitialData()
     */
    async loadAfterAuth() {
        await this.checkAIStatus();
        await this.loadChatHistory();
    },

    /**
     * Check if AI is configured
     */
    async checkAIStatus() {
        try {
            const response = await fetch('/applications/wiki/api/ai/chat/status');
            if (response.ok) {
                const data = await response.json();
                this.isConfigured = data.configured && data.enabled;
                this.updateWelcomeMessage();
            }
        } catch (error) {
            console.error('Error checking AI status:', error);
            this.isConfigured = false;
        }
    },

    /**
     * Update welcome message based on configuration status
     */
    updateWelcomeMessage() {
        const welcomeDiv = document.querySelector('.ai-chat-welcome');
        if (!welcomeDiv) return;

        if (!this.isConfigured) {
            welcomeDiv.innerHTML = `
                <i class="bi bi-robot" style="font-size: 3rem;"></i>
                <p class="mt-3 mb-1"><strong>AI Assistant Not Configured</strong></p>
                <p class="small">AI settings need to be configured by an administrator</p>
            `;
        } else {
            // Show ready message
            welcomeDiv.innerHTML = `
                <i class="bi bi-robot text-success" style="font-size: 3rem;"></i>
                <p class="mt-3 mb-1"><strong>AI Assistant Ready</strong></p>
                <p class="small">Ask me anything about your wiki documents!</p>
            `;
        }
    },

    /**
     * Load chat history from server
     */
    async loadChatHistory() {
        try {
            const response = await fetch('/applications/wiki/api/ai/chat/history');
            if (response.ok) {
                const data = await response.json();
                this.chatHistory = data.history || [];
                this.renderChatHistory();
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
    },

    /**
     * Render chat history
     */
    renderChatHistory() {
        const messagesContainer = document.getElementById('aiChatMessages');
        if (!messagesContainer) return;

        // Clear existing messages except welcome
        const welcome = messagesContainer.querySelector('.ai-chat-welcome');
        messagesContainer.innerHTML = '';

        if (this.chatHistory.length === 0) {
            if (welcome) {
                messagesContainer.appendChild(welcome);
            }
            return;
        }

        // Render all messages
        this.chatHistory.forEach(entry => {
            // Handle both old format (userMessage, aiResponse, formattedPrompt)
            // and new format (chatContext, chatPrompt, aiResponse)
            if (entry.chatPrompt !== undefined) {
                // New format
                this.appendMessage(entry.chatPrompt, 'user', entry.chatContext || null, false);
                this.appendMessage(entry.aiResponse, 'ai', null, false);
            } else {
                // Old format (backwards compatibility)
                this.appendMessage(entry.userMessage, 'user', null, false);
                this.appendMessage(entry.aiResponse, 'ai', null, false);
            }
        });

        // Scroll to bottom
        this.scrollToBottom();
    },

    /**
     * Toggle panel open/close
     */
    togglePanel() {
        if (this.isOpen) {
            this.closePanel();
        } else {
            this.openPanel();
        }
    },

    /**
     * Open AI chat panel
     */
    openPanel() {
        const panel = document.getElementById('aiChatPanel');

        if (panel) {
            panel.classList.remove('hidden');
            this.isOpen = true;
            localStorage.setItem('aiChatPanelCollapsed', 'false');
        }
    },

    /**
     * Close AI chat panel
     */
    closePanel() {
        const panel = document.getElementById('aiChatPanel');

        if (panel) {
            panel.classList.add('hidden');
            this.isOpen = false;
            localStorage.setItem('aiChatPanelCollapsed', 'true');
        }
    },

    /**
     * Start resizing panel
     */
    startResize(e) {
        this.isResizing = true;
        this.startX = e.clientX;
        this.startWidth = this.panelWidth;

        const resizeHandle = document.getElementById('aiChatResizeHandle');
        if (resizeHandle) {
            resizeHandle.classList.add('resizing');
        }

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    },

    /**
     * Perform resize
     */
    doResize(e) {
        const delta = this.startX - e.clientX;
        const newWidth = this.startWidth + delta;

        const minWidth = 300;
        const maxWidth = 800;

        if (newWidth >= minWidth && newWidth <= maxWidth) {
            this.panelWidth = newWidth;
            const panel = document.getElementById('aiChatPanel');
            if (panel) {
                panel.style.width = `${newWidth}px`;
            }
        }
    },

    /**
     * Stop resizing panel
     */
    stopResize() {
        this.isResizing = false;

        const resizeHandle = document.getElementById('aiChatResizeHandle');
        if (resizeHandle) {
            resizeHandle.classList.remove('resizing');
        }

        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save to localStorage
        localStorage.setItem('aiChatPanelWidth', this.panelWidth);
    },

    /**
     * Auto-resize textarea based on content
     */
    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    },

    /**
     * Send message to AI
     */
    async sendMessage() {
        const textarea = document.getElementById('aiChatInput');
        const message = textarea.value.trim();

        if (!message) return;

        // Check if configured
        if (!this.isConfigured) {
            this.showError('Please configure AI settings first');
            return;
        }

        // Clear input
        textarea.value = '';
        textarea.style.height = 'auto';

        // Show typing indicator
        this.showTypingIndicator();

        // Set status
        this.setStatus('Sending message...');

        // Always show the user message immediately
        const chatPrompt = message;

        try {
            // Build lightweight context from the currently viewed document
            let context = {};
            let formattedPrompt = chatPrompt;
            let contextSummary = '';

            if (this.app.currentDocument && this.app.currentDocument.content) {
                const doc = this.app.currentDocument;
                // Strip images and base64 data to avoid confusing the AI
                const cleanedContent = doc.content
                    .replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '')      // ![alt](data:...) base64 images
                    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')           // ![alt](url) other images
                    .replace(/<img[^>]*>/gi, '')                     // <img> tags
                    .replace(/data:image\/[^\s"')>]+/g, '')         // any remaining data:image URIs
                    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '')     // any long base64 strings (200+ chars)
                    .replace(/\n{3,}/g, '\n\n');                    // collapse excess blank lines
                const docContent = this.truncateToTokenLimit(cleanedContent, 2000);
                console.log('[AI Chat] Document content length: raw=' + doc.content.length + ' cleaned=' + cleanedContent.length + ' truncated=' + docContent.length);
                console.log('[AI Chat] Content preview (first 500 chars):', docContent.substring(0, 500));

                formattedPrompt = `Context:\nThe user is viewing the document: ${doc.title || doc.path}\n\nDocument content:\n${docContent}\n\nQuestion:\n${chatPrompt}`;

                context = {
                    documentTitle: doc.title,
                    documentPath: doc.path
                };

                contextSummary = `Viewing: ${doc.title || doc.path}`;
            }

            // Show user message with context bubble (yellow) and prompt (green)
            this.appendMessage(chatPrompt, 'user', contextSummary);
            const response = await fetch('/applications/wiki/api/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: formattedPrompt,
                    context: context
                })
            });

            console.log('[AI Chat] Step 5: Got response, status:', response.status);
            const data = await response.json();
            console.log('[AI Chat] Step 6: Parsed response:', { success: data.success, hasResponse: !!data.response, error: data.error, message: data.message });

            // Hide typing indicator
            this.hideTypingIndicator();

            if (response.ok) {
                // Add AI response to UI
                this.appendMessage(data.response, 'ai', null);

                // Update local history
                this.chatHistory.push({
                    chatContext: contextSummary,
                    chatPrompt: chatPrompt,
                    aiResponse: data.response,
                    timestamp: data.timestamp,
                    usage: data.usage
                });

                // Update status
                this.setStatus(`Response received (${data.usage?.totalTokens || 0} tokens used)`, 'success');

                // Clear status after 3 seconds
                setTimeout(() => {
                    this.clearStatus();
                }, 3000);
            } else {
                console.error('[AI Chat] Server returned error:', data);
                const errorMsg = data.message || data.error || 'Failed to send message';
                this.showError(errorMsg);
            }
        } catch (error) {
            console.error('[AI Chat] Exception caught:', error);
            this.hideTypingIndicator();
            this.showError(error.message || 'Failed to send message');
        }
    },

    /**
     * Get current context for AI - includes folder and file context
     */
    async getCurrentContext() {
        const context = {};

        // Add current space
        if (this.app.currentSpace) {
            context.spaceName = this.app.currentSpace.name;
            context.includeSpaceContext = true;
        }

        // Determine current folder
        let currentFolderPath = '';
        if (this.app.currentFolder) {
            currentFolderPath = this.app.currentFolder;
        } else if (this.app.currentDocument && this.app.currentDocument.path) {
            const docPath = this.app.currentDocument.path;
            const lastSlash = docPath.lastIndexOf('/');
            if (lastSlash > 0) {
                currentFolderPath = docPath.substring(0, lastSlash);
            }
        }

        // Always include current folder path so AI knows where the user is
        context.folderPath = currentFolderPath || '/';

        // Load folder context if available (.aicontext/folder-context.md)
        if (currentFolderPath || currentFolderPath === '') {
            const folderContextContent = await this.loadFolderContextContent(currentFolderPath);
            if (folderContextContent) {
                context.folderContext = folderContextContent;
            }
        }

        // Add current document context if viewing one
        if (this.app.currentDocument) {
            context.documentTitle = this.app.currentDocument.title;
            context.documentPath = this.app.currentDocument.path;

            // Load file-specific context if available
            const fileContextContent = await this.loadFileContextContent(this.app.currentDocument.path);
            if (fileContextContent) {
                context.fileContext = fileContextContent;
            }

            // Add document content (for preview or editing)
            if (this.app.currentDocument.content) {
                context.documentContent = this.truncateToTokenLimit(this.app.currentDocument.content, 2000);
            }
        }

        return context;
    },

    /**
     * Load folder context content from folder-context.md
     */
    async loadFolderContextContent(folderPath) {
        if (!this.app.currentSpace) return null;

        try {
            const aiContextFolder = folderPath ? `${folderPath}/.aicontext` : '.aicontext';
            const contextFilePath = `${aiContextFolder}/folder-context.md`;
            const spaceName = this.app.currentSpace.name;

            const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(contextFilePath)}&spaceName=${encodeURIComponent(spaceName)}`);

            if (response.ok) {
                const content = await response.text();
                return content.trim() || null;
            }
        } catch (error) {
            // Context file doesn't exist or error loading it
            console.log('No folder context found for', folderPath);
        }

        return null;
    },

    /**
     * Load file-specific context content from {filename}-context.md
     */
    async loadFileContextContent(filePath) {
        if (!this.app.currentSpace || !filePath) return null;

        try {
            // Extract filename without extension
            const fileName = filePath.split('/').pop();
            const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

            // Extract folder path from file path
            const lastSlash = filePath.lastIndexOf('/');
            const folderPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '';

            // Build path to file-specific context file
            const aiContextFolder = folderPath ? `${folderPath}/.aicontext` : '.aicontext';
            const contextFilePath = `${aiContextFolder}/${fileNameWithoutExt}-context.md`;
            const spaceName = this.app.currentSpace.name;

            const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(contextFilePath)}&spaceName=${encodeURIComponent(spaceName)}`);

            if (response.ok) {
                const content = await response.text();
                return content.trim() || null;
            }
        } catch (error) {
            // Context file doesn't exist or error loading it
            console.log('No file context found for', filePath);
        }

        return null;
    },

    /**
     * Truncate text to approximate token limit
     * Rough approximation: 1 token ≈ 4 characters
     */
    truncateToTokenLimit(text, maxTokens) {
        if (!text) return '';

        const maxChars = maxTokens * 4; // Rough approximation
        if (text.length <= maxChars) {
            return text;
        }

        // Truncate and add ellipsis
        return text.substring(0, maxChars) + '\n\n[... content truncated due to length ...]';
    },

    /**
     * Get folder structure for current location
     * Returns a formatted tree structure showing folders and files
     */
    async getFolderStructure() {
        if (!this.app.currentSpace) {
            console.log('[AI Chat] getFolderStructure: no currentSpace');
            return null;
        }

        try {
            // Determine current folder path
            let currentFolderPath = '';
            if (this.app.currentFolder) {
                currentFolderPath = this.app.currentFolder;
            } else if (this.app.currentDocument && this.app.currentDocument.path) {
                const docPath = this.app.currentDocument.path;
                const lastSlash = docPath.lastIndexOf('/');
                if (lastSlash > 0) {
                    currentFolderPath = docPath.substring(0, lastSlash);
                }
            }

            // Fetch folder tree
            const url = `/applications/wiki/api/spaces/${this.app.currentSpace.id}/folders`;
            console.log('[AI Chat] getFolderStructure: fetching', url, 'currentFolder:', currentFolderPath);
            const response = await fetch(url);
            if (!response.ok) {
                console.warn('[AI Chat] getFolderStructure: response not ok, status:', response.status);
                return null;
            }

            const tree = await response.json();
            console.log('[AI Chat] getFolderStructure: tree has', Array.isArray(tree) ? tree.length : 'non-array', 'items');

            // Find the current folder in the tree
            const currentFolder = this.findFolderInTree(tree, currentFolderPath);

            if (!currentFolder) {
                // If we're at root, use the whole tree
                return this.formatFolderStructure(tree, 0);
            }

            // Format the structure for the current folder
            const folderName = currentFolderPath ? currentFolderPath.split('/').pop() : '/';
            let structure = `- ${folderName}\n`;
            if (currentFolder.children && currentFolder.children.length > 0) {
                structure += this.formatFolderStructure(currentFolder.children, 1);
            }

            return structure;
        } catch (error) {
            console.error('Error getting folder structure:', error);
            return null;
        }
    },

    /**
     * Find a specific folder in the tree by path
     */
    findFolderInTree(tree, targetPath) {
        if (!targetPath) return null;

        const pathParts = targetPath.split('/');
        let current = tree;

        for (const part of pathParts) {
            const found = current.find(item => item.name === part && item.type === 'folder');
            if (!found || !found.children) return null;
            current = found.children;
        }

        // Return the folder object (reconstruct it)
        return {
            name: pathParts[pathParts.length - 1],
            type: 'folder',
            children: current
        };
    },

    /**
     * Format folder structure as indented tree
     */
    formatFolderStructure(items, level) {
        if (!items || items.length === 0) return '';

        const indent = '  '.repeat(level);
        const lines = [];

        // Filter out .aicontext folders
        const filteredItems = items.filter(item => item.name !== '.aicontext');

        // Sort: folders first, then files
        filteredItems.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        });

        for (const item of filteredItems) {
            if (item.type === 'folder') {
                lines.push(`${indent}- ${item.name}/`);
                if (item.children && item.children.length > 0) {
                    lines.push(this.formatFolderStructure(item.children, level + 1));
                }
            } else if (item.type === 'document') {
                lines.push(`${indent}- ${item.name}`);
            }
        }

        return lines.join('\n');
    },

    /**
     * Build context string separately for storage
     * Returns the Context section as a string (without the Question section)
     */
    async buildContextString(context) {
        const parts = [];

        // Check if we have any context to add
        const hasFolderContext = context.folderContext && context.folderContext.trim();
        const hasFileContext = context.fileContext && context.fileContext.trim();
        const hasFileContent = context.documentContent && context.documentContent.trim();

        // Get folder structure
        const folderStructure = await this.getFolderStructure();
        const hasFolderStructure = folderStructure && folderStructure.trim();

        // Only add Context section if we have any context
        if (!hasFolderContext && !hasFileContext && !hasFileContent && !hasFolderStructure) {
            return ''; // No context available
        }

        parts.push('Context:');

        // Add folder context if available
        if (hasFolderContext) {
            parts.push(`This folder is described as ${context.folderContext}`);
        }

        // Add file context if available
        if (hasFileContext) {
            parts.push(`The file is described as ${context.fileContext}`);
        }

        // Add file content if available
        if (hasFileContent) {
            parts.push(`The file content is ${context.documentContent}`);
        }

        // Add folder structure if available
        if (hasFolderStructure) {
            parts.push('');
            parts.push('And just some more information for context here is the structure the user is in');
            parts.push(folderStructure);
        }

        return parts.join('\n');
    },

    /**
     * Build formatted prompt with context
     * Format based on whether we have folder context, file context, and file content
     */
    async buildFormattedPrompt(userQuestion, context) {
        const parts = [];

        // Check what context we have
        const hasFolderContext = context.folderContext && context.folderContext.trim();
        const hasFileContext = context.fileContext && context.fileContext.trim();
        const hasFileContent = context.documentContent && context.documentContent.trim();
        const hasFolderPath = context.folderPath && context.folderPath !== '/';
        const hasDocumentPath = context.documentPath;

        // Get folder structure (limit to ~2000 tokens / ~8000 chars to avoid oversized prompts)
        let folderStructure = null;
        try {
            folderStructure = await this.getFolderStructure();
            if (folderStructure && folderStructure.length > 8000) {
                console.log('[AI Chat] getFolderStructure: truncating from', folderStructure.length, 'to 8000 chars');
                folderStructure = folderStructure.substring(0, 8000) + '\n... (structure truncated)';
            }
            console.log('[AI Chat] getFolderStructure result:', folderStructure ? `${folderStructure.length} chars` : 'null');
        } catch (e) {
            console.warn('[AI Chat] getFolderStructure failed:', e.message);
        }
        const hasFolderStructure = folderStructure && folderStructure.trim();

        // Always add context section - at minimum include where the user is
        parts.push('Context:');

        // Tell AI where the user is
        if (context.spaceName) {
            parts.push(`The user is in the wiki space "${context.spaceName}".`);
        }
        if (hasFolderPath) {
            parts.push(`The user is currently in the folder: ${context.folderPath}`);
        }
        if (hasDocumentPath) {
            parts.push(`The user is viewing the document: ${context.documentPath}`);
        }

        // Add folder context description if available (.aicontext file)
        if (hasFolderContext) {
            parts.push(`This folder is described as: ${context.folderContext}`);
        }

        // Add file context if available
        if (hasFileContext) {
            parts.push(`The file is described as: ${context.fileContext}`);
        }

        // Add file content if available
        if (hasFileContent) {
            parts.push(`The file content is:\n${context.documentContent}`);
        }

        // Add folder structure if available
        if (hasFolderStructure) {
            parts.push('');
            parts.push('Here is the folder/file structure the user is currently in:');
            parts.push(folderStructure);
        }

        parts.push(''); // Empty line before Question section

        // Add the question
        parts.push('Question:');
        parts.push(userQuestion);

        const fullPrompt = parts.join('\n');
        console.log('[AI Chat] Full prompt length:', fullPrompt.length, 'chars');

        // Check if we exceed token limit (approximately 16k characters = 4k tokens)
        if (fullPrompt.length > 16000) {
            console.log('[AI Chat] Prompt too long, truncating...');
            // Rebuild with truncated content, keeping essential location context
            const truncatedParts = [];
            truncatedParts.push('Context:');

            if (context.spaceName) {
                truncatedParts.push(`The user is in the wiki space "${context.spaceName}".`);
            }
            if (hasFolderPath) {
                truncatedParts.push(`The user is currently in the folder: ${context.folderPath}`);
            }
            if (hasDocumentPath) {
                truncatedParts.push(`The user is viewing the document: ${context.documentPath}`);
            }
            if (hasFolderContext) {
                truncatedParts.push(`This folder is described as: ${this.truncateToTokenLimit(context.folderContext, 500)}`);
            }
            if (hasFileContext) {
                truncatedParts.push(`The file is described as: ${this.truncateToTokenLimit(context.fileContext, 500)}`);
            }
            if (hasFileContent) {
                truncatedParts.push(`The file content is:\n${this.truncateToTokenLimit(context.documentContent, 1500)}`);
            }
            if (hasFolderStructure) {
                truncatedParts.push('');
                truncatedParts.push('Here is the folder/file structure:');
                truncatedParts.push(this.truncateToTokenLimit(folderStructure, 1000));
            }

            truncatedParts.push('');
            truncatedParts.push('Question:');
            truncatedParts.push(userQuestion);

            const truncated = truncatedParts.join('\n');
            console.log('[AI Chat] Truncated prompt length:', truncated.length, 'chars');
            return truncated;
        }

        return fullPrompt;
    },

    /**
     * Append message to chat
     * For user messages: content = chatPrompt, contextData = chatContext string
     * For AI messages: content = aiResponse, contextData = null
     */
    appendMessage(content, type, contextData = null, scroll = true) {
        const messagesContainer = document.getElementById('aiChatMessages');
        if (!messagesContainer) return;

        // Remove welcome message if it exists
        const welcome = messagesContainer.querySelector('.ai-chat-welcome');
        if (welcome) {
            welcome.remove();
        }

        // If this is a user message with context, add the context bubble first
        if (type === 'user' && contextData && contextData.trim()) {
            const contextBubble = document.createElement('div');
            contextBubble.className = 'context-bubble';

            // Create collapsible structure
            const contextHeader = document.createElement('div');
            contextHeader.className = 'context-header';
            contextHeader.innerHTML = `
                <span class="context-heading">Context</span>
                <button class="context-toggle-btn" aria-label="Toggle context">
                    <i class="bi bi-plus-lg"></i>
                </button>
            `;

            const contextContent = document.createElement('div');
            contextContent.className = 'context-content collapsed';
            contextContent.textContent = contextData;

            contextBubble.appendChild(contextHeader);
            contextBubble.appendChild(contextContent);

            // Add click event to toggle collapse
            contextHeader.addEventListener('click', () => {
                const isCollapsed = contextContent.classList.contains('collapsed');
                contextContent.classList.toggle('collapsed');
                const icon = contextHeader.querySelector('.context-toggle-btn i');
                icon.className = isCollapsed ? 'bi bi-dash-lg' : 'bi bi-plus-lg';
            });

            messagesContainer.appendChild(contextBubble);
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = type === 'user' ? 'user-message' : 'ai-message';

        if (type === 'ai') {
            // Render markdown for AI messages
            messageDiv.innerHTML = this.renderMarkdown(content);
        } else {
            messageDiv.textContent = content;
        }

        messagesContainer.appendChild(messageDiv);

        if (scroll) {
            this.scrollToBottom();
        }
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Render markdown content
     */
    renderMarkdown(content) {
        if (typeof marked !== 'undefined') {
            return parseMarkdown(content);
        }
        // Fallback to plain text if marked is not available
        return content.replace(/\n/g, '<br>');
    },

    /**
     * Show typing indicator
     */
    showTypingIndicator() {
        const messagesContainer = document.getElementById('aiChatMessages');
        if (!messagesContainer) return;

        const typingDiv = document.createElement('div');
        typingDiv.className = 'ai-typing-indicator';
        typingDiv.id = 'aiTypingIndicator';
        typingDiv.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;

        messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    },

    /**
     * Hide typing indicator
     */
    hideTypingIndicator() {
        const typingIndicator = document.getElementById('aiTypingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    },

    /**
     * Show error message
     */
    showError(message) {
        this.setStatus(message, 'error');

        // Also show in chat
        const messagesContainer = document.getElementById('aiChatMessages');
        if (!messagesContainer) return;

        const errorDiv = document.createElement('div');
        errorDiv.className = 'ai-error-message';
        errorDiv.innerHTML = `
            <i class="bi bi-exclamation-triangle me-2"></i>
            ${message}
        `;

        messagesContainer.appendChild(errorDiv);
        this.scrollToBottom();

        // Clear status after 5 seconds
        setTimeout(() => {
            this.clearStatus();
        }, 5000);
    },

    /**
     * Set status text
     */
    setStatus(text, type = '') {
        const statusEl = document.getElementById('aiChatStatus');
        const statusText = document.getElementById('aiChatStatusText');

        if (statusEl && statusText) {
            statusEl.className = 'ai-chat-status text-muted small px-2 py-1';
            if (type) {
                statusEl.classList.add(type);
            }
            statusText.textContent = text;
        }
    },

    /**
     * Clear status
     */
    clearStatus() {
        const statusText = document.getElementById('aiChatStatusText');
        const statusEl = document.getElementById('aiChatStatus');

        if (statusText) {
            statusText.textContent = '';
        }
        if (statusEl) {
            statusEl.className = 'ai-chat-status text-muted small px-2 py-1';
        }
    },

    /**
     * Clear chat history
     */
    async clearChatHistory() {
        if (!confirm('Are you sure you want to clear all chat history? This cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch('/applications/wiki/api/ai/chat/clear', {
                method: 'POST'
            });

            if (response.ok) {
                this.chatHistory = [];
                const messagesContainer = document.getElementById('aiChatMessages');
                if (messagesContainer) {
                    messagesContainer.innerHTML = `
                        <div class="ai-chat-welcome text-center text-muted p-4">
                            <i class="bi bi-robot" style="font-size: 3rem;"></i>
                            <p class="mt-3 mb-1"><strong>Chat history cleared</strong></p>
                            <p class="small">Start a new conversation!</p>
                        </div>
                    `;
                }

                this.app.showNotification('Chat history cleared', 'success');
            } else {
                throw new Error('Failed to clear chat history');
            }
        } catch (error) {
            console.error('Error clearing chat history:', error);
            this.app.showNotification('Failed to clear chat history', 'error');
        }
    },

    /**
     * Scroll to bottom of messages
     */
    scrollToBottom() {
        const messagesContainer = document.getElementById('aiChatMessages');
        if (messagesContainer) {
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 100);
        }
    },

    /**
     * Toggle between chat and context view
     */
    toggleContextView() {
        if (this.currentView === 'chat') {
            this.showContextView();
        } else {
            this.showChatView();
        }
    },

    /**
     * Show chat view
     */
    showChatView() {
        this.currentView = 'chat';

        document.getElementById('aiChatMessages').classList.remove('hidden');
        document.getElementById('aiContextView').classList.add('hidden');
        document.getElementById('aiContextEditor').classList.add('hidden');
        document.getElementById('aiChatForm').parentElement.classList.remove('hidden');

        document.getElementById('aiChatHeaderTitle').textContent = 'AI Assistant';

        const toggleBtn = document.getElementById('aiContextViewToggleBtn');
        toggleBtn.classList.remove('active');
        // Change icon to folder when in chat view
        toggleBtn.querySelector('i').className = 'bi bi-folder-symlink';
    },

    /**
     * Show context view and load context files
     */
    async showContextView() {
        this.currentView = 'context';

        document.getElementById('aiChatMessages').classList.add('hidden');
        document.getElementById('aiContextView').classList.remove('hidden');
        document.getElementById('aiContextEditor').classList.add('hidden');
        document.getElementById('aiChatForm').parentElement.classList.add('hidden');

        document.getElementById('aiChatHeaderTitle').textContent = 'AI Context Manager';

        const toggleBtn = document.getElementById('aiContextViewToggleBtn');
        toggleBtn.classList.add('active');
        // Change icon to robot when in context view
        toggleBtn.querySelector('i').className = 'bi bi-robot';

        await this.loadContextFiles();
    },

    /**
     * Load context files for current space filtered by current folder
     */
    async loadContextFiles() {
        const space = this.app.currentSpace;

        if (!space) {
            this.showContextError('No space selected');
            return;
        }

        try {
            // Determine the current folder context
            // Priority: 1) currentFolder from navigation, 2) currentDocument's folder, 3) root
            let currentFolderPath = '';

            if (this.app.currentFolder) {
                // User is viewing a folder in navigation
                currentFolderPath = this.app.currentFolder;
            } else if (this.app.currentDocument && this.app.currentDocument.path) {
                // User is viewing a document - extract folder from document path
                const docPath = this.app.currentDocument.path;
                const lastSlash = docPath.lastIndexOf('/');
                if (lastSlash > 0) {
                    currentFolderPath = docPath.substring(0, lastSlash);
                }
            }
            // If neither is set, currentFolderPath remains '' (root)

            // Use the existing folder tree API
            const response = await fetch(`/applications/wiki/api/spaces/${space.id}/folders`);

            if (!response.ok) {
                throw new Error('Failed to load folder tree');
            }

            const tree = await response.json();

            // Recursively find all .aicontext folders, filtered by current folder
            this.contextFiles = this.findAiContextFolders(tree, '', currentFolderPath);
            this.renderContextFiles();
        } catch (error) {
            console.error('Error loading context files:', error);
            this.showContextError('Failed to load context files');
        }
    },

    /**
     * Recursively find all .aicontext folders in the tree, filtered by current folder
     */
    findAiContextFolders(tree, parentPath, currentFolderPath) {
        const contextFiles = [];

        for (const item of tree) {
            const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name;

            if (item.type === 'folder') {
                if (item.name === '.aicontext') {
                    // Found an .aicontext folder
                    // Only add if this .aicontext folder is in the current folder
                    if (parentPath === currentFolderPath) {
                        // Check if it has a folder-context.md file
                        const hasContextMd = item.children?.some(child =>
                            child.type === 'document' && child.name === 'folder-context.md'
                        );

                        // Add folder context
                        contextFiles.push({
                            folder: parentPath || '/',
                            contextPath: currentPath,
                            contextFile: `${currentPath}/folder-context.md`,
                            exists: hasContextMd,
                            type: 'folder'
                        });

                        // Also find all file-specific context files (ending with -context.md but not folder-context.md)
                        if (item.children) {
                            for (const child of item.children) {
                                if (child.type === 'document' &&
                                    child.name.endsWith('-context.md') &&
                                    child.name !== 'folder-context.md') {
                                    // Extract the base filename without -context.md
                                    const baseName = child.name.replace(/-context\.md$/, '');
                                    contextFiles.push({
                                        folder: parentPath || '/',
                                        contextPath: currentPath,
                                        contextFile: `${currentPath}/${child.name}`,
                                        exists: true,
                                        type: 'file',
                                        fileName: baseName
                                    });
                                }
                            }
                        }
                    }
                } else if (item.children && item.children.length > 0) {
                    // Recursively search in subdirectories
                    const subContexts = this.findAiContextFolders(item.children, currentPath, currentFolderPath);
                    contextFiles.push(...subContexts);
                }
            }
        }

        return contextFiles;
    },

    /**
     * Render context files list
     */
    renderContextFiles() {
        const listContainer = document.getElementById('aiContextList');

        if (this.contextFiles.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center text-muted p-4">
                    <i class="bi bi-folder-symlink" style="font-size: 3rem;"></i>
                    <p class="mt-3 mb-1"><strong>No context files found</strong></p>
                    <p class="small">Create context for folders to help AI understand your documents</p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = `
            <div class="list-group list-group-flush">
                ${this.contextFiles.map(ctx => {
                    const icon = ctx.type === 'file' ? 'bi-file-text' : 'bi-folder';
                    const label = ctx.type === 'file' ? `${ctx.fileName} (file)` : ctx.folder || '/';
                    const subLabel = ctx.type === 'file' ? `${ctx.folder || '/'}` : ctx.contextFile;

                    return `
                        <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                             data-context-path="${ctx.contextFile}"
                             data-folder="${ctx.folder}">
                            <div>
                                <i class="bi ${icon} me-2"></i>
                                <strong>${label}</strong>
                                <div class="small text-muted">${subLabel}</div>
                            </div>
                            <div>
                                ${ctx.exists ? '<span class="badge bg-success">Exists</span>' : '<span class="badge bg-secondary">New</span>'}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Add click handlers
        listContainer.querySelectorAll('.list-group-item').forEach(item => {
            item.addEventListener('click', () => {
                const contextPath = item.dataset.contextPath;
                const folder = item.dataset.folder;
                this.openContextEditor(contextPath, folder);
            });
        });
    },

    /**
     * Show create context dialog
     */
    async showCreateContextDialog() {
        const space = this.app.currentSpace;

        if (!space) {
            alert('Please select a space first');
            return;
        }

        // Automatically detect current folder from app state
        // Priority: 1) currentFolder from navigation, 2) currentDocument's folder, 3) root
        let folderPath = '';

        if (this.app.currentFolder) {
            // User is viewing a folder in navigation
            folderPath = this.app.currentFolder;
        } else if (this.app.currentDocument && this.app.currentDocument.path) {
            // User is viewing a document - extract folder from document path
            const docPath = this.app.currentDocument.path;
            const lastSlash = docPath.lastIndexOf('/');
            if (lastSlash > 0) {
                folderPath = docPath.substring(0, lastSlash);
            }
        }
        // If neither is set, folderPath remains '' (root)

        // Show confirmation with detected folder
        const displayPath = folderPath || '/ (root)';
        const confirmed = confirm(`Create AI context for folder:\n${displayPath}\n\nClick OK to continue or Cancel to abort.`);

        if (!confirmed) return;

        this.currentContextFolder = folderPath;
        this.currentContextPath = null;

        this.openContextEditor(null, folderPath);
    },

    /**
     * Open file-specific context editor
     * Called when user clicks "Add Context" on a file
     */
    async openFileContext(filePath) {
        if (!filePath) {
            console.error('No file path provided');
            return;
        }

        // Show AI panel if not already shown
        if (!this.isOpen) {
            this.openPanel();
        }

        // Switch to context view
        await this.showContextView();

        // Extract filename without extension
        const fileName = filePath.split('/').pop();
        const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

        // Extract folder path from file path
        const lastSlash = filePath.lastIndexOf('/');
        const folderPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '';

        // Build path to file-specific context file
        const aiContextFolder = folderPath ? `${folderPath}/.aicontext` : '.aicontext';
        const contextFilePath = `${aiContextFolder}/${fileNameWithoutExt}-context.md`;

        // Open the context editor with the file-specific context path
        this.currentContextFolder = folderPath;
        this.currentContextPath = contextFilePath;

        // Switch to editor view
        await this.openContextEditor(contextFilePath, folderPath);
    },

    /**
     * Open context editor
     */
    async openContextEditor(contextPath, folder) {
        this.currentView = 'editor';
        this.currentContextPath = contextPath;
        this.currentContextFolder = folder;

        document.getElementById('aiContextView').classList.add('hidden');
        document.getElementById('aiContextEditor').classList.remove('hidden');

        document.getElementById('contextEditorPath').textContent = folder || '/';

        const textarea = document.getElementById('contextEditorTextarea');

        if (contextPath) {
            // Load existing context using document content API
            try {
                const spaceName = this.app.currentSpace?.name;
                const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(contextPath)}&spaceName=${encodeURIComponent(spaceName)}`);

                if (response.ok) {
                    const content = await response.text();
                    textarea.value = content || '';
                } else {
                    textarea.value = '';
                }
            } catch (error) {
                console.error('Error loading context:', error);
                textarea.value = '';
            }
        } else {
            textarea.value = '';
        }
    },

    /**
     * Save context file
     */
    async saveContext() {
        const space = this.app.currentSpace;

        if (!space) {
            alert('No space selected');
            return;
        }

        const content = document.getElementById('contextEditorTextarea').value;

        try {
            // Use currentContextPath if set (for file-specific contexts), otherwise build folder context path
            let contextFilePath;
            if (this.currentContextPath) {
                contextFilePath = this.currentContextPath;
            } else {
                // Build the path to the folder-context.md file
                const folderPath = this.currentContextFolder || '';
                const aiContextFolderPath = folderPath ? `${folderPath}/.aicontext` : '.aicontext';
                contextFilePath = `${aiContextFolderPath}/folder-context.md`;
            }

            // First, ensure .aicontext folder exists
            const folderPath = this.currentContextFolder || '';
            try {
                await fetch('/applications/wiki/api/folders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: '.aicontext',
                        spaceId: space.id,
                        parentPath: folderPath
                    })
                });
                // Folder created or already exists, continue
            } catch (folderError) {
                // Folder might already exist, that's OK
                console.log('Folder creation response (may already exist):', folderError);
            }

            // Now save the context file using document save API
            const response = await fetch('/applications/wiki/api/documents/content', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    spaceName: space.name,
                    path: contextFilePath,
                    content: content
                })
            });

            if (response.ok) {
                this.app.showNotification('Context saved successfully', 'success');
                this.showContextView();
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save context');
            }
        } catch (error) {
            console.error('Error saving context:', error);
            this.app.showNotification('Failed to save context: ' + error.message, 'error');
        }
    },

    /**
     * Show context error
     */
    showContextError(message) {
        const listContainer = document.getElementById('aiContextList');
        listContainer.innerHTML = `
            <div class="text-center text-danger p-4">
                <i class="bi bi-exclamation-triangle" style="font-size: 3rem;"></i>
                <p class="mt-3 mb-1"><strong>Error</strong></p>
                <p class="small">${message}</p>
            </div>
        `;
    }
};
