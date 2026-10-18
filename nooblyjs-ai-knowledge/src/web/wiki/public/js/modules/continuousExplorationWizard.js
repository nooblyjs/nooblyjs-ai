/**
 * Continuous Exploration Wizard — the "Create Continuous Exploration" flow, ported from the retired
 * standalone Continuous Exploration app's ProjectWizard.
 *
 * Steps:
 *   1. Details   — name + description
 *   2. Template  — pick the prompt+doc-list bundle (from the space's
 *                  .system/continuous-explorations/.templates/, seeded with defaults on first use)
 *   3. Context   — search THIS space for the folders and files the AI may use as
 *                  grounding, in the order it should read them
 *                  (continuousExplorationContextPicker.js)
 *   4. Review    — summary of choices + Launch button
 *
 * Renders into #continuousExplorationWizardContent (the #continuousExplorationWizardView shell in
 * index.html). Opening remembers which view was visible; Cancel restores it,
 * Launch creates the project as a visible folder in the target space and
 * opens the continuous exploration workspace.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-11
 */

import { continuousExplorationController } from "./continuousExplorationController.js";
import { createContextPicker } from "./continuousExplorationContextPicker.js";

const API = '/applications/wiki/api/continuous-explorations';

const STEPS = ['details', 'template', 'context', 'review'];
const STEP_TITLES = ['Project details', 'Template', 'Wiki context', 'Review & launch'];

