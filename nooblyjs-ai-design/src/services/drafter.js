// Phase 16c: who drafts each part of the design, and how. A draft is a task of a teammate actually HIRED in Digital
// Teammates (host.service('teammates').runTask), so it is checked by Platform, billed and attributed like any other
// agent work. With no model configured the teammate plays the section's scripted draft (drafts.js); with one, the
// model's answer is read as JSON of the same shape, and the scripted draft is used when it isn't.
//
// The part's usual teammate drafts when it is hired, else the only hired teammate. No analyst agent is in the roster
// yet, so Ada Quill (Research Analyst) stands in for the analyst and Rhea Voss (Architect) for the solution architect
// [CONFIRM: a dedicated analyst agent]. Without Digital Teammates at all (the section on its own, in tests) the usual
// name stands in and the scripted draft is the answer; in production that is refused.
import { HttpError } from '../util/errors.js';

export const PARTS = {
  requirements: { usual: { id: 'ada-quill', name: 'Ada Quill' }, workType: 'requirements-drafting', what: 'the business requirements' },
  solution: { usual: { id: 'rhea-voss', name: 'Rhea Voss' }, workType: 'architecture-drafting', what: 'the solution architecture' },
  functional: { usual: { id: 'ada-quill', name: 'Ada Quill' }, workType: 'analysis-drafting', what: 'the functional analysis' },
  stories: { usual: { id: 'rhea-voss', name: 'Rhea Voss' }, workType: 'story-drafting', what: 'the stories' },
};
const ref = (a) => ({ id: a.id, name: a.name ?? a.id, kind: 'agent' });

/** The JSON object in a model's answer (the whole answer, or its first ```json block), or null. */
function readJson(output) {
  if (output && typeof output === 'object') return output;
  const text = String(output ?? '');
  const block = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  try {
    const value = JSON.parse(block);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function createDrafter({ host, log }) {
  const teammates = () => host.service?.('teammates');

  /** Who drafts this part: { teammate, standalone } or a refusal a person can act on. */
  async function teammateFor(part) {
    const p = PARTS[part];
    if (!p) throw new HttpError(400, 'bad_request', `"${part}" is not a part of the design: one of ${Object.keys(PARTS).join(', ')}.`);
    const t = teammates();
    if (typeof t?.roster !== 'function') return { teammate: ref(p.usual), standalone: true };
    const roster = (await t.roster().catch(() => [])) ?? [];
    const pick = roster.find((a) => a.id === p.usual.id) ?? (roster.length === 1 ? roster[0] : null);
    if (!pick) {
      throw new HttpError(409, roster.length ? 'choose_teammate' : 'no_teammate', roster.length
        ? `${p.usual.name} drafts ${p.what}, and isn't hired here. Hire them in Teammates, or write it yourself.`
        : `No agent teammate is hired yet. Hire one in Teammates, or write ${p.what} yourself.`);
    }
    return { teammate: ref(pick), standalone: false };
  }

  /**
   * Runs one draft. `scripted` is the section's own answer; `task` and `context` are what a model is asked.
   * Resolves { output, by, costUsd, modelRoute, scripted }.
   */
  async function run(part, { itemId, task, context, scripted, actor }) {
    const { teammate, standalone } = await teammateFor(part);
    if (standalone) {
      if (process.env.NODE_ENV === 'production') throw new HttpError(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft.');
      return { output: scripted, by: teammate, costUsd: 0, modelRoute: 'mock', scripted: true };
    }
    const result = await teammates().runTask({
      slug: teammate.id, workType: PARTS[part].workType, itemId, system: 'factory',
      caller: actor?.id ? { type: 'user', id: actor.id, name: actor.name ?? actor.id } : null,
      input: { task, context: JSON.stringify(context).slice(0, 20_000) },
      scripted: async () => ({ output: scripted, costUsd: 0 }),
    });
    const read = result.scripted ? result.output : readJson(result.output);
    if (!read) log?.warn?.(`design: ${teammate.name}'s ${part} draft for ${itemId} wasn't JSON of the expected shape; the scripted draft is used`);
    return { output: read ?? scripted, by: teammate, costUsd: Math.round((Number(result.costUsd) || 0) * 100) / 100, modelRoute: result.modelRoute ?? PARTS[part].workType, scripted: Boolean(result.scripted) };
  }

  /** For the screens: who drafts each part, or why nobody can. */
  async function all() {
    const out = {};
    for (const part of Object.keys(PARTS)) {
      try {
        out[part] = { teammate: (await teammateFor(part)).teammate, reason: null };
      } catch (err) {
        out[part] = { teammate: null, reason: err.message };
      }
    }
    return out;
  }

  return { run, teammateFor, all };
}
