// Product · Roadmap (NooblyJS Phase 25b): made from the items themselves. Now (the next three months), Next (the three
// after) and Later, each with its dates and days; the items placed there with the objective they serve, their team,
// days, status, release and (in Now) Design's features with what each depends on; grouped by portfolio, theme,
// objective or team. Capacity in Now per team, in words. The Now timeline from each item's planned stage spans.
// A person with `draft` moves items between horizons and saves views; a saved view has a read-only page
// (/roadmap/views/:id, route meta readOnly) anyone signed in can be sent.
// Data: GET /roadmap, /roadmap/views, /roadmap/views/:id. Writes: PUT /roadmap/items/:id, POST /roadmap/views.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say } from '../lib.js';
import { roadmapView as timelineView } from './board.js';

const HORIZONS = [['now', 'Now'], ['next', 'Next'], ['later', 'Later']];
const FILTERS = ['portfolio', 'theme', 'objective', 'team'];

function controls(r, query) {
  const option = (value, label, current) => html`<option value="${value}"${current === value ? html` selected` : ''}>${label}</option>`;
  return html`<form class="pf-filters pf-inline" data-form="controls" aria-label="Group and filter the roadmap">
    <label>Group by <select name="groupBy">${r.choices.groups.map((g) => option(g.key, g.label, r.groupBy))}</select></label>
    <label>Portfolio <select name="portfolio"><option value="">Any</option>${r.choices.portfolios.map((p) => option(p, p, query.get('portfolio')))}</select></label>
    <label>Theme <select name="theme"><option value="">Any</option>${r.choices.themes.map((t) => option(t, t, query.get('theme')))}</select></label>
    <label>Objective <select name="objective"><option value="">Any</option>${r.choices.objectives.map((o) => option(o.id, `${o.id} ${o.title}`, query.get('objective')))}</select></label>
    <label>Team <select name="team"><option value="">Any</option>${r.choices.teams.map((t) => option(t.id, t.name, query.get('team')))}</select></label>
    ${button({ label: 'Show', kind: 'secondary', small: true, type: 'submit' })}
  </form>`;
}

function itemCard(i, { ctx, editable }) {
  const meta = [i.product, i.team?.name ?? 'No team', i.days.text].filter(Boolean).join(' · ');
  const move = editable ? html`<form class="pf-inline" data-form="move" data-id="${i.id}"><label><span class="visually-hidden">Move ${i.id} to</span><select name="horizon" aria-label="Move ${i.id} to">${HORIZONS.map(([k, l]) => html`<option value="${k}"${i.horizon === k ? html` selected` : ''}>${l}</option>`)}<option value="">Off the roadmap</option></select></label>${button({ label: 'Move', kind: 'secondary', small: true, type: 'submit' })}</form>` : '';
  return html`<li class="kanban__card" id="rm-${i.id}">
    <a class="kanban__title" href="${hrefFor(ctx, i.kind === 'spec' ? `/specs/${i.id}` : `/business-cases/${i.id}`)}">${i.id} ${i.title}</a>
    <span class="kanban__meta">${meta}</span>
    <span class="kanban__meta">${i.objective ? `Serves ${i.objective.id} (${i.objective.horizonText})` : 'Serves no objective'} · ${i.statusText}</span>
    ${i.release ? html`<span class="kanban__meta">${i.release.name}${i.release.version ? ` (${i.release.version})` : ''}: ${i.release.statusText}</span>` : ''}
    ${i.mismatch ? statusPill({ text: `Earlier than ${i.objective.id}`, tone: 'warning' }) : ''}
    ${i.features.length ? html`<ul class="pf-list pf-features" aria-label="${i.id}'s features">${i.features.map((f) => html`<li><strong>${f.id}</strong> ${f.title} <span class="muted">· ${f.text}</span></li>`)}</ul>` : ''}
    ${move}
  </li>`;
}

function columnsView(r, { ctx, editable }) {
  const head = html`<div class="pf-horizons__head">${r.horizons.map((h) => html`<div class="pf-horizon__head"><h2 class="kanban__head">${h.label}<span class="kanban__count">${h.items}</span></h2><span class="muted">${h.text} · ${h.days} days</span></div>`)}</div>`;
  if (!r.lanes.length) return card({ title: 'Nothing on the roadmap', body: html`<p class="muted">No item is placed in Now, Next or Later${Object.values(r.filter).some(Boolean) ? ' with these filters' : ''}.</p>` });
  return html`<div class="pf-kanban-scroll" tabindex="0" role="region" aria-label="Now, Next and Later"><div class="pf-horizons">${head}
    ${r.lanes.map((lane) => html`<section class="pf-lane" aria-label="${lane.label}">${r.groupBy !== 'none' ? html`<h3 class="pf-lane__name">${lane.label}</h3>` : ''}
      <div class="pf-lane__cols">${HORIZONS.map(([k, l]) => html`<ul class="rows pf-horizon" role="list" aria-label="${lane.label}: ${l}">${lane.columns[k].length ? lane.columns[k].map((i) => itemCard(i, { ctx, editable })) : html`<li class="kanban__empty">Nothing here.</li>`}</ul>`)}</div>
    </section>`)}</div></div>`;
}