function el(id) { return document.getElementById(id); }
function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export const continuousExplorationWizard = {
    app: null,
    state: null,
    space: null,
    returnViewId: null,

    init(app) {
        this.app = app;
    },

    /**
     * Entry point for the right-click context menu — the continuous exploration becomes a
     * visible folder under `parentPath` ('' = space root) in the current space.
     */
    openForCurrentSpace(parentPath = '') {
        const space = this.app?.currentSpace;
        if (!space) {
            alert('Open a space first — a continuous exploration must live in a space.');
            return;
        }
        this.open(space, parentPath);
    },

    open(space, parentPath = '') {
        if (!space) return;
        this.space = space;
        this.parentPath = String(parentPath || '').replace(/^\/+|\/+$/g, '');
        this.state = {
            stepIndex: 0,
            details: { name: '', description: '' },
            templateId: null,
            templates: null,        // loaded lazily from the space's .system/continuous-explorations/.templates/
            wikiContext: []         // ordered [{ spaceId, spaceName, folderPath, name, kind }]
        };
        // Remember the visible view so Cancel can restore it.
        const visible = document.querySelector('#mainContent .view:not(.hidden)');
        this.returnViewId = visible ? visible.id : null;

        this.app?.setActiveView('continuousExplorationWizard');
        const view = el('continuousExplorationWizardView');
        if (view) view.scrollTop = 0;

        this.renderShell();
        this.render();
        this.loadTemplates();
    },

    close({ restore } = { restore: true }) {
        const mount = el('continuousExplorationWizardContent');
        if (mount) mount.innerHTML = '';
        if (!restore) return;
        if (this.returnViewId && el(this.returnViewId)) {
            this.app?.setActiveView(this.returnViewId.replace(/View$/, ''));
        } else if (this.app?.showHome) {
            this.app.showHome();
        }
    },

    // ─── Data ────────────────────────────────────────────────────────────

    async loadTemplates() {
        try {
            const res = await fetch(`${API}/templates?spaceId=${encodeURIComponent(this.space.id)}`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            this.state.templates = body.templates || [];
        } catch (err) {
            console.error('[continuous-exploration] load templates failed:', err);
            this.state.templates = [];
        }
        // Re-render if the user is sitting on the template step.
        if (STEPS[this.state.stepIndex] === 'template') this.render();
    },

    // ─── State / navigation ────────────────────────────────────────────────

    goto(idx) {
        if (idx < 0 || idx >= STEPS.length) return;
        if (idx > this.state.stepIndex) {
            const err = this.validateStep(this.state.stepIndex);
            if (err) { this.showError(err); return; }
        }
        this.state.stepIndex = idx;
        this.render();
    },

    validateStep(idx) {
        if (STEPS[idx] === 'details' && !this.state.details.name.trim()) {
            return 'Please give the continuous exploration a name.';
        }
        return null;
    },

    showError(msg) {
        const body = el('ceWizardBody');
        if (!body) return;
        let banner = body.querySelector('.ce-error');
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'ce-error';
            body.insertBefore(banner, body.firstChild);
        }
        banner.textContent = msg;
        setTimeout(() => { if (banner.parentNode) banner.remove(); }, 3500);
    },

    // ─── Main render ─────────────────────────────────────────────────────

    renderShell() {
        const mount = el('continuousExplorationWizardContent');
        if (!mount) return;
        mount.innerHTML = `
          <div style="padding: 32px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px;">
              <div>
                <div style="font-size: 11px; color: var(--kr-ink-400, #9ca3af); text-transform: uppercase; letter-spacing: .6px; font-weight: 700;">
                  Continuous Exploration · New project in ${esc(this.space.name)}${this.parentPath ? ' / ' + esc(this.parentPath) : ''}
                </div>
                <h1 style="font-weight: 700; margin: 4px 0 0; font-size: 24px;">Create a new Continuous Exploration</h1>
                <div id="ceWizardSubtitle" style="color: var(--kr-ink-500, #6b7280); font-size: 13px; margin-top: 2px;"></div>
              </div>
              <button class="ce-btn ghost sm" id="ceWizardCloseBtn" title="Cancel">
                <i class="bi bi-x-lg"></i> Cancel
              </button>
            </div>

            <div id="ceWizardStepper" style="display: flex; gap: 8px; padding: 16px; background: #fff; border: 1px solid var(--kr-border, #e5e7eb); border-radius: 12px; margin-bottom: 16px;"></div>

            <div id="ceWizardBody" style="background: #fff; border: 1px solid var(--kr-border, #e5e7eb); border-radius: 12px; padding: 28px;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
              <button class="ce-btn link" id="ceWizardBackBtn">
                <i class="bi bi-arrow-left"></i> Back
              </button>
              <div style="display: flex; gap: 8px;">
                <button class="ce-btn ghost" id="ceWizardCancelBtn">Cancel</button>
                <button class="ce-btn" id="ceWizardNextBtn">
                  Next <i class="bi bi-arrow-right"></i>
                </button>
                <button class="ce-btn" id="ceWizardLaunchBtn" style="display: none; font-weight: 600;">
                  <i class="bi bi-rocket-takeoff"></i> Launch
                </button>
              </div>
            </div>
          </div>
        `;
        el('ceWizardBackBtn').addEventListener('click', () => this.goto(this.state.stepIndex - 1));
        el('ceWizardNextBtn').addEventListener('click', () => this.goto(this.state.stepIndex + 1));
        el('ceWizardLaunchBtn').addEventListener('click', () => this.launch());
        el('ceWizardCloseBtn').addEventListener('click', () => this.close());
        el('ceWizardCancelBtn').addEventListener('click', () => this.close());
    },

    renderStepper() {
        const stepper = el('ceWizardStepper');
        if (!stepper) return;
        stepper.innerHTML = STEPS.map((s, i) => {
            const isActive = i === this.state.stepIndex;
            const isDone = i < this.state.stepIndex;
            const bg = isActive ? 'linear-gradient(135deg, var(--kr-teal-500, #C2471F), var(--kr-teal-700, #A63F1C))' : (isDone ? 'var(--kr-teal-700, #A63F1C)' : '#e5e7eb');
            const color = (isActive || isDone) ? '#fff' : '#6b7280';
            return `
              <div style="flex: 1; display: flex; align-items: center; gap: 8px; cursor: ${isDone ? 'pointer' : 'default'};" data-step-jump="${isDone ? i : ''}">
                <div style="width: 30px; height: 30px; border-radius: 50%; background: ${bg}; color: ${color}; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0;">
                  ${isDone ? '<i class="bi bi-check2"></i>' : (i + 1)}
                </div>
                <div style="font-size: 12.5px; color: ${isActive ? '#1a1a1a' : '#6b7280'}; font-weight: ${isActive ? 700 : 500};">${STEP_TITLES[i]}</div>
              </div>
            `;
        }).join('');
        stepper.querySelectorAll('[data-step-jump]').forEach(node => {
            const idx = node.getAttribute('data-step-jump');
            if (idx === '') return;
            node.addEventListener('click', () => this.goto(Number(idx)));
        });
        const sub = el('ceWizardSubtitle');
        if (sub) sub.textContent = `Step ${this.state.stepIndex + 1} of ${STEPS.length} — ${STEP_TITLES[this.state.stepIndex]}`;
    },

    renderFooter() {
        const isLast = this.state.stepIndex === STEPS.length - 1;
        const isFirst = this.state.stepIndex === 0;
        el('ceWizardBackBtn').style.visibility = isFirst ? 'hidden' : 'visible';
        el('ceWizardNextBtn').style.display = isLast ? 'none' : '';
        el('ceWizardLaunchBtn').style.display = isLast ? '' : 'none';
    },

    render() {
        if (!el('ceWizardStepper')) this.renderShell();
        this.renderStepper();
        this.renderFooter();
        const step = STEPS[this.state.stepIndex];
        const body = el('ceWizardBody');
        if (step === 'details') this.renderDetailsStep(body);
        else if (step === 'template') this.renderTemplateStep(body);
        else if (step === 'context') this.renderContextStep(body);
        else if (step === 'review') this.renderReviewStep(body);
    },

    // ─── Step 1: Details ─────────────────────────────────────────────────

    renderDetailsStep(body) {
        body.innerHTML = `
          <h2 style="font-weight: 700; margin: 0 0 6px; font-size: 22px;">Tell us about the project</h2>
          <p style="color: var(--kr-ink-500, #6b7280); margin-bottom: 24px;">
            Give the continuous exploration a name — it becomes a folder in
            <strong>${esc(this.space.name)}${this.parentPath ? ' / ' + esc(this.parentPath) : ''}</strong>.
            You'll paste the actual requirement after the project is created.
          </p>
          <div style="margin-bottom: 16px;">
            <label class="form-label" style="font-weight: 600;">Name</label>
            <input type="text" class="form-control" id="ceWizardName"
              placeholder="e.g. Acme Supplier Portal Onboarding"
              value="${esc(this.state.details.name)}">
          </div>
          <div>
            <label class="form-label" style="font-weight: 600;">Description <small style="color: var(--kr-ink-400);">(optional)</small></label>
            <textarea class="form-control" id="ceWizardDesc" rows="4"
              style="resize: vertical;"
              placeholder="A few lines about the supplier or feature">${esc(this.state.details.description)}</textarea>
          </div>
        `;
        const nameEl = body.querySelector('#ceWizardName');
        const descEl = body.querySelector('#ceWizardDesc');
        nameEl.addEventListener('input', () => { this.state.details.name = nameEl.value; });
        descEl.addEventListener('input', () => { this.state.details.description = descEl.value; });
        nameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.goto(this.state.stepIndex + 1); }
        });
        setTimeout(() => nameEl.focus(), 100);
    },

    // ─── Step 2: Template ────────────────────────────────────────────────

    renderTemplateStep(body) {
        if (this.state.templates === null) {
            body.innerHTML = `
              <h2 style="font-weight: 700; margin: 0 0 6px; font-size: 22px;">Pick a template</h2>
              <p style="color: var(--kr-ink-500, #6b7280);">Loading templates…</p>`;
            return;
        }
        const renderCard = (t) => {
            const selected = (this.state.templateId || '') === (t.id || '');
            const scopeBadge = t.scope === 'personal'
                ? '<span style="background:#3b3f88;color:#fff;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:600;">Mine</span>'
                : (t.scope === 'space'
                    ? '<span style="background:#6b7280;color:#fff;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:600;">Space</span>'
                    : '');
            return `
              <button type="button" class="ce-template-pick"
                data-template-id="${esc(t.id || '')}"
                style="text-align: left; padding: 16px 18px; border: 2px solid ${selected ? 'var(--kr-teal-500, #C2471F)' : 'var(--kr-border, #e5e7eb)'};
                       border-radius: 12px; background: ${selected ? 'var(--kr-teal-50, #FFF4EE)' : '#fff'}; cursor: pointer;
                       display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                  <strong style="font-size: 15px;">${esc(t.name)}</strong>
                  <span style="display:flex;gap:6px;align-items:center;">
                    ${scopeBadge}
                    ${t.documents && t.documents.length
                      ? `<span style="background: var(--kr-teal-700, #A63F1C); color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600;">${t.documents.length} docs</span>`
                      : ''}
                  </span>
                </div>
                <div style="font-size: 12.5px; color: var(--kr-ink-500, #6b7280); line-height: 1.45;">
                  ${esc(t.description || '—')}
                </div>
                ${(t.documents && t.documents.length)
                  ? `<div style="margin-top: 4px; font-size: 11px; color: var(--kr-ink-400, #9ca3af);">
                       ${t.documents.map(d => esc(d.name)).join(' · ')}
                     </div>`
                  : ''}
              </button>`;
        };

        const personal = this.state.templates.filter(t => t.scope === 'personal');
        const spaceLevel = this.state.templates.filter(t => t.scope !== 'personal');
        const header = (label) => `<div style="grid-column: 1 / -1; font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--kr-ink-500,#6b7280); margin-top:6px;">${label}</div>`;
        const noTpl = renderCard({ id: '', name: 'No template', description: 'Start blank — the AI uses generic guidance and you supply all framing in the requirement.', documents: [] });

        body.innerHTML = `
          <h2 style="font-weight: 700; margin: 0 0 6px; font-size: 22px;">Pick a template</h2>
          <p style="color: var(--kr-ink-500, #6b7280); margin-bottom: 20px;">
            Templates bundle a system prompt with the list of documents the AI will draft.
            Your personal templates and this space's shared ones both appear here — manage them from the Templates screen.
          </p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            ${noTpl}
            ${personal.length ? header('My templates') + personal.map(renderCard).join('') : ''}
            ${spaceLevel.length ? header('Space templates') + spaceLevel.map(renderCard).join('') : ''}
          </div>
        `;
        body.querySelectorAll('.ce-template-pick').forEach(card => {
            card.addEventListener('click', () => {
                this.state.templateId = card.getAttribute('data-template-id') || null;
                this.renderTemplateStep(body);
            });
        });
    },

    // ─── Step 3: Wiki context ────────────────────────────────────────────

    /**
     * Grounding is picked from THIS space only — the exploration is created in
     * it, and its content root is what the loader reads. See
     * continuousExplorationContextPicker.js for the search/order behaviour.
     */
    renderContextStep(body) {
        body.innerHTML = `
          <h2 style="font-weight: 700; margin: 0 0 6px; font-size: 22px;">Select wiki context</h2>
          <p style="color: var(--kr-ink-500, #6b7280); margin-bottom: 16px;">
            Search <strong>${esc(this.space.name)}</strong> for the folders and files the AI may read while drafting —
            we'll inject excerpts from them. The list is read top to bottom until the context budget is full,
            so put the most important first. Selecting nothing is fine — the AI will then use only the
            requirement and template.
          </p>
          <div id="ceWizardContextPicker"></div>
        `;
        createContextPicker({
            mount: body.querySelector('#ceWizardContextPicker'),
            space: this.space,
            selection: this.state.wikiContext,
            onChange: (items) => { this.state.wikiContext = items; }
        });
    },

    // ─── Step 4: Review ──────────────────────────────────────────────────

    renderReviewStep(body) {
        const tpl = this.state.templateId
            ? (this.state.templates || []).find(t => t.id === this.state.templateId)
            : null;
        const tplName = tpl ? tpl.name : 'No template';
        const tplDocs = tpl && tpl.documents ? tpl.documents : [];

        body.innerHTML = `
          <h2 style="font-weight: 700; margin: 0 0 6px; font-size: 22px;">Review & launch</h2>
          <p style="color: var(--kr-ink-500, #6b7280); margin-bottom: 20px;">
            Here's what we'll create in <strong>${esc(this.space.name)}</strong>. Hit <strong>Launch</strong> when you're happy.
          </p>

          <div class="ce-card">
            <div class="ce-card-label">Project</div>
            <div style="font-size: 18px; font-weight: 700;">${esc(this.state.details.name) || '<span style="color: var(--kr-ink-400);">No name</span>'}</div>
            ${this.state.details.description ? `<div style="color: var(--kr-ink-500, #6b7280); margin-top: 2px; white-space: pre-line;">${esc(this.state.details.description)}</div>` : ''}
          </div>

          <div class="ce-card">
            <div class="ce-card-label">Template</div>
            <div style="font-weight: 600; margin-top: 4px;">
              <i class="bi bi-diagram-3" style="color: var(--kr-teal-700, #A63F1C);"></i> ${esc(tplName)}
            </div>
            ${tpl && tpl.description ? `<div style="color: var(--kr-ink-500, #6b7280); margin-top: 2px; font-size: 12.5px;">${esc(tpl.description)}</div>` : ''}
            ${tplDocs.length
              ? `<div style="margin-top: 8px; font-size: 12px; color: var(--kr-ink-500, #6b7280);">
                   Will draft: ${tplDocs.map(d => `<code>${esc(d.name)}</code>`).join(' · ')}
                 </div>`
              : ''}
          </div>

          <div class="ce-card">
            <div class="ce-card-label">Wiki context <small style="text-transform: none; letter-spacing: 0;">(read in this order)</small></div>
            ${this.state.wikiContext.length
              ? `<ol style="margin: 8px 0 0; padding-left: 20px;">
                   ${this.state.wikiContext.map(c => `
                     <li>
                       <i class="bi bi-${!c.folderPath ? 'collection' : (c.kind === 'file' ? 'file-earmark-text' : 'folder2')}" style="color: var(--kr-teal-700, #A63F1C);"></i>
                       <strong>${esc(c.name)}</strong>
                       <small style="color: var(--kr-ink-400);">${c.folderPath ? esc(c.spaceName) + ' / ' + esc(c.folderPath) : esc(c.spaceName) + ' (entire space)'}</small>
                     </li>
                   `).join('')}
                 </ol>`
              : `<div style="color: var(--kr-ink-400); margin-top: 4px;">None — AI will use only the requirement and template.</div>`}
          </div>

          <div style="background: var(--kr-teal-50, #FFF4EE); border: 1px solid var(--kr-teal-100, #FCE3D6); border-radius: 12px; padding: 14px 16px; font-size: 13px; color: var(--kr-teal-800, #7E2E12);">
            <i class="bi bi-rocket-takeoff"></i>
            Click <strong>Launch</strong> to create a continuous exploration folder in
            <strong>${esc(this.space.name)}${this.parentPath ? ' / ' + esc(this.parentPath) : ''}</strong>.
            You'll add the requirement next; generated documents land in that folder as wiki pages.
          </div>
        `;
    },

    // ─── Launch ──────────────────────────────────────────────────────────

    async launch() {
        const err = this.validateStep(0);
        if (err) {
            this.state.stepIndex = 0;
            this.render();
            this.showError(err);
            return;
        }
        const payload = {
            name: this.state.details.name.trim(),
            description: this.state.details.description.trim(),
            templateId: this.state.templateId || null,
            wikiContext: this.state.wikiContext,
            spaceId: this.space.id,
            spaceName: this.space.name,
            parentPath: this.parentPath || ''
        };
        const launchBtn = el('ceWizardLaunchBtn');
        if (launchBtn) launchBtn.disabled = true;
        try {
            const res = await fetch(`${API}/projects`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            this.close({ restore: false });
            // The new continuous exploration folder must show up in the navigation tree.
            import('./navigationcontroller.js')
                .then(m => m.navigationController.loadFileTree())
                .catch(() => { /* tree refresh is best-effort */ });
            continuousExplorationController.openProject(body.project.id, body.project);
        } catch (e) {
            console.error('[continuous-exploration] wizard launch failed', e);
            this.showError('Failed to create continuous exploration: ' + e.message);
            if (launchBtn) launchBtn.disabled = false;
        }
    }
};
