// Team memory (/team-memory): everything teammates in "Shared team memory" mode have learned, with who added it.
import { api } from '../api.js';
import { html } from '../html.js';
import { avatar } from '../avatar.js';
import { toast, confirmDialog } from '../ui.js';
import { memoryRow, byPinnedThenNewest, KIND_LABEL } from '../memory-ui.js';
import { showWorkItem } from '../work-dialog.js';

const KINDS = [['all', 'Everything'], ['fact', 'Facts'], ['preference', 'Preferences'], ['source', 'Sources']];

export async function render(view, { query }) {
  let data = await api.get('/api/team-memory');
  const state = { kind: KINDS.some(([k]) => k === query.get('kind')) ? query.get('kind') : 'all', project: query.get('project') ?? '' };

  const draw = () => {
    const projects = [...new Set(data.items.map((i) => i.project).filter(Boolean))].sort();
    const shown = data.items
      .filter((i) => state.kind === 'all' || i.kind === state.kind)
      .filter((i) => !state.project || (state.project === '-' ? !i.project : i.project === state.project))
      .sort(byPinnedThenNewest);
    const count = (k) => data.items.filter((i) => k === 'all' || i.kind === k).length;
    view.innerHTML = String(html`
      <div class="header">
        <div>
          <h1>Team memory</h1>
          <p class="header-subtitle">What teammates in shared-memory mode have learned. Every one of them can use it, limited to the task's project.</p>
        </div>
        <div class="header-right">
          <label class="visually-hidden" for="tm-project">Project</label>
          <select class="form-input" id="tm-project" style="width:220px">
            <option value="">All projects</option>
            <option value="-" ${state.project === '-' ? 'selected' : ''}>Shared (no project)</option>
            ${projects.map((p) => html`<option value="${p}" ${state.project === p ? 'selected' : ''}>${p}</option>`)}
          </select>
        </div>
      </div>

      <section class="summary-grid" aria-label="Team memory summary">
        <div class="summary-card">
          <div class="summary-label">Shared items</div>
          <div class="summary-value">${data.items.length}</div>
          <div class="summary-detail">${data.items.filter((i) => i.pinned).length} pinned · ${projects.length} ${projects.length === 1 ? 'project' : 'projects'}</div>
        </div>
        <div class="summary-card" style="grid-column: span 2">
          <div class="summary-label">Teammates sharing memory</div>
          ${data.members.length
            ? html`<div class="member-row">${data.members.map((m) => html`<a class="member" href="/team/${m.id}">${avatar(m.avatar, 40)}<span>${m.name}</span></a>`)}</div>`
            : html`<p class="summary-detail">Nobody yet. Set a teammate's memory to “Shared team memory” in their Edit dialog.</p>`}
        </div>
      </section>

      <div class="filter-pills" role="group" aria-label="Filter by kind">
        ${KINDS.map(([k, label]) => html`<button type="button" class="filter-pill" data-kind="${k}" aria-pressed="${state.kind === k}">${label} ${count(k)}</button>`)}
      </div>

      <section class="card" aria-label="Shared memory items">
        ${shown.length
          ? html`<div class="memory-list team-memory-list">${shown.map((m) => memoryRow(m, { contributor: m.contributor }))}</div>`
          : html`<div class="empty-state"><h2 class="card-title">Nothing here yet</h2><p>${data.items.length ? 'No items match these filters.' : 'Shared memory fills up as teammates in shared-memory mode finish tasks.'}</p></div>`}
      </section>`);
    const url = new URL(location.href);
    state.kind !== 'all' ? url.searchParams.set('kind', state.kind) : url.searchParams.delete('kind');
    state.project ? url.searchParams.set('project', state.project) : url.searchParams.delete('project');
    history.replaceState(null, '', url.pathname + url.search);
  };

  view.onchange = (e) => {
    if (e.target.id !== 'tm-project') return;
    state.project = e.target.value;
    draw();
    view.querySelector('#tm-project').focus();
  };
  view.onclick = async (e) => {
    const kind = e.target.closest('[data-kind]');
    const pin = e.target.closest('[data-pin]');
    const del = e.target.closest('[data-delete]');
    const work = e.target.closest('[data-work]');
    try {
      if (kind) {
        state.kind = kind.dataset.kind;
        draw();
        view.querySelector(`[data-kind="${state.kind}"]`)?.focus();
      } else if (pin) {
        const item = data.items.find((i) => i.id === pin.dataset.pin);
        item.pinned = (await api.patch(`/api/team-memory/${item.id}`, { pinned: !item.pinned })).pinned;
        draw();
        view.querySelector(`[data-pin="${item.id}"]`)?.focus();
      } else if (del) {
        const item = data.items.find((i) => i.id === del.dataset.delete);
        const ok = await confirmDialog({ title: 'Delete this memory?', message: `“${item.text.slice(0, 120)}” (${KIND_LABEL[item.kind] ?? item.kind}, added by ${item.contributor}) will be removed for every teammate.`, confirmLabel: 'Delete' });
        if (!ok) return;
        await api.del(`/api/team-memory/${item.id}`);
        data = { ...data, items: data.items.filter((i) => i.id !== item.id) };
        toast('Memory deleted');
        draw();
      } else if (work) {
        await showWorkItem({ teammateId: work.dataset.teammate, workId: work.dataset.work });
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  };

  draw();
  return { cleanup: () => { view.onclick = null; view.onchange = null; } };
}
