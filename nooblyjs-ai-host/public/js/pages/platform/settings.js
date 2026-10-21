// Platform · Settings (product.md §5.7 item 16, mockup noobly-platform-settings): "Models, budgets and guardrails that
// apply across every NooblyJS system." Tabs Models / Budgets / Guardrails / Integrations / Organisation. Model routes and
// budgets are edited in the page and sent together with Save changes; a guardrail is changed on its own, with a
// reason (it goes in the policy history). The server checks every permission; this page only hides controls.
import { html } from '/ui/js/html.js';
import { button, dataTable, meter, statusPill } from '/ui/js/components/index.js';
import { head, flash, errorText, money, toggle, syncToggle, reasonForm, onChange } from './lib.js';

const LEAD = 'Models, budgets and guardrails that apply across every NooblyJS system.';
const TABS = [
  { key: 'models', label: 'Models' }, { key: 'budgets', label: 'Budgets' }, { key: 'guardrails', label: 'Guardrails' },
  { key: 'integrations', label: 'Integrations' }, { key: 'organisation', label: 'Organisation' },
];

const options = (list, value, { none = null } = {}) => html`${none ? html`<option value=""${!value ? html` selected` : ''}>${none}</option>` : ''}${list.map((o) => html`<option value="${o.id}"${o.id === value ? html` selected` : ''}>${o.label}</option>`)}`;

function models(data, pending, canEdit) {
  const m = data.models;
  const value = (r, k) => pending.routes[r.id]?.[k] ?? r[k];
  return html`<section class="card card--flush" aria-label="Model routing">
    <div class="card__head"><h2 class="card__title">Model routing</h2><span class="card__meta">Which model does which kind of work. Features ask for a kind of work, never a model.</span></div>
    ${dataTable({
      caption: 'Model routing',
      rows: m.routes,
      columns: [
        { key: 'label', label: 'Work', render: (r) => html`<span class="strong">${r.label}</span><span class="repo-sub">${r.systems.join(' · ')}</span>` },
        { key: 'model', label: 'Model', render: (r) => (canEdit ? html`<select class="cell-input" data-route="${r.id}" data-field="model" aria-label="Model for ${r.label}">${options(m.choices.map((c) => ({ id: c.id, label: `${c.label} ${c.tier}` })), value(r, 'model'))}</select>` : `${r.modelLabel} ${r.tier}`) },
        { key: 'fallback', label: 'Fallback', render: (r) => (canEdit ? html`<select class="cell-input" data-route="${r.id}" data-field="fallback" aria-label="Fallback for ${r.label}">${options(m.choices, value(r, 'fallback'), { none: 'No fallback' })}</select>` : r.fallbackLabel ?? '—') },
        { key: 'provider', label: 'Provider', render: (r) => (canEdit ? html`<select class="cell-input" data-route="${r.id}" data-field="provider" aria-label="Provider for ${r.label}">${options(m.providers, value(r, 'provider'))}</select>` : r.providerText) },
        { key: 'spend30', label: 'Spend · 30 days', numeric: true, render: (r) => (r.spend30 ? money(r.spend30) : '—') },
      ],
    })}
    <p class="note card__pad">Until a provider's credentials are set, development uses the Anthropic API and tests use the offline mock. In production only Bedrock, Vertex AI and Azure are allowed.</p>
  </section>`;
}

