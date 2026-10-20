// Every infrastructure design, its version and what it waits for. No mockup yet. Data: GET /designs.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let designs;
    try {
      ({ designs } = await ctx.api.get('designs'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the designs'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'NooblyJS · Infrastructure', title: 'Designs', lead: 'Infrastructure designs, drafted from an approved architecture. An environment is only ever built from one of these.' })}
      <section class="card" aria-label="Designs">${dataTable({
        caption: 'Infrastructure designs',
        empty: 'No designs yet. One is drafted when an architecture is accepted.',
        rows: designs,
        columns: [
          { key: 'id', label: 'Design', render: (d) => html`<a href="${d.href}"><span class="inf-mono">${d.id}</span> ${d.title}</a>` },
          { key: 'item', label: 'Built for', render: (d) => (d.itemId ? html`<span class="inf-mono">${d.itemId}</span>` : '—') },
          { key: 'version', label: 'Version', numeric: true, render: (d) => `v${d.version}` },
          { key: 'status', label: 'Status', render: (d) => statusPill({ text: d.statusText, tone: d.tone }) },
          { key: 'drafted', label: 'Drafted', render: (d) => d.draftedText || '—' },
        ],
      })}</section>`);
    return 0;
  });
}
