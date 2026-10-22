// Infrastructure's drafting agent (roadmap I7, NooblyJS Phase 26): Ines Tau drafts a new version of a design from the
// item's architecture. A person with `draft` asks; the draft is her teammate task (`infrastructure-design`) through
// Digital Teammates, which checks, bills and attributes it. She reads the architecture through
// host.service('product').designInputs(itemId): the container view, the quality attributes and the ADRs.
//
// The new version replaces whatever version is current. The current one is kept (designs/<id>/versions/) and the new
// one waits for its approvals again: the Architect's through an accepted ADR stays, the platform owner's waits. Nothing
// drafts by itself: an accepted ADR or a changed architecture (adr.accepted, architecture.updated) only offers a new
// draft on the design, saying why; a draft clears the offer.
//
// The scripted draft (no model configured) keeps the design's resources and adds what the architecture has that the
// design lacks: a compute resource per new container, a data resource per new database or cache, alarms for the latency
// and availability quality attributes. A model's draft is used only when it is a list of resources in the design's
// shape; anything else in its answer is dropped.
import { HttpError, conflict } from '../util/errors.js';

export const AGENT = { id: 'ines-tau', name: 'Ines Tau' };
const WORK_TYPE = 'infrastructure-design';
const LAYERS = ['edge', 'compute', 'data', 'messaging', 'security', 'observe'];
const STATES = ['new', 'changed', 'existing'];
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** A resource from the model's answer, cleaned to the design's shape, or null. */
function cleanResource(r) {
  if (!r || typeof r !== 'object') return null;
  const key = slug(r.key ?? r.name);
  const name = String(r.name ?? '').trim().slice(0, 80);
  if (!key || !name || !LAYERS.includes(r.layer)) return null;
  return {
    key, layer: r.layer, name, detail: String(r.detail ?? '').trim().slice(0, 160),
    state: STATES.includes(r.state) ? r.state : 'new',
    ...(Number.isInteger(r.creates) && r.creates > 0 && r.creates < 50 ? { creates: r.creates } : {}),
  };
}

/** The scripted draft: the design's resources, with what the architecture has that they lack. */
export function scriptedResources(design, inputs) {
  const resources = (design.resources ?? []).map((r) => ({ ...r }));
  const has = (pred) => resources.some(pred);
  // A container is in the design when a resource names every word of it ("Slot API" is not "Slot notifier").
  const mentions = (words) => (r) => words.every((w) => `${r.key} ${r.name}`.toLowerCase().includes(w));
  const added = [];
  for (const c of inputs?.containers ?? []) {
    const label = String(c.label ?? c.id ?? '').trim();
    if (!label || c.kind === 'person' || c.kind === 'external' || c.status === 'existing') continue;
    const words = label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    if (!words.length || has(mentions(words))) continue;
    const isData = /db|database|cache|redis|store/i.test(`${c.kind ?? ''} ${label} ${c.tech ?? ''}`);
    const r = { key: slug(label), layer: isData ? 'data' : 'compute', name: label, detail: [c.tech, 'from the container view'].filter(Boolean).join(' · '), state: 'new', creates: 1, ...(isData ? { encrypted: true } : {}) };
    resources.push(r);
    added.push(r.name);
  }
  const qa = inputs?.qualityAttributes ?? [];
  const watched = qa.filter((q) => /latency|availability|p95|uptime/i.test(`${q.category ?? ''} ${q.name ?? ''} ${q.target ?? ''}`));
  if (watched.length && !has((r) => r.layer === 'observe' && /alarm/i.test(r.name))) {
    resources.push({ key: 'alarms', layer: 'observe', name: 'Alarms', detail: watched.map((q) => q.target ?? q.name).filter(Boolean).join(' · ').slice(0, 160), state: 'new', creates: 1 });
    added.push('Alarms');
  }
  return { resources, added };
}

