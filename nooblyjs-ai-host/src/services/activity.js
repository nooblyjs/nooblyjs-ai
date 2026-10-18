// Activity (product.md §5.2): the event log as people read it. Each event becomes a row with its actor (a person,
// an agent or the system), what they did, the system it belongs to, the time and the cost of an agent action.
// Events say what happened in `payload.summary` (the sentence without the actor); the rest is worked out here.
// Nothing is stored: rows are read from data/events/ on every call, newest first.
import { daySegments } from '../util/dates.js';

const DAY = 86_400_000;
const MAX_DAYS_BACK = 30;
// Sign-ins, profile changes and the dev clock are not work. A teammate's task is shown (and its cost counted) once,
// by the event of what it was for: the chat message, the draft, the meeting answer. teams.activity_sent only tells
// the Teams simulator to redraw, and teammates.* are live updates for the Teammates pages.
const SKIP = /^(session|clock|person|profile)\.|^chat\.agent_working$|^teammate\.task_|^teams\.activity_|^teammates\.|^environment\.provisioning_progressed$/;
const DECISIONS = new Set(['approval.decided', 'adr.accepted', 'item.sent_back', 'readiness.overridden', 'chat.card_decided']);
const SYSTEM_LABELS = { product: 'Product', factory: 'Factory', teammates: 'Teammates', knowledge: 'Knowledge', platform: 'Platform', lifecycle: 'Lifecycle', infrastructure: 'Infrastructure' };
const SYSTEM_BY_PREFIX = {
  chat: 'product', spec: 'product', adr: 'product', idea: 'product', signal: 'product', architecture: 'product', ux: 'product', ui: 'product', draft: 'product',
  run: 'factory', pr: 'factory', gate: 'factory', teammate: 'teammates', knowledge: 'knowledge',
  environment: 'infrastructure', drift: 'infrastructure', infra_design: 'infrastructure',
  image: 'platform', budget: 'platform', guardrail: 'platform', approval: 'lifecycle', item: 'lifecycle', handoff: 'lifecycle', readiness: 'lifecycle',
};
// The sample history behind Home · Metrics (src/seed/metrics-history.js) is weeks of made-up events: not shown, not counted.
const shown = (event) => Boolean(event?.type) && !SKIP.test(event.type) && event.payload?.sampleHistory !== true;
export const FILTERS = ['everything', 'people', 'agents', 'product', 'factory', 'teammates', 'knowledge', 'platform'];

