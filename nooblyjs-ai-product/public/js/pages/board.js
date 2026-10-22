// The Product board (Stage 1, product.md §5.1): tabs Board / Roadmap / Insights, New idea, filters by
// portfolio, value stream and product (labels, set up on the Portfolios page since CHG-010: pages/strategy.js), the kanban (Signals → Ideas → Spec drafting → In review → To architecture), Top signals this week
// and the quarter's roadmap. Since NooblyJS Phase 17 it also filters by the work hierarchy's epic and feature, an idea
// says its feature and links to its business case, and a new idea can be filed under a feature.
// Data: GET /board. Writes: POST /signals/:id/idea, POST /ideas,
// PUT /ideas/:id (the RICE score) and POST /specs (a spec for an idea, which Ada then drafts).
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { hrefFor, specPill, errorCard, isAbort, reloadable, say } from '../lib.js';
import { filtersView, labelFields, wirePortfolios } from './portfolios.js';

const TABS = [['board', 'Board'], ['roadmap', 'Roadmap'], ['insights', 'Insights']];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Who asked for it (NooblyJS Phase 25a): beside the RICE score, never part of it. */
const evidenceLine = (c) => (c.evidence ? html`<span class="kanban__meta pf-evidence">${c.evidence.text}</span>` : '');

/** One kanban card. Specs link to their page; signals offer "Make it an idea" to those who may draft. */
function boardCard(c, ctx) {
  const canDraft = ctx.can('draft');
  if (c.kind === 'signal') {
    return html`<li class="kanban__card"><span class="kanban__title">${c.title}</span><span class="kanban__meta">${c.text}</span>${c.notes ? html`<a class="pf-card-link" href="${hrefFor(ctx, `/feedback?signal=${encodeURIComponent(c.id)}`)}">Show its notes</a>` : ''}${canDraft
      ? button({ label: 'Make it an idea', kind: 'secondary', small: true, attrs: { 'data-action': 'to-idea', 'data-id': c.id, 'aria-label': `Make "${c.title}" an idea` } })
      : ''}</li>`;
  }
  if (c.kind === 'idea') {
    const scored = c.rice.score != null;
    const actions = canDraft
      ? html`<span class="pf-card-actions">${button({ label: scored ? 'Rescore' : 'Score it', kind: 'secondary', small: true, attrs: { 'data-action': 'score', 'data-id': c.id, 'aria-label': `${scored ? 'Rescore' : 'Score'} "${c.title}" with RICE` } })}${scored
        ? button({ label: 'Draft a spec', kind: 'secondary', small: true, attrs: { 'data-action': 'spec-from', 'data-id': c.id, 'aria-label': `Draft a spec for "${c.title}"` } })
        : ''}</span>`
      : '';
    return html`<li class="kanban__card"><span class="kanban__title">${c.id} ${c.title}</span><span class="kanban__meta">${c.text}${c.feature ? ` · ${c.feature.id} ${c.feature.name}` : ''}</span>${evidenceLine(c)}${scored ? '' : statusPill({ text: 'Not scored yet', tone: 'warning' })}${c.status === 'accepted' ? statusPill({ text: 'Accepted', tone: 'success' }) : ''}${actions}<a class="pf-card-link" href="${hrefFor(ctx, `/business-cases/${c.id}`)}">Business case</a></li>`;
  }
  const progress = c.progress != null
    ? html`<span class="pf-progress" role="progressbar" aria-label="${c.statusText}" aria-valuenow="${c.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(0, Math.min(100, c.progress))}%"></span></span>`
    : '';
  return html`<li class="kanban__card"><a class="kanban__title" href="${hrefFor(ctx, `/specs/${c.id}`)}">${c.id} ${c.title}</a><span class="kanban__meta">${c.product ?? ''}</span>${evidenceLine(c)}${specPill(c)}${progress}</li>`;
}

