// Phase 21: TESTING IN ENVIRONMENTS (root product.md §3.6). The suites of an environment's kind (the test policy's
// `environments`) run there: e2e, load, accessibility and resilience through the test runner adapter, DAST and the image
// scan through NooblyJS Security. The run is recorded as an environment test run (TRN-test-slots-1), each failing test
// linked to its case and the criterion it proves, and Infrastructure shows the results on the environment, where they
// decide promotion. Which stories are under test: a preview's pull request's story; in Test or Staging the ones named,
// else every story with a Build-level run on the product's repositories.
import { HttpError, notFound } from '../util/errors.js';
import { criterionRef } from './runs.js';

const DEFAULT_SUITES = { preview: ['e2e-smoke', 'accessibility', 'dast'], test: ['e2e', 'load', 'image'], staging: ['e2e', 'resilience', 'dast'] };
const SECURITY = new Set(['dast', 'image']);
const LABEL = { e2e: 'e2e', 'e2e-smoke': 'e2e smoke', load: 'load', accessibility: 'accessibility', resilience: 'resilience', dast: 'DAST', image: 'image scan' };

export function createEnvRuns({ host, log, analysis, runs, runner }) {
  const svc = (name) => host.service?.(name) ?? null;
  const policy = async () => (await host.store.readYaml(['test-policy.yaml']).catch(() => null)) ?? {};

  /** The latest Build-level run of each story: its cases with their results and criteria. */
  async function casesOf(storyIds) {
    const out = [];
    for (const storyId of storyIds) {
      const [latest] = (await runs.list({ storyId })).filter((r) => (r.level ?? 'build') === 'build');
      const analysed = (await analysis.casesFor(storyId, '').catch(() => [])) ?? [];
      for (const c of analysed) {
        const found = latest?.cases?.find((x) => x.id === c.id);
        out.push({ id: c.id, title: c.title, level: c.level, automate: c.automate !== false, status: found?.status ?? 'missing', ...(Number.isInteger(c.criterion) ? { criterionRef: criterionRef(storyId, c.criterion) } : {}), storyId });
      }
    }
    return out;
  }

  /** The performance and other NFRs of the stories' items (Design's). */
  async function nfrsOf(storyIds) {
    const items = new Set();
    for (const id of storyIds) {
      const item = await svc('workflows')?.item?.({ itemId: id }).catch(() => null);
      if (item?.parentId) items.add(item.parentId);
    }
    const out = [];
    for (const itemId of items) out.push(...(((await Promise.resolve(svc('design')?.designFor?.(itemId)).catch(() => null))?.nfrs) ?? []));
    return out;
  }

  /** Every story with a Build-level run on one of these repositories. */
  async function storiesOn(repos) {
    const names = new Set((repos ?? []).map((r) => String(r).split('/').pop()));
    return [...new Set((await runs.list()).filter((r) => (r.level ?? 'build') === 'build' && r.storyId && names.has(r.repo)).map((r) => r.storyId))].sort();
  }

  /**
   * Runs the suites of one environment's kind there, records the run and tells Infrastructure (and Security, for its
   * scans). `storyIds` names the stories under test in Test or Staging.
   */
  async function runEnvironment({ environment, storyIds = null, actor = null } = {}) {
    const infra = svc('infrastructure');
    if (typeof infra?.environment !== 'function') throw new HttpError(503, 'infrastructure_unavailable', 'Infrastructure is not running here, so there is no environment to test in.');
    const env = await infra.environment(environment);
    if (!env) throw notFound(`There is no environment ${environment}.`);
    if (env.status !== 'live') throw new HttpError(409, 'not_live', `${environment} is ${env.status}: its suites run once it is live.`);
    const suites = (await policy()).environments?.[env.kind] ?? DEFAULT_SUITES[env.kind];
    if (!suites?.length) throw new HttpError(422, 'no_suites', `No suites run in ${env.kind} environments.`);
    const stories = env.kind === 'preview' ? [env.storyId].filter(Boolean) : Array.isArray(storyIds) && storyIds.length ? storyIds : await storiesOn(env.repos);
    const cases = await casesOf(stories);
    const nfrs = await nfrsOf(stories);
    const results = [];
    for (const suite of suites) {
      if (SECURITY.has(suite)) {
        const security = svc('security');
        if (typeof security?.scanEnvironment !== 'function') {
          results.push({ suite, label: LABEL[suite], passed: 0, total: 0, failing: [], skipped: true, text: 'NooblyJS Security is not running here, so this scan did not run' });
          continue;
        }
        const scanned = await security.scanEnvironment({ kind: suite, environment: env.name, envKind: env.kind, repo: env.repo ?? (env.repos ?? [])[0] ?? null, itemId: stories[0] ?? null, prId: env.prId ?? null, url: env.url ?? null });
        results.push({ suite, label: LABEL[suite], ...scanned });
        continue;
      }
      const r = runner.run(suite, { baseline: env.baseline ?? {}, cases, nfrs });
      results.push({ ...r, label: LABEL[suite], text: r.text ?? `${r.passed} of ${r.total} ${LABEL[suite]}${r.failing.length ? ` · ${r.failing.length} failing` : ''}`, runner: runner.name });
    }
    const run = await runs.recordEnvironment({ environment: env.name, kind: env.kind, storyIds: stories, prId: env.prId ?? null, repo: env.repo ?? null, suites: results, runner: runner.name, by: actor?.id ?? null });
    await infra.recordTests({ environment: env.name, testRunId: run.id, suites: results.filter((s) => !s.skipped).map((s) => ({ suite: s.label ?? s.suite, passed: s.passed, total: s.total, failing: s.failing.map((f) => f.name), failingDetail: s.failing, ...(s.text ? { text: s.text } : {}) })) });
    return run;
  }

  /** Environment runs, newest first: of one environment, or of a pull request's preview. */
  const environmentRuns = async ({ environment = null, prId = null } = {}) => (await runs.list()).filter((r) => r.kind === 'environment' && (!environment || r.environment === environment) && (!prId || r.prId === prId));

  return { runEnvironment, environmentRuns };
}
