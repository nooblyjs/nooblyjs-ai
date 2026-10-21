// Home · Overview (product.md §5.2, mockup noobly-platform-home): the line end to end, a card per system, what is
// waiting on you and the recent activity. Every number comes from GET /api/v1/home/overview.
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { pageHead, card, button, stageStrip, statusPill, notice } from '/ui/js/components/index.js';
import { onChange, activityRow } from './lib.js';

const HEAD = { eyebrow: 'NooblyJS · Engineering lifecycle', title: 'From idea to merged code' };

function line(lifecycle) {
  const stages = lifecycle.stages.map((s) => ({ name: s.label, count: s.count, note: s.note, href: s.href }));
  const current = lifecycle.stages.find((s) => s.key === lifecycle.current)?.label;
  return html`<section class="card" aria-label="Lifecycle">
    <div class="card__head"><h2 class="card__title">The line, end to end</h2><span class="card__meta">${lifecycle.inFlight} in flight · the busiest stage is highlighted</span></div>
    ${stageStrip({ stages, current })}
    <p class="learn" aria-label="Learn"><span aria-hidden="true">↺</span> <strong>Learn</strong> — incidents, SLO breaches, failing synthetic checks, support tickets and goal results come back to Discover as signals, linked to the item and release that caused them.</p>
    <div class="bands">
      <div class="band band--knowledge">${icon('book')}<span><strong>Knowledge Repository</strong> — every stage reads context in and writes decisions back</span></div>
      <div class="band">${icon('layers')}<span><strong>Platform</strong> — repos, containers, models, budgets and guardrails underneath</span></div>
    </div>
  </section>`;
}

const systems = (list) => html`<section class="systems" aria-label="Systems">${list.map((s) => html`<a class="system" href="${s.href}">
    <span class="system__icon" aria-hidden="true">${icon(s.icon, { size: 22, stroke: 1.7 })}</span>
    <span class="system__name">${s.label}</span>
    <span class="system__purpose">${s.purpose}</span>
    <span class="system__stats">${s.stats.map((t) => html`<span>${t}</span>`)}</span>
  </a>`)}</section>`;

function waiting(lifecycle) {
  const rows = lifecycle.waiting.map((w) => html`<li class="wait">
      ${statusPill({ text: w.tag, tone: w.tone, dot: false })}
      <div class="wait__main"><a class="wait__title" href="${w.href}">${w.title}</a><span class="row__meta">${w.context ?? w.line}</span></div>
      ${button({ label: 'Review', kind: 'secondary', small: true, href: w.href, attrs: { 'aria-label': `Review ${w.title}` } })}
    </li>`);
  return html`<section class="card" aria-label="Waiting on you">
    <div class="card__head"><h2 class="card__title">Waiting on you</h2><a href="/home/approvals">All approvals</a></div>
    ${rows.length ? html`<ul class="waits" role="list">${rows}</ul>` : html`<p class="row__meta">Nothing is waiting on you. Decisions that need you will appear here.</p>`}
  </section>`;
}

const recent = (rows, opts) => html`<section class="card" aria-label="Recent activity">
    <div class="card__head"><h2 class="card__title">Recent activity</h2><a href="/home/activity">Full log</a></div>
    ${rows.length ? html`<div class="timeline">${rows.map((r) => activityRow(r, opts))}</div>` : html`<p class="row__meta">Nothing has happened yet.</p>`}
  </section>`;

export async function render(view, { ctx, note }) {
  async function draw() {
    const data = await ctx.hostApi.get('home/overview');
    if (!ctx.isCurrent()) return;
    const { lifecycle } = data;
    const head = pageHead({
      ...HEAD,
      lead: lifecycle?.summary ?? 'The lifecycle engine is not running, so items and approvals are not shown.',
      actions: button({ label: 'New idea', icon: 'plus', href: '/product/board' }),
    });
    const missing = notice({ title: 'The lifecycle engine is not running', text: 'Items, stages and approvals come from the lifecycle engine, which is part of NooblyJS. It did not start: check the NooblyJS log.', tone: 'error' });
    view.innerHTML = String(html`${head}${note ?? ''}${lifecycle ? line(lifecycle) : missing}${systems(data.systems)}
      <div class="split">${lifecycle ? waiting(lifecycle) : ''}${recent(data.recent, { now: data.now, person: ctx.person })}</div>`);
  }
  await draw();
  onChange(ctx, draw);
}
