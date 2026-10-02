// @ts-check
// Phase F23: the WORKER. Another machine (or container) that runs agent steps for a factory.
//
//   factory worker --server http://factory-host:8790 --enroll <token> [--name gpu-box]
//
//   loop:  lease a step ─► clone its base bundle ─► runStep() here (its own workspace, sandbox,
//          and model key) ─► stream agent events, heartbeat ─► bundle the new commits ─► complete
//
// The worker keeps no state that matters. Kill it at any point and its lease runs out;
// the step goes to another worker. Heartbeats carry the stop button both ways: a cancelled
// run, or a lease that moved on ("lease lost"), aborts the local agent at once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../exec/workspace/git.js';
import { runStep } from '../exec/step-runner.js';
import { scriptedProvider } from '../exec/harness/script.js';

/**
 * @param {{ server: string, token: string, name: string, env?: NodeJS.ProcessEnv, fetch?: typeof fetch,
 *           providerFor?: (job: any) => any, run?: typeof runStep, heartbeatMs?: number, flushMs?: number, log?: (l: string) => void }} options
 *   providerFor: tests give scripted providers; a real worker uses the job's provider id
 */
export function createWorker({ server, token, name, env = process.env, fetch: doFetch = globalThis.fetch, providerFor, run = runStep, heartbeatMs, flushMs = 500, log = () => {} }) {
  const base = server.replace(/\/+$/, '');
  const call = async (p, body) => {
    const res = await doFetch(`${base}${p}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `${p}: ${res.status}`), { status: res.status });
    return data;
  };

  /** Run one leased job. Returns what happened, for logs and tests. */
  async function runJob(job) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `factory-worker-${job.stepId}-`));
    const abort = new AbortController();
    let buffered = [];
    const flush = async () => {
      if (!buffered.length) return;
      const batch = buffered;
      buffered = [];
      await call('/worker/events', { stepId: job.stepId, events: batch }).catch(() => {});
    };
    const flusher = setInterval(flush, flushMs);
    let stopped = null;
    const beat = setInterval(async () => {
      const r = await call('/worker/heartbeat', { stepId: job.stepId }).catch((e) => ({ ok: false, stop: e.status === 401 ? 'revoked' : null }));
      if (r.stop && !stopped) {
        stopped = r.stop;
        log(`${job.stepId}: told to stop (${r.stop})`);
        abort.abort(r.stop);
      }
    }, heartbeatMs ?? Math.max(200, Math.floor(job.leaseMs / 3)));
    try {
      // The base commits: clone the bundle, name the base branch.
      const repo = path.join(tmp, 'repo');
      fs.writeFileSync(path.join(tmp, 'base.bundle'), Buffer.from(job.bundle, 'base64'));
      await git(['init', '-q', repo]);
      await git(['fetch', '-q', path.join(tmp, 'base.bundle'), 'refs/factory-remote/*:refs/remotes/bundle/*'], { cwd: repo });
      // Branches, so the worker's own mirror (which fetches branches) gets both commits.
      await git(['branch', '-q', 'factory-base', job.baseSha], { cwd: repo });
      if (job.configSha !== job.baseSha) await git(['branch', '-q', 'factory-config', job.configSha], { cwd: repo });
      await git(['symbolic-ref', 'HEAD', 'refs/heads/factory-base'], { cwd: repo });

      const provider = providerFor ? providerFor(job) : job.agent.script ? scriptedProvider(job.agent.script) : job.agent.provider;
      const step = await run(
        {
          repo, base: 'factory-base', configSha: job.configSha, name: job.name, commitMessage: job.commitMessage, verify: job.verify, stopHook: job.stopHook,
          allowUnsandboxed: job.allowUnsandboxed, driver: typeof provider === 'object' ? 'in-process' : job.driver,
          agent: { ...job.agent, provider, signal: abort.signal, onEvent: (e) => buffered.push(e) },
        },
        { env: { ...env, FACTORY_HOME: path.join(tmp, 'home') } },
      );
      await flush();
      if (stopped) return { stepId: job.stepId, stopped };

      // The new commits, back as a bundle (base..result).
      let bundle = null;
      let sha = null;
      if (step.commits && step.branch) {
        const mirror = step.workspace.mirror;
        sha = await git(['rev-parse', `refs/heads/${step.branch}`], { cwd: mirror });
        await git(['branch', '-f', 'result', sha], { cwd: mirror });
        const file = path.join(tmp, 'result.bundle');
        await git(['bundle', 'create', '-q', file, 'refs/heads/result', `^${job.baseSha}`], { cwd: mirror });
        bundle = fs.readFileSync(file).toString('base64');
      }
      const { costUsd, outcome, text, turns, toolCalls, durationMs, model, usage, costIsEstimate } = step.result;
      await call('/worker/complete', { stepId: job.stepId, result: { result: { costUsd, outcome, text, turns, toolCalls, durationMs, model, usage, costIsEstimate, sessionId: null, events: 0 }, setup: step.setup ?? null, gates: step.gates ?? null, commits: step.commits, sha, bundle, stepId: job.stepId } });
      return { stepId: job.stepId, outcome, commits: step.commits };
    } catch (error) {
      if (stopped) return { stepId: job.stepId, stopped };
      await call('/worker/fail', { stepId: job.stepId, reason: error instanceof Error ? error.message : String(error) }).catch(() => {});
      return { stepId: job.stepId, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearInterval(flusher);
      clearInterval(beat);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  return {
    name,
    runJob,
    /** One lease attempt: run a step if there is one. */
    async once() {
      const { job } = await call('/worker/lease', { name });
      if (!job) return null;
      log(`${job.stepId}: ${job.name ?? 'step'} (attempt ${job.attempt})`);
      return runJob(job);
    },
    /** Until the signal aborts: lease, run, repeat; idle politely. */
    async loop(signal, { idleMs = 1000 } = {}) {
      while (!signal?.aborted) {
        const did = await this.once().catch((e) => (log(`lease failed: ${e.message}`), null));
        if (!did) await new Promise((r) => setTimeout(r, idleMs));
      }
    },
  };
}
