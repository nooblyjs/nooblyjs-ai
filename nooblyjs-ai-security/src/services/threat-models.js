// Threat models (root product.md §3.5 Design): one per item (TM-031 for PRD-031), drafted by the security agent from the
// item's container view (the Product section's design inputs), STRIDE per trust boundary, each threat with a mitigation
// that is a requirement or a quality attribute. Accepting one is a person's decision with `accept-threat-model`
// (Architect, Owner), through the lifecycle engine's `threat-model` approval; an agent is refused and audited. Drafting
// again makes a new version, waiting again.
import { HttpError, badRequest, notFound, conflict } from '../util/errors.js';
import { isItemId, threatModelIdFor } from '../util/ids.js';
import { needs, peopleOnly } from '../util/http.js';
import { strideFrom } from './stride.js';

const STATUS_TEXT = { waiting: 'Waiting to be accepted', accepted: 'Accepted', 'changes-requested': 'Changes requested' };
const STANDIN = { id: 'rook-vale', name: 'Rook Vale' };

export function createThreatModels({ repos, host, log, policies, approvals, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? actor ?? null });

  const shape = (tm) => tm && ({
    ...tm, body: undefined, statusText: STATUS_TEXT[tm.status] ?? tm.status, href: `${mountPath}/threat-models/${tm.id}`,
    text: `${tm.id} v${tm.version} · ${STATUS_TEXT[tm.status] ?? tm.status} · ${tm.threats.length} threat${tm.threats.length === 1 ? '' : 's'}, each with a mitigation`,
    mitigations: { requirements: tm.threats.filter((t) => t.mitigation.becomes === 'requirement').length, qualityAttributes: tm.threats.filter((t) => t.mitigation.becomes === 'quality-attribute').length },
  });

  async function getOr404(id) {
    const tm = await repos.threatModels.get(id);
    if (!tm) throw notFound(`There is no threat model ${id}.`);
    return tm;
  }

  /** The security agent who can take work now: the first of the policy's teammates, and why the others couldn't. */
  async function agentFor() {
    const t = host.service('teammates');
    const wanted = (await policies.read()).agent?.teammates ?? [STANDIN.id];
    if (typeof t?.runTask !== 'function') {
      if (process.env.NODE_ENV === 'production') throw new HttpError(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft a threat model.');
      return { agent: { ...STANDIN, kind: 'agent' }, t: null, why: null };
    }
    const roster = (await Promise.resolve(t.roster?.()).catch(() => [])) ?? [];
    const skipped = [];
    for (const slug of wanted) {
      const who = roster.find((a) => a.id === slug);
      const can = typeof t.availability === 'function' ? await t.availability(slug).catch((err) => ({ ok: false, message: err.message })) : { ok: Boolean(who) };
      if (can.ok) return { agent: { id: slug, name: who?.name ?? slug, kind: 'agent' }, t, why: skipped.length ? `${skipped.join('; ')}, so ${who?.name ?? slug} drafted it` : null };
      skipped.push(can.message ?? `${who?.name ?? slug} can't take work`);
    }
    throw new HttpError(409, 'no_teammate', `No security agent can take work now: ${skipped.join('; ')}.`);
  }

  /** The agent drafts the item's threat model from its container view (a teammate task); a new version waits again. */
  async function draft(itemId, person) {
    if (!isItemId(itemId)) throw badRequest('Name the item, like PRD-031.');
    if (!person?.id) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
    await needs(host, person, 'draft', `ask for a threat model of ${itemId}`);
    const inputs = await Promise.resolve(host.service('product')?.designInputs?.(itemId)).catch(() => null);
    if (!inputs) throw new HttpError(409, 'no_container_view', `${itemId} has no container view to draw a threat model from (the Product section's Architecture page), or the Product section is not running here.`);
    if (!inputs.relations?.length) throw new HttpError(409, 'no_container_view', `${itemId}'s container view has no relations, so it crosses no trust boundary yet.`);
    const scripted = strideFrom(inputs);
    const { agent, t, why } = await agentFor();
    let drafted = scripted;
    let costUsd = 0;
    if (t) {
      const result = await t.runTask({
        slug: agent.id, workType: 'threat-modelling', itemId, system: 'security',
        caller: { type: 'user', id: person.id, name: person.name ?? person.id },
        input: { task: `Draw ${itemId}'s threat model from its container view: STRIDE per trust boundary, each threat with one mitigation that is a requirement or a quality attribute, as JSON { boundaries, threats }.`, context: JSON.stringify({ containers: inputs.containers, relations: inputs.relations }).slice(0, 20_000) },
        scripted: async () => ({ output: scripted, costUsd: 0 }),
      });
      costUsd = result.costUsd ?? 0;
      const out = result.output;
      if (!result.scripted && Array.isArray(out?.threats) && out.threats.every((x) => x?.title && x?.mitigation?.text && ['requirement', 'quality-attribute'].includes(x.mitigation.becomes))) drafted = out;
    }
    const id = threatModelIdFor(itemId);
    const at = iso();
    const tm = await repos.threatModels.update(id, (cur) => ({
      id, itemId, title: `Threat model · ${inputs.title ?? itemId}`, version: (cur?.version ?? 0) + 1, status: 'waiting',
      draftedBy: agent, askedBy: { id: person.id, name: person.name ?? person.id }, draftedAt: at, ...(why ? { why } : {}),
      source: { text: `From ${itemId}'s container view (the Product section, version ${inputs.version ?? '?'}): ${inputs.containers.length} containers, ${inputs.relations.length} relations` },
      boundaries: drafted.boundaries ?? [], threats: drafted.threats, decision: null,
      history: [...(cur?.history ?? []), { at, what: `${agent.name} drafted version ${(cur?.version ?? 0) + 1} for ${person.name ?? person.id}${why ? ` (${why})` : ''}` }],
    }));
    await emit('threat_model.drafted', { threatModelId: id, itemId, version: tm.version, threats: tm.threats.length, actorKind: 'agent', actorName: agent.name, costUsd, summary: `${agent.name} drafted threat model ${id} v${tm.version} for ${itemId}: ${tm.threats.length} threats, each with a mitigation` }, agent);
    await approvals.request(tm);
    return shape(tm);
  }

  /**
   * A person accepts it or asks for changes (with a reason). `via: 'workflows'` when the lifecycle engine relays a
   * decision taken on Home · Approvals: it records the approval itself, so it is not closed again here.
   */
  async function decide(id, body = {}, person, { via = 'security' } = {}) {
    const what = `accept threat model ${id}`;
    if (!person?.id) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
    await peopleOnly(host, person, what);
    await needs(host, person, 'accept-threat-model', what);
    const decision = body.decision;
    if (!['approve', 'request-changes'].includes(decision)) throw badRequest('decision must be "approve" or "request-changes".', { decision: 'approve | request-changes' });
    const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 2000) : null;
    if (decision === 'request-changes' && !comment) throw badRequest('Say what needs to change.', { comment: 'required' });
    const tm = await getOr404(id);
    if (tm.status !== 'waiting') throw conflict(`${id} v${tm.version} is ${STATUS_TEXT[tm.status].toLowerCase()} already.`);
    if (body.version != null && Number(body.version) !== tm.version) throw conflict(`${id} is at version ${tm.version} now; you opened version ${body.version}. Reload to see it.`);
    const at = iso();
    const status = decision === 'approve' ? 'accepted' : 'changes-requested';
    const updated = await repos.threatModels.update(id, (cur) => ({
      ...cur, status, decision: { by: person.id, byName: person.name ?? person.id, at, comment, via }, updatedAt: at,
      history: [...(cur.history ?? []), { at, what: `${person.name ?? person.id} ${decision === 'approve' ? 'accepted' : 'asked for changes to'} version ${cur.version}${comment ? `: ${comment}` : ''}` }],
    }));
    await host.audit.record({ actor: person.id, action: decision === 'approve' ? 'threat_model.accepted' : 'threat_model.changes_requested', target: id, version: tm.version, itemId: tm.itemId, via });
    if (via !== 'workflows') await approvals.decidedHere(updated, { decision, person, comment });
    await emit(decision === 'approve' ? 'threat_model.accepted' : 'threat_model.changes_requested', { threatModelId: id, itemId: tm.itemId, version: tm.version, comment }, person);
    return shape(updated);
  }

  const list = async () => (await repos.threatModels.list()).map(shape);
  const get = async (id) => shape(await getOr404(id));
  const forItem = async (itemId) => (isItemId(itemId) ? shape(await repos.threatModels.get(threatModelIdFor(itemId))) : null);

  return { draft, decide, list, get, forItem, log };
}
