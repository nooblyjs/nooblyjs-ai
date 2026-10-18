/**
 * Layout Controller
 *
 * Persona-driven layouts for the wiki. The same repository can be entered four
 * different ways; this controller switches between them by setting
 * `data-layout` on #wikiApp (the CSS in wiki.css does the showing/hiding) and
 * persists the choice to localStorage so it survives reloads.
 *
 *   detailed  Full tree navigation + content + AI assistant (the classic view).
 *   content   Browsing-first — hides the left nav, keeps content + assistant.
 *   chat      Chat-first — full-page assistant with a session history sidebar.
 *   search    Search-first — hides the left nav, surfaces a big search box.
 *
 * The header switcher and the onboarding wizard both call setLayout().
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-24
 */

import { aiChatController } from "./aichatcontroller.js";
import { searchController } from "./searchcontroller.js";

export const LAYOUTS = ['detailed', 'content', 'chat', 'search'];

/** Metadata for the header switcher and the onboarding persona cards. */
export const LAYOUT_OPTIONS = [
    {
        id: 'detailed',
        name: 'Detailed',
        icon: 'bi-layout-sidebar',
        persona: 'Solution architects · Engineers',
        desc: 'Full tree navigation — every space, folder, panel and stat in one dense view.'
    },
    {
        id: 'content',
        name: 'Content',
        icon: 'bi-grid-1x2',
        persona: 'Readers · New joiners',
        desc: 'A magazine of spaces and documents, with the assistant on hand to help.'
    },
    {
        id: 'chat',
        name: 'Chat',
        icon: 'bi-chat-dots',
        persona: 'CTO · Execs · Heads of dept',
        desc: 'Ask in plain language. Get grounded answers with the sources attached.'
    },
    {
        id: 'search',
        name: 'Search',
        icon: 'bi-search',
        persona: 'Product managers · Execs',
        desc: 'Begin at the search bar, filter fast and scan results at a glance.'
    }
];

