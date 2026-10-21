// One finding: what was found and where, its owner and fix-by date, its fix (a Software Factory run) and the proof that
// closed it, the risk acceptance, and its history. Data: GET /findings/:id. Writes: POST /findings/:id/fix,
// POST /findings/:id/accept-risk (accept-risk; an Owner's for high and critical; people only), PUT /findings/:id/owner.
import { html } from '/ui/js/html.js';
import { pageHead, card, button } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion, severityPill, statePill, mockNote } from '../lib.js';

export async function render(view, { ctx, params }) {
  const id = encodeURIComponent(params.id);
  const redraw = await reloadable(view, ctx, async () => {
    let f;
    try {
      f = await ctx.api.get(`findings/${id}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the finding'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const live = f.state === 'open' || f.state === 'fixing';
    const where = [f.subject?.repo, f.subject?.file && `${f.subject.file}${f.subject.line ? `:${f.subject.line}` : ''}`, f.subject?.sha && `at ${f.subject.sha.slice(0, 7)}`].filter(Boolean).join(' · ');
    view.innerHTML = String(html`${pageHead({ eyebrow: `Security · ${f.kindLabel}${f.subject?.itemId ? ` · ${f.subject.itemId}` : ''}`, title: `${f.id} · ${f.title}`, lead: f.detail ?? '' })}
      <p class="sec-meta">${severityPill(f)} ${statePill(f)} <span class="${f.late ? 'sec-late' : ''}">${f.fixByText}</span> <span>Owner: ${f.ownerName ?? 'nobody yet'}</span></p>
      ${mockNote()}
      ${messageRegion()}
      <div class="sec-columns">
        ${card({ title: 'Where', body: html`<p>${where}</p>${f.source ? html`<p class="sec-muted">Found by the ${f.source.scanner} scanner (${f.source.scanId})</p>` : ''}` })}
        ${card({ title: 'The fix', body: html`${f.fix ? html`<p>${f.fix.title}: <a href="${f.fix.href}">Software Factory run ${f.fix.runId}</a>${f.fix.pr ? html` · <a href="${f.fix.pr}">its pull request</a>` : ''}</p>` : html`<p class="sec-muted">No fix asked for yet.</p>`}
          ${f.proof ? html`<p><strong>Closed:</strong> ${f.proof.text} (${f.proof.scanId}).</p>` : ''}
          ${live && !f.fix && ctx.can('draft') ? button({ label: 'Draft a fix as a PR', icon: 'spark', attrs: { 'data-action': 'fix' } }) : ''}` })}
        ${card({ title: 'Risk', body: html`${f.acceptance ? html`<p>${f.state === 'accepted' ? 'Accepted' : 'Was accepted'} by ${f.acceptance.byName} for ${f.acceptance.days} days: ${f.acceptance.reason}</p>` : html`<p class="sec-muted">The risk is not accepted.</p>`}
          ${live && ctx.can('accept-risk') ? html`<form class="sec-form" data-form="accept"><label>Reason <input name="reason" required maxlength="1000"></label><label>For how many days <input name="expiresInDays" type="number" min="1" max="90" value="30" required></label>${button({ label: 'Accept the risk', type: 'submit', kind: 'secondary' })}</form>` : ''}` })}
        ${card({ title: 'History', body: html`<ol class="sec-history">${(f.history ?? []).map((h) => html`<li><span class="sec-muted">${h.at.slice(0, 10)}</span> ${h.what}</li>`)}</ol>` })}
      </div>`);
    return 0;
  });

  view.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="fix"]')) return;
    try {
      const f = await ctx.api.post(`findings/${id}/fix`, {});
      await redraw();
      say(view, `The Software Factory is drafting the fix: run ${f.fix.runId}.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="accept"]');
    if (!form) return;
    e.preventDefault();
    const data = new FormData(form);
    try {
      const f = await ctx.api.post(`findings/${id}/accept-risk`, { reason: data.get('reason'), expiresInDays: Number(data.get('expiresInDays')) });
      await redraw();
      say(view, `The risk of ${f.id} is accepted until ${f.acceptance.expiresAt.slice(0, 10)}.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
