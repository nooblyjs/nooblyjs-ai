// Settings (/settings): budgets, cost centres, owner, billing conversion and alerts; and models & pricing.
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { money, rate } from '../format.js';
import { openDialog, confirmDialog, toast } from '../ui.js';
import { api, ApiError, appUrl, enter } from '../client.js';

const TABS = [['billing', 'Budgets & billing'], ['models', 'Models & pricing'], ['webhooks', 'Webhooks'], ['tools', 'Tools']];
const SUBTITLE = {
  billing: 'Budgets, warnings, cost centres, the team board, time zone and how time is billed.',
  models: 'The models teammates run on, what they cost per hour, and the list prices used to record API cost. Offer more from the providers\' live lists.',
  webhooks: 'Send events to other systems: finished tasks, approvals, messages from teammates, and spending warnings.',
  tools: 'MCP servers whose tools teammates can be allowed to use. Allow them per teammate on their profile.',
};
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// Ids are namespaced per form (`ns`) because the model cards repeat the same field names.
const slug = (key) => key.replace(/\./g, '-');
const errId = (key, ns = '') => `err-${ns}${slug(key)}`;

const field = ({ name, label, value, type = 'number', step = 'any', min, max, help, placeholder, wide = false, attrs = '', ns = '' }) => html`
  <div class="form-group${wide ? ' span-2' : ''}">
    <label class="form-label" for="f-${ns}${slug(name)}">${label}</label>
    <input class="form-input" id="f-${ns}${slug(name)}" name="${name}" type="${type}" ${type === 'number' ? html`step="${step}" inputmode="decimal"` : ''} ${min != null ? html`min="${min}"` : ''} ${max != null ? html`max="${max}"` : ''}
      value="${value ?? ''}" ${placeholder ? html`placeholder="${placeholder}"` : ''} aria-describedby="${errId(name, ns)}${help ? ` help-${ns}${slug(name)}` : ''}" ${attrs}>
    ${help ? html`<span class="help" id="help-${ns}${slug(name)}">${help}</span>` : ''}
    <span class="field-error" id="${errId(name, ns)}"></span>
  </div>`;

function showErrors(form, err, ns = '') {
  for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
  if (!(err instanceof ApiError) || !err.details) return;
  let first = null;
  for (const [key, msg] of Object.entries(err.details)) {
    const slot = form.querySelector(`#${errId(key, ns)}`);
    if (slot) {
      slot.textContent = msg;
      first ??= form.querySelector(`[name="${key}"]`) ?? slot;
    }
  }
  first?.focus?.();
}

// ---------- Budgets & billing ----------

