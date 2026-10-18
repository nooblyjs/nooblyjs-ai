// Phase F26: Metrics. Delivery figures and a table of stations, over 7 days, 30 days or all time.
import { h, page, cap, human, money, pct, fmtDur, ACTIVE } from '../lib.js';
import { empty, icon, meter, pageHead, tableWrap, tile } from '../parts.js';

const PERIODS = [['7d', '7 days'], ['30d', '30 days'], ['2000-01-01', 'All time']];
let period = '7d';

async function metricsView(p) {
  await p.system();
  const segmented = h('div.segmented', { role: 'group', 'aria-label': 'Period' }, PERIODS.map(([id, label]) => h('button', { 'aria-pressed': period === id ? 'true' : 'false', onclick: () => ((period = id), p.redraw({ force: true })) }, label)));
  let m;
  try {
    m = await p.get(`metrics?since=${encodeURIComponent(period)}`);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return [pageHead('Metrics', `Not available: ${error.message}`, segmented)];
  }
  // A fresh factory: say so, instead of a wall of dashes and zeros.
  if (!m.runs) {
    return [
      pageHead('Metrics', period === '2000-01-01' ? 'Delivery figures for every run.' : `Delivery figures for the last ${PERIODS.find(([id]) => id === period)[1]}.`, segmented),
      empty(period === '2000-01-01' ? 'No runs yet' : 'No runs in this period', 'When a run finishes, its lead time, its gate results and its cost are counted here. A handoff approved in NooblyJS starts runs; so does factory submit.'),
    ];
  }
  const st = m.stations;
  const slowest = st.toSorted((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0))[0];
  const priciest = st.toSorted((a, b) => b.costUsd - a.costUsd)[0];
  const failing = st.toSorted((a, b) => b.failures - a.failures)[0];
  const merged = m.statuses.merged ?? 0;
  const delivered = (m.statuses.delivered ?? 0) + merged;
  const finished = Object.entries(m.statuses).filter(([k]) => !ACTIVE.includes(k)).reduce((n, [, v]) => n + v, 0);
  const noMerges = 'no merges yet';
  const tiles = [
    ['runs', String(m.runs), `${finished} finished`],
    ['PRs delivered a day', m.deliveredPerDay.toFixed(1)],
    ['lead time to PR', fmtDur(m.leadTimeToPr.p50Ms), m.leadTimeToPr.p50Ms == null ? 'no PRs yet' : 'median'],
    ['lead time to merge', fmtDur(m.leadTimeToMerge.p50Ms), m.leadTimeToMerge.p50Ms == null ? noMerges : 'median'],
    ['first-pass gates', pct(m.firstPassGateRate), m.firstPassGateRate == null ? 'no checks yet' : null],
    ['PR acceptance', pct(m.prAcceptanceRate), `${merged} of ${delivered} merged`],
    ['human edits before merge', pct(m.humanEditRate), m.humanEditMeasured ? `${m.humanEditMeasured} merge(s) measured` : noMerges],
    ['escalations', pct(m.escalationRate)],
    ['cost per merged PR', m.costPerMergedPr == null ? '—' : money(m.costPerMergedPr), m.costPerMergedPr == null ? noMerges : `all spend ${money(m.costUsd)}`],
  ];
  const sub = `Since ${new Date(m.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.${slowest && priciest ? ` ${human(slowest.id)} is the slowest station; ${priciest.id} costs the most.` : ' No stations have run in this period.'}`;
  const max = Math.max(1, ...st.map((x) => x.p50Ms ?? 0));
  const callout = (ic, tone, label, value) => h('div.callout', {}, h(`span.badge${tone ? `.${tone}` : ''}`, { 'aria-hidden': 'true' }, icon(ic)), h('div', {}, h('div.l', {}, label), h('div.v', {}, value)));
  return [
    pageHead('Metrics', sub, segmented),
    h('div.eyebrow', { style: 'margin-bottom:12px' }, 'Delivery'),
    h('div.tiles', {}, tiles.map(([l, v, hint]) => tile(cap(l), v, hint))),
    st.length > 0 && h('div.callouts', {},
      callout('clock', '', 'Slowest station', `${human(slowest.id)} · ${fmtDur(slowest.p50Ms)}`),
      callout('chart', '', 'Priciest station', `${human(priciest.id)} · ${money(priciest.costUsd)}`),
      failing.failures ? callout('warn', 'danger', 'Most failures', failing.failures <= failing.runs ? `${human(failing.id)} · ${failing.failures} of ${failing.runs}` : `${human(failing.id)} · ${failing.failures} failed tries in ${failing.runs} runs`) : callout('check', '', 'Failures', 'None in this period')),
    tableWrap('Stations', { style: st.length ? '' : 'margin-top:28px' },
      h('div.card-head', { style: 'padding:20px 20px 12px;margin:0' }, h('h2', {}, 'Stations'), h('span.muted', { style: 'font-size:13px' }, 'Sorted by median time')),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Station'), h('th.r', {}, 'Runs'), h('th', {}, 'Median time'), h('th.r', {}, h('span.sr', {}, 'Median')), h('th.r', {}, 'p90'), h('th.r', {}, 'Cost'), h('th.r', {}, 'Failures'))),
        h('tbody', {}, st.length
          ? st.toSorted((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0)).map((x) => h('tr', {},
            h('td.title', {}, human(x.id)), h('td.r.num', {}, x.runs),
            h('td.bar-cell', {}, meter((x.p50Ms ?? 0) / max, `${human(x.id)} median ${fmtDur(x.p50Ms)}`)),
            h('td.r.num', {}, fmtDur(x.p50Ms)), h('td.r.num.muted', {}, fmtDur(x.p90Ms)), h('td.r.num', {}, money(x.costUsd)),
            h('td.r', {}, x.failures ? h('span.fail-count', {}, x.failures) : h('span.muted', {}, '0'))))
          : h('tr.empty-row', {}, h('td', { colspan: 7 }, 'No station has run in this period.'))))),
  ];
}

export const render = page(metricsView);