function budgets(data, pending, canEdit) {
  const b = data.budgets;
  const limitOf = (s) => pending.budgets.systems?.[s.key] ?? s.limit;
  const total = pending.budgets.total ?? b.total.limit;
  const pause = pending.budgets.pauseOnLimit ?? b.pauseOnLimit;
  const month = new Date(`${b.month}-01T00:00:00Z`).toLocaleDateString('en-ZA', { month: 'long', timeZone: 'UTC' });
  const row = (label, spent, limit, input, period) => html`<div class="budget">
    ${meter({ label, value: limit ? `${money(spent)} of ${money(limit)}${period === 'day' ? ' today' : ''}` : `${money(spent)} (no limit)`, ratio: limit ? spent / limit : 0, tone: limit && spent >= limit ? 'danger' : limit && spent >= 0.8 * limit ? 'warning' : undefined })}
    ${input}
  </div>`;
  const amount = (key, value, label) => (canEdit ? html`<label class="field">${label}<input class="cell-input cell-input--money" type="number" min="0" step="1" inputmode="decimal" data-budget="${key}" value="${value ?? ''}"></label>` : '');
  return html`<section class="card card--flush" aria-label="Budgets">
    <div class="card__head"><h2 class="card__title">${month} budgets</h2><span class="card__meta">${money(b.total.spent)} of ${money(total)} across systems</span></div>
    <div class="budgets">
      ${row('All systems', b.total.spent, total, amount('total', total, 'Monthly total ($)'), 'month')}
      ${b.systems.map((s) => row(s.label, s.spent, limitOf(s), amount(s.key, limitOf(s), s.period === 'day' ? 'Daily cap ($)' : 'Monthly ($)'), s.period))}
      <div class="rule">${toggle({ name: 'pauseOnLimit', checked: pause, label: 'Pause all agents when a budget is reached', disabled: !canEdit, attrs: html`data-budget="pauseOnLimit"` })}<span>Pause all agents when a budget is reached</span></div>
    </div>
  </section>`;
}

/** Phase 17: a monthly budget per portfolio, against this month's agent and cloud spend in its value streams. */
function portfolioBudgets(data, canEdit) {
  const pb = data.portfolioBudgets;
  if (!pb?.available) return html`<section class="card" aria-label="Budgets by portfolio"><h2 class="card__title">Budgets by portfolio</h2><p class="note">The Product section is not running here, so there are no portfolios to budget.</p></section>`;
  return html`<section class="card card--flush" aria-label="Budgets by portfolio">
    <div class="card__head"><h2 class="card__title">Budgets by portfolio</h2><span class="card__meta">Agent and cloud spend in its value streams this month; it pauses nothing</span></div>
    <div class="budgets">${pb.portfolios.map((p) => html`<div class="budget">
      ${meter({ label: p.name, value: p.monthly ? `${money(p.spentUsd)} of ${money(p.monthly)} (agent ${money(p.agentUsd)}, cloud ${money(p.cloudUsd)})` : `${money(p.spentUsd)} (no budget)`, ratio: p.monthly ? p.spentUsd / p.monthly : 0, tone: p.monthly && p.spentUsd >= p.monthly ? 'danger' : p.monthly && p.spentUsd >= 0.8 * p.monthly ? 'warning' : undefined })}
      ${canEdit ? html`<label class="field">Monthly ($)<input class="cell-input cell-input--money" type="number" min="0" step="1" inputmode="decimal" data-portfolio-budget="${p.name}" value="${p.monthly ?? ''}"></label>${button({ label: `Save ${p.name}`, kind: 'secondary', small: true, attrs: { 'data-action': 'portfolio-budget', 'data-portfolio': p.name } })}` : ''}
    </div>`)}</div>
  </section>`;
}

function guardrails(data, { canEdit, asking, history }) {
  return html`<section class="card card--flush" aria-label="Guardrails">
    <div class="card__head"><h2 class="card__title">Guardrails</h2><span class="card__meta"><button class="link-button" type="button" data-action="history" aria-expanded="${history ? 'true' : 'false'}">Policy history</button></span></div>
    ${asking ? reasonForm({ id: 'guardrail', title: `Turn ${asking.on ? 'on' : 'off'} "${asking.label}"?`, text: 'It applies to the next agent action, with no restart.', confirm: `Turn ${asking.on ? 'on' : 'off'}` }) : ''}
    <ul class="rules">${data.guardrails.map((g) => html`<li class="rule">
      <span class="rule__text"><span class="rule__label">${g.label}</span><span class="note">${g.scope}${g.locked ? ' · a governance rule: it cannot be turned off' : ''}${!g.enforced && g.enforcedFrom ? ` · recorded now, enforced from ${g.enforcedFrom}` : ''}</span></span>
      ${toggle({ name: g.key, checked: g.on, label: g.label, disabled: !canEdit || g.locked, attrs: html`data-guardrail="${g.key}"` })}
    </li>`)}</ul>
    ${history ? html`<div class="card__pad"><h3 class="strong">Policy history</h3>${dataTable({
      caption: 'Policy history',
      empty: 'No guardrail has been changed in the last 92 days.',
      rows: history,
      columns: [
        { key: 'at', label: 'When', render: (h) => new Date(h.at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) },
        { key: 'actorName', label: 'Who' },
        { key: 'label', label: 'Guardrail', render: (h) => h.label ?? h.guardrail },
        { key: 'to', label: 'Change', render: (h) => `${h.from ? 'On' : 'Off'} → ${h.to ? 'On' : 'Off'}` },
        { key: 'reason', label: 'Why' },
      ],
    })}</div>` : ''}
  </section>`;
}

