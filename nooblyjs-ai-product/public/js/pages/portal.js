// Product · Ideas portal (NooblyJS Phase 25a): for everyone signed in to NooblyJS. Put an idea forward for a product,
// see the others with their status in words, vote (10 open votes each), vote on behalf of a colleague who asked you,
// comment and follow. A person with `draft` merges a suggested idea into another, or puts it on the board.
// Data: GET /portal/ideas, /catalogue. Writes: POST /portal/ideas, …/:id/votes, DELETE …/votes/:vote,
// POST …/:id/comments, PUT|DELETE …/:id/follow, POST …/:id/merge, …/:id/promote.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say } from '../lib.js';

const TONE = { Suggested: 'info', 'On the board': 'neutral', Accepted: 'success', 'Being specced': 'info', 'In progress': 'info', Shipped: 'success' };

function submitForm(products) {
  return html`<form class="card pf-form" data-form="submit" hidden aria-label="Put an idea forward">
    <h2 class="card__title">Put an idea forward</h2>
    <label>Your idea <input name="title" required maxlength="120" autocomplete="off" placeholder="Let me add to my order after paying"></label>
    <label>Product <select name="product" required><option value="">Choose a product</option>${products.map((p) => html`<option value="${p.name}">${p.name}${p.portfolio ? ` · ${p.portfolio}` : ''}</option>`)}</select></label>
    <label>What's the problem? <textarea name="problem" rows="3" maxlength="4000"></textarea></label>
    <div class="actions">${button({ label: 'Put it forward', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-submit' } })}</div>
  </form>`;
}

function ideaCard(i, { ctx, others }) {
  const canSuggest = ctx.can('suggest');
  const canDraft = ctx.can('draft');
  const own = i.yourVotes.find((v) => !v.onBehalfOf);
  const behalf = i.yourVotes.filter((v) => v.onBehalfOf);
  const voting = canSuggest && i.votable ? html`<span class="actions">
      ${own ? button({ label: 'Take my vote back', kind: 'secondary', small: true, attrs: { 'data-action': 'unvote', 'data-id': i.id, 'data-vote': own.id } }) : button({ label: 'Vote', small: true, attrs: { 'data-action': 'vote', 'data-id': i.id, 'aria-label': `Vote for ${i.title}` } })}
      ${button({ label: i.following ? 'Unfollow' : 'Follow', kind: 'secondary', small: true, attrs: { 'data-action': i.following ? 'unfollow' : 'follow', 'data-id': i.id } })}
    </span>
    <details class="pf-details"><summary>Vote on behalf of a colleague who asked you</summary>
      <form class="pf-inline pf-inline--wide" data-form="behalf" data-id="${i.id}"><label>Their name <input name="name" maxlength="80" autocomplete="off" placeholder="Store manager, Sandton" required></label>${button({ label: 'Vote for them', kind: 'secondary', small: true, type: 'submit' })}</form>
    </details>
    ${behalf.length ? html`<p class="muted">Your votes for others: ${behalf.map((v) => html`${v.onBehalfOf} ${button({ label: 'Take back', kind: 'secondary', small: true, attrs: { 'data-action': 'unvote', 'data-id': i.id, 'data-vote': v.id, 'aria-label': `Take back your vote for ${v.onBehalfOf}` } })} `)}</p>` : ''}` : '';
  const deciding = canDraft && i.status === 'suggested' ? html`<form class="pf-inline" data-form="merge" data-id="${i.id}">
      ${button({ label: 'Put it on the board', small: true, attrs: { 'data-action': 'promote', 'data-id': i.id } })}
      <label>Or merge it into <select name="into" required><option value="">Choose an idea</option>${others.filter((o) => o.id !== i.id).map((o) => html`<option value="${o.id}">${o.id} · ${o.title}</option>`)}</select></label>${button({ label: 'Merge', kind: 'secondary', small: true, type: 'submit' })}
    </form>` : '';
  const comments = html`<ul class="pf-comments" aria-label="Comments">${i.comments.map((c) => html`<li><strong>${c.byName}</strong> ${c.text}${c.from ? html` <span class="muted">(on ${c.from})</span>` : ''}</li>`)}</ul>
    ${canSuggest && i.status !== 'merged' ? html`<form class="pf-inline pf-inline--wide" data-form="comment" data-id="${i.id}"><label>Comment <input name="text" maxlength="2000" autocomplete="off" placeholder="Add to the idea" required></label>${button({ label: 'Add', kind: 'secondary', small: true, type: 'submit' })}</form>` : ''}`;
  return html`<li class="card pf-portal__idea" id="${i.id}">
    <div class="pf-portal__votes" aria-label="${i.votes} vote${i.votes === 1 ? '' : 's'}"><strong>${i.votes}</strong>vote${i.votes === 1 ? '' : 's'}</div>
    <div class="pf-portal__body">
      <div class="pf-note__head"><strong>${i.id} ${i.title}</strong>${statusPill({ text: i.statusText, tone: TONE[i.statusText] ?? 'neutral' })}</div>
      ${i.problem ? html`<p class="pf-note__text">${i.problem}</p>` : ''}
      <p class="muted">${[i.product, i.portfolio, i.submittedBy ? `Put forward by ${i.submittedBy.name}` : null, `${i.followers} following`, i.onBehalfOf.length ? `asked for by ${i.onBehalfOf.join(', ')}` : null].filter(Boolean).join(' · ')}</p>
      ${i.evidence ? html`<p class="pf-evidence">${i.evidence.text}</p>` : ''}
      ${voting}${deciding}${comments}
    </div>
  </li>`;
}

