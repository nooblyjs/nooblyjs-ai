// Billing & timesheets (/billing): period totals, budget, spend by model, cost by teammate, invoices and month close,
// tasks waiting for approval, timesheet approvals, and a token view (usage and API cost against billed amounts).
import { api, ApiError } from '../api.js';
import { html } from '../html.js';
import { icons } from '../icons.js';
import { avatar } from '../avatar.js';
import { money, hours, hours1, tokens, plural } from '../format.js';
import { meter, openDialog, toast } from '../ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function defaultLabels() {
  const now = new Date();
  return {
    week: 'This week',
    month: MONTHS[now.getUTCMonth()],
    quarter: `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`,
  };
}

const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const longDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const pct = (n) => `${n}%`;

function reviewHeader(pending) {
  return pending > 0 ? `${pending} waiting for your approval` : 'All caught up';
}

const approvedBadge = html`<span class="approve-badge">✓ Approved</span>`;

const statusCell = (e) =>
  e.status === 'pending'
    ? html`<button type="button" class="btn-approve needs-manager" data-approve="${e.id}" data-teammate="${e.teammateId}" aria-label="Approve ${e.teammateName}: ${e.task}">Approve</button>`
    : approvedBadge;

const invoiceBadge = (status) => html`<span class="status-badge status-${status}">${status === 'open' ? 'Open' : 'Paid'}</span>`;
const callerLabel = (c) => (!c ? '' : c.type === 'key' ? `API key “${c.name}”` : c.type === 'schedule' ? `schedule “${c.name}”` : c.type === 'teammate' ? `${c.name} (teammate)` : c.name ?? c.type);

// ---------- Pieces ----------

function alertsBanner(alerts) {
  if (!alerts.items.length) return '';
  return html`<section class="alert-list" aria-label="Spending alerts">${alerts.items.map(
    (a) => html`<div class="alert-item alert-${a.level}" role="status">${icons.alert}<span>${a.message}</span>${a.kind === 'cap' ? html`<a href="/team/${a.id}">Open profile</a>` : html`<a href="/settings">Budgets</a>`}</div>`,
  )}</section>`;
}

function approvalsCard(approvals) {
  if (!approvals.length) return '';
  return html`
    <section class="card approvals-card" aria-labelledby="ap-h">
      <div class="card-head"><h2 class="card-title" id="ap-h">Waiting for approval</h2><span class="help">Tasks over a teammate's approval threshold, and tool calls with side effects</span></div>
      ${approvals.map((a) => html`
        <div class="approval-row">
          <div class="approval-main">
            ${a.kind === 'action'
              ? html`<div><strong>${a.teammateName}</strong> wants to use <strong>${a.label}</strong>${a.project ? html` · <span class="project-chip">${a.project}</span>` : ''}</div>
                <p class="approval-task">${a.task.length > 400 ? `${a.task.slice(0, 399)}…` : a.task}</p>
                <div class="help">Asked during a task for ${callerLabel(a.caller)} · runs only if you approve</div>`
              : html`<div><strong>${a.teammateName}</strong> · requested by ${callerLabel(a.caller)}${a.project ? html` · <span class="project-chip">${a.project}</span>` : ''}</div>
                <p class="approval-task">${a.task.length > 240 ? `${a.task.slice(0, 239)}…` : a.task}</p>
                <div class="help">Estimated <strong class="num">${money(a.estimate.amount)}</strong> (${hours1(a.estimate.hours)}, ~${tokens(a.estimate.tokens)} tokens) · threshold ${money(a.threshold)} · bill to ${a.costCentre}</div>`}
          </div>
          <div class="approval-actions needs-manager">
            <button type="button" class="btn btn-secondary btn-sm" data-decline="${a.id}">Decline</button>
            <button type="button" class="btn btn-primary btn-sm" data-run="${a.id}">Approve &amp; run</button>
          </div>
        </div>`)}
    </section>`;
}

