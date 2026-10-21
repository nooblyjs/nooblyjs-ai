// An event → its metric facts (Phase 10). This is the only file that knows event types: compute.js reads facts, and
// a roll-up (data/metrics/rollups/<day>.yaml) is a day's facts. A fact is `{ t, k, … }`: `t` the time in ms, `k` the
// kind. Events of a type no metric reads, or without the fields a fact needs, give nothing.
//
//   created  item, stage                  an item was opened in a stage
//   stage    item, from, to, back?        it moved; back: it was sent back
//   done     item                         it was completed (the end of Ship)
//   ask      item, key, type?             an approval was opened        } the time between them is waiting for
//   decide   item, key, type?             … and decided or withdrawn    } sign-off (type: the approval's, Phase 16e)
//   open · gate · edit · merge   key, item?, cost?   a pull request: opened, failed a gate, changed by a person, merged
//   run      key, cost                    a Software Factory run finished (the cost behind its PR)
//   spend    system, cost, item?          money spent by a system (on an item, when the event names one: Phase 17)
//   work     item, who                    an agent or a person did something on an item
import { systemKey } from '../platform/budgets.js';

// What Activity leaves out too: sign-ins, profiles, the dev clock and live-update noise. A teammate's task is counted
// once, by the event of what it was for.
const NOT_WORK = /^(session|clock|person|profile)\.|^chat\.agent_working$|^teammate\.task_|^teams\.activity_|^teammates\.|^environment\.provisioning_progressed$/;
const SPEND_SYSTEMS = { 'teammate.task_finished': null, 'run.finished': null, 'compute.metered': 'compute' };

/** 'agent', 'person' or null (the system, or someone unknown). `dir` is Activity's directory of people and agents. */
export function whoOf(event, dir) {
  const kind = event.payload?.actorKind;
  if (kind === 'agent' || kind === 'person') return kind;
  if (!event.actor || event.actor === 'system') return null;
  if (dir?.people?.has(event.actor)) return 'person';
  if (dir?.agents?.has(event.actor)) return 'agent';
  return null;
}

/** A pull request's key: its run, else its repository and number, else the item it is for. */
function prKey(p) {
  if (p.runId) return String(p.runId);
  const number = p.pr && typeof p.pr === 'object' ? p.pr.number : p.pr;
  if (typeof number === 'number' || (typeof number === 'string' && /^\d+$/.test(number))) return `${p.repo ?? p.pr?.repo ?? ''}#${number}`;
  return p.itemId ? String(p.itemId) : null;
}

const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** The facts of one event, in the order compute.js reads them. Never throws. */
export function factsOf(event, dir) {
  const t = Date.parse(event?.at);
  if (!event || typeof event.type !== 'string' || !Number.isFinite(t)) return [];
  const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const item = p.itemId ?? p.specId ?? null;
  const out = [];
  const who = whoOf(event, dir);
  const work = item && who && !NOT_WORK.test(event.type) ? { t, k: 'work', item: String(item), who } : null;
  // The work of moving an item out of a stage belongs to the stage it leaves, so it is read before the move.
  if (work && event.type !== 'item.created') out.push(work);

  // A pull request is a lifecycle item of its own since Phase 16e (itemType 'pr'): its approvals count as waiting, but
  // its moves are its story's work, not an item's lead time.
  const pr = p.itemType === 'pr';
  switch (pr && ['item.created', 'item.stage_changed', 'item.sent_back', 'item.completed'].includes(event.type) ? null : event.type) {
    case 'item.created':
      if (item) out.push({ t, k: 'created', item: String(item), stage: p.stage ?? 'discover' });
      break;
    case 'item.stage_changed':
    case 'item.sent_back':
      if (item && p.from && p.to) out.push({ t, k: 'stage', item: String(item), from: p.from, to: p.to, ...(event.type === 'item.sent_back' ? { back: true } : {}) });
      break;
    case 'item.completed':
      if (item) out.push({ t, k: 'done', item: String(item) });
      break;
    case 'approval.requested':
      if (item) out.push({ t, k: 'ask', item: String(item), key: String(p.approvalId ?? `${item}:${p.type ?? ''}`), ...(p.type ? { type: String(p.type) } : {}) });
      break;
    case 'approval.decided':
    case 'approval.withdrawn':
      // One reviewer of several approving leaves it open.
      if (item && p.outcome !== 'pending') out.push({ t, k: 'decide', item: String(item), key: String(p.approvalId ?? `${item}:${p.type ?? ''}`), ...(p.type ? { type: String(p.type) } : {}) });
      break;
    case 'pr.opened':
    case 'gate.failed':
    case 'pr.human_edit':
    case 'pr.merged': {
      const key = prKey(p);
      if (!key) break;
      const k = { 'pr.opened': 'open', 'gate.failed': 'gate', 'pr.human_edit': 'edit', 'pr.merged': 'merge' }[event.type];
      const cost = k === 'merge' ? positive(p.costUsd) : null;
      out.push({ t, k, key, ...(item ? { item: String(item) } : {}), ...(cost ? { cost } : {}) });
      break;
    }
    default:
  }

  if (event.type in SPEND_SYSTEMS) {
    const cost = positive(p.costUsd);
    if (event.type === 'run.finished' && p.runId) out.push({ t, k: 'run', key: String(p.runId), ...(cost ? { cost } : {}) });
    if (cost) out.push({ t, k: 'spend', system: SPEND_SYSTEMS[event.type] ?? systemKey(p.system), cost, ...(item ? { item: String(item) } : {}) });
  }
  if (work && event.type === 'item.created') out.push(work);
  return out;
}

/** The facts of a list of events (a day's file), skipping what is not an event. */
export function factsOfDay(events, dir) {
  const out = [];
  for (const event of events ?? []) out.push(...factsOf(event, dir));
  return out;
}
