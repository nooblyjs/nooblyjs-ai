// Home · Lifecycle (product.md §5.2, mockup noobly-platform-lifecycle): every item from idea to production and where
// it is waiting. The swimlane, stage health, Where work waits and Handoffs this week all come from the NooblyJS lifecycle engine.
import { html } from '/ui/js/html.js';
import { pageHead, chips, swimlane, notice } from '/ui/js/components/index.js';
import { workflowsApi, onChange, engineMissing, isMissing } from './lib.js';

const HEAD = { eyebrow: 'NooblyJS · Lifecycle', title: 'Lifecycle', lead: 'Every item from idea to production, and where it is waiting.' };
const FILTERS = ['all', 'mine', 'waiting'];

const health = (stages) => html`<section class="health" aria-label="Stage health">${stages.map((s) => html`<div class="health__stage${s.slowest ? ' health__stage--slowest' : ''}">
    <span class="health__name">${s.number} · ${s.label}</span>
    <span class="health__count">${s.count}</span>
    <span class="health__note">${s.medianDays === null ? 'no moves in 30 days' : `median ${s.medianDays} d${s.slowest ? ' · slowest' : ''}`}</span>
  </div>`)}</section>`;

function waits(flow) {
  const rows = flow.gates.map((g, i) => html`<div class="waitbar">
      <span>${g.label}</span>
      <div class="waitbar__track" role="meter" aria-label="${g.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(g.ratio * 100)}" aria-valuetext="${g.days} days on average"><div class="waitbar__fill${i === 0 ? ' waitbar__fill--longest' : ''}" style="width: ${Math.round(g.ratio * 100)}%"></div></div>
      <span class="waitbar__value">${g.days} d</span>
    </div>`);
  return html`<section class="card" aria-label="Where work waits">
    <div class="card__head"><h2 class="card__title">Where work waits</h2><span class="card__meta">Waiting for a person · last 30 days</span></div>
    ${rows}<p class="row__meta">${flow.insight}</p>
  </section>`;
}

const handoffs = (flow) => html`<section class="card" aria-label="Handoffs this week">
    <div class="card__head"><h2 class="card__title">Handoffs this week</h2><span class="card__meta">${flow.handoffTotal} total</span></div>
    <dl class="tally">${flow.handoffs.map((h) => html`<div><dt>${h.label}</dt><dd>${h.count}</dd></div>`)}<div class="tally__sent-back"><dt>Sent back for changes</dt><dd>${flow.sentBack}</dd></div></dl>
  </section>`;

export async function render(view, { ctx, query }) {
  const api = workflowsApi(ctx);
  let filter = FILTERS.includes(query.get('filter')) ? query.get('filter') : 'all';

  async function draw({ keepFocus = false } = {}) {
    let data;
    let flow;
    try {
      [data, flow] = await Promise.all([api.get('items', { query: { filter } }), api.get('flow')]);
    } catch (err) {
      if (isMissing(err)) return engineMissing(view, HEAD);
      throw err;
    }
    if (!ctx.isCurrent()) return;
    const stages = data.stages.map((s) => ({ key: s.key, label: s.label.replace(' design', '') }));
    const empty = { all: 'Nothing is in flight.', mine: 'None of the items in flight are yours or waiting on you.', waiting: `Nothing has waited ${data.waitingTooLongDays} days or more.` }[data.filter];
    view.innerHTML = String(html`${pageHead({
      ...HEAD,
      actions: chips({ label: 'Show', name: 'filter', current: data.filter, items: [
        { value: 'all', label: 'All', count: data.counts.all },
        { value: 'mine', label: 'Mine', count: data.counts.mine },
        { value: 'waiting', label: `Waiting ${data.waitingTooLongDays}+ days`, count: data.counts.waiting },
      ] }),
    })}
    ${health(data.stages)}
    <section class="card card--flush" aria-label="Items by stage">
      <div class="card__head"><h2 class="card__title">In flight</h2></div>
      ${data.rows.length ? swimlane({ rows: data.rows.map((r) => ({ ...r, id: r.ref })), stages, caption: 'Items in flight, by stage' }) : notice({ title: 'Nothing to show', text: empty, tone: 'muted' })}
    </section>
    <div class="split">${waits(flow)}${handoffs(flow)}</div>`);
    if (keepFocus) view.querySelector(`[data-filter="${filter}"]`)?.focus();
  }

  view.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip || chip.dataset.filter === filter) return;
    filter = chip.dataset.filter;
    history.replaceState({}, '', filter === 'all' ? '/home/lifecycle' : `/home/lifecycle?filter=${filter}`);
    draw({ keepFocus: true });
  }, { signal: ctx.signal });

  await draw();
  onChange(ctx, () => draw(), { types: ['item.', 'approval.', 'handoff.', 'clock.'] });
}
