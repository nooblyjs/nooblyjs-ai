// Work timeline (/timeline): every task over time, grouped by day, with who asked (a person, an API key, a schedule
// or another teammate), the tools used, handoffs to other teammates and what each side cost.
import { api } from '../api.js';
import { html } from '../html.js';
import { icons } from '../icons.js';
import { avatar } from '../avatar.js';
import { money, hours1, plural } from '../format.js';
import { showWorkItem } from '../work-dialog.js';

const DAYS = [7, 14, 30];
const STATUS = { succeeded: 'Done', declined: 'Declined', failed: 'Failed', awaiting_approval: 'Waiting' };
const dayKey = (iso) => iso.slice(0, 10);
const dayLabel = (key) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
};
const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const duration = (ms) => (!ms ? '' : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60000)} min`);

function callerChip(i) {
  const c = i.caller;
  if (i.schedule) return html`<span class="chip-caller chip-schedule">${icons.clock}${i.schedule.name}</span>`;
  if (!c) return '';
  if (c.type === 'teammate') return html`<span class="chip-caller">from ${c.name}</span>`;
  if (c.type === 'key') return html`<span class="chip-caller">API key “${c.name}”</span>`;
  return html`<span class="chip-caller">${c.name}</span>`;
}

function itemRow(i) {
  const toolSummary = i.tools.filter((t) => t.name !== 'delegate');
  return html`
    <li class="tl-item${i.delegatedFrom ? ' tl-child' : ''}" id="tl-${i.workId}">
      <div class="tl-time">${time(i.startedAt)}</div>
      <div class="tl-dot status-${i.status}" aria-hidden="true"></div>
      <div class="tl-body">
        <div class="tl-head">
          <a class="tl-who" href="/team/${i.teammate.id}">${avatar(i.teammate.avatar, 28)}<span>${i.teammate.name}</span></a>
          ${callerChip(i)}
          ${i.project ? html`<span class="project-chip">${i.project}</span>` : ''}
          ${i.status !== 'succeeded' ? html`<span class="status-badge tl-status-${i.status}">${STATUS[i.status] ?? i.status}</span>` : ''}
        </div>
        <button type="button" class="tl-title" data-work="${i.workId}" data-teammate="${i.teammate.id}">${i.title || 'Untitled task'}</button>
        ${i.delegatedFrom ? html`<div class="tl-link">← handed over by <a href="#tl-${i.delegatedFrom.workId}">${i.delegatedFrom.teammate.name}</a>${i.delegatedFrom.title ? html` for “${i.delegatedFrom.title}”` : ''}</div>` : ''}
        ${i.delegations.length ? html`<ul class="tl-handoffs">${i.delegations.map((d) => html`
          <li>→ handed to <strong>${d.teammate.name}</strong>${d.workId ? html` · <a href="#tl-${d.workId}">see their work</a>` : ''}
            · ${d.status === 'completed' ? money(d.amount ?? 0) : d.status === 'awaiting_approval' ? 'waiting for approval' : d.status}</li>`)}</ul>` : ''}
        ${toolSummary.length ? html`<div class="tl-tools">${toolSummary.map((t) => html`<span class="tool-chip tool-${t.status}" title="${t.status}">${t.label ?? t.name}${t.status === 'queued' ? ' · waiting' : t.status === 'error' ? ' · failed' : ''}</span>`)}</div>` : ''}
        ${i.error ? html`<div class="field-error">${i.error}</div>` : ''}
      </div>
      <div class="tl-cost">
        <div class="num"><strong>${money(i.amount)}</strong></div>
        <div class="help">${hours1(i.hours)}${i.durationMs ? ` · ${duration(i.durationMs)}` : ''}</div>
        ${i.delegations.length ? html`<div class="help">with handoffs ${money(i.totalAmount)}</div>` : ''}
      </div>
    </li>`;
}

export async function render(view, { query, ctx }) {
  const state = {
    teammate: query.get('teammate') || '',
    days: DAYS.includes(Number(query.get('days'))) ? Number(query.get('days')) : 14,
  };

  const draw = async () => {
    const t = await api.get(`/api/timeline?days=${state.days}${state.teammate ? `&teammate=${encodeURIComponent(state.teammate)}` : ''}`);
    const url = new URL(location.href);
    state.teammate ? url.searchParams.set('teammate', state.teammate) : url.searchParams.delete('teammate');
    state.days === 14 ? url.searchParams.delete('days') : url.searchParams.set('days', state.days);
    history.replaceState(null, '', url.pathname + url.search);

    const groups = new Map();
    for (const i of t.items) {
      const k = dayKey(i.startedAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    view.innerHTML = String(html`
      <div class="header">
        <div>
          <h1>Work timeline</h1>
          <p class="header-subtitle">What ${t.teammate ? t.teammate.name : 'the team'} worked on, who asked, which tools they used and who they handed work to.</p>
        </div>
        <div class="timeline-filters">
          <label class="visually-hidden" for="tl-teammate">Teammate</label>
          <select class="form-input" id="tl-teammate">
            <option value="">Everyone</option>
            ${t.teammates.map((m) => html`<option value="${m.id}" ${m.id === state.teammate ? 'selected' : ''}>${m.name}</option>`)}
          </select>
          <div class="period-controls" role="group" aria-label="How far back">
            ${DAYS.map((d) => html`<button type="button" class="period-btn" data-days="${d}" aria-pressed="${d === state.days}">${d} days</button>`)}
          </div>
        </div>
      </div>

      <section class="summary-row summary-row-4" aria-label="Totals">
        <div class="summary-card dark"><div class="summary-label">Tasks</div><div class="summary-value">${t.totals.tasks}</div><div class="summary-detail">since ${new Date(`${t.from}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</div></div>
        <div class="summary-card"><div class="summary-label">Billed</div><div class="summary-value">${money(t.totals.amount)}</div><div class="summary-detail">${hours1(t.totals.hours)} logged</div></div>
        <div class="summary-card"><div class="summary-label">Handoffs</div><div class="summary-value">${t.totals.delegations}</div><div class="summary-detail">work passed between teammates</div></div>
        <div class="summary-card"><div class="summary-label">Tool calls</div><div class="summary-value">${t.totals.toolCalls}</div><div class="summary-detail">each one logged on its task</div></div>
      </section>

      <div class="timeline-grid">
        <section class="card" aria-labelledby="tl-h">
          <h2 class="card-title visually-hidden" id="tl-h">Tasks</h2>
          ${groups.size
            ? [...groups.entries()].map(([k, items]) => html`
                <h3 class="tl-day">${dayLabel(k)} <span class="help">${plural(items.length, 'task')} · ${money(items.reduce((s, i) => s + i.amount, 0))}</span></h3>
                <ol class="tl-list">${items.map(itemRow)}</ol>`)
            : html`<p class="muted">No work in the last ${t.days} days${t.teammate ? ` for ${t.teammate.name}` : ''}.</p>`}
        </section>
        <aside class="timeline-side">
          <section class="card" aria-labelledby="tl-wait">
            <div class="card-head"><h2 class="card-title" id="tl-wait">Waiting for approval</h2>${t.waiting.length && ctx.can('manager') ? html`<a href="/billing">Review</a>` : ''}</div>
            ${t.waiting.length
              ? html`<ul class="side-list">${t.waiting.map((w) => html`<li><strong>${w.teammate.name}</strong> ${w.kind === 'action' ? html`wants to use <em>${w.label}</em>` : html`· ${w.title}`}${w.estimate ? html` <span class="help">est. ${money(w.estimate.amount)}</span>` : ''}</li>`)}</ul>`
              : html`<p class="help">Nothing waiting.</p>`}
          </section>
          <section class="card" aria-labelledby="tl-next">
            <h2 class="card-title" id="tl-next">Coming up</h2>
            ${t.upcoming.length
              ? html`<ul class="side-list">${t.upcoming.map((u) => html`<li><strong>${u.name}</strong><div class="help">${u.teammate.name} · ${when(u.nextRunAt)}</div></li>`)}</ul>`
              : html`<p class="help">No scheduled runs. Add schedules on a teammate's profile.</p>`}
          </section>
        </aside>
      </div>`);
  };

  view.onclick = async (e) => {
    const days = e.target.closest('[data-days]');
    const work = e.target.closest('[data-work]');
    if (days && Number(days.dataset.days) !== state.days) {
      state.days = Number(days.dataset.days);
      await draw();
      view.querySelector(`[data-days="${state.days}"]`)?.focus();
    } else if (work) {
      await showWorkItem({ teammateId: work.dataset.teammate, workId: work.dataset.work });
    }
  };
  view.onchange = async (e) => {
    if (e.target.id !== 'tl-teammate') return;
    state.teammate = e.target.value;
    await draw();
    view.querySelector('#tl-teammate')?.focus();
  };

  // New work (including handoffs and scheduled runs) appears without a reload.
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => !document.querySelector('dialog[open]') && draw().catch(() => {}), 500);
  };
  const offs = [ctx.on('work', refresh), ctx.on('approval', refresh), ctx.on('schedule', refresh)];

  await draw();
  return {
    cleanup: () => {
      view.onclick = null;
      view.onchange = null;
      clearTimeout(timer);
      offs.forEach((off) => off());
    },
  };
}
