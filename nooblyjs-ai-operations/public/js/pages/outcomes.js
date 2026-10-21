// Outcome reviews: one per item, due a number of days after its first release is in production. Data: GET
// /outcome-reviews.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, hrefFor } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let outcomeReviews;
    try {
      ({ outcomeReviews } = await ctx.api.get('outcome-reviews'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the outcome reviews'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Operations · Learn', title: 'Outcome reviews', lead: 'Every item ends with one: its goals today against their targets. A Product lead closes the item, or a missed goal opens an idea for Discover.' })}
      <section class="card" aria-label="Outcome reviews">${dataTable({
        caption: 'Outcome reviews', empty: 'None yet: an item gets one when its first release is in production.', rows: outcomeReviews,
        columns: [
          { key: 'id', label: 'Review', render: (r) => html`<a href="${hrefFor(ctx, `/outcome-reviews/${r.id}`)}">${r.id} · ${r.itemId}</a><span class="ops-sub">After ${r.release}</span>` },
          { key: 'due', label: 'Due', render: (r) => String(r.dueAt).slice(0, 10) },
          { key: 'goals', label: 'Goals', render: (r) => r.text },
          { key: 'status', label: 'Where it is', render: (r) => statusPill({ text: r.statusText, tone: r.status === 'due' ? 'warning' : r.status === 'closed' ? 'success' : 'neutral' }) },
        ],
      })}</section>`);
    return 0;
  });
}