const integrations = (data) => html`<section class="card card--flush" aria-label="Integrations">
  <div class="card__head"><h2 class="card__title">Integrations</h2><span class="card__meta">Connected when their settings are in NooblyJS's environment. Writing to Bitbucket and Jira is set below.</span></div>
  ${dataTable({
    caption: 'Integrations',
    rows: data.integrations,
    columns: [
      { key: 'label', label: 'Integration', render: (i) => html`<span class="strong">${i.label}</span>${i.account ? html`<span class="repo-sub">as ${i.account}</span>` : ''}` },
      { key: 'stateText', label: 'State', render: (i) => statusPill({ text: i.stateText, tone: i.state === 'connected' ? 'success' : 'neutral' }) },
      { key: 'detail', label: 'What NooblyJS reads', render: (i) => (i.detail ? html`<div class="integration">
          <span>${i.detail}</span>
          ${i.reads?.length ? html`<span class="muted">Reads ${i.reads.join('; ')}.</span>` : ''}
          ${i.cannotRead?.length ? html`<span class="integration__cannot">This token cannot read ${i.cannotRead.join('; ')}.</span>` : ''}
          ${i.warning ? html`<span class="integration__warning">${i.warning}</span>` : ''}
        </div>` : html`<span class="muted">—</span>`) },
    ],
  })}
</section>`;