function hoursView(d, alerts, approvals) {
  const topAmount = Math.max(...d.byTeammate.map((r) => r.amount), 1);
  const modelTotal = d.byModel.reduce((s, m) => s + m.amount, 0);
  const warn = d.budget.pct >= d.budget.warnAtPct;
  return html`
    ${alertsBanner(alerts)}
    <section class="summary-row" aria-label="Period totals">
      <div class="summary-card dark">
        <div class="summary-label">Billed · ${d.range.label}</div>
        <div class="summary-value">${money(d.totals.amount)}</div>
        <div class="summary-detail">${hours(d.totals.hours).replace('h', '')} hours across ${plural(d.totals.teammates, 'teammate')}</div>
      </div>
      <div class="summary-card${warn ? ' warn' : ''}">
        <div class="summary-label">Budget</div>
        <div class="summary-value">${d.budget.pct}%</div>
        <div class="summary-detail">${money(d.budget.used)} of ${money(d.budget.amount)} · ${d.budget.used > d.budget.amount ? html`<strong>${money(d.budget.used - d.budget.amount)} over</strong>` : `${money(d.budget.left)} left`}</div>
        ${meter(d.budget.pct, { label: `${d.budget.pct}% of budget used` })}
        ${d.budget.pending ? html`<div class="summary-detail mt-1">Includes ${money(d.budget.pending)} not yet approved</div>` : ''}
      </div>
      <div class="summary-card">
        <div class="summary-label">Spend by model</div>
        <div class="model-bars" role="img" aria-label="${d.byModel.map((m) => `${m.name} ${money(m.amount)}`).join(', ')}">
          ${d.byModel.map((m) => (m.amount ? html`<span style="flex:${m.amount / (modelTotal || 1)};background:${m.color}"></span>` : ''))}
        </div>
        <div class="model-legend">${d.byModel.map((m) => html`<span>${m.name}<strong>${money(m.amount)}</strong></span>`)}</div>
      </div>
    </section>

    ${approvalsCard(approvals)}

    <div class="content-grid">
      <section class="card" aria-labelledby="ct-h">
        <h2 class="card-title" id="ct-h">Cost by teammate</h2>
        ${d.byTeammate.length
          ? d.byTeammate.map(
              (r) => html`<div class="teammate-row">
                <div class="teammate-info">
                  ${avatar(r.avatar, 40)}
                  <div>
                    <a class="teammate-name" href="/team/${r.id}">${r.name}</a>
                    <div class="teammate-hours">${hours(r.hours)} · ${money(r.rate)}</div>
                  </div>
                </div>
                <div class="bar-track" aria-hidden="true"><div class="bar" style="width:${(r.amount / topAmount) * 100}%;background:${r.model.color}"></div></div>
                <div class="teammate-amount">${money(r.amount)}</div>
              </div>`,
            )
          : html`<p class="muted">No time was logged in this period.</p>`}
      </section>
      <section class="card" aria-labelledby="inv-h">
        <div class="card-head"><h2 class="card-title" id="inv-h">Invoices</h2><button type="button" class="btn btn-secondary btn-sm needs-owner" data-action="close-month">Close a month</button></div>
        ${d.invoices.length
          ? d.invoices.map(
              (i) => html`<button type="button" class="invoice-row" data-invoice="${i.id}" aria-label="Invoice ${i.id}, ${i.monthLabel}, ${money(i.amount)}, ${i.status}">
                <div><div class="invoice-month">${i.monthLabel}</div><div class="invoice-ref">${i.id}${i.status === 'open' && i.dueLabel ? ` · ${i.dueLabel}` : ''}</div></div>
                <div class="invoice-amount">${money(i.amount)}</div>
                ${invoiceBadge(i.status)}
              </button>`,
            )
          : html`<p class="muted">No invoices yet. Close a month to create the first one.</p>`}
        <p class="help mt-2"><a class="text-link" href="/api/billing/export.csv?period=${d.range.period}&offset=${d.range.offset}" download>Export CSV</a> downloads every timesheet entry in ${d.range.label}.</p>
      </section>
    </div>

    <section class="card" aria-labelledby="rv-h">
      <div class="card-head"><h2 class="card-title" id="rv-h">Timesheets to review</h2><span class="help" id="pending-count" aria-live="polite">${reviewHeader(d.review.pendingCount)}</span></div>
      ${d.review.entries.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Teammate</th><th scope="col">Task</th><th scope="col">Cost centre</th><th scope="col">Hours</th><th scope="col">Tokens</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
            <tbody>${d.review.entries.map(
              (e) => html`<tr>
                <td style="white-space:nowrap">${e.teammateName}</td><td>${e.task}${e.callerType === 'key' ? html`<div class="help">via API key “${e.caller}”</div>` : ''}</td><td>${e.costCentre}</td>
                <td>${hours1(e.hours)}</td><td>${tokens(e.tokens)}</td><td>${money(e.amount)}</td>
                <td data-status-cell>${statusCell(e)}</td>
              </tr>`,
            )}</tbody>
          </table></div>
          ${d.review.total > d.review.entries.length ? html`<p class="help mt-2">Showing ${d.review.entries.length} of ${d.review.total} entries, pending first. Export CSV for the full list.</p>` : ''}`
        : html`<p class="muted">No timesheet entries in ${d.range.label}.</p>`}
    </section>`;
}

function tokenTable(caption, rows, { first, firstCell }) {
  if (!rows.length) return '';
  return html`
    <section class="card" aria-labelledby="${caption.replace(/\W+/g, '-')}">
      <h2 class="card-title" id="${caption.replace(/\W+/g, '-')}">${caption}</h2>
      <div class="table-wrap"><table class="table num-table">
        <thead><tr><th scope="col">${first}</th><th scope="col">Tokens</th><th scope="col">Hours</th><th scope="col">Billed</th><th scope="col">API cost</th><th scope="col">Margin</th><th scope="col">API cost / 1M</th><th scope="col">Billed / 1M</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td>${firstCell(r)}</td><td>${tokens(r.tokens)}</td><td>${hours1(r.hours)}</td><td>${money(r.amount)}</td><td>${money(r.apiCost)}</td>
          <td>${money(r.margin)} <span class="help">${pct(r.marginPct)}</span></td><td>${money(r.apiCostPerMTok)}</td><td>${money(r.billedPerMTok)}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>`;
}

function tokensView(t) {
  const share = t.totals.amount ? Math.min(100, (t.totals.apiCost / t.totals.amount) * 100) : 0;
  return html`
    <section class="summary-row summary-row-4" aria-label="Token totals">
      <div class="summary-card dark">
        <div class="summary-label">Tokens · ${t.range.label}</div>
        <div class="summary-value">${tokens(t.totals.tokens)}</div>
        <div class="summary-detail">${plural(t.totals.entries, 'task')} · ${t.tokensPerHour.toLocaleString('en-US')} tokens = 1 billed hour</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">API cost</div>
        <div class="summary-value">${money(t.totals.apiCost)}</div>
        <div class="summary-detail">${money(t.totals.apiCostPerMTok)} per million tokens, at list prices</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Billed</div>
        <div class="summary-value">${money(t.totals.amount)}</div>
        <div class="summary-detail">${money(t.totals.billedPerMTok)} per million tokens</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Margin</div>
        <div class="summary-value">${pct(t.totals.marginPct)}</div>
        <div class="summary-detail">${money(t.totals.margin)} over API cost</div>
        <div class="cost-split" role="img" aria-label="API cost is ${Math.round(share)}% of the billed amount"><span style="width:${share}%"></span></div>
      </div>
    </section>
    ${t.totals.entries
      ? html`<div class="admin-stack">
        ${tokenTable('By teammate', t.byTeammate, { first: 'Teammate', firstCell: (r) => html`<a href="/team/${r.id}">${r.name}</a> <span class="help">${r.modelName}</span>` })}
        ${tokenTable('By model', t.byModel, { first: 'Model', firstCell: (r) => html`<span class="sw" style="background:${r.color}" aria-hidden="true"></span>${r.name}` })}
        ${tokenTable('By cost centre', t.byCostCentre, { first: 'Cost centre', firstCell: (r) => r.name })}
        <p class="help">API cost is the provider's list price for the tokens each task used, recorded when the task ran. Billed is hours × each teammate's rate. Edit list prices under <a href="/settings?tab=models">Settings → Models &amp; pricing</a>.</p></div>`
      : html`<section class="card"><p class="muted">No tasks ran in ${t.range.label}.</p></section>`}`;
}

// ---------- Dialogs ----------

async function closeMonthDialog(onDone, initialMonth = null) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
  let created = null;
  await openDialog({
    title: 'Close a month',
    wide: true,
    body: html`
      <form id="close-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-group" style="max-width:260px">
          <label class="form-label" for="close-month">Month</label>
          <select class="form-input" id="close-month" name="month">${months.map((m) => html`<option value="${m}" ${m === initialMonth ? 'selected' : ''}>${monthLabel(m)}</option>`)}</select>
        </div>
        <div id="close-preview" aria-live="polite"><p class="help">Loading…</p></div>
      </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="close-form" class="btn btn-primary" id="close-submit" disabled>Generate invoice</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#close-form');
      const box = dialog.querySelector('#close-preview');
      const submit = dialog.querySelector('#close-submit');
      let preview = null;
      const load = async () => {
        submit.disabled = true;
        box.innerHTML = String(html`<p class="help">Loading…</p>`);
        try {
          preview = await api.get(`/api/invoices/close-preview?month=${form.month.value}`);
        } catch (err) {
          box.innerHTML = String(html`<p class="field-error">${err.message}</p>`);
          return;
        }
        const p = preview;
        const paid = p.existing?.status === 'paid';
        box.innerHTML = String(html`
          <div class="close-summary">
            <div><div class="preview-label">Approved time</div><div class="close-figure">${money(p.approved.amount)}</div><div class="help">${hours(p.approved.hours)} · ${plural(p.approved.count, 'entry', 'entries')}</div></div>
            <div><div class="preview-label">API cost</div><div class="close-figure">${money(p.approved.apiCost)}</div><div class="help">${tokens(p.approved.tokens)} tokens</div></div>
          </div>
          ${p.existing ? html`<p class="notice${paid ? ' notice-warn' : ''}">${paid
            ? html`${p.existing.id} for ${p.monthLabel} is already paid, so it can't be regenerated. Mark it unpaid first if it needs to change.`
            : html`${p.existing.id} (${money(p.existing.amount)}) already exists for ${p.monthLabel} and is still open. Generating replaces it under the same number.`}</p>` : ''}
          ${p.pending.count ? html`
            <div class="notice notice-warn">
              <p><strong>${plural(p.pending.count, 'entry', 'entries')} (${money(p.pending.amount)}) still ${p.pending.count === 1 ? 'needs' : 'need'} approval.</strong> Approve ${p.pending.count === 1 ? 'it' : 'them'} under Timesheets to review to include ${p.pending.count === 1 ? 'it' : 'them'}.</p>
              <ul class="pending-list">${p.pending.entries.map((e) => html`<li>${e.teammateName} · ${e.task} · ${money(e.amount)}</li>`)}</ul>
              <label class="check-row"><input type="checkbox" name="excludePending"> Close ${p.monthLabel} without ${p.pending.count === 1 ? 'it' : 'them'}</label>
            </div>` : ''}
          ${!p.approved.count ? html`<p class="notice">There is no approved time in ${p.monthLabel} to invoice.</p>` : ''}`);
        const update = () => (submit.disabled = paid || !p.approved.count || (p.pending.count > 0 && !form.excludePending?.checked));
        form.excludePending?.addEventListener('change', update);
        update();
        submit.textContent = p.existing && !paid ? `Regenerate ${p.existing.id}` : 'Generate invoice';
      };
      form.month.addEventListener('change', load);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          created = await api.post('/api/invoices', { month: form.month.value, excludePending: Boolean(form.excludePending?.checked) });
          toast(`${created.id} for ${created.monthLabel}: ${money(created.amount)}`);
          dialog.close('done');
        } catch (err) {
          toast(err.message, { error: true });
          submit.disabled = false;
        }
      });
      load();
    },
  });
  if (created) {
    await onDone();
    await invoiceDialog(created.id, onDone);
  }
}