function billingTab(s, teammates = []) {
  return html`
    <form id="settings-form" class="admin-stack" novalidate>
      <section class="card" aria-labelledby="bud-h">
        <h2 class="card-title" id="bud-h">Budgets</h2>
        <p class="help">Spend limits for the whole team, in USD. Time still waiting for approval counts towards them.</p>
        <div class="form-row mt-2">
          ${field({ name: 'budgets.week', label: 'Weekly', value: s.budgets.week, min: 0, step: 50 })}
          ${field({ name: 'budgets.month', label: 'Monthly', value: s.budgets.month, min: 0, step: 100 })}
          ${field({ name: 'budgets.quarter', label: 'Quarterly', value: s.budgets.quarter, min: 0, step: 500 })}
        </div>
      </section>

      <section class="card" aria-labelledby="al-h">
        <h2 class="card-title" id="al-h">Cap &amp; budget warnings</h2>
        <p class="help">You are warned once when a teammate's monthly cap or a budget passes this share, and again when it is used up. Warnings appear on screen and go to webhooks subscribed to <code>budget.*</code> and <code>cap.*</code> events (<a href="${appUrl('/settings?tab=webhooks')}" data-tab="webhooks">Webhooks</a>).</p>
        <div class="form-row mt-2">
          ${field({ name: 'alerts.warnAtPct', label: 'Warn at (% used)', value: s.alerts.warnAtPct, min: 1, max: 100, step: 1 })}
        </div>
      </section>

      <section class="card" aria-labelledby="cc-h">
        <h2 class="card-title" id="cc-h">Cost centres</h2>
        <p class="help">Work is billed to one of these. You can't remove a cost centre a teammate is billed to; move the teammate first.</p>
        <ul class="centre-list" id="centres">${s.costCentres.map((c) => centreItem(c))}</ul>
        <div class="centre-add">
          <label class="visually-hidden" for="centre-new">New cost centre</label>
          <input class="form-input" id="centre-new" maxlength="40" placeholder="e.g. Research">
          <button type="button" class="btn btn-secondary" data-action="add-centre">${icon('plus')}Add</button>
        </div>
        <span class="field-error" id="err-costCentres"></span>
      </section>

      <section class="card" aria-labelledby="bc-h">
        <h2 class="card-title" id="bc-h">Billing</h2>
        <p class="help">Billed hours = tokens ÷ tokens per hour, rounded up to the increment, × the teammate's rate. Changes apply to new work only; logged time keeps its hours.</p>
        <div class="form-row mt-2">
          ${field({ name: 'billing.tokensPerHour', label: 'Tokens per billed hour', value: s.billing.tokensPerHour, min: 1000, step: 1000 })}
          ${field({ name: 'billing.billingIncrementHours', label: 'Billing increment (hours)', value: s.billing.billingIncrementHours, min: 0.01, max: 1, step: 0.01 })}
          ${field({ name: 'billing.invoiceDueDay', label: 'Invoices due on day', value: s.billing.invoiceDueDay, min: 1, max: 28, step: 1, help: 'of the month after the invoiced one' })}
          ${field({ name: 'billing.estimateOutputTokens', label: 'Typical output (tokens)', value: s.billing.estimateOutputTokens, min: 100, step: 100, help: 'used to estimate a task against approval thresholds' })}
          ${field({ name: 'billing.estimateHoursPerMonth', label: 'Hours per month (hire estimate)', value: s.billing.estimateHoursPerMonth, min: 1, max: 744, step: 1 })}
        </div>
      </section>

      <section class="card" aria-labelledby="tb-h">
        <h2 class="card-title" id="tb-h">Team board</h2>
        <p class="help">Where teammates and people say what they are working on, share findings and ask each other. These limits keep agents useful there and stop them talking among themselves without a person (<a href="${appUrl('/board')}">Team board</a>).</p>
        <div class="form-row mt-2">
          ${field({ name: 'board.standupTime', label: 'Stand-up time', value: s.board.standupTime, type: 'text', help: 'Business days, in the time zone below. Each teammate who worked the day before posts Done, Doing and Blocked. Empty: no stand-ups.', attrs: html`maxlength="5" placeholder="09:00" spellcheck="false"` })}
          <div class="form-group">
            <label class="form-label" for="f-board-digestTeammate">Weekly digest by</label>
            <select class="form-input" id="f-board-digestTeammate" name="board.digestTeammate" aria-describedby="${errId('board.digestTeammate')} help-board-digest">
              <option value="">Nobody (no digest)</option>
              ${teammates.filter((t) => !t.retiredAt).map((t) => html`<option value="${t.id}"${s.board.digestTeammate === t.id ? ' selected' : ''}>${t.name} · ${t.role} · ${rate(t.rate)}</option>`)}
            </select>
            <span class="help" id="help-board-digest">On Mondays at the stand-up time. It is a billed task.</span>
            <span class="field-error" id="${errId('board.digestTeammate')}"></span>
          </div>
          ${field({ name: 'board.briefingTokens', label: 'Board briefing (tokens)', value: s.board.briefingTokens, min: 200, max: 8000, step: 100, help: 'How much of the board a task about an item or project reads first' })}
          ${field({ name: 'board.agentPostsPerDay', label: 'Posts a teammate may make a day', value: s.board.agentPostsPerDay, min: 0, max: 500, step: 1 })}
          ${field({ name: 'board.agentRepliesPerDay', label: 'Replies a teammate may make a day', value: s.board.agentRepliesPerDay, min: 0, max: 1000, step: 1 })}
          ${field({ name: 'board.restAfterAgentReplies', label: 'Rest a thread after this many agent replies in a row', value: s.board.restAfterAgentReplies, min: 1, max: 20, step: 1, help: 'Until a person replies' })}
          ${field({ name: 'board.staleClaimHours', label: 'A claim is stale after (business hours)', value: s.board.staleClaimHours, min: 1, max: 720, step: 1 })}
        </div>
      </section>

      <section class="card" aria-labelledby="ow-h">
        <h2 class="card-title" id="ow-h">Owner</h2>
        <p class="help">Shown in the sidebar, on invoices, and as who approved or requested work.</p>
        <div class="form-row mt-2">
          ${field({ name: 'owner.name', label: 'Name', value: s.owner.name, type: 'text', attrs: html`maxlength="60" required` })}
          ${field({ name: 'owner.title', label: 'Title', value: s.owner.title, type: 'text', attrs: html`maxlength="60"` })}
          ${field({ name: 'timezone', label: 'Time zone', value: s.timezone, type: 'text', help: 'IANA name, e.g. Africa/Johannesburg. Schedules run at this local time.', attrs: html`maxlength="60" list="tz-list" spellcheck="false"` })}
        </div>
        <datalist id="tz-list">${(Intl.supportedValuesOf?.('timeZone') ?? ['UTC']).map((z) => html`<option value="${z}"></option>`)}</datalist>
      </section>

      <div class="settings-save">
        <button type="submit" class="btn btn-primary">Save settings</button>
        <span class="help">Every change is recorded in the audit log.</span>
      </div>
    </form>`;
}

