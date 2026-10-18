// Home · Approvals (product.md §5.2, mockup noobly-platform-approvals): decisions only a person can make. The queue on
// the left, the selected approval on the right, and the Who approves what table below. The server decides who may
// approve; this page only shows why a decision isn't yours and never hides the rule behind a missing button.
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { pageHead, chips, button, statusPill, dataTable, notice } from '/ui/js/components/index.js';
import { workflowsApi, onChange, engineMissing, isMissing, money, dayLabel, timeText } from './lib.js';

const HEAD = { eyebrow: 'NooblyJS · Approvals', title: 'Approvals' };
const TABS = ['mine', 'others', 'done'];
const EMPTY = { mine: 'Nothing is waiting on you.', others: 'Nothing is waiting on anyone else.', done: 'No decisions yet this week.' };

const queue = (rows, selected, tab) => (rows.length
  ? html`<ul class="queue" role="list">${rows.map((r) => html`<li><a class="queue__item" href="/home/approvals?tab=${tab}&id=${r.id}" data-approval="${r.id}"${r.id === selected ? html` aria-current="true"` : ''}>
      <span class="queue__top">${statusPill({ text: r.tag, tone: r.tone, dot: false })}<span class="queue__age${r.due ? ` queue__age--${r.due.tone}` : ''}">${r.status === 'open' ? `${r.age}${r.due ? ` · ${r.due.text}` : ''}` : `${r.status === 'approved' ? 'Approved' : 'Changes requested'}${r.decidedByName ? ` by ${r.decidedByName}` : ''}`}</span></span>
      <span class="queue__title">${r.title}</span>
      <span class="row__meta">${r.line}</span>
    </a></li>`)}</ul>`
  : html`<p class="row__meta queue__empty">${EMPTY[tab]}</p>`);

