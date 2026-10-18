/**
 * Continuous Exploration Context Editor — focused modal for editing a continuous exploration project's
 * wikiContext, ported from the retired standalone Continuous Exploration app.
 *
 * The same picker as the wizard's step 3 (continuousExplorationContextPicker.js),
 * lifted into a modal so users can adjust grounding without walking through the
 * whole wizard. Pre-selects the project's existing context, keeps its ORDER, and
 * only saves on Save.
 *
 * Usage:
 *   continuousExplorationContextEditor.open({
 *     projectId: 'abc-123',
 *     space: { id: project.spaceId, name: project.spaceName },
 *     wikiContext: [{ spaceId, spaceName, folderPath, name, kind }, ...],
 *     onSaved: (updatedProject) => { ... }
 *   });
 *
 * @author noobly Team
 * @version 2.0.0
 * @since 2026-06-11
 */

import { createContextPicker } from './continuousExplorationContextPicker.js';

const API = '/applications/wiki/api/continuous-explorations';

function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export const continuousExplorationContextEditor = {
    overlay: null,
    state: null,
    picker: null,

    // ─── Modal scaffold ──────────────────────────────────────────────────

    ensureModal() {
        if (this.overlay) return this.overlay;
        this.overlay = document.createElement('div');
        this.overlay.className = 'ce-modal-overlay hidden';
        this.overlay.innerHTML = `
          <div class="ce-modal" role="dialog" aria-modal="true" aria-label="Edit wiki context">
            <div class="ce-modal-head">
              <div>
                <h3><i class="bi bi-folder2-open"></i> Edit wiki context</h3>
                <div class="sub">Search this space for the folders and files the AI can read while drafting.</div>
              </div>
              <button type="button" class="ce-modal-close" data-ctx-close aria-label="Close"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="ce-modal-body">
              <div data-ctx-picker></div>
            </div>
            <div class="ce-modal-foot">
              <div data-ctx-hint style="flex: 1; font-size: 12px; color: var(--kr-ink-400, #9ca3af);">
                Selecting nothing means the AI uses only the requirement and template.
              </div>
              <button type="button" class="ce-btn ghost" data-ctx-close>Cancel</button>
              <button type="button" class="ce-btn" data-ctx-save><i class="bi bi-check2"></i> Save</button>
            </div>
          </div>
        `;
        document.body.appendChild(this.overlay);

        this.overlay.querySelectorAll('[data-ctx-close]').forEach(btn =>
            btn.addEventListener('click', () => this.hide()));
        this.overlay.querySelector('[data-ctx-save]').addEventListener('click', () => this.save());

        return this.overlay;
    },

    hide() {
        if (this.overlay) this.overlay.classList.add('hidden');
    },

    // ─── Save ────────────────────────────────────────────────────────────

    async save() {
        const btn = this.overlay.querySelector('[data-ctx-save]');
        const hint = this.overlay.querySelector('[data-ctx-hint]');
        btn.disabled = true;
        hint.textContent = 'Saving…';
        try {
            const res = await fetch(`${API}/projects/${encodeURIComponent(this.state.projectId)}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wikiContext: this.state.wikiContext })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            this.hide();
            if (typeof this.state.onSaved === 'function') this.state.onSaved(body.project);
        } catch (err) {
            hint.innerHTML = `<span style="color: #b54545;">Save failed: ${esc(err.message)}</span>`;
        } finally {
            btn.disabled = false;
        }
    },

    // ─── Public ──────────────────────────────────────────────────────────

    /**
     * @param {Object} options
     * @param {string} options.projectId
     * @param {Object} options.space       - { id, name }: the project's own space, which
     *                                       scopes the search. Grounding is read from
     *                                       that content root.
     * @param {Array}  [options.wikiContext]
     * @param {Function} [options.onSaved]
     */
    async open({ projectId, space, wikiContext, onSaved }) {
        if (!projectId) return;
        if (!space || space.id === undefined || space.id === null) {
            console.warn('[continuous-exploration] context editor opened without a space — cannot scope the search.');
            return;
        }
        this.ensureModal();
        this.state = {
            projectId,
            space,
            wikiContext: Array.isArray(wikiContext) ? wikiContext.slice() : [],
            onSaved
        };

        const hint = this.overlay.querySelector('[data-ctx-hint]');
        hint.textContent = 'Selecting nothing means the AI uses only the requirement and template.';

        this.picker = createContextPicker({
            mount: this.overlay.querySelector('[data-ctx-picker]'),
            space,
            selection: this.state.wikiContext,
            onChange: (items) => { this.state.wikiContext = items; }
        });

        this.overlay.classList.remove('hidden');
        this.picker.focus();
    }
};
