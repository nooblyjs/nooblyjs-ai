// Admin (/admin): API keys for calling teammates, the owner password, sessions and the audit log.
import { api, ApiError, setCsrf } from '../api.js';
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
const ROLE_HELP = { owner: 'Everything, including billing, settings and people', manager: 'Assign and approve work, edit teammates and schedules', viewer: 'Read-only' };

function usersTable(users, me) {
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
    <tbody>${users.map((u) => html`<tr>
      <td><strong>${u.name}</strong>${u.id === me ? html` <span class="help">(you)</span>` : ''}${u.mustChangePassword ? html`<div class="help">Still on a temporary password</div>` : ''}</td>
      <td><code>${u.username}</code></td>
      <td>${u.id === me
        ? html`${u.role[0].toUpperCase()}${u.role.slice(1)}`
        : html`<label class="visually-hidden" for="role-${u.id}">Role for ${u.name}</label><select class="form-input form-input-sm" id="role-${u.id}" data-role-for="${u.id}">${['owner', 'manager', 'viewer'].map((r) => html`<option value="${r}" ${r === u.role ? 'selected' : ''}>${r[0].toUpperCase()}${r.slice(1)}</option>`)}</select>`}</td>
      <td>${u.disabledAt ? html`<span class="status-badge status-revoked">Disabled</span>` : html`<span class="status-badge status-paid">Active</span>`}</td>
      <td>${u.id === me ? '' : html`<div class="d-flex gap-2">
        <button type="button" class="btn btn-secondary btn-sm" data-user-action="reset" data-id="${u.id}" data-name="${u.name}">Reset password</button>
        <button type="button" class="btn btn-secondary btn-sm" data-user-action="${u.disabledAt ? 'enable' : 'disable'}" data-id="${u.id}" data-name="${u.name}">${u.disabledAt ? 'Enable' : 'Disable'}</button>
      </div>`}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

/** Shows a temporary password once, with copy. */
async function showPassword(title, user, password) {
  await openDialog({
    title,
    body: html`<p>Give <strong>${user.name}</strong> their username <code>${user.username}</code> and this temporary password. It is shown once; they choose their own the first time they sign in.</p>
      <div class="key-reveal"><input class="form-input code-input" id="tmp-pw" readonly value="${password}" aria-label="Temporary password"><button type="button" class="btn btn-secondary" id="tmp-copy">${icons.copy}Copy</button></div>`,
    footer: html`<button type="button" class="btn btn-primary" data-close>Done</button>`,
    setup(dialog) {
      dialog.querySelector('#tmp-pw').select();
      dialog.querySelector('#tmp-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(password);
          toast('Copied');
        } catch {
          dialog.querySelector('#tmp-pw').select();
          toast('Press Ctrl+C (or ⌘C) to copy');
        }
      });
    },
  });
}

async function addUser() {
  let created = null;
  await openDialog({
    title: 'Add a person',
    body: html`
      <form id="user-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="u-name">Name</label><input class="form-input" id="u-name" name="name" maxlength="60" aria-describedby="err-name"><span class="field-error" id="err-name"></span></div>
          <div class="form-group"><label class="form-label" for="u-username">Username</label><input class="form-input" id="u-username" name="username" maxlength="40" autocapitalize="none" spellcheck="false" placeholder="e.g. sam" aria-describedby="err-username"><span class="field-error" id="err-username"></span></div>
        </div>
        <fieldset><legend class="form-label">Role</legend>
          ${['viewer', 'manager', 'owner'].map((r) => html`<label class="memory-option"><input class="hidden-radio" type="radio" name="role" value="${r}" ${r === 'viewer' ? 'checked' : ''}><div class="memory-label">${r[0].toUpperCase()}${r.slice(1)}</div><div class="memory-desc">${ROLE_HELP[r]}</div></label>`)}
        </fieldset>
      </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="user-form" class="btn btn-primary">Add person</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#user-form');
      form.elements.name.focus();
      form.elements.name.addEventListener('input', () => {
        const u = form.elements.username;
        if (!u.dataset.touched) u.value = form.elements.name.value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
      });
      form.elements.username.addEventListener('input', (e) => (e.target.dataset.touched = '1'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements;
        for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
        try {
          created = await api.post('/api/admin/users', { name: f.name.value, username: f.username.value, role: f.role.value });
          dialog.close('created');
        } catch (err) {
          if (err instanceof ApiError && err.details) for (const [k, msg] of Object.entries(err.details)) dialog.querySelector(`#err-${k}`)?.replaceChildren(msg);
          toast(err.message, { error: true });
        }
      });
    },
  });
  if (created) await showPassword(`${created.user.name} is added`, created.user, created.password);
  return Boolean(created);
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

