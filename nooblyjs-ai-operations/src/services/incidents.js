// INCIDENTS (root product.md §3.7): declared by a person, or raised from an SLO's alert; linked to the release and item
// (the item's release in production, unless one is named). Declaring one puts a signal from production on the Product
// board. Resolving one asks the SRE agent for the timeline and the post-incident review (a teammate task, with a
// scripted draft); a person accepts the review, and it is written to Knowledge. Follow-ups become ideas (the Product
// section) or defects (the lifecycle).
//
//   open ──(a person resolves it)──► resolved: the review drafted ──(a person accepts it)──► reviewed (a Knowledge page)
import { HttpError, badRequest, notFound, conflict } from '../util/errors.js';
import { isItemId } from '../util/ids.js';
import { needs, peopleOnly } from '../util/http.js';

const SEVERITIES = { SEV1: 'SEV1 · customers can\'t buy', SEV2: 'SEV2 · customers notice', SEV3: 'SEV3 · degraded, few notice' };
const STATUS_TEXT = { open: 'Open', resolved: 'Resolved: its review waits', reviewed: 'Reviewed' };
const STANDIN = { id: 'pip-okafor', name: 'Pip Okafor' };
const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const minutes = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

/** The scripted post-incident review: what happened, when, what it cost the error budget, and what to do next. */
export function scriptedReview(incident, { slo = null } = {}) {
  const lines = [
    `# ${incident.id} · ${incident.title}`, '',
    `${SEVERITIES[incident.severity] ?? incident.severity}. ${incident.release ? `Release: ${incident.release}.` : 'No release linked.'} Item: ${incident.itemId ?? 'none'}.`, '',
    '## What happened', '', incident.detail || incident.title, '',
    '## Impact', '', `Open for ${minutes(incident.declaredAt, incident.resolvedAt)} minutes.${slo ? ` ${slo.name} SLO: ${slo.budgetText}.` : ''}`, '',
    '## Timeline', '', ...incident.timeline.map((t) => `- ${String(t.at).slice(0, 16).replace('T', ' ')} · ${t.what}`), '',
    '## Cause', '', incident.resolution || '[PLACEHOLDER] A person confirms the cause.', '',
    '## Follow-ups', '', ...(incident.followUps?.length ? incident.followUps.map((f) => `- ${f.title} (${f.kind}${f.ref ? `: ${f.ref}` : ''})`) : ['- [PLACEHOLDER] What would have caught this sooner?']), '',
  ];
  return lines.join('\n');
}

