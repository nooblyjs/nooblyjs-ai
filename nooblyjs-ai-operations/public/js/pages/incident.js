// One incident: its timeline, its release and item, the signal it raised, the SRE agent's post-incident review (a
// person accepts it; it is written to Knowledge) and its follow-ups. Data: GET /incidents/:id. Writes: /notes,
// /resolve, /review, /follow-ups (draft, people only for resolve and review).
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion } from '../lib.js';

export async function render(view, { ctx, params }) {
  const id = encodeURIComponent(params.id);
  const redraw = await reloadable(view, ctx, async () => {
    let i;
    try {
      i = await ctx.api.get(`incidents/${id}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the incident'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const can = ctx.can('draft');
    view.innerHTML = String(html`${pageHead({ eyebrow: `Operations · ${i.itemId ?? 'Incident'}`, title: `${i.id} · ${i.title}`, lead: `${i.severityText}${i.release ? `. Release: ${i.release}` : ''}.` })}
      <p class="ops-meta">${statusPill({ text: i.statusText, tone: i.status === 'open' ? 'danger' : i.status === 'resolved' ? 'warning' : 'success' })}${i.signalId ? html` <span>Signal on the Product board: ${i.signalId}</span>` : ''}</p>
      ${messageRegion()}
      <div class="ops-columns">
        ${card({ title: 'Timeline', body: html`<ol class="ops-history">${i.timeline.map((t) => html`<li><span class="ops-muted">${String(t.at).slice(0, 16).replace('T', ' ')}</span> ${t.what}</li>`)}</ol>
          ${can && i.status === 'open' ? html`<form class="ops-form" data-form="note"><label>What happened <input name="text" required maxlength="1000"></label>${button({ label: 'Add', type: 'submit', kind: 'secondary', small: true })}</form>
          <form class="ops-form" data-form="resolve"><label>How it was resolved <input name="resolution" maxlength="1000"></label>${button({ label: 'Resolve', type: 'submit' })}</form>` : ''}` })}
        ${card({ title: 'Post-incident review', meta: i.review ? `Drafted by ${i.review.draftedBy?.name ?? 'the SRE agent'}${i.review.acceptedBy ? ` · accepted by ${i.review.acceptedBy.name}` : ''}` : '', body: i.review ? html`<pre class="ops-notes">${i.review.text}</pre>
          ${i.review.page ? html`<p><a href="${i.review.page.href}">In Knowledge: ${i.review.page.spaceName} · ${i.review.page.path}</a></p>` : ''}
          ${can && i.review.status === 'draft' ? button({ label: 'Accept the review', attrs: { 'data-action': 'accept' } }) : ''}` : html`<p class="ops-muted">Drafted by the SRE agent when the incident is resolved.</p>` })}
        ${card({ title: 'Follow-ups', body: html`<ul>${(i.followUps ?? []).map((f) => html`<li>${f.title} <span class="ops-sub">${f.kind}: ${f.ref}</span></li>`)}</ul>
          ${can ? html`<form class="ops-form" data-form="follow-up"><label>Follow-up <input name="title" required maxlength="200"></label><label>As <select name="kind"><option value="idea">An idea</option><option value="defect">A defect</option></select></label><label>Story (a defect's) <input name="storyId" maxlength="40"></label>${button({ label: 'Add', type: 'submit', kind: 'secondary', small: true })}</form>` : ''}` })}
      </div>`);
    return 0;
  });
  const act = async (fn, done) => {
    try {
      const r = await fn();
      await redraw();
      say(view, done(r), 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  };
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="accept"]')) act(() => ctx.api.post(`incidents/${id}/review`, {}), (r) => `The review is accepted${r.review.page ? ' and in Knowledge' : ''}.`);
  }, { signal: ctx.signal });
  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const path = { note: 'notes', resolve: 'resolve', 'follow-up': 'follow-ups' }[form.dataset.form];
    if (path) act(() => ctx.api.post(`incidents/${id}/${path}`, data), () => 'Done.');
  }, { signal: ctx.signal });
}
