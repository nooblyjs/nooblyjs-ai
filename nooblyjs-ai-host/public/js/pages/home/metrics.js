// Home · Metrics (product.md §5.2 and §8, mockup noobly-platform-metrics): how fast ideas become merged code, what it
// costs, and who does the work. Every number comes from GET /api/v1/home/metrics, which computes it from the event
// log; nothing on this page is a constant. The charts are HTML and CSS, each with the same numbers as a table for
// screen readers.
import { html } from '/ui/js/html.js';
import { pageHead, chips, statCard, dataTable, notice } from '/ui/js/components/index.js';
import { onChange } from './lib.js';

const HEAD = { eyebrow: 'NooblyJS · Metrics', title: 'Metrics' };
const LEAD = 'How fast ideas become merged code, what it costs, and who does the work.';
const RANGES = ['7d', '30d', 'quarter'];
const CHART_PX = 240;

const days = (n) => (n == null ? '—' : `${n.toFixed(1)} d`);
const percent = (n) => (n == null ? '—' : `${n}%`);
const dollars = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

function tiles(t) {
  return html`<section class="grid metrics__tiles" aria-label="Headline metrics">
    ${statCard({ label: 'Idea → merge', value: days(t.ideaToMerge.days), note: html`<span class="${t.ideaToMerge.changeDays > 0 ? 'metrics__good' : ''}">${t.ideaToMerge.text}</span>` })}
    ${statCard({ label: 'PRs merged', value: t.prsMerged.count, note: t.prsMerged.text })}
    ${statCard({ label: 'First-pass gates', value: percent(t.firstPass.percent), note: t.firstPass.text })}
    ${statCard({ label: 'Human edits', value: percent(t.humanEdits.percent), note: t.humanEdits.text })}
    ${statCard({ label: 'Cost per merged PR', value: t.costPerPr.usd == null ? '—' : `$${t.costPerPr.usd.toFixed(2)}`, note: t.costPerPr.text })}
  </section>`;
}

/** The top of the chart's axis: three equal steps that fit the tallest week (11.2 d → 12 d in steps of 4). */
function axisTop(max) {
  const step = [0.5, 1, 2, 4, 5, 10, 20, 40, 50, 100].find((s) => s * 3 >= max) ?? Math.ceil(max / 3);
  return step * 3;
}

function leadTime(weeks) {
  const top = axisTop(Math.max(0, ...weeks.rows.map((r) => r.totalDays ?? 0)));
  const ticks = [top, (top * 2) / 3, top / 3, 0].map((v) => (v ? `${Number.isInteger(v) ? v : v.toFixed(1)} d` : '0'));
  // Drawn from the bottom up: Build and Test to release, Engineer, Design, Product (the legend reads top down).
  const stack = [...weeks.parts].reverse();
  const columns = weeks.rows.map((row) => html`<div class="leadtime__col">${stack.map((p) => (row.parts[p.key]
    ? html`<span class="leadtime__part leadtime__part--${p.key}" style="height: ${((row.parts[p.key] / top) * CHART_PX).toFixed(1)}px"></span>` : ''))}</div>`);
  // In a wrapper: a table itself does not shrink to the 1px box that hides it.
  const table = html`<div class="visually-hidden"><table><caption>Lead time by stage, per week, in days</caption>
    <thead><tr><th scope="col">Week</th>${weeks.parts.map((p) => html`<th scope="col">${p.label}</th>`)}<th scope="col">Total</th></tr></thead>
    <tbody>${weeks.rows.map((row) => html`<tr><th scope="row">${row.label}</th>${weeks.parts.map((p) => html`<td>${row.parts[p.key] == null ? 'no visits' : row.parts[p.key].toFixed(1)}</td>`)}<td>${row.totalDays == null ? 'no visits' : row.totalDays.toFixed(1)}</td></tr>`)}</tbody></table></div>`;
  return html`<section class="card leadtime" aria-label="Lead time by stage">
    <div class="card__head"><h2 class="card__title">Lead time by stage, per week</h2>
      <ul class="legend" role="list">${weeks.parts.map((p) => html`<li><span class="legend__swatch leadtime__part--${p.key}" aria-hidden="true"></span>${p.label}</li>`)}</ul></div>
    <div class="leadtime__chart" aria-hidden="true">
      <div class="leadtime__axis">${ticks.map((t) => html`<span>${t}</span>`)}</div>
      <div class="leadtime__plot">${columns}</div>
      <span></span>
      <div class="leadtime__labels">${weeks.rows.map((row) => html`<span>${row.label}${row.totalDays == null ? '' : ` · ${row.totalDays.toFixed(1)} d`}</span>`)}</div>
    </div>
    ${table}
    <p class="leadtime__sentence">${weeks.sentence}</p>
  </section>`;
}

function spend(s) {
  const rows = s.rows.map((r) => html`<li class="spend__row"><div class="spend__head"><span>${r.label}</span><span class="mono">${dollars(r.usd)}</span></div>
      <div class="spend__track" aria-hidden="true"><div class="spend__fill" style="width: ${Math.max(1, Math.round(r.ratio * 100))}%"></div></div></li>`);
  return html`<section class="card spend" aria-label="Spend by system">
    <div class="card__head"><h2 class="card__title">Spend by system</h2><span class="card__meta">${dollars(s.totalUsd)}</span></div>
    ${rows.length ? html`<ul class="spend__list" role="list">${rows}</ul>` : html`<p class="row__meta">No agent or compute spend in this period.</p>`}
  </section>`;
}

function share(row) {
  if (row.agentPct == null) return html`<span class="row__meta">No work recorded</span>`;
  return html`<div class="share"><div class="share__bar" aria-hidden="true"><span class="share__agents" style="width: ${row.agentPct}%"></span><span class="share__people" style="width: ${row.peoplePct}%"></span></div>
    <span class="share__text">${row.agentPct}% agents · ${row.peoplePct}% people</span></div>`;
}

