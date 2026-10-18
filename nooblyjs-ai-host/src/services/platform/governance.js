// Members and the audit log (Platform · Govern). Members: people and agents with their access role; an Owner
// changes a person's role with a reason, never the last Owner's, and agents stay capped at Contributor
// (product.md §6). The audit log: every record in data/audit/, filtered by actor, action and date, newest first.
import { HttpError } from '../../util/errors.js';
import { daySegments } from '../../util/dates.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 92;
const PAGE = 100;

export function createMembers({ people, roles, agents }) {
  async function list() {
    const cap = await roles.agentCap();
    const persons = (await people.list()).filter((p) => p.active).map((p) => ({
      id: p.id, name: p.name, kind: 'person', kindText: 'Person', email: p.email, accessRole: p.accessRole, jobTitle: p.jobTitle, workRole: p.workRole,
    }));
    const bots = (await agents.roster()).map((a) => ({
      id: a.id, name: a.name, kind: 'agent', kindText: 'Agent', email: null, accessRole: cap, jobTitle: a.role ?? null, workRole: null, capped: true,
    }));
    return [...persons, ...bots];
  }

  /** Changes a person's access role. Returns { before, after, person }. */
  async function setRole(id, { accessRole, reason }, { roleNames }) {
    const why = String(reason ?? '').trim();
    if (why.length < 3 || why.length > 500) throw new HttpError(400, 'reason_required', 'Say why this access role is changing (3 to 500 characters). It goes in the audit log.');
    if (!roleNames.includes(accessRole)) throw new HttpError(400, 'invalid_role', `The access role is one of: ${roleNames.join(', ')}.`);
    const person = await people.get(id);
    if (!person) {
      if ((await agents.roster()).some((a) => a.id === id)) throw new HttpError(422, 'agent_capped', 'Agents are always capped at Contributor. Their access role cannot be changed.');
      throw new HttpError(404, 'person_not_found', `No person "${id}".`);
    }
    if (person.accessRole === accessRole) return { before: accessRole, after: accessRole, person, unchanged: true };
    if (person.accessRole === 'Owner') {
      const owners = (await people.list()).filter((p) => p.active && p.accessRole === 'Owner');
      if (owners.length <= 1) throw new HttpError(422, 'last_owner', `${person.name} is the last Owner. Make someone else an Owner first.`);
    }
    const { before, person: after } = await people.setAccessRole(id, accessRole);
    return { before, after: after.accessRole, person: after, reason: why };
  }

  return { list, setRole };
}

/**
 * Audit records between two days (inclusive), newest first, filtered by actor (exact), action (exact, or a prefix
 * ending in '.' or '*') and free text over target and reason. Paged with an offset cursor.
 */
export function createAuditQuery({ store, clock }) {
  return async function query({ actor = '', action = '', text = '', from = '', to = '', cursor = 0, limit = PAGE } = {}) {
    const today = new Date(clock.now()).toISOString().slice(0, 10);
    const end = to || today;
    const start = from || shiftDay(end, -6);
    if (!DAY.test(start) || !DAY.test(end)) throw new HttpError(400, 'invalid_date', 'Dates are YYYY-MM-DD.');
    if (start > end) throw new HttpError(400, 'invalid_range', 'The start date is after the end date.');
    const days = [];
    for (let d = end; d >= start; d = shiftDay(d, -1)) {
      days.push(d);
      if (days.length > MAX_DAYS) throw new HttpError(400, 'range_too_long', `Choose at most ${MAX_DAYS} days.`);
    }
    const wantAction = String(action).trim();
    const prefix = /[.*]$/.test(wantAction) ? wantAction.replace(/\*$/, '') : null;
    const needle = String(text).trim().toLowerCase();
    const matches = [];
    for (const day of days) {
      const records = await store.readYamlStream(['audit', ...daySegments(day)]);
      for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i];
        if (actor && r.actor !== actor) continue;
        if (wantAction && !(prefix ? String(r.action ?? '').startsWith(prefix) : r.action === wantAction)) continue;
        if (needle && !`${r.target ?? ''} ${r.reason ?? ''}`.toLowerCase().includes(needle)) continue;
        matches.push(r);
      }
    }
    const offset = Math.max(0, Number.parseInt(cursor, 10) || 0);
    const size = Math.min(PAGE, Math.max(1, Number.parseInt(limit, 10) || PAGE));
    const page = matches.slice(offset, offset + size);
    return {
      from: start, to: end, total: matches.length,
      records: page.map(row),
      next: offset + size < matches.length ? String(offset + size) : null,
    };
  };
}

/** The columns the screen shows, plus the record itself for the detail. */
function row(r) {
  return {
    id: r.id, at: r.at, actor: r.actor ?? null, action: r.action, target: r.target ?? null,
    costUsd: Number.isFinite(Number(r.costUsd)) && r.costUsd !== null ? Number(r.costUsd) : null,
    status: r.status ?? null, reason: r.reason ?? null, record: r,
  };
}

function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
