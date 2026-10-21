// Phase 20: DEFECTS (root product.md §3.6). A defect is a lifecycle item of its own (the lifecycle engine's defects.js:
// DEF-031-1, the child of the story it breaks), so it is on the Lifecycle board, in the story's page and in the item's
// trace. Here it is raised: from a failing test run (the failing case, its criterion and the story's requirements come
// with it) or by hand on a story; and decided (fixed, close, reject, reopen) through the lifecycle, which checks who.
import { HttpError, badRequest, conflict } from '../util/errors.js';

const plainActor = (person) => (person?.id ? { id: person.id, name: person.name ?? person.id, kind: person.kind ?? 'person', accessRole: person.accessRole } : null);

export function createDefects({ host, runs }) {
  function workflows() {
    const w = host.service?.('workflows');
    if (typeof w?.recordDefect !== 'function') throw new HttpError(503, 'workflows_unavailable', 'The lifecycle engine is not running here, so a defect can\'t be recorded.');
    return w;
  }
  const pick = (body, key, max = 200) => (typeof body?.[key] === 'string' ? body[key].trim().slice(0, max) : '');

  /** The requirements a defect breaks: the one named (it must be one of the story's), else all of the story's. */
  function requirementsFor(body, known) {
    const named = pick(body, 'requirementId', 40);
    if (!named) return known;
    if (known.length && !known.includes(named)) throw badRequest(`${named} is not one of the story's requirements (${known.join(', ')}).`, { requirementId: known.join(' | ') });
    return [named];
  }

  /** Raise a defect from a failing test run: its failing case (or the one named), its criterion, the story's requirements. */
  async function raiseFromRun(testRunId, body = {}, actor) {
    const run = await runs.get(testRunId);
    if (run.status === 'passed') throw conflict('run_passed', `${testRunId} passed: raise a defect from a failing run, or on the story by hand.`);
    if (!run.storyId) throw conflict('no_story', `${testRunId} is not a story's run, so there is no story for the defect to break.`);
    const named = pick(body, 'caseId', 40);
    const failing = run.cases.find((c) => (named ? c.id === named : c.status === 'failing')) ?? null;
    if (named && !failing) throw badRequest(`${testRunId} has no test case ${named}.`, { caseId: run.cases.map((c) => c.id).join(' | ') });
    const title = pick(body, 'title') || (failing ? `${failing.id} fails: ${failing.title}` : `${testRunId} fails: ${run.failures[0] ?? 'a gate'}`);
    const defect = await workflows().recordDefect({
      storyId: run.storyId, title, severity: pick(body, 'severity', 4) || 'S2', requirements: requirementsFor(body, run.requirements ?? []),
      criterion: failing?.criterionRef ?? null, testRunId, runId: run.runId, caseId: failing?.id ?? null,
      text: pick(body, 'text', 2000) || run.failures.join('\n'), actor: plainActor(actor),
    });
    await runs.addDefect(testRunId, defect.id);
    return one(defect.id);
  }

  /** Raise a defect on a story by hand (found by a person, not a run). */
  async function raiseOnStory(storyId, body = {}, actor) {
    const w = workflows();
    const story = await w.item({ itemId: storyId });
    const design = story?.parentId ? await Promise.resolve(host.service?.('design')?.designFor?.(story.parentId)).catch(() => null) : null;
    const known = design?.stories?.find((s) => s.id === storyId)?.requirements ?? [];
    const title = pick(body, 'title');
    if (!title) throw badRequest('A defect needs a title: what goes wrong.', { title: 'required' });
    const defect = await w.recordDefect({ storyId, title, severity: pick(body, 'severity', 4) || 'S2', requirements: requirementsFor(body, known), criterion: pick(body, 'criterion', 40) || null, text: pick(body, 'text', 2000), actor: plainActor(actor) });
    return one(defect.id);
  }

  async function decide(defectId, body = {}, actor) {
    await workflows().decideDefect({ defectId, decision: pick(body, 'decision', 20), reason: pick(body, 'reason', 500), actor: plainActor(actor) });
    return one(defectId);
  }

  const list = async ({ itemId = null, storyId = null, state = null } = {}) => workflows().defects({ itemId, storyId, state });
  async function one(id) {
    const found = (await list()).find((d) => d.id === id);
    if (!found) throw new HttpError(404, 'not_found', `There is no defect ${id}.`);
    return found;
  }

  return { raiseFromRun, raiseOnStory, decide, list, one };
}
