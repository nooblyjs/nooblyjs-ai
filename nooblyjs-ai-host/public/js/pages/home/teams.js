// Home · Teams & roles (product.md §5.2, mockup noobly-teams-roles): the teams with their people (round) and agent
// teammates (square), the roles × permissions matrix read from roles.yaml, the members table and Invite a person.
// The matrix is what the server enforces; this page only shows it.
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { pageHead, button, dataTable, statusPill } from '/ui/js/components/index.js';
import { initials } from '/ui/js/format.js';

const HEAD = { eyebrow: 'NooblyJS · Teams & roles', title: 'Teams & roles', lead: 'Who works on what, people and agents together, and who may approve each decision.' };
const MAX_FACES = 6;

function teamCard(t, canSetCapacity = false) {
  const faces = [...t.people.map((p) => ({ ...p, agent: false })), ...t.agents.map((a) => ({ ...a, agent: true }))];
  const more = faces.length - MAX_FACES;
  return html`<li class="team">
    <div class="team__head"><h3 class="team__name">${t.name}</h3><span class="row__meta">${t.counts}</span></div>
    <p class="team__focus">${t.focus}</p>
    ${canSetCapacity
    ? html`<form class="team__capacity" data-form="capacity" data-team="${t.id}"><label>People-days in Now <input type="number" name="capacityDays" min="0" max="100000" step="1" value="${t.capacityDays ?? ''}" aria-describedby="cap-${t.id}"></label><button type="submit" class="btn btn--secondary btn--small">Save</button><span class="row__meta" id="cap-${t.id}">Product's roadmap checks the next three months against it.</span></form>`
    : html`<p class="row__meta">${t.capacityText ?? ''}</p>`}
    <ul class="team__faces" aria-label="${t.name} members">${faces.slice(0, MAX_FACES).map((f) => html`<li class="avatar avatar--small${f.agent ? ' avatar--agent' : ''}" title="${f.name}"><span aria-hidden="true">${initials(f.name)}</span><span class="visually-hidden">${f.name}${f.agent ? ' (agent)' : ''}</span></li>`)}${more > 0 ? html`<li class="avatar avatar--small team__more">+${more}</li>` : ''}</ul>
  </li>`;
}

function matrix(m) {
  const cell = (ok) => (ok ? html`<span class="matrix__yes">${icon('check', { size: 16, stroke: 2.4, label: 'Yes' })}</span>` : html`<span class="matrix__no"><span aria-hidden="true">—</span><span class="visually-hidden">No</span></span>`);
  return dataTable({
    caption: 'Roles and permissions',
    rows: m.rows,
    columns: [{ key: 'label', label: 'Can…', render: (r) => html`<strong class="rule__decision">${r.label}</strong>` }, ...m.roles.map((role) => ({ key: role, label: role, render: (r) => cell(r.allowed[role]) }))],
  });
}

const members = (list) => dataTable({
  caption: 'Members',
  rows: list.rows,
  columns: [
    { key: 'name', label: 'Name', render: (r) => html`<span class="member"><span class="avatar avatar--small${r.kind === 'agent' ? ' avatar--agent' : ''}" aria-hidden="true">${initials(r.name)}</span>${r.name}</span>` },
    { key: 'kindText', label: 'Kind' }, { key: 'team', label: 'Team' },
    { key: 'accessRole', label: 'Role', render: (r) => statusPill({ text: r.accessRole, tone: r.accessRole === 'Owner' ? 'navy' : r.kind === 'agent' ? 'neutral' : 'info', dot: false }) },
    { key: 'approvals', label: 'Approvals · 30 d', numeric: true, render: (r) => (r.approvals === null ? html`<span aria-hidden="true">—</span><span class="visually-hidden">Agents never approve</span>` : r.approvals) },
  ],
});

function inviteForm(data, message) {
  return html`<section class="card" aria-label="Invite a person" id="invite">
    <div class="card__head"><h2 class="card__title">Invite a person</h2><span class="card__meta">They can sign in straight away, and pick their work role in onboarding</span></div>
    ${message ? html`<p class="flash flash--${message.tone}" role="${message.tone === 'error' ? 'alert' : 'status'}">${message.text}</p>` : ''}
    <form class="form invite" data-form="invite">
      <label class="field">Name<input name="name" required maxlength="80" autocomplete="off"></label>
      <label class="field">Work email<input name="email" type="email" required maxlength="120" autocomplete="off"></label>
      <label class="field">Job title<input name="jobTitle" maxlength="80" autocomplete="off"></label>
      <label class="field">Access role<select name="accessRole">${data.matrix.roles.map((r) => html`<option value="${r}"${r === 'Viewer' ? html` selected` : ''}>${r}</option>`)}</select></label>
      <label class="field">Team<select name="team"><option value="">No team yet</option>${data.teams.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></label>
      <div class="actions">${button({ label: 'Send invite', type: 'submit' })}</div>
    </form>
  </section>`;
}

export async function render(view, { ctx }) {
  let message = null;
  let showInvite = false;

  async function draw() {
    const data = await ctx.hostApi.get('home/teams');
    if (!ctx.isCurrent()) return;
    const canInvite = ctx.can('hire-teammates');
    view.innerHTML = String(html`${pageHead({
      ...HEAD,
      actions: html`${canInvite ? button({ label: 'Invite a person', icon: 'plus', attrs: { 'data-action': 'invite', 'aria-expanded': showInvite ? 'true' : 'false' } }) : ''}${button({ label: 'Hire a teammate', kind: 'secondary', icon: 'team', href: '/teammates/hire' })}`,
    })}
    ${canInvite && showInvite ? inviteForm(data, message) : message ? html`<p class="flash flash--${message.tone}" role="status">${message.text}</p>` : ''}
    <section aria-label="Teams"><ul class="teams">${data.teams.map((t) => teamCard(t, ctx.can('set-budgets')))}</ul>
      <p class="legend"><span class="legend__key"><span class="avatar avatar--small face-key" aria-hidden="true"></span>Person (round)</span><span class="legend__key"><span class="avatar avatar--small avatar--agent face-key" aria-hidden="true"></span>Agent teammate (square)</span></p>
    </section>
    <section class="card card--flush" aria-label="Roles and permissions">
      <div class="card__head"><h2 class="card__title">Roles &amp; permissions</h2><span class="card__meta">Agents are always capped at ${data.matrix.agentCap}. A work role never grants a permission.</span></div>
      ${matrix(data.matrix)}
    </section>
    <section class="card card--flush" aria-label="Members">
      <div class="card__head"><h2 class="card__title">Members</h2><span class="card__meta">${data.members.people} people · ${data.members.agents} agents</span></div>
      ${members(data.members)}
    </section>
    ${data.rules ? html`<section class="card card--flush" aria-label="Approval rules">
      <div class="card__head"><h2 class="card__title">Who approves what</h2><span class="card__meta">Read-only here for now: the rules are the file data/workflows/approval-rules.yaml</span></div>
      ${dataTable({ caption: 'Who approves what', rows: data.rules, columns: [{ key: 'decision', label: 'Decision', render: (r) => html`<strong class="rule__decision">${r.decision}</strong>` }, { key: 'approver', label: 'Approver' }, { key: 'target', label: 'Target time' }, { key: 'ifLate', label: 'If late' }] })}
    </section>` : ''}`);
  }

  view.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-action="invite"]')) return;
    showInvite = !showInvite;
    message = null;
    await draw();
    if (showInvite) view.querySelector('#invite input')?.focus();
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    const cap = event.target.closest('[data-form="capacity"]');
    if (cap) {
      event.preventDefault();
      try {
        const raw = cap.elements.capacityDays.value.trim();
        const team = await ctx.hostApi.patch(`home/teams/${encodeURIComponent(cap.dataset.team)}`, { capacityDays: raw === '' ? null : Number(raw) });
        message = { tone: 'ok', text: `${team.name}: ${team.capacityText}.` };
      } catch (err) {
        if (err?.name === 'AbortError') return;
        message = { tone: 'error', text: err.message };
      }
      await draw();
      return;
    }
    const form = event.target.closest('[data-form="invite"]');
    if (!form) return;
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    try {
      const { person } = await ctx.hostApi.post('home/people', fields);
      message = { tone: 'ok', text: `${person.name} was invited as ${person.accessRole}. They can sign in now.` };
      showInvite = false;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: err.details ? `${err.message} ${Object.entries(err.details).map(([k, v]) => `${k}: ${v}`).join('; ')}` : err.message };
    }
    await draw();
    view.querySelector('.flash')?.scrollIntoView({ block: 'nearest' });
  }, { signal: ctx.signal });

  await draw();
}
