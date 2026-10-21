// The Product Factory overview (product.md §5.6): the four stages with what is in each, and agent spend.
// Data: GET /board and GET /summary.
import { html } from '/ui/js/html.js';
import { pageHead, statCard, card, meter } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable } from '../lib.js';

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let board;
    let summary;
    let arch;
    let uxItems;
    let uiItems;
    try {
      [board, summary, { items: arch }, { items: uxItems }, { items: uiItems }] = await Promise.all([ctx.api.get('board'), ctx.api.get('summary'), ctx.api.get('architecture'), ctx.api.get('ux'), ctx.api.get('ui')]);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the overview'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const count = (key) => board.columns.find((c) => c.key === key)?.count ?? 0;
    const inProduct = count('signals') + count('ideas') + count('spec-drafting') + count('in-review');
    const { spend, agentsOnDuty } = summary;
    const stages = [
      { title: '1 · Product', value: inProduct, note: `${count('in-review')} in review · ${count('spec-drafting')} drafting`, href: '/board' },
      { title: '2 · Architecture', value: arch.length, note: `${arch.reduce((n, i) => n + i.proposedAdrs, 0)} decisions to sign off`, href: '/architecture' },
      { title: '3 · UX design', value: uxItems.length, note: 'items with journeys, flows or research', href: '/ux' },
      { title: '4 · UI design', value: uiItems.length, note: `${uiItems.filter((i) => i.handoff === 'draft').length} ready to hand off`, href: '/ui' },
    ];
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Overview', title: 'Product Factory', lead: 'From customer signal to Software Factory handoff: agents draft, people decide.' })}
      <div class="grid">${stages.map((s) => statCard({ label: s.title, value: s.value, note: s.note, href: hrefFor(ctx, s.href) }))}</div>
      <div class="grid pf-panels">
        ${card({ title: 'Agents', meta: agentsOnDuty.text, body: html`<p class="muted">${agentsOnDuty.names.length ? `Working now: ${agentsOnDuty.names.join(', ')}.` : 'No agent is drafting right now.'}</p>` })}
        ${card({ title: 'Agent spend', meta: spend.month, body: meter({ label: 'This month', value: spend.budgetUsd ? `${money(spend.usedUsd)} of ${money(spend.budgetUsd)}` : money(spend.usedUsd), ratio: spend.budgetUsd ? spend.usedUsd / spend.budgetUsd : 0 }) })}
      </div>`);
  });
}
