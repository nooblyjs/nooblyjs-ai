// controllers/settings.js: workspace settings, and model prices.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('budgets, billing conversion, cost centres and the owner are editable with field errors', async () => {
  const bad = await app.send('PATCH', '/api/v1/settings', { billing: { tokensPerHour: 5, invoiceDueDay: 31 }, timezone: 'Mars/Olympus', owner: { name: ' ' } });
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['billing.invoiceDueDay', 'billing.tokensPerHour', 'owner.name', 'timezone']);

  const inUse = await app.send('PATCH', '/api/v1/settings', { costCentres: ['Support', 'Sales'] });
  assert.equal(inUse.status, 422);
  assert.match(inUse.body.error.details.costCentres, /Ada Quill \(Growth\)/);

  const centres = (await app.get('/api/v1/settings')).body.costCentres;
  const ok = await app.send('PATCH', '/api/v1/settings', { budgets: { month: 12000 }, owner: { name: 'Stevie B' }, costCentres: [...centres, 'Research'], billing: { tokensPerHour: 1000 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.budgets.month, 12000);
  assert.equal(ok.body.budgets.week, 2100, 'other budgets are kept');
  assert.equal(ok.body.billing.invoiceDueDay, 15, 'other billing settings are kept');
  assert.ok(ok.body.costCentres.includes('Research'));
  const meta = (await app.get('/api/v1/meta')).body;
  assert.equal(meta.owner.name, 'Stevie B');
  assert.equal(meta.sidebarBudget.budget, 12000);

  // The new conversion applies to the next task: hours = tokens / 1000, rounded up to 0.1 h.
  const task = await app.send('POST', '/api/v1/teammates/juno-park/tasks', { task: 'Tidy the refund macro', costCentre: 'Research' });
  assert.equal(task.status, 200);
  assert.equal(task.body.entry.costCentre, 'Research');
  assert.equal(task.body.hours, Math.round(Math.ceil(task.body.tokens / 1000 / 0.1) * 0.1 * 10) / 10);
  await app.send('PATCH', '/api/v1/settings', { billing: { tokensPerHour: 300000 }, owner: { name: 'Stevie' } });
});

test('model prices are editable and record when they were last reviewed', async () => {
  const before = (await app.get('/api/v1/models')).body.models.find((m) => m.id === 'sonnet');
  assert.equal(before.pricingReviewedAt, '2026-09-25');
  assert.equal(before.reviewStale, false);

  const same = await app.send('PATCH', '/api/v1/models/sonnet', { pricing: { ...before.pricing }, description: 'Everyday work' });
  assert.equal(same.body.pricingReviewedAt, '2026-09-25', 'unchanged prices are not a review');
  const changed = await app.send('PATCH', '/api/v1/models/sonnet', { pricing: { input: 2.5 } });
  assert.deepEqual([changed.body.pricing.input, changed.body.pricing.output, changed.body.pricingReviewedAt], [2.5, 10, '2026-10-01']);
  const reviewed = await app.send('PATCH', '/api/v1/models/haiku', { reviewed: true });
  assert.equal(reviewed.body.pricingReviewedAt, '2026-10-01');

  const tooCostly = await app.send('PATCH', '/api/v1/models/haiku', { computePerHour: 10 });
  assert.equal(tooCostly.status, 422);
  assert.ok(tooCostly.body.error.details.computePerHour);
  assert.equal((await app.send('PATCH', '/api/v1/models/haiku', { pricing: { output: -1 } })).body.error.details['pricing.output'], 'Enter a number between 0 and 10,000');
  assert.equal((await app.send('PATCH', '/api/v1/models/gpt', { baseRate: 1 })).status, 404);
  assert.equal((await app.get('/api/v1/meta')).body.models.find((m) => m.id === 'sonnet').description, 'Everyday work');
});
