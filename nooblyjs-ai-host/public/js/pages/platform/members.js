// Platform · Members: people and agent teammates with their access role (product.md §6). Permissions come only from
// the access role. An Owner changes a person's role with a reason (manage-members); the last Owner can't be demoted,
// and agents are always capped at Contributor. Teams and invitations are on Home · Teams & roles.
import { html } from '/ui/js/html.js';
import { button, dataTable, statusPill } from '/ui/js/components/index.js';
import { initials } from '/ui/js/format.js';
import { head, flash, errorText, onChange } from './lib.js';

export async function render(view, { ctx }) {
  const api = ctx.hostApi;
  let message = null;
  let editing = null; // the member whose role is being changed

  async function draw() {
    const data = await api.get('platform/members');
    if (!ctx.isCurrent()) return;
    const canManage = ctx.can('manage-members');
    const people = data.members.filter((m) => m.kind === 'person').length;
    const member = editing && data.members.find((m) => m.id === editing);
    view.innerHTML = String(html`${head('Members', 'Who can do what in NooblyJS. Permissions come only from the access role; a work role only shapes a home page.', button({ label: 'Teams & roles', kind: 'secondary', href: '/home/teams' }))}
    ${flash(message)}
    ${member ? html`<section class="card" aria-label="Change access role">
      <div class="card__head"><h2 class="card__title">Change ${member.name}'s access role</h2><span class="card__meta">Now ${member.accessRole}</span></div>
      <form class="form" data-form="role">
        <label class="field">Access role<select name="accessRole">${data.roles.map((r) => html`<option value="${r}"${r === member.accessRole ? html` selected` : ''}>${r}</option>`)}</select></label>
        <label class="field">Why? (kept in the audit log)<textarea name="reason" required minlength="3" maxlength="500" rows="2"></textarea></label>
        <div class="actions">${button({ label: 'Change role', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel' } })}</div>
      </form>
    </section>` : ''}
    <section class="card card--flush" aria-label="Members">
      <div class="card__head"><h2 class="card__title">Members</h2><span class="card__meta">${people} people · ${data.members.length - people} agents · agents are capped at Contributor</span></div>
      ${dataTable({
        caption: 'Members',
        rows: data.members,
        columns: [
          { key: 'name', label: 'Name', render: (m) => html`<span class="strong">${m.name}</span>${m.email ? html`<span class="repo-sub">${m.email}</span>` : ''}` },
          { key: 'kindText', label: 'Kind', render: (m) => html`<span class="avatar avatar--small${m.kind === 'agent' ? ' avatar--agent' : ''}" aria-hidden="true">${initials(m.name)}</span> ${m.kindText}` },
          { key: 'jobTitle', label: 'Job or role', render: (m) => m.jobTitle ?? '—' },
          { key: 'accessRole', label: 'Access role', render: (m) => statusPill({ text: m.accessRole, tone: m.accessRole === 'Owner' ? 'navy' : m.kind === 'agent' ? 'neutral' : 'info', dot: false }) },
          ...(canManage ? [{ key: 'change', label: 'Actions', render: (m) => (m.kind === 'agent' ? html`<span class="note">Capped</span>` : html`<button class="link-button" type="button" data-edit="${m.id}">Change role<span class="visually-hidden"> for ${m.name}</span></button>`) }] : []),
        ],
      })}
    </section>`);
  }

  view.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) { editing = edit.dataset.edit; message = null; await draw(); view.querySelector('[data-form="role"] select')?.focus(); return; }
    if (event.target.closest('[data-action="cancel"]')) { editing = null; await draw(); }
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="role"]');
    if (!form) return;
    event.preventDefault();
    try {
      const { member } = await api.patch(`platform/members/${encodeURIComponent(editing)}`, Object.fromEntries(new FormData(form)));
      message = { tone: 'ok', text: `${member.name} is now ${member.accessRole}.` };
      editing = null;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: errorText(err) };
    }
    await draw();
  }, { signal: ctx.signal });

  onChange(ctx, () => (editing ? null : draw()), { types: ['member.', 'person.'] });
  await draw();
}
