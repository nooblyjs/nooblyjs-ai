// Team roster (/team, mockup noobly-teammates-team-roster): summary tiles, status filters, search and the teammate
// cards. Built from the UI kit's components (page head, stat cards, chips, pills, meter, buttons); only the teammate
// card and the generated faces are the app's own.
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { pageHead, statCard, chips, statusPill, meter, button, notice } from '/ui/js/components/index.js';
import { avatar } from '../avatar.js';
import { money, rate, hours, count, numberWord } from '../format.js';
import { api, appUrl, enter } from '../client.js';

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'task', label: 'On a task' },
  { key: 'available', label: 'Available' },
  { key: 'paused', label: 'Paused' },
  { key: 'off', label: 'Off shift' },
];
/** A status in words, with a tone as the second signal. */
const STATUS = {
  task: { text: 'On a task', tone: 'info' },
  available: { text: 'Available', tone: 'success' },
  paused: { text: 'Paused', tone: 'warning' },
  off: { text: 'Off shift', tone: 'neutral' },
};

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

const fact = (label, value) => html`<div class="tmk-fact"><dt>${label}</dt><dd>${value}</dd></div>`;

const card = (t) => html`
  <li><a class="tmk-card" href="${appUrl(`/team/${t.id}`)}">
    <span class="tmk-card__top">${avatar(t.avatar, 60)}${statusPill(STATUS[t.status] ?? { text: t.status })}</span>
    <span class="tmk-card__name">${t.name}</span>
    <span class="tmk-card__role">${t.role}</span>
    <span class="tmk-card__task">${icon('clock', { size: 16 })}<span>${t.currentTask || 'Ready for work'}</span></span>
    ${t.skills.length ? html`<span class="tmk-skills">${t.skills.slice(0, 3).map((s) => html`<span class="tmk-skill">${s}</span>`)}</span>` : ''}
    <dl class="tmk-facts">
      ${fact('Model', html`${t.model.name} <span aria-label="${t.model.tier} tier">${t.model.symbol}</span>`)}
      ${fact('Rate', rate(t.rate))}
      ${fact('Billed in 30 days', `${hours(t.billed30d.hours)} · ${money(t.billed30d.amount)}`)}
      ${fact('Memory', `${count(t.memoryCount)} ${t.memoryCount === 1 ? 'item' : 'items'}`)}
    </dl>
  </a></li>`;

const hireCard = html`
  <li><a class="tmk-card tmk-card--hire" href="${appUrl('/hire')}">
    <span class="tmk-card__plus" aria-hidden="true">${icon('plus', { size: 28 })}</span>
    <span class="tmk-card__name">Hire a teammate</span>
    <span class="tmk-card__role">Pick a role, a model and a budget</span>
  </a></li>`;

function tiles(summary) {
  const b = summary.budget;
  const ratio = (Number(b.pct) || 0) / 100;
  return html`
    <div class="tmk-tile">${statCard({ label: 'On a task now', value: `${summary.onTask} of ${summary.total}` })}
      <div class="tmk-faces" role="img" aria-label="${summary.busyAvatars.map((a) => a.name).join(', ') || 'Nobody is on a task'}">${summary.busyAvatars.slice(0, 5).map((a) => avatar(a.avatar, 36))}</div>
    </div>
    <div class="tmk-tile">${statCard({ label: 'Billed · last 30 days', value: money(summary.billed30d.amount), note: `${hours(summary.billed30d.hours).replace('h', '')} hours across ${summary.billed30d.teammates} ${summary.billed30d.teammates === 1 ? 'teammate' : 'teammates'}` })}</div>
    <div class="tmk-tile">${statCard({ label: b.label, value: html`${b.pct}% <small>used</small>` })}
      ${meter({ label: 'Spent', value: `${money(b.used)} of ${money(b.budget)}`, ratio, tone: ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : undefined })}
    </div>`;
}

let leave = null;

