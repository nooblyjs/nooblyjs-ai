// Threat models: one per item, drafted by the security agent from the item's container view and accepted by an
// Architect. Data: GET /threat-models. Writes: POST /threat-models { itemId } (ask for one).
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, button } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion, threatModelPill, hrefFor } from '../lib.js';

export async function render(view, { ctx, query }) {
  const canDraft = ctx.can('draft');
  const redraw = await reloadable(view, ctx, async () => {
    let threatModels;
    try {
      ({ threatModels } = await ctx.api.get('threat-models'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the threat models'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Security', title: 'Threat models', lead: 'STRIDE per trust boundary, drawn from each item\'s container view. Each threat has a mitigation that is a requirement or a quality attribute; an Architect accepts the model.' })}
      ${messageRegion()}
      ${canDraft ? html`<form class="card sec-form" data-form="draft"><label>Item <input name="itemId" required maxlength="20" placeholder="PRD-031" value="${query?.itemId ?? ''}"></label>${button({ label: 'Ask for a threat model', type: 'submit', icon: 'spark' })}</form>` : ''}
      <section class="card" aria-label="Threat models">${dataTable({
        caption: 'Threat models',
        empty: 'No threat model yet. Ask for one for an item that has a container view.',
        rows: threatModels,
        columns: [
          { key: 'id', label: 'Threat model', render: (tm) => html`<a href="${hrefFor(ctx, `/threat-models/${tm.id}`)}">${tm.id} v${tm.version}</a><span class="sec-sub">${tm.title}</span>` },
          { key: 'itemId', label: 'Item' },
          { key: 'threats', label: 'Threats', render: (tm) => `${tm.threats.length} · ${tm.mitigations.requirements} as requirements, ${tm.mitigations.qualityAttributes} as quality attributes` },
          { key: 'draftedBy', label: 'Drafted by', render: (tm) => tm.draftedBy?.name ?? '' },
          { key: 'status', label: 'State', render: (tm) => threatModelPill(tm) },
        ],
      })}</section>`);
    return 0;
  });

  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="draft"]');
    if (!form) return;
    e.preventDefault();
    const itemId = new FormData(form).get('itemId');
    try {
      const tm = await ctx.api.post('threat-models', { itemId });
      await redraw();
      say(view, `${tm.draftedBy.name} drafted ${tm.id} v${tm.version}: ${tm.threats.length} threats. It waits for an Architect.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