const WRITE_TONES = { sent: 'success', recorded: 'neutral', 'waiting-approval': 'warning', failed: 'danger', refused: 'danger', discarded: 'neutral' };
const RULE_TEXT = { automatic: 'Automatic', approval: 'Needs approval', off: 'Off' };
const SYSTEM_TEXT = { jira: 'Jira', bitbucket: 'Bitbucket' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Writing to Jira and Bitbucket (Phase 13). They are production systems: NooblyJS records what it would send until a
 * deployment allows writing, an Owner switches a system to Send, and a write credential is set.
 */
function writing(writes, { canEdit, confirming }) {
  if (!writes) return '';
  const systems = Object.entries(writes.systems);
  const open = (writes.outbox?.entries ?? []);
  return html`<section class="card" aria-label="Writing to Jira and Bitbucket">
    <div class="card__head"><h2 class="card__title">Writing to Jira and Bitbucket</h2><span class="card__meta">Production systems. Record only keeps what NooblyJS would send, and sends nothing.</span></div>
    ${writes.enabled ? '' : html`<p class="note" role="status">This NooblyJS is not allowed to write: <code>DEVTOOLS_WRITES</code> is not set. Everything below is recorded only, whatever the switches say.</p>`}
    ${dataTable({
      caption: 'Whether NooblyJS writes to each system',
      rows: systems.map(([key, s]) => ({ key, ...s })),
      columns: [
        { key: 'key', label: 'System', render: (s) => html`<span class="strong">${SYSTEM_TEXT[s.key]}</span>` },
        { key: 'mode', label: 'Writing', render: (s) => html`${statusPill({ text: s.sending ? 'Sending' : 'Record only', tone: s.sending ? 'warning' : 'neutral' })}<span class="repo-sub">${s.sending ? `NooblyJS writes to ${SYSTEM_TEXT[s.key]}.` : s.why}</span>` },
        { key: 'change', label: 'Change', render: (s) => (canEdit ? button({ label: s.mode === 'send' ? 'Switch to Record only' : 'Switch to Send', kind: 'secondary', attrs: { 'data-action': s.mode === 'send' ? 'write-mode' : 'write-confirm', 'data-system': s.key, 'data-mode': 'record' } }) : '') },
      ],
    })}
    ${confirming ? html`<div class="note" role="alertdialog" aria-label="Let NooblyJS write to ${SYSTEM_TEXT[confirming]}?">
      <p><span class="strong">Let NooblyJS write to ${SYSTEM_TEXT[confirming]}?</span> ${confirming === 'jira' ? 'NooblyJS will create an issue for each work item of an approved handoff, comment when a pull request opens, and move an issue forward when a run starts or a pull request is merged.' : 'The Software Factory will push factory/… branches and open pull requests where Platform · Repositories lets agents open them. NooblyJS never merges.'} This is recorded in the audit log.</p>
      <div class="actions">${button({ label: `Yes, send to ${SYSTEM_TEXT[confirming]}`, attrs: { 'data-action': 'write-mode', 'data-system': confirming, 'data-mode': 'send' } })}
      ${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'write-cancel' } })}</div></div>` : ''}
    ${dataTable({
      caption: 'What NooblyJS may write, and the rule for each',
      rows: writes.kinds,
      columns: [
        { key: 'label', label: 'Write', render: (k) => html`<span class="strong">${k.label}</span><span class="repo-sub">${SYSTEM_TEXT[k.system]}</span>` },
        { key: 'rule', label: 'Rule', render: (k) => (canEdit
          ? html`<select class="cell-input" data-write-rule="${k.kind}" aria-label="Rule for ${k.label}">${Object.entries(RULE_TEXT).map(([v, t]) => html`<option value="${v}"${v === k.rule ? html` selected` : ''}>${t}</option>`)}</select>`
          : RULE_TEXT[k.rule]) },
      ],
    })}
    <p class="row__meta">Needs approval: an Approver decides each one on Home · Approvals before it is sent. NooblyJS has no write that merges, deletes or changes a setting.</p>
    <div class="card__head"><h3 class="card__title">Outbox</h3><span class="card__meta">${writes.outbox?.total ?? 0} write${writes.outbox?.total === 1 ? '' : 's'}${writes.outbox?.counts?.recorded ? ` · ${writes.outbox.counts.recorded} recorded, not sent` : ''}</span></div>
    ${open.length ? dataTable({
      caption: 'What NooblyJS wrote, or would have written',
      rows: open,
      columns: [
        { key: 'at', label: 'When', render: (w) => when(w.at) },
        { key: 'summary', label: 'What', render: (w) => html`<span class="strong">${w.kindLabel}</span><span class="repo-sub">${w.state === 'sent' ? 'NooblyJS did' : 'NooblyJS would'} ${w.summary}${w.itemId ? ` · ${w.itemId}` : ''}</span>${w.result?.url ? html`<a href="${w.result.url}" target="_blank" rel="noopener">${w.result.key ?? `#${w.result.id ?? ''}`}</a>` : ''}` },
        { key: 'stateText', label: 'State', render: (w) => html`${statusPill({ text: w.stateText, tone: WRITE_TONES[w.state] ?? 'neutral' })}${w.reason ? html`<span class="repo-sub">${w.reason}</span>` : ''}` },
        { key: 'actions', label: 'Decide', render: (w) => (canEdit && ['recorded', 'failed'].includes(w.state)
          ? html`${button({ label: 'Send now', kind: 'secondary', attrs: { 'data-action': 'write-send', 'data-id': w.id } })} ${button({ label: 'Discard', kind: 'secondary', attrs: { 'data-action': 'write-discard', 'data-id': w.id } })}`
          : w.state === 'waiting-approval' && w.approvalId ? html`<a href="/home/approvals?id=${w.approvalId}">Open the approval</a>` : '') },
      ],
    }) : html`<p class="note">Nothing yet. A write appears here when a handoff is approved or the Software Factory finishes a run on a Bitbucket repository.</p>`}
  </section>`;
}

function organisation(data) {
  const o = data.organisation ?? {};
  const rows = Object.entries(o).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v));
  return html`<section class="card" aria-label="Organisation">
    <div class="card__head"><h2 class="card__title">Organisation</h2><span class="card__meta">data/config/organisation.yaml (read-only here)</span></div>
    ${rows.length ? html`<dl class="defs">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${String(v)}</dd>`)}</dl>` : html`<p class="note">Nothing set yet.</p>`}
  </section>`;
}