/** NooblyJS Phase 17: the work hierarchy's epics and features in the chosen value stream, as filters with counts. */
function workFilters(board, ctx) {
  if (!board.epics?.length) return '';
  const link = (key, value, label, count, active) => {
    const q = new URLSearchParams(Object.entries({ ...board.filter, epic: null, feature: null, [key]: active ? null : value }).filter(([k, v]) => v && v !== false && k !== 'mine'));
    return html`<a class="pf-chip${active ? ' pf-chip--on' : ''}" aria-pressed="${active ? 'true' : 'false'}" href="${hrefFor(ctx, `/board${q.size ? `?${q}` : ''}`)}">${label} <span class="muted">${count}</span></a>`;
  };
  return html`<div class="pf-filters" aria-label="Epics and features">
    <span class="muted">Epics</span> ${board.epics.map((e) => link('epic', e.id, `${e.id} ${e.name}`, e.count, e.active))}
    ${board.features.length ? html`<span class="muted">Features</span> ${board.features.map((f) => link('feature', f.id, `${f.id} ${f.name}`, f.count, f.active))}` : ''}
  </div>`;
}

function kanbanView(board, ctx) {
  return html`<div class="pf-kanban-scroll" tabindex="0" role="region" aria-label="Board columns"><div class="kanban pf-kanban">${board.columns.map((col) => html`<section class="kanban__col" aria-label="${col.label}">
    <h3 class="kanban__head">${col.label}<span class="kanban__count">${col.count}</span></h3>
    <ul class="rows" role="list">${col.cards.length ? col.cards.map((c) => boardCard(c, ctx)) : html`<li class="kanban__empty">Nothing here.</li>`}</ul>
  </section>`)}</div></div>`;
}

function topSignalsView(top) {
  const max = Math.max(1, ...top.items.map((i) => i.count));
  return card({
    title: 'Top signals this week',
    meta: top.text,
    body: top.items.length
      ? html`<ul class="pf-bars" role="list">${top.items.map((i) => html`<li><span class="pf-bars__label">${i.theme}</span><span class="pf-bars__track" aria-hidden="true"><span style="width:${Math.round((i.count / max) * 100)}%"></span></span><span class="pf-bars__value">${i.count}</span></li>`)}</ul>`
      : html`<p class="muted">No signals this week.</p>`,
  });
}

/** Months between two ISO dates, for the roadmap's header. */
function monthsOf(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(MONTH[d.getUTCMonth()]);
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
  }
  return out;
}

function roadmapView(roadmap, ctx, { compact = false } = {}) {
  if (!roadmap?.items?.length) return card({ title: 'Roadmap', body: html`<p class="muted">Nothing on the roadmap yet.</p>` });
  const start = Date.parse(`${roadmap.from}T00:00:00Z`);
  const end = Date.parse(`${roadmap.to}T23:59:59Z`);
  const pct = (iso) => Math.max(0, Math.min(100, ((Date.parse(`${iso}T00:00:00Z`) - start) / (end - start)) * 100));
  const rows = roadmap.items.map((item) => {
    const spans = item.spans.filter((s) => s.to >= roadmap.from && s.from <= roadmap.to);
    const words = `${item.id} ${item.title}: now in ${item.current?.label ?? 'an unknown stage'}. ${spans.map((s) => `${s.label} ${s.from} to ${s.to}`).join('; ')}.`;
    return html`<li class="pf-roadmap__row">
      <a class="pf-roadmap__label" href="${hrefFor(ctx, `/specs/${item.id}`)}">${item.id}${compact ? '' : html` · ${item.title}`}</a>
      <span class="pf-roadmap__track" role="img" aria-label="${words}">${spans.map((s) => html`<span class="pf-span pf-span--${s.stage}${s.current ? ' pf-span--current' : ''}" style="left:${pct(s.from)}%;width:${Math.max(1, pct(s.to) - pct(s.from))}%" title="${s.label}: ${s.from} – ${s.to}"></span>`)}</span>
      ${compact ? '' : html`<span class="pf-roadmap__now">${item.current ? `Now: ${item.current.label}` : ''}</span>`}
    </li>`;
  });
  const legend = [['product', 'Product'], ['architecture', 'Architecture'], ['ux', 'UX design'], ['ui', 'UI design'], ['build', 'Software Factory']];
  return card({
    title: compact ? 'Q4 roadmap' : `Roadmap · ${roadmap.quarter}`,
    meta: compact ? null : 'Each bar is a stage; the outlined one is where the item is now.',
    body: html`<div class="pf-roadmap${compact ? ' pf-roadmap--compact' : ''}">
      <div class="pf-roadmap__months" aria-hidden="true">${monthsOf(roadmap.from, roadmap.to).map((m) => html`<span>${m}</span>`)}</div>
      <ul class="pf-roadmap__rows" role="list">${rows}</ul>
      ${compact ? '' : html`<ul class="pf-legend" role="list">${legend.map(([k, l]) => html`<li><span class="pf-span pf-span--${k}" aria-hidden="true"></span>${l}</li>`)}</ul>`}
    </div>`,
  });
}

