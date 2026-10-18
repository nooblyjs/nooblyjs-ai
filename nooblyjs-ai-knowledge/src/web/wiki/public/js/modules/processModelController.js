/**
 * Process model controller (NooblyJS Phase 8)
 *
 * Turns a page's ```process-model``` block into the model around that page:
 *
 *   - where the page sits: its parents, as a trail back to L0
 *   - on the L0 page, the three bands (Enterprise, Value chain, Support) with a
 *     chevron per L1 process, each a link to that process's page
 *   - the processes under this one
 *   - "Used across NooblyJS": the items that use the process
 *
 * The block itself only says where ONE page sits. The picture depends on the
 * other pages of the model and on which of them the reader may open, so it is
 * asked from the server (/knowledge/process-model) rather than worked out here.
 *
 * A chevron is a real link to the page's own wiki URL, so opening one in a new
 * tab, deep links and refresh all work; a plain click stays in the app. Built
 * with createElement and textContent only: names and codes are page content.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

import { documentController } from './documentcontroller.js';

const API = '/applications/wiki/api/knowledge/process-model';

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) if (child) node.append(child);
    return node;
}

export const processModelController = {
    /**
     * Replace every process-model placeholder inside a freshly rendered document.
     * @param {HTMLElement} rootEl - the just-inserted content wrapper
     * @param {Object} doc - the host document ({path, spaceName})
     */
    hydrate(rootEl, doc) {
        if (!rootEl || !doc || !doc.path) return;
        rootEl.querySelectorAll('.kr-process-model[data-process-model-placeholder]').forEach((section, index) => {
            delete section.dataset.processModelPlaceholder;
            // One model per page: a second block on the same page would only repeat it.
            if (index > 0) return void section.remove();
            this._hydrateSection(section, doc).catch((error) => {
                console.error('[ProcessModel] hydrate failed:', error);
                this._note(section, 'Could not load the process model.');
            });
        });
    },

    async _hydrateSection(section, doc) {
        const spaceName = doc.spaceName || documentController.app?.currentSpace?.name || '';
        const response = await fetch(`${API}?spaceName=${encodeURIComponent(spaceName)}&path=${encodeURIComponent(doc.path)}`, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!section.isConnected) return;
        if (!response.ok || !data.success) return this._note(section, data.error || 'Could not load the process model.');
        section.replaceChildren(...this._render(data.model, spaceName));
    },

    _note(section, text) {
        section.replaceChildren(el('p', { className: 'kr-process-model-loading', text }));
    },

    /** A link to a model page: its own URL, opened in place on a plain click. */
    _link(page, spaceName, className, ...children) {
        const link = el('a', { href: page.href, className }, children);
        link.addEventListener('click', (event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            documentController.openDocumentByPath(page.path, spaceName);
        });
        return link;
    },

    _process(page, spaceName, className) {
        return this._link(page, spaceName, className,
            el('span', { className: 'kr-pm-name', text: page.name }),
            el('span', { className: 'kr-pm-code', text: page.code }),
            page.children ? el('span', { className: 'kr-pm-count', text: `${page.children} process${page.children === 1 ? '' : 'es'} below` }) : null);
    },

    _render(model, spaceName) {
        const out = [];
        const page = model.page;

        if (model.parents && model.parents.length) {
            out.push(el('nav', { className: 'kr-pm-trail', 'aria-label': 'Where this process sits' },
                el('ol', {}, [
                    ...model.parents.map((p) => el('li', {}, this._link(p, spaceName, 'kr-pm-trail-link', `${p.level} · ${p.name}`))),
                    el('li', { 'aria-current': 'page', text: `${page.level} · ${page.name}` })
                ])));
        }

        out.push(el('p', { className: 'kr-pm-here' },
            el('span', { className: 'kr-pm-level', text: page.level }),
            el('span', { className: 'kr-pm-code', text: page.code }),
            page.band ? el('span', { className: 'kr-pm-band-name', text: `${page.band} band` }) : null));

        if (model.bands) {
            out.push(el('div', { className: 'kr-pm-bands' }, model.bands.map((band) => {
                const id = `kr-pm-band-${band.name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
                return el('section', { className: 'kr-pm-band', 'aria-labelledby': id },
                    el('h3', { id, className: 'kr-pm-band-title', text: band.name }),
                    band.processes.length
                        ? el('ul', { className: 'kr-pm-chevrons', role: 'list' }, band.processes.map((p) => el('li', {}, this._process(p, spaceName, 'kr-pm-chevron'))))
                        : el('p', { className: 'kr-pm-empty', text: 'No processes in this band.' }));
            })));
        } else if (model.children && model.children.length) {
            out.push(el('section', { className: 'kr-pm-children', 'aria-label': `Processes under ${page.name}` },
                el('h3', { className: 'kr-pm-band-title', text: `Processes under ${page.name}` }),
                el('ul', { className: 'kr-pm-chevrons', role: 'list' }, model.children.map((p) => el('li', {}, this._process(p, spaceName, 'kr-pm-chevron'))))));
        }

        const used = model.usedIn || [];
        out.push(el('section', { className: 'kr-pm-used', 'aria-label': 'Used across NooblyJS' },
            el('h3', { className: 'kr-pm-band-title', text: 'Used across NooblyJS' }),
            used.length
                ? el('ul', { className: 'kr-pm-used-list', role: 'list' }, used.map((item) => el('li', {},
                    item.href ? el('a', { href: item.href, text: item.id }) : el('span', { text: item.id }),
                    item.title ? el('span', { className: 'kr-pm-used-title', text: ` · ${item.title}` }) : null)))
                : el('p', { className: 'kr-pm-empty', text: 'No NooblyJS item uses this process yet.' })));
        return out;
    }
};
