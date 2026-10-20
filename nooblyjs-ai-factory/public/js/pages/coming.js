// Lifecycle v3 (Phase 16b): the Engineering, Build and Test rows whose pages a later phase brings. Each says in words
// what will be here and which phase brings it, and where the decision is taken until then (Home · Approvals). The words
// are the route's `meta` (public/js/module.js).
import { h } from '../lib.js';
import { pageHead } from '../parts.js';

export function render(view, { route }) {
  const m = route?.meta ?? {};
  view.replaceChildren(h('div.fx-root', {},
    pageHead(route?.title ?? 'Coming next', m.lead),
    h('section.card', { 'aria-label': `${route?.title ?? 'This page'}: what comes` },
      h('p', {}, m.text),
      m.phase ? h('p.muted', {}, `Built in ${m.phase}.`) : null,
      m.link ? h('p', {}, h('a', { href: m.link.href }, m.link.label)) : null)));
}
