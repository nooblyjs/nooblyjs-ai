// Cloud cost: this month against the budget, by kind and by environment. No mockup yet. Data: GET /cost.
import { html } from '/ui/js/html.js';
import { pageHead, card, dataTable, meter, statCard } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, kindPill } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let cost;
    try {
      cost = await ctx.api.get('cost');
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the cost'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const perDay = cost.byEnvironment.reduce((sum, e) => sum + e.costPerDay, 0);
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Infrastructure · Govern', title: 'Cost', lead: 'What the environments cost. This is cloud spend; what the agents cost is on their timesheets in Teammates.' })}
      <div class="grid">
        ${statCard({ label: `${cost.monthName} cloud spend`, value: `$${Math.round(cost.spentUsd).toLocaleString('en-US')}`, note: cost.budgetUsd ? `of a $${cost.budgetUsd.toLocaleString('en-US')} budget` : 'No budget is set' })}
        ${statCard({ label: 'Running now', value: `$${perDay.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, note: `per day across ${cost.byEnvironment.length} environment${cost.byEnvironment.length === 1 ? '' : 's'}` })}
      </div>
      <div class="inf-split">
        <div class="inf-split__main">
          <section class="card" aria-label="Cost by environment">
            <div class="card__head"><h2 class="card__title">By environment</h2></div>
            ${dataTable({
              caption: 'Cost per day by environment',
              empty: 'No environment has a cost yet.',
              rows: cost.byEnvironment,
              columns: [
                { key: 'name', label: 'Environment', render: (e) => html`<span class="inf-mono">${e.name}</span>` },
                { key: 'kind', label: 'Kind', render: (e) => kindPill(e) },
                { key: 'cost', label: 'Cost / day', numeric: true, render: (e) => html`<span class="inf-mono">${e.text}</span>` },
              ],
            })}
          </section>
        </div>
        <div class="inf-split__side">
          ${cost.budgetUsd ? card({ title: 'Budget', body: meter({ label: `${cost.monthName} cloud spend`, value: cost.text, ratio: cost.ratio, tone: cost.ratio >= 1 ? 'danger' : cost.ratio >= 0.8 ? 'warning' : undefined }) }) : ''}
          ${card({ title: `Cost by kind · ${cost.monthName}`, body: cost.byKind.length ? html`<div class="inf-stack">${cost.byKind.map((k) => meter({ label: k.label, value: k.text, ratio: k.ratio }))}</div>` : html`<p class="inf-muted">Nothing has been spent this month.</p>` })}
        </div>
      </div>`);
    return 0;
  });
}
