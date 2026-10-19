// Who drafts each stage. It is one of the agent teammates actually HIRED in Digital Teammates, never a name written
// in code: a draft is that teammate's task, on their timesheet.
//
// For a stage (product · architecture · ux · ui), in this order:
//   1. the teammate a person picked for this draft                       (teammateId in the request)
//   2. the teammate assigned to the stage                                (data/product/agents.yaml; a pick is remembered)
//   3. the stage's usual teammate, when that one is hired                (Ada Quill for specs in the sample story)
//   4. the only teammate there is, when exactly one is hired
// With several hired and none assigned, a person chooses. With none hired, nobody can draft, and the screens say so.
//
// Without Digital Teammates at all (this engine on its own, in development and tests) the stage's usual name stands
// in and drafts are the scripted mock, as before. In production that is refused (drafting.js).
import { HttpError } from '../util/errors.js';

export const STAGES = ['product', 'architecture', 'ux', 'ui'];
/** The stage's usual teammate: used when that one is hired, and as the stand-in when Teammates is not running. */
export const USUAL = Object.freeze({
  product: { id: 'ada-quill', name: 'Ada Quill' },
  architecture: { id: 'rhea-voss', name: 'Rhea Voss' },
  ux: { id: 'design-agent', name: 'Design agent' },
  ui: { id: 'ui-agent', name: 'UI agent' },
});
const STAGE_WORDS = { product: 'specs', architecture: 'architecture', ux: 'UX design', ui: 'UI design' };
const FILE = ['agents.yaml'];
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ref = (a) => ({ id: a.id, name: a.name ?? a.id, kind: 'agent' });

export function createStageAgents({ host, log }) {
  /** The hired teammates, or null when Digital Teammates is not running here. */
  async function hired() {
    const teammates = host.service?.('teammates');
    if (typeof teammates?.roster !== 'function') return null;
    try {
      return (await teammates.roster()).map((a) => ({ id: a.id, name: a.name ?? a.id, role: a.role ?? null, canWork: a.canWork !== false, statusText: a.statusText ?? null }));
    } catch (err) {
      log?.warn?.(`stage agents: the roster could not be read: ${err.message}`);
      return [];
    }
  }
  const assigned = async () => (await host.store.readYaml(FILE).catch(() => null)) ?? {};

  /**
   * Who drafts this stage, and who else could: { teammate, options, reason }. `teammate` is null when nobody can
   * (reason says why, in words for a person). `standalone` is true when Teammates is not running.
   */
  async function forStage(stage, { teammateId = null } = {}) {
    if (!STAGES.includes(stage)) throw new HttpError(400, 'invalid', `"${stage}" is not a stage.`);
    const list = await hired();
    if (list === null) return { stage, teammate: ref(USUAL[stage]), options: [], standalone: true, reason: null };
    const by = (id) => (id ? list.find((a) => a.id === id) : null);
    if (teammateId && !by(teammateId)) throw new HttpError(422, 'unknown_teammate', `${String(teammateId).slice(0, 60)} is not one of your hired teammates.`, { teammateId: 'pick a hired teammate' });
    const pick = by(teammateId) ?? by((await assigned())[stage]) ?? by(USUAL[stage].id) ?? (list.length === 1 ? list[0] : null);
    const options = list.map((a) => ({ id: a.id, name: a.name, role: a.role }));
    if (pick) return { stage, teammate: ref(pick), options, standalone: false, reason: null };
    return {
      stage, teammate: null, options, standalone: false,
      reason: list.length ? `Choose which teammate drafts ${STAGE_WORDS[stage]}: ${list.map((a) => a.name).join(', ')}.` : 'No agent teammate is hired yet. Hire one in Teammates, then ask again.',
    };
  }

  /** The teammate for a draft, or a refusal a person can act on. A pick made here is remembered for the stage. */
  async function resolve(stage, { teammateId = null, actor = null } = {}) {
    const found = await forStage(stage, { teammateId });
    if (!found.teammate) throw new HttpError(409, found.options.length ? 'choose_teammate' : 'no_teammate', found.reason, { options: found.options });
    if (teammateId && !found.standalone && (await assigned())[stage] !== teammateId) await assign(stage, teammateId, actor);
    return found.teammate;
  }

  /** A person says which hired teammate drafts a stage from now on. */
  async function assign(stage, teammateId, actor = null) {
    if (!STAGES.includes(stage)) throw new HttpError(400, 'invalid', `"${stage}" is not a stage.`);
    if (!ID.test(String(teammateId ?? ''))) throw new HttpError(422, 'unknown_teammate', 'Pick a hired teammate.', { teammateId: 'pick a hired teammate' });
    const list = (await hired()) ?? [];
    const teammate = list.find((a) => a.id === teammateId);
    if (!teammate) throw new HttpError(422, 'unknown_teammate', `${teammateId} is not one of your hired teammates.`, { teammateId: 'pick a hired teammate' });
    const before = (await assigned())[stage] ?? null;
    await host.store.withLock(FILE, async () => host.store.writeYaml(FILE, { ...(await assigned()), [stage]: teammateId }));
    if (before !== teammateId) {
      await host.audit?.record?.({ actor: actor?.id ?? 'system', action: 'product.stage_agent_assigned', target: stage, system: 'product', from: before, to: teammateId });
      await host.events?.emit?.('product.stage_agent_assigned', { stage, teammateId, summary: `chose ${teammate.name} to draft ${STAGE_WORDS[stage]}` }, { actor: actor?.id ?? null })?.catch?.(() => {});
    }
    return { stage, teammate: ref(teammate) };
  }

  /** Every stage at once, for the screens: { product: { teammate, options, reason }, … }. */
  async function all() {
    const out = {};
    for (const stage of STAGES) out[stage] = await forStage(stage);
    return out;
  }

  return { forStage, resolve, assign, all };
}
