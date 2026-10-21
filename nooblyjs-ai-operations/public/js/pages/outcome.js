// One outcome review: each goal today (the monitoring adapter) against where it started and its target, what of the
// item is still under way, and the decision: the lifecycle's outcome-review approval (a Product lead, on Home ·
// Approvals), or an idea for a missed goal. Data: GET /outcome-reviews/:id. Write: POST /outcome-reviews/:id/idea.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill, dataTable } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion } from '../lib.js';

export async function render(view, { ctx, params }) {
  const id = encodeURIComponent(params.id);
  const redraw = await reloadable(view, ctx, async () => {
    let r;
    try {
      r = await ctx.api.get(`outcome-reviews/${id}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the outcome review'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({
      eyebrow: `Operations · ${r.itemId}`, title: `${r.itemId}'s outcome review`, lead: `${r.text}, ${r.days} days after ${r.release}.`,
      actions: html`${r.status === 'due' && r.approvalId ? button({ label: 'Decide it in Approvals', href: `/home/approvals?id=${r.approvalId}` }) : ''}${ctx.can('draft') && r.goals.some((g) => g.met === false) ? button({ label: 'Open an idea for a missed goal', kind: 'secondary', attrs: { 'data-action': 'idea' } }) : ''}`,
    })}
      <p class="ops-meta">${statusPill({ text: r.statusText, tone: r.status === 'due' ? 'warning' : r.status === 'closed' ? 'success' : 'neutral' })} <span>Due ${String(r.dueAt).slice(0, 10)}</span></p>
      ${r.monitor.real ? '' : html`<p class="ops-mock">Today's measures come from the mock monitor: sample values, not production's.</p>`}
      ${messageRegion()}
      <section class="card" aria-label="Goals">${dataTable({
        caption: 'Goals', empty: 'The spec has no goals.', rows: r.goals,
        columns: [
          { key: 'measure', label: 'Goal', render: (g) => g.measure },
          { key: 'before', label: 'Before', render: (g) => g.before },
          { key: 'now', label: 'Today', render: (g) => g.now ?? 'Not measured' },
          { key: 'target', label: 'Target', render: (g) => g.target },
          { key: 'met', label: 'Met', render: (g) => statusPill({ text: g.met === true ? 'Met' : g.met === false ? 'Not met' : 'Unknown', tone: g.met === true ? 'success' : g.met === false ? 'warning' : 'neutral' }) },
        ],
      })}</section>
      <div class="ops-columns">
        ${r.stillUnderWay.length ? card({ title: 'Still under way: closing the item withdraws them', body: html`<ul>${r.stillUnderWay.map((s) => html`<li>${s.id} · ${s.title} <span class="ops-sub">in ${s.stage}</span></li>`)}</ul>` }) : ''}
        ${(r.ideas ?? []).length ? card({ title: 'Ideas opened', body: html`<ul>${r.ideas.map((i) => html`<li>${i.id} · ${i.title}</li>`)}</ul>` }) : ''}
      </div>`);
    return 0;
  });
  view.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="idea"]')) return;
    try {
      const r = await ctx.api.post(`outcome-reviews/${id}/idea`, {});
      await redraw();
      say(view, `${r.ideas.at(-1).id} is open in the Product section.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