export async function render(view, { ctx }) {
  const draw = async () => {
    const [{ keys }, { entries }, { teammates }, { users }] = await Promise.all([api.get('/api/admin/keys'), api.get('/api/admin/audit?limit=60'), api.get('/api/teammates'), api.get('/api/admin/users')]);
    const names = new Map(teammates.map((t) => [t.id, t.name]));
    const example = teammates[0]?.id ?? 'ada-quill';
    view.innerHTML = String(html`
      <div class="header">
        <div>
          <h1>Admin</h1>
          <p class="header-subtitle">API keys let other systems call your teammates. Everything you change is recorded in the audit log.</p>
        </div>
      </div>
      <div class="admin-stack">
        <section class="card" aria-labelledby="people-h">
          <div class="card-head"><h2 class="card-title" id="people-h">People</h2><button type="button" class="btn btn-primary" data-action="add-user">${icons.plus}Add person</button></div>
          <p class="help">Owners can do everything. Managers assign and approve work and edit teammates and schedules. Viewers can only look. Changing someone's role signs them out.</p>
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

        <section class="card" aria-labelledby="pw-h">
          <h2 class="card-title" id="pw-h">Password &amp; sessions</h2>
          <form id="pw-form" class="form-row" novalidate>
            <div class="form-group"><label class="form-label" for="pw-current">Current password</label><input class="form-input" id="pw-current" name="current" type="password" autocomplete="current-password" aria-describedby="err-current"><span class="field-error" id="err-current"></span></div>
            <div class="form-group"><label class="form-label" for="pw-next">New password</label><input class="form-input" id="pw-next" name="next" type="password" autocomplete="new-password" aria-describedby="err-next"><span class="field-error" id="err-next"></span></div>
            <div class="form-group"><label class="form-label" for="pw-confirm">Confirm new password</label><input class="form-input" id="pw-confirm" name="confirm" type="password" autocomplete="new-password" aria-describedby="err-confirm"><span class="field-error" id="err-confirm"></span></div>
          </form>
          <div class="button-group admin-actions">
            <button type="submit" form="pw-form" class="btn btn-primary">Change password</button>
            <button type="button" class="btn btn-secondary" data-action="sign-out-everywhere">Sign out everywhere</button>
            <span class="help">Changing the password signs out every other browser.</span>
          </div>
        </section>

        <section class="card" aria-labelledby="audit-h">
          <div class="card-head"><h2 class="card-title" id="audit-h">Audit log</h2><span class="help">Latest ${entries.length} entries · stored in data/system/audit/</span></div>
          ${auditTable(entries)}
        </section>
      </div>`);

    view.querySelector('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const f = form.elements;
      for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
      const errors = {};
      if (!f.current.value) errors.current = 'Enter your current password';
      if (f.next.value.length < 10) errors.next = 'At least 10 characters';
      if (f.confirm.value !== f.next.value) errors.confirm = 'The passwords do not match';
      if (Object.keys(errors).length) {
        for (const [k, msg] of Object.entries(errors)) form.querySelector(`#err-${k}`).textContent = msg;
        return;
      }
      try {
        const { csrf } = await api.post('/api/admin/password', { current: f.current.value, next: f.next.value });
        ctx.session.csrf = csrf;
        setCsrf(csrf);
        form.reset();
        toast('Password changed. Other browsers have been signed out.');
        await draw();
      } catch (err) {
        if (err instanceof ApiError && err.details) for (const [k, msg] of Object.entries(err.details)) form.querySelector(`#err-${k}`)?.replaceChildren(msg);
        toast(err.message, { error: true });
      }
    });
  };

  view.onchange = async (e) => {
    const select = e.target.closest('[data-role-for]');
    if (!select) return;
    try {
      await api.patch(`/api/admin/users/${select.dataset.roleFor}`, { role: select.value });
      toast('Role changed. They sign in again to use it.');
    } catch (err) {
      toast(err.message, { error: true });
    }
    await draw();
  };

  view.onclick = async (e) => {
    const btn = e.target.closest('[data-action], [data-revoke], [data-user-action]');
    if (!btn) return;
    try {
      const ua = btn.dataset.userAction;
      if (btn.dataset.action === 'add-user') {
        if (await addUser()) await draw();
      } else if (ua === 'reset') {
        if (!(await confirmDialog({ title: `Reset ${btn.dataset.name}'s password?`, message: 'They are signed out everywhere and get a new temporary password.', confirmLabel: 'Reset password' }))) return;
        const { user, password } = await api.post(`/api/admin/users/${btn.dataset.id}/reset-password`);
        await showPassword('New temporary password', user, password);
        await draw();
      } else if (ua === 'disable' || ua === 'enable') {
        if (ua === 'disable' && !(await confirmDialog({ title: `Disable ${btn.dataset.name}?`, message: 'They are signed out and can’t sign in until you enable them again. Their history stays.', confirmLabel: 'Disable' }))) return;
        await api.patch(`/api/admin/users/${btn.dataset.id}`, { disabled: ua === 'disable' });
        toast(ua === 'disable' ? 'Disabled' : 'Enabled');
        await draw();
      } else if (btn.dataset.action === 'create-key') {
        const { teammates } = await api.get('/api/teammates');
        await createKey(teammates);
        await draw();
      } else if (btn.dataset.revoke) {
        const ok = await confirmDialog({ title: `Revoke “${btn.dataset.name}”?`, message: 'Anything using this key stops working straight away. This cannot be undone.', confirmLabel: 'Revoke key' });
        if (!ok) return;
        await api.del(`/api/admin/keys/${btn.dataset.revoke}`);
        toast('Key revoked');
        await draw();
      } else if (btn.dataset.action === 'sign-out-everywhere') {
        const ok = await confirmDialog({ title: 'Sign out everywhere?', message: 'Every browser, including this one, will need the password again. API keys keep working.', confirmLabel: 'Sign out everywhere' });
        if (!ok) return;
        await api.post('/api/admin/sign-out-everywhere');
        ctx.signedOutEverywhere();
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  };

  await draw();
  return {
    cleanup: () => {
      view.onclick = null;
      view.onchange = null;
    },
  };
}
