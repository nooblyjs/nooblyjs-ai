// Product · Feedback (NooblyJS Phase 25a): what colleagues say, as notes. A person with `draft` logs one (typed in, a
// Teams message, or a Jira issue by its key), links a snippet of it to an idea, feature or spec with an importance,
// puts it in a signal, and accepts or declines Ada's suggestions. The feedback form's links are made here too: anyone
// with a link can send feedback without signing in.
// Data: GET /feedback/notes, /catalogue, /ideas, /specs, /signals, /feedback/links. Writes: POST /feedback/notes,
// /feedback/notes/:id/insights, /feedback/suggest, …/suggestions/:sid/decision, PUT …/signal, POST|PATCH /feedback/links.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say } from '../lib.js';

const TONE = { nice: 'neutral', important: 'info', critical: 'warning' };
const WORDS = { nice: 'Nice to have', important: 'Important', critical: 'Critical' };
const importanceSelect = (name, chosen = 'important') => html`<select name="${name}" aria-label="How much it matters">${Object.entries(WORDS).map(([k, l]) => html`<option value="${k}"${k === chosen ? html` selected` : ''}>${l}</option>`)}</select>`;

function filtersView(data, query, products, ctx) {
  const chip = (label, params, active, count) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return html`<a class="pf-chip${active ? ' pf-chip--on' : ''}" aria-pressed="${active ? 'true' : 'false'}" href="${hrefFor(ctx, `/feedback${q.size ? `?${q}` : ''}`)}">${label}${count == null ? '' : html` <span class="muted">${count}</span>`}</a>`;
  };
  const product = query.get('product');
  const keep = { product };
  return html`<div class="pf-filters" aria-label="Filter the notes">
    ${chip('All', keep, !query.get('unlinked') && !query.get('source') && !query.get('signal'), data.counts.all)}
    ${chip('Not linked yet', { ...keep, unlinked: '1' }, Boolean(query.get('unlinked')), data.counts.unlinked)}
    ${data.sources.map((s) => chip(s.label, { ...keep, source: s.key }, query.get('source') === s.key, s.count))}
    ${query.get('signal') ? chip(`Signal: ${query.get('signal')}`, { ...keep, signal: query.get('signal') }, true) : ''}
    <form class="pf-inline" data-form="product-filter"><label>Product <select name="product"><option value="">Every product</option>${products.map((p) => html`<option value="${p.name}"${product === p.name ? html` selected` : ''}>${p.name}${p.portfolio ? ` · ${p.portfolio}` : ''}</option>`)}</select></label>${button({ label: 'Show', kind: 'secondary', small: true, type: 'submit' })}</form>
  </div>`;
}

