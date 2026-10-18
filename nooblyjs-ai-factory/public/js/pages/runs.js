// Phase F26: the Runs page. Recent runs, filtered by state and searched by title or id.
import { h, page, cap, word, plural, day, ago, money, shortId, ACTIVE, DELIVERED, isStopped } from '../lib.js';
import { icon, statusPill, where, pageHead, tableWrap, newRun } from '../parts.js';

const runsState = { filter: 'all', query: '' };
const RUN_FILTERS = [['all', 'All', () => true], ['active', 'In progress', (r) => ACTIVE.includes(r.status)], ['delivered', 'Delivered', (r) => DELIVERED.includes(r.status)], ['stopped', 'Stopped', isStopped]];

async function runsView(p) {
  const { runs } = await p.system();
  const stopped = runs.filter(isStopped);
  const stations = Object.entries(Object.groupBy(stopped, (r) => r.station ?? 'before triage')).sort((a, b) => b[1].length - a[1].length).slice(0, 2).map(([k]) => k);
  const first = runs.at(-1)?.queuedAt;
  const sub = runs.length
    ? `${cap(plural(runs.length, 'run'))}${first ? ` since ${day(first)}` : ''}.${stopped.length ? ` ${cap(word(stopped.length))} stopped before delivering, mostly in ${stations.join(' and ')}.` : ' None stopped before delivering.'}`
    : 'No runs yet. Start one and it shows up here.';

  const table = h('div');
  const draw = () => {
    const [, , test] = RUN_FILTERS.find(([id]) => id === runsState.filter);
    const q = runsState.query.trim().toLowerCase();
    const shown = runs.filter((r) => test(r) && (!q || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)));
    table.replaceChildren(
      tableWrap('Runs', {}, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Run'), h('th', {}, 'Status'), h('th', {}, 'Where'), h('th', {}, 'Title'), h('th.r', {}, 'Cost'), h('th.r', {}, 'Queued'), h('th', {}, h('span.sr', {}, 'Actions')))),
        h('tbody', {}, shown.length
          ? shown.map((r) => h('tr', {},
            h('td.id', {}, h('a', { href: p.href(`/runs/${r.id}`) }, shortId(r.id))),
            h('td', {}, statusPill(r)),
            h(`td${DELIVERED.includes(r.status) ? '.muted' : ''}`, {}, where(r)),
            h('td.title', {}, r.title),
            h('td.r.num', {}, r.status === 'queued' && !r.costUsd ? '—' : money(r.costUsd)),
            h('td.r.muted', { style: 'white-space:nowrap' }, ago(r.queuedAt)),
            h('td.r', {}, isStopped(r) && p.can('draft') && h('button.small', { onclick: p.act(() => p.post(`runs/${r.id}/retry`)), 'aria-label': `Retry ${r.title}` }, icon('retry'), 'Retry'))))
          : h('tr.empty-row', {}, h('td', { colspan: 7 }, q ? `No runs match "${runsState.query}".` : 'No runs here.'))))),
      h('p.note', {}, `Showing ${shown.length} of ${runs.length} · costs are per run, all stations included`),
    );
  };
  draw();

  const filters = h('div.filters', { role: 'group', 'aria-label': 'Filter runs' }, RUN_FILTERS.map(([id, label, test]) => h('button', {
    'aria-pressed': runsState.filter === id ? 'true' : 'false',
    onclick: (e) => {
      runsState.filter = id;
      for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false');
      draw();
    },
  }, label, h('span.num', {}, runs.filter(test).length))));
  const search = h('label.search', {}, icon('search'), h('span.sr', {}, 'Search runs'), h('input', { id: 'factory-run-search', type: 'search', placeholder: 'Search by title or run ID', value: runsState.query, oninput: (e) => ((runsState.query = e.target.value), draw()) }));

  return [pageHead('Runs', sub, h('button.primary', { onclick: newRun(p) }, icon('plus'), 'New run')), h('div.toolbar', {}, filters, search), table];
}

export const render = page(runsView);
