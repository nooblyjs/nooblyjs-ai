// An item's elicitation (NooblyJS Phase 18, root product.md §3.4): its stakeholders, its sessions (interviews, workshops,
// Teams meetings) with their notes, the candidate requirements Ada drafts from them (each quoting its source) to accept,
// merge or reject, the requirements with their sources and who accepted them, the NFR catalogue walk, and the questions
// and assumptions (an open one holds the spec approval). Data: GET /elicitation/:id. Writes: the routes in
// src/routes/elicitation.js.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, hrefFor } from '../lib.js';

const enc = encodeURIComponent;
const STATUS = { proposed: ['Proposed', 'warning'], accepted: ['Accepted', 'success'], merged: ['Merged', 'neutral'], rejected: ['Rejected', 'neutral'] };

function candidateRow(c, others, canDecide) {
  const [word, tone] = STATUS[c.status] ?? [c.status, 'neutral'];
  const decide = canDecide && c.status === 'proposed' ? html`<div class="actions">
      ${button({ label: 'Accept', small: true, attrs: { 'data-decide': 'accept', 'data-id': c.id } })}
      ${others.length ? html`<label>Merge into <select data-into="${c.id}">${others.map((o) => html`<option value="${o.id}">${o.id}</option>`)}</select></label>${button({ label: 'Merge', kind: 'secondary', small: true, attrs: { 'data-decide': 'merge', 'data-id': c.id } })}` : ''}
      <label>Reason <input data-reason="${c.id}" maxlength="500"></label>${button({ label: 'Reject', kind: 'secondary', small: true, attrs: { 'data-decide': 'reject', 'data-id': c.id } })}
    </div>` : '';
  return html`<li class="pf-stack"><p><strong>${c.id}</strong> ${c.text} ${statusPill({ text: word, tone })}${c.into ? html` <span class="muted">into ${c.into}</span>` : ''}${c.reason ? html` <span class="muted">: ${c.reason}</span>` : ''}</p>
    <ul>${c.quotes.map((q) => html`<li class="muted">“${q.quote}” (${q.session})</li>`)}</ul>${decide}</li>`;
}

