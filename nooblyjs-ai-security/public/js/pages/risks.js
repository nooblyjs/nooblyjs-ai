// The risk register: every risk acceptance, current and ended, with who accepted it, why and until when. Data: GET /risks.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, hrefFor } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let risks;
    try {
      ({ risks } = await ctx.api.get('risks'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the risk register'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Security', title: 'Risk register', lead: 'Accepting a risk is a person\'s decision, with a reason and an end date. When it ends, the finding is open again.' })}
      <section class="card" aria-label="Risk acceptances">${dataTable({
        caption: 'Risk acceptances',
        empty: 'No risk has been accepted.',
        rows: risks,
        columns: [
          { key: 'findingId', label: 'Finding', render: (r) => html`<a href="${hrefFor(ctx, `/findings/${r.findingId}`)}">${r.findingId}</a><span class="sec-sub">${r.title}</span>` },
          { key: 'severity', label: 'Severity', render: (r) => r.severityLabel },
          { key: 'by', label: 'Accepted by', render: (r) => r.byName },
          { key: 'reason', label: 'Why' },
          { key: 'state', label: 'Until', render: (r) => r.stateText },
        ],
      })}</section>`);
    return 0;
  });
}
