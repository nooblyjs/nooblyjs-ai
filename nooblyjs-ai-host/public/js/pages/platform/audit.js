// Platform · Audit log: every write and every refusal, newest first, filtered by actor, action and date. The rows are
// the records in data/audit/ as they are (product.md §5.7: actor, action, target, cost and time). Reading it needs
// read-audit (Approver, Architect, Owner).
import { html } from '/ui/js/html.js';
import { button, dataTable, notice } from '/ui/js/components/index.js';
import { head, errorText, money } from './lib.js';

const LEAD = 'Every write and every refusal: who, what, on what, at what cost, and when.';
const today = () => new Date().toISOString().slice(0, 10);

export async function render(view, { ctx }) {
  const api = ctx.hostApi;
  if (!ctx.can('read-audit')) {
    view.innerHTML = String(html`${head('Audit log', LEAD)}${notice({ title: 'The audit log needs the read-audit permission', text: 'Approvers, Architects and Owners can read it. Ask an Owner if you need it.', tone: 'muted' })}`);
    return;
  }
  const filters = { actor: '', action: '', text: '', from: '', to: today() };
  let rows = [];
  let page = null;
  let error = null;
  let open = null;

  async function fetchPage(cursor) {
    try {
      const result = await api.get('platform/audit', { query: { ...filters, cursor } });
      error = null;
      page = result;
      rows = cursor ? [...rows, ...result.records] : result.records;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      error = errorText(err);
      rows = [];
      page = null;
    }
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    view.innerHTML = String(html`${head('Audit log', LEAD)}
    <section class="card" aria-label="Filter">
      <form class="form form--inline" data-form="filter">
        <label class="field">Actor<input name="actor" value="${filters.actor}" maxlength="80" placeholder="stevie" autocomplete="off"></label>
        <label class="field">Action<input name="action" value="${filters.action}" maxlength="80" placeholder="guardrail.changed or repo." autocomplete="off"></label>
        <label class="field">Target or reason contains<input name="text" value="${filters.text}" maxlength="80" autocomplete="off"></label>
        <label class="field">From<input name="from" type="date" value="${filters.from || page?.from || ''}"></label>
        <label class="field">To<input name="to" type="date" value="${filters.to}"></label>
        <div class="actions">${button({ label: 'Filter', type: 'submit' })}</div>
      </form>
      <p class="note">An action ending in "." matches every action that starts with it. Up to 92 days at a time.</p>
    </section>
    ${error ? html`<p class="flash flash--error" role="alert">${error}</p>` : ''}
    <section class="card card--flush" aria-label="Records">
      <div class="card__head"><h2 class="card__title">Records</h2><span class="card__meta" role="status">${page ? `${page.total} from ${page.from} to ${page.to}, newest first` : ''}</span></div>
      ${dataTable({
        caption: 'Audit records',
        empty: 'No records match.',
        rows,
        columns: [
          { key: 'at', label: 'Time', render: (r) => new Date(r.at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'medium' }) },
          { key: 'actor', label: 'Actor', render: (r) => r.actor ?? '—' },
          { key: 'action', label: 'Action', render: (r) => html`<span class="mono">${r.action}</span>` },
          { key: 'target', label: 'Target', render: (r) => html`<span class="mono">${r.target ?? '—'}</span>${r.reason ? html`<span class="repo-sub">${r.reason}</span>` : ''}` },
          { key: 'costUsd', label: 'Cost', numeric: true, render: (r) => (r.costUsd === null ? '—' : money(r.costUsd)) },
          { key: 'record', label: 'Record', render: (r) => html`<button class="link-button" type="button" data-open="${r.id}" aria-expanded="${open === r.id ? 'true' : 'false'}">${open === r.id ? 'Hide' : 'Show'}<span class="visually-hidden"> record ${r.id}</span></button>` },
        ],
      })}
      ${open && rows.find((r) => r.id === open) ? html`<div class="card__pad"><pre class="log" tabindex="0">${JSON.stringify(rows.find((r) => r.id === open).record, null, 2)}</pre></div>` : ''}
      ${page?.next ? html`<div class="card__pad">${button({ label: 'Show more', kind: 'secondary', attrs: { 'data-action': 'more' } })}</div>` : ''}
    </section>`);
  }

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="filter"]');
    if (!form) return;
    event.preventDefault();
    Object.assign(filters, Object.fromEntries(new FormData(form)));
    open = null;
    await fetchPage();
    paint();
  }, { signal: ctx.signal });

  view.addEventListener('click', async (event) => {
    if (event.target.closest('[data-action="more"]')) { await fetchPage(page.next); paint(); return; }
    const show = event.target.closest('[data-open]');
    if (show) { open = open === show.dataset.open ? null : show.dataset.open; paint(); }
  }, { signal: ctx.signal });

  await fetchPage();
  paint();
}
