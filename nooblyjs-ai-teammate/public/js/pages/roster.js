// Team roster (/team): summary tiles, status filters, search and the teammate card grid.
import { api } from '../api.js';
import { html } from '../html.js';
import { icons } from '../icons.js';
import { avatar, PALETTE } from '../avatar.js';
import { money, rate, hours, count, numberWord } from '../format.js';
import { statusPill, meter } from '../ui.js';

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'task', label: 'On a task' },
  { key: 'available', label: 'Available' },
  { key: 'paused', label: 'Paused' },
  { key: 'off', label: 'Off shift' },
];

function subline(summary) {
  const { total, onTask } = summary;
  if (!total) return 'No one on the team yet. Hire your first teammate to get started.';
  const team = `${numberWord(total)} ${total === 1 ? 'agent' : 'agents'} on the team.`;
  if (!onTask) return `${team} Nobody is on a task right now.`;
  return `${team} ${numberWord(onTask)} ${onTask === 1 ? 'is' : 'are'} on a task right now.`;
}

const matches = (t, q) => {
  if (!q) return true;
  const hay = [t.name, t.role, t.model.name, t.model.tier, ...t.skills].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
};

const card = (t) => html`
  <a class="teammate-card" href="/team/${t.id}">
    <div class="teammate-header">
      ${avatar(t.avatar, 60)}
      ${statusPill(t.status)}
    </div>
    <div class="teammate-info">
      <div class="teammate-name">${t.name}</div>
      <div class="teammate-role">${t.role}</div>
    </div>
    <div class="teammate-task">${icons.clock}<span>${t.currentTask || 'Ready for work'}</span></div>
    ${t.skills.length ? html`<div class="skills">${t.skills.slice(0, 3).map((s) => html`<span class="skill">${s}</span>`)}</div>` : ''}
    <div class="stats-grid">
      <div class="stat"><div class="stat-label">Model</div><div class="stat-value">${t.model.name} <span aria-label="${t.model.tier} tier">${t.model.symbol}</span></div></div>
      <div class="stat"><div class="stat-label">Rate</div><div class="stat-value">${rate(t.rate)}</div></div>
      <div class="stat"><div class="stat-label">Billed in 30 days</div><div class="stat-value">${hours(t.billed30d.hours)} · ${money(t.billed30d.amount)}</div></div>
      <div class="stat"><div class="stat-label">Memory</div><div class="stat-value">${count(t.memoryCount)} ${t.memoryCount === 1 ? 'item' : 'items'}</div></div>
    </div>
  </a>`;

const hireCard = html`
  <a class="hire-card" href="/hire">
    <div class="hire-icon" aria-hidden="true">+</div>
    <div class="hire-title">Hire a teammate</div>
    <div class="hire-desc">Give them a name, a face, a model and the skills they need.</div>
  </a>`;

function emptyState(query, filterLabel) {
  const faces = PALETTE.slice(0, 3).map((p, i) => avatar({ ...p, hair: ['bob', 'antenna', 'bun'][i] }, 48));
  return html`
    <div class="card empty-state" role="status">
      <div class="empty-art" aria-hidden="true">${faces}</div>
      <h2 class="card-title">No one matches ${query ? html`“${query}”` : 'that filter'}</h2>
      <p>${query ? `Nobody${filterLabel ? ` in “${filterLabel}”` : ''} has that name, role, model or skill. Try a different word, or hire someone who does.` : 'No teammates have this status right now.'}</p>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-secondary" data-action="clear">Clear search and filters</button>
        <a class="btn-hire" href="/hire">${icons.plus}Hire a teammate</a>
      </div>
    </div>`;
}

