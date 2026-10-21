// Scans (root product.md §3.5 Build; design.md §9). The Software Factory asks for one on each run's commit, on a clean
// checkout, after the repository's own gates: each kind in the policy (secrets, SAST, SCA, licence, IaC) goes through
// the scanner adapter, its findings are recorded (owner, fix-by), and it is a gate that fails when a finding is at or
// above its policy's level and its risk is not accepted. The change's SBOM comes back with the results.
//
// A scan of a run made to fix a finding (`findingId`) closes that finding when it no longer finds it: the proof.
import { badRequest } from '../util/errors.js';
import { KIND_LABEL, SEVERITY_LABEL, newId } from '../util/ids.js';

const MAX_FILES = 500;
const MAX_TEXT = 512 * 1024;

export function createScans({ repos, host, scanner, policies, findings, now }) {
  const emit = (type, payload) => host.events.emit(type, payload, { actor: null });

  /**
   * @param {{ repo: string, itemId?: string, runId?: string, sha?: string, findingId?: string, files: Array<{ path: string, text: string }> }} input
   * @returns {Promise<{ scanId, scanner, real, text, passed, results: Array<{ kind, name, label, status, blockAt, findings, excerpt }>, sbom }>}
   */
  async function scanChange(input = {}) {
    const { repo, itemId = null, runId = null, sha = null, findingId = null } = input;
    if (typeof repo !== 'string' || !repo) throw badRequest('A scan needs the repository.');
    const files = (Array.isArray(input.files) ? input.files : []).slice(0, MAX_FILES)
      .filter((f) => typeof f?.path === 'string' && typeof f?.text === 'string')
      .map((f) => ({ path: f.path, text: f.text.slice(0, MAX_TEXT) }));
    const p = await policies.read();
    const scanId = newId('scn');
    const target = { repo, files };
    const results = [];
    const seen = new Set();
    for (const gate of p.gates) {
      const found = scanner.scan(gate.kind, target, p);
      const ids = [];
      const blocking = [];
      for (const one of found) {
        seen.add(one.fingerprint);
        const { finding } = await findings.record(one, { repo, itemId, runId, sha, scanId, scanner: scanner.name });
        ids.push(finding.id);
        if (findings.blocks(finding, gate.blockAt)) blocking.push(finding);
      }
      const label = KIND_LABEL[gate.kind] ?? gate.kind;
      results.push({
        kind: gate.kind, name: `security: ${gate.kind}`, label, blockAt: gate.blockAt, status: blocking.length ? 'failed' : 'passed', findings: ids,
        excerpt: blocking.length
          ? blocking.map((f) => `${f.id} (${SEVERITY_LABEL[f.severity]}): ${f.title}. Owner ${f.owner ?? 'nobody yet'}, fix by ${f.fixBy.slice(0, 10)}. ${f.detail ?? ''}`.trim()).join('\n')
          : ids.length ? `Found ${ids.join(', ')}, below the level that blocks (${SEVERITY_LABEL[gate.blockAt]}) or with its risk accepted.` : '',
      });
    }
    const sbom = scanner.sbom(target, p);
    const passed = results.every((r) => r.status === 'passed');
    const at = new Date(now()).toISOString();
    await repos.scans.append({ id: scanId, at, repo, itemId, runId, sha, findingId, scanner: scanner.name, real: scanner.real, passed, results: results.map(({ kind, status, findings: f }) => ({ kind, status, findings: f })), components: sbom.components.length, sbom: sbom.components });
    await emit('scan.finished', {
      scanId, itemId, repo, runId, sha, scanner: scanner.name, passed,
      summary: `scanned ${repo}${sha ? ` at ${sha.slice(0, 7)}` : ''} with the ${scanner.name} scanner: ${results.map((r) => `${r.kind} ${r.status}`).join(' · ')}`,
    });
    // The proof a finding needs: the run made to fix it, scanned, no longer finds it.
    if (findingId) {
      const f = await repos.findings.get(findingId);
      if (f && f.state !== 'closed' && f.subject?.repo === repo && !seen.has(f.fingerprint)) await findings.closeWithProof(findingId, { scanId, runId, sha });
    }
    return { scanId, scanner: scanner.name, real: scanner.real, text: scanner.real ? '' : 'Mock scanner: not a real scan.', passed, results, sbom };
  }

  /**
   * Phase 21: a scan of an environment (DAST, or the image scan), run as one of its suites by the Factory's Test
   * section. Its findings are linked to the environment, the pull request (a preview's) and the story; the suite fails
   * when one is at or above the policy's level (`environmentScans`, default high) and its risk is not accepted.
   * @param {{ kind: 'dast' | 'image', environment: string, envKind?: string, repo?: string, itemId?: string, prId?: string, url?: string }} input
   */
  async function scanEnvironment({ kind, environment, envKind = null, repo = null, itemId = null, prId = null, url = null } = {}) {
    if (!['dast', 'image'].includes(kind)) throw badRequest('An environment scan is dast or image.');
    if (typeof environment !== 'string' || !environment) throw badRequest('A scan of an environment needs the environment.');
    const p = await policies.read();
    const blockAt = (p.environmentScans ?? []).find((g) => g.kind === kind)?.blockAt ?? 'high';
    const scanId = newId('scn');
    const target = { repo: repo ?? environment, environment, envKind, url, files: [] };
    const ids = [];
    const blocking = [];
    for (const one of scanner.scan(kind, target, p)) {
      const { finding } = await findings.record(one, { repo: target.repo, itemId, runId: null, sha: null, scanId, scanner: scanner.name, prId, environment });
      ids.push(finding.id);
      if (findings.blocks(finding, blockAt)) blocking.push(finding);
    }
    const label = KIND_LABEL[kind] ?? kind;
    const at = new Date(now()).toISOString();
    const passed = !blocking.length;
    await repos.scans.append({ id: scanId, at, repo: target.repo, itemId, environment, prId, scanner: scanner.name, real: scanner.real, passed, results: [{ kind, status: passed ? 'passed' : 'failed', findings: ids }], components: 0 });
    await emit('scan.finished', { scanId, itemId, repo: target.repo, environment, prId, scanner: scanner.name, passed, summary: `scanned ${environment} (${label}) with the ${scanner.name} scanner: ${passed ? 'passed' : 'failed'}${ids.length ? `, ${ids.join(', ')}` : ''}` });
    const mock = scanner.real ? '' : ' (mock scanner: not a real scan)';
    return {
      passed: passed ? 1 : 0, total: 1, scanId, scanner: scanner.name, real: scanner.real, findings: ids,
      failing: blocking.map((f) => ({ name: `${f.id}: ${f.title}`, findingId: f.id })),
      text: kind === 'image' && !ids.length ? `${label}: no image to scan${mock}` : `${label}: ${ids.length ? `${ids.join(', ')}${passed ? `, below the level that blocks (${SEVERITY_LABEL[blockAt]})` : ''}` : 'nothing found'}${mock}`,
    };
  }

  /**
   * Phase 22: the SBOM a release carries: for each repository, the components of the newest scan of a run for one of
   * these items (a release's stories).
   */
  async function sbomFor({ itemIds = [] } = {}) {
    const wanted = new Set(itemIds);
    const newest = new Map();
    for (const s of await repos.scans.list()) if (wanted.has(s.itemId) && s.runId && Array.isArray(s.sbom)) newest.set(s.repo, s);
    return { format: 'CycloneDX (simplified)', scanner: scanner.name, real: scanner.real, repos: [...newest.values()].map((s) => ({ repo: s.repo, scanId: s.id, sha: s.sha ?? null, components: s.sbom })) };
  }

  /** The newest scans, for the Findings page and a run's evidence. */
  async function recent({ repo, limit = 20 } = {}) {
    return (await repos.scans.list()).filter((s) => !repo || s.repo === repo).slice(-limit).reverse();
  }

  return { scanChange, scanEnvironment, sbomFor, recent };
}
