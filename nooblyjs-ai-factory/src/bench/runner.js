// @ts-check
// Phase F19: RUNNING the bench. Each case, through the WHOLE line, scored by its hidden tests.
//
//   for each case × repeat:
//     1. a fresh repo from the case's snapshot, a fresh FACTORY_HOME (no run can see another)
//     2. factory run: the issue, autonomy L3, the case's budget, the local forge
//     3. check out the branch the factory produced; copy in the HIDDEN tests; run them
//     4. resolved = hidden tests pass AND no protected path changed
//
// Agents:
//   { kind: 'model', provider, model }   the real thing (needs a key; costs money)
//   { kind: 'oracle' }                   writes the reference solution: the bench's CEILING. Anything
//                                        under 100% is the PIPELINE losing work, not the model.
//   { kind: 'null' }                     writes nothing: the FLOOR. Anything over 0% is a case that
//                                        measures nothing.
// Oracle and null need no key, so the whole runner is tested offline.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkScope } from '../exec/gates/scope-guard.js';
import { createMockProvider } from '../harness.js';
import { runJob } from '../job/run-job.js';
import { openStore } from '../store/events.js';
import { filesIn, materialise, runHidden } from './cases.js';

const run = promisify(execFile);
const git = (cwd, ...args) => run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout.trim());

const TRIAGE = '```json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"a small, clear change"}\n```';
const APPROVE = '```json\n{"verdict":"approve","summary":"Looks right.","findings":[]}\n```';

/** Scripted providers for the oracle and null agents. */
function scriptedProviders(c, kind) {
  const writes = kind === 'oracle' ? filesIn(path.join(c.dir, 'solution')).map((rel) => ({ name: 'Write', input: { file_path: rel, content: fs.readFileSync(path.join(c.dir, 'solution', rel), 'utf8') } })) : [];
  // Like any agent, the oracle must Read a file before the harness lets it overwrite it.
  const reads = writes.filter((w) => fs.existsSync(path.join(c.dir, 'repo', w.input.file_path))).map((w) => ({ name: 'Read', input: { file_path: w.input.file_path } }));
  const steps = [...(reads.length ? [{ text: 'Reading what I will change.', tools: reads }] : []), { text: 'Writing the change.', tools: writes }, { text: 'Done.' }];
  return {
    triage: createMockProvider([{ text: TRIAGE }]),
    build: createMockProvider(writes.length ? steps : [{ text: 'Nothing to change, I think.' }]),
    review: createMockProvider([{ text: APPROVE }]),
  };
}

/**
 * One case, once.
 * @param {import('./cases.js').BenchCase} c
 * @param {{ agent: { kind: 'oracle' | 'null' | 'model', provider?: string, model?: string, driver?: string }, repeat?: number,
 *           allowUnsandboxed?: boolean, keep?: boolean, tmp?: string, budgetUsd?: number, overlay?: Record<string, string>, routing?: string }} options
 */
export async function runCase(c, { agent, repeat = 1, allowUnsandboxed = false, keep = false, tmp, budgetUsd, overlay, routing }) {
  const dir = fs.mkdtempSync(path.join(tmp ?? os.tmpdir(), `bench-${c.id}-`));
  const env = { ...process.env, FACTORY_HOME: path.join(dir, 'home') };
  const repo = await materialise(c, path.join(dir, 'repo'), { overlay });
  const base = await git(repo, 'rev-parse', 'HEAD'); // the starting commit
  const store = openStore({ env });
  const started = Date.now();
  const result = { case: c.id, repeat, status: 'error', resolved: false, hiddenPass: false, protectedChanged: [], costUsd: 0, durationMs: 0, runId: null, output: '', error: null };
  try {
    const budget = budgetUsd ?? c.budgetUsd;
    const job = agent.kind === 'model'
      ? { agent: { provider: agent.provider, model: agent.model, limits: { budgetUsd: budget } }, driver: agent.driver }
      : { providers: scriptedProviders(c, agent.kind) };
    const out = await runJob({ issueFile: c.issueFile, repo, autonomy: 'L3', allowUnsandboxed, routing, ...job }, { env, store });
    const runRow = store.get('runs', out.runId);
    Object.assign(result, { status: out.status, runId: out.runId, costUsd: runRow?.costUsd ?? 0 });

    // Score the branch the factory produced (L3 may also have merged it into main: same commit).
    const head = runRow?.head;
    if (head) {
      const checkout = path.join(dir, 'result');
      await git(dir, 'clone', '-q', repo, checkout);
      await git(checkout, 'checkout', '-q', head.replace(/^refs\/heads\//, ''));
      const changed = (await git(checkout, 'diff', '--name-only', base, 'HEAD')).split('\n').filter(Boolean);
      result.protectedChanged = checkScope({ changed, tasks: null, specDir: null, granted: [] }).violations.filter((v) => v.why === 'protected').map((v) => v.file);
      const hidden = await runHidden(c, checkout);
      Object.assign(result, { hiddenPass: hidden.pass, output: hidden.output });
    } else result.output = 'The factory produced no branch.';
    result.resolved = result.hiddenPass && !result.protectedChanged.length;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    result.durationMs = Date.now() - started;
    store.close();
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  }
  return result;
}

/**
 * The whole bench: every case, `repeat` times. Cases run one after another (a fair
 * clock, and the machine's load doesn't depend on the case order).
 * @param {import('./cases.js').BenchCase[]} cases
 * @param {Parameters<typeof runCase>[1] & { label: string, repeats?: number, onResult?: (r: object) => void }} options
 */
export async function runBench(cases, { label, repeats = 1, onResult, ...options }) { // options.overlay: extra files in every case's start (F21)
  const results = [];
  for (let r = 1; r <= repeats; r++) {
    for (const c of cases) {
      const res = await runCase(c, { ...options, repeat: r });
      results.push(res);
      onResult?.(res);
    }
  }
  return { label, agent: options.agent, repeats, cases: cases.map((c) => c.id), startedAt: new Date(Date.now() - results.reduce((s, x) => s + x.durationMs, 0)).toISOString(), finishedAt: new Date().toISOString(), node: process.version, results };
}