export async function render(view, { ctx }) {
  const api = ctx.hostApi;
  let tab = 'models';
  let message = null;
  let asking = null; // the guardrail waiting for a reason: { key, label, on }
  let history = null;
  let pending = { routes: {}, budgets: {} };
  let data = null;
  let writes = null;     // devtools/writes: modes, rules and the outbox (Phase 13)
  let confirming = null; // the system an Owner is about to switch to Send

  const dirty = () => Object.keys(pending.routes).length > 0 || Object.keys(pending.budgets).length > 0;

  async function load() {
    data = await api.get('platform/settings');
    writes = await api.get('devtools/writes').catch(() => null);
  }

  function paint() {
    if (!ctx.isCurrent() || !data) return;
    const canRoute = ctx.can('change-guardrails');
    const canBudget = ctx.can('set-budgets');
    const body = {
      models: () => models(data, pending, canRoute),
      budgets: () => html`${budgets(data, pending, canBudget)}${portfolioBudgets(data, canBudget)}`,
      guardrails: () => guardrails(data, { canEdit: canRoute, asking, history }),
      integrations: () => html`${integrations(data)}${writing(writes, { canEdit: canRoute, confirming })}`,
      organisation: () => organisation(data),
    }[tab]();
    const saveable = canRoute || canBudget;
    view.innerHTML = String(html`${head('Settings', LEAD, saveable ? button({ label: 'Save changes', icon: 'check', disabled: !dirty(), attrs: { 'data-action': 'save' } }) : '')}
    ${flash(message)}
    ${dirty() ? html`<p class="note" role="status">Unsaved changes: ${[Object.keys(pending.routes).length ? 'model routes' : '', Object.keys(pending.budgets).length ? 'budgets' : ''].filter(Boolean).join(' and ')}. Save changes sends them.</p>` : ''}
    <div class="tabs" role="tablist" aria-label="Settings">${TABS.map((t) => html`<button class="tab" type="button" role="tab" id="tab-${t.key}" aria-controls="panel" aria-selected="${t.key === tab ? 'true' : 'false'}" tabindex="${t.key === tab ? '0' : '-1'}" data-tab="${t.key}">${t.label}</button>`)}</div>
    <div id="panel" role="tabpanel" aria-labelledby="tab-${tab}">${body}</div>`);
  }

  async function draw() {
    await load();
    paint();
  }

  async function save() {
    const said = [];
    try {
      for (const [id, patch] of Object.entries(pending.routes)) {
        const { route } = await api.patch(`platform/settings/routes/${encodeURIComponent(id)}`, patch);
        said.push(`"${route.label}" now uses ${route.modelLabel} on ${route.providerText}`);
        delete pending.routes[id];
      }
      if (Object.keys(pending.budgets).length) {
        const result = await api.patch('platform/settings/budgets', pending.budgets);
        said.push('budgets saved');
        for (const r of result.reached ?? []) said.push(`${r.text}: its agents are paused`);
        pending.budgets = {};
      }
      message = { tone: 'ok', text: `Saved: ${said.join('; ')}.` };
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: `${said.length ? `Saved: ${said.join('; ')}. ` : ''}Not saved: ${errorText(err)}` };
    }
    await draw();
  }

  view.addEventListener('click', async (event) => {
    const t = event.target;
    const tabButton = t.closest('[data-tab]');
    if (tabButton) { tab = tabButton.dataset.tab; asking = null; paint(); view.querySelector(`#tab-${tab}`)?.focus(); return; }
    if (t.closest('[data-action="save"]')) return save();
    if (t.closest('[data-action="cancel"]')) { asking = null; return paint(); }
    const write = t.closest('[data-action^="write-"]');
    if (write) {
      const action = write.dataset.action;
      if (action === 'write-confirm') { confirming = write.dataset.system; return paint(); }
      if (action === 'write-cancel') { confirming = null; return paint(); }
      try {
        if (action === 'write-mode') {
          await api.patch('devtools/writes/mode', { system: write.dataset.system, mode: write.dataset.mode });
          message = { tone: 'ok', text: `${SYSTEM_TEXT[write.dataset.system]} is set to ${write.dataset.mode === 'send' ? 'Send' : 'Record only'}.` };
        } else if (action === 'write-send') {
          const r = await api.post(`devtools/writes/${encodeURIComponent(write.dataset.id)}/send`, {});
          message = { tone: 'ok', text: r.state === 'sent' ? 'Sent.' : 'Recorded, not sent.' };
        } else if (action === 'write-discard') {
          await api.post(`devtools/writes/${encodeURIComponent(write.dataset.id)}/discard`, {});
          message = { tone: 'ok', text: 'Discarded. It will not be sent.' };
        }
      } catch (err) {
        if (err?.name === 'AbortError') return undefined;
        message = { tone: 'error', text: errorText(err) };
      }
      confirming = null;
      return draw();
    }
    const portfolioSave = t.closest('[data-action="portfolio-budget"]');
    if (portfolioSave) {
      const name = portfolioSave.dataset.portfolio;
      const value = view.querySelector(`[data-portfolio-budget="${CSS.escape(name)}"]`)?.value?.trim();
      try {
        await api.put(`platform/settings/budgets/portfolios/${encodeURIComponent(name)}`, { monthly: value === '' ? null : Number(value) });
        message = { tone: 'ok', text: value === '' ? `${name} has no budget now.` : `${name}'s budget is ${money(Number(value))} a month.` };
      } catch (err) {
        if (err?.name === 'AbortError') return undefined;
        message = { tone: 'error', text: errorText(err) };
      }
      return draw();
    }
    if (t.closest('[data-action="history"]')) {
      history = history ? null : (await api.get('platform/guardrails/history')).history;
      return paint();
    }
    return undefined;
  }, { signal: ctx.signal });

  // Arrow keys move between tabs (the WAI-ARIA tabs pattern).
  view.addEventListener('keydown', (event) => {
    const current = event.target.closest('[data-tab]');
    if (!current || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const i = TABS.findIndex((x) => x.key === current.dataset.tab);
    tab = TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].key;
    paint();
    view.querySelector(`#tab-${tab}`)?.focus();
  }, { signal: ctx.signal });

  view.addEventListener('change', (event) => {
    const t = event.target;
    if (t.dataset.writeRule) {
      api.patch('devtools/writes/rules', { kind: t.dataset.writeRule, rule: t.value })
        .then(() => { message = { tone: 'ok', text: `Rule saved: ${RULE_TEXT[t.value]}.` }; }, (err) => { message = { tone: 'error', text: errorText(err) }; })
        .then(() => draw());
      return;
    }
    if (t.dataset.route) {
      const route = data.models.routes.find((r) => r.id === t.dataset.route);
      const next = { ...(pending.routes[route.id] ?? {}), [t.dataset.field]: t.value || null };
      // Only what differs from what is saved is pending.
      for (const k of Object.keys(next)) if ((next[k] ?? null) === (route[k] ?? null)) delete next[k];
      if (Object.keys(next).length) pending.routes[route.id] = next;
      else delete pending.routes[route.id];
      message = null;
      return paint();
    }
    if (t.dataset.budget) {
      if (t.dataset.budget === 'pauseOnLimit') {
        syncToggle(t);
        if (t.checked === data.budgets.pauseOnLimit) delete pending.budgets.pauseOnLimit;
        else pending.budgets.pauseOnLimit = t.checked;
      } else if (t.dataset.budget === 'total') {
        pending.budgets.total = Number(t.value);
      } else {
        pending.budgets.systems = { ...(pending.budgets.systems ?? {}), [t.dataset.budget]: Number(t.value) };
      }
      message = null;
      return paint();
    }
    if (t.dataset.guardrail) {
      const g = data.guardrails.find((x) => x.key === t.dataset.guardrail);
      asking = { key: g.key, label: g.label, on: t.checked };
      message = null;
      paint();
      view.querySelector('[data-form="guardrail"] textarea')?.focus();
    }
    return undefined;
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="guardrail"]');
    if (!form) return;
    event.preventDefault();
    try {
      const { guardrail } = await api.patch(`platform/settings/guardrails/${encodeURIComponent(asking.key)}`, { on: asking.on, reason: new FormData(form).get('reason') });
      message = { tone: 'ok', text: `"${guardrail.label}" is ${guardrail.on ? 'on' : 'off'}. It is in the policy history.` };
      asking = null;
      if (history) history = (await api.get('platform/guardrails/history')).history;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: errorText(err) };
    }
    await draw();
  }, { signal: ctx.signal });

  // Other people's changes show without a refresh, unless this person is in the middle of one.
  onChange(ctx, () => (asking || dirty() ? null : draw()), { types: ['budget.', 'guardrail.', 'model_route.', 'teammate.task_finished', 'run.finished'] });
  await draw();
}
