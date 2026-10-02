// Phase F17: the dashboard's code. Plain modules, no framework.
//
//   state   comes from the JSON API (the event log's projections)
//   live    one EventSource on /api/events: any new event → re-render the current view (debounced)
//   safety  every piece of text goes in with textContent (h() below), never innerHTML:
//           agent output and issue text are untrusted, and this page has buttons that act
//
// The token arrives in the URL fragment (#token=…), which browsers never send to servers
// or put in Referer headers; it's moved to sessionStorage and removed from the address bar.

const view = document.getElementById('view');
const tokenFromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (tokenFromHash) {
  sessionStorage.setItem('factory-token', tokenFromHash);
  history.replaceState(null, '', `${location.pathname}#/`);
}
const token = sessionStorage.getItem('factory-token') ?? '';

// ---- helpers ------------------------------------------------------------------------------------

/** h('div.card', { onclick }, 'text', child…): an element, safely. */
function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'className') el.className += ` ${v}`;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
/** An SVG element (icons, avatars). Attributes only, no text. */
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children.flat().filter(Boolean));
  return el;
}
// The token goes in X-Factory-Token, not Authorization: proxies such as Cloud Shell's web preview take that header for their own login.
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, { ...options, headers: { 'x-factory-token': token, ...(options.body && { 'content-type': 'application/json' }) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}
const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
const money = (n) => `$${(n ?? 0).toFixed(n >= 1 ? 2 : 4)}`;
const money2 = (n) => `$${(n ?? 0).toFixed(2).replace(/\.00$/, '')}`;
const since = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const ago = (iso) => (iso ? `${since(iso)} ago` : '');
const fmtDur = (ms) => (ms == null ? '—' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
const secs = (a, b) => (a ? `${Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000)}s` : '');
const clock = (a) => {
  const t = Math.max(0, Math.round((Date.now() - Date.parse(a)) / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const human = (id) => cap(String(id ?? '').replace(/[-_]/g, ' '));
const shortId = (id) => String(id).slice(-10);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => WORDS[n] ?? String(n);
const plural = (n, one, many = `${one}s`) => `${word(n)} ${n === 1 ? one : many}`;

const ACTIVE = ['queued', 'running', 'parked', 'paused'];
const DELIVERED = ['delivered', 'merged'];
const isStopped = (r) => !ACTIVE.includes(r.status) && !DELIVERED.includes(r.status);

const act = (fn) => async (e) => {
  e.preventDefault();
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await fn();
    await render();
  } catch (error) {
    alert(error.message);
  } finally {
    btn.disabled = false;
  }
};

// ---- icons, avatars, pills ----------------------------------------------------------------------

const ICONS = {
  line: 'M4 4h4v16H4z M10 4h4v10h-4z M16 4h4v6h-4z',
  runs: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  inbox: 'M3 13l3-8h12l3 8v6H3z M3 13h5l1 3h6l1-3h5',
  flag: 'M5 21V4 M5 4h11l-2.5 4L16 12H5',
  chart: 'M4 20h16 M7 16v-5 M12 16V7 M17 16v-8',
  plus: 'M12 5v14 M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M7 7l10 10 M17 7L7 17',
  retry: 'M4 12a8 8 0 1 0 2.3-5.6 M4 4v4h4',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3 2',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-4-4',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  file: 'M14 3H6v18h12V7z M14 3v4h4',
  warn: 'M12 3.5L2.5 20h19z M12 10v4 M12 17h.01',
  stop: 'M6 6h12v12H6z',
  cpu: 'M8 8h8v8H8z M10 3v3 M14 3v3 M10 18v3 M14 18v3 M3 10h3 M3 14h3 M18 10h3 M18 14h3',
  book: 'M6 3h12v18H6z M9 3v18',
  branch: 'M6 3v12 M6 21a2 2 0 1 0 0-4a2 2 0 1 0 0 4z M18 9a2 2 0 1 0 0-4a2 2 0 1 0 0 4z M18 9c0 6-12 3-12 8',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 5l12 7-12 7z',
};
const icon = (name) => s('svg', { class: 'i', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: ICONS[name] }));

const HAIR = {
  bob: 'M15 31 C15 18 22 12 32 12 C42 12 49 18 49 31 L49 40 L44 40 L44 26 C40 23 24 23 20 26 L20 40 L15 40 Z',
  antenna: 'M17 27 C18 18 25 14 32 14 C39 14 46 18 47 27 C40 22 24 22 17 27 Z M31 14 L31 7 L33 7 L33 14 Z M29.5 5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 Z',
  bun: 'M18 26 C19 18 25 15 32 15 C39 15 45 18 46 26 C39 21 25 21 18 26 Z M27 10 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 Z',
  quiff: 'M16 29 C15 18 24 12 34 13 C43 14 49 21 48 29 C42 21 30 19 22 25 C20 26 18 28 16 29 Z',
  crop: 'M17 28 C17 19 24 14 32 14 C40 14 47 19 47 28 C44 22 38 20 32 20 C26 20 20 22 17 28 Z',
};
const PAIRS = [['#FFD7C2', '#7A2E14'], ['#CDE7E4', '#1E5E63'], ['#E5DAF5', '#4B2E83'], ['#FBE6A6', '#6B4E00'], ['#F6CFD8', '#8A2440'], ['#D6E4FA', '#1F4A8A'], ['#DCE8C8', '#3D5A1E'], ['#EED9C4', '#6A3F1F']];
/** Each built-in role has its own face; any other role gets one from its name. */
const ROLE_LOOK = { triager: [1, 'crop'], 'spec-writer': [3, 'bun'], builder: [0, 'quiff'], reviewer: [2, 'bob'], 'security-reviewer': [6, 'antenna'], integrator: [5, 'crop'], fixer: [4, 'bun'], retro: [7, 'antenna'] };
function lookOf(role) {
  if (ROLE_LOOK[role]) return ROLE_LOOK[role];
  let n = 0;
  for (const ch of String(role)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return [n % PAIRS.length, Object.keys(HAIR)[n % 5]];
}
function avatar(role, size = 32) {
  const [pair, hair] = lookOf(role);
  const [bg, deep] = PAIRS[pair];
  const face = [
    s('path', { d: 'M10 64 C12 51 21 46 32 46 C43 46 52 51 54 64 Z', fill: deep }),
    s('circle', { cx: 32, cy: 31, r: 15, fill: '#FFF8F2' }),
    s('path', { d: HAIR[hair], fill: deep }),
    s('circle', { cx: 27, cy: 32, r: 1.8, fill: '#241C1A' }),
    s('circle', { cx: 37, cy: 32, r: 1.8, fill: '#241C1A' }),
    size >= 40 && s('circle', { cx: 23.5, cy: 36.5, r: 2.4, fill: bg }),
    size >= 40 && s('circle', { cx: 40.5, cy: 36.5, r: 2.4, fill: bg }),
    s('path', { d: 'M27.5 37.5 Q32 41 36.5 37.5', stroke: '#241C1A', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' }),
  ];
  return h('span.avatar', { style: `width:${size}px;height:${size}px;background:${bg}`, 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 64 64' }, face));
}

/** claude-sonnet-5-5 → Sonnet 5.5, coloured by tier (light / balanced / premium). */
function modelOf(route) {
  const id = String(route?.model ?? '');
  const m = /(haiku|sonnet|opus|fable)-?(\d+)?-?(\d+)?/i.exec(id);
  const name = m ? `${cap(m[1].toLowerCase())}${m[2] ? ` ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ''}` : ''}` : id || 'Default model';
  const tier = route?.tier ?? (/haiku/i.test(id) ? 'light' : /opus|fable/i.test(id) ? 'premium' : 'balanced');
  const colour = { light: 'var(--tier-light)', balanced: 'var(--tier-balanced)', premium: 'var(--tier-premium)' }[tier] ?? 'var(--tier-balanced)';
  return { name, colour };
}
const modelChip = (route) => {
  const m = modelOf(route);
  return h('span.chip', {}, icon('cpu'), h('i.dot', { style: `background:${m.colour}`, 'aria-hidden': 'true' }), m.name);
};
const who = (route, size = 32) => route && h('span.who', {}, avatar(route.role, size), human(route.role), modelChip(route));

const VERB = { triage: 'Triaging', spec: 'Writing the spec', approve: 'Approving', build: 'Building', verify: 'Verifying', review: 'Reviewing', security: 'Security check', repair: 'Repairing', deliver: 'Delivering', merge: 'Merging' };
/** A run's status as a person would say it, and its colour. */
function statusOf(r) {
  switch (r.status) {
    case 'running': return [VERB[r.station] ?? 'Running', 'accent'];
    case 'parked': return ['Needs you', 'warn'];
    case 'paused': return ['Paused', ''];
    case 'queued': return ['Waiting', ''];
    case 'delivered': return ['Delivered', 'teal'];
    case 'merged': return ['Merged', 'teal'];
    case 'cancelled': return ['Cancelled', ''];
    case 'no_changes': return ['No changes', ''];
    case 'agent_failed': return ['Agent failed', 'danger'];
    case 'gate_failed': return ['Checks failed', 'danger'];
    default: return [human(r.status), 'danger'];
  }
}
const pill = (label, tone = '', extra = '') => h(`span.pill${tone ? `.${tone}` : ''}${extra ? `.${extra}` : ''}`, {}, label);
const statusPill = (r, extra) => pill(...statusOf(r), extra);
const where = (r) => (ACTIVE.includes(r.status) ? `At ${r.station ?? 'queued'}` : DELIVERED.includes(r.status) ? human(r.station ?? 'deliver') : (r.station ? `Stopped at ${r.station}` : 'Stopped before triage'));
const meter = (fraction, label) => h('div.meter', { role: 'img', 'aria-label': label }, h('i', { style: `width:${Math.min(100, Math.max(0, fraction * 100)).toFixed(1)}%` }));

function pageHead(title, sub, ...actions) {
  return h('div.page-head', {}, h('div', {}, h('h1', {}, title), sub && h('p.sub', {}, sub)), actions.some(Boolean) ? h('div.actions', {}, actions.filter(Boolean)) : null);
}

/** Starting work happens in the terminal: show the command, with a copy button. */
function showCommand(title, text, command) {
  const dialog = document.getElementById('dialog');
  dialog.replaceChildren(
    h('h2', {}, title),
    h('p', {}, text),
    codeBlock(command),
    h('div.btns', {}, h('button.primary', { onclick: () => dialog.close() }, 'Done')),
  );
  dialog.showModal();
}
function codeBlock(command) {
  const btn = h('button.icon-btn', { 'aria-label': 'Copy command', onclick: () => copy(command, btn) }, icon('copy'));
  return h('div.code', {}, h('code', {}, command), btn);
}
async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.setAttribute('aria-label', 'Copied');
    btn.replaceChildren(icon('check'));
    setTimeout(() => (btn.setAttribute('aria-label', 'Copy'), btn.replaceChildren(icon('copy'))), 1500);
  } catch {
    alert('Copy failed: select the text and copy it yourself.');
  }
}
const NEW_RUN = () => showCommand('Start a run', 'Runs start from an issue file. Queue one from a terminal and factory serve picks it up.', 'factory submit issue.md --repo <path>');
const NEW_CAMPAIGN = () => showCommand('Start a campaign', 'Write the change once as a spec, then open a run for each repo from a terminal.', 'factory campaign create --name <name> --spec campaign.md --repos a,b');

// ---- the sidebar: system state --------------------------------------------------------------

let dismissed = new Set();
try {
  dismissed = new Set(JSON.parse(localStorage.getItem('factory-dismissed') ?? '[]'));
} catch {}
const dismissKey = (r) => `${r.id}#${r.attempt ?? 1}`;
function dismiss(r) {
  dismissed.add(dismissKey(r));
  try {
    localStorage.setItem('factory-dismissed', JSON.stringify([...dismissed].slice(-200)));
  } catch {}
}
/** Runs that stopped in the last day and nobody has looked at: the inbox shows them too. */
const stoppedToReview = (runs) => runs.filter((r) => isStopped(r) && r.status !== 'cancelled' && r.endedAt && Date.now() - Date.parse(r.endedAt) < 86_400_000 && !dismissed.has(dismissKey(r)));

let liveOn = false;
async function renderSystem() {
  const [s, { runs }] = await Promise.all([api('/status'), api('/runs?limit=100')]);
  const box = document.getElementById('system');
  const budget = s.dailyBudgetUsd ? s.spentToday / s.dailyBudgetUsd : 0;
  box.replaceChildren(...[
    h('div', {}, s.stopped ? pill('Stopped', 'danger') : pill('Accepting work', 'teal')),
    h('div', {}, h('div.label', {}, 'Running now'), h('div.big', {}, `${s.running.length} of ${s.maxConcurrent} slots · ${s.queued.length} queued`)),
    h('div', {}, h('div.row-between', {}, h('span.label', {}, 'Spent today'), h('span.num', {}, `${money2(s.spentToday)} of ${money2(s.dailyBudgetUsd)}`)), h('div', { style: 'margin-top:8px' }, meter(budget, `${Math.round(budget * 100)}% of today's budget spent`))),
    s.stopped
      ? h('button.primary.full', { onclick: act(() => post('/resume-all')) }, icon('play'), 'Resume all runs')
      : h('button.danger-outline.full', { onclick: act(() => confirm('Stop everything? Running agents are interrupted.') && post('/stop-all')) }, icon('stop'), 'Stop all runs'),
    !liveOn && h('div.live-off', {}, 'Live updates are reconnecting…'),
  ].filter(Boolean));
  const waiting = s.inbox + stoppedToReview(runs).length;
  document.getElementById('inbox-count').textContent = waiting || '';
  return { s, runs, waiting };
}

// ---- the line -----------------------------------------------------------------------------------

/** The line: a column per station, each run in the column of its station. Empty stations fold up. */
async function lineView() {
  const [{ s, runs, waiting }, { entries }] = await Promise.all([renderSystem(), api('/inbox')]);
  const asks = new Map(entries.map((e) => [e.id, e]));
  const onLine = [...s.queued, ...s.running, ...s.parked];
  const at = (id) => [...s.running, ...s.parked].filter((r) => r.station === id);

  const queuedCard = (r) => h('a.job', { href: `#/run/${r.id}` },
    h('div.job-top', {}, h('span.mono', {}, shortId(r.id)), pill(`Waiting · ${since(r.queuedAt)}`, '', 'plain')),
    h('div.t', {}, r.title),
    h('div.why', {}, cap(r.waiting)));
  const runningCard = (r) => h('a.job.running', { href: `#/run/${r.id}` },
    h('div.job-top', {}, h('span.mono', {}, shortId(r.id)), statusPill(r)),
    h('div.t', {}, r.title),
    r.lastLine && h('div.tail', { title: r.lastLine }, r.lastLine.replace(/^│\s*/, '').replace(/^● /, '')),
    h('div.foot', {}, h('span.num', {}, icon('clock'), clock(r.startedAt)), h('span.num', {}, `${money(r.costUsd)} so far`)));
  const parkedCard = (r) => {
    const ask = asks.get(r.parkedOn);
    const approve = ask && ask.kind === 'approval' && h('button.primary.small', { onclick: act(() => post(`/inbox/${ask.id}`, { decision: 'approved' })) }, icon('check'), 'Approve');
    return h('div.job.needs', {},
      h('div.job-top', {}, h('a.mono', { href: `#/run/${r.id}` }, shortId(r.id)), statusPill(r)),
      h('a.t', { href: `#/run/${r.id}`, style: 'color:inherit' }, r.title),
      h('div.why', {}, r.status === 'paused' ? 'Paused after its station. Resume it from the run page.' : ask?.title ?? 'Waiting for a person.'),
      r.status === 'parked' && h('div.btns', {}, approve, h('a.btn.small', { href: '#/inbox' }, approve ? 'Read more' : 'Open inbox')));
  };

  const column = (id, label, cards, route) => cards.length
    ? h('section.station', { 'aria-label': `${label}: ${cards.length}` }, h('div.station-head', {}, h('span.eyebrow', {}, label), h('span.tally', {}, cards.length)), route && who(route, 30), cards)
    : h('section.station.folded', { 'aria-label': `${label}: empty` }, h('span.n', {}, '0'), h('span.eyebrow', {}, label));

  const queuedHere = [...s.queued.map(queuedCard), ...s.parked.filter((r) => !r.station).map(parkedCard)];
  const cols = [column('queued', 'Queued', queuedHere)];
  for (const st of s.line) {
    const here = at(st.id);
    const route = here.find((r) => r.status === 'running' && r.route)?.route;
    cols.push(column(st.id, st.id, here.map((r) => (r.status === 'running' ? runningCard(r) : parkedCard(r))), route));
  }

  const today = new Date().toDateString();
  const finished = runs.filter((r) => !ACTIVE.includes(r.status) && r.endedAt && new Date(r.endedAt).toDateString() === today);
  const needs = s.parked.filter((r) => r.status === 'parked').length;
  const sub = onLine.length
    ? `${cap(plural(onLine.length, 'run'))} on the line. ${needs ? `${cap(word(needs))} ${needs === 1 ? 'is' : 'are'} waiting for you.` : waiting ? 'Something in the inbox needs a look.' : 'Nothing is waiting for you.'}`
    : `Nothing on the line right now. ${finished.length ? `${cap(plural(finished.length, 'run'))} finished today.` : ''}`;

  return [
    pageHead('The line', sub, h('button', { onclick: NEW_CAMPAIGN }, icon('flag'), 'New campaign'), h('button.primary', { onclick: NEW_RUN }, icon('plus'), 'New run')),
    h('div.board', {}, cols),
    h('p.note', {}, 'Empty stations fold up so the work in progress gets the room.'),
    h('div.section-head', {}, h('h2', {}, 'Finished today'), h('a', { href: '#/runs' }, 'All runs')),
    h('div.table-wrap', {}, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Run'), h('th', {}, 'Title'), h('th', {}, 'Outcome'), h('th.r', {}, 'Cost'), h('th.r', {}, 'Queued'))),
      h('tbody', {}, finished.length
        ? finished.slice(0, 10).map((r) => h('tr', {}, h('td.id', {}, h('a', { href: `#/run/${r.id}` }, shortId(r.id))), h('td.title', {}, r.title), h('td', {}, isStopped(r) ? pill(`Stopped at ${r.station ?? 'start'}`, r.status === 'cancelled' ? '' : 'danger') : statusPill(r)), h('td.r.num', {}, money(r.costUsd)), h('td.r.muted', {}, ago(r.queuedAt))))
        : h('tr.empty-row', {}, h('td', { colspan: 5 }, 'Nothing has finished today yet.'))))),
  ];
}

// ---- runs ---------------------------------------------------------------------------------------

const runsState = { filter: 'all', query: '' };
const RUN_FILTERS = [['all', 'All', () => true], ['active', 'In progress', (r) => ACTIVE.includes(r.status)], ['delivered', 'Delivered', (r) => DELIVERED.includes(r.status)], ['stopped', 'Stopped', isStopped]];

async function runsView() {
  const { runs } = await renderSystem();
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
      h('div.table-wrap', {}, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Run'), h('th', {}, 'Status'), h('th', {}, 'Where'), h('th', {}, 'Title'), h('th.r', {}, 'Cost'), h('th.r', {}, 'Queued'), h('th', {}, h('span.sr', {}, 'Actions')))),
        h('tbody', {}, shown.length
          ? shown.map((r) => h('tr', {},
            h('td.id', {}, h('a', { href: `#/run/${r.id}` }, shortId(r.id))),
            h('td', {}, statusPill(r)),
            h(`td${DELIVERED.includes(r.status) ? '.muted' : ''}`, {}, where(r)),
            h('td.title', {}, r.title),
            h('td.r.num', {}, r.status === 'queued' && !r.costUsd ? '—' : money(r.costUsd)),
            h('td.r.muted', { style: 'white-space:nowrap' }, ago(r.queuedAt)),
            h('td.r', {}, isStopped(r) && h('button.small', { onclick: act(() => post(`/runs/${r.id}/retry`)), 'aria-label': `Retry ${r.title}` }, icon('retry'), 'Retry'))))
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
  const search = h('label.search', {}, icon('search'), h('span.sr', {}, 'Search runs'), h('input', { id: 'run-search', type: 'search', placeholder: 'Search by title or run ID', value: runsState.query, oninput: (e) => ((runsState.query = e.target.value), draw()) }));

  return [pageHead('Runs', sub, h('button.primary', { onclick: NEW_RUN }, icon('plus'), 'New run')), h('div.toolbar', {}, filters, search), table];
}

/** Why a run stopped at a station: the agent's last refusal or error says more than a bare "interrupted". */
function whyStopped(r, step, agent) {
  const refusal = agent.findLast((e) => e.step === step?.id && /denied|error|refused/i.test(e.line))?.line.replace(/^│\s*(⎿\s*)?/, '').replace(/^└\s*/, '');
  const generic = !step?.error || /^interrupted/i.test(step.error);
  if (refusal && generic) return refusal;
  if (step?.error && !generic) return cap(step.error);
  if (r.status === 'interrupted') return `The run was interrupted ${step ? `at ${step.id}` : 'before triage'}. Retry it: the stations that finished are kept.`;
  return `It stopped ${step ? `at ${step.id}` : 'before triage'} (${human(r.status).toLowerCase()}).`;
}

// ---- one run ------------------------------------------------------------------------------------

const outFilter = { run: null, step: 'all' };

/** "└ build: agent success · 1 commit(s) · gates passed · $0.0383" → "Agent success · 1 commit · gates passed" */
function summaryOf(line, step) {
  if (!line) return '';
  return cap(line.replace(/^└\s*/, '').replace(new RegExp(`^${step}:?\\s*`), '').replace(/\s*·\s*\$\d+\.\d+/, '').replace(/(\d+) commit\(s\)/, (_, n) => `${n} commit${n === '1' ? '' : 's'}`).replace(/\(s\)/g, 's').trim());
}

async function runView(id) {
  await renderSystem();
  const d = await api(`/runs/${id}`);
  const r = d.run;
  const active = ACTIVE.includes(r.status);
  const lastDone = d.steps.findLastIndex((st) => st.status === 'done');
  const stateOf = (st, i) => (st.status === 'pending' && i < lastDone ? 'skipped' : st.status === 'failed' || (st.status === 'running' && !active) ? 'failed' : st.status);
  const stopStep = isStopped(r) ? d.steps.find((st, i) => stateOf(st, i) === 'failed') ?? d.steps.find((st) => st.id === r.station) : null;

  // The headline: what happened, in a few words.
  const [label, tone] = statusOf(r);
  const headline = isStopped(r) && stopStep && r.status !== 'cancelled' ? `${label} at ${stopStep.id}` : label;

  // Retry from, Pause, Resume, Cancel.
  const firstOpen = d.steps.find((st) => st.status !== 'done')?.id;
  const from = h('select', { id: 'retry-from' }, h('option', { value: '' }, `${human(firstOpen ?? 'start')} (first unfinished)`), d.steps.map((st) => h('option', { value: st.id }, human(st.id))));
  const actions = h('div.run-actions', {},
    !active && [h('label', { for: 'retry-from' }, 'Retry from'), from, h('button.primary', { onclick: act(() => post(`/runs/${id}/retry`, { from: from.value || undefined })) }, icon('retry'), 'Retry run')],
    r.status === 'running' && h('button', { onclick: act(() => post(`/runs/${id}/pause`)) }, icon('pause'), 'Pause'),
    ['paused', 'parked'].includes(r.status) && h('button.primary', { onclick: act(() => post(`/runs/${id}/resume`)) }, icon('play'), 'Resume'),
    active && h('button.ghost.danger', { onclick: act(() => confirm('Cancel this run?') && post(`/runs/${id}/cancel`)) }, 'Cancel run'));

  // The stations, as a stepper.
  const subOf = (st, state) => {
    if (state === 'skipped') return 'skipped';
    if (state === 'failed') return r.status === 'interrupted' ? 'interrupted' : 'failed';
    if (state === 'running') return `running · ${secs(st.startedAt)}`;
    if (state !== 'done') return '';
    if (st.result?.passed === true) return 'gates passed';
    if (st.result?.passed === false) return 'gates failed';
    if (st.kind === 'approval' || st.id === 'approve') {
      const line = d.story.find((e) => e.type === 'step.finished' && e.line.startsWith(`└ ${st.id}:`))?.line ?? '';
      const level = /autonomy (\w+)/.exec(line)?.[1];
      return /by auto|automatic/.test(line) || level ? `auto${level ? ` · ${level}` : ''}` : 'approved';
    }
    return money(st.costUsd);
  };
  const stepper = h('div.card', { style: 'padding:0' }, h('ol.stepper', { style: `--n:${d.steps.length}`, 'aria-label': 'Stations' }, d.steps.map((st, i) => {
    const state = stateOf(st, i);
    return h(`li.${state}`, {}, h('span.node', { 'aria-hidden': 'true' }, state === 'done' ? icon('check') : state === 'failed' ? icon('x') : null), h('span.name', {}, human(st.id)), h('span.sub', {}, subOf(st, state) || ' '), h('span.sr', {}, state));
  })));

  // Why it stopped: the station's error, or the agent's last refusal.
  const agentOf = (step) => d.agent.filter((e) => e.step === step);
  let alertBox = null;
  if (stopStep && r.status !== 'cancelled') {
    const roleName = stopStep.route?.role ? `The ${human(stopStep.route.role).toLowerCase()}` : `The ${stopStep.id} station`;
    const title = r.status === 'interrupted' ? `${roleName} was interrupted` : `${roleName} stopped`;
    const body = whyStopped(r, stopStep, d.agent);
    alertBox = h('div.alert', { role: 'status' }, icon('warn'), h('div', {}, h('strong', {}, title), h('p.body', {}, body)), h('button.small', { onclick: act(() => post(`/runs/${id}/retry`, { from: stopStep.id })) }, `Retry from ${stopStep.id}`));
  }
  const openAsks = d.inbox.filter((e) => e.status === 'open');

  // The story: one entry per station that started.
  const started = d.steps.filter((st) => st.startedAt).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const story = h('ol.story', {}, started.map((st) => {
    const state = stateOf(st, d.steps.indexOf(st));
    const finished = d.story.findLast((e) => (e.type === 'step.finished' || e.type === 'step.failed') && e.line.startsWith(`└ ${st.id}`));
    const turn = agentOf(st.id).findLast((e) => /turn end/.test(e.line));
    const text = state === 'running' ? 'Working on it now.' : state === 'failed' && (!finished || r.status === 'interrupted') ? `${r.status === 'interrupted' ? 'Interrupted' : 'Stopped'}${turn ? ` after ${/turn end: (.*?)(, interrupted)?$/.exec(turn.line)?.[1].replace(/\(s\)/g, 's') ?? ''}` : ''}` : summaryOf(finished?.line, st.id);
    return h(`li.${state}`, {}, h('span.dot', { 'aria-hidden': 'true' }), h('time', { datetime: st.startedAt }, time(st.startedAt)),
      h('div.what', {}, h('b', {}, human(st.id)), text && h('p', {}, text), st.route && h('div', {}, who(st.route, 30))),
      h('div.nums', {}, h('span.num', {}, state === 'failed' && !st.costUsd ? '—' : money(st.costUsd)), h('span.muted.num', {}, secs(st.startedAt, st.endedAt))));
  }));
  const ran = r.startedAt ? secs(r.startedAt, r.endedAt) : '';

  // Agent output, filterable by station.
  if (outFilter.run !== id) Object.assign(outFilter, { run: id, step: 'all' });
  const stepsWithOutput = [...new Set(d.agent.map((e) => e.step))];
  const lines = d.agent.filter((e) => outFilter.step === 'all' || e.step === outFilter.step);
  const terminal = h('div.terminal', { tabindex: 0, 'aria-label': 'Agent output' }, lines.length
    ? lines.map((e) => {
      const text = e.line.replace(/^│\s?/, '').replace(/^● /, '• ').replace(/⎿/, '└');
      return h('div', { className: /denied|error/i.test(text) ? 'err' : /^turn end|^notice/.test(text) ? 'dim' : '' }, h('span.tag', {}, `[${e.step}] `), text);
    })
    : h('span.dim', {}, 'No agent output yet.'));
  const outPills = h('div.filters', { role: 'group', 'aria-label': 'Show output from' }, ['all', ...stepsWithOutput].map((st) => h('button.small', { 'aria-pressed': outFilter.step === st ? 'true' : 'false', onclick: () => ((outFilter.step = st), render()) }, st === 'all' ? 'All' : human(st))));
  const copyBtn = h('button.small.icon-btn', { 'aria-label': 'Copy output', onclick: () => copy(lines.map((e) => `[${e.step}] ${e.line}`).join('\n'), copyBtn) }, icon('copy'));

  // Checks and review findings.
  const gates = d.steps.flatMap((st) => st.result?.gates ?? []);
  const findings = d.steps.flatMap((st) => st.result?.findings?.map((f) => ({ ...f, step: st.id })) ?? []);
  const passed = (g) => /^pass/.test(g.status);
  const checks = h('div.card', {}, h('h2', {}, 'Checks'),
    gates.length
      ? gates.map((g) => h('div.check', {}, h('span', { className: passed(g) ? 'ok' : 'bad' }, icon(passed(g) ? 'check' : 'x')), h('div.grow', {}, h('span.mono', {}, g.command ?? g.name), ' ', h('span.muted', {}, g.summary ?? (passed(g) ? 'passed on a clean checkout' : 'failed on a clean checkout'))), pill(passed(g) ? 'Passed' : human(g.status), passed(g) ? 'teal' : 'danger')))
      : h('p.muted', {}, active ? 'Checks run at verify.' : 'No checks ran on this run.'),
    findings.length > 0 && [h('h3', { style: 'margin:24px 0 12px;font-size:17px' }, 'Review findings'), findings.map((f) => h('div.check', {}, pill(human(f.severity), /block|high|critical/i.test(f.severity) ? 'danger' : 'warn'), h('div.grow', {}, f.title, f.file && h('div.muted.mono', { style: 'font-size:14px' }, f.file))))]);

  const download = async (a, btn) => {
    btn.disabled = true;
    try {
      const file = await api(`/runs/${id}/artifacts/${a.sha}`);
      const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain' }));
      h('a', { href: url, download: file.name.replace(/[\\/]/g, '_') }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      alert(error.message);
    } finally {
      btn.disabled = false;
    }
  };
  const size = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
  const artifacts = h('div.card', {}, h('h2', {}, 'Artifacts'),
    d.artifacts.length
      ? d.artifacts.map((a) => {
        const btn = h('button.small.icon-btn', { 'aria-label': `Download ${a.name}` }, icon('download'));
        btn.addEventListener('click', () => download(a, btn));
        return h('div.artifact', {}, icon('file'), h('div.grow', {}, h('div.name', {}, a.kind === a.name ? a.name : `${a.kind} · ${a.name}`), h('div.sub', {}, `${size(a.bytes)} · ${a.sha}`)), btn);
      })
      : h('p.muted', {}, 'Nothing stored yet.'));

  return [
    h('div.crumbs', {}, h('a', { href: '#/runs' }, 'Runs'), ' / ', h('span.mono', {}, shortId(r.id))),
    h('div.title-row', {}, h('h1', {}, r.title), pill(headline, tone, 'big')),
    h('div.meta', {}, h('span.mono', {}, r.id), h('span', {}, `line ${r.line}`), h('span', {}, h('b.num', {}, money(r.costUsd))), h('span', {}, `queued ${ago(r.queuedAt)}`), ran && h('span', {}, `ran ${ran}`), r.attempt > 1 && h('span', {}, `attempt ${r.attempt}`), r.pr && h('span', {}, /^https?:/.test(r.pr) ? h('a', { href: r.pr, target: '_blank', rel: 'noopener' }, 'Pull request') : h('span', { title: r.pr }, `PR ${r.pr.split('/').pop()}`))),
    actions,
    stepper,
    alertBox,
    openAsks.length && h('div.entries', { style: 'margin-top:20px;max-width:none' }, openAsks.map((e) => entryCard(e, r))),
    h('div.grid2', {},
      h('div.card', {}, h('div.card-head', {}, h('h2', {}, 'Story'), h('span.muted', { style: 'font-size:14px' }, `${started.length} station${started.length === 1 ? '' : 's'}${ran ? ` · ${ran}` : ''}`)), started.length ? story : h('p.muted', {}, 'No station has started yet.')),
      h('div.card', {}, h('div.card-head', {}, h('h2', {}, 'Agent output'), h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, outPills, copyBtn)), terminal)),
    h('div.grid2', {}, checks, artifacts),
    d.evidence && h('div.card', { style: 'margin-top:20px' }, h('details.evidence', {}, h('summary', {}, 'Evidence (the PR body)'), h('pre', {}, d.evidence))),
  ];
}

// ---- inbox --------------------------------------------------------------------------------------

const KIND = { approval: ['Approve', 'warn'], question: ['Question', 'warn'], policy: ['Permission', 'warn'], escalation: ['Needs a person', 'danger'] };
const GATE = { spec: 'Approve the spec', security: 'Security hold', scope: 'Allow more files' };
const reply = new Map(); // inbox id → 'reject' while the feedback box is open

/** One inbox entry: what's asked, the detail, and the buttons that answer it. */
function entryCard(e, run) {
  const [kindLabel, tone] = KIND[e.kind] ?? [human(e.kind), 'warn'];
  const label = GATE[e.gate] ?? (e.kind === 'approval' && e.gate ? `Approve ${e.gate}` : kindLabel);
  const text = h('textarea', { id: `reply-${e.id}`, placeholder: e.kind === 'question' ? 'Your answer' : 'What should change?', 'aria-label': e.kind === 'question' ? 'Your answer' : 'Feedback' });
  const rejecting = reply.get(e.id) === 'reject';
  const cancel = h('button.ghost.danger', { onclick: act(() => confirm('Cancel this run?') && post(`/runs/${e.runId}/cancel`)) }, 'Cancel run');
  let buttons;
  if (e.kind === 'question') {
    buttons = [text, e.detail?.options?.length > 0 && h('div.options', {}, e.detail.options.map((o) => h('button.small', { onclick: () => ((text.value = o), text.focus()) }, o))), h('div.btns', {}, h('button.primary', { onclick: act(() => post(`/inbox/${e.id}`, { decision: 'answered', answer: text.value })) }, 'Send answer'), cancel)];
  } else if (rejecting) {
    buttons = [text, h('div.btns', {}, h('button.primary', { onclick: act(async () => (await post(`/inbox/${e.id}`, { decision: 'rejected', feedback: text.value }), reply.delete(e.id))) }, 'Send feedback'), h('button', { onclick: () => (reply.delete(e.id), render()) }, 'Back'))];
  } else {
    const verb = e.gate === 'spec' ? 'Approve and build' : 'Approve';
    buttons = [h('div.btns', {}, h('button.primary', { onclick: act(() => post(`/inbox/${e.id}`, { decision: 'approved' })) }, icon('check'), verb), h('button', { onclick: () => (reply.set(e.id, 'reject'), render().then(() => document.getElementById(`reply-${e.id}`)?.focus())) }, 'Ask for changes'), cancel)];
  }
  const facts = [e.detail?.paths?.length && ['Files', e.detail.paths.length], e.detail?.attempts && ['Repair attempts', e.detail.attempts], run && ['Cost so far', money(run.costUsd)], run?.station && ['Station', human(run.station)]].filter(Boolean);
  return h('article.card.entry', { 'aria-label': e.title },
    h('div.top', {}, pill(label, tone), h('a.mono', { href: `#/run/${e.runId}`, style: 'color:var(--muted)' }, shortId(e.runId)), h('span.waiting', {}, `waiting ${since(e.openedAt)}`)),
    h('h2', {}, run?.title ?? e.title),
    run && h('p.lead', {}, e.title),
    facts.length > 0 && h('dl.facts', {}, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd.num', {}, v)))),
    e.body && h('div.sunken', {}, h('div.eyebrow', {}, e.gate === 'spec' ? 'Spec' : 'Details'), h('div.body', {}, e.body)),
    buttons);
}

async function inboxView() {
  const { runs } = await renderSystem();
  const { entries } = await api('/inbox');
  const byId = new Map(runs.map((r) => [r.id, r]));
  const stopped = stoppedToReview(runs);
  const details = await Promise.all(stopped.slice(0, 6).map((r) => api(`/runs/${r.id}`).catch(() => null)));
  const n = entries.length + stopped.length;

  const stoppedCard = (r, d) => {
    const step = d?.steps.find((st) => st.status === 'failed' || st.status === 'running') ?? d?.steps.find((st) => st.id === r.station);
    const why = whyStopped(r, step, d?.agent ?? []);
    const at = step?.id ?? r.station;
    return h('article.card.entry', { 'aria-label': r.title },
      h('div.top', {}, pill('Run stopped', 'danger'), h('a.mono', { href: `#/run/${r.id}`, style: 'color:var(--muted)' }, shortId(r.id)), h('span.waiting', {}, `waiting ${since(r.endedAt)}`)),
      h('h2', {}, r.title),
      h('p.lead', {}, why),
      h('div.btns', {},
        h('button.primary', { onclick: act(async () => (await post(`/runs/${r.id}/retry`, { from: at ?? undefined }), dismiss(r))) }, icon('retry'), at ? `Retry from ${at}` : 'Retry'),
        h('a.btn', { href: `#/run/${r.id}` }, 'Open run'),
        h('button.ghost', { onclick: () => (dismiss(r), render()) }, 'Dismiss')));
  };

  const sub = n ? `${cap(plural(n, 'run'))} ${n === 1 ? 'is' : 'are'} waiting for a person. Everything else is moving on its own.` : 'Nothing is waiting for a person. Everything is moving on its own.';
  return [
    pageHead('Inbox', sub),
    h('div.entries', {}, entries.map((e) => entryCard(e, byId.get(e.runId))), stopped.map((r, i) => stoppedCard(r, details[i]))),
    h('p.all-clear', {}, icon('check'), n ? 'When this list is empty, nothing on the line is waiting for a person.' : 'All clear.'),
  ];
}

// ---- campaigns ----------------------------------------------------------------------------------

const HOW = [['file', '1 · Write a spec', 'One markdown file that says what to change and how to tell it worked.'], ['book', '2 · Pick repos', 'Each repo gets its own run, so one failure never blocks the rest.'], ['branch', '3 · Review the PRs', 'Track acceptance and merges across the whole campaign.']];
const CAMPAIGN_CMD = 'factory campaign create --name <name> --spec campaign.md --repos a,b';
const howCards = () => h('div.how', { id: 'how' }, HOW.map(([i, t, p]) => h('div.card', {}, icon(i), h('h3', {}, t), h('p', {}, p))));

async function campaignsView() {
  await renderSystem();
  const { campaigns } = await api('/campaigns');
  const head = pageHead('Campaigns', 'Run one change across many repos and watch every pull request in one place.', campaigns.length > 0 && h('button.primary', { onclick: NEW_CAMPAIGN }, icon('plus'), 'Start a campaign'));
  if (!campaigns.length) {
    return [
      head,
      h('div.card.hero-empty', {},
        h('div.rings', { 'aria-hidden': 'true' }, h('i'), h('i'), icon('flag')),
        h('h2', {}, 'No campaigns yet'),
        h('p', {}, 'Write the change once as a spec. The factory opens a run for each repo, sends each one down the line and gathers the results here.'),
        h('div.btns', {}, h('button.primary', { onclick: NEW_CAMPAIGN }, icon('plus'), 'Start a campaign'), h('a.btn', { href: '#/campaigns', onclick: (e) => (e.preventDefault(), document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })) }, 'How campaigns work')),
        h('div.cli', {}, h('div.label', {}, 'Or from the command line'), codeBlock(CAMPAIGN_CMD))),
      howCards(),
    ];
  }
  const STATE = { done: ['Done', 'teal'], open: ['Open', 'warn'], failed: ['Failed', 'danger'] };
  return [
    head,
    h('div.stack', {}, campaigns.map((c) => h('section.card.campaign', { 'aria-label': c.name },
      h('div.card-head', {}, h('div', {}, h('h2', {}, c.name), h('p.muted', { style: 'margin-top:4px' }, c.title)), h('div.counts', {}, pill(`${c.done} done`, 'teal'), pill(`${c.open} open`, 'warn'), pill(`${c.failed} failed`, c.failed ? 'danger' : ''), h('span.chip.num', {}, money(c.costUsd)))),
      h('div.table-wrap', { style: 'border-radius:16px' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Repo'), h('th', {}, 'State'), h('th', {}, 'Run'), h('th', {}, 'PR or reason'))),
        h('tbody', {}, c.repos.map((r) => h('tr', {}, h('td.mono', {}, r.repo), h('td', {}, pill(...STATE[r.state])), h('td.id', {}, r.runId ? h('a', { href: `#/run/${r.runId}` }, `${shortId(r.runId)} · ${r.status}`) : h('span.muted', {}, r.status)), h('td.muted', {}, r.pr && /^https?:/.test(r.pr) ? h('a', { href: r.pr, target: '_blank', rel: 'noopener' }, r.pr) : r.reason ?? r.pr ?? '')))))))),
    ),
  ];
}

// ---- metrics ------------------------------------------------------------------------------------

const PERIODS = [['7d', '7 days'], ['30d', '30 days'], ['2000-01-01', 'All time']];
let period = '7d';

async function metricsView() {
  await renderSystem();
  const segmented = h('div.segmented', { role: 'group', 'aria-label': 'Period' }, PERIODS.map(([id, label]) => h('button', { 'aria-pressed': period === id ? 'true' : 'false', onclick: () => ((period = id), render()) }, label)));
  let m;
  try {
    m = await api(`/metrics?since=${encodeURIComponent(period)}`);
  } catch (error) {
    return [pageHead('Metrics', `Not available: ${error.message}`, segmented)];
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
    h('div.eyebrow', { style: 'margin-bottom:14px' }, 'Delivery'),
    h('div.tiles', {}, tiles.map(([l, v, hint]) => h('div.tile', {}, h('div.l', {}, l), h('div.v', {}, v), hint && h('div.h', {}, hint)))),
    st.length > 0 && h('div.callouts', {},
      callout('clock', '', 'Slowest station', `${human(slowest.id)} · ${fmtDur(slowest.p50Ms)}`),
      callout('chart', '', 'Priciest station', `${human(priciest.id)} · ${money(priciest.costUsd)}`),
      failing.failures ? callout('warn', 'danger', 'Most failures', failing.failures <= failing.runs ? `${human(failing.id)} · ${failing.failures} of ${failing.runs}` : `${human(failing.id)} · ${failing.failures} failed tries in ${failing.runs} runs`) : callout('check', '', 'Failures', 'None in this period')),
    h('div.table-wrap', { style: st.length ? '' : 'margin-top:28px' },
      h('div.card-head', { style: 'padding:24px 28px 0;margin:0' }, h('h2', {}, 'Stations'), h('span.muted', { style: 'font-size:14px' }, 'Sorted by median time')),
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

// ---- routing and live updates ---------------------------------------------------------------

for (const a of document.querySelectorAll('#nav a')) a.prepend(icon(a.dataset.icon));
const menu = document.getElementById('menu');
menu.append(icon('menu'));
menu.addEventListener('click', () => menu.setAttribute('aria-expanded', String(document.body.classList.toggle('menu-open'))));
document.getElementById('nav').addEventListener('click', () => (document.body.classList.remove('menu-open'), menu.setAttribute('aria-expanded', 'false')));

async function render() {
  const [, page, arg] = (location.hash || '#/').slice(1).split('/');
  for (const a of document.querySelectorAll('#nav a')) {
    const on = a.getAttribute('href') === `#/${page ?? ''}` || (page === 'run' && a.getAttribute('href') === '#/runs');
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  // Don't throw away what someone is typing in a form.
  if ([...view.querySelectorAll('textarea')].some((t) => t.value)) return;
  // Keep focus, the caret and the agent output's scroll position across live re-renders.
  const focused = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  const term = view.querySelector('.terminal');
  const termAtEnd = !term || term.scrollTop + term.clientHeight >= term.scrollHeight - 24;
  const termTop = term?.scrollTop;
  try {
    const nodes = page === 'runs' ? await runsView() : page === 'run' ? await runView(arg) : page === 'inbox' ? await inboxView() : page === 'metrics' ? await metricsView() : page === 'campaigns' ? await campaignsView() : await lineView();
    view.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
  } catch (error) {
    view.replaceChildren(h('div.card.error-card', {}, h('h2', {}, 'Something went wrong'), h('p', { style: 'margin-top:8px' }, error.message === '401' || /token/.test(error.message) ? 'Not signed in: open the URL that `factory dashboard` printed (it carries the token).' : error.message)));
  }
  const again = focused && document.getElementById(focused);
  if (again) {
    again.focus();
    if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret);
  }
  const t = view.querySelector('.terminal');
  if (t) t.scrollTop = termAtEnd ? t.scrollHeight : termTop;
  document.title = `${document.querySelector('#view h1')?.textContent ?? 'Factory'} · Factory`;
}

let pending = null;
function soon() {
  clearTimeout(pending);
  pending = setTimeout(render, 300);
}
function connect() {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener('open', () => ((liveOn = true), soon()));
  source.addEventListener('error', () => ((liveOn = false), soon())); // the browser reconnects by itself, with Last-Event-ID
  source.addEventListener('factory', soon);
}

addEventListener('hashchange', () => (scrollTo(0, 0), render()));
render();
connect(); // with no token and auth on, the 401 ends the EventSource: it doesn't retry
