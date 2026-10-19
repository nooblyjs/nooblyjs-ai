// Blueprints: the building blocks infrastructure code may use. No mockup yet. Data: GET /blueprints.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let blueprints;
    try {
      ({ blueprints } = await ctx.api.get('blueprints'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the blueprints'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Infrastructure · Govern', title: 'Blueprints', lead: 'Infrastructure code is composed only from approved blueprints. A design that uses anything else fails a policy check.' })}
      <section class="card" aria-label="Blueprints">${dataTable({
        caption: 'Blueprints',
        empty: 'No blueprints yet.',
        rows: blueprints,
        columns: [
          { key: 'name', label: 'Blueprint', render: (b) => html`<span class="inf-mono">${b.name} v${b.version}</span><span class="inf-sub">${b.summary}</span>` },
          { key: 'state', label: 'State', render: (b) => statusPill({ text: b.stateText, tone: b.approved ? 'success' : 'warning' }) },
          { key: 'usedBy', label: 'Used by', render: (b) => (b.usedBy.length ? b.usedBy.map((id, i) => html`${i ? ', ' : ''}<a class="inf-mono" href="${hrefFor(ctx, `/designs/${id}`)}">${id}</a>`) : 'No design') },
        ],
      })}</section>`);
    return 0;
  });
}