const centreItem = (c) => html`<li class="centre-item" data-centre="${c}"><span>${c}</span><button type="button" class="icon-btn" data-remove-centre aria-label="Remove ${c}">${icon('x')}</button></li>`;

function readBillingForm(form) {
  const f = form.elements;
  const v = (name) => f[name].value;
  const out = {
    budgets: { week: v('budgets.week'), month: v('budgets.month'), quarter: v('budgets.quarter') },
    owner: { name: v('owner.name'), title: v('owner.title') },
    billing: Object.fromEntries(['tokensPerHour', 'billingIncrementHours', 'invoiceDueDay', 'estimateOutputTokens', 'estimateHoursPerMonth'].map((k) => [k, v(`billing.${k}`)])),
    alerts: { warnAtPct: v('alerts.warnAtPct') },
    board: Object.fromEntries(['standupTime', 'digestTeammate', 'briefingTokens', 'agentPostsPerDay', 'agentRepliesPerDay', 'restAfterAgentReplies', 'staleClaimHours'].map((k) => [k, v(`board.${k}`)])),
    timezone: v('timezone'),
    costCentres: [...form.querySelectorAll('[data-centre]')].map((li) => li.dataset.centre),
  };
  return out;
}

// ---------- Models & pricing ----------

const SOURCE_TEXT = { catalogue: 'NooblyJS catalogue price', provider: "the provider's own list price", openrouter: 'OpenRouter list price: a reference, check it', local: 'runs locally', unknown: 'price unknown: enter it' };
const tokensText = (n) => (n == null ? '—' : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`);

/**
 * What the providers offer right now (each provider's own list, read with the keys in NooblyJS's environment), to offer
 * to teammates under a tier. Loaded when asked for: it calls every provider.
 */
function availablePanel(available, open) {
  if (!open) {
    return html`<section class="card" aria-labelledby="avail-title"><div class="card-head"><h2 class="card-title" id="avail-title">Offer another model</h2></div>
      <p class="help">See every model your providers offer right now, priced, and offer one to teammates at one of the tiers' rates.</p>
      <div class="d-flex gap-2 mt-2"><button type="button" class="btn btn-secondary" data-action="show-available">Show the providers' models</button></div></section>`;
  }
  if (!available) return html`<section class="card" aria-labelledby="avail-title"><h2 class="card-title" id="avail-title">Offer another model</h2><p class="help" role="status">Asking the providers…</p></section>`;
  const provider = (p) => html`<details class="avail-provider"${p.ok && p.models.some((m) => !m.offeredAs) ? '' : ''}>
      <summary><strong>${p.label}</strong> <span class="help">${p.ok ? `${p.models.length} model${p.models.length === 1 ? '' : 's'}` : `not listed: ${p.message}`}</span></summary>
      ${p.ok ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="${p.label} models"><table class="table avail-table"><caption class="visually-hidden">${p.label} models</caption>
        <thead><tr><th scope="col">Model</th><th scope="col">Context</th><th scope="col">Price per million (in / out)</th><th scope="col">Tier</th><th scope="col"><span class="visually-hidden">Offer</span></th></tr></thead>
        <tbody>${p.models.map((m) => html`<tr>
          <td><span class="strong">${m.label}</span><br><span class="help mono">${m.id}</span>${m.deprecated ? html`<br><span class="help">retires ${longDate(m.deprecated.slice(0, 10))}</span>` : ''}</td>
          <td>${tokensText(m.contextWindow)}</td>
          <td>${m.pricing ? `$${m.pricing.input} / $${m.pricing.output}` : '—'}<br><span class="help">${m.priceNote}</span></td>
          <td>${m.offeredAs ? html`<span class="help">offered</span>` : html`<label class="visually-hidden" for="tier-${p.id}-${m.id}">Tier for ${m.label}</label>
            <select class="form-input" id="tier-${p.id}-${m.id}" data-tier-for="${p.id}:${m.id}">${available.tiers.map((t) => html`<option value="${t}"${t === m.tier ? html` selected` : ''}>${t[0]}${t.slice(1).toLowerCase()}</option>`)}</select>`}</td>
          <td>${m.offeredAs ? html`<span class="help">as ${m.offeredAs}</span>` : html`<button type="button" class="btn btn-secondary btn-sm" data-offer="${p.id}:${m.id}" aria-label="Offer ${m.label}">Offer</button>`}</td>
        </tr>`)}</tbody></table></div>` : ''}
    </details>`;
  return html`<section class="card" aria-labelledby="avail-title">
    <div class="card-head"><h2 class="card-title" id="avail-title">Offer another model</h2>
      <button type="button" class="btn btn-secondary btn-sm" data-action="refresh-available">Ask the providers again</button></div>
    <p class="help">Read from each provider's own list on ${new Date(available.checkedAt).toLocaleString()}. A model offered here bills at its tier's rate; its list price records API cost. ${available.prices.source === 'openrouter' ? 'Where neither NooblyJS nor the provider has a price, OpenRouter\'s list price is used as a reference: check it.' : 'No reference prices could be read just now.'}</p>
    ${available.providers.length ? available.providers.map(provider) : html`<p class="help">No provider is configured: set an API key in NooblyJS's environment.</p>`}
  </section>`;
}

function modelCard(m) {
  const costs = m.computePerHour + m.toolsPerHour;
  const ns = `${m.id}-`;
  return html`
    <section class="card model-settings" aria-labelledby="m-${m.id}">
      <form data-model="${m.id}" novalidate>
        <div class="card-head">
          <h2 class="card-title" id="m-${m.id}"><span class="sw" style="background:${m.color}" aria-hidden="true"></span>${m.name} <span class="help">${m.tier} ${m.symbol}</span></h2>
          <span class="help">${m.provider}${m.priceSource && SOURCE_TEXT[m.priceSource] ? ` · ${SOURCE_TEXT[m.priceSource]}` : ''}</span>
          <span class="review-date${m.reviewStale ? ' stale' : ''}">${m.pricingReviewedAt ? `Prices last reviewed ${longDate(m.pricingReviewedAt)}` : 'Prices never reviewed'}${m.reviewStale ? ' · check them' : ''}</span>
        </div>
        <div class="form-row">
          ${field({ ns, name: 'name', label: 'Name', value: m.name, type: 'text', attrs: html`maxlength="40"` })}
          ${field({ ns, name: 'modelId', label: 'Model id', value: m.modelId, type: 'text', attrs: html`maxlength="100" spellcheck="false"` })}
          ${field({ ns, name: 'description', label: 'Description', value: m.description, type: 'text', wide: true, attrs: html`maxlength="160"` })}
        </div>
        <h3 class="sub-title">Rate card (USD per hour)</h3>
        <div class="form-row">
          ${field({ ns, name: 'baseRate', label: 'Suggested rate', value: m.baseRate, min: 0, step: 0.5, help: 'for new hires on this model' })}
          ${field({ ns, name: 'computePerHour', label: 'Model compute', value: m.computePerHour, min: 0, step: 0.5 })}
          ${field({ ns, name: 'toolsPerHour', label: 'Tools & memory', value: m.toolsPerHour, min: 0, step: 0.5 })}
          <div class="form-group"><span class="form-label">Margin at suggested rate</span><output class="margin-out" data-margin>${rate(m.baseRate - costs)}</output></div>
        </div>
        <h3 class="sub-title">List prices (USD per million tokens)</h3>
        <div class="form-row">
          ${field({ ns, name: 'pricing.input', label: 'Input', value: m.pricing.input, min: 0, step: 0.01 })}
          ${field({ ns, name: 'pricing.output', label: 'Output', value: m.pricing.output, min: 0, step: 0.01 })}
          ${field({ ns, name: 'pricing.cacheRead', label: 'Cache read', value: m.pricing.cacheRead, min: 0, step: 0.01 })}
          ${field({ ns, name: 'pricing.cacheWrite', label: 'Cache write', value: m.pricing.cacheWrite, min: 0, step: 0.01 })}
        </div>
        <div class="d-flex gap-2 mt-2" style="flex-wrap:wrap;align-items:center">
          <button type="submit" class="btn btn-primary">Save ${m.name}</button>
          <button type="button" class="btn btn-secondary" data-reviewed>Prices are current</button>
          <button type="button" class="btn btn-secondary" data-remove-model="${m.id}">Stop offering ${m.name}</button>
          <span class="help">List prices set the recorded API cost of new tasks. Past tasks keep theirs.</span>
        </div>
      </form>
    </section>`;
}

function readModelForm(form) {
  const f = form.elements;
  return {
    name: f.name.value, modelId: f.modelId.value, description: f.description.value,
    baseRate: f.baseRate.value, computePerHour: f.computePerHour.value, toolsPerHour: f.toolsPerHour.value,
    pricing: Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map((k) => [k, f[`pricing.${k}`].value])),
  };
}

// ---------- Webhooks ----------

const deliveryLabel = (d) => (d ? `${d.event}, ${new Date(d.at).toLocaleString()}: ${d.ok ? `OK (HTTP ${d.status})` : `failed (${d.error ?? `HTTP ${d.status}`})`}` : 'Nothing sent yet');

function webhooksTab({ endpoints, events }) {
  return html`
    <div class="admin-stack">
      <section class="card" aria-labelledby="wh-h">
        <div class="card-head"><h2 class="card-title" id="wh-h">Endpoints</h2><button type="button" class="btn btn-primary" data-hook-action="add">${icon('plus')}Add endpoint</button></div>
        ${endpoints.length
          ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table class="table">
              <thead><tr><th scope="col">Name</th><th scope="col">Events</th><th scope="col">Last delivery</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
              <tbody>${endpoints.map((e) => html`<tr>
                <td><strong>${e.name}</strong><div class="help hook-url">${e.url}</div></td>
                <td>${e.events.map((ev) => html`<code class="event-code">${ev}</code> `)}</td>
                <td class="help" id="hook-${e.id}">${deliveryLabel(e.lastDelivery)}</td>
                <td>${e.enabled === false ? html`<span class="status-badge status-revoked">Off</span>` : html`<span class="status-badge status-paid">On</span>`}</td>
                <td><div class="d-flex gap-2">
                  <button type="button" class="btn btn-secondary btn-sm" data-hook-action="test" data-id="${e.id}">Test</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-hook-action="edit" data-id="${e.id}">Edit</button>
                </div></td>
              </tr>`)}</tbody>
            </table></div>`
          : html`<p class="muted">No webhooks yet. Add one to send events to Slack, a ticketing system or your own service.</p>`}
      </section>
      <section class="card" aria-labelledby="ev-h">
        <h2 class="card-title" id="ev-h">Events</h2>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table class="table"><tbody>${Object.entries(events).map(([k, v]) => html`<tr><td><code>${k}</code></td><td>${v}</td></tr>`)}</tbody></table></div>
        <p class="help mt-2">Each delivery is a POST of <code>{ "event", "at", "data" }</code> with <code>X-Teammates-Event</code> and, signed with the endpoint's secret, <code>X-Teammates-Signature: sha256=&lt;HMAC of the body&gt;</code>.</p>
      </section>
    </div>`;
}