function newIdeaForm(board) {
  // Filed under the product the board is filtered to, to start with.
  return html`<form class="card pf-form" data-form="new-idea" hidden>
    <h2 class="card__title">New idea</h2>
    <label>Title <input name="title" required maxlength="120" autocomplete="off"></label>
    ${labelFields(board, { product: board.filter.product })}
    ${board.features?.length ? html`<label>Feature <select name="feature"><option value="">None</option>${board.features.map((f) => html`<option value="${f.id}"${board.filter.feature === f.id ? html` selected` : ''}>${f.id} · ${f.name}</option>`)}</select></label>` : ''}
    <label>Problem <textarea name="problem" rows="3" maxlength="10000"></textarea></label>
    <div class="actions">${button({ label: 'Create idea', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-new' } })}</div>
  </form>`;
}

const IMPACT = [[3, 'Massive'], [2, 'High'], [1, 'Medium'], [0.5, 'Low'], [0.25, 'Minimal']];
const CONFIDENCE = [[1, 'High · 100%'], [0.8, 'Medium · 80%'], [0.5, 'Low · 50%']];
const riceScore = (r) => (r.reach >= 0 && r.impact > 0 && r.confidence >= 0 && r.effort > 0 ? Math.round((r.reach * r.impact * r.confidence) / r.effort) : null);

/** The RICE form for one idea: reach × impact × confidence ÷ effort, with the score shown as you type. */
function riceForm(opp) {
  const r = opp.rice ?? {};
  const options = (list, value, fallback) => list.map(([v, l]) => html`<option value="${v}"${(value ?? fallback) === v ? html` selected` : ''}>${l}</option>`);
  return html`<form class="card pf-form" data-form="rice" data-id="${opp.id}" data-version="${opp.version}">
    <h2 class="card__title">Score ${opp.id} · ${opp.title}</h2>
    <p class="muted">RICE: reach × impact × confidence ÷ effort.</p>
    <div class="pf-form__row">
      <label>Reach<input name="reach" type="number" min="0" max="1000000" step="any" required value="${r.reach ?? ''}" aria-describedby="rice-reach-hint"><span class="pf-hint" id="rice-reach-hint">thousands of customers a quarter</span></label>
      <label>Impact <select name="impact">${options(IMPACT, r.impact, 1)}</select></label>
      <label>Confidence <select name="confidence">${options(CONFIDENCE, r.confidence, 0.8)}</select></label>
      <label>Effort<input name="effort" type="number" min="0.1" max="1000" step="any" required value="${r.effort ?? ''}" aria-describedby="rice-effort-hint"><span class="pf-hint" id="rice-effort-hint">person-months</span></label>
    </div>
    <p class="pf-rice-score" role="status" aria-live="polite" data-rice-score>${r.score == null ? 'Fill in reach and effort to see the score.' : `RICE ${r.score}`}</p>
    <div class="actions">${button({ label: 'Save the score', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-score' } })}</div>
  </form>`;
}

