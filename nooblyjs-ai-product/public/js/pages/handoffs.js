// Handoffs (product.md §5.6): every stage-to-stage handoff, including items sent back, newest first.
// Data: GET /handoffs?kind=.
import { html } from '/ui/js/html.js';
import { pageHead, card, listRow } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, ago } from '../lib.js';

const FILTERS = [['', 'All'], ['handoff', 'Handed on'], ['sent-back', 'Sent back']];

export async function render(view, { query, ctx }) {
  const kind = FILTERS.some(([k]) => k && k === query.get('kind')) ? query.get('kind') : '';
  await reloadable(view, ctx, async () => {
    let handoffs;
    try {
      ({ handoffs } = await ctx.api.get('handoffs', { query: kind ? { kind } : undefined }));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the handoffs'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const chips = html`<nav class="pf-chips" aria-label="Filter handoffs">${FILTERS.map(([k, l]) => html`<a class="pf-chip${k === kind ? ' pf-chip--on' : ''}" href="${hrefFor(ctx, `/handoffs${k ? `?kind=${k}` : ''}`)}"${k === kind ? html` aria-current="true"` : ''}>${l}</a>`)}</nav>`;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Product Factory · Flow', title: 'Handoffs', lead: 'Every move between stages, including items sent back.' })}
      ${chips}
      ${card({
        title: `${handoffs.length} handoff${handoffs.length === 1 ? '' : 's'}`,
        body: handoffs.length
          ? html`<div class="rows">${handoffs.map((h) => listRow({
            title: `${h.itemId} · ${h.title}`,
            meta: `${h.text} · ${h.byName ?? 'unknown'} · ${ago(h.at)}`,
            pill: h.kind === 'sent-back' ? { text: 'Sent back', tone: 'warning' } : { text: 'Handed on', tone: 'success' },
            href: hrefFor(ctx, `/specs/${h.itemId}`),
          }))}</div>`
          : html`<p class="muted">Nothing has moved between stages yet.</p>`,
      })}`);
  });
}