async function webhookDialog(existing, events, onSaved) {
  let secret = null;
  await openDialog({
    title: existing ? `Edit “${existing.name}”` : 'Add a webhook endpoint',
    wide: true,
    body: html`
      <form id="hook-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="hk-name">Name</label><input class="form-input" id="hk-name" name="name" maxlength="60" value="${existing?.name ?? ''}" placeholder="e.g. Ops Slack" aria-describedby="err-name"><span class="field-error" id="err-name"></span></div>
          <div class="form-group span-2"><label class="form-label" for="hk-url">URL</label><input class="form-input" id="hk-url" name="url" type="url" value="${existing?.url ?? ''}" placeholder="https://hooks.example.com/teammates" aria-describedby="err-url"><span class="field-error" id="err-url"></span></div>
        </div>
        <fieldset><legend class="form-label">Send these events</legend>
          <div class="key-teammates">${Object.entries(events).map(([k, v]) => html`<label class="check-row" title="${v}"><input type="checkbox" name="events" value="${k}" ${existing?.events.includes(k) ? 'checked' : ''}> <code>${k}</code></label>`)}</div>
          <span class="field-error" id="err-events"></span>
        </fieldset>
        ${existing ? html`<label class="check-row"><input type="checkbox" name="enabled" ${existing.enabled !== false ? 'checked' : ''}> Sending (untick to pause)</label>` : html`<p class="help">A signing secret is created for the endpoint and shown once.</p>`}
      </form>
      <div id="hook-secret" hidden>
        <p><strong>Copy the signing secret now.</strong> It is shown once. Use it to check <code>X-Teammates-Signature</code> on each request.</p>
        <input class="form-input code-input" id="hook-secret-value" readonly aria-label="Signing secret">
      </div>`,
    footer: html`${existing ? html`<button type="button" class="btn btn-danger" id="hook-delete">Delete</button><span class="spacer"></span>` : ''}<button type="button" class="btn btn-secondary" data-close id="hook-cancel">Cancel</button><button type="submit" form="hook-form" class="btn btn-primary" id="hook-submit">${existing ? 'Save' : 'Add endpoint'}</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#hook-form');
      form.elements.name.focus();
      dialog.querySelector('#hook-delete')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `Delete “${existing.name}”?`, message: 'It stops receiving events straight away.', confirmLabel: 'Delete endpoint' }))) return;
        await api.del(`/api/v1/webhooks/${existing.id}`);
        toast('Endpoint deleted');
        dialog.close('deleted');
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements;
        const body = { name: f.name.value, url: f.url.value, events: [...form.querySelectorAll('input[name="events"]:checked')].map((c) => c.value) };
        if (existing) body.enabled = f.enabled.checked;
        try {
          if (existing) {
            await api.patch(`/api/v1/webhooks/${existing.id}`, body);
            toast('Endpoint saved');
            dialog.close('saved');
          } else {
            ({ secret } = await api.post('/api/v1/webhooks', body));
            form.hidden = true;
            dialog.querySelector('#hook-secret').hidden = false;
            dialog.querySelector('#hook-secret-value').value = secret;
            dialog.querySelector('#hook-secret-value').select();
            dialog.querySelector('#hook-submit').hidden = true;
            dialog.querySelector('#hook-cancel').textContent = 'Done';
          }
        } catch (err) {
          showErrors(form, err);
          toast(err.message, { error: true });
        }
      });
    },
  });
  await onSaved();
}

async function webhookAction(btn, draw) {
  const { endpoints, events } = await api.get('/api/v1/webhooks');
  const endpoint = endpoints.find((x) => x.id === btn.dataset.id);
  if (btn.dataset.hookAction === 'add') return webhookDialog(null, events, draw);
  if (btn.dataset.hookAction === 'edit') return webhookDialog(endpoint, events, draw);
  if (btn.dataset.hookAction === 'test') {
    const cell = document.getElementById(`hook-${endpoint.id}`);
    cell.textContent = 'Sending…';
    cell.textContent = deliveryLabel(await api.post(`/api/v1/webhooks/${endpoint.id}/test`));
  }
}

// ---------- Tools (MCP servers) ----------

function toolsTab({ servers }) {
  return html`
    <div class="admin-stack">
      <section class="card" aria-labelledby="mcp-h">
        <div class="card-head"><h2 class="card-title" id="mcp-h">MCP servers</h2><button type="button" class="btn btn-primary" data-mcp-action="add">${icon('plus')}Add server</button></div>
        <p class="help">Teammates reach these over the MCP Streamable HTTP transport. Tools the server marks read-only run straight away; anything else waits for a manager to approve each call.</p>
        ${servers.length
          ? servers.map((sv) => html`
            <div class="mcp-row">
              <div class="mcp-main">
                <div class="skill-name">${sv.name} <code>mcp:${sv.id}</code> ${sv.enabled === false ? html`<span class="status-badge status-revoked">Off</span>` : ''}</div>
                <div class="help">${sv.url}${sv.hasAuth ? ' · sends an Authorization header' : ''}</div>
                <div class="mcp-tools" id="mcp-${sv.id}"></div>
              </div>
              <div class="d-flex gap-2">
                <button type="button" class="btn btn-secondary btn-sm" data-mcp-action="check" data-id="${sv.id}">Check connection</button>
                <button type="button" class="btn btn-secondary btn-sm" data-mcp-action="edit" data-id="${sv.id}">Edit</button>
              </div>
            </div>`)
          : html`<p class="muted mt-2">No MCP servers yet.</p>`}
      </section>
      <section class="card" aria-labelledby="bi-h">
        <h2 class="card-title" id="bi-h">Built-in tools</h2>
        <ul class="tool-list">
          <li><strong>Read web pages</strong> (<code>fetch_url</code>): public http(s) pages only; private and local addresses are blocked.</li>
          <li><strong>Send messages</strong> (<code>notify</code>): goes to webhooks subscribed to <code>teammate.message</code>, after approval.</li>
          <li><strong>Hand work to a teammate</strong> (<code>delegate</code>): set per teammate under “Tools &amp; handoffs”.</li>
        </ul>
      </section>
    </div>`;
}

async function mcpDialog(existing, onSaved) {
  await openDialog({
    title: existing ? `Edit ${existing.name}` : 'Add an MCP server',
    wide: true,
    body: html`
      <form id="mcp-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-row">
          ${existing ? '' : html`<div class="form-group"><label class="form-label" for="mcp-id">Id</label><input class="form-input" id="mcp-id" name="id" maxlength="24" placeholder="e.g. crm" aria-describedby="err-id mcp-id-help"><span class="help" id="mcp-id-help">Lowercase; used in tool names</span><span class="field-error" id="err-id"></span></div>`}
          <div class="form-group"><label class="form-label" for="mcp-name">Name</label><input class="form-input" id="mcp-name" name="name" maxlength="60" value="${existing?.name ?? ''}" aria-describedby="err-name"><span class="field-error" id="err-name"></span></div>
        </div>
        <div class="form-group"><label class="form-label" for="mcp-url">Endpoint URL</label><input class="form-input" id="mcp-url" name="url" type="url" value="${existing?.url ?? ''}" placeholder="https://mcp.example.com/mcp" aria-describedby="err-url"><span class="field-error" id="err-url"></span></div>
        <div class="form-group"><label class="form-label" for="mcp-auth">Authorization header <span class="help">(optional)</span></label><input class="form-input" id="mcp-auth" name="authorization" type="password" autocomplete="off" placeholder="${existing?.hasAuth ? '•••••••• set; leave empty to keep' : 'e.g. Bearer …'}"></div>
        ${existing?.hasAuth ? html`<label class="check-row"><input type="checkbox" name="removeAuth"> Stop sending the Authorization header</label>` : ''}
        ${existing ? html`<label class="check-row"><input type="checkbox" name="enabled" ${existing.enabled !== false ? 'checked' : ''}> Available to teammates</label>` : ''}
      </form>`,
    footer: html`${existing ? html`<button type="button" class="btn btn-danger" id="mcp-delete">Delete</button><span class="spacer"></span>` : ''}<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="mcp-form" class="btn btn-primary">${existing ? 'Save' : 'Add server'}</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#mcp-form');
      (form.elements.id ?? form.elements.name).focus();
      dialog.querySelector('#mcp-delete')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `Delete ${existing.name}?`, message: 'Teammates lose its tools straight away. Queued actions for it will fail if approved.', confirmLabel: 'Delete server' }))) return;
        await api.del(`/api/v1/mcp-servers/${existing.id}`);
        toast('Server deleted');
        dialog.close('deleted');
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements;
        const body = { name: f.name.value, url: f.url.value };
        if (f.removeAuth?.checked) body.authorization = null;
        else if (f.authorization.value) body.authorization = f.authorization.value;
        try {
          if (existing) await api.patch(`/api/v1/mcp-servers/${existing.id}`, { ...body, enabled: f.enabled.checked });
          else await api.post('/api/v1/mcp-servers', { ...body, id: f.id.value });
          toast('Server saved. Use “Check connection” to see its tools.');
          dialog.close('saved');
        } catch (err) {
          showErrors(form, err);
          toast(err.message, { error: true });
        }
      });
    },
  });
  await onSaved();
}

