// The business case of an idea or an epic (NooblyJS Phase 17, root product.md §3.3): the value hypothesis, who benefits,
// the measure (what, today, target), the cost estimate (agent spend, cloud a month, people's days, each with where it
// came from) and the horizon; what is missing, in words. An agent drafts it (Ask Ada to draft); a person edits it; an
// idea is accepted (the Discover exit) once it is complete, or with an override reason.
// Data: GET /business-cases/:id. Writes: PUT /business-cases/:id, POST /business-cases/:id/draft (draft),
// POST /ideas/:id/accept.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, ago, hrefFor } from '../lib.js';

const enc = encodeURIComponent;
const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const PARTS = { agentUsd: 'Agent spend', cloudUsdMonth: 'Cloud, a month in production', peopleDays: 'People\'s working days' };

function estimateView(e) {
  if (!e) return html`<p class="muted">No estimate yet. Ask Ada to draft the business case: she draws it from the factory's history of similar items.</p>`;
  const value = (k) => (k === 'peopleDays' ? `${e[k]} days` : money(e[k]));
  return html`<dl class="pf-facts">${Object.entries(PARTS).map(([k, label]) => html`<dt>${label}</dt><dd><strong>${value(k)}</strong><br><span class="muted">${e.basis?.find((b) => b.part === k)?.text ?? ''}</span></dd>`)}</dl>
    <p class="muted">Similar items: ${e.similar?.length ? e.similar.join(', ') : 'none'} (${e.like}).</p>`;
}

function formView(c) {
  return html`<form class="card pf-form" data-form="case" aria-label="Edit the business case">
    <h2 class="card__title">Edit</h2>
    <label>Value hypothesis <textarea name="valueHypothesis" rows="3" maxlength="2000">${c.valueHypothesis}</textarea></label>
    <label>Who benefits <textarea name="beneficiaries" rows="2" maxlength="2000">${c.beneficiaries}</textarea></label>
    <fieldset><legend>The measure</legend>
      <label>What <input name="what" maxlength="200" value="${c.measure.what ?? ''}"></label>
      <label>Today <input name="today" maxlength="200" value="${c.measure.today ?? ''}"></label>
      <label>Target <input name="target" maxlength="200" value="${c.measure.target ?? ''}"></label></fieldset>
    <fieldset><legend>The cost estimate <span class="pf-hint">a number you set replaces the history's, and says so</span></legend>
      <label>Agent spend ($) <input name="agentUsd" inputmode="decimal" value="${c.estimate?.agentUsd ?? ''}"></label>
      <label>Cloud a month ($) <input name="cloudUsdMonth" inputmode="decimal" value="${c.estimate?.cloudUsdMonth ?? ''}"></label>
      <label>People's days <input name="peopleDays" inputmode="decimal" value="${c.estimate?.peopleDays ?? ''}"></label></fieldset>
    <label>Horizon (months) <input name="horizonMonths" inputmode="numeric" value="${c.horizonMonths ?? ''}"></label>
    <label>Risks and assumptions <span class="pf-hint">optional</span><textarea name="risks" rows="2" maxlength="2000">${c.risks}</textarea></label>
    <div class="actions">${button({ label: 'Save', type: 'submit' })}</div>
  </form>`;
}

export async function render(view, { params, ctx }) {
  let c = null;
  const message = () => view.querySelector('[data-message]');

  async function draw() {
    try {
      c = await ctx.api.get(`business-cases/${enc(params.id)}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'this business case'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const idea = c.ownerKind === 'idea';
    view.innerHTML = String(html`${pageHead({
      eyebrow: `Business case · ${idea ? 'Idea' : 'Epic'} ${c.ownerId}`,
      title: c.title,
      lead: `${c.text}.${c.updatedAt ? ` Version ${c.version}, ${ago(c.updatedAt)}${c.draftedBy ? ` · drafted by ${c.draftedBy.name}` : ''}.` : ''}`,
      actions: html`${statusPill({ text: c.complete ? 'Complete' : 'Not complete', tone: c.complete ? 'success' : 'warning' })}${ctx.can('draft') ? button({ label: 'Ask Ada to draft it', kind: 'secondary', attrs: { 'data-action': 'draft' } }) : ''}`,
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      <div class="pf-columns">
        <div class="pf-body pf-stack">
          ${card({ title: 'The case', body: html`<dl class="pf-facts">
            <dt>Value hypothesis</dt><dd>${c.valueHypothesis || html`<span class="muted">Not written yet</span>`}</dd>
            <dt>Who benefits</dt><dd>${c.beneficiaries || html`<span class="muted">Not written yet</span>`}</dd>
            <dt>The measure</dt><dd>${c.measure.what ? `${c.measure.what}: ${c.measure.today || '?'} → ${c.measure.target || '?'}` : html`<span class="muted">Not set yet</span>`}</dd>
            <dt>Horizon</dt><dd>${c.horizonMonths ? `${c.horizonMonths} months` : html`<span class="muted">Not set yet</span>`}</dd>
            ${c.risks ? html`<dt>Risks and assumptions</dt><dd>${c.risks}</dd>` : ''}</dl>
            ${c.missing.length ? html`<p class="pf-hint">It needs ${c.missing.join(', ')}.</p>` : ''}` })}
          ${card({ title: 'The cost estimate', body: estimateView(c.estimate) })}
          ${ctx.can('draft') ? formView(c) : ''}
        </div>
        <aside class="pf-rail pf-stack" aria-label="Deciding">
          ${idea ? card({ title: 'Accept the idea', body: html`<p class="muted">The Discover exit: a person accepts it once its business case is complete${c.complete ? '' : ', or overrides with a reason'}.</p>
            <form class="pf-form" data-form="accept">${c.complete ? '' : html`<label>Override: why it can go on anyway <input name="reason" maxlength="500"></label>`}
            <div class="actions">${button({ label: 'Accept the idea', type: 'submit' })}</div></form>` }) : card({ title: 'The epic', body: html`<p><a href="${hrefFor(ctx, `/epics/${c.ownerId}`)}">Its document</a></p>` })}
        </aside>
      </div>`);
  }

  view.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="draft"]')) return;
    try {
      say(message(), 'Ada is drafting it from the factory\'s history…', 'info');
      await ctx.api.post(`business-cases/${enc(params.id)}/draft`, {});
      await draw();
      say(message(), `Drafted. ${c.text}.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, 'error');
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    try {
      if (form.dataset.form === 'case') {
        // Only the estimate's numbers a person changed are sent: an unchanged one keeps where it came from.
        const estimate = Object.fromEntries(Object.keys(PARTS).filter((k) => String(d[k] ?? '') !== String(c.estimate?.[k] ?? '')).map((k) => [k, d[k]]));
        await ctx.api.put(`business-cases/${enc(params.id)}`, {
          valueHypothesis: d.valueHypothesis, beneficiaries: d.beneficiaries, risks: d.risks,
          measure: { what: d.what, today: d.today, target: d.target },
          ...(Object.keys(estimate).length ? { estimate } : {}),
          ...(d.horizonMonths ? { horizonMonths: Number(d.horizonMonths) } : {}),
        });
        await draw();
        say(message(), `Saved. ${c.text}.`, 'success');
      } else if (form.dataset.form === 'accept') {
        const r = await ctx.api.post(`ideas/${enc(params.id)}/accept`, d.reason?.trim() ? { override: { reason: d.reason.trim() } } : {});
        await draw();
        say(message(), r.text, 'success');
      }
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, 'error');
    }
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
