// What is waiting for a reviewer (product.md §5.6; the sidebar badge counts these): specs in review, the ones
// waiting on you first. Data: GET /specs?status=in-review.
import { html } from '/ui/js/html.js';
import { pageHead, listRow, card } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let specs;
    try {
      ({ specs } = await ctx.api.get('specs', { query: { status: 'in-review' } }));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the reviews'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const yours = (s) => (s.statusText === 'Needs your approval' ? 0 : 1);
    const rows = [...specs].sort((a, b) => yours(a) - yours(b));
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Product Factory · Flow', title: 'Reviews', lead: 'Specs waiting for a reviewer. Yours come first.' })}
      ${card({
        title: `${rows.length} in review`,
        body: rows.length
          ? html`<div class="rows">${rows.map((s) => listRow({ title: `${s.id} ${s.title}`, meta: [s.product, s.version ? `v${s.version}` : null].filter(Boolean).join(' · '), pill: { text: s.statusText, tone: yours(s) ? 'neutral' : 'info' }, href: hrefFor(ctx, `/specs/${s.id}`) }))}</div>`
          : html`<p class="muted">Nothing is waiting for review.</p>`,
      })}`);
  });
}