const STORAGE_KEY = 'kr_wiki_layout';
const SESSIONS_KEY = 'kr_wiki_chat_sessions';
// Which saved session the live conversation belongs to. Persisted so a page
// reload (which reloads the server-side conversation into chatHistory) keeps
// updating the same Recent entry instead of spawning a duplicate each load.
const ACTIVE_SESSION_KEY = 'kr_wiki_active_chat_session';
const MAX_SESSIONS = 50;
const SEARCH_HISTORY_KEY = 'kr_wiki_search_history';
const MAX_SEARCH_HISTORY = 25;

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const layoutController = {
    app: null,
    current: 'detailed',
    activeSessionId: null,
    _seq: 0,

    init(app) {
        this.app = app;
        this.app.layoutController = this;
        // Restore which saved session the live conversation belongs to so that
        // continuing it after a reload updates that entry instead of duplicating it.
        this.activeSessionId = this.loadActiveSession();
        this.current = this.loadStored();
        // Apply immediately (DOM is parsed — app.js is a deferred module) so the
        // shell renders in the right layout the moment it becomes visible.
        this.apply(this.current, { persist: false });
        this.wireSwitcher();
        this.wireChatSidebar();
        this.wireQuickPrompts();
        this.wireSearchHero();
        this.wireSearchHistory();
        this.renderSearchHistory();
    },

    /* ------------------------------------------------------------------ */
    /* Layout state                                                        */
    /* ------------------------------------------------------------------ */

    loadStored() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            return LAYOUTS.includes(v) ? v : 'detailed';
        } catch {
            return 'detailed';
        }
    },

    /** Public entry point — switch layout and persist the choice. */
    setLayout(name, { persist = true } = {}) {
        this.apply(LAYOUTS.includes(name) ? name : 'detailed', { persist });
    },

    apply(name, { persist = true } = {}) {
        this.current = name;

        const root = document.getElementById('wikiApp');
        if (root) root.dataset.layout = name;

        document.querySelectorAll('#layoutSwitch .kr-layout-btn').forEach((b) => {
            const active = b.dataset.layout === name;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        // Grey out the topbar controls a persona can't act on.
        this.updateChromeForLayout(name);

        if (persist) {
            try { localStorage.setItem(STORAGE_KEY, name); } catch { /* private mode */ }
        }

        if (name === 'chat') this.enterChat();
        if (name === 'search') {
            this.showSearchInterface();
            this.renderSearchHistory();
            this.updateSearchEmptyState();
        }

        // The Filters panel lives in the left nav in search layout and beside the
        // results elsewhere. If a search is showing, re-render so the facets land
        // in the right place for the layout we just switched to.
        try {
            if (searchController.facetState) searchController.renderFacetedResults();
        } catch { /* no active search */ }
    },

    /** Enable/disable the topbar buttons that a given persona can't act on:
     *   - the sidebar toggle only affects the left nav, which is present only in
     *     the detailed view (content/chat/search all hide it);
     *   - the AI-assistant toggle does nothing in chat (the assistant IS the
     *     page) or search (the assistant is hidden).
     *  Re-run on every layout change so switching back to detailed re-enables. */
    updateChromeForLayout(name) {
        const sidebarBtn = document.getElementById('toggleSidebarBtn');
        if (sidebarBtn) {
            const off = name !== 'detailed';
            sidebarBtn.disabled = off;
            sidebarBtn.title = off ? 'Sidebar is only available in the Detailed view' : 'Toggle sidebar';
        }
        const aiBtn = document.getElementById('aiChatToggleBtn');
        if (aiBtn) {
            const off = name === 'chat' || name === 'search';
            aiBtn.disabled = off;
            aiBtn.title = off ? 'The assistant is not available in this view' : 'Toggle AI Assistant';
        }
    },

    /** Landing on the search persona should always show the search interface —
     *  never leave whatever document/space/home view was open showing under the
     *  search box. If a search is live we (re)show its results; otherwise we clear
     *  every content view so only the centred hero remains. (Deliberately not
     *  setActiveView('search') in the empty case — that reveals an empty results
     *  view and trips updateSearchEmptyState into thinking a search had run.) */
    showSearchInterface() {
        if (searchController.facetState) {
            this.app?.setActiveView?.('search');
        } else {
            document.querySelectorAll('#mainContent > .view').forEach((v) => v.classList.add('hidden'));
        }
    },

    /** Centre the search box when there are no results yet; once a search has
     *  run (searchView visible) it sits at the top. Reflected as the
     *  `search-empty` class on #wikiApp (CSS does the positioning). */
    updateSearchEmptyState() {
        const root = document.getElementById('wikiApp');
        if (!root) return;
        const sv = document.getElementById('searchView');
        const hasResults = sv && !sv.classList.contains('hidden');
        root.classList.toggle('search-empty', !hasResults);
    },

    /** Prepare the chat-first view: make sure the assistant shows its
     *  conversation (not the context manager) and refresh the session list. */
    enterChat() {
        try { aiChatController.showChatView?.(); } catch { /* optional */ }
        this.renderSessions();
    },

    /* ------------------------------------------------------------------ */
    /* Header switcher                                                     */
    /* ------------------------------------------------------------------ */

    wireSwitcher() {
        const sw = document.getElementById('layoutSwitch');
        if (!sw) return;
        sw.addEventListener('click', (e) => {
            const btn = e.target.closest('.kr-layout-btn');
            if (!btn) return;
            this.setLayout(btn.dataset.layout);
            if (btn.dataset.layout === 'search') {
                document.getElementById('layoutSearchInput')?.focus();
            } else if (btn.dataset.layout === 'chat') {
                document.getElementById('aiChatInput')?.focus();
            }
        });
    },

    /* ------------------------------------------------------------------ */
    /* Search-first hero                                                   */
    /* ------------------------------------------------------------------ */

    wireSearchHero() {
        const input = document.getElementById('layoutSearchInput');
        if (!input) return;
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const q = input.value.trim();
            if (!q) return;
            // Reuse the global search pipeline (reads from #globalSearch).
            const gs = document.getElementById('globalSearch');
            if (gs) gs.value = q;
            try { searchController.performSearch(); } catch (err) {
                console.warn('[Layout] search failed:', err);
            }
        });
    },

    /* ------------------------------------------------------------------ */
    /* Search-first: previous-searches sidebar                            */
    /* ------------------------------------------------------------------ */

    loadSearchHistory() {
        try {
            const v = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY));
            if (!Array.isArray(v)) return [];
            // Migrate plain strings to { term, ts } objects
            return v.map((x) => typeof x === 'string' ? { term: x, ts: null } : x)
                    .filter((x) => x && typeof x.term === 'string');
        } catch {
            return [];
        }
    },

    saveSearchHistory(list) {
        try {
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_SEARCH_HISTORY)));
        } catch { /* private mode / quota */ }
    },

    /** Record a performed search term (most-recent first, case-insensitively
     *  deduped). Called from searchController.performSearch so every search —
     *  hero, global bar, or replayed term — lands here. */
    recordSearch(term) {
        const t = String(term || '').trim();
        if (!t) return;
        const history = this.loadSearchHistory().filter((x) => x.term.toLowerCase() !== t.toLowerCase());
        history.unshift({ term: t, ts: Date.now() });
        this.saveSearchHistory(history);
        this.renderSearchHistory();
        // A search has run — move the box from centre to the top.
        document.getElementById('wikiApp')?.classList.remove('search-empty');
    },

    runSearchTerm(term) {
        const t = String(term || '').trim();
        if (!t) return;
        const gs = document.getElementById('globalSearch');
        if (gs) gs.value = t;
        const hero = document.getElementById('layoutSearchInput');
        if (hero) hero.value = t;
        try { searchController.performSearch(); } catch (err) {
            console.warn('[Layout] replay search failed:', err);
        }
    },

    removeSearchTerm(term) {
        const t = String(term || '').toLowerCase();
        this.saveSearchHistory(this.loadSearchHistory().filter((x) => x.term.toLowerCase() !== t));
        this.renderSearchHistory();
    },

    clearSearchHistory() {
        this.saveSearchHistory([]);
        this.renderSearchHistory();
    },

    wireSearchHistory() {
        document.getElementById('searchHistoryList')?.addEventListener('click', (e) => {
            const row = e.target.closest('.kr-chat-session');
            if (!row) return;
            if (e.target.closest('.del')) {
                this.removeSearchTerm(row.dataset.term);
            } else {
                this.runSearchTerm(row.dataset.term);
            }
        });
        document.getElementById('clearSearchHistoryBtn')?.addEventListener('click', () => this.clearSearchHistory());
    },

    renderSearchHistory() {
        const list = document.getElementById('searchHistoryList');
        if (!list) return;
        const history = this.loadSearchHistory();
        const clearBtn = document.getElementById('clearSearchHistoryBtn');
        if (!history.length) {
            list.innerHTML = `<div class="kr-chat-empty">No searches yet.<br>Your recent search terms will appear here.</div>`;
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }
        if (clearBtn) clearBtn.style.display = '';
        list.innerHTML = history.map(({ term: t, ts }) => {
            const dateStr = ts ? (() => { const d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); })() : '';
            return `
            <button class="kr-chat-session" data-term="${escapeHtml(t)}" title="${escapeHtml(t)}">
                <i class="bi bi-clock-history"></i>
                <span class="kr-chat-session-body">
                    <span class="t">${escapeHtml(t)}</span>
                    ${dateStr ? `<span class="kr-chat-session-ts">${dateStr}</span>` : ''}
                </span>
                <span class="del" title="Remove" aria-label="Remove"><i class="bi bi-x"></i></span>
            </button>`;
        }).join('');
    },

    /* ------------------------------------------------------------------ */
    /* Chat-first: quick prompts + client-side session history             */
    /* ------------------------------------------------------------------ */

    wireQuickPrompts() {
        const bar = document.getElementById('chatQuickPrompts');
        if (!bar) return;
        bar.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-prompt]');
            if (!btn) return;
            const ta = document.getElementById('aiChatInput');
            if (ta) ta.value = btn.dataset.prompt;
            try { aiChatController.sendMessage(); } catch (err) {
                console.warn('[Layout] quick prompt failed:', err);
            }
        });
    },

    wireChatSidebar() {
        document.getElementById('newChatBtn')?.addEventListener('click', () => this.newChat());
        document.getElementById('chatSessionsList')?.addEventListener('click', (e) => {
            const row = e.target.closest('.kr-chat-session');
            if (!row) return;
            if (e.target.closest('.del')) {
                this.deleteSession(row.dataset.id);
            } else {
                this.openSession(row.dataset.id);
            }
        });
    },

    loadSessions() {
        try {
            const v = JSON.parse(localStorage.getItem(SESSIONS_KEY));
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    },

    saveSessions(list) {
        try {
            localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS)));
        } catch { /* private mode / quota */ }
    },

    /** Set the active session id and persist it (so reloads keep the same entry). */
    setActiveSession(id) {
        this.activeSessionId = id;
        try {
            if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
            else localStorage.removeItem(ACTIVE_SESSION_KEY);
        } catch { /* private mode */ }
    },

    /** Restore the persisted active session, but only if it still exists. */
    loadActiveSession() {
        try {
            const id = localStorage.getItem(ACTIVE_SESSION_KEY);
            if (id && this.loadSessions().some((s) => s.id === id)) return id;
        } catch { /* ignore */ }
        return null;
    },

    /** Trim a raw string down to a short, single-line session title. */
    titleFromText(text) {
        const t = String(text || '').replace(/\s+/g, ' ').trim();
        if (!t) return 'New chat';
        return t.length > 42 ? t.slice(0, 42) + '…' : t;
    },

    /** Derive a short title from the first user turn of a conversation. */
    deriveTitle(history) {
        const first = (history || []).find((h) => h.chatPrompt || h.userMessage);
        let t = '';
        if (first) {
            t = first.chatPrompt
                || aiChatController.splitStoredUserMessage?.(first.userMessage || '')?.chatPrompt
                || first.userMessage
                || '';
        }
        return this.titleFromText(t);
    },

    /** Persist the live conversation as a session (update the active one if we
     *  are continuing it, otherwise create a new entry). `pendingPrompt` lets the
     *  session appear the instant a message is sent — before the first reply has
     *  landed in chatHistory — titled from what the user just typed. */
    snapshotCurrent(pendingPrompt = null) {
        const history = (aiChatController.chatHistory || []).slice();
        if (!history.length && !pendingPrompt) return;

        const sessions = this.loadSessions();
        const title = history.length ? this.deriveTitle(history) : this.titleFromText(pendingPrompt);

        if (this.activeSessionId) {
            const existing = sessions.find((s) => s.id === this.activeSessionId);
            if (existing) {
                existing.history = history;
                existing.title = title;
                existing.ts = Date.now();
                this.saveSessions(sessions);
                return;
            }
        }

        const id = `c${Date.now()}_${++this._seq}`;
        this.setActiveSession(id);
        sessions.unshift({ id, title, history, ts: Date.now() });
        this.saveSessions(sessions);
    },

    /** Hook called by the chat controller as a conversation happens: the instant
     *  a message is sent (with the typed text as `pendingPrompt`) and again after
     *  each reply lands. Keeps the Recent sidebar in step with the live chat so an
     *  entry shows up immediately — no need to click "New chat" first. */
    noteChatActivity(pendingPrompt = null) {
        this.snapshotCurrent(pendingPrompt);
        this.renderSessions();
    },

    newChat() {
        this.snapshotCurrent();
        this.setActiveSession(null);
        try { aiChatController.startNewConversation?.(); } catch { /* optional */ }
        this.renderSessions();
        document.getElementById('aiChatInput')?.focus();
    },

    openSession(id) {
        // Preserve whatever is on screen before swapping conversations.
        this.snapshotCurrent();
        const sessions = this.loadSessions();
        const session = sessions.find((s) => s.id === id);
        if (!session) return;
        this.setActiveSession(id);
        try { aiChatController.loadConversation?.(session.history || []); } catch { /* optional */ }
        this.renderSessions();
    },

    deleteSession(id) {
        const sessions = this.loadSessions().filter((s) => s.id !== id);
        this.saveSessions(sessions);
        if (this.activeSessionId === id) {
            this.setActiveSession(null);
            try { aiChatController.startNewConversation?.(); } catch { /* optional */ }
        }
        this.renderSessions();
    },

    renderSessions() {
        const list = document.getElementById('chatSessionsList');
        if (!list) return;

        const sessions = this.loadSessions();
        if (!sessions.length) {
            list.innerHTML = `<div class="kr-chat-empty">No saved chats yet.<br>Start a conversation — use <strong>New chat</strong> to keep this one and begin another.</div>`;
            return;
        }

        list.innerHTML = sessions.map((s) => {
            const ts = s.ts ? new Date(s.ts) : null;
            const dateStr = ts ? ts.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
            return `
            <button class="kr-chat-session${s.id === this.activeSessionId ? ' active' : ''}" data-id="${escapeHtml(s.id)}" title="${escapeHtml(s.title)}">
                <i class="bi bi-chat-left-text"></i>
                <span class="kr-chat-session-body">
                    <span class="t">${escapeHtml(s.title)}</span>
                    ${dateStr ? `<span class="kr-chat-session-ts">${dateStr}</span>` : ''}
                </span>
                <span class="del" title="Delete chat" aria-label="Delete chat"><i class="bi bi-x"></i></span>
            </button>`;
        }).join('');
    }
};
