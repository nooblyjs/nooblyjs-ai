// Teams & roles (product.md §5.2, §6): the teams with their people and agent teammates, the roles × permissions
// matrix as people read it, and the members table. Teams are data/teams/<id>.md; permissions come from the matrix
// in data/access/roles.yaml and from nowhere else.
import { HttpError } from '../util/errors.js';
import { ID } from '../util/ids.js';
import { BUILT_IN_PERMISSIONS } from '../middleware/roles.js';

// The matrix rows of product.md §6, each naming the permissions it stands for. A role has the row when it has all.
// Since Phase 16b an approval's permission says whom it waits on; anyone but a Viewer may give it on their behalf.
export const MATRIX_ROWS = [
  { label: 'Read specs, models and runs', permissions: ['read'] },
  { label: 'Draft specs, ADRs, designs, PRs', permissions: ['draft'] },
  { label: 'Approve specs (the Product handoff)', permissions: ['approve'] },
  { label: 'Accept architecture decisions and the Design handoff', permissions: ['accept-decisions'] },
  { label: 'Give the Build approval (as code owner)', permissions: ['merge'] },
  { label: 'Give the Test approval, sign off test analysis', permissions: ['sign-off-tests'] },
  { label: 'Hire teammates, set budgets', permissions: ['hire-teammates', 'set-budgets'] },
  { label: 'Change guardrails and repo access', permissions: ['change-guardrails', 'change-repo-access'] },
  // The nine stages (root product.md §5, Phase 16a); the release candidate went with Verify (Phase 16b).
  { label: 'Accept requirements', permissions: ['accept-requirement'] },
  { label: 'Accept threat models', permissions: ['accept-threat-model'] },
  { label: 'Accept a security risk', permissions: ['accept-risk'] },
  { label: 'Approve a production deploy (one of two)', permissions: ['deploy-production'] },
  { label: 'Declare an incident', permissions: ['declare-incident'] },
  // Phase 25a: Product's ideas portal.
  { label: 'Put ideas forward, vote and comment in the ideas portal', permissions: ['suggest'] },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const agentName = (id) => String(id ?? '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function createTeams({ store, people }) {
  /** Every team with its people (by name) and agents, and "4 people · 2 agents". */
  async function list() {
    const everyone = new Map((await people.list()).map((p) => [p.id, p]));
    const names = (await store.list(['teams'])).filter((n) => n.endsWith('.md'));
    const teams = [];
    for (const name of names) {
      const t = (await store.readDoc(['teams', name]))?.data;
      if (!t?.id) continue;
      const members = (t.people ?? []).map((id) => everyone.get(id)).filter((p) => p?.active).map((p) => ({ id: p.id, name: p.name }));
      const agents = (t.agents ?? []).map((id) => ({ id, name: agentName(id) }));
      // Phase 25b: the people-days the team has in Product's Now (three months), for its roadmap's capacity.
      const capacityDays = Number.isFinite(Number(t.capacityDays)) && Number(t.capacityDays) > 0 ? Number(t.capacityDays) : null;
      teams.push({ id: t.id, name: t.name, focus: t.focus ?? '', people: members, agents, counts: `${plural(members.length, 'person', 'people')} · ${plural(agents.length, 'agent')}`, capacityDays, capacityText: capacityDays ? `${capacityDays} people-days in Now` : 'Capacity not set' });
    }
    return teams;
  }

  /** The roles × permissions matrix, read from roles.yaml. */
  async function matrix() {
    const doc = (await store.readYaml(['access', 'roles.yaml'])) ?? {};
    const all = doc.roles ?? [];
    const permissions = { ...BUILT_IN_PERMISSIONS, ...(doc.permissions ?? {}) };
    return {
      roles: all,
      agentCap: doc.agentCap ?? 'Contributor',
      rows: MATRIX_ROWS.map((row) => ({
        label: row.label,
        allowed: Object.fromEntries(all.map((role) => [role, row.permissions.every((p) => (permissions[p] ?? []).includes(role))])),
      })),
    };
  }

  /** People and agents with their team, access role and approvals in the last 30 days (people only). */
  async function members({ decisions = new Map() } = {}) {
    const teams = await list();
    const teamOf = (id) => teams.filter((t) => t.people.some((p) => p.id === id) || t.agents.some((a) => a.id === id)).map((t) => t.name).join(', ') || '—';
    const cap = (await matrix()).agentCap;
    const rows = (await people.list()).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, kind: 'person', kindText: 'Person', team: teamOf(p.id), accessRole: p.accessRole, approvals: decisions.get(p.id) ?? 0 }));
    const agents = [...new Map(teams.flatMap((t) => t.agents).map((a) => [a.id, a])).values()]
      .map((a) => ({ id: a.id, name: a.name, kind: 'agent', kindText: 'Agent', team: teamOf(a.id), accessRole: cap, approvals: null }));
    const order = { Owner: 0, Architect: 1, Approver: 2, Contributor: 3, Viewer: 4 };
    rows.sort((a, b) => (order[a.accessRole] ?? 9) - (order[b.accessRole] ?? 9) || a.name.localeCompare(b.name));
    return { rows: [...rows, ...agents], people: rows.length, agents: agents.length };
  }

  /**
   * Invite a person: their NooblyJS record (with the access role the inviter chose) and their place on a team. The
   * route has already checked the inviter's permission. 409 when the email already has a record.
   */
  async function invite({ name, email, accessRole, jobTitle, team }, { now }) {
    const fullName = String(name ?? '').trim();
    const mail = String(email ?? '').trim().toLowerCase();
    const details = {};
    if (fullName.length < 2 || fullName.length > 80) details.name = 'A name of 2 to 80 characters';
    if (!EMAIL.test(mail) || mail.length > 120) details.email = 'A work email address';
    const allowed = (await matrix()).roles;
    if (!allowed.includes(accessRole)) details.accessRole = `One of ${allowed.join(', ')}`;
    const teams = await list();
    if (team && !teams.some((t) => t.id === team)) details.team = 'A team from the list';
    const title = String(jobTitle ?? '').trim().slice(0, 80) || null;
    if (Object.keys(details).length) throw new HttpError(422, 'invalid', 'Check the highlighted fields.', details);
    if (await people.getByEmail(mail)) throw new HttpError(409, 'exists', `${mail} already has a NooblyJS record.`);

    const { person } = await people.provision({ email: mail, fullName }, { accessRole, source: 'invite', now });
    if (title) await store.updateDoc(['people', person.id, 'PERSON.md'], (doc) => (doc ? { ...doc, data: { ...doc.data, jobTitle: title } } : null));
    if (team && ID.test(team)) {
      await store.updateDoc(['teams', `${team}.md`], (doc) => (doc ? { ...doc, data: { ...doc.data, people: [...new Set([...(doc.data.people ?? []), person.id])] } } : null));
    }
    return people.get(person.id);
  }

  /** Phase 25b: a team's people-days in Now (null clears it). The route has checked the permission. */
  async function setCapacity(id, days) {
    if (!ID.test(String(id ?? ''))) throw new HttpError(404, 'not_found', 'There is no such team.');
    const value = days === null || days === '' ? null : Number(days);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100000)) throw new HttpError(422, 'invalid', 'Capacity is a number of people-days.', { capacityDays: 'a number' });
    const done = await store.updateDoc(['teams', `${id}.md`], (doc) => (doc ? { ...doc, data: { ...doc.data, capacityDays: value } } : null));
    if (!done) throw new HttpError(404, 'not_found', `There is no team ${id}.`);
    return (await list()).find((t) => t.id === id);
  }

  return { list, matrix, members, invite, setCapacity };
}
