// Security's policies (policies.yaml, root product.md §3.5 and §9): the scanner, fix-by days per severity, the scans each
// Software Factory run gets and when each blocks, who may accept which risk, the approved packages, the licences not
// allowed, and who owns a finding by default. Every value is a Phase 19 default [CONFIRM]; a missing one falls back here.
import { SEVERITIES, SEVERITY_LABEL, KIND_LABEL } from '../util/ids.js';

const DEFAULTS = {
  fixByDays: { critical: 7, high: 14, medium: 30, low: 90 },
  gates: [{ kind: 'secrets', blockAt: 'low' }, { kind: 'sast', blockAt: 'high' }, { kind: 'sca', blockAt: 'medium' }, { kind: 'licence', blockAt: 'medium' }, { kind: 'iac', blockAt: 'high' }],
  riskAcceptance: { maxDays: 90, architectMay: ['low', 'medium'] },
  sca: { approved: [], unapprovedSeverity: 'medium' },
  licence: { denied: [], known: {} },
  owners: { default: null, repositories: {} },
  agent: { teammates: ['rook-vale'] },
};
const DAY_MS = 86_400_000;

export function createPolicies({ repos, scanner }) {
  async function read() {
    const p = await repos.config.policies();
    return {
      ...DEFAULTS, ...p,
      fixByDays: { ...DEFAULTS.fixByDays, ...(p.fixByDays ?? {}) },
      riskAcceptance: { ...DEFAULTS.riskAcceptance, ...(p.riskAcceptance ?? {}) },
      owners: { ...DEFAULTS.owners, ...(p.owners ?? {}), repositories: { ...(p.owners?.repositories ?? {}) } },
    };
  }

  /** When a finding of this severity, opened at `openedAt` (ms), must be fixed by. */
  const fixByFor = (policies, severity, openedAt) => new Date(openedAt + (policies.fixByDays[severity] ?? 90) * DAY_MS).toISOString();
  /** Who owns a new finding on this repository. */
  const ownerFor = (policies, repo) => policies.owners.repositories?.[repo] ?? policies.owners.default ?? null;

  /** Policies as the Policies page shows them, in words. */
  async function view() {
    const p = await read();
    return {
      scanner: { name: scanner.name, real: scanner.real, text: scanner.real ? `Scanner: ${scanner.name}` : `Scanner: mock. ${scanner.text}` },
      fixBy: SEVERITIES.map((s) => ({ severity: s, label: SEVERITY_LABEL[s], days: p.fixByDays[s], text: `${SEVERITY_LABEL[s]}: fix within ${p.fixByDays[s]} days` })),
      gates: p.gates.map((g) => ({ ...g, label: KIND_LABEL[g.kind] ?? g.kind, text: `${KIND_LABEL[g.kind] ?? g.kind}: fails the run at ${SEVERITY_LABEL[g.blockAt] ?? g.blockAt} or worse` })),
      riskAcceptance: {
        ...p.riskAcceptance,
        text: `An Architect or an Owner may accept a ${p.riskAcceptance.architectMay.map((s) => s).join(' or ')} risk; a ${SEVERITIES.filter((s) => !p.riskAcceptance.architectMay.includes(s)).join(' or ')} one needs an Owner. Every acceptance has a reason and ends within ${p.riskAcceptance.maxDays} days.`,
      },
      approved: [...(p.sca.approved ?? [])].sort(),
      deniedLicences: p.licence.denied ?? [],
      owners: { default: p.owners.default, repositories: p.owners.repositories },
      confirm: 'Every value here is a default to confirm [CONFIRM].',
    };
  }

  return { read, view, fixByFor, ownerFor };
}