export function createIncidents({ repos, host, log, policies, slos, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();
  const svc = (name) => host.service?.(name) ?? null;
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? actor ?? null });
  const who = (p) => (p ? { id: p.id, name: p.name ?? p.id } : null);

  async function getOr404(id) {
    const i = await repos.incidents.get(id);
    if (!i) throw notFound(`There is no incident ${id}.`);
    return i;
  }
  const shape = (i) => i && ({ ...i, body: undefined, statusText: STATUS_TEXT[i.status] ?? i.status, severityText: SEVERITIES[i.severity] ?? i.severity, href: `${mountPath}/incidents/${i.id}`, minutesOpen: i.resolvedAt ? minutes(i.declaredAt, i.resolvedAt) : null });

  /** The release an incident belongs to: the one named, else the item's newest release in production. */
  async function releaseFor(itemId, releaseId) {
    const all = await repos.releases.list();
    if (releaseId) return all.find((r) => r.id === releaseId) ?? null;
    return all.filter((r) => r.itemId === itemId && ['piloting', 'complete', 'rolled-back'].includes(r.status)).at(-1) ?? null;
  }

  /** A person declares an incident (or raises one from an SLO's alert). */
  async function declare(body = {}, person) {
    await peopleOnly(host, person, 'declare an incident');
    await needs(host, person, 'draft', 'declare an incident');
    const title = clean(body.title, 160);
    if (!title) throw badRequest('Say what is wrong, in a few words.', { title: 'required' });
    const severity = SEVERITIES[body.severity] ? body.severity : 'SEV2';
    const slo = body.sloId ? await slos.get(body.sloId) : null;
    const itemId = slo?.itemId ?? (isItemId(body.itemId) ? body.itemId : null);
    const release = await releaseFor(itemId, slo?.releaseId ?? clean(body.releaseId, 20));
    const at = iso();
    const incident = await repos.incidents.create({
      title, severity, status: 'open', itemId: itemId ?? release?.itemId ?? null, releaseId: release?.id ?? null, release: release ? `${release.id} · ${release.name}` : null,
      sloId: slo?.id ?? null, detail: clean(body.detail, 2000), declaredBy: who(person), declaredAt: at, followUps: [],
      timeline: [{ at, what: `${person.name ?? person.id} declared it (${severity})${slo ? ` from the ${slo.name} SLO's alert` : ''}` }],
    });
    await emit('incident.declared', { incidentId: incident.id, itemId: incident.itemId, releaseId: incident.releaseId, severity, title, summary: `declared ${incident.id} (${severity}): ${title}${incident.release ? `, on ${incident.release}` : ''}` }, person);
    // Production speaks to the Product board: a signal linked to the release and item.
    const signal = await Promise.resolve(svc('product')?.raiseSignal?.({ key: title, title, product: release?.product ?? null, theme: 'production', unit: 'incidents', sourceLabel: 'Production', release: incident.release, itemId: incident.itemId, detail: `${incident.id}: ${incident.detail || title}`, actor: { id: 'operations', name: 'Operations', kind: 'app' } })).catch((err) => { log.warn(`incident ${incident.id}: no signal raised: ${err.message}`); return null; });
    if (signal) await repos.incidents.update(incident.id, (cur) => ({ ...cur, signalId: signal.id }));
    return shape(await getOr404(incident.id));
  }

  /** A line on the timeline (what was seen, what was tried). */
  async function note(id, body = {}, person) {
    await needs(host, person, 'draft', `add to ${id}'s timeline`);
    const text = clean(body.text, 1000);
    if (!text) throw badRequest('Say what happened.', { text: 'required' });
    const at = iso();
    return shape(await repos.incidents.update(id, (cur) => {
      if (!cur) throw notFound(`There is no incident ${id}.`);
      return { ...cur, timeline: [...cur.timeline, { at, what: `${person.name ?? person.id}: ${text}` }] };
    }));
  }

  /** The SRE agent drafts the post-incident review (a teammate task). */
  async function draftReview(incident, person) {
    const slo = incident.sloId ? await slos.get(incident.sloId).catch(() => null) : null;
    const scripted = scriptedReview(incident, { slo });
    const t = svc('teammates');
    const wanted = (await policies.read()).sre?.teammates ?? [STANDIN.id];
    let agent = { ...STANDIN, kind: 'agent' };
    let text = scripted;
    if (typeof t?.runTask === 'function') {
      const roster = (await Promise.resolve(t.roster?.()).catch(() => [])) ?? [];
      const pick = wanted.map((slug) => roster.find((a) => a.id === slug)).find(Boolean);
      if (pick) agent = { id: pick.id, name: pick.name ?? pick.id, kind: 'agent' };
      const result = await t.runTask({
        slug: agent.id, workType: 'post-incident-review', itemId: incident.itemId, system: 'operations',
        caller: person?.id ? { type: 'user', id: person.id, name: person.name ?? person.id } : null,
        input: { task: `Write the post-incident review of ${incident.id} (${incident.title}): what happened, the impact, the timeline, the cause as far as it is known, and follow-ups. Blameless, in plain words.`, context: JSON.stringify({ incident, slo }).slice(0, 20_000) },
        scripted: async () => ({ output: scripted, costUsd: 0 }),
      }).catch((err) => { log.warn(`incident ${incident.id}: the review draft failed: ${err.message}`); return { scripted: true }; });
      if (!result.scripted && typeof result.output === 'string' && result.output.trim()) text = result.output.trim().slice(0, 12_000);
    }
    return { text, draftedBy: agent, at: iso() };
  }

  /** A person resolves it: the SRE agent drafts the review. */
  async function resolve(id, body = {}, person) {
    await peopleOnly(host, person, `resolve ${id}`);
    await needs(host, person, 'draft', `resolve ${id}`);
    const current = await getOr404(id);
    if (current.status !== 'open') throw conflict(`${id} is ${STATUS_TEXT[current.status].toLowerCase()} already.`);
    const at = iso();
    const resolution = clean(body.resolution, 1000);
    await repos.incidents.update(id, (cur) => ({ ...cur, status: 'resolved', resolvedAt: at, resolvedBy: who(person), resolution, timeline: [...cur.timeline, { at, what: `${person.name ?? person.id} resolved it${resolution ? `: ${resolution}` : ''}` }] }));
    const review = await draftReview(await getOr404(id), person);
    const updated = await repos.incidents.update(id, (cur) => ({ ...cur, review: { ...review, status: 'draft' } }));
    await emit('incident.resolved', { incidentId: id, itemId: current.itemId, releaseId: current.releaseId, minutes: minutes(current.declaredAt, at), declaredAt: current.declaredAt, resolvedAt: at, summary: `resolved ${id} after ${minutes(current.declaredAt, at)} minutes${resolution ? `: ${resolution}` : ''}` }, person);
    await emit('incident.review_drafted', { incidentId: id, itemId: current.itemId, actorKind: 'agent', actorName: review.draftedBy.name, summary: `${review.draftedBy.name} drafted the post-incident review of ${id}` }, review.draftedBy);
    return shape(updated);
  }

  /** A person accepts the review (edited or not): it is written to Knowledge. */
  async function acceptReview(id, body = {}, person) {
    await peopleOnly(host, person, `accept ${id}'s review`);
    await needs(host, person, 'draft', `accept ${id}'s review`);
    const current = await getOr404(id);
    if (current.status !== 'resolved' || current.review?.status !== 'draft') throw conflict(`${id} has no review waiting to be accepted.`);
    const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim().slice(0, 20_000) : current.review.text;
    const page = await Promise.resolve(svc('knowledge')?.writePage?.({ folder: 'Post-incident reviews', title: `${id} ${current.title}`, body: text, by: who(person) })).catch((err) => { log.warn(`incident ${id}: the review was not written to Knowledge: ${err.message}`); return null; });
    const at = iso();
    const updated = await repos.incidents.update(id, (cur) => ({
      ...cur, status: 'reviewed', review: { ...cur.review, text, status: 'accepted', acceptedBy: who(person), acceptedAt: at, page },
      timeline: [...cur.timeline, { at, what: `${person.name ?? person.id} accepted the review${page ? `: ${page.spaceName} · ${page.path}` : ' (Knowledge is not running here)'}` }],
    }));
    await emit('incident.review_accepted', { incidentId: id, itemId: current.itemId, page: page?.href ?? null, summary: `accepted the post-incident review of ${id}${page ? ', written to Knowledge' : ''}` }, person);
    return shape(updated);
  }

  /** A follow-up becomes an idea (the Product section) or a defect on a story (the lifecycle). */
  async function followUp(id, body = {}, person) {
    await needs(host, person, 'draft', `add a follow-up to ${id}`);
    const incident = await getOr404(id);
    const title = clean(body.title, 200);
    if (!title) throw badRequest('Say what to follow up.', { title: 'required' });
    let ref;
    if (body.kind === 'defect') {
      const storyId = clean(body.storyId, 40);
      const w = svc('workflows');
      if (typeof w?.recordDefect !== 'function') throw new HttpError(503, 'workflows_unavailable', 'The lifecycle engine is not running here.');
      ref = (await w.recordDefect({ storyId, title, severity: body.severity ?? 'S2', text: `From ${id}: ${incident.title}`, actor: person })).id;
    } else {
      const product = svc('product');
      if (typeof product?.createIdea !== 'function') throw new HttpError(503, 'product_unavailable', 'The Product section is not running here.');
      ref = (await product.createIdea({ title, problem: `From ${id} (${incident.title}).`, signals: incident.signalId ? [incident.signalId] : [], actor: person })).id;
    }
    const kind = body.kind === 'defect' ? 'defect' : 'idea';
    return shape(await repos.incidents.update(id, (cur) => ({ ...cur, followUps: [...(cur.followUps ?? []), { kind, title, ref, by: who(person), at: iso() }] })));
  }

  const list = async () => (await repos.incidents.list()).map(shape).reverse();
  const get = async (id) => shape(await getOr404(id));
  return { declare, note, resolve, acceptReview, followUp, list, get };
}
