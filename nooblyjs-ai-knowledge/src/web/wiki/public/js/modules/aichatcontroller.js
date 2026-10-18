/**
 * AI Chat Controller
 * Handles AI chat panel interactions, resizing, and message display
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-03
 */

import { answerActions } from './answerActions.js';
import { documentController } from "./documentcontroller.js";

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
    // In-flight single-file context regeneration, at most one at a time:
    // { contextPath, btn, timer, executionId }. See regenerateContext().
    _ctxRegen: null,

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
            if (panel) panel.style.width = this.panelWidth + 'px';
        }

        if (savedCollapsed === 'true') {
            this.closePanel();
        } else {
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

        // Scope toggle (current folder/page vs whole wiki). A manual change is
        // remembered for the current location so re-labelling doesn't clobber it;
        // navigating to a new folder/space resets it back to the auto default.
        document.getElementById('aiChatScopeToggle')?.addEventListener('change', () => {
            this.scopeUserSet = true;
            this.updateScopeControl(true);
        });

        // Switching persona (e.g. into the full Chat layout) changes whether the
        // scope toggle applies — refresh its visibility right after the switch.
        document.getElementById('layoutSwitch')?.addEventListener('click', () => {
            setTimeout(() => this.updateScopeControl(true), 0);
        });

        // Auto-resize textarea
        const textarea = document.getElementById('aiChatInput');
        if (textarea) {
            textarea.addEventListener('input', () => {
                this.autoResizeTextarea(textarea);
            });

            // Refresh the scope label against the live location each time the user
            // returns to the input (covers opening a document, which fires no event).
            textarea.addEventListener('focus', () => {
                this.updateScopeControl(true);
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

        // Regenerate the open document's context (editor view)
        document.getElementById('regenerateContextBtn')?.addEventListener('click', (e) => {
            this.regenerateContext(this.currentContextPath, e.currentTarget);
        });

        // Listen for navigation events to update context view
        window.addEventListener('spaceChanged', (e) => {
            // If context view is open, reload context files for new space
            if (this.currentView === 'context') {
                this.loadContextFiles();
            }
            // New space → fall back to the auto scope default and relabel.
            this.scopeUserSet = false;
            this.updateScopeControl(false);
        });

        window.addEventListener('folderChanged', (e) => {
            // If context view is open, reload context files for new folder
            if (this.currentView === 'context') {
                this.loadContextFiles();
            }
            // New folder → auto-scope to it (unless the user later unticks).
            this.scopeUserSet = false;
            this.updateScopeControl(false);
        });
    },

    /** True when the dedicated full-page Chat layout is active (vs the docked panel). */
    isChatLayout() {
        return document.getElementById('wikiApp')?.dataset.layout === 'chat';
    },

    /**
     * Resolve the current folder scope from app state. Returns
     * { folderPath, folderName, spaceName } (paths normalised to forward slashes,
     * matching what the search API expects) or null when there's nothing to scope
     * to (e.g. at the wiki/space root with no document open).
     */
    getFolderScopeContext() {
        const app = this.app || {};
        let folderPath = '';
        if (app.currentFolder) {
            folderPath = app.currentFolder;
        } else if (app.currentDocument && app.currentDocument.path) {
            const p = app.currentDocument.path;
            const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
            folderPath = i > 0 ? p.substring(0, i) : '';
        }
        folderPath = String(folderPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!folderPath) return null;
        const parts = folderPath.split('/');
        return {
            folderPath,
            folderName: parts[parts.length - 1] || folderPath,
            spaceName: (app.currentSpace && app.currentSpace.name) || ''
        };
    },

    /**
     * Show/refresh the scope toggle row beneath the chat input.
     * @param {boolean} preserveChecked - keep the current tick state (true when the
     *   label is just refreshing); when false the box is reset to the auto default.
     */
    updateScopeControl(preserveChecked) {
        const row = document.getElementById('aiChatScope');
        const toggle = document.getElementById('aiChatScopeToggle');
        const text = document.getElementById('aiChatScopeText');
        const icon = document.getElementById('aiChatScopeIcon');
        const label = document.getElementById('aiChatScopeLabel');
        if (!row || !toggle) return;

        const isFileOpen = !!(this.app && this.app.currentDocument && this.app.currentDocument.path);
        const ctx = this.getFolderScopeContext();

        // In the dedicated Chat layout the assistant always searches the whole
        // wiki, so the scope toggle is irrelevant — keep it hidden there.
        if (this.isChatLayout()) {
            row.style.display = 'none';
            return;
        }

        // Nothing to scope to → hide the control; the chat searches the whole wiki.
        if (!isFileOpen && !ctx) {
            row.style.display = 'none';
            return;
        }
        row.style.display = 'flex';

        // Auto-scope default: tick on a fresh location unless the user overrode it.
        if (!preserveChecked && !this.scopeUserSet) {
            toggle.checked = true;
        }

        const scoped = toggle.checked;
        if (icon) icon.className = scoped ? (isFileOpen ? 'bi bi-file-earmark-text' : 'bi bi-folder2-open') : 'bi bi-globe2';
        if (isFileOpen) {
            const docTitle = (this.app.currentDocument.title || this.app.currentDocument.name || 'this page');
            if (text) text.textContent = scoped ? 'Only this page' : 'Searching the whole wiki';
            if (label) label.title = scoped
                ? `The assistant answers only from “${docTitle}”. Untick to search the whole wiki.`
                : 'The assistant searches the whole wiki. Tick to limit it to this page.';
        } else if (ctx) {
            if (text) text.textContent = scoped ? `Only within “${ctx.folderName}”` : 'Searching the whole wiki';
            if (label) label.title = scoped
                ? `The assistant searches only “${ctx.folderName}” and its subfolders. Untick to search the whole wiki.`
                : 'The assistant searches the whole wiki. Tick to limit it to this folder.';
        }
    },

    /**
     * Authoritative scope at send time — reads live app state so the request is
     * correct even if the label lagged. Returns
     * { mode: 'file'|'folder'|'wiki', folderPath, spaceName }.
     */
    getChatScope() {
        // The dedicated Chat layout is a wiki-wide surface — it always searches
        // across the whole wiki, never "this page"/"this folder".
        if (this.isChatLayout()) {
            return { mode: 'wiki', folderPath: '', spaceName: '' };
        }
        const row = document.getElementById('aiChatScope');
        const toggle = document.getElementById('aiChatScopeToggle');
        const scoped = !!(toggle && toggle.checked && row && row.style.display !== 'none');
        const isFileOpen = !!(this.app && this.app.currentDocument && this.app.currentDocument.path);

        if (isFileOpen) {
            // Ticked → answer over the open page; unticked → search the whole wiki.
            return { mode: scoped ? 'file' : 'wiki', folderPath: '', spaceName: '' };
        }
        const ctx = this.getFolderScopeContext();
        if (scoped && ctx) {
            return { mode: 'folder', folderPath: ctx.folderPath, spaceName: ctx.spaceName, folderName: ctx.folderName };
        }
        return { mode: 'wiki', folderPath: '', spaceName: '' };
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
                // Asking the wiki works without a model too: the server answers from the
                // sources' own passages (NooblyJS Phase 8), so the panel is usable either way.
                this.isConfigured = (data.configured && data.enabled) || Boolean(data.searchWithoutModel);
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
                <div class="glyph"><i class="bi bi-robot"></i></div>
                <h4>AI Assistant Not Configured</h4>
                <p>AI settings need to be configured by an administrator</p>
            `;
        } else {
            welcomeDiv.innerHTML = `
                <div class="glyph"><i class="bi bi-robot"></i></div>
                <h4>AI Assistant Ready</h4>
                <p>Ask me anything about your wiki documents!</p>
                <div class="kr-ai-prompt"><div class="pico a"><i class="bi bi-search"></i></div><div class="ptxt"><strong>Find a document</strong><span>by capability or topic</span></div></div>
                <div class="kr-ai-prompt"><div class="pico b"><i class="bi bi-card-list"></i></div><div class="ptxt"><strong>Summarize this space</strong><span>recent activity at a glance</span></div></div>
                <div class="kr-ai-prompt"><div class="pico c"><i class="bi bi-diagram-3"></i></div><div class="ptxt"><strong>Explain a diagram</strong><span>describe in plain language</span></div></div>
            `;
        }
    },

    /**
     * Load chat history from server
     */
    async loadChatHistory() {
        try {
            const sp = this.app?.currentSpace?.name;
            const qs = sp ? `?space=${encodeURIComponent(sp)}` : '';
            const response = await fetch(`/applications/wiki/api/ai/chat/history${qs}`);
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
                // Old format: userMessage may be the full formatted prompt
                // ("Context:\n...\n\nQuestion:\n<q>"). Split it so the context
                // renders in the collapsible bubble and only the question
                // shows in the green user bubble.
                const { chatPrompt, contextData } = this.splitStoredUserMessage(entry.userMessage || '');
                this.appendMessage(chatPrompt, 'user', contextData, false);

                // Search-mode entries get the clickable-sources renderer so
                // citations like [1] open the matching document.
                if (entry.context && entry.context.mode === 'search' && Array.isArray(entry.context.sources)) {
                    this.appendSearchAnswer(entry.aiResponse, entry.context.sources, entry.context.answerId || null);
                } else {
                    this.appendMessage(entry.aiResponse, 'ai', null, false);
                }
            }
        });

        // Scroll to bottom
        this.scrollToBottom();
    },

    /**
     * Split a stored userMessage that may be the full formatted prompt
     * ("Context:\n...\n\nQuestion:\n<question>") back into its parts so the
     * context renders in the collapsible bubble and the question in the user
     * bubble. Returns { chatPrompt, contextData } with contextData = null
     * when no Context/Question structure is present (e.g. search-mode rows
     * that store the raw question).
     */
    splitStoredUserMessage(userMessage) {
        if (!userMessage) return { chatPrompt: '', contextData: null };

        // Use the last "\nQuestion:\n" so document content that happens to
        // contain the word "Question:" can't fool the split.
        const marker = '\nQuestion:\n';
        const questionIndex = userMessage.lastIndexOf(marker);
        if (questionIndex === -1) {
            return { chatPrompt: userMessage, contextData: null };
        }

        const chatPrompt = userMessage.substring(questionIndex + marker.length).trim();
        let contextPart = userMessage.substring(0, questionIndex).trim();
        contextPart = contextPart.replace(/^Context:\s*\n?/, '').trim();

        return {
            chatPrompt: chatPrompt || userMessage,
            contextData: contextPart || null
        };
    },

    /**
     * Reset the on-screen conversation to a fresh, empty state without touching
     * the server. Used by the chat-first layout's "New chat" button — the
     * outgoing conversation is snapshotted client-side by layoutController first.
     */
    startNewConversation() {
        this.chatHistory = [];
        const messagesContainer = document.getElementById('aiChatMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="ai-chat-welcome kr-ai-greet">
                    <div class="glyph"><i class="bi bi-robot"></i></div>
                    <h4>AI Assistant</h4>
                    <p>Ask me anything about your wiki documents!</p>
                </div>
            `;
        }
        this.updateWelcomeMessage();
        this.clearStatus();
    },

    /**
     * Replace the on-screen conversation with a saved one. Continuing the chat
     * afterwards appends to it as usual.
     */
    loadConversation(history) {
        this.chatHistory = Array.isArray(history) ? history.slice() : [];
        this.renderChatHistory();
        this.clearStatus();
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
            // Sync the scope label to wherever the user currently is.
            this.updateScopeControl(false);
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
            if (panel) panel.style.width = newWidth + 'px';
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

        // Surface this conversation in the chat-first "Recent" sidebar the moment
        // the user sends — it should appear right away, not only after "New chat".
        try { this.app?.layoutController?.noteChatActivity?.(chatPrompt); } catch { /* sidebar is optional */ }

        try {
            // Scope comes from the toggle (read live): 'file' answers over the open
            // page; 'folder'/'wiki' run the search-then-answer flow, constrained to
            // the current folder subtree or the whole index respectively.
            const scope = this.getChatScope();
            const searchContextLabel = scope.mode === 'folder'
                ? `Searching “${scope.folderName}”…`
                : 'Searching wiki...';
            if (scope.mode !== 'file') {
                this.appendMessage(chatPrompt, 'user', searchContextLabel);
                this.setStatus(scope.mode === 'folder'
                    ? `Searching within “${scope.folderName}” and summarizing results...`
                    : 'Searching wiki and summarizing top results...');

                const searchResp = await fetch('/applications/wiki/api/ai/chat/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: chatPrompt,
                        folderPath: scope.folderPath || '',
                        spaceName: scope.spaceName || ''
                    })
                });
                this.hideTypingIndicator();

                // Read as text first so a non-JSON body (e.g. 404 HTML, empty body
                // from a timeout) yields a useful error instead of a parse exception.
                const rawBody = await searchResp.text();
                let searchData = null;
                try {
                    searchData = rawBody ? JSON.parse(rawBody) : null;
                } catch (parseErr) {
                    console.error('[AI Chat] Search response was not JSON. Status:', searchResp.status, 'Body:', rawBody.slice(0, 500));
                    this.showError(`Search failed (HTTP ${searchResp.status}): server returned a non-JSON response. Backend may need to be restarted to pick up the new /ai/chat/search route.`);
                    return;
                }

                if (!searchResp.ok || !searchData) {
                    const errorMsg = (searchData && (searchData.message || searchData.error)) || `Failed to search the wiki (HTTP ${searchResp.status})`;
                    this.showError(errorMsg);
                    return;
                }

                this.appendSearchAnswer(searchData.response, searchData.sources || [], searchData.answerId || null);
                this.chatHistory.push({
                    chatContext: searchContextLabel,
                    chatPrompt,
                    aiResponse: searchData.response,
                    timestamp: searchData.timestamp,
                    sources: searchData.sources || []
                });
                // Keep the Recent sidebar's saved copy in step with the reply.
                try { this.app?.layoutController?.noteChatActivity?.(); } catch { /* sidebar is optional */ }
                // The backend distills conversational messages to keyword terms
                // before searching; surface what it actually searched for.
                const sourceCount = (searchData.sources || []).length;
                this.setStatus(searchData.searchQuery
                    ? `Searched for “${searchData.searchQuery}” — answered from ${sourceCount} sources`
                    : `Answered from ${sourceCount} sources`, 'success');
                setTimeout(() => this.clearStatus(), 3000);
                return;
            }

            // A document is open: answer over its ENTIRE content. The backend
            // reads the whole document section by section (sequential refine)
            // rather than truncating it, so questions about anything past the
            // first few thousand characters are answered correctly.
            const doc = this.app.currentDocument;
            // Strip images and base64 data to avoid confusing the AI
            const cleanedContent = (doc.content || '')
                .replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '')      // ![alt](data:...) base64 images
                .replace(/!\[[^\]]*\]\([^)]*\)/g, '')           // ![alt](url) other images
                .replace(/<img[^>]*>/gi, '')                     // <img> tags
                .replace(/data:image\/[^\s"')>]+/g, '')         // any remaining data:image URIs
                .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '')     // any long base64 strings (200+ chars)
                .replace(/\n{3,}/g, '\n\n')                     // collapse excess blank lines
                .trim();

            const contextSummary = `Viewing: ${doc.title || doc.path}`;
            console.log('[AI Chat] Document content length: raw=' + (doc.content || '').length + ' cleaned=' + cleanedContent.length);

            // Show user message with context bubble (yellow) and prompt (green)
            this.appendMessage(chatPrompt, 'user', contextSummary);

            let response;
            if (cleanedContent) {
                // Whole-document path: read the full content section by section.
                this.setStatus('Reading the document and answering...');
                response = await fetch('/applications/wiki/api/ai/chat/document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        question: chatPrompt,
                        content: cleanedContent,
                        documentTitle: doc.title,
                        documentPath: doc.path
                    })
                });
            } else {
                // Document open but no content loaded — fall back to a plain
                // question so the user still gets an answer.
                this.setStatus('Sending message...');
                response = await fetch('/applications/wiki/api/ai/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: `Context:\nThe user is viewing the document: ${doc.title || doc.path}\n\nQuestion:\n${chatPrompt}`,
                        context: { documentTitle: doc.title, documentPath: doc.path },
                        spaceName: this.app?.currentSpace?.name
                    })
                });
            }

            console.log('[AI Chat] Step 5: Got response, status:', response.status);
            const data = await response.json();
            console.log('[AI Chat] Step 6: Parsed response:', { success: data.success, hasResponse: !!data.response, chunks: data.chunks, partial: data.partial, error: data.error, message: data.message });

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
                // Keep the Recent sidebar's saved copy in step with the reply.
                try { this.app?.layoutController?.noteChatActivity?.(); } catch { /* sidebar is optional */ }

                // Update status — note how much of the document was read.
                const sectionsNote = data.chunks > 1 ? ` (read ${data.chunks} sections)` : '';
                if (data.partial) {
                    this.setStatus(`Answered from part of the document${sectionsNote} — it was too long to read fully`, 'success');
                } else {
                    this.setStatus(`Response received${sectionsNote}`, 'success');
                }

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

        // Load folder context if available (.context/_folder.md)
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
     * A folder's own context directory. Context is FOLDER-LOCAL: it lives inside
     * the folder itself (`Foo/Bar` -> `Foo/Bar/.system/context`, root ->
     * `.system/context`), NOT in a space-root tree-mirroring namespace. Mirrors
     * `filePolicy.CONTEXT_DIR` on the backend, the single source of truth.
     */
    contextDirFor(folderPath) {
        return folderPath ? `${folderPath}/.system/context` : '.system/context';
    },

    /**
     * Load folder context content from <folder>/.system/context/_folder.md
     */
    async loadFolderContextContent(folderPath) {
        if (!this.app.currentSpace) return null;

        try {
            // Folder context lives in the build-context workflow's roll-up:
            // <folder>/.system/context/_folder.md
            const contextFilePath = `${this.contextDirFor(folderPath)}/_folder.md`;
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
     * Load file-specific context content from .context/{filename}
     */
    async loadFileContextContent(filePath) {
        if (!this.app.currentSpace || !filePath) return null;

        try {
            // The build-context workflow's per-file sidecar lives in the source
            // folder's own .system/context. It is ALWAYS markdown, so a markdown
            // source keeps its name (Foo/Bar.md -> Foo/.system/context/Bar.md)
            // while a binary keeps its FULL name plus .md
            // (Foo/Deck.pdf -> Foo/.system/context/Deck.pdf.md). Mirrors
            // filePolicy.toContextRelPath on the backend — keep the two in step.
            const sourceName = filePath.split('/').pop();
            const fileName = sourceName.toLowerCase().endsWith('.md')
                ? sourceName
                : `${sourceName}.md`;

            // Extract folder path from file path
            const lastSlash = filePath.lastIndexOf('/');
            const folderPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '';

            // Build path to file-specific context file
            const contextFilePath = `${this.contextDirFor(folderPath)}/${fileName}`;
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

        // Filter out the hidden AI context folders
        const filteredItems = items.filter(item => item.name !== '.aicontext' && item.name !== '.context');

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

        // Add folder context description if available (.context/_folder.md)
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
     * Build the display parts for one search source:
     *   • label    — what the link says. Normally the file name; for a folder
     *     home file (".home.md") the folder's own name, since ".home.md" tells
     *     the user nothing.
     *   • location — where it was found: "folder/path — Space". For home files
     *     the PARENT folder (the folder itself is already the label).
     * Works from src.path alone so reloaded history entries render the same.
     */
    sourceDisplayParts(src) {
        const path = String(src.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const segments = path.split('/').filter(Boolean);
        const fileName = segments.pop() || '';
        const isHome = /^\.home(\.md|\.markdown)?$/i.test(fileName);

        let label;
        if (isHome) {
            // Folder home page → the folder is the document. Root home → space name.
            label = segments[segments.length - 1] || src.spaceName || fileName;
            segments.pop();
        } else {
            label = src.title || fileName || path;
        }

        const folder = segments.join('/');
        const location = folder ? `${folder} — ${src.spaceName}` : `${src.spaceName}`;
        return { label, location };
    },

    /**
     * Append an AI response that came from the wiki-wide search flow,
     * with a clickable Sources panel and inline link interception.
     */
    appendSearchAnswer(content, sources, answerId = null) {
        const messagesContainer = document.getElementById('aiChatMessages');
        if (!messagesContainer) return;

        const welcome = messagesContainer.querySelector('.ai-chat-welcome');
        if (welcome) welcome.remove();

        const messageDiv = document.createElement('div');
        messageDiv.className = 'ai-message';
        messageDiv.innerHTML = this.renderMarkdown(content || '');

        // Make any inline anchors that point at a known source path clickable
        // through the documentController.
        const sourceByPath = new Map((sources || []).map(s => [s.path, s]));
        messageDiv.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            const src = sourceByPath.get(href);
            if (!src) return;
            a.classList.add('ai-source-link');
            a.addEventListener('click', (e) => {
                e.preventDefault();
                this.openSource(src);
            });
        });

        // Convert numbered citations like [1], [2], [1][3], [1, 2] into clickable
        // chips that open the matching source. The model is instructed to cite by
        // number; we own the link rendering so paths with parens / spaces / etc.
        // can't break it.
        if (sources && sources.length > 0) {
            this.linkifyCitations(messageDiv, sources);
        }

        messagesContainer.appendChild(messageDiv);

        if (sources && sources.length > 0) {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.className = 'ai-sources';
            const heading = document.createElement('div');
            heading.className = 'ai-sources-heading';
            heading.textContent = `Sources (${sources.length})`;
            sourcesDiv.appendChild(heading);

            const list = document.createElement('ul');
            list.className = 'ai-sources-list';
            sources.forEach(src => {
                const { label, location } = this.sourceDisplayParts(src);
                const li = document.createElement('li');
                const link = document.createElement('a');
                link.href = '#';
                link.className = 'ai-source-link';
                link.textContent = label;
                link.title = `${src.spaceName} / ${src.path}`;
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openSource(src);
                });
                li.appendChild(link);
                // Space-root home: label already IS the space name — no meta.
                if (location && location !== label) {
                    const meta = document.createElement('span');
                    meta.className = 'ai-source-meta';
                    meta.textContent = ` — ${location}`;
                    li.appendChild(meta);
                }
                list.appendChild(li);
            });
            sourcesDiv.appendChild(list);
            messagesContainer.appendChild(sourcesDiv);
        }

        // A kept answer can be added to a NooblyJS item, saved as a page or reported
        // as wrong (the server gives every answer with sources an id).
        if (answerId && sources && sources.length > 0) {
            messagesContainer.appendChild(answerActions.build(answerId, { spaces: this.app?.spaces || [] }));
        }

        this.scrollToBottom();
    },

    /**
     * Open a chat source. Routing is layout-aware:
     *   • Chat layout  → right-hand preview flyout (conversation stays centred).
     *   • Any other    → the main content area, where the document viewer lives.
     */
    openSource(src) {
        if (!src || !src.path || !src.spaceName) return;
        if (this.isChatLayout()) {
            this.openSourcePreview(src);
        } else {
            this.openSourceInContent(src);
        }
    },

    /**
     * Open a source in the main content area (the document viewer). When
     * `switchLayout` is set, first switch to the Content persona — used by the
     * preview flyout's Open button so a previewed solution lands in content mode.
     */
    openSourceInContent(src, { switchLayout = false } = {}) {
        if (!src || !src.path || !src.spaceName) return;
        if (switchLayout) {
            // Reuse the header switcher's own path (avoids a layoutController import
            // cycle) so all the persona side-effects fire exactly as on a click.
            document.querySelector('#layoutSwitch .kr-layout-btn[data-layout="content"]')?.click();
        }
        try {
            documentController.openDocumentByPath(src.path, src.spaceName);
        } catch (err) {
            console.error('[AI Chat] Failed to open source in content area:', err);
        }
    },

    /**
     * Render a source document's markdown in the right-hand preview drawer using
     * the shared markdown parser. The drawer's open-in-main button hands off to
     * the full document viewer.
     */
    async openSourcePreview(src) {
        const drawer = document.getElementById('docPreviewDrawer');
        const body = document.getElementById('docPreviewBody');
        const titleEl = document.getElementById('docPreviewTitle');
        const subEl = document.getElementById('docPreviewSub');
        if (!drawer || !body) {
            // No drawer in this build — fall back to the main viewer.
            try { documentController.openDocumentByPath(src.path, src.spaceName); } catch (err) { console.error('[AI Chat] open source failed:', err); }
            return;
        }

        this.wireDocPreview();
        this._previewSrc = src;

        const fileName = String(src.title || src.path || 'Document').split('/').pop();
        if (titleEl) titleEl.textContent = fileName;
        if (subEl) subEl.textContent = src.spaceName ? `${src.spaceName} · ${src.path}` : (src.path || '');
        body.innerHTML = '<div class="kr-doc-preview-loading">Loading…</div>';
        drawer.classList.remove('hidden');

        try {
            const spaceId = await this.resolveSpaceIdForPreview(src.spaceName);
            if (!spaceId) throw new Error(`Space "${src.spaceName}" not found`);
            if (this._previewSrc !== src) return; // a newer click superseded this one

            const resp = await fetch(
                `/applications/wiki/api/spaces/${spaceId}/file-content/${encodeURIComponent(src.path)}`,
                { credentials: 'include' }
            );
            if (!resp.ok) throw new Error(`Failed to load document (HTTP ${resp.status})`);

            const ctype = resp.headers.get('content-type') || '';
            let markdown = '';
            if (ctype.includes('application/json')) {
                const data = await resp.json();
                if (data && data.success === false) throw new Error(data.error || 'Failed to load document');
                markdown = (data && data.content) || '';
            } else {
                markdown = await resp.text();
            }
            if (this._previewSrc !== src) return; // superseded

            if (typeof window !== 'undefined' && typeof window.parseMarkdown === 'function') {
                body.innerHTML = window.parseMarkdown(markdown);
            } else {
                body.textContent = markdown;
            }

            // Resolve relative image URLs against the source document so embedded
            // media streams through the filing service instead of 404ing.
            const doc = { path: src.path, spaceName: src.spaceName, spaceId };
            body.querySelectorAll('img[src]').forEach(img => {
                try { img.setAttribute('src', documentController.resolveEmbeddedMediaUrl(img.getAttribute('src'), doc)); } catch { /* leave as-is */ }
            });
            body.scrollTop = 0;
        } catch (err) {
            console.error('[AI Chat] Source preview failed:', err);
            if (this._previewSrc === src) {
                body.innerHTML = '<div class="kr-doc-preview-error">Couldn\'t load this document. <a href="#" id="docPreviewFallback">Open in main view</a> instead.</div>';
                document.getElementById('docPreviewFallback')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.closeDocPreview();
                    try { documentController.openDocumentByPath(src.path, src.spaceName); } catch (e2) { console.error(e2); }
                });
            }
        }
    },

    /** Resolve a space name to its id, fetching the spaces list once if needed. */
    async resolveSpaceIdForPreview(spaceName) {
        if (this.app?.currentSpace?.name === spaceName) return this.app.currentSpace.id;
        let spaces = this.app?.spaces;
        if (!spaces || spaces.length === 0) {
            try {
                const r = await fetch('/api/spaces', { credentials: 'include' });
                if (r.ok) {
                    const d = await r.json();
                    spaces = d.data || d;
                    if (this.app) this.app.spaces = spaces;
                }
            } catch { /* ignore — handled by null return */ }
        }
        const sp = (spaces || []).find(s => s.name === spaceName);
        return sp ? sp.id : null;
    },

    /** Lazily wire the preview drawer's close / open-in-main / Escape controls. */
    wireDocPreview() {
        if (this._docPreviewWired) return;
        this._docPreviewWired = true;
        document.getElementById('docPreviewCloseBtn')?.addEventListener('click', () => this.closeDocPreview());
        document.getElementById('docPreviewOpenBtn')?.addEventListener('click', () => {
            const src = this._previewSrc;
            this.closeDocPreview();
            if (src) this.openSourceInContent(src, { switchLayout: true });
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const d = document.getElementById('docPreviewDrawer');
            if (d && !d.classList.contains('hidden')) this.closeDocPreview();
        });

        // Click-away to dismiss. Clicks inside the flyout keep it open, and clicks
        // on a chat source link / citation are ignored here so their own handler
        // can open (or switch) the preview instead of this closing it first.
        document.addEventListener('click', (e) => {
            const d = document.getElementById('docPreviewDrawer');
            if (!d || d.classList.contains('hidden')) return;
            if (d.contains(e.target)) return;
            if (e.target.closest && e.target.closest('.ai-source-link, .ai-citation')) return;
            this.closeDocPreview();
        });
    },

    /** Hide the source preview drawer. */
    closeDocPreview() {
        document.getElementById('docPreviewDrawer')?.classList.add('hidden');
        this._previewSrc = null;
    },

    /**
     * Walk text nodes inside `root` and replace bracketed citation markers
     * (e.g. `[1]`, `[1, 2]`, `[1][3]`) with clickable spans pointing at the
     * matching source. Skips text inside <a>, <code>, and <pre> elements.
     */
    linkifyCitations(root, sources) {
        const SKIP = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE']);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                let p = node.parentNode;
                while (p && p !== root) {
                    if (SKIP.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
                    p = p.parentNode;
                }
                return /\[\s*\d+(\s*[,\s]\s*\d+)*\s*\]/.test(node.nodeValue)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });

        const targets = [];
        let n;
        while ((n = walker.nextNode())) targets.push(n);

        // Match [1], [12], [1, 2], [1,2,3] (single bracket pair containing one or more numbers)
        const citationRe = /\[\s*(\d+(?:\s*[,\s]\s*\d+)*)\s*\]/g;

        targets.forEach(textNode => {
            const text = textNode.nodeValue;
            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            let m;
            citationRe.lastIndex = 0;
            while ((m = citationRe.exec(text)) !== null) {
                if (m.index > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
                }
                const numbers = m[1].split(/[,\s]+/).map(s => parseInt(s, 10)).filter(Number.isFinite);
                const valid = numbers.filter(num => num >= 1 && num <= sources.length);
                if (valid.length === 0) {
                    // Not a real citation — emit raw text.
                    frag.appendChild(document.createTextNode(m[0]));
                } else {
                    frag.appendChild(document.createTextNode('['));
                    valid.forEach((num, idx) => {
                        if (idx > 0) frag.appendChild(document.createTextNode(', '));
                        const a = document.createElement('a');
                        a.href = '#';
                        a.className = 'ai-citation';
                        a.textContent = String(num);
                        const src = sources[num - 1];
                        a.title = `${src.title} — ${src.spaceName}`;
                        a.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.openSource(src);
                        });
                        frag.appendChild(a);
                    });
                    frag.appendChild(document.createTextNode(']'));
                }
                lastIndex = m.index + m[0].length;
            }
            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            textNode.parentNode.replaceChild(frag, textNode);
        });
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
        const demoted = this.demoteHeadings(content || '');
        if (typeof marked !== 'undefined') {
            return parseMarkdown(demoted);
        }
        // Fallback to plain text if marked is not available
        return demoted.replace(/\n/g, '<br>');
    },

    /**
     * Demote markdown ATX headings by two levels (e.g. `#` -> `###`) so AI
     * responses render with compact titles in the chat panel instead of large
     * page-style headers. Levels are clamped at h6, and fenced code blocks are
     * left untouched so `#` comments inside code are not affected.
     */
    demoteHeadings(content) {
        const DEMOTE_BY = 2;
        let inFence = false;
        return content.split('\n').map(line => {
            if (/^\s*(```|~~~)/.test(line)) {
                inFence = !inFence;
                return line;
            }
            if (inFence) return line;
            const match = line.match(/^(#{1,6})(\s)/);
            if (!match) return line;
            const level = Math.min(match[1].length + DEMOTE_BY, 6);
            return '#'.repeat(level) + line.slice(match[1].length);
        }).join('\n');
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
                            <i class="bi bi-robot" style="font-size: 42px;"></i>
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

            // Context sidecars live in each folder's own hidden <folder>/.system/context
            // namespace, so they never appear in the folder tree. List that
            // directory directly instead of walking the tree.
            const ctxDir = this.contextDirFor(currentFolderPath);
            const encodedDir = ctxDir.split('/').map(encodeURIComponent).join('/');
            let entries = [];
            try {
                const response = await fetch(`/applications/wiki/api/spaces/${space.id}/file-list/${encodedDir}`);
                if (response.ok) {
                    const data = await response.json();
                    entries = Array.isArray(data.files) ? data.files : [];
                }
                // A missing <folder>/.system/context dir simply means "no context yet".
            } catch (error) {
                console.log('No context directory for', currentFolderPath);
            }

            this.contextFiles = this.buildContextFilesFromListing(entries, currentFolderPath, ctxDir);
            this.renderContextFiles();
        } catch (error) {
            console.error('Error loading context files:', error);
            this.showContextError('Failed to load context files');
        }
    },

    /**
     * Build the Context Manager list from a listing of `<folder>/.system/context`.
     * Only markdown sidecars are context (the `_folder.md` roll-up + one per source
     * file); nested sub-folders are shown when the user navigates into them.
     * Returns [] when the folder has no context yet.
     */
    buildContextFilesFromListing(entries, currentFolderPath, ctxDir) {
        const norm = (entries || []).map(e => {
            if (typeof e === 'string') return { name: e, isDir: false };
            const name = e.name || e.filename || '';
            const isDir = e.type === 'folder' || e.type === 'directory'
                || e.isDirectory === true || e.isDir === true;
            return { name, isDir };
        }).filter(e => e.name && e.name !== '.' && e.name !== '..');

        const sidecars = norm.filter(e => !e.isDir && /\.md$/i.test(e.name));
        if (sidecars.length === 0) return [];

        const folderLabel = currentFolderPath || '/';
        const contextFiles = [{
            folder: folderLabel,
            contextPath: ctxDir,
            contextFile: `${ctxDir}/_folder.md`,
            exists: sidecars.some(e => e.name === '_folder.md'),
            type: 'folder'
        }];

        for (const e of sidecars) {
            if (e.name === '_folder.md') continue;
            contextFiles.push({
                folder: folderLabel,
                contextPath: ctxDir,
                contextFile: `${ctxDir}/${e.name}`,
                exists: true,
                type: 'file',
                fileName: e.name.replace(/\.md$/i, '')
            });
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
                    <i class="bi bi-folder-symlink" style="font-size: 42px;"></i>
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

                    // Only a per-file sidecar can be regenerated on its own: the
                    // `_folder.md` roll-up has no source document, and rebuilding
                    // it means rebuilding the folder (folder view toolbar).
                    const regen = ctx.type === 'file'
                        ? `<button class="btn btn-ghost btn-sm iconly kr-ctx-regen" data-action="regen"
                                   aria-label="Regenerate context"
                                   title="Regenerate this document's AI context">
                               <i class="bi bi-arrow-clockwise"></i>
                           </button>`
                        : '';

                    return `
                        <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                             data-context-path="${ctx.contextFile}"
                             data-folder="${ctx.folder}">
                            <div>
                                <i class="bi ${icon} me-2"></i>
                                <strong>${label}</strong>
                                <div class="small text-muted">${subLabel}</div>
                            </div>
                            <div class="kr-ctx-actions">
                                ${regen}
                                ${ctx.exists ? '<span class="badge bg-success">Exists</span>' : '<span class="badge bg-secondary">New</span>'}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Add click handlers
        listContainer.querySelectorAll('.list-group-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const contextPath = item.dataset.contextPath;
                const folder = item.dataset.folder;

                // Regenerate acts on the row without leaving the list — opening
                // the editor as well would fight the live refresh for focus.
                const regenBtn = e.target.closest('[data-action="regen"]');
                if (regenBtn) {
                    e.stopPropagation();
                    this.regenerateContext(contextPath, regenBtn);
                    return;
                }

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

        // Per-file sidecar lives in the source folder's own .system/context and is
        // ALWAYS markdown: a markdown source keeps its name, a binary keeps its
        // FULL name plus .md (Foo/Deck.pdf -> Foo/.system/context/Deck.pdf.md).
        // Mirrors filePolicy.toContextRelPath — keep the two in step.
        const sourceName = filePath.split('/').pop();
        const fileName = sourceName.toLowerCase().endsWith('.md')
            ? sourceName
            : `${sourceName}.md`;

        // Extract folder path from file path
        const lastSlash = filePath.lastIndexOf('/');
        const folderPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '';

        // Build path to file-specific context file
        const contextFilePath = `${this.contextDirFor(folderPath)}/${fileName}`;

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
            // Load existing context using document content API. `no-store` because
            // this endpoint answers text with a 24-hour Cache-Control — without it
            // a sidecar just rewritten by a rebuild would come back stale.
            try {
                const spaceName = this.app.currentSpace?.name;
                const response = await fetch(`/applications/wiki/api/documents/content?path=${encodeURIComponent(contextPath)}&spaceName=${encodeURIComponent(spaceName)}`, { cache: 'no-store' });

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

        this.syncContextEditorControls(contextPath);
    },

    /**
     * Put the editor's Regenerate control into the right state for the sidecar
     * just opened.
     *
     * Three things are decided here: whether regeneration applies at all (the
     * `_folder.md` roll-up describes a folder, not a document, so it is rebuilt
     * from the folder view instead); whether the wording is "Generate" or
     * "Regenerate"; and whether a run started from the LIST view is still in
     * flight for this sidecar — in which case the editor adopts it, so navigating
     * in mid-run shows the progress strip and keeps streaming, rather than
     * offering a button that would refuse a second run.
     *
     * @param {string|null} contextPath - Sidecar now open, null for a new one.
     */
    syncContextEditorControls(contextPath) {
        const btn = document.getElementById('regenerateContextBtn');
        if (!btn) return;

        const isFileSidecar = !!contextPath && contextPath.split('/').pop() !== '_folder.md';
        btn.classList.toggle('hidden', !isFileSidecar);
        if (!isFileSidecar) {
            if (!this._ctxRegen) this._setCtxStatus(null);
            return;
        }

        const textarea = document.getElementById('contextEditorTextarea');
        const hasContent = !!(textarea && textarea.value.trim());
        this._setRegenVerb(btn, hasContent ? 'Regenerate' : 'Generate');

        const running = this._ctxRegen && this._ctxRegen.contextPath === contextPath;
        if (running) {
            // Adopt the run: the button it was started from may be a list row that
            // has since been re-rendered away.
            this._ctxRegen.btn = btn;
            btn.disabled = true;
            btn.classList.add('is-refreshing');
            this._setCtxEditorLocked(contextPath, true);
            this._setCtxStatus('running', 'Regenerating context — this updates as the AI writes it…');
        } else {
            btn.disabled = false;
            btn.classList.remove('is-refreshing');
            this._setCtxEditorLocked(contextPath, false);
            if (!this._ctxRegen) this._setCtxStatus(null);
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
                // Build the path to the folder roll-up file (<folder>/.system/context/_folder.md)
                contextFilePath = `${this.contextDirFor(this.currentContextFolder || '')}/_folder.md`;
            }

            // Save the context file. PUT /documents/content creates the parent
            // <folder>/.system/context directory recursively, so no explicit
            // folder-creation step is needed.
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
     * Regenerate the AI context for ONE document — the sidecar selected in the
     * Context Manager — and stream the result into the editor as it is written.
     *
     * The backend runs the system-context group's on-demand build in TARGETED
     * mode (`files: [<that document>]`): it re-summarises just this document and
     * rebuilds its folder's `_folder.md` roll-up, so the cost is two AI calls
     * rather than the whole-subtree walk behind the folder view's rebuild button.
     * That is cheap enough to offer as a one-click fix for a single stale or
     * "(summary unavailable)" sidecar, which is why it needs no confirmation.
     *
     * Asynchronous by necessity — even two AI calls outlive an HTTP request — so
     * this starts the run, then polls: each tick re-reads the sidecar off disk
     * into the textarea (the user watches the summary appear) and asks the
     * execution status endpoint whether the run is done.
     *
     * @param {string} contextPath - Space-relative path of the `.system/context/`
     *   sidecar. The API maps it back to the document it describes.
     * @param {HTMLElement} [btn] - Button to animate for the duration.
     */
    async regenerateContext(contextPath, btn) {
        const space = this.app.currentSpace;
        if (!space?.id) {
            this.app?.showNotification?.('No space selected', 'error');
            return;
        }
        if (!contextPath) return;

        // The roll-up describes the folder, not a document — there is no single
        // file to re-summarise. Rebuilding it is a folder-level operation.
        if (contextPath.split('/').pop() === '_folder.md') {
            this.app?.showNotification?.(
                'This is the folder roll-up — rebuild it from the folder view', 'info');
            return;
        }

        // One at a time: the runs are serialized server-side anyway, and a second
        // poll loop writing into the same textarea would fight the first.
        if (this._ctxRegen) {
            this.app?.showNotification?.(
                'A context regeneration is already running — wait for it to finish', 'info');
            return;
        }

        this._startCtxRegen(contextPath, btn);
        try {
            const res = await fetch(
                `/applications/wiki/api/spaces/${encodeURIComponent(space.id)}/context/rebuild-file`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ contextPath }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.executionId) {
                this._finishCtxRegen('error',
                    data.error || data.message || `Could not start the rebuild (${res.status})`);
                return;
            }
            this.pollContextRebuild(data.executionId, data.contextPath || contextPath);
        } catch (err) {
            this._finishCtxRegen('error',
                'Could not start the rebuild: ' + (err?.message || err));
        }
    },

    /**
     * Poll a single-file context rebuild until it ends, refreshing the editor from
     * disk on every tick so the new summary appears as soon as the workflow writes
     * it — rather than only at the end of the run.
     *
     * @param {string} executionId - From the 202 response.
     * @param {string} contextPath - Sidecar to re-read each tick.
     */
    pollContextRebuild(executionId, contextPath) {
        const INTERVAL_MS = 2000;
        // ~10 minutes. A document summary plus its folder roll-up is two AI calls;
        // on a slow local model with retries that is minutes, not seconds. Past
        // this we stop watching but say plainly that the run itself continues.
        const MAX_ATTEMPTS = 300;
        let attempts = 0;
        let inFlight = false;

        const timer = setInterval(async () => {
            if (inFlight) return;
            inFlight = true;
            attempts += 1;
            try {
                // Show whatever is on disk now, then decide whether to stop. This
                // order matters: the final write lands before the run reports
                // completion, so reading first means the last tick already has it.
                await this.refreshContextEditorContent(contextPath);

                const res = await fetch(
                    `/api/workflows/executions/${encodeURIComponent(executionId)}/status`,
                    { credentials: 'include', cache: 'no-store' }
                );
                const data = await res.json().catch(() => ({}));
                if (this._ctxRegen?.timer !== timer) {
                    clearInterval(timer); // superseded/cancelled — never keep ticking
                    return;
                }

                if (!res.ok) {
                    this._finishCtxRegen('error', 'Lost track of the context rebuild');
                    return;
                }
                if (data.status && data.status !== 'running') {
                    const ok = data.status === 'completed' && data.outcome !== 'failed';
                    await this.refreshContextEditorContent(contextPath);
                    this._finishCtxRegen(
                        ok ? 'done' : 'error',
                        ok ? 'Context regenerated'
                           : 'Context rebuild failed' + (data.error ? ': ' + data.error : '')
                    );
                    // The list shows an Exists/New badge per sidecar — a first-time
                    // generation has just changed one.
                    if (this.currentView === 'context') this.loadContextFiles();
                    return;
                }
                if (attempts >= MAX_ATTEMPTS) {
                    this._finishCtxRegen('warning',
                        'Still running — check Datasources → Executions for progress');
                }
            } catch (e) {
                // Transient network error — keep polling.
            } finally {
                inFlight = false;
            }
        }, INTERVAL_MS);

        this._ctxRegen.timer = timer;
        this._ctxRegen.executionId = executionId;
    },

    /**
     * Re-read a context sidecar from disk into the editor, if that sidecar is what
     * the editor is currently showing. No-op otherwise (the user may have navigated
     * away mid-run), and silent on 404 — the sidecar does not exist until the
     * workflow's first write.
     *
     * `cache: 'no-store'` is not optional: GET /documents/content answers a text
     * file with `Cache-Control: public, max-age=86400`, so a plain fetch would be
     * served the pre-rebuild content from the browser cache for a day.
     *
     * @param {string} contextPath - Space-relative sidecar path.
     */
    async refreshContextEditorContent(contextPath) {
        if (this.currentView !== 'editor' || this.currentContextPath !== contextPath) return;

        const textarea = document.getElementById('contextEditorTextarea');
        const spaceName = this.app.currentSpace?.name;
        if (!textarea || !spaceName) return;

        try {
            const res = await fetch(
                `/applications/wiki/api/documents/content?path=${encodeURIComponent(contextPath)}`
                + `&spaceName=${encodeURIComponent(spaceName)}`,
                { credentials: 'include', cache: 'no-store' }
            );
            if (!res.ok) return;
            const content = await res.text();
            // Only touch the DOM on a real change: reassigning an identical value
            // still resets the scroll position of a textarea the user is reading.
            if (content !== textarea.value) textarea.value = content;
        } catch (e) {
            // Transient — the next tick tries again.
        }
    },

    /**
     * Enter the "regenerating" state: animate the button, lock the editor for the
     * sidecar being rewritten (an edit saved mid-run would be overwritten by the
     * workflow moments later) and show the progress strip.
     * @param {string} contextPath
     * @param {HTMLElement} [btn]
     */
    _startCtxRegen(contextPath, btn) {
        this._ctxRegen = { contextPath, btn: btn || null, timer: null, executionId: null };
        if (btn) {
            btn.disabled = true;
            btn.classList.add('is-refreshing');
        }
        this._setCtxEditorLocked(contextPath, true);
        this._setCtxStatus('running', 'Regenerating context — this updates as the AI writes it…');
    },

    /**
     * Leave the "regenerating" state, whatever the outcome.
     * @param {'done'|'error'|'warning'} status
     * @param {string} message - Also raised as a notification, so the outcome is
     *   visible when the user has navigated away from the editor.
     */
    _finishCtxRegen(status, message) {
        const state = this._ctxRegen;
        this._ctxRegen = null;

        if (state?.timer) clearInterval(state.timer);
        if (state?.btn) {
            state.btn.disabled = false;
            state.btn.classList.remove('is-refreshing');
        }
        if (state?.contextPath) this._setCtxEditorLocked(state.contextPath, false);

        // A sidecar generated for the first time is no longer empty, so the button
        // that offered "Generate" now offers "Regenerate".
        if (status === 'done' && this.currentView === 'editor'
            && this.currentContextPath === state?.contextPath) {
            this._setRegenVerb(document.getElementById('regenerateContextBtn'), 'Regenerate');
        }

        this._setCtxStatus(status, message);
        this.app?.showNotification?.(
            message, status === 'done' ? 'success' : (status === 'error' ? 'error' : 'warning'));

        // Clear a success strip once it has been read; leave errors and warnings
        // up, and never clear a strip a newer run has since claimed.
        if (status === 'done') {
            setTimeout(() => {
                if (!this._ctxRegen) this._setCtxStatus(null);
            }, 6000);
        }
    },

    /**
     * Name the regenerate action. The button is icon-only — the panel is too narrow
     * for a label beside a wrapping folder path — so "Generate" vs "Regenerate" has
     * to live in the accessible name and the tooltip rather than in visible text.
     * @param {HTMLElement|null} btn
     * @param {'Generate'|'Regenerate'} verb
     */
    _setRegenVerb(btn, verb) {
        if (!btn) return;
        btn.setAttribute('aria-label', `${verb} context`);
        btn.title = `${verb} this document's AI context. Runs in the background; `
            + 'the text below updates as it is written.';
    },

    /**
     * Lock/unlock the editor while the workflow owns the file. Applies only when
     * the editor is showing that exact sidecar.
     * @param {string} contextPath
     * @param {boolean} locked
     */
    _setCtxEditorLocked(contextPath, locked) {
        // Guarded only when LOCKING: the editor may have moved on to another
        // sidecar by the time a run ends, and skipping the unlock there would
        // strand a read-only textarea. Nothing else touches these two, so an
        // unlock is always safe to apply.
        if (locked && (this.currentView !== 'editor' || this.currentContextPath !== contextPath)) return;
        const textarea = document.getElementById('contextEditorTextarea');
        const saveBtn = document.getElementById('saveContextBtn');
        if (textarea) textarea.readOnly = locked;
        if (saveBtn) saveBtn.disabled = locked;
    },

    /**
     * Render the context editor's progress strip.
     * @param {'running'|'done'|'error'|'warning'|null} kind - null hides it.
     * @param {string} [message]
     */
    _setCtxStatus(kind, message) {
        const el = document.getElementById('contextEditorStatus');
        if (!el) return;

        el.classList.remove('is-running', 'is-error');
        if (!kind) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }

        const icons = {
            running: 'bi-arrow-repeat',
            done: 'bi-check-circle',
            error: 'bi-exclamation-triangle',
            warning: 'bi-clock-history'
        };
        el.classList.remove('hidden');
        if (kind === 'running') el.classList.add('is-running');
        if (kind === 'error') el.classList.add('is-error');

        // Built element-wise, not by innerHTML: `message` can carry a workflow
        // error string straight from the server.
        el.textContent = '';
        const icon = document.createElement('i');
        icon.className = `bi ${icons[kind] || icons.running}`;
        const text = document.createElement('span');
        text.textContent = message || '';
        el.appendChild(icon);
        el.appendChild(text);
    },

    /**
     * Show context error
     */
    showContextError(message) {
        const listContainer = document.getElementById('aiContextList');
        listContainer.innerHTML = `
            <div class="text-center text-danger p-4">
                <i class="bi bi-exclamation-triangle" style="font-size: 42px;"></i>
                <p class="mt-3 mb-1"><strong>Error</strong></p>
                <p class="small">${message}</p>
            </div>
        `;
    }
};
