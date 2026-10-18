// Guardrails that apply across every NooblyJS system (product.md §3, Platform · Settings · Guardrails). Changing one
// needs an Owner and a reason. A locked guardrail is a governance rule and cannot be turned off here. Policy
// history is the audit log's guardrail.changed records, so the two can never disagree.
import { HttpError } from '../../util/errors.js';

const FILE = ['platform', 'guardrails.yaml'];

// What applies when the file is missing or doesn't name a guardrail: the safe side of each rule.
export const DEFAULTS = {
  'agents-open-prs': { label: 'Agents open PRs, people merge', on: true, locked: true, enforced: true },
  'prod-deploy-approval': { label: 'Human approval for production deploys', on: true },
  'dependency-adr': { label: 'New dependency requires an ADR', on: true },
  'redact-on-ingest': { label: 'Redact personal data on ingest', on: true, enforced: true },
  'sandbox-internet': { label: 'Allow outbound internet from sandboxes', on: false },
};

export function createGuardrails({ files }) {
  async function list() {
    const doc = (await files.yaml(FILE)) ?? {};
    const given = new Map((doc.guardrails ?? []).map((g) => [g.key, g]));
    const keys = [...new Set([...given.keys(), ...Object.keys(DEFAULTS)])];
    return keys.map((key) => {
      const g = { ...DEFAULTS[key], ...given.get(key) };
      const locked = DEFAULTS[key]?.locked === true || g.locked === true;
      return {
        key,
        label: g.label ?? key,
        scope: g.scope ?? '',
        on: locked ? true : g.on === true,
        locked,
        enforced: g.enforced === true,
        enforcedFrom: g.enforcedFrom ?? null,
      };
    });
  }

  /** One guardrail, or null. */
  const get = async (key) => (await list()).find((g) => g.key === key) ?? null;

  /** Turns a guardrail on or off. Returns { before, after } (the on/off values). */
  async function set(key, { on, reason }) {
    if (typeof on !== 'boolean') throw new HttpError(400, 'invalid_guardrail', '"on" is true or false.');
    const why = String(reason ?? '').trim();
    if (why.length < 3 || why.length > 500) throw new HttpError(400, 'reason_required', 'Say why you are changing this guardrail (3 to 500 characters). It goes in the policy history.');
    const current = await get(key);
    if (!current) throw new HttpError(404, 'guardrail_not_found', `No guardrail "${key}".`);
    if (current.locked) throw new HttpError(422, 'guardrail_locked', `"${current.label}" is a governance rule and cannot be turned off.`);
    if (current.on === on) return { before: on, after: on, guardrail: current, unchanged: true };
    await files.updateYaml(FILE, (doc) => {
      const next = doc ?? { guardrails: [] };
      next.guardrails ??= [];
      let g = next.guardrails.find((x) => x.key === key);
      if (!g) next.guardrails.push((g = { key, label: current.label, scope: current.scope }));
      g.on = on;
      return next;
    });
    return { before: current.on, after: on, guardrail: await get(key), reason: why };
  }

  return { list, get, set };
}
