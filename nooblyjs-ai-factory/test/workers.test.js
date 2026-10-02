// Phase F23: remote workers (dispatcher, API, worker) and the container runner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { containerArgs, containerRuntime, runInContainer } from '../src/exec/container.js';
import { scriptedProvider } from '../src/exec/harness/script.js';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { createDispatcher } from '../src/remote/dispatcher.js';
import { createWorker } from '../src/remote/worker.js';
import { createHttpServer } from '../src/server/http.js';
import { revokeWorker, workerApi } from '../src/server/workers-api.js';
import { openStore } from '../src/store/events.js';
import { createFakeClock } from '../src/util/clock.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

test('dispatcher: leases, heartbeats, a quiet worker loses the step to another; stale results are ignored; cancel reaches the worker', async () => {
  const clock = createFakeClock(0);
  const d = createDispatcher({ clock, leaseMs: 1000, maxAttempts: 2 });
  const done = d.dispatch({ name: 'build' });
  const job = d.lease('w1');
  assert.equal(job.attempt, 1);
  assert.equal(d.lease('w2'), null, 'one step, one holder');
  clock.advance(900);
  assert.deepEqual(d.heartbeat('w1', job.stepId), { ok: true });
  clock.advance(1100); // w1 goes quiet
  const again = d.lease('w2');
  assert.equal(again.stepId, job.stepId);
  assert.equal(again.attempt, 2);
  assert.deepEqual(d.heartbeat('w1', job.stepId), { ok: false, stop: 'lease lost' }, 'w1 is told to stop');
  assert.equal(d.complete('w1', job.stepId, { commits: 9 }), false, "w1's late result is ignored");
  assert.equal(d.complete('w2', job.stepId, { commits: 1 }), true);
  assert.deepEqual(await done, { commits: 1, worker: 'w2' });

  const stop = new AbortController();
  const cancelled = d.dispatch({ name: 'x' }, { signal: stop.signal });
  const j = d.lease('w1');
  stop.abort();
  assert.deepEqual(d.heartbeat('w1', j.stepId), { ok: false, stop: 'cancelled' });
  d.fail('w1', j.stepId, 'stopped');
  d.lease('w1');
  d.fail('w1', j.stepId, 'stopped');
  await assert.rejects(cancelled, /failed on worker w1/);

  const lonely = d.dispatch({ name: 'y' });
  d.lease('w1');
  clock.advance(5000);
  d.lease('w3');
  clock.advance(5000);
  d.expire();
  await assert.rejects(lonely, /no worker finished the step \(2 attempt/);
});

/** A control plane: store, dispatcher and the worker API on a port; plus a registered worker's token. */
async function controlPlane({ leaseMs = 60_000 } = {}) {
  const env = testEnv();
  const store = openStore({ env });
  const dispatcher = createDispatcher({ leaseMs });
  const api = workerApi({ store, dispatcher, enrollToken: 'enroll-me' });
  const server = createHttpServer({ routes: api.routes, authorize: api.authorize });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const register = async (name) => (await fetch(`${url}/worker/register`, { method: 'POST', headers: { authorization: 'Bearer enroll-me', 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json();
  return { env, store, dispatcher, url, register, close: () => server.close() };
}

test('tokens: the enrollment token only registers; each worker gets its own token; a revoked token stops working', async () => {
  const cp = await controlPlane();
  try {
    const post = (p, token, body = {}) => fetch(`${cp.url}${p}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/worker/lease', 'enroll-me')).status, 403, 'enrolling is all it can do');
    assert.equal((await post('/worker/lease', 'guess')).status, 401);
    const a = await cp.register('box-a');
    const b = await cp.register('box-b');
    assert.notEqual(a.token, b.token);
    assert.equal((await post('/worker/lease', a.token)).status, 200);
    assert.equal((await post('/worker/register', a.token)).status, 403, 'a worker cannot register more workers');
    assert.ok(!JSON.stringify(cp.store.read()).includes(a.token), 'only hashes in the log');
    revokeWorker(cp.store, a.workerId);
    assert.equal((await post('/worker/lease', a.token)).status, 401);
    assert.equal((await post('/worker/lease', b.token)).status, 200, 'the others keep working');
  } finally {
    cp.close();
  }
});

const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const triage = () => createMockProvider([{ text: '```json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"x"}\n```' }]);
function issueFile() {
  const f = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(f, '# Add half\n\nhalf(n) returns n / 2.\n');
  return f;
}

test('END TO END: the control plane runs the line; a WORKER (over HTTP) builds; its commits come back as a bundle; the PR is delivered', async () => {
  const cp = await controlPlane();
  const { token } = await cp.register('box-a');
  const builder = createMockProvider([{ text: 'Writing half.', tools: [write('half.js', 'export const half = (n) => n / 2;\n')] }, { text: 'Done.' }]);
  const worker = createWorker({ server: cp.url, token, name: 'box-a', providerFor: () => builder });
  const stop = new AbortController();
  const working = worker.loop(stop.signal, { idleMs: 50 });
  try {
    const repo = makeRepo();
    const out = await runJob({ issueFile: issueFile(), repo, autonomy: 'L2', remote: cp.dispatcher, providers: { triage: triage(), build: 'echo', review: await approve() } }, { env: cp.env, store: cp.store });
    assert.equal(out.status, 'delivered', JSON.stringify(out));
    assert.equal(gitIn(repo, 'show', 'factory/issue-1/main:half.js'), 'export const half = (n) => n / 2;', 'pushed by the CONTROL PLANE, from the imported bundle');
    const events = cp.store.read({ stream: `run:${out.runId}` });
    assert.ok(events.some((e) => e.type === 'agent.event' && e.data.event?.name === 'Write'), "the worker's agent events, streamed back");
    assert.equal(builder.requests.length, 2, 'the builder ran on the worker');
    assert.match(fs.readFileSync(out.pr.path, 'utf8'), /half\.js/);
  } finally {
    stop.abort();
    await working;
    cp.close();
  }
});

test('lease loss mid-step: the worker\'s agent is STOPPED, and another worker finishes the step', async () => {
  const cp = await controlPlane({ leaseMs: 600 });
  const a = await cp.register('slow');
  const b = await cp.register('fast');
  const slowBuilder = scriptedProvider([{ text: 'Thinking very slowly…', delayMs: 60_000 }, { text: 'Done.' }]);
  const fastBuilder = createMockProvider([{ text: 'x', tools: [write('half.js', 'export const half = (n) => n / 2;\n')] }, { text: 'Done.' }]);
  // The slow worker's network goes down mid-step (its agent keeps running, it just can't report).
  let partitioned = false;
  const flaky = (url, init) => (partitioned ? Promise.reject(new Error('network down')) : fetch(url, init));
  const slow = createWorker({ server: cp.url, token: a.token, name: 'slow', providerFor: () => slowBuilder, heartbeatMs: 150, fetch: flaky });
  const fast = createWorker({ server: cp.url, token: b.token, name: 'fast', providerFor: () => fastBuilder });
  try {
    const running = runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', remote: cp.dispatcher, providers: { triage: triage(), build: 'echo', review: await approve() } }, { env: cp.env, store: cp.store });
    while (!cp.dispatcher.pending.length) await new Promise((r) => setTimeout(r, 30)); // the build step is waiting for a worker
    const slowRun = slow.once();
    while (cp.dispatcher.pending[0]?.state !== 'leased') await new Promise((r) => setTimeout(r, 20));
    partitioned = true;
    await new Promise((r) => setTimeout(r, 900)); // longer than the 600 ms lease
    const fastRun = await fast.once(); // the step went back to the queue: the fast worker takes it
    assert.equal(fastRun.commits, 1);
    partitioned = false; // the network comes back: the slow worker's next heartbeat hears "lease lost"
    const slowOut = await slowRun;
    assert.equal(slowOut.stopped, 'lease lost', 'the slow agent was stopped, not left running for 60 s');
    const out = await running;
    assert.equal(out.status, 'delivered');
  } finally {
    cp.close();
  }
});

test('containers: the docker arguments (no network, your uid, read-only, limits); and a real run when docker is here', async (t) => {
  const args = containerArgs({ image: 'node:24-slim', command: 'npm test', cwd: '/w/repo', name: 'factory-x', uid: 1000, gid: 1000 });
  const s = args.join(' ');
  for (const part of ['--network none', '--user 1000:1000', '--read-only', '--memory 2g', '--pids-limit 512', '--cap-drop ALL', '-v /w/repo:/w/repo', '-w /w/repo', 'node:24-slim sh -c npm test']) assert.ok(s.includes(part), part);
  assert.ok(containerArgs({ image: 'i', command: 'c', cwd: '/w', network: 'allow', name: 'n' }).join(' ').includes('--network bridge'));

  const runtime = containerRuntime();
  const hasImage = runtime && (await import('node:child_process')).spawnSync(runtime, ['image', 'inspect', 'node:24-slim']).status === 0;
  if (!hasImage) return t.skip('no docker/podman with node:24-slim here');
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.js'), "require('fs').writeFileSync('out.txt', 'from the container'); fetch('https://example.com').then(() => console.log('NETWORK'), () => console.log('no network'));\n");
  const out = await runInContainer({ runtime, image: 'node:24-slim', command: 'node a.js', cwd: dir, timeoutMs: 60_000 });
  assert.equal(out.code, 0, out.output);
  assert.match(out.output, /no network/);
  assert.equal(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8'), 'from the container', 'it wrote to the workspace, as us');
  assert.equal(fs.statSync(path.join(dir, 'out.txt')).uid, process.getuid());
});