async function invoiceDialog(id, onChanged) {
  const inv = await api.get(`/api/invoices/${id}`);
  let changed = false;
  await openDialog({
    title: `${inv.id} · ${inv.monthLabel}`,
    wide: true,
    body: html`
      <div class="invoice-head">
        <div><div class="preview-label">Amount</div><div class="close-figure">${money(inv.amount)}</div><div class="help">${inv.hours != null ? `${hours(inv.hours)} · ` : ''}${inv.lines.length ? plural(inv.lines.length, 'entry', 'entries') : 'imported total'}</div></div>
        <div><div class="preview-label">Status</div><div id="inv-status">${invoiceBadge(inv.status)}</div><div class="help" id="inv-paid">${inv.paidAt ? `Paid ${longDate(inv.paidAt)}` : inv.dueDate ? `Due ${longDate(inv.dueDate)}` : ''}</div></div>
        <div><div class="preview-label">Issued</div><div>${inv.issuedAt ? longDate(inv.issuedAt) : 'Imported'}</div>${inv.billTo ? html`<div class="help">Bill to ${inv.billTo}</div>` : ''}</div>
      </div>
      ${inv.excludedPending ? html`<p class="notice notice-warn">Closed without ${plural(inv.excludedPending.count, 'pending entry', 'pending entries')} (${money(inv.excludedPending.amount)}).</p>` : ''}
      ${inv.lines.length
        ? html`<div class="invoice-split">
            <div><h3 class="sub-title">By teammate</h3><table class="table num-table"><tbody>${inv.byTeammate.map((r) => html`<tr><td>${r.name}</td><td>${hours1(r.hours)}</td><td>${money(r.amount)}</td></tr>`)}</tbody></table></div>
            <div><h3 class="sub-title">By cost centre</h3><table class="table num-table"><tbody>${inv.byCostCentre.map((r) => html`<tr><td>${r.name}</td><td>${hours1(r.hours)}</td><td>${money(r.amount)}</td></tr>`)}</tbody></table></div>
          </div>`
        : html`<p class="help">This invoice was imported with a total only, so it has no line items.</p>`}
      <div class="button-group invoice-downloads">
        <a class="btn btn-secondary" href="/api/invoices/${inv.id}/pdf" download>${icons.download}PDF</a>
        <a class="btn btn-secondary" href="/api/invoices/${inv.id}/csv" download>${icons.download}CSV</a>
        ${inv.status === 'open' && inv.lines.length ? html`<button type="button" class="btn btn-secondary needs-owner" id="inv-regen">Regenerate</button>` : ''}
      </div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Close</button>
      <button type="button" class="btn ${inv.status === 'open' ? 'btn-primary' : 'btn-secondary'} needs-owner" id="inv-toggle">${inv.status === 'open' ? 'Mark paid' : 'Mark unpaid'}</button>`,
    setup(dialog) {
      const toggle = dialog.querySelector('#inv-toggle');
      toggle.addEventListener('click', async () => {
        const next = inv.status === 'open' ? 'paid' : 'open';
        toggle.disabled = true;
        try {
          const updated = await api.patch(`/api/invoices/${inv.id}`, { status: next });
          inv.status = updated.status;
          changed = true;
          toast(next === 'paid' ? `${inv.id} marked paid` : `${inv.id} is open again`);
          dialog.close('changed');
        } catch (err) {
          toast(err.message, { error: true });
          toggle.disabled = false;
        }
      });
      dialog.querySelector('#inv-regen')?.addEventListener('click', () => dialog.close('regenerate'));
    },
  }).then(async (result) => {
    if (result === 'regenerate') await closeMonthDialog(onChanged, inv.month);
  });
  if (changed) await onChanged();
}