function detail(a, now, message) {
  const readiness = a.readiness
    ? html`<div class="fact"><span class="fact__label">Readiness</span><span class="fact__value">${a.readiness.passed} of ${a.readiness.total} checks</span><span class="fact__note${a.readiness.failing.length ? ' fact__note--warning' : ''}">${a.readiness.failing.length ? a.readiness.failing.map((c) => c.text).join(', ') : 'All checks pass'}</span></div>`
    : '';
  const others = html`<div class="fact"><span class="fact__label">Other reviewers</span><span class="fact__value">${a.others.total ? `${a.others.approved} of ${a.others.total} approved` : 'None'}</span><span class="fact__note">${a.others.names.join(', ') || 'You are the only reviewer'}</span></div>`;
  const cost = a.cost ? html`<div class="fact"><span class="fact__label">Agent cost so far</span><span class="fact__value">${money(a.cost.usd)}</span><span class="fact__note">${a.cost.note ?? ''}</span></div>` : '';
  const late = [
    ...a.reminders.map((r) => `Reminder sent to ${r.toNames.join(', ')} · ${dayLabel(r.at, now)} ${timeText(r.at, now)}`),
    a.escalated ? `Escalated to ${a.escalated.toNames.join(', ')} · ${dayLabel(a.escalated.at, now)} ${timeText(a.escalated.at, now)}` : null,
    a.override ? `Readiness overridden by ${a.override.byName}: ${a.override.reason}` : null,
  ].filter(Boolean);
  const failing = a.readiness?.failing.length > 0;
  const form = a.decide.can ? html`<form class="form" data-form="decide">
      <label class="field">Comment (optional)<textarea name="comment" rows="3" maxlength="2000" placeholder="Add a note for the next stage"></textarea></label>
      ${failing && a.decide.needsReadiness ? html`<label class="field field--warning">Readiness is ${a.readiness.passed} of ${a.readiness.total} (${a.readiness.failing.map((c) => c.text).join(', ')}). To approve anyway, say why<textarea name="override" rows="2" maxlength="2000"></textarea></label>` : ''}
      <div class="actions">
        ${button({ label: a.decide.approveLabel, type: 'submit', attrs: { name: 'decision', value: 'approve' } })}
        ${button({ label: 'Request changes', kind: 'secondary', type: 'submit', attrs: { name: 'decision', value: 'request-changes' } })}
      </div>
      ${a.decide.eligible.length ? html`<div class="reassign"><label class="field">Reassign to<select name="to">${a.decide.eligible.map((p) => html`<option value="${p.id}">${p.name} · ${p.accessRole}</option>`)}</select></label>${button({ label: 'Reassign', kind: 'secondary', type: 'submit', attrs: { name: 'decision', value: 'reassign' } })}</div>` : ''}
    </form>` : html`<p class="cannot" role="note">${icon('info', { size: 18 })}<span>${a.decide.cannot}</span></p>`;

  return html`<div class="detail__head">
      <div class="detail__meta">${statusPill({ text: a.label, tone: 'info', dot: false })}<span>Requested by ${a.requestedByName} · ${a.age} ago${a.version ? ` · v${a.version}` : ''}</span></div>
      <h2 class="detail__title" tabindex="-1">${a.subject && a.type === 'adr' ? `${a.subject} · ${a.title}` : a.title}</h2>
      ${a.from || a.to ? html`<div class="move"><span class="move__from">${a.from ?? a.itemStage}</span>${icon('handoff', { size: 18, label: 'to' })}<span class="move__to">${a.to}</span></div>` : ''}
    </div>
    ${message ? html`<p class="flash flash--${message.tone}" role="${message.tone === 'error' ? 'alert' : 'status'}">${message.text}</p>` : ''}
    ${a.summary ? html`<div class="detail__block"><span class="eyebrow">What you're approving</span><p class="detail__summary">${a.summary}</p><span class="detail__links">${a.links.artefact ? html`<a href="${a.links.artefact}">${a.links.artefactLabel}</a>` : ''}<a href="${a.links.item}">${a.itemRef} in Lifecycle</a></span></div>` : html`<div class="detail__block"><span class="detail__links"><a href="${a.links.item}">${a.itemRef} in Lifecycle</a></span></div>`}
    <div class="facts">${readiness}${others}${cost}</div>
    ${late.length ? html`<ul class="late">${late.map((t) => html`<li>${t}</li>`)}</ul>` : ''}
    ${a.next ? html`<div class="detail__block"><span class="eyebrow">What happens next</span><p class="detail__next">${a.next}</p></div>` : ''}
    ${form}`;
}

export async function render(view, { ctx, query }) {
  const api = workflowsApi(ctx);
  let tab = TABS.includes(query.get('tab')) ? query.get('tab') : 'mine';
  let selected = query.get('id');
  let message = null;
  let list;

  const typing = () => [...view.querySelectorAll('[data-detail] textarea')].some((t) => t.value.trim());

  async function drawDetail() {
    const panel = view.querySelector('[data-detail]');
    if (!panel) return;
    if (!selected) {
      panel.innerHTML = String(html`<p class="row__meta">${EMPTY[tab]} Pick another tab to see the rest.</p>`);
      return;
    }
    try {
      const data = await api.get(`approvals/${encodeURIComponent(selected)}`);
      if (!ctx.isCurrent()) return;
      panel.innerHTML = String(detail(data.approval, data.at, message));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      panel.innerHTML = String(notice({ title: 'This approval could not be shown', text: err.message, tone: 'muted' }));
    }
  }

  function drawQueue() {
    view.querySelector('[data-queue]').innerHTML = String(queue(list.rows, selected, tab));
    view.querySelector('[data-tabs]').innerHTML = String(chips({ label: 'Which approvals', name: 'tab', current: tab, items: [
      { value: 'mine', label: 'Waiting on you', count: list.counts.mine },
      { value: 'others', label: 'Waiting on others', count: list.counts.others },
      { value: 'done', label: 'Done this week', count: list.counts.done },
    ] }));
    view.querySelector('[data-summary]').textContent = `Decisions only a person can make. ${list.summary}`;
  }

  async function load({ keepSelection = true } = {}) {
    list = await api.get('approvals', { query: { tab } });
    if (!keepSelection || !selected) selected = list.rows[0]?.id ?? null;
  }

  const remember = () => history.replaceState({}, '', `/home/approvals?tab=${tab}${selected ? `&id=${selected}` : ''}`);

  let rules;
  try {
    [, rules] = await Promise.all([load(), api.get('rules')]);
  } catch (err) {
    if (isMissing(err)) return engineMissing(view, { ...HEAD, lead: 'Decisions only a person can make.' });
    throw err;
  }
  if (!ctx.isCurrent()) return;

  view.innerHTML = String(html`<header class="page-head"><div class="page-head__text"><span class="eyebrow">${HEAD.eyebrow}</span><h1 class="page-title">${HEAD.title}</h1><p class="lead" data-summary aria-live="polite"></p></div><div class="actions" data-tabs></div></header>
    <div class="approvals">
      <section class="approvals__queue" aria-label="Queue" data-queue></section>
      <section class="card detail" aria-label="Selected approval" data-detail></section>
    </div>
    <section class="card card--flush" aria-label="Approval rules">
      <div class="card__head"><h2 class="card__title">Who approves what</h2><a href="/home/teams">Edit in Teams &amp; roles</a></div>
      ${dataTable({ caption: 'Who approves what', rows: rules.rules, columns: [
        { key: 'decision', label: 'Decision', render: (r) => html`<strong class="rule__decision">${r.decision}</strong>` },
        { key: 'approver', label: 'Approver' }, { key: 'target', label: 'Target time' }, { key: 'ifLate', label: 'If late' },
      ] })}
    </section>`);
  drawQueue();
  await drawDetail();

  view.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-tab]');
    const row = event.target.closest('[data-approval]');
    if (chip) {
      if (chip.dataset.tab === tab) return;
      tab = chip.dataset.tab;
      message = null;
      await load({ keepSelection: false });
      drawQueue();
      await drawDetail();
      remember();
      view.querySelector(`[data-tab="${tab}"]`)?.focus();
    } else if (row && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      // Stay on the page: selecting an approval swaps the panel and moves focus to its heading.
      event.preventDefault();
      selected = row.dataset.approval;
      message = null;
      drawQueue();
      await drawDetail();
      remember();
      view.querySelector('.detail__title')?.focus();
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="decide"]');
    if (!form) return;
    event.preventDefault();
    const decision = event.submitter?.value;
    const fields = Object.fromEntries(new FormData(form));
    const id = selected;
    for (const b of form.querySelectorAll('button')) b.disabled = true;
    try {
      let result;
      if (decision === 'reassign') result = await api.post(`approvals/${id}/reassign`, { to: fields.to, reason: fields.comment || undefined });
      else {
        if (decision === 'request-changes' && !fields.comment?.trim()) throw new Error('Say what needs to change in the comment, then request changes.');
        result = await api.post(`approvals/${id}/decision`, {
          decision, comment: fields.comment || undefined,
          ...(decision === 'approve' && fields.override?.trim() ? { override: { reason: fields.override } } : {}),
        });
      }
      message = { tone: 'ok', text: result.text };
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: err.message };
    }
    await load();
    drawQueue();
    await drawDetail();
    view.querySelector('.flash')?.focus?.();
  }, { signal: ctx.signal });

  onChange(ctx, async () => {
    await load();
    drawQueue();
    // Don't redraw the panel under someone who is typing a comment.
    if (!typing()) await drawDetail();
  }, { types: ['approval.', 'item.', 'readiness.', 'handoff.', 'clock.'] });
}
