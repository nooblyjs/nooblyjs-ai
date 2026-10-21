// Defects in the lifecycle (Phase 20, root product.md §3.6). A defect is a lifecycle item of its own (type defect,
// DEF-031-1), the child of the story it breaks, in the stage it was found in, so it is on the Lifecycle board, in the
// story's page and in the item's trace (its `links`: breaks → the story, the requirements and the criterion).
//
//   open ──(a later passing test run of its story, or a person with a reason)──► fixed ──(a person checks it)──► closed
//     │                                                                           │
//     └────────────(a person: not a defect, with a reason)──► rejected ◄──────────┘    fixed/closed ──(a person)──► open
//
// Raising one is anyone's who may draft (an agent may raise one: agents propose). Closing, rejecting, reopening and a
// person's "fixed" are people's decisions, refused and audited for an agent; a run's proof needs no person.
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { stageLabel } from '../stages.js';

export const SEVERITIES = { S1: 'S1 Critical', S2: 'S2 Major', S3: 'S3 Minor', S4: 'S4 Trivial' };
const STATE_TEXT = { open: 'Open', fixed: 'Fixed: a person checks it', closed: 'Closed', rejected: 'Rejected: not a defect' };
const DECISIONS = {
  fixed: { from: ['open'], to: 'fixed', status: 'active', verb: 'marked it fixed' },
  close: { from: ['fixed'], to: 'closed', status: 'completed', verb: 'closed it' },
  reject: { from: ['open', 'fixed'], to: 'rejected', status: 'withdrawn', verb: 'rejected it' },
  reopen: { from: ['fixed', 'closed'], to: 'open', status: 'active', verb: 'reopened it' },
};
const EVENTS = { fixed: 'defect.fixed', closed: 'defect.closed', rejected: 'defect.rejected', open: 'defect.reopened' };
const SYSTEM = { id: 'quality', name: 'Test section', kind: 'app' };
const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const number = (id) => (String(id ?? '').match(/-(\d+)(?:-|$)/) ?? [])[1] ?? 'X';

