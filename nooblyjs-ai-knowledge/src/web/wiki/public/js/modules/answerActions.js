/**
 * Answer actions (NooblyJS Phase 8)
 *
 * What a person can do with an answer the AI panel built from the wiki's pages:
 *
 *   Add to item     its sources become Linked knowledge on a NooblyJS item's spec
 *   Save as page    the question, the answer and its sources become a page
 *   This is wrong   the report is recorded and the pages behind the answer are
 *                   flagged for review
 *
 * Each button opens a small form under the answer and reports what happened in
 * words, in a status line a screen reader announces. The server decides who may
 * do each (an agent never may) and answers with a sentence when it refuses; that
 * sentence is shown as it is. Built with createElement and textContent only: an
 * answer is text a model wrote from pages anyone may have edited.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

const API = '/applications/wiki/api/knowledge';
const LAST_ITEM_KEY = 'noobly.knowledge.lastItem';
let serial = 0;

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child) node.append(child);
    return node;
}

async function post(path, body) {
    const response = await fetch(`${API}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
        // The wiki answers { error: 'sentence' }; the NooblyJS host, when it refuses first, { error: { message } }.
        const message = typeof data.error === 'string' ? data.error : data.error && data.error.message;
        throw new Error(message || `The request failed (HTTP ${response.status}).`);
    }
    return data;
}

const remembered = () => {
    try { return localStorage.getItem(LAST_ITEM_KEY) || ''; } catch { return ''; }
};
const remember = (itemId) => {
    try { localStorage.setItem(LAST_ITEM_KEY, itemId); } catch { /* private mode: nothing to remember */ }
};

export const answerActions = {
    /**
     * The actions row for one answer.
     * @param {string} answerId - the id the server gave the answer
     * @param {{ spaces?: Array<{ name: string, permissions?: string }> }} [options]
     * @returns {HTMLElement}
     */
    build(answerId, options = {}) {
        const n = ++serial;
        const status = el('p', { className: 'ai-answer-status', role: 'status', 'aria-live': 'polite' });
        const forms = el('div', { className: 'ai-answer-forms' });
        const say = (text, tone = '') => {
            status.textContent = text;
            status.dataset.tone = tone;
        };
        const buttons = [];
        const open = (form, button) => {
            const wasOpen = button.getAttribute('aria-expanded') === 'true';
            forms.replaceChildren();
            buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
            if (wasOpen) return;
            button.setAttribute('aria-expanded', 'true');
            forms.append(form);
            form.querySelector('input, select, textarea')?.focus();
        };
        /** Run one action from its form: disable its button, say what happened, close the form when it worked. */
        const submit = (form, run) => async (event) => {
            event.preventDefault();
            const send = form.querySelector('button[type="submit"]');
            send.disabled = true;
            try {
                say(await run(), 'ok');
                forms.replaceChildren();
                buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
            } catch (error) {
                say(error.message, 'error');
            } finally {
                send.disabled = false;
            }
        };

        // Add to item
        const itemInput = el('input', { id: `ai-answer-item-${n}`, type: 'text', value: remembered(), placeholder: 'PRD-031', required: true, maxlength: 20, autocomplete: 'off' });
        const linkForm = el('form', { className: 'ai-answer-form' },
            el('label', { for: itemInput.id, text: 'NooblyJS item' }), itemInput,
            el('button', { type: 'submit', className: 'ai-answer-send', text: 'Add' }));
        linkForm.addEventListener('submit', submit(linkForm, async () => {
            const itemId = itemInput.value.trim().toUpperCase();
            const result = await post(`/answers/${encodeURIComponent(answerId)}/link`, { itemId });
            remember(itemId);
            return result.added
                ? `Added ${result.added} source${result.added === 1 ? '' : 's'} to ${result.itemId}'s linked knowledge.`
                : `${result.itemId} already links every source of this answer.`;
        }));

        // Save as page
        const writable = (options.spaces || []).filter((s) => s && s.name && s.permissions !== 'read-only');
        const spaceSelect = el('select', { id: `ai-answer-space-${n}`, required: true }, writable.map((s) => el('option', { value: s.name, text: s.name })));
        const titleInput = el('input', { id: `ai-answer-title-${n}`, type: 'text', placeholder: 'Page title (the question, if left empty)', maxlength: 120 });
        const saveForm = el('form', { className: 'ai-answer-form' },
            el('label', { for: spaceSelect.id, text: 'Space' }), spaceSelect,
            el('label', { for: titleInput.id, text: 'Title' }), titleInput,
            el('button', { type: 'submit', className: 'ai-answer-send', text: 'Save' }));
        saveForm.addEventListener('submit', submit(saveForm, async () => {
            const result = await post(`/answers/${encodeURIComponent(answerId)}/save`, { spaceName: spaceSelect.value, title: titleInput.value.trim() || undefined });
            return `Saved as ${result.path} in ${result.spaceName}.`;
        }));

        // This is wrong
        const reasonInput = el('textarea', { id: `ai-answer-reason-${n}`, rows: 2, maxlength: 500, placeholder: 'What is wrong? (optional)' });
        const wrongForm = el('form', { className: 'ai-answer-form' },
            el('label', { for: reasonInput.id, text: 'What is wrong with this answer?' }), reasonInput,
            el('button', { type: 'submit', className: 'ai-answer-send', text: 'Report' }));
        wrongForm.addEventListener('submit', submit(wrongForm, async () => {
            const result = await post(`/answers/${encodeURIComponent(answerId)}/wrong`, { reason: reasonInput.value.trim() || undefined });
            const count = (result.flags || []).length;
            return `Reported. ${count} document${count === 1 ? ' is' : 's are'} flagged for review.`;
        }));

        const action = (label, form) => {
            const button = el('button', { type: 'button', className: 'ai-answer-action', 'aria-expanded': 'false', text: label });
            button.addEventListener('click', () => open(form, button));
            buttons.push(button);
            return button;
        };

        return el('div', { className: 'ai-answer-actions', 'data-answer-id': answerId },
            el('div', { className: 'ai-answer-buttons', role: 'group', 'aria-label': 'What to do with this answer' },
                action('Add to item', linkForm),
                writable.length ? action('Save as page', saveForm) : null,
                action('This is wrong', wrongForm)),
            forms,
            status);
    }
};
