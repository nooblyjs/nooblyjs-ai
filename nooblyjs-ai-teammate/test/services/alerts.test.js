// services/alerts.js: cap warnings on screen and by signed webhook.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startApp } from '../helpers.js';

let app;
const webhooks = [];
const fakeFetch = async (url, init) => {
  webhooks.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  return { ok: true, status: 200 };
};

before(async () => {
  app = await startApp({ fetch: fakeFetch });
});
after(() => app.close());

test('crossing the cap warning raises one alert, on screen and by signed webhook', async () => {
  await app.send('PATCH', '/api/v1/settings', { alerts: { warnAtPct: 80 } });
  const created = await app.send('POST', '/api/v1/webhooks', { name: 'Alerts', url: 'https://hooks.example.com/teammates', events: ['cap.warning', 'cap.reached', 'budget.warning', 'budget.reached'] });
  assert.equal(created.status, 201);
  const secret = created.body.secret;
  assert.match(secret, /^whsec_/);
  const listed = (await app.get('/api/v1/webhooks')).body.endpoints.find((e) => e.id === created.body.endpoint.id);
  assert.deepEqual([listed.hasSecret, listed.secret], [true, undefined], 'the secret is never sent back');

  // Learn what one small task costs, then set the cap so the next one lands at about 90% of it.
  await app.send('PATCH', '/api/v1/teammates/milo-brightwater', { monthlyCap: 1000000, status: 'available' });
  const first = await app.send('POST', '/api/v1/teammates/milo-brightwater/tasks', { task: 'Fix the hero copy' });
  await app.invocation.idle();
  const used = (await app.get('/api/v1/teammates/milo-brightwater')).body.monthBilled;
  await app.send('PATCH', '/api/v1/teammates/milo-brightwater', { monthlyCap: Math.round(((used + first.body.amount) / 0.9) * 100) / 100 });
  webhooks.length = 0;
  assert.equal((await app.send('POST', '/api/v1/teammates/milo-brightwater/tasks', { task: 'And the footer' })).status, 200);
  await app.invocation.idle();
  await app.alerts.check('milo-brightwater'); // checking again raises nothing new
  const capHooks = webhooks.filter((h) => h.body.event.startsWith('cap.') && h.body.data.teammate === 'milo-brightwater');
  assert.equal(capHooks.length, 1, 'raised once per threshold per month');
  const [hook] = capHooks;
  assert.equal(hook.body.event, 'cap.warning');
  assert.equal(hook.url, 'https://hooks.example.com/teammates');
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(hook.body)).digest('hex');
  assert.equal(hook.headers['X-Teammates-Signature'], `sha256=${expected}`);

  const current = (await app.get('/api/v1/alerts')).body;
  const milo = current.items.find((a) => a.kind === 'cap' && a.id === 'milo-brightwater');
  assert.equal(milo.level, 'warning');
  assert.match(milo.message, /Milo Brightwater has used \d+% of the \$[\d,]+ monthly cap/);

  const test = await app.send('POST', `/api/v1/webhooks/${created.body.endpoint.id}/test`);
  assert.deepEqual([test.body.ok, test.body.event], [true, 'webhook.test']);
  assert.equal((await app.get('/api/v1/webhooks')).body.endpoints.find((e) => e.id === created.body.endpoint.id).lastDelivery.event, 'webhook.test');
});
