// SLOs: each item's quality attributes in production, with their error budgets (the monitoring adapter). A budget half
// burned, and one gone, alert whoever is on call in Teams; an alert can be raised as an incident. Data: GET /slos.
// Writes: POST /slos/:id/incident (draft), and with the mock monitor only POST /slos/:id/burn (draft).
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, button, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion } from '../lib.js';

const TONE = { ok: 'success', burning: 'warning', exhausted: 'danger' };

export async function render(view, { ctx }) {
  const redraw = await reloadable(view, ctx, async () => {
    let slos;
    try {
      ({ slos } = await ctx.api.get('slos'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the SLOs'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const mock = slos.some((s) => !s.monitor.real);
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Operations · Operate', title: 'SLOs', lead: 'What each item promised in Design, watched in production once its first release is there: each with an error budget over 30 days. Half a budget burned, and all of it, alert on call in Teams.' })}
      ${mock ? html`<p class="ops-mock">The mock monitor: budgets burn only when a person burns them here. Nothing is watched.</p>` : ''}
      ${messageRegion()}
      <section class="card" aria-label="SLOs">${dataTable({
        caption: 'SLOs', empty: 'No SLOs yet: an item gets them when its first release is in production.', rows: slos,
        columns: [
          { key: 'id', label: 'SLO', render: (s) => html`${s.id} · ${s.name}<span class="ops-sub">${s.itemId} · ${s.text}</span>` },
          { key: 'release', label: 'Since', render: (s) => s.release },
          { key: 'budget', label: 'Error budget', render: (s) => html`${statusPill({ text: s.statusText, tone: TONE[s.status] ?? 'neutral' })}<span class="ops-sub">${s.budgetText}</span>` },
          { key: 'alerts', label: 'Alerts', render: (s) => (s.alerts?.length ? s.alerts.map((a) => `${a.level}${a.teams ? ' (Teams)' : ''}`).join(', ') : 'None') },
          { key: 'act', label: '', render: (s) => (ctx.can('draft') ? html`${button({ label: 'Raise an incident', kind: 'secondary', small: true, attrs: { 'data-action': 'incident', 'data-id': s.id } })}${mock ? button({ label: 'Burn 15 min (mock)', kind: 'secondary', small: true, attrs: { 'data-action': 'burn', 'data-id': s.id } }) : ''}` : '') },
        ],
      })}</section>`);
    return 0;
  });
  view.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !['burn', 'incident'].includes(el.dataset.action)) return;
    try {
      const r = el.dataset.action === 'burn'
        ? await ctx.api.post(`slos/${encodeURIComponent(el.dataset.id)}/burn`, { minutes: 15 })
        : await ctx.api.post(`slos/${encodeURIComponent(el.dataset.id)}/incident`, { title: `${el.dataset.id} is burning its error budget` });
      await redraw();
      say(view, el.dataset.action === 'burn' ? r.budgetText : `${r.id} is declared.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
