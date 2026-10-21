// Incidents: open ones first, each linked to its release and item. A person declares one here (or raises one from an
// SLO). Data: GET /incidents. Write: POST /incidents (draft, people only).
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, button, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, hrefFor, say, messageRegion } from '../lib.js';

const TONE = { open: 'danger', resolved: 'warning', reviewed: 'success' };

export async function render(view, { ctx }) {
  const redraw = await reloadable(view, ctx, async () => {
    let incidents;
    try {
      ({ incidents } = await ctx.api.get('incidents'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the incidents'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Operations · Operate', title: 'Incidents', lead: 'Each linked to the release and item it is about. Resolving one asks the SRE agent for the post-incident review; a person accepts it, and it is written to Knowledge.' })}
      ${messageRegion()}
      ${ctx.can('draft') ? html`<form class="ops-form" data-form="declare" aria-label="Declare an incident"><label>What is wrong <input name="title" required maxlength="160"></label><label>Item <input name="itemId" placeholder="PRD-031" maxlength="40"></label><label>Severity <select name="severity"><option value="SEV1">SEV1</option><option value="SEV2" selected>SEV2</option><option value="SEV3">SEV3</option></select></label>${button({ label: 'Declare', type: 'submit', kind: 'danger' })}</form>` : ''}
      <section class="card" aria-label="Incidents">${dataTable({
        caption: 'Incidents', empty: 'No incidents.', rows: incidents,
        columns: [
          { key: 'id', label: 'Incident', render: (i) => html`<a href="${hrefFor(ctx, `/incidents/${i.id}`)}">${i.id} · ${i.title}</a><span class="ops-sub">${i.severityText}</span>` },
          { key: 'release', label: 'Release', render: (i) => i.release ?? 'None linked' },
          { key: 'status', label: 'Where it is', render: (i) => html`${statusPill({ text: i.statusText, tone: TONE[i.status] ?? 'neutral' })}${i.minutesOpen != null ? html`<span class="ops-sub">Restored in ${i.minutesOpen} minutes</span>` : ''}` },
        ],
      })}</section>`);
    return 0;
  });
  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="declare"]');
    if (!form) return;
    e.preventDefault();
    try {
      const i = await ctx.api.post('incidents', Object.fromEntries(new FormData(form)));
      await redraw();
      say(view, `${i.id} is declared${i.release ? ` on ${i.release}` : ''}.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