const titleCase = (id) => String(id ?? '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export function createActivity({ store, people, clock = Date }) {
  /** Who is an agent: the teammates listed on the teams (data/teams/*.md). */
  async function directory() {
    const [everyone, teamFiles] = await Promise.all([people.list(), store.list(['teams'])]);
    const agents = new Set();
    for (const name of teamFiles) for (const id of (await store.readDoc(['teams', name]))?.data?.agents ?? []) agents.add(id);
    return { people: new Map(everyone.map((p) => [p.id, p])), agents };
  }

  function actorOf(event, dir) {
    const p = event.payload ?? {};
    const person = dir.people.get(event.actor);
    if (person) return { id: person.id, name: person.name, kind: 'person' };
    if (event.actor && event.actor !== 'system' && (dir.agents.has(event.actor) || p.actorKind === 'agent')) {
      return { id: event.actor, name: p.actorName ?? titleCase(event.actor), kind: 'agent' };
    }
    return { id: event.actor ?? 'system', name: p.actorName ?? 'NooblyJS', kind: 'system' };
  }

  /** A sentence for an event that carries no summary: "spec.updated" on PRD-031 → "updated spec PRD-031". */
  function fallbackAction(event) {
    const [entity, verb = ''] = event.type.split('.');
    const p = event.payload ?? {};
    const target = p.specId ?? p.adrId ?? p.itemId ?? p.ideaId ?? p.teammateId ?? '';
    return `${verb.replace(/_/g, ' ')} ${entity.replace(/_/g, ' ')} ${target}`.trim();
  }

  function rowOf(event, dir) {
    const p = event.payload ?? {};
    const system = p.system && SYSTEM_LABELS[p.system] ? p.system : SYSTEM_BY_PREFIX[event.type.split('.')[0]] ?? 'platform';
    const cost = Number(p.costUsd);
    return {
      id: event.id, at: event.at, type: event.type,
      actor: actorOf(event, dir),
      action: p.summary ?? fallbackAction(event),
      detail: p.detail ?? null,
      system, systemLabel: SYSTEM_LABELS[system],
      costUsd: Number.isFinite(cost) && cost > 0 ? cost : null, costNote: p.costNote ?? null,
      outcome: p.outcome && typeof p.outcome === 'string' && !['approved', 'pending', 'changes-requested'].includes(p.outcome) ? p.outcome : null,
      itemId: p.itemId ?? p.specId ?? null,
    };
  }

  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const readDay = (day) => store.readYamlStream(['events', ...daySegments(day)]);

  function matches(row, filter, q) {
    if (filter === 'people' && row.actor.kind !== 'person') return false;
    if (filter === 'agents' && row.actor.kind !== 'agent') return false;
    if (SYSTEM_LABELS[filter] && row.system !== filter) return false;
    if (q) {
      const hay = `${row.actor.name} ${row.action} ${row.detail ?? ''} ${row.itemId ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  /**
   * Rows newest first. `before` (ISO) pages back; days are scanned backwards until `limit` rows are found or 30
   * days have been read. `nextBefore` is null when there is nothing earlier.
   */
  async function list({ filter = 'everything', q = '', before = null, limit = 40 } = {}) {
    const dir = await directory();
    const now = clock.now();
    const cutoff = before ? new Date(before).getTime() : Infinity;
    const needle = String(q).trim().toLowerCase();
    const max = Math.min(Math.max(Number(limit) || 40, 1), 200);
    const rows = [];
    let exhausted = true;
    const start = Math.min(now, Number.isFinite(cutoff) ? cutoff : now);
    for (let back = 0; back <= MAX_DAYS_BACK; back++) {
      const records = await readDay(dayOf(start - back * DAY));
      for (let i = records.length - 1; i >= 0; i--) {
        const event = records[i];
        if (!shown(event) || new Date(event.at).getTime() >= cutoff) continue;
        const row = rowOf(event, dir);
        if (!matches(row, filter, needle)) continue;
        if (rows.length === max) {
          exhausted = false;
          break;
        }
        rows.push(row);
      }
      if (!exhausted) break;
    }
    return { now: new Date(now).toISOString(), filter, rows, nextBefore: exhausted ? null : rows.at(-1).at };
  }

  /** Today so far: agent actions, human decisions, PRs opened and spend, from today's events. */
  async function today() {
    const dir = await directory();
    const rows = (await readDay(dayOf(clock.now()))).filter(shown).map((e) => rowOf(e, dir));
    return {
      agentActions: rows.filter((r) => r.actor.kind === 'agent').length,
      humanDecisions: rows.filter((r) => r.actor.kind === 'person' && DECISIONS.has(r.type)).length,
      prsOpened: rows.filter((r) => r.type === 'pr.opened').length,
      // A merge row carries the item's total, which its earlier rows already counted.
      spentUsd: Math.round(rows.filter((r) => r.costNote !== 'total').reduce((sum, r) => sum + (r.costUsd ?? 0), 0) * 100) / 100,
    };
  }

  /** What the event stream sends for one event (the same row Activity shows). */
  async function streamRow(event) {
    if (!shown(event)) return null;
    return rowOf(event, await directory());
  }

  /** How many of the given event types each actor caused in the last `days` (approvals in 30 days, for Members). */
  async function countByActor({ types, days = 30 }) {
    const wanted = new Set(types);
    const counts = new Map();
    const now = clock.now();
    for (let back = 0; back <= days; back++) {
      for (const event of await readDay(dayOf(now - back * DAY))) {
        if (event?.actor && wanted.has(event.type) && event.payload?.sampleHistory !== true) counts.set(event.actor, (counts.get(event.actor) ?? 0) + 1);
      }
    }
    return counts;
  }

  return { list, today, streamRow, countByActor, directory };
}