function noteView(n, { canDraft, targets, signals }) {
  const meta = [n.fromText, n.sourceText, n.jiraKey, n.product ? `${n.product}${n.portfolio ? ` · ${n.portfolio}` : ''}` : 'No product', new Date(n.at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ');
  const insights = n.insights.length ? html`<ul class="pf-list" aria-label="What it is evidence for">${n.insights.map((x) => html`<li>${statusPill({ text: x.importanceText, tone: TONE[x.importance] })} <strong>${x.targetTitle}</strong>: “${x.snippet}”${x.suggestedBy ? html` <span class="muted">· suggested by ${x.suggestedBy.name}</span>` : ''}${canDraft ? html` ${button({ label: 'Unlink', kind: 'secondary', small: true, attrs: { 'data-action': 'unlink', 'data-note': n.id, 'data-id': x.id, 'aria-label': `Unlink ${n.id} from ${x.target}` } })}` : ''}</li>`)}</ul>` : '';
  const suggestions = n.suggestions.map((s) => html`<form class="pf-suggestion" data-form="decide" data-note="${n.id}" data-id="${s.id}" aria-label="${s.by.name}'s suggestion for ${n.id}">
      <span><strong>${s.by.name} suggests</strong> ${s.targetTitle}: “${s.snippet}”${s.signal ? html` <span class="muted">· signal ${s.signal}</span>` : ''}</span>
      ${canDraft ? html`<span class="actions">${importanceSelect('importance', s.importance)}${button({ label: 'Accept', small: true, type: 'submit' })}${button({ label: 'Decline', kind: 'secondary', small: true, attrs: { 'data-action': 'decline', 'data-note': n.id, 'data-id': s.id } })}</span>` : ''}
    </form>`);
  const linkForm = canDraft ? html`<details class="pf-details"><summary>Link it</summary><form class="pf-form pf-form--inline" data-form="link" data-note="${n.id}">
      <label>Evidence for <select name="target" required><option value="">Choose an idea, feature or spec</option>${targets.map((t) => html`<option value="${t.id}">${t.id} · ${t.title}</option>`)}</select></label>
      <label>The words that say it <span class="pf-hint">Copy them from the note, or leave it empty for the whole note.</span><input name="snippet" maxlength="600" autocomplete="off"></label>
      <label>How much it matters ${importanceSelect('importance')}</label>
      <div class="actions">${button({ label: 'Link', type: 'submit', small: true })}</div>
    </form>
    <form class="pf-form pf-form--inline" data-form="signal" data-note="${n.id}">
      <label>Signal <select name="signal"><option value="">None</option>${signals.map((g) => html`<option value="${g.id}"${n.signal === g.id ? html` selected` : ''}>${g.title}</option>`)}</select></label>
      <label>Or a new signal <input name="title" maxlength="160" autocomplete="off" placeholder="Slots sell out before 10:00"></label>
      <div class="actions">${button({ label: 'Save the signal', kind: 'secondary', type: 'submit', small: true })}</div>
    </form></details>` : '';
  return html`<li class="card pf-note" id="${n.id}">
    <div class="pf-note__head"><strong>${n.id}</strong>${n.linked ? statusPill({ text: 'Linked', tone: 'success' }) : statusPill({ text: 'Not linked yet', tone: 'warning' })}${n.signal ? html`<span class="muted">Signal ${n.signal}</span>` : ''}</div>
    <p class="pf-note__text">${n.text}</p>
    <p class="muted">${meta}</p>
    ${insights}${suggestions}${linkForm}
  </li>`;
}

function logForm(products) {
  return html`<form class="card pf-form" data-form="log" hidden aria-label="Log a note">
    <h2 class="card__title">Log a note</h2>
    <label>Where it came from <select name="source"><option value="typed">Typed in</option><option value="teams">A Teams message</option><option value="jira">A Jira issue</option></select></label>
    <label>Jira issue key <span class="pf-hint">Only for a Jira issue: its summary and description become the note.</span><input name="jiraKey" maxlength="20" autocomplete="off" placeholder="DTE-60"></label>
    <label>What they said <textarea name="text" rows="4" maxlength="4000"></textarea></label>
    <label>Who said it <span class="pf-hint">A colleague's name. Left empty, it is from you.</span><input name="from" maxlength="80" autocomplete="off"></label>
    <label>Product <select name="product"><option value="">Choose a product</option>${products.map((p) => html`<option value="${p.name}">${p.name}${p.portfolio ? ` · ${p.portfolio}` : ''}</option>`)}</select></label>
    <p class="muted">Email addresses, phone numbers and ID numbers are taken out before it is kept.</p>
    <div class="actions">${button({ label: 'Log it', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-log' } })}</div>
  </form>`;
}

function linksCard(links, products) {
  const url = (l) => `${location.origin}${l.path}`;
  return card({
    title: 'Feedback form links',
    meta: 'Anyone who has a link can send feedback on its product, without signing in. Their notes arrive here as "Feedback form"; they are not told anything back.',
    body: html`${links.length ? html`<ul class="rows" role="list">${links.map((l) => html`<li class="row"><div class="row__main"><span class="row__title">${l.product}</span><span class="row__meta"><code>${url(l)}</code></span><span class="row__meta">${l.statusText}</span></div>
        <span class="actions">${button({ label: l.active ? 'Switch off' : 'Switch on', kind: 'secondary', small: true, attrs: { 'data-action': 'toggle-link', 'data-id': l.id, 'data-active': String(!l.active) } })}${button({ label: 'Replace', kind: 'secondary', small: true, attrs: { 'data-action': 'replace-link', 'data-id': l.id, 'aria-label': `Replace the ${l.product} link: the old one stops working` } })}</span></li>`)}</ul>` : html`<p class="muted">No links yet.</p>`}
      <form class="pf-form pf-form--inline" data-form="new-link"><label>Make a link for <select name="product" required><option value="">Choose a product</option>${products.map((p) => html`<option value="${p.name}">${p.name}</option>`)}</select></label><div class="actions">${button({ label: 'Make a link', type: 'submit', small: true })}</div></form>`,
  });
}

export async function render(view, { ctx, query }) {
  const message = () => view.querySelector('[data-message]');
  const canDraft = ctx.can('draft');

  async function draw(flash = null) {
    let data; let catalogue; let ideas; let specs; let signals; let links = [];
    try {
      const q = Object.fromEntries(['product', 'source', 'unlinked', 'signal', 'portfolio', 'valueStream'].map((k) => [k, query.get(k) ?? undefined]));
      [data, catalogue, { ideas }, { specs }, { signals }] = await Promise.all([
        ctx.api.get('feedback/notes', { query: q }), ctx.api.get('catalogue'), ctx.api.get('ideas'), ctx.api.get('specs'), ctx.api.get('signals'),
      ]);
      if (canDraft) ({ links } = await ctx.api.get('feedback/links'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the feedback'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const products = [...catalogue.portfolios.flatMap((p) => p.products), ...(catalogue.unfiled ?? [])];
    const targets = [...ideas.filter((i) => !['closed', 'merged'].includes(i.status)).map((i) => ({ id: i.id, title: i.title })), ...specs.map((s) => ({ id: s.id, title: s.title })), ...(catalogue.features ?? []).map((f) => ({ id: f.id, title: f.name }))];
    const open = signals.filter((g) => g.status === 'new');
    view.innerHTML = String(html`${pageHead({
      eyebrow: 'Product · Customers',
      title: 'Feedback',
      lead: 'What colleagues say about the products, and what it is evidence for. Customer importance shows beside the RICE score on the board; it never changes the score.',
      actions: canDraft ? html`${button({ label: 'Ask Ada to suggest links', kind: 'secondary', attrs: { 'data-action': 'suggest' } })}${button({ label: 'Log a note', icon: 'plus', attrs: { 'data-action': 'new-log' } })}` : '',
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      ${canDraft ? logForm(products) : ''}
      ${filtersView(data, query, products, ctx)}
      ${data.counts.suggestions ? html`<p class="muted">${data.counts.suggestions} suggestion${data.counts.suggestions === 1 ? '' : 's'} from Ada waiting for a person to decide.</p>` : ''}
      ${data.notes.length ? html`<ul class="pf-stack" role="list">${data.notes.map((n) => noteView(n, { canDraft, targets, signals: open }))}</ul>` : card({ title: 'No notes', body: html`<p class="muted">Nothing here yet. Log what a colleague said, or share a feedback form link.</p>` })}
      ${canDraft ? linksCard(links, products) : ''}`);
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
    const { action, id, note } = el.dataset;
    if (action === 'new-log') { const f = view.querySelector('[data-form="log"]'); f.hidden = false; f.elements.text.focus(); }
    else if (action === 'cancel-log') { e.preventDefault(); view.querySelector('[data-form="log"]').hidden = true; }
    else if (action === 'suggest') run(() => ctx.api.post('feedback/suggest', {}), (r) => r.text);
    else if (action === 'unlink') run(() => ctx.api.del(`feedback/notes/${note}/insights/${id}`), `${note} is unlinked.`);
    else if (action === 'decline') { e.preventDefault(); run(() => ctx.api.post(`feedback/notes/${note}/suggestions/${id}/decision`, { decision: 'decline' }), 'Declined.'); }
    else if (action === 'toggle-link') run(() => ctx.api.patch(`feedback/links/${id}`, { active: el.dataset.active === 'true' }), (l) => `The ${l.product} link is ${l.active ? 'on' : 'switched off'}.`);
    else if (action === 'replace-link') run(() => ctx.api.patch(`feedback/links/${id}`, { replace: true }), (l) => `The ${l.product} link is replaced: the old one no longer works.`);
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const f = form.elements;
    const kind = form.dataset.form;
    if (kind === 'product-filter') {
      const q = new URLSearchParams(location.search);
      if (f.product.value) q.set('product', f.product.value); else q.delete('product');
      ctx.navigate(`/feedback${q.size ? `?${q}` : ''}`);
    } else if (kind === 'log') {
      const body = { source: f.source.value, text: f.text.value, product: f.product.value || undefined, ...(f.from.value.trim() ? { from: { name: f.from.value.trim() } } : {}), ...(f.source.value === 'jira' ? { jiraKey: f.jiraKey.value } : {}) };
      run(() => ctx.api.post('feedback/notes', body), (n) => `${n.id} is logged.`);
    } else if (kind === 'link') run(() => ctx.api.post(`feedback/notes/${form.dataset.note}/insights`, { target: f.target.value, snippet: f.snippet.value || undefined, importance: f.importance.value }), (x) => `${form.dataset.note} is evidence for ${x.target}.`);
    else if (kind === 'signal') run(() => ctx.api.put(`feedback/notes/${form.dataset.note}/signal`, f.title.value.trim() ? { title: f.title.value.trim() } : { signal: f.signal.value || null }), (r) => (r.signal ? `${form.dataset.note} is in the signal ${r.signal}.` : `${form.dataset.note} is in no signal.`));
    else if (kind === 'decide') run(() => ctx.api.post(`feedback/notes/${form.dataset.note}/suggestions/${form.dataset.id}/decision`, { decision: 'accept', importance: f.importance.value }), (r) => `Accepted: ${r.noteId} is evidence for ${r.insight?.target}.`);
    else if (kind === 'new-link') run(() => ctx.api.post('feedback/links', { product: f.product.value }), (l) => `Anyone with this link can now send feedback on ${l.product}: ${location.origin}${l.path}`);
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
