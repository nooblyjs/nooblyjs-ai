// The business case (NooblyJS Phase 17, root product.md §3.3) of an idea (IDEA-018) or an epic (EPIC-001, PEPIC-001):
// why it is worth doing, for whom, how we will know, what it will cost and over what horizon. One file per case,
// data/product/business-cases/<owner>.md.
//
//   required   valueHypothesis · beneficiaries · measure { what, today, target } · estimate { agentUsd, cloudUsdMonth,
//              peopleDays } · horizonMonths. Complete when all are filled (a "[PLACEHOLDER" left by a draft is not filled).
//   optional   risks
//
// An agent drafts it (a teammate task: Ada Quill stands in, as for Design's drafts), with the estimate drawn from the
// factory's history of similar items (estimate.js), each number saying where it came from; a person edits it (agents
// never save one). "Business case complete" is the readiness check an idea needs before it is accepted (Discover).
import { HttpError, badRequest, notFound } from '../util/errors.js';
import { isAgent } from '../util/http.js';
import { estimateFor } from './estimate.js';
import { strategyText } from './strategy-context.js';

const OWNER = /^(IDEA|EPIC|PEPIC)-\d{3,}$/;
const USUAL = { id: 'ada-quill', name: 'Ada Quill' };
const WORK_TYPE = 'business-case-drafting';
const MAX = 2000;
const REQUIRED = [
  ['valueHypothesis', 'the value hypothesis'], ['beneficiaries', 'who benefits'], ['measure', 'the measure (what, today and target)'],
  ['estimate', 'the cost estimate'], ['horizonMonths', 'the horizon'],
];
const placeholder = (v) => typeof v === 'string' && /\[PLACEHOLDER/i.test(v);
const filled = (v) => (typeof v === 'string' ? v.trim() !== '' && !placeholder(v) : v !== null && v !== undefined);
const ref = (a) => (isAgent(a) ? { id: a.id, name: a.name ?? a.id, kind: 'agent' } : { id: a.id, kind: 'person' });
const firstSentence = (text) => String(text ?? '').split(/(?<=[.!?])\s/)[0].trim();

/** What is missing from a case, in words: [] when it is complete. */
export function missingFrom(c) {
  const out = [];
  for (const [key, words] of REQUIRED) {
    const v = c?.[key];
    if (key === 'measure') { if (!v || !filled(v.what) || !filled(v.today) || !filled(v.target)) out.push(words); continue; }
    if (key === 'estimate') { if (!v || ![v.agentUsd, v.cloudUsdMonth, v.peopleDays].every((n) => Number.isFinite(Number(n)) && n !== null && n !== '')) out.push(words); continue; }
    if (key === 'horizonMonths') { if (!(Number(v) > 0)) out.push(words); continue; }
    if (!filled(v)) out.push(words);
  }
  return out;
}

function text(value, field, max = MAX) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} is text.`, { [field]: 'text' });
  const t = value.replace(/\r\n/g, '\n').trim();
  if (t.length > max) throw badRequest(`Keep ${field} under ${max} characters.`, { [field]: `max ${max}` });
  return t;
}
const amount = (value, field) => {
  if (value === undefined || value === null || value === '') return value === '' ? null : value;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw badRequest(`${field} is an amount of 0 or more.`, { [field]: 'number' });
  return Math.round(n * 100) / 100;
};

export function createBusinessCases({ repos, host, hierarchy, log }) {
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, { system: 'product', ...payload }, { actor: actor?.id ?? null });

  /** The idea or epic a case is about: { id, kind, title, product?, problem?, portfolio?, valueStream? }. */
  async function ownerOf(id) {
    if (!OWNER.test(String(id ?? ''))) throw notFound(`There is no idea or epic ${id}.`);
    if (id.startsWith('IDEA-')) {
      const idea = await repos.ideas.get(id);
      if (!idea) throw notFound(`There is no idea ${id}.`);
      return { id, kind: 'idea', title: idea.title, product: idea.product ?? null, problem: idea.body ?? '', feature: idea.feature ?? null };
    }
    const epic = await hierarchy.entry(id.startsWith('PEPIC-') ? 'portfolio-epic' : 'epic', id);
    if (!epic) throw notFound(`There is no epic ${id}.`);
    return { id, kind: 'epic', title: epic.name, product: null, problem: '', portfolio: epic.portfolio, valueStream: epic.valueStream ?? null };
  }

  /** The case as a screen shows it, with what is missing in words. An owner with none reads as an empty case. */
  async function get(id) {
    const owner = await ownerOf(id);
    const c = (await repos.businessCases.get(id)) ?? null;
    const missing = missingFrom(c);
    return {
      ownerId: id, ownerKind: owner.kind, title: owner.title, exists: Boolean(c),
      valueHypothesis: c?.valueHypothesis ?? '', beneficiaries: c?.beneficiaries ?? '', measure: c?.measure ?? { what: '', today: '', target: '' },
      estimate: c?.estimate ?? null, horizonMonths: c?.horizonMonths ?? null, risks: c?.risks ?? '',
      version: c?.version ?? 0, draftedBy: c?.draftedBy ?? null, editedBy: c?.editedBy ?? null, updatedAt: c?.updatedAt ?? null,
      complete: missing.length === 0, missing,
      text: !c ? 'No business case yet' : missing.length ? `Not complete: it needs ${missing.join(', ')}` : 'Complete',
    };
  }

  async function write(id, patch, actor, how) {
    const at = now();
    const saved = await repos.businessCases.update(id, (cur) => ({
      id, ...(cur ?? { createdAt: at }), ...patch,
      version: (cur?.version ?? 0) + 1, updatedAt: at,
      ...(how === 'draft' ? { draftedBy: ref(actor) } : { editedBy: ref(actor) }),
      body: '',
    }));
    return saved;
  }

  /** A person's edit: any of the fields; the estimate's numbers keep their sources unless changed. Agents are refused. */
  async function save(id, body = {}, actor) {
    if (!actor?.id || isAgent(actor)) throw new HttpError(403, 'people_only', 'Agents draft a business case; a person edits it.');
    await ownerOf(id);
    const current = (await repos.businessCases.get(id)) ?? {};
    const patch = {};
    for (const key of ['valueHypothesis', 'beneficiaries', 'risks']) { const v = text(body[key], key); if (v !== undefined) patch[key] = v; }
    if (body.measure !== undefined) {
      const m = body.measure ?? {};
      patch.measure = { ...(current.measure ?? {}), ...Object.fromEntries(['what', 'today', 'target'].filter((k) => m[k] !== undefined).map((k) => [k, text(m[k], `measure.${k}`, 200)])) };
    }
    if (body.estimate !== undefined) {
      const e = body.estimate ?? {};
      const was = current.estimate ?? {};
      const next = { ...was };
      for (const k of ['agentUsd', 'cloudUsdMonth', 'peopleDays']) {
        if (e[k] === undefined) continue;
        next[k] = amount(e[k], `estimate.${k}`);
        // A person's number replaces the history's: its source says so.
        next.basis = (next.basis ?? []).map((b) => (b.part === k ? { ...b, text: `Set by a person (the history said ${was[k] ?? 'nothing'})`, from: [] } : b));
      }
      patch.estimate = next;
    }
    if (body.horizonMonths !== undefined) {
      const n = Number(body.horizonMonths);
      if (!Number.isInteger(n) || n < 1 || n > 120) throw badRequest('The horizon is 1 to 120 months.', { horizonMonths: '1–120' });
      patch.horizonMonths = n;
    }
    if (!Object.keys(patch).length) throw badRequest('Send the fields you changed.');
    await write(id, patch, actor, 'edit');
    const view = await get(id);
    await emit('business_case.updated', { ideaId: id.startsWith('IDEA-') ? id : null, itemId: id, ownerId: id, complete: view.complete, summary: `edited the business case of ${id}: ${view.text}` }, actor);
    return view;
  }

  /** Who drafts: Ada Quill when she is hired, else the only hired teammate; on its own (tests), her name stands in. */
  async function teammate() {
    const t = host.service?.('teammates');
    if (typeof t?.roster !== 'function') return { agent: { ...USUAL, kind: 'agent' }, standalone: true };
    const roster = (await t.roster().catch(() => [])) ?? [];
    const pick = roster.find((a) => a.id === USUAL.id) ?? (roster.length === 1 ? roster[0] : null);
    if (!pick) throw new HttpError(409, 'no_teammate', `${USUAL.name} drafts business cases, and isn't hired here. Hire her in Teammates, or write it yourself.`);
    return { agent: { id: pick.id, name: pick.name ?? pick.id, kind: 'agent' }, standalone: false };
  }

  /**
   * An agent drafts the case: the scripted draft (no model configured) or a model's, with the estimate from the
   * factory's history. It fills what is empty; what a person wrote stays. The measure's target is left for a person.
   */
  async function draft(id, actor) {
    const owner = await ownerOf(id);
    const place = owner.feature ? await hierarchy.placeOf(owner.feature).catch(() => null) : null;
    const estimate = await estimateFor({ host, repos, owner: { ...owner, valueStream: owner.valueStream ?? place?.valueStream ?? null } });
    const scripted = {
      valueHypothesis: `If we ${firstSentence(owner.title).replace(/^./, (c) => c.toLowerCase())}, ${firstSentence(owner.problem).replace(/^./, (c) => c.toLowerCase()) || 'customers get what they came for faster'}`,
      beneficiaries: owner.product ? `Customers of ${owner.product}${place?.valueStream ? ` (${place.valueStream})` : ''}, and the people who serve them` : `The customers ${owner.title} is for`,
      measure: { what: `Customers who use ${owner.title.toLowerCase()}`, today: '0%', target: '[PLACEHOLDER: the target a person sets]' },
      horizonMonths: 12,
      risks: 'Drafted from the factory\'s history of similar items: check the estimate against what this one needs.',
    };
    const { agent, standalone } = await teammate();
    let answer = scripted;
    let costUsd = 0;
    if (!standalone) {
      const result = await host.service('teammates').runTask({
        slug: agent.id, workType: WORK_TYPE, itemId: id, system: 'product',
        caller: actor?.id ? { type: 'user', id: actor.id, name: actor.name ?? actor.id } : null,
        input: { task: `Draft the business case of ${id} · ${owner.title}: value hypothesis, who benefits, the measure (what, today, target) and risks, as JSON.`, context: JSON.stringify({ owner, estimate, strategy: await strategyText(repos).catch(() => '') }).slice(0, 20_000) },
        scripted: async () => ({ output: scripted, costUsd: 0 }),
      });
      costUsd = Number(result.costUsd) || 0;
      if (!result.scripted) {
        try {
          const read = typeof result.output === 'object' ? result.output : JSON.parse(/```(?:json)?\s*([\s\S]*?)```/.exec(String(result.output))?.[1] ?? String(result.output));
          if (read && typeof read === 'object') answer = { ...scripted, ...read };
        } catch {
          log?.warn?.(`product: ${agent.name}'s business case for ${id} wasn't JSON; the scripted draft is used`);
        }
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw new HttpError(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft.');
    }
    const current = (await repos.businessCases.get(id)) ?? {};
    const patch = {};
    for (const key of ['valueHypothesis', 'beneficiaries', 'risks']) if (!filled(current[key]) && answer[key]) patch[key] = String(answer[key]).slice(0, MAX);
    if (!current.measure || !filled(current.measure.what)) patch.measure = { ...answer.measure, ...(current.measure ?? {}) };
    if (!(Number(current.horizonMonths) > 0)) patch.horizonMonths = Number(answer.horizonMonths) || 12;
    patch.estimate = estimate;
    await write(id, patch, agent, 'draft');
    const view = await get(id);
    await emit('business_case.drafted', { ideaId: id.startsWith('IDEA-') ? id : null, itemId: id, ownerId: id, costUsd, actorKind: 'agent', actorName: agent.name, summary: `${agent.name} drafted the business case of ${id} · ${owner.title}: ${view.text}` }, agent);
    return view;
  }

  /** The Discover readiness check of an idea: { itemId, facts: { 'business-case-complete': { value, detail } } }. */
  async function facts(id) {
    const c = await get(id).catch(() => null);
    if (!c) return null;
    return { itemId: id, facts: { 'business-case-complete': c.complete ? { value: true } : { value: false, detail: c.exists ? `it needs ${c.missing.join(', ')}` : 'there is none yet' } } };
  }

  /** Every idea still open and every epic, each with its case in words (the Business owner's home). */
  async function all() {
    const [ideas, h] = await Promise.all([repos.ideas.list(), hierarchy.view()]);
    const owners = [...ideas.filter((i) => (i.status ?? 'open') === 'open').map((i) => i.id), ...h.epics.map((e) => e.id)];
    return Promise.all(owners.map((id) => get(id).catch(() => null))).then((list) => list.filter(Boolean));
  }

  return { get, save, draft, facts, all, missingFrom };
}