export function createDefects({ repos, host, now, emit, audit, personFor, itemOr404 }) {
  const isDefect = (i) => i?.type === 'defect' && i.defect;

  /** Defects of a story, of an item (its stories'), or all; optionally in one state. */
  async function defectsOf({ storyId = null, itemId = null, state = null } = {}) {
    const all = await repos.items.list();
    const stories = itemId ? new Set(all.filter((i) => i.type === 'story' && i.parentId === itemId).map((i) => i.id)) : null;
    return all.filter((i) => isDefect(i) && (!storyId || i.parentId === storyId) && (!itemId || i.parentId === itemId || stories.has(i.parentId)) && (!state || i.defect.state === state))
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }

  async function nextId(story) {
    const stem = `DEF-${number(story.parentId ?? story.id)}`;
    const taken = new Set((await repos.items.list()).map((i) => i.id));
    let n = 1;
    while (taken.has(`${stem}-${n}`)) n += 1;
    return `${stem}-${n}`;
  }

  /**
   * A defect on a story: what breaks (its requirements, a criterion) and where it was found (a test run). The person or
   * agent raising it needs `draft`.
   */
  async function recordDefect({ storyId, title, severity = 'S2', requirements = [], criterion = null, testRunId = null, runId = null, caseId = null, text = '', actor } = {}) {
    if (!actor?.id) throw forbidden('unauthenticated', 'Sign in to continue.');
    const name = clean(title, 200);
    if (!name) throw badRequest('A defect needs a title: what goes wrong.', { title: 'required' });
    if (!SEVERITIES[severity]) throw badRequest(`Severity is one of ${Object.values(SEVERITIES).join(', ')}.`, { severity: Object.keys(SEVERITIES).join(' | ') });
    const story = await itemOr404(storyId);
    if (story.type !== 'story') throw badRequest(`${story.ref ?? story.id} is not a story: a defect breaks a story (and its requirements).`);
    const raiser = actor.kind === 'agent' ? { id: actor.id, name: actor.name ?? actor.id, kind: 'agent' } : await host.people.get(actor.id).then((p) => (p ? { id: p.id, name: p.name, kind: 'person', accessRole: p.accessRole } : null));
    if (!raiser) throw forbidden('unknown_person', 'Only people and agents with a NooblyJS record can raise a defect.');
    if (raiser.kind === 'person' && !(await host.can(raiser.accessRole, 'draft'))) {
      await audit({ actor: raiser.id, action: 'access.refused', target: storyId, reason: 'raising a defect needs draft' });
      throw forbidden('forbidden', `You can't raise a defect: it needs the "draft" permission, and your access role is ${raiser.accessRole}.`, { permission: 'draft' });
    }
    const reqs = [...new Set((Array.isArray(requirements) ? requirements : []).map(String))].slice(0, 20);
    const at = now();
    const id = await nextId(story);
    const links = [{ rel: 'breaks', to: story.id }, ...reqs.map((to) => ({ rel: 'breaks', to })), ...(criterion ? [{ rel: 'breaks', to: String(criterion) }] : [])];
    const item = await repos.items.create({
      id, type: 'defect', ref: id, title: name, system: 'quality', parentId: story.id, feature: story.feature ?? null,
      stage: story.stage, status: 'active', owner: story.owner ?? raiser.id, team: story.team ?? null, createdAt: at, stageEnteredAt: at,
      history: [{ stage: story.stage, enteredAt: at, by: raiser.id }], links, version: 1, updatedAt: at,
      defect: {
        severity, state: 'open', breaks: { story: story.id, requirements: reqs, criterion: criterion ? String(criterion) : null },
        foundIn: { stage: story.stage, testRunId, runId, caseId }, raisedBy: { id: raiser.id, name: raiser.name, kind: raiser.kind },
        history: [{ at, by: raiser.id, what: `${raiser.name} raised it${testRunId ? ` from ${testRunId}` : ''}` }],
      },
      body: clean(text, 2000),
    });
    await emit('defect.raised', {
      itemId: id, parentId: story.id, itemType: 'defect', system: 'quality', severity, breaks: item.defect.breaks, testRunId, runId,
      actorKind: raiser.kind, actorName: raiser.name,
      summary: `raised ${id} (${SEVERITIES[severity]}) on ${story.ref ?? story.id}: ${name}${reqs.length ? `; it breaks ${reqs.join(', ')}` : ''}`,
    }, raiser.id);
    return item;
  }

  /**
   * A decision on a defect: fixed, close, reject, reopen. `proof` ({ testRunId }) is a run's proof that it is fixed: no
   * person needed. Otherwise a person with `draft` decides; an agent is refused and audited.
   */
  async function decideDefect({ defectId, decision, reason = '', proof = null, actor = null } = {}) {
    const rule = DECISIONS[decision];
    if (!rule) throw badRequest(`decision is one of ${Object.keys(DECISIONS).join(', ')}.`, { decision: Object.keys(DECISIONS).join(' | ') });
    const item = await itemOr404(defectId);
    if (!isDefect(item)) throw notFound(`${defectId} is not a defect.`);
    const byRun = decision === 'fixed' && proof?.testRunId;
    const who = byRun ? SYSTEM : await personFor(actor, { what: `${decision} a defect`, target: defectId });
    if (!byRun && !(await host.can(who.accessRole, 'draft'))) {
      await audit({ actor: who.id, action: 'access.refused', target: defectId, reason: `deciding a defect needs draft (${who.accessRole})` });
      throw forbidden('forbidden', `You can't ${decision} a defect: it needs the "draft" permission, and your access role is ${who.accessRole}.`, { permission: 'draft' });
    }
    const why = clean(reason, 500);
    if (!byRun && ['reject', 'reopen', 'fixed'].includes(decision) && !why) throw badRequest('Say why.', { reason: 'required' });
    if (!rule.from.includes(item.defect.state)) throw conflict('wrong_state', `${defectId} is ${STATE_TEXT[item.defect.state].toLowerCase()}: it can't be ${rule.to} from there.`);
    const at = now();
    const what = byRun ? `Fixed: ${proof.testRunId} passes` : `${who.name} ${rule.verb}${why ? `: ${why}` : ''}`;
    const updated = await repos.items.update(defectId, (cur) => ({
      ...cur, status: rule.status, ...(rule.status === 'completed' ? { completedAt: at } : {}), version: (cur.version ?? 0) + 1, updatedAt: at,
      defect: {
        ...cur.defect, state: rule.to, ...(byRun ? { fixedBy: { testRunId: proof.testRunId, at } } : {}),
        history: [...(cur.defect.history ?? []), { at, by: who.id, what, ...(why ? { reason: why } : {}) }],
      },
    }));
    if (!byRun) await audit({ actor: who.id, action: EVENTS[rule.to], target: defectId, reason: why || null, from: item.defect.state, to: rule.to });
    await emit(EVENTS[rule.to], {
      itemId: defectId, parentId: item.parentId, itemType: 'defect', system: 'quality', from: item.defect.state, to: rule.to, reason: why || null,
      ...(byRun ? { testRunId: proof.testRunId, actorName: SYSTEM.name } : {}),
      summary: byRun ? `${defectId} is fixed: ${proof.testRunId} passes` : `${rule.verb.replace('it', defectId)}${why ? `: ${why}` : ''}`,
    }, who.id);
    return updated;
  }

  /** A defect as the pages show it. */
  async function shape(item) {
    const d = item.defect;
    const owner = item.owner ? (await host.people.get(item.owner))?.name ?? item.owner : null;
    return {
      id: item.id, ref: item.ref ?? item.id, title: item.title, severity: d.severity, severityLabel: SEVERITIES[d.severity] ?? d.severity,
      state: d.state, stateText: STATE_TEXT[d.state] ?? d.state, status: item.status, stage: item.stage, stageLabel: stageLabel(item.stage),
      storyId: item.parentId, breaks: d.breaks, foundIn: d.foundIn, fixedBy: d.fixedBy ?? null, raisedBy: d.raisedBy,
      owner: item.owner ?? null, ownerName: owner, createdAt: item.createdAt, updatedAt: item.updatedAt, history: d.history ?? [], text: item.body ?? '',
      href: `/home/lifecycle/${encodeURIComponent(item.id)}`,
      breaksText: `Breaks ${[d.breaks.story, ...(d.breaks.requirements ?? []), ...(d.breaks.criterion ? [d.breaks.criterion] : [])].join(' · ')}`,
    };
  }

  return { defectsOf, recordDefect, decideDefect, shape, isDefect };
}
