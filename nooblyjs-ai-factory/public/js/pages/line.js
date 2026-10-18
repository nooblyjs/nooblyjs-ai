// Phase F26: the Line page. A column per station, each run in the column of its station;
// empty stations fold up. The kill switch is here too: the frame's sidebar card shows the
// factory's state as text, and a page is where a button belongs.
import { h, page, cap, word, plural, since, ago, clock, money, shortId, ACTIVE, isStopped } from '../lib.js';
import { icon, pill, statusPill, who, pageHead, tableWrap, newRun, newCampaign } from '../parts.js';

async function lineView(p) {
  const [{ s, runs, waiting }, { entries }] = await Promise.all([p.system(), p.get('inbox')]);
  const asks = new Map(entries.map((e) => [e.id, e]));
  const onLine = [...s.queued, ...s.running, ...s.parked];
  const at = (id) => [...s.running, ...s.parked].filter((r) => r.station === id);
  const run = (r) => p.href(`/runs/${r.id}`);

  const queuedCard = (r) => h('a.job', { href: run(r) },
    h('div.job-top', {}, h('span.mono', {}, shortId(r.id)), pill(`Waiting · ${since(r.queuedAt)}`, '', 'plain')),
    h('div.t', {}, r.title),
    h('div.why', {}, cap(r.waiting)));
  const runningCard = (r) => h('a.job.running', { href: run(r) },
    h('div.job-top', {}, h('span.mono', {}, shortId(r.id)), statusPill(r)),
    h('div.t', {}, r.title),
    r.lastLine && h('div.tail', { title: r.lastLine }, r.lastLine.replace(/^│\s*/, '').replace(/^● /, '')),
    h('div.foot', {}, h('span.num', {}, icon('clock'), clock(r.startedAt)), h('span.num', {}, `${money(r.costUsd)} so far`)));
  const parkedCard = (r) => {
    const ask = asks.get(r.parkedOn);
    const approve = ask && ask.kind === 'approval' && p.can('approve') && h('button.primary.small', { onclick: p.act(() => p.post(`inbox/${ask.id}`, { decision: 'approved' })) }, icon('check'), 'Approve');
    return h('div.job.needs', {},
      h('div.job-top', {}, h('a.mono', { href: run(r) }, shortId(r.id)), statusPill(r)),
      h('a.t', { href: run(r), style: 'color:inherit' }, r.title),
      h('div.why', {}, r.status === 'paused' ? 'Paused after its station. Resume it from the run page.' : ask?.title ?? 'Waiting for a person.'),
      r.status === 'parked' && h('div.btns', {}, approve, h('a.btn.small', { href: p.href('/inbox') }, approve ? 'Read more' : 'Open inbox')));
  };

  const column = (label, cards, route) => cards.length
    ? h('section.station', { 'aria-label': `${label}: ${cards.length}` }, h('div.station-head', {}, h('span.eyebrow', {}, label), h('span.tally', {}, cards.length)), route && who(route, 30), cards)
    : h('section.station.folded', { 'aria-label': `${label}: empty` }, h('span.n', {}, '0'), h('span.eyebrow', {}, label));

  const cols = [column('Queued', [...s.queued.map(queuedCard), ...s.parked.filter((r) => !r.station).map(parkedCard)])];
  for (const st of s.line) {
    const here = at(st.id);
    const route = here.find((r) => r.status === 'running' && r.route)?.route;
    cols.push(column(st.id, here.map((r) => (r.status === 'running' ? runningCard(r) : parkedCard(r))), route));
  }

  const today = new Date().toDateString();
  const finished = runs.filter((r) => !ACTIVE.includes(r.status) && r.endedAt && new Date(r.endedAt).toDateString() === today);
  const needs = s.parked.filter((r) => r.status === 'parked').length;
  const state = s.stopped ? 'The factory is stopped: nothing new starts until someone resumes it. ' : '';
  const sub = state + (onLine.length
    ? `${cap(plural(onLine.length, 'run'))} on the line. ${needs ? `${cap(word(needs))} ${needs === 1 ? 'is' : 'are'} waiting for you.` : waiting ? 'Something in the inbox needs a look.' : 'Nothing is waiting for you.'}`
    : `Nothing on the line right now. ${finished.length ? `${cap(plural(finished.length, 'run'))} finished today.` : ''}`);

  const killSwitch = p.can('approve') && (s.stopped
    ? h('button.primary', { onclick: p.act(() => p.post('resume-all')) }, icon('play'), 'Resume all runs')
    : h('button.danger-outline', { onclick: p.act(() => confirm('Stop everything? Running agents are interrupted.') && p.post('stop-all')) }, icon('stop'), 'Stop all runs'));

  return [
    pageHead('The line', sub, killSwitch, h('button', { onclick: newCampaign(p) }, icon('flag'), 'New campaign'), h('button.primary', { onclick: newRun(p) }, icon('plus'), 'New run')),
    h('div.board', { tabindex: 0, role: 'region', 'aria-label': 'Stations' }, cols),
    h('p.note', {}, 'Empty stations fold up so the work in progress gets the room.'),
    h('div.section-head', {}, h('h2', {}, 'Finished today'), h('a', { href: p.href('/runs') }, 'All runs')),
    tableWrap('Finished today', {}, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Run'), h('th', {}, 'Title'), h('th', {}, 'Outcome'), h('th.r', {}, 'Cost'), h('th.r', {}, 'Queued'))),
      h('tbody', {}, finished.length
        ? finished.slice(0, 10).map((r) => h('tr', {}, h('td.id', {}, h('a', { href: run(r) }, shortId(r.id))), h('td.title', {}, r.title), h('td', {}, isStopped(r) ? pill(`Stopped at ${r.station ?? 'start'}`, r.status === 'cancelled' ? '' : 'danger') : statusPill(r)), h('td.r.num', {}, money(r.costUsd)), h('td.r.muted', {}, ago(r.queuedAt))))
        : h('tr.empty-row', {}, h('td', { colspan: 5 }, 'Nothing has finished today yet.'))))),
  ];
}

export const render = page(lineView);