function stages(rows) {
  return html`<section class="card whowork" aria-label="Who does the work">
    <div class="card__head"><h2 class="card__title">Who does the work, by stage</h2>
      <ul class="legend" role="list"><li><span class="legend__swatch share__agents" aria-hidden="true"></span>Agents</li><li><span class="legend__swatch share__people" aria-hidden="true"></span>People</li></ul></div>
    ${dataTable({
    caption: 'Who does the work, by stage',
    columns: [
      { key: 'label', label: 'Stage', render: (r) => html`<strong class="whowork__name">${r.label}</strong><span class="row__meta whowork__visits">${r.visits} visit${r.visits === 1 ? '' : 's'}</span>` },
      { key: 'share', label: 'Share of work', render: share },
      { key: 'median', label: 'Median', render: (r) => html`<span class="mono">${days(r.medianDays)}</span>` },
      { key: 'p90', label: 'p90', render: (r) => html`<span class="mono${r.slowest ? ' whowork__slow' : ''}">${days(r.p90Days)}</span>${r.slowest ? html`<span class="visually-hidden"> (the longest)</span>` : ''}` },
      { key: 'sentBack', label: 'Sent back', render: (r) => (r.visits ? percent(r.sentBackPct) : html`<span class="row__meta">No visits ended</span>`) },
    ],
    rows,
  })}
  </section>`;
}

/** Phase 17: this month's agent and cloud spend by value stream, and each portfolio against its budget. */
function byValueStream(s) {
  if (!s) return '';
  const rows = s.rows.map((r) => html`<li class="spend__row"><div class="spend__head"><span>${r.portfolio ?? 'No portfolio'} › ${r.valueStream ?? 'no value stream'}</span><span class="mono">${dollars(r.totalUsd)}</span></div><p class="row__meta">Agent ${dollars(r.agentUsd)} · cloud ${dollars(r.cloudUsd)} · ${r.items.join(', ')}</p></li>`);
  const portfolios = s.portfolios.map((p) => html`<li class="spend__row"><div class="spend__head"><span>${p.name}</span><span class="mono">${dollars(p.totalUsd)}</span></div>${p.budgetUsd ? html`<div class="spend__track" aria-hidden="true"><div class="spend__fill" style="width: ${Math.min(100, Math.max(1, Math.round((p.ratio ?? 0) * 100)))}%"></div></div>` : ''}<p class="row__meta">${p.text}</p></li>`);
  return html`<section class="card spend" aria-label="Spend by value stream">
    <div class="card__head"><h2 class="card__title">Spend by value stream, this month</h2><span class="card__meta">${s.text}</span></div>
    ${portfolios.length ? html`<ul class="spend__list" role="list">${portfolios}</ul>` : ''}
    ${rows.length ? html`<ul class="spend__list" role="list">${rows}</ul>` : html`<p class="row__meta">Nothing spent this month is placed in a value stream yet.</p>`}
    <p class="row__meta">${s.unplaced.text}. Cloud: ${s.cloud.basis}.</p>
  </section>`;
}

/** Phase 16e: the pull requests waiting on a person now, by approval, with the oldest's age. */
function waiting(rows = []) {
  return html`<section class="card" aria-label="Pull requests waiting on people">
    <div class="card__head"><h2 class="card__title">Waiting on people now</h2></div>
    <ul class="spend__list" role="list">${rows.map((r) => html`<li class="spend__row"><div class="spend__head"><span>${r.label}</span><span class="mono">${r.count}</span></div><p class="row__meta">${r.text}</p></li>`)}</ul>
  </section>`;
}

export async function render(view, { ctx, query }) {
  let range = RANGES.includes(query.get('range')) ? query.get('range') : '30d';

  async function draw() {
    let data;
    try {
      data = await ctx.hostApi.get(`home/metrics?range=${range}`);
    } catch (err) {
      if (err?.name === 'AbortError' || !ctx.isCurrent()) return;
      view.innerHTML = String(html`${pageHead({ ...HEAD, lead: LEAD })}${notice({ title: 'Metrics could not be computed', text: err.message, tone: 'error' })}`);
      return;
    }
    if (!ctx.isCurrent()) return;
    const at = new Date(data.at);
    view.innerHTML = String(html`${pageHead({
      ...HEAD,
      lead: `${LEAD} ${data.range.words}.`,
      actions: chips({ label: 'Period', name: 'range', items: data.ranges.map((r) => ({ value: r.key, label: r.label })), current: data.range.key }),
    })}
    <div class="metrics">
      ${tiles(data.tiles)}
      <div class="metrics__row">${leadTime(data.weeks)}${spend(data.spend)}</div>
      ${stages(data.stages)}
      ${waiting(data.waiting)}
      ${byValueStream(data.spendByValueStream)}
      <p class="metrics__foot" role="status">Computed from the event log at ${at.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })} on ${at.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}.
        Idea → merge is the median from opening an item to its last merged PR; a stage’s numbers are over the visits that ended in the period.</p>
    </div>`);
  }

  view.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-range]');
    if (!chip || chip.dataset.range === range) return;
    range = chip.dataset.range;
    history.replaceState(history.state, '', `${location.pathname}?range=${range}`);
    draw().then(() => view.querySelector(`[data-range="${range}"]`)?.focus());
  });

  await draw();
  // Merges, approvals and stage changes move these numbers: refresh at most every few seconds while they happen.
  onChange(ctx, draw, { types: ['item.', 'approval.', 'pr.', 'gate.', 'run.', 'teammate.task_finished'], every: 5000 });
}