export async function render(view, { ctx }) {
  const message = () => view.querySelector('[data-message]');

  async function draw(flash = null) {
    let data; let catalogue;
    try {
      [data, catalogue] = await Promise.all([ctx.api.get('portal/ideas'), ctx.api.get('catalogue')]);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the ideas portal'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const products = [...catalogue.portfolios.flatMap((p) => p.products), ...(catalogue.unfiled ?? [])];
    const others = data.ideas.filter((i) => i.votable && i.status !== 'merged');
    view.innerHTML = String(html`${pageHead({
      eyebrow: 'Product · Customers',
      title: 'Ideas portal',
      lead: `Put ideas forward for the products, and vote for the ones you want. ${data.you.text}; a vote comes back when its idea ships or closes.`,
      actions: ctx.can('suggest') ? button({ label: 'Put an idea forward', icon: 'plus', attrs: { 'data-action': 'new-idea' } }) : '',
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      ${ctx.can('suggest') ? submitForm(products) : ''}
      ${data.ideas.length ? html`<ul class="pf-stack" role="list">${data.ideas.map((i) => ideaCard(i, { ctx, others }))}</ul>` : card({ title: 'No ideas yet', body: html`<p class="muted">Be the first to put one forward.</p>` })}`);
    if (flash) say(message(), flash.text, flash.tone);
  }

  const run = async (fn, text) => {
    try {
      const out = await fn();
      await draw({ text: typeof text === 'function' ? text(out) : text, tone: 'success' });
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, 'error');
    }
  };

  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id, vote } = el.dataset;
    if (action === 'new-idea') { const f = view.querySelector('[data-form="submit"]'); f.hidden = false; f.elements.title.focus(); }
    else if (action === 'cancel-submit') { e.preventDefault(); view.querySelector('[data-form="submit"]').hidden = true; }
    else if (action === 'vote') run(() => ctx.api.post(`portal/ideas/${id}/votes`, {}), (r) => `Voted for ${id}. You have ${r.left} vote${r.left === 1 ? '' : 's'} left.`);
    else if (action === 'unvote') run(() => ctx.api.del(`portal/ideas/${id}/votes/${vote}`), 'Your vote is back.');
    else if (action === 'follow') run(() => ctx.api.put(`portal/ideas/${id}/follow`, {}), `You follow ${id}: you'll hear when it ships.`);
    else if (action === 'unfollow') run(() => ctx.api.del(`portal/ideas/${id}/follow`), `You no longer follow ${id}.`);
    else if (action === 'promote') { e.preventDefault(); run(() => ctx.api.post(`portal/ideas/${id}/promote`, {}), `${id} is on the Product board.`); }
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const f = form.elements;
    const id = form.dataset.id;
    if (form.dataset.form === 'submit') run(() => ctx.api.post('portal/ideas', { title: f.title.value, product: f.product.value, problem: f.problem.value }), (i) => `${i.id} is in the portal. Vote for it to count yourself in.`);
    else if (form.dataset.form === 'behalf') run(() => ctx.api.post(`portal/ideas/${id}/votes`, { onBehalfOf: f.name.value }), (r) => `Voted for ${id} on behalf of ${r.vote.onBehalfOf}.`);
    else if (form.dataset.form === 'comment') run(() => ctx.api.post(`portal/ideas/${id}/comments`, { text: f.text.value }), 'Comment added.');
    else if (form.dataset.form === 'merge') run(() => ctx.api.post(`portal/ideas/${id}/merge`, { into: f.into.value }), (r) => `${r.ideaId} is merged into ${r.into}; ${r.votesCarried} vote${r.votesCarried === 1 ? '' : 's'} carried over.`);
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