async function mcpAction(btn, draw) {
  if (btn.dataset.mcpAction === 'add') return mcpDialog(null, draw);
  const { servers } = await api.get('/api/v1/mcp-servers');
  const server = servers.find((x) => x.id === btn.dataset.id);
  if (btn.dataset.mcpAction === 'edit') return mcpDialog(server, draw);
  const out = document.getElementById(`mcp-${server.id}`);
  out.textContent = 'Connecting…';
  const r = await api.post(`/api/v1/mcp-servers/${server.id}/check`);
  out.innerHTML = String(r.ok
    ? html`<p class="help">Connected · ${r.tools.length} tools</p><ul class="tool-list">${r.tools.map((t) => html`<li><code>${t.name}</code> ${t.readOnly ? html`<span class="status-badge status-paid">read-only</span>` : html`<span class="status-badge status-open">needs approval</span>`} <span class="help">${t.description ?? ''}</span></li>`)}</ul>`
    : html`<p class="field-error">Could not connect: ${r.error}</p>`);
}

// ---------- Page ----------

let leave = null;

export async function render(frameView, { query, ctx: frame }) {
  const { view, ctx } = await enter(frameView, frame, 'settings');
  let tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'billing';
  // The providers' live lists: shown when asked for (it calls every provider).
  let showAvailable = false;
  let available = null;
  const loadAvailable = async (refresh = false) => {
    available = await api.get(`/api/v1/models/available${refresh ? '?refresh=1' : ''}`);
  };

  const draw = async () => {
    const data = await api.get({ billing: '/api/v1/settings', models: '/api/v1/models', webhooks: '/api/v1/webhooks', tools: '/api/v1/mcp-servers' }[tab]);
    // The board's digest teammate is chosen from the team.
    const team = tab === 'billing' ? (await api.get('/api/v1/teammates').catch(() => ({ teammates: [] }))).teammates : [];
    const url = new URL(location.href);
    tab === 'billing' ? url.searchParams.delete('tab') : url.searchParams.set('tab', tab);
    history.replaceState(null, '', url.pathname + url.search);
    view.innerHTML = String(html`
      <div class="header">
        <div>
          <h1>Settings</h1>
          <p class="header-subtitle">${SUBTITLE[tab]}</p>
        </div>
      </div>
      <nav class="tabs settings-tabs" aria-label="Settings sections">
        ${TABS.map(([key, label]) => html`<a class="tab${tab === key ? ' active' : ''}" href="${appUrl(key === 'billing' ? '/settings' : `/settings?tab=${key}`)}" data-tab="${key}" ${tab === key ? html`aria-current="page"` : ''}>${label}</a>`)}
      </nav>
      ${tab === 'models' ? html`<div class="admin-stack">${availablePanel(available, showAvailable)}${data.models.map(modelCard)}</div>` : tab === 'webhooks' ? webhooksTab(data) : tab === 'tools' ? toolsTab(data) : billingTab(data, team)}`);
  };

  view.onclick = async (e) => {
    const tabLink = e.target.closest('[data-tab]');
    if (tabLink) {
      e.preventDefault();
      e.stopPropagation();
      if (tabLink.dataset.tab !== tab) {
        tab = tabLink.dataset.tab;
        await draw();
        view.querySelector(`[data-tab="${tab}"]`)?.focus();
      }
      return;
    }
    if (e.target.closest('[data-action="add-centre"]')) {
      const input = view.querySelector('#centre-new');
      const name = input.value.trim();
      const err = view.querySelector('#err-costCentres');
      const existing = [...view.querySelectorAll('[data-centre]')].map((li) => li.dataset.centre.toLowerCase());
      if (!name) return input.focus();
      if (existing.includes(name.toLowerCase())) {
        err.textContent = `${name} is already a cost centre`;
        return;
      }
      err.textContent = '';
      view.querySelector('#centres').insertAdjacentHTML('beforeend', String(centreItem(name)));
      input.value = '';
      input.focus();
    } else if (e.target.closest('[data-remove-centre]')) {
      const li = e.target.closest('[data-centre]');
      const next = li.nextElementSibling ?? li.previousElementSibling;
      li.remove();
      (next?.querySelector('button') ?? view.querySelector('#centre-new')).focus();
    } else if (e.target.closest('[data-hook-action]') || e.target.closest('[data-mcp-action]')) {
      try {
        await (e.target.closest('[data-hook-action]') ? webhookAction(e.target.closest('[data-hook-action]'), draw) : mcpAction(e.target.closest('[data-mcp-action]'), draw));
      } catch (err) {
        toast(err.message, { error: true });
      }
    } else if (e.target.closest('[data-action="show-available"], [data-action="refresh-available"]')) {
      const refresh = Boolean(e.target.closest('[data-action="refresh-available"]'));
      showAvailable = true;
      available = refresh ? available : null;
      if (!refresh) await draw();
      try {
        await loadAvailable(refresh);
      } catch (err) {
        toast(err.message, { error: true });
      }
      await draw();
      view.querySelector('#avail-title')?.focus();
    } else if (e.target.closest('[data-offer]')) {
      const key = e.target.closest('[data-offer]').dataset.offer;
      const [provider, ...rest] = key.split(':');
      const modelId = rest.join(':');
      const tier = view.querySelector(`[data-tier-for="${CSS.escape(key)}"]`)?.value;
      try {
        const m = await api.post('/api/v1/models', { provider, modelId, tier });
        toast(`${m.name} is offered to teammates at the ${m.tier.toLowerCase()} rate. ${m.reviewStale ? 'Check its price.' : ''}`);
        await ctx.refreshMeta();
        await loadAvailable();
        await draw();
      } catch (err) {
        toast(err.message, { error: true });
      }
    } else if (e.target.closest('[data-remove-model]')) {
      const id = e.target.closest('[data-remove-model]').dataset.removeModel;
      try {
        await api.del(`/api/v1/models/${id}`);
        toast('No longer offered to teammates.');
        await ctx.refreshMeta();
        if (available) await loadAvailable();
        await draw();
      } catch (err) {
        toast(err.message, { error: true });
      }
    } else if (e.target.closest('[data-reviewed]')) {
      const form = e.target.closest('form');
      try {
        await api.patch(`/api/v1/models/${form.dataset.model}`, { reviewed: true });
        toast('Marked as reviewed today');
        await draw();
      } catch (err) {
        toast(err.message, { error: true });
      }
    }
  };

  view.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.id === 'centre-new') {
      e.preventDefault();
      view.querySelector('[data-action="add-centre"]').click();
    }
  };

  // Live margin on the rate card as numbers change.
  view.oninput = (e) => {
    const form = e.target.closest('form[data-model]');
    if (!form) return;
    const n = (k) => Number(form.elements[k].value) || 0;
    form.querySelector('[data-margin]').textContent = rate(n('baseRate') - n('computePerHour') - n('toolsPerHour'));
  };

  view.onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      if (form.dataset.model) {
        const m = await api.patch(`/api/v1/models/${form.dataset.model}`, readModelForm(form));
        toast(`${m.name} saved`);
      } else {
        const s = await api.patch('/api/v1/settings', readBillingForm(form));
        toast(`Settings saved. Monthly budget ${money(s.budgets.month)}.`);
      }
      await ctx.refreshMeta();
      await draw();
    } catch (err) {
      showErrors(form, err, form.dataset.model ? `${form.dataset.model}-` : '');
      toast(err.message, { error: true });
      button.disabled = false;
    }
  };

  await draw();
  leave = () => {
    view.onclick = null;
    view.onkeydown = null;
    view.oninput = null;
    view.onsubmit = null;
  };
}

/** The frame calls this when the person leaves the page. */
export function destroy() {
  leave?.();
  leave = null;
}
