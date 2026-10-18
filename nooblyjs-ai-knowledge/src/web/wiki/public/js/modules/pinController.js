/**
 * Pin Controller
 * Manages user-pinned folders and documents. Owns the in-memory pin set,
 * synchronises it with the backend, and exposes helpers to wire pin buttons
 * and render the home-page Pinned section.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-14
 */

import { documentController } from "./documentcontroller.js";
import { navigationController } from "./navigationcontroller.js";

const API = '/applications/wiki/api/pins';
const SUBSCRIPTIONS_API = '/applications/wiki/api/notifications/subscriptions';

/**
 * A pin is identified by its TYPE and PATH — never by a space.
 *
 * Spaces are views over one content root, so the same document reached from two
 * views is one pin. The old key included the space's display NAME, which meant
 * one file could hold several pins and, worse, renaming a space orphaned every
 * pin it had ever made. Must stay in step with `recordKey` in the backend's
 * components/userArtifacts.js.
 */
function pinKey(p) {
    return `${p.type}::${String(p.path || '').split('\\').join('/')}`;
}

/**
 * Subscribe / unsubscribe to notifications for a pin target. Best-effort —
 * failures are logged but never throw, so a subscription hiccup can't break
 * the pin toggle that just succeeded.
 */
async function syncSubscription(item, subscribe) {
    try {
        const resp = await fetch(SUBSCRIPTIONS_API, {
            method: subscribe ? 'POST' : 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: item.type, path: item.path, spaceName: item.spaceName })
        });
        const ok = resp.ok || (resp.status === 404 && !subscribe);
        if (!ok) {
            const detail = await resp.text().catch(() => '');
            console.warn(`[PinController] subscription ${subscribe ? 'POST' : 'DELETE'} failed (${resp.status}):`, detail);
            return;
        }
        // Tell the notification UI to refresh its in-memory list; it loads
        // subscriptions once at boot, so without this the panel stays stale
        // after a pin toggle.
        window.dispatchEvent(new CustomEvent('kr:subscriptions-changed', {
            detail: { type: item.type, path: item.path, action: subscribe ? 'subscribe' : 'unsubscribe' }
        }));
    } catch (err) {
        console.warn('[PinController] subscription sync failed:', err);
    }
}

export const pinController = {
    app: null,
    pins: [],
    pinKeys: new Set(),
    _loaded: false,

    init(app) {
        this.app = app;
        this.app.pinController = this;
    },

    async loadPins() {
        try {
            // The store is per CONTENT ROOT; `space` tells the server which
            // root to read AND which view to scope the results to. The server
            // filters by the space's real visibility, so there is deliberately
            // no client-side filter afterwards.
            const sp = this.app?.currentSpace?.name;
            const url = sp ? `${API}?space=${encodeURIComponent(sp)}` : API;
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) {
                this.pins = [];
                this.pinKeys = new Set();
                return;
            }
            const data = await resp.json();
            this.pins = Array.isArray(data.pins) ? data.pins : [];
            this.pinKeys = new Set(this.pins.map(pinKey));
            this._loaded = true;
        } catch (err) {
            console.warn('[PinController] loadPins failed:', err);
            this.pins = [];
            this.pinKeys = new Set();
        }
    },

    isPinned(item) {
        if (!item || !item.type || !item.path) return false;
        return this.pinKeys.has(pinKey(item));
    },

    async togglePin(item) {
        if (!item || !item.type || !item.path) {
            console.warn('[PinController] togglePin called with incomplete item:', item);
            return false;
        }
        const currentlyPinned = this.isPinned(item);
        const method = currentlyPinned ? 'DELETE' : 'POST';
        try {
            const resp = await fetch(API, {
                method,
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: item.type,
                    path: item.path,
                    spaceName: item.spaceName,
                    title: item.title
                })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            this.pins = Array.isArray(data.pins) ? data.pins : this.pins;
            this.pinKeys = new Set(this.pins.map(pinKey));

            // Keep notification subscriptions in lockstep with pins: pinning
            // subscribes, unpinning unsubscribes. Best-effort, awaited so the
            // subscription state is settled before we return.
            await syncSubscription(item, !currentlyPinned);

            // Refresh the home page section if it's currently being viewed.
            if (this.app && typeof this.app.loadPinnedFiles === 'function'
                && this.app.currentView === 'home') {
                this.app.loadPinnedFiles();
            }
            return !currentlyPinned;
        } catch (err) {
            console.error('[PinController] togglePin failed:', err);
            this.app?.showNotification?.(`Failed to update pin: ${err.message}`, 'error');
            return currentlyPinned; // unchanged
        }
    },

    /**
     * Wire a button element to act as a pin toggle for the given item.
     * Updates label/icon to reflect current state and re-syncs after each click.
     */
    wirePinButton(buttonEl, item) {
        if (!buttonEl || !item) return;
        // Replace the button to drop any prior listeners.
        buttonEl.onclick = null;
        this._renderButton(buttonEl, item);
        buttonEl.onclick = async (e) => {
            e.preventDefault();
            buttonEl.disabled = true;
            await this.togglePin(item);
            buttonEl.disabled = false;
            this._renderButton(buttonEl, item);
        };
    },

    _renderButton(buttonEl, item) {
        const pinned = this.isPinned(item);
        buttonEl.classList.toggle('pinned', pinned);
        buttonEl.title = pinned ? 'Unpin from home' : 'Pin to home';
        const icon = pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle';
        const text = pinned ? 'Pinned' : 'Pin';
        buttonEl.innerHTML = `<i class="bi ${icon}"></i> <span class="pin-text">${text}</span>`;
    },

    /**
     * Open a pinned item in the appropriate view.
     *
     * Opens it in the CURRENT space. A pin records only a path, and the server
     * only returns pins this space can see, so the space you are standing in is
     * the right one — and it is what makes a pin work from whichever view you
     * happen to be in. (`item.spaceName` is only present on a legacy record.)
     */
    openPinned(item) {
        if (!item) return;
        const spaceName = this.app?.currentSpace?.name || item.spaceName;
        if (item.type === 'document') {
            documentController.openDocumentByPath(item.path, spaceName);
        } else if (item.type === 'folder') {
            navigationController.loadFolderContent(item.path);
        }
    }
};