const tiles = (summary) => html`
      <div class="summary-card">
        <div class="summary-label">On a task now</div>
        <div class="summary-value">${summary.onTask} of ${summary.total}</div>
        <div class="avatar-row" aria-label="${summary.busyAvatars.map((a) => a.name).join(', ') || 'Nobody busy'}">${summary.busyAvatars.slice(0, 5).map((a) => avatar(a.avatar, 40))}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Billed · last 30 days</div>
        <div class="summary-value">${money(summary.billed30d.amount)}</div>
        <div class="summary-detail">${hours(summary.billed30d.hours).replace('h', '')} hours across ${summary.billed30d.teammates} ${summary.billed30d.teammates === 1 ? 'teammate' : 'teammates'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${summary.budget.label}</div>
        <div class="summary-value">${summary.budget.pct}%<small>used</small></div>
        ${meter(summary.budget.pct, { label: `${money(summary.budget.used)} of ${money(summary.budget.budget)} used` })}
      </div>
`;

export async function render(view, { query, ctx }) {
  let { summary, teammates } = await api.get('/api/teammates');
  const state = { filter: FILTERS.some((f) => f.key === query.get('status')) ? query.get('status') : 'all', q: query.get('q') ?? '' };

  view.innerHTML = String(html`
    <div class="header">
      <div>
        <h1>Your digital teammates</h1>
        <p class="header-subtitle" id="roster-subline">${subline(summary)}</p>
      </div>
      <div class="header-right" role="search">
        <label class="visually-hidden" for="roster-search">Search teammates</label>
        <input class="search-box" id="roster-search" type="search" placeholder="Search name, skill or model" value="${state.q}" autocomplete="off">
        <a class="btn-hire" href="/hire">${icons.plus}Hire a teammate</a>
      </div>
    </div>

    <section class="summary-grid" aria-label="Team summary" id="tiles"></section>

    <div class="filter-pills" role="group" aria-label="Filter by status" id="filters"></div>
    <div class="visually-hidden" aria-live="polite" id="result-count"></div>
    <div id="grid"></div>`);

  const filtersEl = view.querySelector('#filters');
  const grid = view.querySelector('#grid');
  const search = view.querySelector('#roster-search');
  const live = view.querySelector('#result-count');

  const draw = () => {
    view.querySelector('#tiles').innerHTML = String(tiles(summary));
    view.querySelector('#roster-subline').textContent = subline(summary);
    const searched = teammates.filter((t) => matches(t, state.q.trim()));
    const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key === 'all' ? searched.length : searched.filter((t) => t.status === f.key).length]));
    filtersEl.innerHTML = String(html`${FILTERS.map(
      (f) => html`<button type="button" class="filter-pill" data-filter="${f.key}" aria-pressed="${state.filter === f.key}">${f.label} ${counts[f.key]}</button>`,
    )}`);
    const shown = searched.filter((t) => state.filter === 'all' || t.status === state.filter);
    const filterLabel = state.filter === 'all' ? '' : FILTERS.find((f) => f.key === state.filter).label;
    grid.innerHTML = String(
      shown.length || (!state.q && state.filter === 'all')
        ? html`<div class="teammate-grid">${shown.map(card)}${hireCard}</div>`
        : emptyState(state.q.trim(), filterLabel),
    );
    live.textContent = `${shown.length} ${shown.length === 1 ? 'teammate' : 'teammates'} shown`;
    const url = new URL(location.href);
    state.q ? url.searchParams.set('q', state.q) : url.searchParams.delete('q');
    state.filter !== 'all' ? url.searchParams.set('status', state.filter) : url.searchParams.delete('status');
    history.replaceState(null, '', url.pathname + url.search);
  };

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    draw();
  });
  search.addEventListener('input', () => {
    state.q = search.value;
    draw();
  });
  grid.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="clear"]')) return;
    state.q = '';
    state.filter = 'all';
    search.value = '';
    draw();
    search.focus();
  });
  draw();

  // Live updates: refetch when a teammate's status changes or time is logged, keeping filters and search.
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        ({ summary, teammates } = await api.get('/api/teammates'));
        const focused = document.activeElement?.dataset?.filter;
        draw();
        if (focused) filtersEl.querySelector(`[data-filter="${focused}"]`)?.focus();
      } catch { /* keep showing the last good data */ }
    }, 250);
  };
  const offs = [ctx.on('teammate', refresh), ctx.on('timesheet', refresh)];
  return { cleanup: () => { clearTimeout(timer); offs.forEach((off) => off()); } };
}
