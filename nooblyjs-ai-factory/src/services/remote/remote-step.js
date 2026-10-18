// @ts-check
// Phase F23: a step, run by a REMOTE worker, that looks to the station exactly like runStep().
//
//   control plane                                           worker
//   1. resolve the base in OUR mirror; resolve the prompt   (the worker can't read our mirror)
//   2. bundle the base commits (git bundle)                  ─► clone the bundle; runStep() locally,
//                                                                in its own workspace and sandbox
//   3. import the worker's bundle into OUR mirror            ◄─ bundle base..result + the step result
//   4. return runStep()'s shape: the station carries on as if the step had run here
//
// Why git bundles: the base may be commits only the control plane has (a spec branch,
// an earlier fan-out wave), and the result must come back as real commits. A bundle is
// commits in a file: exact, verifiable (git checks every object), and it needs no shared
// filesystem and no git server. The worker never pushes anywhere: the control plane stays
// the only thing that pushes (F03).
//
// Not remote: stations with local callbacks (spec's check → fix loop) and factory MCP tools
// (F16), which talk to the control plane's store. They run in the control plane.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, withRepoLock } from '../exec/workspace/git.js';
import { ensureMirror, resolveBase } from '../exec/workspace/mirror.js';

/**
 * @param {import('../exec/step-runner.js').StepRequest} step
 * @param {ReturnType<typeof import('./dispatcher.js').createDispatcher>} dispatcher
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export async function remoteRunStep(step, dispatcher, { env = process.env } = {}) {
  const log = step.log ?? (() => {});
  const mirror = await ensureMirror(step.repo, { env });
  const { ref, sha } = await resolveBase(mirror.dir, step.base);
  const configSha = step.configSha ?? sha;
  const { factoryTools, prompt: promptOf, onEvent, signal, ...agent } = /** @type {any} */ (step.agent);
  // A scripted provider (--script) travels as its replies; any other object can't cross the wire.
  if (typeof agent.provider === 'object') {
    if (!Array.isArray(agent.provider.replies)) throw new Error('A remote step needs a provider id (a string), not a provider object.');
    agent.script = agent.provider.replies;
    agent.provider = undefined;
  }
  const prompt = typeof promptOf === 'function' ? await promptOf({ mirror: mirror.dir, baseSha: sha, path: null }) : promptOf;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-remote-'));
  try {
    // 1. The base, as a bundle: two temporary refs (base, config), so the bundle names them.
    const tag = `refs/factory-remote/${path.basename(tmp)}`;
    await git(['update-ref', `${tag}/base`, sha], { cwd: mirror.dir });
    await git(['update-ref', `${tag}/config`, configSha], { cwd: mirror.dir });
    const baseBundle = path.join(tmp, 'base.bundle');
    await git(['bundle', 'create', '-q', baseBundle, `${tag}/base`, `${tag}/config`], { cwd: mirror.dir });
    await git(['update-ref', '-d', `${tag}/base`], { cwd: mirror.dir });
    await git(['update-ref', '-d', `${tag}/config`], { cwd: mirror.dir });

    log(`remote: waiting for a worker (${step.name ?? 'step'})`);
    const out = await dispatcher.dispatch(
      {
        name: step.name, commitMessage: step.commitMessage, verify: step.verify, stopHook: step.stopHook, allowUnsandboxed: step.allowUnsandboxed,
        baseRef: ref, baseSha: sha, configSha, bundle: fs.readFileSync(baseBundle).toString('base64'),
        driver: step.driver ?? 'subprocess',
        agent: { ...agent, prompt },
      },
      { signal, onEvent },
    );
    log(`remote: ${out.worker} finished: ${out.result?.outcome} · ${out.commits ?? 0} commit(s)`);

    // 3. The worker's commits, into our mirror, on a branch of our own.
    let branch = null;
    if (out.commits && out.bundle) {
      const back = path.join(tmp, 'result.bundle');
      fs.writeFileSync(back, Buffer.from(out.bundle, 'base64'));
      branch = `factory-remote/${out.stepId ?? path.basename(tmp)}`;
      await withRepoLock(mirror.dir, () => git(['fetch', '-q', back, `refs/heads/result:refs/heads/${branch}`], { cwd: mirror.dir }));
      const tip = await git(['rev-parse', `refs/heads/${branch}`], { cwd: mirror.dir });
      if (tip !== out.sha) throw new Error(`The worker said its result was ${out.sha}, but the bundle holds ${tip}.`);
    }
    const stat = branch ? await git(['diff', '--stat', `${sha}..refs/heads/${branch}`], { cwd: mirror.dir }) : '';
    return {
      workspace: { id: out.stepId ?? 'remote', path: null, mirror: mirror.dir, slug: mirror.slug, baseRef: ref, baseSha: sha, harnessHome: null, branch, remote: out.worker },
      setup: out.setup ?? null,
      result: out.result,
      gates: out.gates ?? null,
      check: null,
      commits: branch ? out.commits : 0,
      stat,
      branch,
      kept: false,
      worker: out.worker,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
