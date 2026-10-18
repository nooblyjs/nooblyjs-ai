// services/events.js: live events on core's notifying service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, closeHost } from '../helpers.js';

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

test('live events are published on the notifying service', async () => {
  const seen = [];
  const unsubscribe = await app.events.subscribe((e) => seen.push(e));
  app.events.publish('teammate', { id: 'ada-quill', status: 'available' });
  unsubscribe();
  app.events.publish('teammate', { id: 'ada-quill', status: 'paused' });
  assert.deepEqual(seen, [{ type: 'teammate', data: { id: 'ada-quill', status: 'available' } }]);
  const history = app.core.notifying.getNotifications();
  assert.ok(history.some((n) => n.topic === 'teammates.events' || n.topicName === 'teammates.events'));

  // NooblyJS's event stream relays them to the browser: each goes to host.events with its data as `live`.
  app.events.publish('alert', { level: 'warning' });
  assert.deepEqual(app.host.eventLog.at(-1).payload, { live: { level: 'warning' } });
  assert.equal(app.host.eventLog.at(-1).type, 'teammates.alert_raised');
  assert.equal((await raw(`${app.mountPath}/api/v1/events`)).status, 404);
});
