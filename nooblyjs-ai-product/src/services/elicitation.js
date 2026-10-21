// Requirements elicitation (NooblyJS Phase 18, root product.md §3.4): where requirements come from, and who said so. One
// file per item, data/product/elicitation/<item>.md:
//
//   stakeholders  [{ id, name, personId?, teamId?, kind: person | team | outside, role: affected | decides | consulted }]
//   sessions      [{ id: SES-033-1, kind: interview | workshop | meeting, title, at, with, notes, source: manual | teams, by }]
//   candidates    [{ id: CAN-033-1, text, kind: functional | nfr, category?, quotes: [{ session, quote }], status: proposed |
//                    accepted | merged | rejected, into?, reason?, requirement?, decidedBy?, draftedBy }]
//   requirements  [{ id: REQ-033-01, text, kind, category?, target?, quotes, from: [CAN-…], acceptedBy, acceptedAt, criteria: [{ id: AC-033-01-1, text }] }]
//   nfr           { <category>: { status: answered | not-applicable, answers: [{ text, target, requirement? , candidate? }], reason? } }
//   questions     [{ id: Q-033-1, kind: question | assumption, text, owner, status: open | answered, answer? }]
//
// The analyst agent (Ada Quill stands in) turns session notes into candidates, each quoting its source; a person with
// accept-requirement accepts, merges or rejects each one (agents are refused and audited). An accepted NFR with a target
// becomes a row of the item's quality attributes (which Design's solution draft turns into its NFRs). While a question is
// open, the spec's readiness has a check that fails naming it.
import { HttpError, badRequest, notFound } from '../util/errors.js';
import { isAgent } from '../util/http.js';

const KINDS = new Set(['interview', 'workshop', 'meeting']);
const ROLES = new Set(['affected', 'decides', 'consulted']);
const MAX = 20000;
const CUE = /\b(need|needs|must|should|want|wants|has to|have to|expects?|requires?|would like)\b/i;
const NFR_WORDS = { performance: /\b(p9\d|ms|seconds?|fast|quick|load|latency|peak)\b/i, availability: /\b(available|availability|uptime|down|outage)\b/i, security: /\b(secure|security|password|login|auth)\b/i, privacy: /\b(personal data|privacy|gdpr|consent)\b/i, accessibility: /\b(screen reader|accessib|keyboard|wcag)\b/i, cost: /\b(cost|budget|cheap)\b/i };
const USUAL = { id: 'ada-quill', name: 'Ada Quill' };

