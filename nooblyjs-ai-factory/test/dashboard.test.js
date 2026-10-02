// Phase F17: the dashboard's server: auth, the API, SSE resuming, and acting from the browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { startDashboard } from '../src/commands/dashboard.js';
import { createMockProvider } from '../src/harness.js';
import { openEntries } from '../src/humans/inbox.js';
import { runJob, submitJob } from '../src/job/run-job.js';
import { openStore } from '../src/store/events.js';
import { approve, makeRepo, testEnv, tmpDir } from './helpers.js';

function issueFile(text = '# Add half\n\nhalf(n) returns n / 2.\n') {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, text);
  return file;
}
const triage = () => createMockProvider([{ text: '```json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"one function"}\n```' }]);
const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });

async function board(env = testEnv()) {
  const store = openStore({ env });
  const d = await startDashboard({ store, port: 0, env });
  const base = d.url.split('/#')[0];
  const call = async (method, p, { body, token = d.token, query = false } = {}) => {
    const res = await fetch(`${base}${p}${query ? `${p.includes('?') ? '&' : '?'}token=${token}` : ''}`, { method, headers: { ...(!query && token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
    return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  return { env, store, base, call, token: d.token, close: () => d.server.close() };
}

test('auth: the page is public, the API needs the token (and a POST needs it in the header)', async () => {
  const b = await board();
  try {
    assert.equal((await b.call('GET', '/', { token: null })).status, 200, 'the page itself holds no data');
    assert.match((await b.call('GET', '/app.js', { token: null })).json, /EventSource/);
    assert.equal((await b.call('GET', '/../package.json', { token: null })).status, 404);
    assert.equal((await b.call('GET', '/api/status', { token: null })).status, 401);
    assert.equal((await b.call('GET', '/api/status', { token: 'guess' })).status, 401);
    assert.equal((await b.call('GET', '/api/status')).status, 200);
    assert.equal((await b.call('GET', '/api/status', { query: true })).status, 200, 'EventSource can only use the query');
    assert.equal((await b.call('POST', '/api/stop-all', { query: true })).status, 401, 'but a POST cannot');
    // the dashboard's own header: proxies (Cloud Shell's web preview) take Authorization for their login
    const own = (method, p, t = b.token) => fetch(`${b.base}${p}`, { method, headers: { 'x-factory-token': t } }).then((r) => r.status);
    assert.equal(await own('GET', '/api/status'), 200);
    assert.equal(await own('GET', '/api/status', 'guess'), 401);
    assert.equal(await own('POST', '/api/resume-all'), 200, 'it counts as the header for a POST');
    assert.match(fs.readFileSync(path.join(b.env.FACTORY_HOME, 'dashboard-token'), 'utf8'), new RegExp(b.token));
    assert.equal(fs.statSync(path.join(b.env.FACTORY_HOME, 'dashboard-token')).mode & 0o777, 0o600);
  } finally {
    b.close();
  }
});

test('API: status, runs and a run (steps, story, agent output, evidence); stop-all and resume-all', async () => {
  const b = await board();
  try {
    const build = createMockProvider([{ text: 'Writing.', tools: [write('half.js', 'export const half = (n) => n / 2;\n')] }, { text: 'Done.' }]);
    const out = await runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', providers: { triage: triage(), build, review: await approve() } }, { env: b.env, store: b.store });
    const queued = submitJob(b.store, { repo: makeRepo(), issueFile: issueFile('# Add double\n\nx\n') });
    const status = (await b.call('GET', '/api/status')).json;
    assert.deepEqual(status.line.map((s) => s.id).slice(0, 3), ['triage', 'spec', 'approve']);
    assert.equal(status.queued[0].id, queued);
    assert.match(status.queued[0].waiting, /next tick/);
    assert.equal(status.counts.delivered, 1);
    const runs = (await b.call('GET', '/api/runs')).json.runs;
    assert.equal(runs.length, 2);
    const run = (await b.call('GET', `/api/runs/${out.runId}`)).json;
    assert.equal(run.run.status, 'delivered');
    assert.equal(run.steps.find((s) => s.id === 'build').status, 'done');
    assert.equal(run.steps.find((s) => s.id === 'spec').status, 'pending', 'skipped for a small item');
    assert.ok(run.story.some((e) => /┌ build/.test(e.line)));
    assert.ok(run.agent.some((e) => /Write/.test(e.line)), 'agent output');
    assert.ok(run.story.every((e) => !/\x1b\[/.test(e.line)), 'no terminal colours');
    assert.match(run.evidence, /## At a glance/);
    assert.equal((await b.call('GET', '/api/runs/nope')).status, 404);

    await b.call('POST', '/api/stop-all');
    assert.equal((await b.call('GET', '/api/status')).json.stopped, true);
    await b.call('POST', '/api/resume-all');
    assert.equal((await b.call('GET', '/api/status')).json.stopped, false);
  } finally {
    b.close();
  }
});

test('acting from the browser: answer an agent\'s question (the run is queued again); retry a finished run; cancel', async () => {
  const b = await board();
  try {
    const build = createMockProvider([{ text: 'Unclear.', tools: [{ name: 'mcp__factory__ask_human', input: { question: '1.5 or 1?' } }] }, { text: 'Waiting.' }]);
    const first = await runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', providers: { triage: triage(), build, review: await approve() } }, { env: b.env, store: b.store });
    assert.equal(first.status, 'parked');
    const [ask] = (await b.call('GET', '/api/inbox')).json.entries;
    assert.equal(ask.kind, 'question');
    assert.equal((await b.call('POST', `/api/inbox/${ask.id}`, { body: { decision: 'answered', answer: '' } })).status, 400, 'an empty answer');
    const answered = (await b.call('POST', `/api/inbox/${ask.id}`, { body: { decision: 'answered', answer: '1.5' } })).json;
    assert.equal(answered.resumed, true);
    assert.equal(b.store.get('runs', first.runId).status, 'queued', 'back in the queue for factory serve');
    assert.equal(openEntries(b.store).length, 0);
    assert.match((await b.call('POST', `/api/runs/${first.runId}/retry`)).json.error, /only a finished run/);

    const done = await runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', providers: { triage: triage(), build: createMockProvider([{ text: 'x', tools: [write('a.js', '1\n')] }, { text: 'Done.' }]), review: await approve() } }, { env: b.env, store: b.store });
    const retried = (await b.call('POST', `/api/runs/${done.runId}/retry`, { body: { from: 'review' } })).json.run;
    assert.equal(retried.status, 'queued');
    assert.equal(b.store.get('runs', done.runId).steps.review.status, 'pending');
    assert.equal(b.store.get('runs', done.runId).steps.build.status, 'done', 'earlier stations are kept');
    await b.call('POST', `/api/runs/${done.runId}/cancel`);
    assert.equal(b.store.get('runs', done.runId).status, 'cancelled');
  } finally {
    b.close();
  }
});

/** Read an SSE stream until `count` messages arrived. */
function readSse(url, headers, count) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let buf = '';
      const msgs = [];
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const id = block.match(/^id: (\d+)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (id) msgs.push({ id: Number(id), data: JSON.parse(data) });
          if (msgs.length >= count) {
            req.destroy();
            resolve({ msgs, type: res.headers['content-type'] });
          }
        }
      });
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
  });
}

test('SSE: the event log, live; a reconnect with Last-Event-ID gets exactly what it missed', async () => {
  const b = await board();
  try {
    const runId = submitJob(b.store, { repo: makeRepo(), issueFile: issueFile() });
    const seqNow = b.store.read().at(-1).seq;
    // Connected before new events: they arrive live (the stream polls the log).
    const live = readSse(`${b.base}/api/events?token=${b.token}`, {}, 2);
    await new Promise((r) => setTimeout(r, 100));
    b.store.append(`run:${runId}`, 'run.pause_requested', { runId });
    b.store.append(`run:${runId}`, 'run.paused', { runId });
    const got = await live;
    assert.equal(got.type?.split(';')[0], 'text/event-stream');
    assert.deepEqual(got.msgs.map((m) => m.id), [seqNow + 1, seqNow + 2]);
    assert.equal(got.msgs[0].data.type, 'run.pause_requested');
    assert.equal(got.msgs[0].data.runId, runId);
    // The browser lost the connection after seqNow+1: it reconnects with Last-Event-ID and gets seqNow+2 only.
    const again = await readSse(`${b.base}/api/events?token=${b.token}`, { 'last-event-id': String(seqNow + 1) }, 1);
    assert.deepEqual(again.msgs.map((m) => m.id), [seqNow + 2]);
    // ?after= does the same for a first connection.
    const after = await readSse(`${b.base}/api/events?token=${b.token}&after=0`, {}, 3);
    assert.deepEqual(after.msgs.map((m) => m.id), [1, 2, 3]);
  } finally {
    b.close();
  }
});
