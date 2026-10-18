// services/scheduler.js: wall-clock schedules, and the schedule check on core scheduling.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, closeHost } from '../helpers.js';
import { nextRun, describeCadence, checkTaskName } from '../../src/services/scheduler.js';
import { serverManager as registry } from '../fixtures/host.js';

process.env.DEFAULT_ADMIN_PASSWORD = 'core-admin-Passw0rd!';

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await closeHost(); // worker threads and timers, so the test process can exit
});

// Site paths: the host's /services/…, or the app's own under its mount path (app.mountPath).
const raw = (url, { method = 'GET', headers = {}, body, cookie = true } = {}) => fetch(app.base + url, {
  method, redirect: 'manual',
  headers: { ...(cookie ? { Cookie: app.session.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const waitFor = async (check, { timeoutMs = 5000, stepMs = 25 } = {}) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, stepMs));
  }
};
const ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD;

/** Signs in to core's /services as admin@localhost. The admin account is created in the background on first start. */
const coreLogin = () => waitFor(async () => {
  const res = await raw('/services/authservice/api/login', { method: 'POST', cookie: false, body: { email: 'admin@localhost', password: ADMIN_PASSWORD } });
  if (res.status !== 200) return null;
  const body = await res.json();
  return { cookie: res.headers.get('set-cookie').split(';')[0], setCookie: res.headers.get('set-cookie'), token: body.data.session.token };
});

test('schedules run at wall-clock times in the workspace time zone', () => {
  const after = Date.parse('2026-10-01T12:00:00Z'); // a Thursday
  assert.equal(nextRun({ days: [1], time: '08:00' }, after, 'Africa/Johannesburg'), '2026-10-05T06:00:00.000Z');
  assert.equal(nextRun({ days: [4], time: '13:30' }, after, 'UTC'), '2026-10-01T13:30:00.000Z');
  // London leaves summer time on 25 October 2026.
  assert.equal(nextRun({ days: [1], time: '08:00' }, Date.parse('2026-10-15T00:00:00Z'), 'Europe/London'), '2026-10-19T07:00:00.000Z');
  assert.equal(nextRun({ days: [1], time: '08:00' }, Date.parse('2026-10-20T00:00:00Z'), 'Europe/London'), '2026-10-26T08:00:00.000Z');
  assert.equal(describeCadence({ days: [1, 2, 3, 4, 5], time: '09:00' }), 'Weekdays at 09:00');
  assert.equal(describeCadence({ days: [1], time: '08:00' }), 'Every Mon at 08:00');
});

test('the schedule check runs as a core scheduled task that can be watched and stopped', async () => {
  const sched = await startApp({ scheduleIntervalMs: 1000 });
  try {
    assert.notEqual(sched.core.instanceName, app.core.instanceName, 'each app gets its own core instances');
    const sch = await sched.send('POST', '/api/v1/schedules', { teammateId: 'ada-quill', name: 'Daily digest', task: 'Write the daily digest', cadence: { days: [1, 2, 3, 4, 5, 6, 7], time: '09:00' } });
    assert.equal(sch.status, 201);
    // Make it due now; the next beat of the core task picks it up.
    await sched.repos.schedules.update(sch.body.id, () => ({ nextRunAt: new Date(Date.now() - 1000).toISOString() }));
    const ran = await waitFor(async () => {
      const s = await sched.repos.schedules.get(sch.body.id);
      return s.lastStatus === 'completed' && s;
    }, { timeoutMs: 15000, stepMs: 100 });
    assert.match(ran.lastWorkId, /^wk_/);

    const status = (await sched.get('/api/v1/admin/system')).body.scheduleCheck;
    assert.deepEqual([status.mode, status.task, status.registered, status.enabled, status.intervalSeconds], ['core', checkTaskName(sched.core.instanceName), true, true, 1]);
    assert.ok(status.lastFinishedAt);
    // Core's own API lists it too (this route reads the query string, which must survive the hand-off to core).
    const { token } = await coreLogin();
    const listed = await raw('/services/scheduling/api/schedules?limit=5', { cookie: false, headers: { Authorization: `Bearer ${token}` } });
    assert.equal(listed.status, 200);
    assert.ok((await listed.json()).some((t) => t.name === checkTaskName(sched.core.instanceName)));
    await sched.invocation.idle();
  } finally {
    await sched.close();
  }
  const scheduling = registry.getServiceInstance('scheduling', 'memory', sched.core.instanceName);
  assert.equal(await scheduling.isRunning(checkTaskName(sched.core.instanceName)), false, 'closing the app stops the check');
});