const num = (itemId) => String(itemId).replace(/^[A-Z]+-/, '');
const clean = (value, field, max = 600) => {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required.`, { [field]: 'required' });
  const t = value.replace(/\r\n/g, '\n').trim();
  if (t.length > max) throw badRequest(`Keep ${field} under ${max} characters.`, { [field]: `max ${max}` });
  return t;
};
const ref = (a) => (isAgent(a) ? { id: a.id, name: a.name ?? a.id, kind: 'agent' } : { id: a.id, name: a.name ?? a.id, kind: 'person' });
const sentences = (text) => String(text ?? '').split(/\n+|(?<=[.!?])\s+/).map((s) => s.replace(/^[-*•]\s*/, '').replace(/^[^:]{1,40}:\s+/, '').trim()).filter((s) => s.length > 8);

export function createElicitation({ repos, host, architecture, log }) {
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, { system: 'product', ...payload }, { actor: actor?.id ?? null });
  const audit = (entry) => Promise.resolve(host.audit?.record?.(entry)).catch(() => {});

  async function specOr404(itemId) {
    const spec = await repos.specs.get(itemId).catch(() => null);
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    return spec;
  }
  const blank = (itemId) => ({ id: itemId, stakeholders: [], sessions: [], candidates: [], requirements: [], nfr: {}, questions: [], body: '' });
  const read = async (itemId) => ({ ...blank(itemId), ...((await repos.elicitation.get(itemId)) ?? {}) });
  const change = async (itemId, fn) => {
    await specOr404(itemId);
    let answer;
    await repos.elicitation.update(itemId, async (cur) => {
      const doc = { ...blank(itemId), ...(cur ?? {}) };
      answer = await fn(doc);
      return { ...doc, updatedAt: now(), body: '' };
    });
    return answer;
  };
  const next = (list, prefix, pad = 1) => `${prefix}-${String(list.length + 1).padStart(pad, '0')}`;

  /** People only, with accept-requirement: an agent is refused and the refusal audited. */
  async function decider(actor, itemId, what) {
    if (!actor?.id) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
    if (isAgent(actor)) {
      await audit({ actor: actor.id, action: 'access.refused', target: itemId, reason: `agents propose, people decide: an agent can't ${what}` });
      throw new HttpError(403, 'people_only', `Agents propose and people decide: ${actor.name ?? actor.id} can't ${what}.`);
    }
    if (!(await host.can?.(actor.accessRole, 'accept-requirement'))) {
      throw new HttpError(403, 'forbidden', `You can't ${what}: it needs the "accept-requirement" permission, and your access role is ${actor.accessRole ?? 'none'}.`, { permission: 'accept-requirement' });
    }
  }

  // ---------------------------------------------------------------------------- stakeholders, sessions, questions

  async function addStakeholder(itemId, body = {}, actor) {
    const name = clean(body.name, 'name', 80);
    const role = ROLES.has(body.role) ? body.role : 'affected';
    const kind = body.personId ? 'person' : body.teamId ? 'team' : 'outside';
    const s = await change(itemId, (doc) => {
      const st = { id: next(doc.stakeholders, `STK-${num(itemId)}`), name, kind, role, ...(body.personId ? { personId: String(body.personId) } : {}), ...(body.teamId ? { teamId: String(body.teamId) } : {}) };
      doc.stakeholders.push(st);
      return st;
    });
    await emit('elicitation.stakeholder_added', { itemId, stakeholder: s.id, summary: `added ${name} (${role}) to ${itemId}'s stakeholders` }, actor);
    return s;
  }

  async function addSession(itemId, body = {}, actor, { source = 'manual' } = {}) {
    if (body.kind !== undefined && !KINDS.has(body.kind)) throw badRequest('A session is an interview, a workshop or a meeting.', { kind: 'interview | workshop | meeting' });
    const kind = body.kind ?? 'interview';
    const notes = clean(body.notes, 'notes', MAX);
    const s = await change(itemId, (doc) => {
      const session = { id: next(doc.sessions, `SES-${num(itemId)}`), kind, title: String(body.title ?? '').trim().slice(0, 120) || `${kind[0].toUpperCase()}${kind.slice(1)}`, at: body.at ?? now(), with: Array.isArray(body.with) ? body.with.map(String).slice(0, 20) : [], notes, source, by: actor ? ref(actor) : null };
      doc.sessions.push(session);
      return session;
    });
    await emit('elicitation.session_recorded', { itemId, session: s.id, kind, source, summary: `recorded ${s.id} · ${s.title} (${kind}${source === 'teams' ? ', from Teams' : ''}) for ${itemId}` }, actor);
    return s;
  }

  async function addQuestion(itemId, body = {}, actor) {
    const q = await change(itemId, (doc) => {
      const question = { id: next(doc.questions, `Q-${num(itemId)}`), kind: body.kind === 'assumption' ? 'assumption' : 'question', text: clean(body.text, 'text'), owner: String(body.owner ?? actor?.id ?? '').slice(0, 64) || null, status: 'open' };
      doc.questions.push(question);
      return question;
    });
    await emit('elicitation.question_added', { itemId, question: q.id, summary: `asked ${q.id} on ${itemId}: ${q.text}` }, actor);
    return q;
  }

  async function answerQuestion(itemId, qid, body = {}, actor) {
    const answer = clean(body.answer, 'answer', 2000);
    const q = await change(itemId, (doc) => {
      const found = doc.questions.find((x) => x.id === qid);
      if (!found) throw notFound(`${itemId} has no question ${qid}.`);
      Object.assign(found, { status: 'answered', answer, answeredBy: actor.id, answeredAt: now() });
      return found;
    });
    await emit('elicitation.question_answered', { itemId, question: qid, summary: `answered ${qid} on ${itemId}` }, actor);
    return q;
  }

  // ---------------------------------------------------------------------------- candidates and requirements

  /** The scripted draft: each sentence of a session's notes that asks for something, quoted, not yet a candidate. */
  function scriptedCandidates(doc) {
    const known = new Set(doc.candidates.flatMap((c) => c.quotes.map((q) => q.quote)));
    const out = [];
    for (const s of doc.sessions) {
      for (const sentence of sentences(s.notes)) {
        if (!CUE.test(sentence) || known.has(sentence)) continue;
        known.add(sentence);
        const category = Object.entries(NFR_WORDS).find(([, re]) => re.test(sentence))?.[0] ?? null;
        out.push({ text: sentence.replace(/[.!]+$/, ''), kind: category ? 'nfr' : 'functional', ...(category ? { category } : {}), quotes: [{ session: s.id, quote: sentence }] });
      }
    }
    return out;
  }

  /** Ada drafts candidates from the sessions' notes (a teammate task), each quoting where it came from. */
  async function draftCandidates(itemId, actor) {
    const doc = await read(itemId);
    await specOr404(itemId);
    if (!doc.sessions.length) throw new HttpError(409, 'no_sessions', `${itemId} has no elicitation session yet: record one first.`);
    const scripted = scriptedCandidates(doc);
    const t = host.service?.('teammates');
    let agent = { ...USUAL, kind: 'agent' };
    let drafted = scripted;
    if (typeof t?.roster === 'function') {
      const roster = (await t.roster().catch(() => [])) ?? [];
      const pick = roster.find((a) => a.id === USUAL.id) ?? (roster.length === 1 ? roster[0] : null);
      if (!pick) throw new HttpError(409, 'no_teammate', `${USUAL.name} drafts candidate requirements, and isn't hired here.`);
      agent = { id: pick.id, name: pick.name ?? pick.id, kind: 'agent' };
      const result = await t.runTask({
        slug: agent.id, workType: 'requirements-elicitation', itemId, system: 'product',
        caller: actor?.id ? { type: 'user', id: actor.id, name: actor.name ?? actor.id } : null,
        input: { task: `Turn ${itemId}'s session notes into candidate requirements, each quoting its source, as JSON.`, context: JSON.stringify(doc.sessions.map(({ id, notes }) => ({ id, notes }))).slice(0, 20_000) },
        scripted: async () => ({ output: scripted, costUsd: 0 }),
      });
      if (!result.scripted && Array.isArray(result.output)) drafted = result.output.filter((c) => c?.text && c?.quotes?.length);
    } else if (process.env.NODE_ENV === 'production') {
      throw new HttpError(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft.');
    }
    const made = await change(itemId, (d) => drafted.map((c) => {
      const cand = { id: next(d.candidates, `CAN-${num(itemId)}`), text: String(c.text).slice(0, 600), kind: c.kind === 'nfr' ? 'nfr' : 'functional', ...(c.category ? { category: c.category } : {}), quotes: c.quotes, status: 'proposed', draftedBy: agent };
      d.candidates.push(cand);
      return cand;
    }));
    await emit('elicitation.candidates_drafted', { itemId, candidates: made.map((c) => c.id), actorKind: 'agent', actorName: agent.name, summary: `${agent.name} drafted ${made.length} candidate requirement${made.length === 1 ? '' : 's'} for ${itemId}` }, agent);
    return made;
  }

  /** A candidate becomes a requirement (REQ-033-01) with its sources and who accepted it. */
  async function accept(itemId, cid, actor, body = {}) {
    await decider(actor, itemId, 'accept a requirement');
    const req = await change(itemId, (doc) => {
      const c = doc.candidates.find((x) => x.id === cid);
      if (!c) throw notFound(`${itemId} has no candidate ${cid}.`);
      if (c.status !== 'proposed') throw new HttpError(409, 'decided', `${cid} is ${c.status} already.`);
      const merged = doc.candidates.filter((x) => x.into === cid);
      const requirement = {
        id: next(doc.requirements, `REQ-${num(itemId)}`, 2), text: typeof body.text === 'string' && body.text.trim() ? body.text.trim().slice(0, 600) : c.text,
        kind: c.kind, ...(c.category ? { category: c.category } : {}), ...(c.target ? { target: c.target } : {}),
        quotes: [...c.quotes, ...merged.flatMap((m) => m.quotes)], from: [cid, ...merged.map((m) => m.id)],
        acceptedBy: ref(actor), acceptedAt: now(), criteria: [],
      };
      doc.requirements.push(requirement);
      Object.assign(c, { status: 'accepted', requirement: requirement.id, decidedBy: actor.id });
      return requirement;
    });
    await audit({ actor: actor.id, action: 'requirement.accepted', target: itemId, candidate: cid, requirement: req.id });
    await emit('requirement.accepted', { itemId, requirement: req.id, candidate: cid, summary: `accepted ${req.id} on ${itemId}: ${req.text}` }, actor);
    if (req.kind === 'nfr' && req.target) await toQualityAttributes(itemId, [req], actor);
    return req;
  }

  async function merge(itemId, cid, into, actor) {
    await decider(actor, itemId, 'merge candidate requirements');
    if (typeof into !== 'string' || !into || into === cid) throw badRequest('Say which other candidate to merge it into.', { into: 'another candidate' });
    const c = await change(itemId, (doc) => {
      const c0 = doc.candidates.find((x) => x.id === cid);
      const target = doc.candidates.find((x) => x.id === into);
      if (!c0 || !target) throw notFound(`${itemId} has no candidate ${!c0 ? cid : into}.`);
      if (c0.status !== 'proposed' || target.status !== 'proposed') throw new HttpError(409, 'decided', 'Only two candidates still proposed can be merged.');
      Object.assign(c0, { status: 'merged', into, decidedBy: actor.id });
      return c0;
    });
    await audit({ actor: actor.id, action: 'requirement.merged', target: itemId, candidate: cid, into });
    await emit('requirement.merged', { itemId, candidate: cid, into, summary: `merged ${cid} into ${into} on ${itemId}` }, actor);
    return c;
  }

  async function reject(itemId, cid, reason, actor) {
    await decider(actor, itemId, 'reject a requirement');
    const why = clean(reason, 'reason', 500);
    const c = await change(itemId, (doc) => {
      const c0 = doc.candidates.find((x) => x.id === cid);
      if (!c0) throw notFound(`${itemId} has no candidate ${cid}.`);
      if (c0.status !== 'proposed') throw new HttpError(409, 'decided', `${cid} is ${c0.status} already.`);
      Object.assign(c0, { status: 'rejected', reason: why, decidedBy: actor.id });
      return c0;
    });
    await audit({ actor: actor.id, action: 'requirement.rejected', target: itemId, candidate: cid, reason: why });
    await emit('requirement.rejected', { itemId, candidate: cid, reason: why, summary: `rejected ${cid} on ${itemId}: ${why}` }, actor);
    return c;
  }

  /** One decision on a candidate, as another app passes it (the test fixture's agent): accept | merge | reject. */
  async function decide({ itemId, candidateId, decision, into = null, reason = null, actor } = {}) {
    if (decision === 'accept') return accept(itemId, candidateId, actor);
    if (decision === 'merge') return merge(itemId, candidateId, into, actor);
    if (decision === 'reject') return reject(itemId, candidateId, reason, actor);
    throw badRequest('decision is accept, merge or reject.');
  }

  /** An acceptance criterion hung off a requirement (AC-033-01-1). */
  async function addCriterion(itemId, reqId, body = {}, actor) {
    const text = clean(body.text, 'text');
    const ac = await change(itemId, (doc) => {
      const r = doc.requirements.find((x) => x.id === reqId);
      if (!r) throw notFound(`${itemId} has no requirement ${reqId}.`);
      const criterion = { id: `AC-${reqId.replace(/^REQ-/, '')}-${(r.criteria ?? []).length + 1}`, text };
      r.criteria = [...(r.criteria ?? []), criterion];
      return criterion;
    });
    await emit('requirement.criterion_added', { itemId, requirement: reqId, criterion: ac.id, summary: `added ${ac.id} to ${reqId}` }, actor);
    return ac;
  }

  // ---------------------------------------------------------------------------- the NFR walk

  /** The Design section's catalogue: its categories, each with its prompt and entries. */
  async function catalogue() {
    const read2 = await Promise.resolve(host.service?.('design')?.nfrCatalogue?.()).catch(() => null);
    return read2?.categories ?? [];
  }

  /**
   * One category of the walk: answers ([{ text, target }]) or not applicable (with a reason). A person who may accept
   * requirements states accepted NFRs; anyone else's answers are candidates.
   */
  async function walk(itemId, category, body = {}, actor) {
    const cat = (await catalogue()).find((c) => c.key === category);
    if (!cat) throw notFound(`The NFR catalogue has no category "${category}".`);
    const may = !isAgent(actor) && Boolean(await host.can?.(actor?.accessRole, 'accept-requirement'));
    const notApplicable = body.notApplicable === true;
    const answers = notApplicable ? [] : (Array.isArray(body.answers) ? body.answers : []).map((a, i) => ({ text: clean(a?.text, `answers[${i}].text`), target: clean(a?.target, `answers[${i}].target`, 200) }));
    if (!notApplicable && !answers.length) throw badRequest('Answer the category, or mark it not applicable with a reason.');
    const reason = notApplicable ? clean(body.reason, 'reason', 500) : null;
    const made = [];
    await change(itemId, (doc) => {
      const entry = { status: notApplicable ? 'not-applicable' : 'answered', answers: [], ...(reason ? { reason } : {}), by: actor.id, at: now() };
      for (const a of answers) {
        const quote = `${cat.label}: ${a.text} (${a.target})`;
        if (may) {
          const requirement = { id: next(doc.requirements, `REQ-${num(itemId)}`, 2), text: a.text, kind: 'nfr', category: cat.key, target: a.target, quotes: [{ session: 'nfr-walk', quote }], from: [], acceptedBy: ref(actor), acceptedAt: now(), criteria: [] };
          doc.requirements.push(requirement);
          entry.answers.push({ ...a, requirement: requirement.id });
          made.push(requirement);
        } else {
          const cand = { id: next(doc.candidates, `CAN-${num(itemId)}`), text: a.text, kind: 'nfr', category: cat.key, target: a.target, quotes: [{ session: 'nfr-walk', quote }], status: 'proposed', draftedBy: ref(actor) };
          doc.candidates.push(cand);
          entry.answers.push({ ...a, candidate: cand.id });
        }
      }
      doc.nfr = { ...doc.nfr, [cat.key]: entry };
    });
    await emit('elicitation.nfr_walked', { itemId, category: cat.key, status: notApplicable ? 'not-applicable' : 'answered', requirements: made.map((r) => r.id), summary: `walked ${cat.label} for ${itemId}: ${notApplicable ? `not applicable (${reason})` : `${answers.length} answer${answers.length === 1 ? '' : 's'}`}` }, actor);
    if (made.length) {
      await audit({ actor: actor.id, action: 'requirement.accepted', target: itemId, requirements: made.map((r) => r.id), via: 'nfr-walk' });
      await toQualityAttributes(itemId, made, actor);
    }
    return { category: cat.key, requirements: made };
  }

  /** Accepted NFRs with a target become rows of the item's quality attributes, each naming its requirement. */
  async function toQualityAttributes(itemId, reqs, actor) {
    if (!architecture?.qualityAttributes) return;
    const cats = await catalogue();
    const current = (await architecture.qualityAttributes(itemId).catch(() => null))?.attributes ?? [];
    const rows = reqs.filter((r) => !current.some((q) => q.scenario.includes(`(${r.id})`))).map((r) => ({
      attribute: cats.find((c) => c.key === r.category)?.label ?? r.category ?? 'NFR', scenario: `${r.text} (${r.id})`.slice(0, 200), target: String(r.target).slice(0, 200), verifiedBy: 'To be agreed',
    }));
    if (!rows.length) return;
    try {
      await architecture.saveQualityAttributes(itemId, { attributes: [...current, ...rows] }, actor, { ifMatch: '*' });
    } catch (err) {
      log?.warn?.(`product: ${itemId}'s quality attributes were not updated from its NFRs: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------- reading

  async function view(itemId) {
    const spec = await specOr404(itemId);
    const doc = await read(itemId);
    const cats = await catalogue();
    const walked = cats.filter((c) => doc.nfr[c.key]);
    const open = doc.questions.filter((q) => q.status === 'open');
    const proposed = doc.candidates.filter((c) => c.status === 'proposed');
    return {
      itemId, title: spec.title, stakeholders: doc.stakeholders, sessions: doc.sessions, candidates: doc.candidates, requirements: doc.requirements, questions: doc.questions,
      nfr: { categories: cats.map((c) => ({ key: c.key, label: c.label, prompt: c.prompt ?? null, entries: c.entries, ...(doc.nfr[c.key] ?? { status: 'not-walked', answers: [] }) })), walked: walked.length, total: cats.length, text: `${walked.length} of ${cats.length} categories walked` },
      summary: {
        text: `${doc.requirements.length} requirement${doc.requirements.length === 1 ? '' : 's'} · ${proposed.length} candidate${proposed.length === 1 ? '' : 's'} to decide · ${open.length} open question${open.length === 1 ? '' : 's'}`,
        requirements: doc.requirements.length, proposed: proposed.length, openQuestions: open.length, sessions: doc.sessions.length, walked: walked.length, categories: cats.length,
      },
    };
  }

  /** The spec's accepted requirements (the spec reads from them). */
  async function requirementsFor(itemId) {
    return (await read(itemId)).requirements;
  }

  /** The spec's extra readiness check (Phase 18): only when it has questions; fails while one is open, naming it. */
  async function facts(itemId) {
    const doc = await read(itemId);
    if (!doc.questions.length) return {};
    const open = doc.questions.filter((q) => q.status === 'open');
    return {
      'questions-answered': {
        value: open.length === 0, ...(open.length ? { detail: open.map((q) => `${q.id} "${q.text}"${q.owner ? ` (owner ${q.owner})` : ''}`).join('; ') } : {}),
        check: { passed: 'Every question is answered', failed: 'A question is still open' },
      },
    };
  }

  /** Every spec's elicitation in words (the Business analyst's home). */
  async function all() {
    const specs = await repos.specs.list();
    return Promise.all(specs.map(async (s) => ({ itemId: s.id, title: s.title, status: s.status, ...(await view(s.id).catch(() => null))?.summary })));
  }

  return { view, addStakeholder, addSession, addQuestion, answerQuestion, draftCandidates, accept, merge, reject, decide, addCriterion, walk, requirementsFor, facts, all, catalogue };
}