export async function render(view, { params, ctx }) {
  let d = null;
  const message = () => view.querySelector('[data-message]');
  const id = params.id;

  async function draw() {
    try {
      d = await ctx.api.get(`elicitation/${enc(id)}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'this elicitation'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const canDraft = ctx.can('draft');
    const canDecide = ctx.can('accept-requirement');
    const proposed = d.candidates.filter((c) => c.status === 'proposed');
    view.innerHTML = String(html`${pageHead({ eyebrow: `Elicitation · ${id}`, title: d.title, lead: `${d.summary.text}. ${d.nfr.text}.`, actions: button({ label: 'Open the spec', kind: 'secondary', href: hrefFor(ctx, `/specs/${id}`) }) })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      <div class="pf-columns"><div class="pf-body pf-stack">
        ${card({ title: 'Candidate requirements', meta: `${proposed.length} to decide`, body: html`${d.candidates.length ? html`<ul class="pf-stack">${d.candidates.map((c) => candidateRow(c, proposed.filter((o) => o.id !== c.id), canDecide))}</ul>` : html`<p class="muted">None yet. Record a session, then ask Ada.</p>`}
          ${canDraft && d.sessions.length ? html`<div class="actions">${button({ label: 'Ask Ada for candidate requirements', attrs: { 'data-action': 'draft' } })}</div>` : ''}` })}
        ${card({ title: 'Requirements', meta: `${d.requirements.length}`, body: d.requirements.length ? html`<ul class="pf-stack">${d.requirements.map((r) => html`<li><strong>${r.id}</strong> ${r.text}${r.target ? ` · ${r.target}` : ''} <span class="muted">· accepted by ${r.acceptedBy?.name ?? r.acceptedBy?.id}</span>
            <ul>${r.quotes.map((q) => html`<li class="muted">“${q.quote}” (${q.session})</li>`)}${(r.criteria ?? []).map((ac) => html`<li>${ac.id}: ${ac.text}</li>`)}</ul></li>`)}</ul>` : html`<p class="muted">No requirement yet: nothing becomes one without a person's decision.</p>` })}
        ${card({ title: 'Sessions', meta: `${d.sessions.length}`, body: html`${d.sessions.map((s) => html`<details><summary><strong>${s.id}</strong> ${s.title} · ${s.kind}${s.source === 'teams' ? ' · from Teams' : ''}</summary><p class="pf-pre">${s.notes}</p></details>`)}
          ${canDraft ? html`<form class="pf-form" data-form="session"><label>Kind <select name="kind"><option>interview</option><option>workshop</option><option>meeting</option></select></label><label>Title <input name="title" maxlength="120"></label><label>Notes <textarea name="notes" rows="5" required maxlength="20000"></textarea></label><div class="actions">${button({ label: 'Record the session', type: 'submit', small: true })}</div></form>` : ''}` })}
        ${card({ title: 'Non-functional requirements', meta: d.nfr.text, body: html`${d.nfr.categories.map((c) => html`<section class="pf-stack"><h3 class="card__title card__title--small">${c.label} · ${c.status === 'not-walked' ? 'not walked yet' : c.status === 'not-applicable' ? `not applicable: ${c.reason}` : `${c.answers.length} answer${c.answers.length === 1 ? '' : 's'}`}</h3>
            ${c.prompt ? html`<p class="muted">${c.prompt}</p>` : ''}
            ${c.answers.length ? html`<ul>${c.answers.map((a) => html`<li>${a.text} · ${a.target} <span class="muted">(${a.requirement ?? a.candidate})</span></li>`)}</ul>` : ''}
            ${canDraft ? html`<form class="pf-form pf-form--inline" data-form="nfr" data-category="${c.key}"><label>Answer <input name="text" maxlength="600"></label><label>Target <input name="target" maxlength="200"></label><label>Or not applicable, because <input name="reason" maxlength="500"></label><div class="actions">${button({ label: 'Save', type: 'submit', small: true })}</div></form>` : ''}</section>`)}` })}
      </div><aside class="pf-rail pf-stack" aria-label="Who and what is open">
        ${card({ title: 'Stakeholders', body: html`${d.stakeholders.length ? html`<ul>${d.stakeholders.map((s) => html`<li>${s.name} · ${s.role}</li>`)}</ul>` : html`<p class="muted">None yet.</p>`}
          ${canDraft ? html`<form class="pf-form" data-form="stakeholder"><label>Name <input name="name" required maxlength="80"></label><label>Role <select name="role"><option>affected</option><option>decides</option><option>consulted</option></select></label><div class="actions">${button({ label: 'Add', type: 'submit', small: true })}</div></form>` : ''}` })}
        ${card({ title: 'Questions and assumptions', body: html`${d.questions.length ? html`<ul>${d.questions.map((q) => html`<li><strong>${q.id}</strong> ${q.text} · ${q.status === 'open' ? html`${statusPill({ text: 'Open', tone: 'warning' })}` : `answered: ${q.answer}`}
            ${canDraft && q.status === 'open' ? html`<form class="pf-form pf-form--inline" data-form="answer" data-id="${q.id}"><input name="answer" required maxlength="2000" aria-label="Answer ${q.id}">${button({ label: 'Answer', type: 'submit', small: true })}</form>` : ''}</li>`)}</ul>` : html`<p class="muted">None.</p>`}
          ${canDraft ? html`<form class="pf-form" data-form="question"><label>Question <input name="text" required maxlength="600"></label><label>Owner <input name="owner" maxlength="64"></label><label>Kind <select name="kind"><option>question</option><option>assumption</option></select></label><div class="actions">${button({ label: 'Add', type: 'submit', small: true })}</div></form>` : ''}` })}
      </aside></div>`);
  }

  async function act(fn, text) {
    try {
      await fn();
      await draw();
      say(message(), text, 'success');
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, 'error');
    }
  }

  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="draft"]')) return act(() => ctx.api.post(`elicitation/${enc(id)}/candidates/draft`, {}), 'Ada drafted candidate requirements from the notes.');
    const b = e.target.closest('[data-decide]');
    if (!b) return undefined;
    const cid = b.dataset.id;
    if (b.dataset.decide === 'accept') return act(() => ctx.api.post(`elicitation/${enc(id)}/candidates/${cid}/accept`, {}), `${cid} is a requirement now.`);
    if (b.dataset.decide === 'merge') return act(() => ctx.api.post(`elicitation/${enc(id)}/candidates/${cid}/merge`, { into: view.querySelector(`[data-into="${cid}"]`).value }), `${cid} was merged.`);
    return act(() => ctx.api.post(`elicitation/${enc(id)}/candidates/${cid}/reject`, { reason: view.querySelector(`[data-reason="${cid}"]`).value }), `${cid} was rejected.`);
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'session') act(() => ctx.api.post(`elicitation/${enc(id)}/sessions`, f), 'The session is recorded.');
    else if (form.dataset.form === 'stakeholder') act(() => ctx.api.post(`elicitation/${enc(id)}/stakeholders`, f), `${f.name} is a stakeholder.`);
    else if (form.dataset.form === 'question') act(() => ctx.api.post(`elicitation/${enc(id)}/questions`, f), 'The question is added.');
    else if (form.dataset.form === 'answer') act(() => ctx.api.put(`elicitation/${enc(id)}/questions/${form.dataset.id}`, f), 'Answered.');
    else if (form.dataset.form === 'nfr') {
      const body = f.reason?.trim() && !f.text?.trim() ? { notApplicable: true, reason: f.reason } : { answers: [{ text: f.text, target: f.target }] };
      act(() => ctx.api.put(`elicitation/${enc(id)}/nfr/${form.dataset.category}`, body), 'Saved.');
    }
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
