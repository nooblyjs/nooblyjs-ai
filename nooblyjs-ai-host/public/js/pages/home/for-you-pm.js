// For you · Product manager (mockup noobly-for-you-product-manager): what is waiting on you, your items by stage,
// the top customer signals and the agent drafting for you.
import { html } from '/ui/js/html.js';
import { createApi } from '/ui/js/api.js';
import { button, statusPill, swimlane, meter } from '/ui/js/components/index.js';
import { initials } from '/ui/js/format.js';

const STAGES = [['discover', 'Disc.'], ['product', 'Product'], ['design', 'Design'], ['engineer', 'Eng.'], ['build', 'Build'], ['test', 'Test'], ['release', 'Rel.'], ['operate', 'Ops']].map(([key, label]) => ({ key, label }));

function waiting(rows) {
  const row = (w) => {
    const action = w.kind === 'nudge'
      ? button({ label: 'Nudge', kind: 'secondary', small: true, attrs: { 'data-action': 'nudge', 'data-id': w.itemId, 'aria-label': `Nudge about ${w.title}` } })
      : button({ label: w.action, kind: w.kind === 'review' ? 'primary' : 'secondary', small: true, href: w.href, attrs: { 'aria-label': `${w.action} ${w.title}` } });
    return html`<li class="wait">${statusPill({ text: w.tag, tone: w.tone, dot: false })}<div class="wait__main">${w.href ? html`<a class="wait__title" href="${w.href}">${w.title}</a>` : html`<span class="wait__title">${w.title}</span>`}<span class="row__meta">${w.context}</span></div>${action}</li>`;
  };
  return html`<section class="card" aria-label="Waiting on you">
    <div class="card__head"><h2 class="card__title">Waiting on you</h2><a href="/home/approvals">All approvals</a></div>
    ${rows.length ? html`<ul class="waits" role="list">${rows.map(row)}</ul>` : html`<p class="row__meta">Nothing is waiting on you, and none of your items is stuck.</p>`}
  </section>`;
}

const items = (rows) => html`<section class="card card--flush" aria-label="Your items">
    <div class="card__head"><h2 class="card__title">Your items</h2><a href="/home/lifecycle?filter=mine">Open Lifecycle</a></div>
    ${rows.length
    ? swimlane({ rows: rows.map((r) => ({ title: r.title, id: r.ref, href: r.href, age: r.age, late: r.late, cells: r.cells })), stages: STAGES, caption: 'Your items, by stage' })
    : html`<p class="row__meta card__pad">You have no items in flight. Start one from the Product board.</p>`}
  </section>`;

const agent = (a) => (a ? html`<section class="agent-card" aria-label="Your agent">
    <div class="agent-card__who"><span class="avatar avatar--agent" aria-hidden="true">${initials(a.name)}</span><div><span class="agent-card__title">${a.title}</span><span class="agent-card__text">${a.text}</span></div></div>
    ${a.progress === null ? '' : meter({ label: a.text, value: `${Math.round(a.progress * 100)}%`, ratio: a.progress, tone: 'live' })}
    <a class="agent-card__action" href="${a.action.href}">${a.action.label}</a>
  </section>` : '');

export function panels(data) {
  return {
    main: html`${waiting(data.panels.waiting)}${items(data.panels.items)}`,
    side: html`<section class="card card--side" aria-label="Top signals" data-signals><div class="card__head"><h2 class="card__title card__title--small">Top signals this week</h2><a href="/product/board">Board</a></div><p class="row__meta" role="status">Loading…</p></section>${agent(data.panels.agent)}`,
  };
}

/** Signals belong to the Product Factory: the tile and the panel are filled from its API, in the browser. */
export async function after(view, { ctx }) {
  const panel = view.querySelector('[data-signals]');
  const tile = view.querySelector('[data-tile="signals"]');
  const say = (text) => {
    if (panel) panel.querySelector('[role="status"]').textContent = text;
    if (tile) tile.querySelector('.tile__note').textContent = text;
  };
  let signals;
  try {
    ({ signals } = await createApi('/product/api/v1', { signal: ctx.signal }).get('signals'));
  } catch (err) {
    if (err?.name !== 'AbortError') say('The Product Factory is not running here, so there are no signals to show.');
    return;
  }
  if (!ctx.isCurrent() || !panel?.isConnected) return;
  const total = signals.reduce((sum, s) => sum + (s.count ?? 0), 0);
  tile.querySelector('.tile__value').textContent = total.toLocaleString('en-ZA');
  tile.querySelector('.tile__note').textContent = `${signals.length} theme${signals.length === 1 ? '' : 's'} on the board`;
  const top = signals.slice(0, 3);
  const max = Math.max(1, ...top.map((s) => s.count ?? 0));
  panel.querySelector('[role="status"]').outerHTML = String(top.length
    ? html`<ul class="signals">${top.map((s) => html`<li><div class="signals__head"><span>${s.theme ?? s.title}</span><span class="signals__count">${s.count}</span></div><div class="signals__track"><div class="signals__fill" style="width: ${Math.round(((s.count ?? 0) / max) * 100)}%"></div></div></li>`)}</ul>`
    : html`<p class="row__meta">No signals on the board yet.</p>`);
}
