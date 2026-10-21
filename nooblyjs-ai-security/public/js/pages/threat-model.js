// One threat model: its trust boundaries, its threats (each with its flow and mitigation), and the decision. Data: GET
// /threat-models/:id. Writes: POST /threat-models/:id/decision (accept-threat-model; people only).
import { html } from '/ui/js/html.js';
import { pageHead, card, dataTable, button } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion, threatModelPill } from '../lib.js';

export async function render(view, { ctx, params }) {
  const canDecide = ctx.can('accept-threat-model');
  let tm = null;
  const redraw = await reloadable(view, ctx, async () => {
    try {
      tm = await ctx.api.get(`threat-models/${encodeURIComponent(params.id)}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the threat model'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const waiting = tm.status === 'waiting';
    view.innerHTML = String(html`${pageHead({ eyebrow: `Security · ${tm.itemId}`, title: `${tm.id} v${tm.version}`, lead: tm.source?.text ?? '' })}
      <p class="sec-meta">${threatModelPill(tm)} <span>Drafted by ${tm.draftedBy?.name} for ${tm.askedBy?.name}</span>${tm.why ? html` <span class="sec-muted">(${tm.why})</span>` : ''}${tm.decision ? html` <span>· ${tm.status === 'accepted' ? 'Accepted' : 'Changes asked'} by ${tm.decision.byName}${tm.decision.comment ? `: ${tm.decision.comment}` : ''}</span>` : ''}</p>
      ${messageRegion()}
      ${waiting && canDecide ? html`<form class="card sec-form" data-form="decide"><label>Comment (needed to ask for changes) <input name="comment" maxlength="2000"></label>
        ${button({ label: 'Accept the threat model', attrs: { 'data-decision': 'approve' } })} ${button({ label: 'Ask for changes', kind: 'secondary', attrs: { 'data-decision': 'request-changes' } })}</form>`
        : waiting ? html`<p class="sec-muted">An Architect or an Owner accepts it (accept-threat-model). You can read it.</p>` : ''}
      ${card({ title: 'Threats', meta: `${tm.threats.length} across ${tm.boundaries.length} trust boundaries`, body: dataTable({
        caption: 'Threats and their mitigations',
        rows: tm.threats,
        columns: [
          { key: 'id', label: 'Threat', render: (t) => html`<strong>${t.id}</strong> ${t.stride}<span class="sec-sub">${t.title}</span>` },
          { key: 'flow', label: 'Flow', render: (t) => html`${t.flow}${t.holdFlow ? html`<span class="sec-sub">Slot hold flow</span>` : ''}` },
          { key: 'mitigation', label: 'Mitigation', render: (t) => html`<strong>${t.mitigation.id}</strong> ${t.mitigation.text}${t.mitigation.target ? ` · ${t.mitigation.target}` : ''}<span class="sec-sub">${t.mitigation.becomes === 'requirement' ? 'A requirement' : 'A quality attribute'}</span>` },
        ],
      }) })}
      ${card({ title: 'Trust boundaries', body: html`<ul>${tm.boundaries.map((b) => html`<li><strong>${b.id}</strong> ${b.from} → ${b.to} <span class="sec-muted">(${b.crossing})</span></li>`)}</ul>` })}`);
    return 0;
  });

  view.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-decision]');
    if (!el) return;
    e.preventDefault();
    const comment = view.querySelector('[data-form="decide"] [name="comment"]')?.value ?? '';
    try {
      const done = await ctx.api.post(`threat-models/${encodeURIComponent(params.id)}/decision`, { decision: el.dataset.decision, comment, version: tm?.version });
      await redraw();
      say(view, done.status === 'accepted' ? `${done.id} v${done.version} is accepted.` : `Changes asked on ${done.id}.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
