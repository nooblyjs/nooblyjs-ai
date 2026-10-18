// All specs, newest first, filtered by status. Data: GET /specs?status=.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable } from '/ui/js/components/index.js';
import { hrefFor, specPill, errorCard, isAbort, reloadable, ago } from '../lib.js';

const FILTERS = [['', 'All'], ['awaiting-brief', 'Awaiting a brief'], ['drafting', 'Drafting'], ['in-review', 'In review'], ['changes-requested', 'Changes requested'], ['approved', 'Approved']];

export async function render(view, { query, ctx }) {
  const status = FILTERS.some(([k]) => k && k === query.get('status')) ? query.get('status') : '';

  await reloadable(view, ctx, async () => {
    let specs;
    try {
      ({ specs } = await ctx.api.get('specs', { query: status ? { status } : undefined }));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the specs'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const chips = html`<nav class="pf-chips" aria-label="Filter specs">${FILTERS.map(([k, l]) => html`<a class="pf-chip${k === status ? ' pf-chip--on' : ''}" href="${hrefFor(ctx, `/specs${k ? `?status=${k}` : ''}`)}"${k === status ? html` aria-current="true"` : ''}>${l}</a>`)}</nav>`;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Product Factory · Stage 1', title: 'Specs', lead: 'Every spec, its version and where it is.' })}
      ${chips}
      <section class="card">${dataTable({
        caption: 'Specs',
        empty: 'No specs here.',
        rows: specs,
        columns: [
          { key: 'id', label: 'Spec', render: (s) => html`<a href="${hrefFor(ctx, `/specs/${s.id}`)}">${s.id} ${s.title}</a>` },
          { key: 'product', label: 'Product', render: (s) => (s.product ? html`${s.product}${s.portfolio ? html`<span class="muted"> · ${s.portfolio}</span>` : ''}` : '—') },
          { key: 'status', label: 'Status', render: (s) => specPill(s) },
          { key: 'version', label: 'Version', numeric: true, render: (s) => (s.version ? `v${s.version}` : '—') },
          { key: 'owner', label: 'Owner', render: (s) => s.owner?.name ?? '—' },
          { key: 'updatedAt', label: 'Updated', render: (s) => ago(s.updatedAt) },
        ],
      })}</section>`);
  });
}
