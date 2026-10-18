// Home · Activity (product.md §5.2, mockup noobly-platform-activity): everything people and agents did, newest first,
// grouped by day, with Live now and Today so far. Rows come from the event log (GET /api/v1/activity); new events
// arrive over the event stream and appear without a refresh.
import { html } from '/ui/js/html.js';
import { pageHead, chips, button, meter } from '/ui/js/components/index.js';
import { onChange, activityRow, dayLabel, money } from './lib.js';

const HEAD = { eyebrow: 'NooblyJS · Activity', title: 'Activity', lead: 'Everything people and agents did across NooblyJS, newest first.' };
const LABELS = { everything: 'Everything', people: 'People', agents: 'Agents', product: 'Product', factory: 'Factory', teammates: 'Teammates', knowledge: 'Knowledge', platform: 'Platform' };
const LIVE_SHOWN = 4;

function timeline(rows, opts, more) {
  if (!rows.length) return html`<p class="row__meta">Nothing matches. Try another filter.</p>`;
  const out = [];
  let day = null;
  for (const row of rows) {
    const label = dayLabel(row.at, opts.now);
    if (label !== day) {
      out.push(html`<h2 class="timeline__day">${label}</h2>`);
      day = label;
    }
    out.push(activityRow(row, opts));
  }
  return html`<div class="timeline">${out}</div>${more ? html`<div class="timeline__more">${button({ label: 'Load earlier', kind: 'secondary', small: true, attrs: { 'data-action': 'earlier' } })}</div>` : ''}`;
}

function liveNow(live, all) {
  const shown = all ? live : live.slice(0, LIVE_SHOWN);
  return html`<section class="card card--side" aria-label="Live now">
    <div class="card__head"><h2 class="card__title card__title--small">Live now</h2><span class="pill pill--info"><span class="pill__dot" aria-hidden="true"></span>${live.length} working</span></div>
    ${shown.length ? shown.map((a) => html`<div class="live"><div class="live__head"><span class="live__who">${a.name}</span><span class="live__task">${a.task}</span></div>${meter({ label: `${a.name}: ${a.task}`, value: `${Math.round(a.progress * 100)}%`, ratio: a.progress, tone: 'live' })}</div>`) : html`<p class="row__meta">No agent is working right now.</p>`}
    ${live.length > LIVE_SHOWN && !all ? button({ label: `See all ${live.length}`, kind: 'secondary', small: true, attrs: { 'data-action': 'all-live' } }) : ''}
  </section>`;
}

const todaySoFar = (t) => html`<section class="today" aria-label="Today in numbers">
    <span class="today__title">Today so far</span>
    <dl class="today__grid">
      <div><dt>agent actions</dt><dd>${t.agentActions}</dd></div>
      <div><dt>human decisions</dt><dd>${t.humanDecisions}</dd></div>
      <div><dt>PRs opened</dt><dd>${t.prsOpened}</dd></div>
      <div><dt>spent</dt><dd>${money(t.spentUsd)}</dd></div>
    </dl>
  </section>`;

export async function render(view, { ctx, query }) {
  let filter = LABELS[query.get('filter')] ? query.get('filter') : 'everything';
  let q = '';
  let rows = [];
  let side = { today: { agentActions: 0, humanDecisions: 0, prsOpened: 0, spentUsd: 0 }, live: [] };
  let nextBefore = null;
  let now = new Date().toISOString();
  let allLive = false;

  view.innerHTML = String(html`${pageHead({
    ...HEAD,
    actions: html`<label class="search"><span class="visually-hidden">Filter activity</span><input type="search" name="q" placeholder="Filter by item, person or agent" autocomplete="off"></label>`,
  })}
  <div data-filters></div>
  <div class="activity">
    <section class="card" aria-label="Timeline" data-timeline></section>
    <div class="activity__side" data-side></div>
  </div>`);

  function draw() {
    view.querySelector('[data-filters]').innerHTML = String(chips({
      label: 'Filter activity', name: 'filter', current: filter, small: true,
      items: Object.entries(LABELS).map(([value, label]) => ({ value, label, divider: value === 'product' })),
    }));
    view.querySelector('[data-timeline]').innerHTML = String(timeline(rows, { now, person: ctx.person }, Boolean(nextBefore)));
    view.querySelector('[data-side]').innerHTML = String(html`${liveNow(side.live, allLive)}${todaySoFar(side.today)}`);
  }

  async function load() {
    const data = await ctx.hostApi.get('activity', { query: { filter, q: q || undefined, limit: Math.max(40, rows.length) } });
    if (!ctx.isCurrent()) return;
    ({ rows, nextBefore, now } = data);
    side = { today: data.today, live: data.live };
    draw();
  }

  view.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-filter]');
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (chip && chip.dataset.filter !== filter) {
      filter = chip.dataset.filter;
      rows = [];
      await load();
      view.querySelector(`[data-filter="${filter}"]`)?.focus();
    } else if (action === 'earlier' && nextBefore) {
      const count = rows.length;
      const data = await ctx.hostApi.get('activity', { query: { filter, q: q || undefined, before: nextBefore } });
      if (!ctx.isCurrent()) return;
      rows = [...rows, ...data.rows];
      nextBefore = data.nextBefore;
      draw();
      view.querySelectorAll('.timeline__row')[count]?.scrollIntoView({ block: 'center' });
    } else if (action === 'all-live') {
      allLive = true;
      draw();
    }
  }, { signal: ctx.signal });

  let typing = null;
  view.querySelector('input[name="q"]').addEventListener('input', (event) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      q = event.target.value.trim();
      rows = [];
      load().catch((err) => err?.name !== 'AbortError' && console.error(err));
    }, 250);
  }, { signal: ctx.signal });

  await load();
  onChange(ctx, load);
}
