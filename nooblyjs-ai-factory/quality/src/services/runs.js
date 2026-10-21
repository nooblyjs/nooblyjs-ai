// Phase 20: TEST RUNS (root product.md §3.6). Each verify of a commit by the Software Factory's line is a test run at the
// Build level ("Pull request branch"): each gate's result, the failing tests by name, and each of the story's test
// cases, against its criterion and the story's requirements. The line tells us twice: when verify finishes (the gates:
// recordGates) and when deliver has looked for each required test in the commit (recordRequired, Phase 16e's evidence).
// Environment runs join in Phase 21.
//
// One file per run, data/factory/quality/test-runs/TRN-031-2-1.md (the story's number, then a count). A passing run of a
// story is the proof that its open defects are fixed (the case a defect names passes, or every gate when it names none).
import { notFound } from '../util/errors.js';

const ID = /^TRN-[0-9A-Za-z]+(?:-[0-9]+)*-[0-9]+$/;
const MANUAL = 'manual';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const number = (id) => String(id ?? '').replace(/^[A-Z]+-/, '');
/** The criterion's id in the trace: STORY-031-2's first is AC-031-2-1. */
export const criterionRef = (storyId, i) => `AC-${number(storyId)}-${i + 1}`;

/** The failing tests a gate's output names (node:test, TAP and the like), else its first lines. */
function failuresOf(gates) {
  const out = [];
  for (const g of gates.filter((x) => x.status !== 'passed' && x.status !== 'skipped')) {
    const lines = String(g.excerpt ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const named = lines.filter((l) => /^(not ok\b|✖|FAIL\b)/.test(l) && !/^✖ failing tests/.test(l)).map((l) => l.replace(/^(not ok \d+ - |✖ |FAIL )/, '').replace(/\s+\([\d.]+m?s\)$/, ''));
    const unique = [...new Set(named)];
    out.push(...(unique.length ? unique.map((t) => `${g.name}: ${t}`) : [`${g.name}: ${lines.slice(0, 2).join(' ') || g.status}`]));
  }
  return out.slice(0, 20);
}

export function createRuns({ host, log, analysis }) {
  const store = host.store;
  const file = (id) => ['test-runs', `${id}.md`];
  const now = () => new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString();
  const emit = (type, payload) => host.events.emit(type, { system: 'factory', section: 'quality', ...payload }, { actor: null });
  const workflows = () => host.service?.('workflows') ?? null;

  async function all() {
    const out = [];
    for (const name of ((await store.list(['test-runs']).catch(() => [])) ?? []).filter((n) => n.endsWith('.md'))) {
      const doc = await store.readDoc(['test-runs', name]).catch(() => null);
      if (doc?.data?.id) out.push(doc.data);
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id.localeCompare(a.id, 'en', { numeric: true }));
  }
  const save = async (run) => {
    await store.writeDoc(file(run.id), run, `\n# ${run.id} · ${run.status}\n\n${run.text}\n`);
    return run;
  };

  /** The story a run is for (its item is a story), with its criteria and requirements from Design. */
  async function storyOf(itemId) {
    const w = workflows();
    const item = itemId ? await w?.item?.({ itemId }).catch(() => null) : null;
    if (item?.type !== 'story') return { storyId: null, itemId: item?.id ?? itemId ?? null, requirements: [], criteria: [] };
    const design = item.parentId ? await Promise.resolve(host.service?.('design')?.designFor?.(item.parentId)).catch(() => null) : null;
    const story = design?.stories?.find((s) => s.id === item.id) ?? null;
    return { storyId: item.id, itemId: item.parentId ?? item.id, requirements: story?.requirements ?? [], criteria: story?.criteria ?? [], feature: story?.feature ?? item.feature?.id ?? null };
  }

  async function nextId(stem) {
    const taken = new Set((await all()).map((r) => r.id));
    let n = 1;
    while (taken.has(`${stem}-${n}`)) n += 1;
    return `${stem}-${n}`;
  }

  function words(run) {
    const counts = ['passing', 'failing', 'unproven', 'missing'].map((k) => [k, run.cases.filter((c) => c.status === k).length]).filter(([, n]) => n);
    const gates = `${run.gates.filter((g) => g.status === 'passed').length} of ${plural(run.gates.length, 'gate')} passed`;
    return `${run.status === 'passed' ? 'Passed' : run.status === 'error' ? 'Could not run' : 'Failed'}: ${gates}${counts.length ? `; test cases ${counts.map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}`;
  }

  /** The cases at verify: failing when a failed gate names the case's id, else not checked yet (deliver looks for them). */
  async function casesAt(storyId, repo, gates, criteria) {
    if (!storyId) return [];
    const cases = (await analysis.casesFor(storyId, repo).catch(() => [])) ?? [];
    const failedText = gates.filter((g) => g.status !== 'passed').map((g) => String(g.excerpt ?? '')).join('\n');
    return cases.map((c) => ({
      id: c.id, title: c.title, level: c.level, ...(Number.isInteger(c.criterion) ? { criterion: c.criterion, criterionRef: criterionRef(storyId, c.criterion), criterionText: criteria[c.criterion] ?? null } : {}),
      status: c.automate === false ? MANUAL : new RegExp(`(?<![\\w-])${c.id}(?![\\w-])`).test(failedText) ? 'failing' : 'unchecked',
    }));
  }

  /**
   * The line verified a commit (its verify step finished): one test run per run and commit.
   * @param {{ runId: string, itemId?: string, repo: string, sha?: string, gates: Array<{ name: string, status: string, excerpt?: string }> }} input
   */
  async function recordGates({ runId, itemId = null, repo, sha = null, gates = [] } = {}) {
    if (!runId || !Array.isArray(gates)) return null;
    const s = await storyOf(itemId);
    const list = gates.map((g) => ({ name: String(g.name), status: String(g.status), ...(g.status !== 'passed' && g.excerpt ? { excerpt: String(g.excerpt).slice(0, 2000) } : {}) }));
    const status = list.some((g) => g.status === 'error') ? 'error' : list.every((g) => g.status === 'passed' || g.status === 'skipped') ? 'passed' : 'failed';
    const existing = (await all()).find((r) => r.runId === runId && r.sha === sha);
    const run = {
      ...(existing ?? { id: await nextId(`TRN-${number(s.storyId ?? s.itemId ?? 'X')}`) }),
      at: now(), runId, storyId: s.storyId, itemId: s.itemId, feature: s.feature ?? null, repo: String(repo ?? '').split('/').pop(), sha,
      level: 'build', environment: 'Pull request branch', kind: 'gates', status, gates: list, failures: failuresOf(list),
      cases: await casesAt(s.storyId, repo, list, s.criteria), requirements: s.requirements, defects: existing?.defects ?? [],
    };
    // The same commit verified again: what was already found for a case (deliver's look, a failure) still holds.
    if (existing) {
      const known = new Map((existing.cases ?? []).filter((c) => c.status !== 'unchecked').map((c) => [c.id, c.status]));
      run.cases = run.cases.map((c) => (c.status === 'unchecked' && known.has(c.id) ? { ...c, status: known.get(c.id) } : c));
    }
    run.text = words(run);
    await save(run);
    if (!existing) await emit('test_run.recorded', { itemId: s.storyId ?? s.itemId, testRunId: run.id, runId, status, repo: run.repo, summary: `recorded ${run.id} on ${run.repo}${sha ? ` at ${String(sha).slice(0, 7)}` : ''}: ${run.text}` });
    if (status === 'passed') await fixDefects(run);
    return run;
  }

  /** Deliver looked for each required test in the commit (Phase 16e): the cases get their result. */
  async function recordRequired({ runId, sha = null, requiredTests = null } = {}) {
    const run = (await all()).find((r) => r.runId === runId && (!sha || r.sha === sha));
    if (!run || !requiredTests) return null;
    const found = new Map((requiredTests.cases ?? []).map((c) => [c.id, c.status]));
    run.cases = run.cases.map((c) => (c.status === MANUAL || !found.has(c.id) ? c : { ...c, status: found.get(c.id) }));
    run.text = words(run);
    await save(run);
    if (run.status === 'passed') await fixDefects(run);
    return run;
  }

  /** A passing run of a story proves its open defects fixed: the case each names passes (or, naming none, every gate). */
  async function fixDefects(run) {
    const w = workflows();
    if (!run.storyId || typeof w?.defects !== 'function') return;
    for (const d of await w.defects({ storyId: run.storyId, state: 'open' })) {
      if (d.foundIn?.testRunId === run.id || String(d.createdAt) > String(run.at)) continue;
      const caseId = d.foundIn?.caseId;
      if (caseId && run.cases.find((c) => c.id === caseId)?.status !== 'passing') continue;
      await w.decideDefect({ defectId: d.id, decision: 'fixed', proof: { testRunId: run.id } }).catch((err) => log?.warn?.(`quality: ${d.id} not marked fixed: ${err.message}`));
    }
  }

  /** A defect was raised from this run: the run names it. */
  async function addDefect(testRunId, defectId) {
    const run = await get(testRunId);
    run.defects = [...new Set([...(run.defects ?? []), defectId])];
    return save(run);
  }

  async function get(id) {
    const doc = ID.test(id ?? '') ? await store.readDoc(file(id)).catch(() => null) : null;
    if (!doc?.data?.id) throw notFound(`There is no test run ${id}.`);
    return doc.data;
  }

  /** Test runs, newest first: of a story, or of an item (its stories'). */
  async function list({ storyId = null, itemId = null } = {}) {
    return (await all()).filter((r) => (!storyId || r.storyId === storyId) && (!itemId || r.itemId === itemId || r.storyId === itemId));
  }

  return { recordGates, recordRequired, addDefect, get, list, criterionRef };
}