export function createDrafts({ repos, host, log, approvals, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();

  /** Ines when she is hired in Teammates; the stand-in name when Teammates isn't running (not in production). */
  async function teammate() {
    const t = host.service?.('teammates');
    if (typeof t?.roster !== 'function') {
      if (process.env.NODE_ENV === 'production') throw new HttpError(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft.');
      return { agent: { ...AGENT, kind: 'agent' }, t: null };
    }
    const roster = (await t.roster().catch(() => [])) ?? [];
    const ines = roster.find((a) => a.id === AGENT.id);
    if (!ines) throw new HttpError(409, 'no_teammate', `${AGENT.name} drafts infrastructure designs, and isn't hired here. Hire her in Teammates.`);
    if (ines.canWork === false) throw new HttpError(409, 'teammate_unavailable', `${ines.name} can't take work now (${ines.statusText ?? 'unavailable'}).`);
    return { agent: { id: ines.id, name: ines.name ?? AGENT.name, kind: 'agent' }, t };
  }

  /** A person asks Ines for a new draft of a design. The route has checked draft and that it is a person. */
  async function draft(id, person) {
    const design = await repos.designs.get(id);
    if (!design) throw new HttpError(404, 'not_found', `No design ${id}.`);
    if (!design.itemId) throw conflict(`${id} isn't for an item, so there is no architecture to draft it from.`);
    const inputs = await Promise.resolve(host.service?.('product')?.designInputs?.(design.itemId)).catch(() => null);
    if (!inputs) throw new HttpError(409, 'no_architecture', `${design.itemId} has no spec or architecture in Product to draft from.`);
    const scripted = scriptedResources(design, inputs);
    const { agent, t } = await teammate();
    let resources = scripted.resources;
    let added = scripted.added;
    let costUsd = 0;
    let modelRoute = 'scripted';
    if (t) {
      const result = await t.runTask({
        slug: agent.id, workType: WORK_TYPE, itemId: design.itemId, system: 'infrastructure',
        caller: { type: 'user', id: person.id, name: person.name ?? person.id },
        input: {
          task: `Draft a new version of the infrastructure design ${id} (${design.title}) from ${design.itemId}'s architecture: the resources it needs, each with a layer (${LAYERS.join(', ')}), a name, a detail and whether it is new, changed or existing. Answer with JSON: { "resources": [...] }.`,
          context: JSON.stringify({ design: { id, version: design.version, resources: design.resources ?? [] }, architecture: { containers: inputs.containers, relations: inputs.relations, qualityAttributes: inputs.qualityAttributes, adrs: inputs.adrs } }).slice(0, 20_000),
        },
        scripted: async () => ({ output: { resources: scripted.resources }, costUsd: 0 }),
      });
      costUsd = Number(result.costUsd) || 0;
      modelRoute = result.modelRoute ?? (result.scripted ? 'scripted' : 'unknown');
      if (!result.scripted) {
        let out = result.output;
        if (typeof out === 'string') { try { out = JSON.parse(out); } catch { out = null; } }
        const cleaned = Array.isArray(out?.resources) ? out.resources.map(cleanResource).filter(Boolean) : [];
        if (cleaned.length) {
          // A model's resources keep the costs and modules the design already had for the same key.
          const before = new Map((design.resources ?? []).map((r) => [r.key, r]));
          resources = cleaned.map((r) => ({ ...(before.get(r.key) ?? {}), ...r }));
          added = cleaned.filter((r) => !before.has(r.key)).map((r) => r.name);
        } else log.warn(`infrastructure: ${agent.name}'s draft of ${id} wasn't a list of resources; the scripted draft is used`);
      }
    }
    // The version being replaced is kept, approved or not.
    await repos.designs.keepVersion(design);
    const at = iso();
    const builtFrom = [
      ...(inputs.adrs ?? []).filter((a) => a.status === 'accepted').map((a) => ({ label: `${a.id} · ${a.title}`, kind: 'adr', href: `/design/architecture/${design.itemId}` })),
      ...(inputs.containers?.length ? [{ label: `Container view · ${inputs.containers.length} containers`, kind: 'diagram', href: `/design/architecture/${design.itemId}` }] : []),
      ...(inputs.qualityAttributes?.length ? [{ label: `${inputs.qualityAttributes.length} quality attributes`, kind: 'quality-attributes', href: `/design/architecture/${design.itemId}` }] : []),
    ];
    const updated = await repos.designs.update(id, (d) => ({
      ...d,
      version: d.version + 1,
      status: 'waiting-approval',
      resources,
      builtFrom: builtFrom.length ? builtFrom : d.builtFrom,
      draftedBy: agent,
      draftedAt: at,
      updatedAt: at,
      redraftOffered: null,
      // The Architect's approval through an accepted ADR stands; every other approval waits again.
      approvals: (d.approvals ?? []).map((a) => (a.via ? a : { role: a.role, state: 'waiting' })),
      body: `Version ${d.version + 1}, drafted by ${agent.name} from ${design.itemId}'s architecture.${added.length ? ` It adds ${added.join(', ')}.` : ' The architecture adds nothing the design lacks.'}`,
    }));
    await approvals?.sync(id).catch((err) => log.warn(`approvals: ${id}: ${err.message}`));
    await host.events.emit('infra_design.updated', { designId: id, version: updated.version, itemId: design.itemId, reason: `drafted by ${agent.name}`, actorKind: 'agent', actorName: agent.name }, { actor: agent.id });
    await host.events.emit('agent.action', { actor: agent.id, teammateId: agent.id, itemId: design.itemId, system: 'infrastructure', modelRoute, costUsd, at, action: WORK_TYPE, designId: id, requestedBy: person.id }, { actor: agent.id });
    await host.audit?.record?.({ actor: agent.id, action: 'agent.infrastructure.design_drafted', target: id, system: 'infrastructure', itemId: design.itemId, version: updated.version, requestedBy: person.id, costUsd });
    return { designId: id, version: updated.version, draftedBy: agent, added, costUsd, href: `${mountPath}/designs/${id}`, text: `${agent.name} drafted ${id} v${updated.version}${added.length ? `: it adds ${added.join(', ')}` : ''}. It waits for its approvals.` };
  }

  /** An accepted ADR or a changed architecture offers a new draft of the item's designs, saying why. Never drafts. */
  async function offer(event) {
    const p = event?.payload ?? {};
    if (!p.itemId) return 0;
    const why = event.type === 'adr.accepted' || p.adrId ? `${p.adrId ?? 'an ADR'} was accepted${p.title ? ` (${p.title})` : ''}` : `${p.itemId}'s ${String(p.part ?? 'architecture').replace(/-/g, ' ')} changed`;
    let offered = 0;
    for (const d of (await repos.designs.list()).filter((x) => x.itemId === p.itemId)) {
      await repos.designs.update(d.id, (cur) => ({ ...cur, redraftOffered: { reason: why, at: iso() } }));
      await host.events.emit('infra_design.redraft_offered', { designId: d.id, version: d.version, itemId: p.itemId, reason: why }, { actor: null });
      offered += 1;
    }
    return offered;
  }

  return { draft, offer };
}
