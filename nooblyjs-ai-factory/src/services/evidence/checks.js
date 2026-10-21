// @ts-check
// NooblyJS Phase 16f: THE LINE'S CHECKS AND TRACE, in NooblyJS's one shape (root design.md §4–§5). What the line
// already proves on every pull request, said as checks of the item it was for:
//
//   gate      each gate of the repository (.factory/config.json) on the run's last commit
//   gate      each quality attribute of the item (the Product section's, QA-031-1) against those gates, by name only
//             (intake/attributes.js): one no gate checks is "not run", for a person
//   test      the pull request's required tests (pull-requests/evidence.js): every one present and passing, or not
//
// and, for the trace, each run and the work item it built. Only a run's latest attempt per work item counts.
import { attributeChecks } from '../intake/attributes.js';

const RESULT = { passed: 'passed', failed: 'failed', timeout: 'failed', error: 'failed', skipped: 'not-run' };
const s7 = (sha) => String(sha ?? '').slice(0, 7);

/**
 * @param {{ store: any, host: any, mountPath?: string }} options
 */
export function createLineChecks({ store, host, mountPath = '/factory' }) {
  /** The latest run of each work item of these NooblyJS items. */
  function runsOf(itemIds) {
    const ids = new Set(itemIds);
    const latest = new Map();
    for (const r of store.list('runs').filter((x) => ids.has(x.request?.noobly?.itemId))) {
      const key = r.request.noobly.workItemId ?? r.id;
      const had = latest.get(key);
      if (!had || String(r.queuedAt) > String(had.queuedAt)) latest.set(key, r);
    }
    return [...latest.values()].sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
  }

  /** @param {{ itemId: string, itemIds?: string[] }} input */
  async function checksFor({ itemId, itemIds = [itemId] }) {
    const runs = runsOf(itemIds);
    const out = [];
    for (const run of runs) {
      const n = run.request.noobly;
      const repo = String(n.repoName ?? '').split('/').pop();
      const verify = run.steps?.verify?.result;
      const deliver = run.steps?.deliver?.result;
      const sha = deliver?.sha ?? verify?.checkedSha ?? null;
      const ref = `${repo} · run ${String(run.id).slice(-6)}`;
      for (const g of verify?.gates?.results ?? []) {
        out.push({
          key: `gate:${g.name}`, kind: 'gate', subject: { item: n.itemId, ref }, definedBy: { system: 'factory', ref: `${repo}/.factory/config.json#${g.name}` },
          verifiedBy: g.command ?? g.name, severity: 'blocking', result: RESULT[g.status] ?? 'not-run', text: `${g.name}: ${g.status}${sha ? ` on ${s7(sha)}` : ''}`,
          evidence: { system: 'factory', ref: `${mountPath}/runs/${run.id}`, summary: `The ${g.name} gate ${g.status} on a clean checkout${sha ? ` of ${s7(sha)}` : ''}` }, at: run.endedAt ?? null,
        });
      }
      const t = deliver?.requiredTests;
      if (t) {
        out.push({
          key: 'required-tests', kind: 'test', subject: { item: n.itemId, ref }, definedBy: { system: 'quality', ref: `test-analysis/${n.itemId}` },
          verifiedBy: 'the repository\'s gates', severity: 'blocking',
          result: t.missing?.length || t.failing?.length ? 'failed' : t.unproven?.length ? 'warning' : 'passed', text: t.text,
          evidence: { system: 'factory', ref: `${mountPath}/runs/${run.id}`, summary: `Each required test found by its id in ${s7(sha)}: ${t.text}` }, at: run.endedAt ?? null,
        });
      }
    }
    // The item's quality attributes, against the newest run's gates that checked anything.
    const attributes = (await Promise.resolve(host.service?.('product')?.gatesFor?.(itemId)).catch(() => [])) ?? [];
    const checked = [...runs].reverse().find((r) => r.steps?.verify?.result?.gates?.results?.length);
    const results = checked?.steps?.verify?.result?.gates?.results ?? [];
    const num = String(itemId).replace(/^[A-Z]+-/, '');
    attributeChecks(attributes, results).forEach((c, i) => {
      const id = `QA-${num}-${i + 1}`;
      const result = c.gate ? RESULT[c.status] ?? 'not-run' : 'not-run';
      out.push({
        key: `quality-attribute:${id}`, kind: 'gate', subject: { item: itemId, ref: id }, definedBy: { system: 'product', ref: id },
        verifiedBy: c.verifiedBy || 'nobody named', severity: 'blocking', result,
        text: c.gate ? `${c.attribute} (${c.target}): the ${c.gate} gate ${c.status}` : `${c.attribute} (${c.target}): ${checked ? 'no gate checks it' : 'no run has checked it yet'} (${c.verifiedBy || 'nobody named'}): a person checks it`,
        evidence: checked ? { system: 'factory', ref: `${mountPath}/runs/${checked.id}`, summary: c.gate ? `Gate ${c.gate} on run ${String(checked.id).slice(-6)}` : `The repository declares no gate named "${c.verifiedBy}"` } : { system: 'product', summary: 'Set in the item\'s Architecture; no run yet' },
        at: checked?.endedAt ?? null,
      });
    });
    return out;
  }

  /** @param {{ itemId: string, itemIds?: string[] }} input */
  async function trace({ itemId, itemIds = [itemId] }) {
    const nodes = [];
    const links = [];
    for (const run of runsOf(itemIds)) {
      const n = run.request.noobly;
      nodes.push({ id: run.id, type: 'run', title: `Run ${String(run.id).slice(-6)} on ${String(n.repoName ?? '').split('/').pop()}: ${String(run.status).replace(/_/g, ' ')}`, status: run.status, system: 'factory', href: `${mountPath}/runs/${run.id}` });
      links.push({ from: run.id, rel: 'runs', to: n.workItemId ?? n.itemId });
    }
    return { nodes, links };
  }

  return { checksFor, trace };
}