export async function render(view, { query, ctx }) {
  let tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'board';
  const filter = { portfolio: query.get('portfolio') ?? undefined, valueStream: query.get('valueStream') ?? undefined, product: query.get('product') ?? undefined, mine: query.get('mine') ? '1' : undefined, epic: query.get('epic') ?? undefined, feature: query.get('feature') ?? undefined };
  let board = null;
  // The New idea form's portfolio and product pickers (portfolios and products are set up on the Portfolios page).
  const labels = { editing: null };
  let scoring = null; // the id of the idea whose RICE form is open

  const idea = (id) => board?.columns.flatMap((col) => col.cards).find((c) => c.kind === 'idea' && c.id === id);
  const message = () => view.querySelector('[data-message]');

  async function draw() {
    try {
      board = await ctx.api.get('board', { query: filter });
    } catch (err) {
      if (isAbort(err)) return;
      view.innerHTML = String(errorCard(err, 'the board'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const actions = html`${button({ label: 'Portfolios & products', kind: 'secondary', href: hrefFor(ctx, '/portfolios') })}${ctx.can('draft') ? button({ label: 'New idea', icon: 'plus', attrs: { 'data-action': 'new-idea' } }) : ''}`;
    const tabs = html`<div class="pf-tabs" role="tablist" aria-label="Product views">${TABS.map(([k, l]) => html`<button type="button" role="tab" class="pf-tab" id="pf-tab-${k}" aria-selected="${k === tab}" aria-controls="pf-panel" data-tab="${k}">${l}</button>`)}</div>`;
    let panel;
    if (tab === 'board') {
      panel = html`${filtersView(board, ctx)}${workFilters(board, ctx)}${kanbanView(board, ctx)}<div class="grid pf-panels">${topSignalsView(board.topSignals)}${roadmapView(board.roadmap, ctx, { compact: true })}</div>`;
    } else if (tab === 'roadmap') {
      panel = roadmapView(board.roadmap, ctx);
    } else {
      let m = null;
      try {
        m = await ctx.api.get('metrics');
      } catch (err) {
        if (isAbort(err)) return;
      }
      panel = m
        ? html`<div class="grid">${card({ title: 'Lead time', body: html`<p class="pf-study__headline">${m.leadTime.medianDays == null ? '—' : `${m.leadTime.medianDays} days`}</p><p class="muted">${m.leadTime.text}</p>` })}${card({ title: 'Agent spend this month', meta: m.spend.month, body: html`<p class="pf-study__headline">$${m.spend.usedUsd.toFixed(2)}</p><p class="muted">${Object.entries(m.spend.byStage).map(([k, v]) => `${k}: $${v.toFixed(2)}`).join(' · ') || 'No agent work yet'}</p>` })}</div>${card({ title: 'Sent back, by stage', body: html`<ul class="pf-links" role="list">${m.sentBack.map((x) => html`<li><span class="pf-links__title">${x.label}</span><span class="pf-links__meta">${x.text}</span></li>`)}</ul>` })}`
        : card({ title: 'Insights', body: html`<p class="muted">The metrics couldn't load.</p>` });
    }
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Product Factory · Stage 1', title: 'Product', lead: 'Signals become ideas, ideas become specs.', actions })}
      ${tabs}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      ${board.catalogue.empty ? card({ title: 'Start with your portfolios', body: html`<p class="muted">A portfolio is a large area of the business (Digital, Buying, Banking). Add yours, their value streams and the products in each on the <a href="${hrefFor(ctx, '/portfolios')}">Portfolios</a> page. Ideas and specs then sit in a product, and the board filters by them.</p>` }) : ''}
      ${ctx.can('draft') ? newIdeaForm(board) : ''}
      ${ctx.can('draft') && scoring && idea(scoring) ? riceForm(idea(scoring)) : ''}
      <div id="pf-panel" role="tabpanel" aria-labelledby="pf-tab-${tab}" class="pf-stack">${panel}</div>`);
  }

  view.addEventListener('click', async (e) => {
    const tabButton = e.target.closest('[data-tab]');
    if (tabButton) {
      tab = tabButton.dataset.tab;
      await draw();
      view.querySelector(`#pf-tab-${tab}`)?.focus();
      return;
    }
    const form = view.querySelector('[data-form="new-idea"]');
    if (e.target.closest('[data-action="new-idea"]') && form) {
      form.hidden = false;
      form.querySelector('input[name="title"]').focus();
      return;
    }
    if (e.target.closest('[data-action="cancel-new"]') && form) {
      form.hidden = true;
      return;
    }
    const toOpp = e.target.closest('[data-action="to-idea"]');
    if (toOpp) {
      toOpp.disabled = true;
      try {
        const opp = await ctx.api.post(`signals/${toOpp.dataset.id}/idea`, {});
        scoring = opp.id; // straight on to scoring it
        await draw();
        say(message(), `${opp.title} is now ${opp.id}, in Ideas. Score it with RICE below.`, 'success');
        view.querySelector('[data-form="rice"] input[name="reach"]')?.focus();
      } catch (err) {
        if (isAbort(err)) return;
        toOpp.disabled = false;
        say(message(), err.message, 'error');
      }
      return;
    }
    const score = e.target.closest('[data-action="score"]');
    if (score) {
      scoring = score.dataset.id;
      await draw();
      view.querySelector('[data-form="rice"] input[name="reach"]')?.focus();
      return;
    }
    if (e.target.closest('[data-action="cancel-score"]')) {
      scoring = null;
      await draw();
      return;
    }
    // A spec for the idea: the new spec waits for a brief, and its page is where Ada is asked to draft it.
    const specFrom = e.target.closest('[data-action="spec-from"]');
    if (specFrom) {
      const opp = idea(specFrom.dataset.id);
      specFrom.disabled = true;
      try {
        const spec = await ctx.api.post('specs', { title: opp.title, idea: opp.id }); // it takes the idea's product
        ctx.navigate(`/specs/${spec.id}`);
      } catch (err) {
        if (isAbort(err)) return;
        if (err.details?.spec) return ctx.navigate(`/specs/${err.details.spec}`); // it already has one: go there
        specFrom.disabled = false;
        say(message(), err.message, 'error');
      }
    }
  }, { signal: ctx.signal });

  // The score as you type, in words.
  view.addEventListener('input', (e) => {
    const form = e.target.closest('[data-form="rice"]');
    if (!form) return;
    const d = Object.fromEntries(new FormData(form));
    const s = d.reach === '' || d.effort === '' ? null : riceScore({ reach: Number(d.reach), impact: Number(d.impact), confidence: Number(d.confidence), effort: Number(d.effort) });
    form.querySelector('[data-rice-score]').textContent = s == null ? 'Fill in reach and effort to see the score.' : `RICE ${s}`;
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (e) => {
    const rice = e.target.closest('[data-form="rice"]');
    if (rice) {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(rice));
      const body = { rice: { reach: Number(d.reach), impact: Number(d.impact), confidence: Number(d.confidence), effort: Number(d.effort) } };
      try {
        const opp = await ctx.api.put(`ideas/${rice.dataset.id}`, body, { headers: { 'If-Match': `"${rice.dataset.id}@${rice.dataset.version}"` } });
        scoring = null;
        await draw();
        say(message(), `${opp.id} ${opp.title} scores RICE ${opp.rice.score}. Draft a spec for it when you're ready.`, 'success');
      } catch (err) {
        if (isAbort(err)) return;
        const details = err.details ? Object.values(err.details).join(' ') : '';
        say(message(), err.status === 412 ? 'Someone else changed this idea. Reload the board and score it again.' : `${err.message} ${details}`.trim(), 'error');
      }
      return;
    }
    const form = e.target.closest('[data-form="new-idea"]');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const body = { title: data.title, ...(data.product ? { product: data.product, ...(data.portfolio ? { portfolio: data.portfolio } : {}) } : {}), ...(data.problem.trim() ? { problem: data.problem } : {}), ...(data.feature ? { feature: data.feature } : {}) };
    try {
      const opp = await ctx.api.post('ideas', body);
      await draw();
      say(view.querySelector('[data-message]'), `${opp.id} ${opp.title} was added to Ideas${opp.product ? `, in ${opp.product}${opp.portfolio ? ` (${opp.portfolio})` : ''}` : ''}.`, 'success');
    } catch (err) {
      if (isAbort(err)) return;
      const details = err.details ? Object.values(err.details).join(' ') : '';
      say(view.querySelector('[data-message]'), `${err.message} ${details}`.trim(), 'error');
    }
  }, { signal: ctx.signal });

  wirePortfolios(view, ctx, { state: labels, redraw: draw, catalogue: () => board.catalogue, message });
  await reloadable(view, ctx, draw);
}

