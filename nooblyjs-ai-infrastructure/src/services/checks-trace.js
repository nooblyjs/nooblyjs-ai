// The infrastructure design's checks and its part of the trace (NooblyJS Phase 16f, root design.md §4–§5).
//
//   checksFor(itemId)   the policy checks of each design built for the item (INF-031), at its current version, for each
//                       kind of environment a person approves (Test, Staging, Production), in NooblyJS's one shape. A
//                       policy that blocks is blocking; one that warns, a warning; one switched off, not run
//   trace(itemId)       each design for the item, linked to it
import { KIND_LABEL } from '../util/ids.js';

const KINDS = ['test', 'staging', 'production'];
const RESULT = { passed: 'passed', failed: 'failed', warning: 'warning', off: 'not-run' };

export function createInfraChecks({ repos, designs, mountPath = '/infrastructure' }) {
  async function designsFor(itemId) {
    return (await repos.designs.list().catch(() => [])).filter((d) => d.itemId === itemId).sort((a, b) => a.id.localeCompare(b.id));
  }

  async function checksFor(itemId) {
    const out = [];
    for (const design of await designsFor(itemId)) {
      for (const kind of KINDS) {
        for (const c of await designs.policyChecks(design, kind)) {
          out.push({
            key: `${kind}:${c.id}`, kind: 'policy', subject: { item: itemId, ref: `${design.id} v${design.version} · ${KIND_LABEL[kind]}` },
            definedBy: { system: 'infrastructure', ref: `policies.yaml#${c.id}` }, verifiedBy: 'policy check', severity: c.severity === 'blocks' ? 'blocking' : 'warning',
            result: RESULT[c.result] ?? 'not-run', text: c.text,
            evidence: { system: 'infrastructure', ref: `${mountPath}/designs/${design.id}`, summary: `${c.label}, on version ${design.version} for ${KIND_LABEL[kind]}: ${c.result}` },
            at: design.updatedAt ?? null,
          });
        }
      }
    }
    return out;
  }

  async function trace(itemId) {
    const list = await designsFor(itemId);
    return {
      nodes: list.map((d) => ({ id: d.id, type: 'infrastructure', title: `${d.title} (version ${d.version})`, status: d.status, system: 'infrastructure', href: `${mountPath}/designs/${d.id}` })),
      links: list.map((d) => ({ from: d.id, rel: 'infrastructure-for', to: itemId })),
    };
  }

  return { checksFor, trace };
}