export async function render(frameView, { query, ctx: frame }) {
  const { view, ctx } = await enter(frameView, frame, 'roster', { kit: true });
  let { summary, teammates } = await api.get('/api/v1/teammates');
  if (!ctx.isCurrent()) return;
  const mayHire = ctx.can('hire');
  const state = { filter: FILTERS.some((f) => f.key === query.get('status')) ? query.get('status') : 'all', q: query.get('q') ?? '' };

  view.innerHTML = String(html`
    ${pageHead({
    eyebrow: 'Digital Teammates', title: 'Your digital teammates', lead: html`<span id="roster-subline">${subline(summary)}</span>`,
    actions: mayHire ? button({ label: 'Hire a teammate', icon: 'plus', href: appUrl('/hire') }) : '',
  })}
    <section class="tmk-tiles" aria-label="Team summary" id="tiles"></section>
    <div class="tmk-bar">
      <div id="filters"></div>
      <div class="tmk-search" role="search">
        <label class="visually-hidden" for="roster-search">Search teammates</label>
        <input id="roster-search" type="search" placeholder="Search name, skill or model" value="${state.q}" autocomplete="off">
      </div>
    </div>
    <p class="visually-hidden" aria-live="polite" id="result-count"></p>
    <div id="grid"></div>`);

  const filtersEl = view.querySelector('#filters');
  const grid = view.querySelector('#grid');
  const search = view.querySelector('#roster-search');
  const live = view.querySelector('#result-count');

  const draw = () => {
    view.querySelector('#tiles').innerHTML = String(tiles(summary));
    view.querySelector('#roster-subline').textContent = subline(summary);
    const searched = teammates.filter((t) => matches(t, state.q.trim()));
    filtersEl.innerHTML = String(chips({
      label: 'Filter by status', name: 'filter', current: state.filter,
      items: FILTERS.map((f) => ({ value: f.key, label: f.label, count: f.key === 'all' ? searched.length : searched.filter((t) => t.status === f.key).length })),
    }));
    const shown = searched.filter((t) => state.filter === 'all' || t.status === state.filter);
    const filterLabel = state.filter === 'all' ? '' : FILTERS.find((f) => f.key === state.filter).label;
    grid.innerHTML = String(
      shown.length || (!state.q && state.filter === 'all')
        ? html`<ul class="tmk-grid" aria-label="Teammates">${shown.map(card)}${mayHire ? hireCard : ''}</ul>`
        : notice({
          tone: 'muted', iconName: 'search',
          title: state.q.trim() ? `No one matches “${state.q.trim()}”` : 'No one matches that filter',
          text: state.q.trim() ? `Nobody${filterLabel ? ` in “${filterLabel}”` : ''} has that name, role, model or skill. Try a different word.` : 'No teammates have this status right now.',
          actions: button({ label: 'Clear search and filters', kind: 'secondary', attrs: { 'data-action': 'clear' } }),
        }),
    );
    live.textContent = `${shown.length} ${shown.length === 1 ? 'teammate' : 'teammates'} shown`;
    const url = new URL(location.href);
    state.q ? url.searchParams.set('q', state.q) : url.searchParams.delete('q');
    state.filter !== 'all' ? url.searchParams.set('status', state.filter) : url.searchParams.delete('status');
    history.replaceState(history.state, '', url.pathname + url.search);
  };

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    draw();
    filtersEl.querySelector(`[data-filter="${state.filter}"]`)?.focus();
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
        ({ summary, teammates } = await api.get('/api/v1/teammates'));
        if (!ctx.isCurrent()) return;
        const focused = document.activeElement?.dataset?.filter;
        draw();
        if (focused) filtersEl.querySelector(`[data-filter="${focused}"]`)?.focus();
      } catch { /* keep showing the last good data */ }
    }, 250);
  };
  ctx.on('teammate', refresh);
  ctx.on('timesheet', refresh);
  leave = () => clearTimeout(timer);
}

/** The frame calls this when the person leaves the page. */
export function destroy() {
  leave?.();
  leave = null;
}