function capacityView(rows) {
  if (!rows.length) return '';
  return card({
    title: 'Capacity in Now',
    meta: 'Each team\'s people-days in the next three months (Teams & roles) against the days of its items in Now. Next and Later are not checked.',
    body: html`<ul class="pf-list">${rows.map((c) => html`<li>${statusPill({ text: c.over ? 'Over-planned' : c.capacity == null ? 'Capacity not set' : 'Within capacity', tone: c.over ? 'warning' : c.capacity == null ? 'neutral' : 'success' })} ${c.text}</li>`)}</ul>`,
  });
}

export async function render(view, { ctx, query, params, route }) {
  const readOnly = route.meta?.readOnly === true;
  const editable = !readOnly && ctx.can('draft');
  const message = () => view.querySelector('[data-message]');

  async function draw(flash = null) {
    let r; let saved = null; let views = [];
    try {
      if (readOnly) ({ view: saved, roadmap: r } = await ctx.api.get(`roadmap/views/${encodeURIComponent(params.id)}`));
      else {
        const q = Object.fromEntries(['groupBy', ...FILTERS].map((k) => [k, query.get(k) ?? undefined]));
        [r, { views }] = await Promise.all([ctx.api.get('roadmap', { query: q }), ctx.api.get('roadmap/views')]);
      }
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the roadmap'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const filtered = Object.entries(r.filter).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
    view.innerHTML = String(html`${pageHead({
      eyebrow: readOnly ? 'Product · Roadmap · Saved view' : 'Product · Strategy',
      title: readOnly ? saved.name : 'Roadmap',
      lead: readOnly
        ? html`Read-only: grouped by ${r.groupText.toLowerCase()}${filtered ? `, ${filtered}` : ''}. <a href="${hrefFor(ctx, '/roadmap')}">Open the roadmap</a> to change it.`
        : 'Made from the items themselves: Now is the next three months, Next the three after, Later anything beyond. Objectives, teams and days say why each item is there and whether Now fits.',
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      ${readOnly ? '' : controls(r, query)}
      ${capacityView(r.capacity)}
      ${r.mismatches.length ? html`<p class="pf-message pf-message--error">${r.mismatches.join('. ')}.</p>` : ''}
      ${columnsView(r, { ctx, editable })}
      ${timelineView(r.timeline, ctx)}
      ${!readOnly && r.unplaced.length ? card({
    title: 'Not on the roadmap yet',
    body: html`<ul class="pf-list">${r.unplaced.map((i) => html`<li>${i.id} ${i.title} <span class="muted">· ${[i.product, i.statusText, i.days.text].filter(Boolean).join(' · ')}</span>${editable ? html` <form class="pf-inline" data-form="move" data-id="${i.id}"><select name="horizon" aria-label="Place ${i.id} in">${HORIZONS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select>${button({ label: 'Place it', kind: 'secondary', small: true, type: 'submit' })}</form>` : ''}</li>`)}</ul>`,
  }) : ''}
      ${readOnly ? '' : card({
    title: 'Saved views',
    meta: 'Each has a read-only page you can send to anyone signed in to NooblyJS.',
    body: html`${views.length ? html`<ul class="pf-list">${views.map((v) => html`<li><a href="${hrefFor(ctx, `/roadmap/views/${v.id}`)}">${v.name}</a></li>`)}</ul>` : html`<p class="muted">No saved views yet.</p>`}
      ${editable ? html`<form class="pf-inline" data-form="save-view"><label>Save this view as <input name="name" maxlength="80" required autocomplete="off" placeholder="Delivery squad by objective"></label>${button({ label: 'Save view', kind: 'secondary', small: true, type: 'submit' })}</form>` : ''}`,
  })}`);
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

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const f = form.elements;
    if (form.dataset.form === 'controls') {
      const q = new URLSearchParams();
      for (const k of ['groupBy', ...FILTERS]) if (f[k].value && !(k === 'groupBy' && f[k].value === 'none')) q.set(k, f[k].value);
      ctx.navigate(`/roadmap${q.size ? `?${q}` : ''}`);
    } else if (form.dataset.form === 'move') {
      run(() => ctx.api.put(`roadmap/items/${form.dataset.id}`, { horizon: f.horizon.value || null }), (m) => m.text);
    } else if (form.dataset.form === 'save-view') {
      const filter = Object.fromEntries(FILTERS.map((k) => [k, query.get(k)]).filter(([, v]) => v));
      run(() => ctx.api.post('roadmap/views', { name: f.name.value, groupBy: query.get('groupBy') ?? 'none', filter }), (v) => `Saved "${v.name}". Its read-only page is ${location.origin}${hrefFor(ctx, `/roadmap/views/${v.id}`)}`);
    }
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
