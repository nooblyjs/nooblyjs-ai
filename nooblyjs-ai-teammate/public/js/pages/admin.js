// Admin (/admin): who can sign in and their roles (managed in nooblyjs-core), API keys for calling teammates, system status and the audit log.
import { api, ApiError } from '../api.js';
import { html } from '../html.js';
import { icons } from '../icons.js';
import { count } from '../format.js';
import { openDialog, confirmDialog, toast } from '../ui.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');

const ACTIONS = {
  'session.login': 'Signed in', 'session.login_failed': 'Failed sign-in', 'session.logout': 'Signed out', 'session.setup': 'Set the owner password',
  'session.sign_out_everywhere': 'Signed out everywhere', 'owner.password_change': 'Changed the password',
  'api_key.create': 'Created an API key', 'api_key.revoke': 'Revoked an API key',
  'teammate.hire': 'Hired', 'teammate.update': 'Edited', 'teammate.persona_edit': 'Edited persona', 'teammate.persona_reset': 'Reset persona',
  'teammate.retire': 'Retired', 'teammate.reinstate': 'Reinstated', 'teammate.skill_add': 'Added a skill', 'teammate.skill_level': 'Changed a skill level',
  'teammate.skill_remove': 'Removed a skill', 'memory.reset': 'Reset memory', 'memory.delete': 'Deleted a memory', 'memory.pin': 'Pinned a memory', 'memory.unpin': 'Unpinned a memory',
  'timesheet.approve': 'Approved time', 'skill.create': 'Created a skill', 'skill.update': 'Edited a skill',
  'knowledge.create': 'Added a document', 'knowledge.update': 'Edited a document', 'knowledge.delete': 'Deleted a document',
  'invoice.create': 'Closed a month', 'invoice.regenerate': 'Regenerated an invoice', 'invoice.paid': 'Marked an invoice paid', 'invoice.reopen': 'Marked an invoice unpaid',
  'approval.approve': 'Approved a task', 'approval.decline': 'Declined a task', 'settings.update': 'Changed settings', 'model.update': 'Changed model pricing',
  'user.create': 'Added a person', 'user.update': 'Changed a person', 'user.password_reset': 'Reset a password', 'user.password_change': 'Changed their password',
  'webhook.create': 'Added a webhook', 'webhook.update': 'Changed a webhook', 'webhook.delete': 'Deleted a webhook',
  'mcp.create': 'Added an MCP server', 'mcp.update': 'Changed an MCP server', 'mcp.delete': 'Deleted an MCP server',
  'schedule.create': 'Added a schedule', 'schedule.update': 'Changed a schedule', 'schedule.delete': 'Deleted a schedule', 'schedule.run': 'Ran a schedule now',
};

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', viewer: 'Viewer' };