async function declineDialog(id) {
  let reason = null;
  await openDialog({
    title: 'Decline this task?',
    body: html`<form id="decline-form" class="modal-body" style="padding:0">
      <p>The task won't run. Whoever asked for it sees that it was declined, with your reason.</p>
      <div class="form-group"><label class="form-label" for="decline-reason">Reason <span class="help">(optional)</span></label><input class="form-input" id="decline-reason" name="reason" maxlength="500"></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="decline-form" class="btn btn-primary">Decline task</button>`,
    setup(dialog) {
      dialog.querySelector('#decline-reason').focus();
      dialog.querySelector('#decline-form').addEventListener('submit', (e) => {
        e.preventDefault();
        reason = e.target.reason.value;
        dialog.close('decline');
      });
    },
  });
  if (reason === null) return false;
  await api.post(`/api/approvals/${id}/decline`, { reason });
  return true;
}

// ---------- Page ----------

export async function render(view, { query, ctx }) {
  const state = {
    period: ['week', 'month', 'quarter'].includes(query.get('period')) ? query.get('period') : 'month',
    offset: Number.parseInt(query.get('offset') ?? '0', 10) || 0,
    view: query.get('view') === 'tokens' ? 'tokens' : 'hours',
  };
  const labels = defaultLabels();

  const draw = async () => {
    const tokensMode = state.view === 'tokens';
    const [d, alerts, { approvals }] = await Promise.all([
      api.get(`/api/${tokensMode ? 'billing/tokens' : 'billing'}?period=${state.period}&offset=${state.offset}`),
      tokensMode ? { items: [] } : api.get('/api/alerts'),
      tokensMode ? { approvals: [] } : api.get('/api/approvals?status=pending'),
    ]);
    const url = new URL(location.href);
    url.searchParams.set('period', state.period);
    state.offset ? url.searchParams.set('offset', state.offset) : url.searchParams.delete('offset');
    tokensMode ? url.searchParams.set('view', 'tokens') : url.searchParams.delete('view');
    history.replaceState(null, '', url.pathname + url.search);

    view.innerHTML = String(html`
      <div class="header">
        <div>
          <h1>Billing &amp; timesheets</h1>
          <p class="header-subtitle">${tokensMode
            ? 'What the work cost in tokens and at list prices, next to what was billed for it.'
            : 'Every hour a teammate works is logged, priced at their rate and charged to a cost centre.'}</p>
        </div>
        <div class="billing-controls">
          <div class="segmented" role="group" aria-label="Show billing as">
            <button type="button" class="period-btn" data-view="hours" aria-pressed="${!tokensMode}">Hours</button>
            <button type="button" class="period-btn" data-view="tokens" aria-pressed="${tokensMode}">Tokens</button>
          </div>
          <div class="period-controls" role="group" aria-label="Billing period">
            <button type="button" class="period-step" data-step="-1" aria-label="Previous period">${icons.chevronLeft}</button>
            ${['week', 'month', 'quarter'].map(
              (p) => html`<button type="button" class="period-btn" data-period="${p}" aria-pressed="${state.period === p}">${state.period === p ? d.range.label : labels[p]}</button>`,
            )}
            <button type="button" class="period-step" data-step="1" aria-label="Next period" ${state.offset >= 0 ? 'disabled' : ''}>${icons.chevronRight}</button>
          </div>
        </div>
      </div>
      ${tokensMode ? tokensView(d) : hoursView(d, alerts, approvals)}`);

    let pending = tokensMode ? 0 : d.review.pendingCount;
    view.onclick = async (e) => {
      const period = e.target.closest('[data-period]');
      const step = e.target.closest('[data-step]');
      const mode = e.target.closest('[data-view]');
      const approve = e.target.closest('[data-approve]');
      const invoice = e.target.closest('[data-invoice]');
      const run = e.target.closest('[data-run]');
      const decline = e.target.closest('[data-decline]');
      try {
        if (period && period.dataset.period !== state.period) {
          state.period = period.dataset.period;
          state.offset = 0;
          await draw();
          view.querySelector(`[data-period="${state.period}"]`)?.focus();
        } else if (step && !step.disabled) {
          state.offset = Math.min(0, state.offset + Number(step.dataset.step));
          await draw();
          view.querySelector(`[data-step="${step.dataset.step}"]`)?.focus();
        } else if (mode && mode.dataset.view !== state.view) {
          state.view = mode.dataset.view;
          await draw();
          view.querySelector(`[data-view="${state.view}"]`)?.focus();
        } else if (invoice) {
          await invoiceDialog(invoice.dataset.invoice, draw);
        } else if (e.target.closest('[data-action="close-month"]')) {
          await closeMonthDialog(draw);
        } else if (run) {
          run.disabled = true;
          const result = await api.post(`/api/approvals/${run.dataset.run}/approve`);
          toast(result?.kind === 'action' ? (result.outcome === 'failed' ? `Approved, but it failed: ${result.output}` : 'Approved and done.') : 'Approved. The task is running; its time appears here when it finishes.', { error: result?.outcome === 'failed' });
          await draw();
        } else if (decline) {
          if (await declineDialog(decline.dataset.decline)) {
            toast('Task declined');
            await draw();
          }
        } else if (approve) {
          // Optimistic: flip the row and the counter immediately, roll back on failure.
          const cell = approve.closest('[data-status-cell]');
          const previous = cell.innerHTML;
          cell.innerHTML = String(approvedBadge);
          pending -= 1;
          view.querySelector('#pending-count').textContent = reviewHeader(pending);
          try {
            await api.post(`/api/teammates/${approve.dataset.teammate}/timesheet/${approve.dataset.approve}/approve`);
          } catch (err) {
            cell.innerHTML = previous;
            pending += 1;
            view.querySelector('#pending-count').textContent = reviewHeader(pending);
            throw err;
          }
        }
      } catch (err) {
        if (run) run.disabled = false;
        toast(err instanceof ApiError ? err.message : 'Something went wrong', { error: true });
      }
    };
  };

  // Approvals arriving or finishing elsewhere refresh this page (when no dialog is open).
  const refresh = () => {
    if (!document.querySelector('dialog[open]')) draw().catch(() => {});
  };
  const offApproval = ctx.on('approval', refresh);
  const offAlert = ctx.on('alert', refresh);

  if (!ctx.meta) ctx.refreshMeta();
  await draw();
  return {
    cleanup: () => {
      view.onclick = null;
      offApproval();
      offAlert();
    },
  };
}
