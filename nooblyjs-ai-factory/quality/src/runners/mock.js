// Phase 21: the mock test runner. It runs no browser and calls no environment. Its results come from what is known:
//
//   e2e, e2e-smoke   the environment's baseline of journeys already there (sample data, all passing), plus each
//                    automated E2E or integration case of the stories under test that the latest Build-level run found
//                    in the commit (smoke: E2E cases only); a case passes when that run passes it
//   load             the p95 the mock measures (240 ms) against the target of the item's performance NFR
//   accessibility    no violations; resilience: the environment recovers from losing a cache node
//
// Every result says it is the mock runner: nothing pretends to be a real run.
const E2E = new Set(['e2e', 'integration']);
const MEASURED_P95_MS = 240;
const RESULT = { passing: true };

/** The first number of milliseconds in a target ("p95 < 300 ms" → 300), or null. */
export function targetMs(text) {
  const m = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
  if (!m) return null;
  return m[2].toLowerCase() === 's' ? Number(m[1]) * 1000 : Number(m[1]);
}

export function createMockRunner() {
  /**
   * @param {string} suite
   * @param {{ baseline?: Record<string, number>, cases?: Array<{ id, title, level, automate, status, criterionRef? }>, nfrs?: Array<{ id, category, requirement, target }> }} input
   */
  function run(suite, { baseline = {}, cases = [], nfrs = [] } = {}) {
    if (suite === 'e2e' || suite === 'e2e-smoke') {
      const levels = suite === 'e2e-smoke' ? new Set(['e2e']) : E2E;
      const present = cases.filter((c) => c.automate !== false && levels.has(c.level) && ['passing', 'failing', 'unproven'].includes(c.status));
      const failing = present.filter((c) => !RESULT[c.status]).map((c) => ({ name: `${c.id}: ${c.title}`, caseId: c.id, criterionRef: c.criterionRef ?? null }));
      const base = Number(baseline[suite] ?? (suite === 'e2e-smoke' ? 0 : baseline.e2e) ?? 0) || 0;
      return { suite, passed: base + present.length - failing.length, total: base + present.length, failing, cases: present.map((c) => ({ id: c.id, status: RESULT[c.status] ? 'passing' : 'failing' })) };
    }
    if (suite === 'load') {
      const perf = nfrs.filter((n) => /performance|latenc/i.test(`${n.category} ${n.requirement}`) && targetMs(n.target) !== null);
      const checks = perf.map((n) => ({ nfr: n.id, requirement: n.requirement, target: n.target, targetMs: targetMs(n.target), measuredMs: MEASURED_P95_MS }));
      const failing = checks.filter((c) => c.measuredMs > c.targetMs).map((c) => ({ name: `${c.requirement}: p95 ${c.measuredMs} ms against ${c.targetMs} ms`, nfr: c.nfr }));
      const total = Math.max(1, checks.length);
      return {
        suite, passed: total - failing.length, total, failing, measured: checks,
        text: checks.length ? checks.map((c) => `p95 ${c.measuredMs} ms against the ${c.targetMs} ms target (${c.requirement})`).join('; ') : 'No performance target to test against',
      };
    }
    if (suite === 'accessibility') return { suite, passed: 1, total: 1, failing: [], text: 'No accessibility violations (axe, keyboard)' };
    if (suite === 'resilience') return { suite, passed: 1, total: 1, failing: [], text: 'Recovered from losing a cache node' };
    throw new Error(`The test runner has no suite "${suite}".`);
  }
  return { name: 'mock', real: false, run };
}