/** People who can sign in (nooblyjs-core users) and the Teammates role their core roles give them. */
function usersTable(users, me) {
  if (!users.length) return html`<p class="help">Nobody can sign in yet.</p>`;
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Teammates role</th><th scope="col">Core roles</th><th scope="col">Last sign-in</th></tr></thead>
    <tbody>${users.map((u) => html`<tr>
      <td><strong>${u.name}</strong>${u.email === me ? html` <span class="help">(you)</span>` : ''}${u.active ? '' : html` <span class="status-badge status-revoked">Inactive</span>`}</td>
      <td><code>${u.email}</code></td>
      <td>${ROLE_LABEL[u.role]}</td>
      <td>${u.coreRoles.join(', ') || '—'}</td>
      <td>${when(u.lastLogin)}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

function keysTable(keys, names) {
  if (!keys.length) return html`<p class="muted">No API keys yet. Create one to let another system call a teammate.</p>`;
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Can call</th><th scope="col">Limit</th><th scope="col">Last used</th><th scope="col">Calls</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
    <tbody>${keys.map((k) => html`<tr>
      <td><strong>${k.name}</strong><div class="help">Created ${when(k.createdAt)}</div></td>
      <td><code class="key-prefix">${k.prefix}</code></td>
      <td>${k.teammates === '*' ? 'All teammates' : k.teammates.map((id) => names.get(id) ?? id).join(', ')}</td>
      <td>${k.rateLimit} / min</td>
      <td>${when(k.lastUsedAt)}</td>
      <td>${count(k.uses)}</td>
      <td>${k.revokedAt ? html`<span class="status-badge status-revoked">Revoked</span>` : html`<span class="status-badge status-paid">Active</span>`}</td>
      <td>${k.revokedAt ? '' : html`<button type="button" class="btn btn-secondary btn-sm" data-revoke="${k.id}" data-name="${k.name}">Revoke</button>`}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

function auditTable(entries) {
  if (!entries.length) return html`<p class="muted">Nothing recorded yet.</p>`;
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Target</th><th scope="col">Detail</th></tr></thead>
    <tbody>${entries.map((e) => html`<tr>
      <td style="white-space:nowrap">${when(e.ts)}</td><td>${e.actor}</td><td>${ACTIONS[e.action] ?? e.action}</td><td>${e.target}</td>
      <td class="audit-detail" title="${e.detail}">${e.detail}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

async function createKey(teammates) {
  await openDialog({
    title: 'Create an API key',
    wide: true,
    body: html`
      <form id="key-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="k-name">Name</label><input class="form-input" id="k-name" name="name" maxlength="60" placeholder="e.g. CI pipeline" required aria-describedby="err-name"><span class="field-error" id="err-name"></span></div>
          <div class="form-group"><label class="form-label" for="k-limit">Calls per minute</label><input class="form-input" id="k-limit" name="rateLimit" type="number" min="1" max="600" value="30" aria-describedby="err-rateLimit"><span class="field-error" id="err-rateLimit"></span></div>
        </div>
        <fieldset>
          <legend class="form-label">Which teammates can it call?</legend>
          <label class="memory-option"><input class="hidden-radio" type="radio" name="scope" value="all" checked><div class="memory-label">All teammates</div><div class="memory-desc">Including anyone you hire later.</div></label>
          <label class="memory-option"><input class="hidden-radio" type="radio" name="scope" value="some"><div class="memory-label">Only the ones I choose</div><div class="memory-desc">Calls to anyone else are refused.</div></label>
          <div class="key-teammates" id="key-teammates" hidden>
            ${teammates.map((t) => html`<label class="check-row"><input type="checkbox" name="teammates" value="${t.id}"> ${t.name} <span class="help">${t.role}</span></label>`)}
          </div>
          <span class="field-error" id="err-teammates"></span>
        </fieldset>
        <p class="help">The key can only call teammates (<code>POST /api/teammates/:id/tasks</code>). It cannot read billing or memory, or change anything.</p>
      </form>
      <div id="key-created" hidden>
        <p><strong>Copy this key now.</strong> It is shown once and only a hash is stored, so it can't be shown again.</p>
        <div class="key-reveal"><input class="form-input code-input" id="key-value" readonly aria-label="New API key"><button type="button" class="btn btn-secondary" id="key-copy">${icons.copy}Copy</button></div>
      </div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close id="key-cancel">Cancel</button><button type="submit" form="key-form" class="btn btn-primary" id="key-submit">Create key</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#key-form');
      const list = dialog.querySelector('#key-teammates');
      form.addEventListener('change', (e) => {
        if (e.target.name === 'scope') list.hidden = e.target.value !== 'some';
      });
      dialog.querySelector('#k-name').focus();
      dialog.querySelector('#key-copy').addEventListener('click', async () => {
        const input = dialog.querySelector('#key-value');
        try {
          await navigator.clipboard.writeText(input.value);
          toast('Key copied');
        } catch {
          input.select();
          toast('Press Ctrl+C (or ⌘C) to copy the selected key');
        }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
        const f = form.elements;
        const some = f.scope.value === 'some';
        const chosen = [...form.querySelectorAll('input[name="teammates"]:checked')].map((c) => c.value);
        if (!f.name.value.trim()) return (dialog.querySelector('#err-name').textContent = 'Give the key a name');
        if (some && !chosen.length) return (dialog.querySelector('#err-teammates').textContent = 'Choose at least one teammate');
        try {
          const { key } = await api.post('/api/admin/keys', { name: f.name.value, rateLimit: Number(f.rateLimit.value), teammates: some ? chosen : '*' });
          form.hidden = true;
          dialog.querySelector('#key-created').hidden = false;
          dialog.querySelector('#key-value').value = key;
          dialog.querySelector('#key-value').select();
          dialog.querySelector('#key-submit').hidden = true;
          dialog.querySelector('#key-cancel').textContent = 'Done';
        } catch (err) {
          if (err instanceof ApiError && err.details) {
            for (const [k, msg] of Object.entries(err.details)) {
              const slot = dialog.querySelector(`#err-${k}`);
              if (slot) slot.textContent = msg;
            }
          }
          toast(err.message, { error: true });
        }
      });
    },
  });
}

const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const stat = (label, value, note) => html`<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${note ? html`<div class="help">${note}</div>` : ''}</div>`;

/** nooblyjs-core services: document cache, webhook queue, schedule check and since-start metrics. */
function systemCard(sys) {
  if (!sys) return html`<p class="help">System status is not available right now.</p>`;
  const m = (name) => sys.metrics[name] ?? { count: 0, sum: 0, avg: 0 };
  const c = sys.cache;
  const q = sys.webhookQueue;
  const s = sys.scheduleCheck;
  const check = s.mode === 'off' ? 'Off' : s.mode === 'timer' ? `Every ${s.intervalSeconds} s` : !s.registered ? 'Not registered' : s.enabled ? `Every ${s.intervalSeconds} s` : 'Paused';
  const beat = s.lastFinishedAt ? `Last ${when(s.lastFinishedAt)}` : s.mode === 'core' ? 'Waiting for the first check' : '';
  const delivered = m('webhook.delivered').count;
  const failed = m('webhook.failed').count;
  return html`<div class="system-grid">
    ${stat('Tasks finished', count(m('task.completed').count), `${count(m('task.failed').count)} failed · avg ${ms(m('task.duration_ms').avg)}`)}
    ${stat('Webhook deliveries', count(delivered + failed), delivered + failed ? `${pct(delivered, delivered + failed)} delivered · ${count(m('webhook.retry_scheduled').count)} retries` : 'None yet')}
    ${stat('Webhook queue', q ? `${count(q.waiting + q.inFlight)} sending` : '—', q ? `${count(q.retrying)} waiting to retry` : '')}
    ${stat('Schedule check', check, beat)}
    ${stat('Document cache', pct(c.hits, c.hits + c.misses), `hit rate · ${count(c.documents)} documents held`)}
    ${stat('API requests', count(m('http.request_ms').count), `avg ${ms(m('http.request_ms').avg)} · ${count(m('http.server_error').count)} errors`)}
  </div>`;
}

export async function render(view, { ctx }) {
  const draw = async () => {
    const [{ keys }, { entries }, { teammates }, { users }, sys] = await Promise.all([
      api.get('/api/admin/keys'), api.get('/api/admin/audit?limit=60'), api.get('/api/teammates'), api.get('/api/admin/users'), api.get('/api/admin/system').catch(() => null),
    ]);
    const names = new Map(teammates.map((t) => [t.id, t.name]));
    const example = teammates[0]?.id ?? 'ada-quill';
    view.innerHTML = String(html`
      <div class="header">
        <div>
          <h1>Admin</h1>
          <p class="header-subtitle">People and their roles, API keys that let other systems call your teammates, and system status. Everything you change is recorded in the audit log.</p>
        </div>
      </div>
      <div class="admin-stack">
        <section class="card" aria-labelledby="people-h">
          <div class="card-head"><h2 class="card-title" id="people-h">People</h2><a class="btn btn-primary" href="${ctx.session?.links?.people ?? '/services/authservice/'}">Manage people</a></div>
          <p class="help">People sign in with nooblyjs-core. Add them, reset passwords and give roles on its Authentication dashboard (core admins only). A core <code>admin</code> or <code>owner</code> is an owner here (everything, including billing, settings and people); <code>manager</code> assigns and approves work and edits teammates and schedules; anyone else is a viewer (read-only). Role changes apply straight away.</p>
          ${usersTable(users, ctx.session?.user?.id)}
        </section>

        <section class="card" aria-labelledby="keys-h">
          <div class="card-head"><h2 class="card-title" id="keys-h">API keys</h2><button type="button" class="btn btn-primary" data-action="create-key">${icons.plus}Create key</button></div>
          ${keysTable(keys, names)}
        </section>

        <section class="card" aria-labelledby="call-h">
          <h2 class="card-title" id="call-h">Calling a teammate</h2>
          <p class="help">Send the key as a bearer token. Add <code>"stream": true</code> for server-sent events, <code>"thread"</code> to follow up on earlier work, and <code>"project"</code> to keep work for different clients apart.</p>
          <pre class="code-block">curl -X POST ${location.origin}/api/teammates/${example}/tasks \\
  -H "Authorization: Bearer dtk_…" -H "Content-Type: application/json" \\
  -d '{"task": "Summarise the support themes from this week", "project": "acme"}'</pre>
        </section>

        <section class="card" aria-labelledby="system-h">
          <div class="card-head"><h2 class="card-title" id="system-h">System</h2><a class="btn btn-secondary" href="/services/" target="_blank" rel="noopener">Service dashboards</a></div>
          <p class="help">Logging, caching, queueing, scheduling and metrics run on nooblyjs-core. Figures are since the server started${sys ? html`; logs are written to <code>${sys.logs.dir}</code>` : ''}. The service dashboards are for core admins.</p>
          ${systemCard(sys)}
        </section>

        <section class="card" aria-labelledby="audit-h">
          <div class="card-head"><h2 class="card-title" id="audit-h">Audit log</h2><span class="help">Latest ${entries.length} entries · stored in data/system/audit/</span></div>
          ${auditTable(entries)}
        </section>
      </div>`);
  };

  view.onclick = async (e) => {
    const btn = e.target.closest('[data-action], [data-revoke]');
    if (!btn) return;
    try {
      if (btn.dataset.action === 'create-key') {
        const { teammates } = await api.get('/api/teammates');
        await createKey(teammates);
        await draw();
      } else if (btn.dataset.revoke) {
        const ok = await confirmDialog({ title: `Revoke “${btn.dataset.name}”?`, message: 'Anything using this key stops working straight away. This cannot be undone.', confirmLabel: 'Revoke key' });
        if (!ok) return;
        await api.del(`/api/admin/keys/${btn.dataset.revoke}`);
        toast('Key revoked');
        await draw();
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  };

  await draw();
  return {
    cleanup: () => {
      view.onclick = null;
    },
  };
}
