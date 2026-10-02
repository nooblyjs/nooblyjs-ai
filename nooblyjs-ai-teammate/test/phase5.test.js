import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startApp } from './helpers.js';
import { PdfDocument, fit, textWidth } from '../src/util/pdf.js';
import { InvocationService } from '../src/services/invocation.js';

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

const raw = (method, url, { headers = {}, body } = {}) =>
  fetch(app.base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

const csvLines = (text) => text.trim().split('\n');

// ---------- Unit ----------

test('the PDF writer produces a valid cross-reference table and escapes text', () => {
  const pdf = new PdfDocument();
  pdf.text(48, 700, 'Invoice (INV-0010) · total \\ $1,234.50 — “paid”');
  pdf.addPage().line(48, 700, 500, 700);
  const buf = pdf.toBuffer();
  const s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/Count 2/);
  assert.ok(s.includes('Invoice \\(INV-0010\\) \xB7 total \\\\ $1,234.50 \x97 \x93paid\x94'));
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.ok(s.slice(xref).startsWith('xref'));
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});

test('text fitting uses Helvetica widths', () => {
  assert.equal(textWidth('1000', 10), 22.24);
  const long = 'Quarterly competitor scan for twelve enterprise accounts';
  const short = fit(long, 80, 9);
  assert.ok(short.endsWith('…') && textWidth(short, 9) <= 80);
  assert.equal(fit('Short', 80, 9), 'Short');
});

test('estimates count prompt characters plus typical output and bill like real usage', () => {
  const e = InvocationService.estimate({ system: 'x'.repeat(4000), context: '', messages: [{ role: 'user', content: 'y'.repeat(400) }] }, { tokensPerHour: 300000, billingIncrementHours: 0.1, estimateOutputTokens: 4000 }, 50);
  assert.deepEqual(e, { inputTokens: 1100, outputTokens: 4000, tokens: 5100, hours: 0.1, amount: 5 });
});

// ---------- Month close & invoices ----------

test('closing September generates the invoice from approved time, matching the CSV export exactly', async () => {
  assert.equal((await app.send('POST', '/api/invoices', { month: '2026-10' })).body.error.code, 'month_not_ended');
  assert.equal((await app.send('POST', '/api/invoices', { month: 'sept' })).status, 400);

  const preview = await app.get('/api/invoices/close-preview?month=2026-09');
  assert.equal(preview.status, 200);
  assert.ok(preview.body.pending.count > 0, 'the seed has pending September time');
  assert.equal(preview.body.existing.id, 'INV-0009');

  const blocked = await app.send('POST', '/api/invoices', { month: '2026-09' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'pending_entries');
  assert.equal(blocked.body.error.details.count, preview.body.pending.count);

  for (const e of preview.body.pending.entries) {
    assert.equal((await app.send('POST', `/api/teammates/${e.teammateId}/timesheet/${e.id}/approve`)).status, 200);
  }
  const closed = await app.send('POST', '/api/invoices', { month: '2026-09' });
  assert.equal(closed.status, 200, 'regenerates the open seeded invoice under the same number');
  const inv = closed.body;
  assert.equal(inv.id, 'INV-0009');
  assert.equal(inv.status, 'open');
  assert.equal(inv.dueDate, '2026-10-15');
  assert.equal(inv.issuedAt, '2026-10-01');
  assert.equal(inv.excludedPending, undefined);
  assert.equal(inv.byTeammate.reduce((s, r) => s + r.entries, 0), inv.entries);

  // The billing export for September, approved rows only, is the invoice row for row.
  const exported = await app.get('/api/billing/export.csv?period=month&offset=-1');
  const [header, ...rows] = csvLines(exported.body);
  const approved = rows.filter((r) => r.split(',').at(-3) === 'approved');
  assert.equal(approved.length, rows.length, 'everything in September is approved now');
  const sum = Math.round(approved.reduce((s, r) => s + Number(r.split(',').at(-5)), 0) * 100) / 100;
  assert.equal(inv.amount, sum);

  const invCsv = await app.get(`/api/invoices/${inv.id}/csv`);
  assert.match(invCsv.headers.get('content-type'), /text\/csv/);
  assert.match(invCsv.headers.get('content-disposition'), /INV-0009-2026-09\.csv/);
  const [invHeader, ...invRows] = csvLines(invCsv.body);
  assert.equal(invHeader, header);
  assert.deepEqual([...invRows].sort(), [...approved].sort());

  const pdf = await fetch(`${app.base}/api/invoices/${inv.id}/pdf`, { headers: { Cookie: app.session.cookie } });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  assert.ok(bytes.toString('latin1').includes('Invoice INV-0009'));

  const paid = await app.send('PATCH', `/api/invoices/${inv.id}`, { status: 'paid' });
  assert.deepEqual([paid.body.status, paid.body.paidAt], ['paid', '2026-10-01']);
  assert.equal((await app.send('POST', '/api/invoices', { month: '2026-09' })).body.error.code, 'invoice_paid');
  const listed = (await app.get('/api/billing')).body.invoices.find((i) => i.id === 'INV-0009');
  assert.equal(listed.status, 'paid');

  const audit = (await app.get('/api/admin/audit')).body.entries.map((e) => e.action);
  for (const a of ['invoice.regenerate', 'invoice.paid']) assert.ok(audit.includes(a), a);
});

test('a month can be closed without its pending time, and new invoices take the next number', async () => {
  const other = await startApp();
  try {
    // Move one September entry into August so August has something to invoice besides its paid import.
    await other.send('PATCH', '/api/invoices/INV-0008', { status: 'open' });
    const closed = await other.send('POST', '/api/invoices', { month: '2026-09', excludePending: true });
    assert.equal(closed.status, 200);
    assert.ok(closed.body.excludedPending.count > 0);
    const pendingIds = new Set((await other.get('/api/invoices/close-preview?month=2026-09')).body.pending.entries.map((e) => e.id));
    const lines = (await other.get(`/api/invoices/${closed.body.id}`)).body.lines;
    assert.ok(lines.every((l) => !pendingIds.has(l.entryId)));
    assert.equal((await other.send('POST', '/api/invoices', { month: '2026-08' })).body.error.code, 'nothing_to_invoice');
    assert.equal((await other.get('/api/invoices/INV-9999')).status, 404);
    assert.equal(await other.repos.invoices.nextId(), 'INV-0010');
  } finally {
    other.close();
  }
});

// ---------- Settings, models ----------

test('budgets, billing conversion, cost centres and the owner are editable with field errors', async () => {
  const bad = await app.send('PATCH', '/api/settings', { billing: { tokensPerHour: 5, invoiceDueDay: 31 }, timezone: 'Mars/Olympus', owner: { name: ' ' } });
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['billing.invoiceDueDay', 'billing.tokensPerHour', 'owner.name', 'timezone']);

  const inUse = await app.send('PATCH', '/api/settings', { costCentres: ['Support', 'Sales'] });
  assert.equal(inUse.status, 422);
  assert.match(inUse.body.error.details.costCentres, /Ada Quill \(Growth\)/);

  const centres = (await app.get('/api/settings')).body.costCentres;
  const ok = await app.send('PATCH', '/api/settings', { budgets: { month: 12000 }, owner: { name: 'Stevie B' }, costCentres: [...centres, 'Research'], billing: { tokensPerHour: 1000 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.budgets.month, 12000);
  assert.equal(ok.body.budgets.week, 2100, 'other budgets are kept');
  assert.equal(ok.body.billing.invoiceDueDay, 15, 'other billing settings are kept');
  assert.ok(ok.body.costCentres.includes('Research'));
  const meta = (await app.get('/api/meta')).body;
  assert.equal(meta.owner.name, 'Stevie B');
  assert.equal(meta.sidebarBudget.budget, 12000);

  // The new conversion applies to the next task: hours = tokens / 1000, rounded up to 0.1 h.
  const task = await app.send('POST', '/api/teammates/juno-park/tasks', { task: 'Tidy the refund macro', costCentre: 'Research' });
  assert.equal(task.status, 200);
  assert.equal(task.body.entry.costCentre, 'Research');
  assert.equal(task.body.hours, Math.round(Math.ceil(task.body.tokens / 1000 / 0.1) * 0.1 * 10) / 10);
  await app.send('PATCH', '/api/settings', { billing: { tokensPerHour: 300000 }, owner: { name: 'Stevie' } });
});

test('model prices are editable and record when they were last reviewed', async () => {
  const before = (await app.get('/api/models')).body.models.find((m) => m.id === 'sonnet');
  assert.equal(before.pricingReviewedAt, '2026-09-25');
  assert.equal(before.reviewStale, false);

  const same = await app.send('PATCH', '/api/models/sonnet', { pricing: { ...before.pricing }, description: 'Everyday work' });
  assert.equal(same.body.pricingReviewedAt, '2026-09-25', 'unchanged prices are not a review');
  const changed = await app.send('PATCH', '/api/models/sonnet', { pricing: { input: 2.5 } });
  assert.deepEqual([changed.body.pricing.input, changed.body.pricing.output, changed.body.pricingReviewedAt], [2.5, 10, '2026-10-01']);
  const reviewed = await app.send('PATCH', '/api/models/haiku', { reviewed: true });
  assert.equal(reviewed.body.pricingReviewedAt, '2026-10-01');

  const tooCostly = await app.send('PATCH', '/api/models/haiku', { computePerHour: 10 });
  assert.equal(tooCostly.status, 422);
  assert.ok(tooCostly.body.error.details.computePerHour);
  assert.equal((await app.send('PATCH', '/api/models/haiku', { pricing: { output: -1 } })).body.error.details['pricing.output'], 'Enter a number between 0 and 10,000');
  assert.equal((await app.send('PATCH', '/api/models/gpt', { baseRate: 1 })).status, 404);
  assert.equal((await app.get('/api/meta')).body.models.find((m) => m.id === 'sonnet').description, 'Everyday work');
});

// ---------- Approval threshold ----------

test('work estimated over the approval threshold waits for the owner', async () => {
  await app.send('PATCH', '/api/teammates/wren-sato', { approvalThreshold: 1 });
  const { key } = (await app.send('POST', '/api/admin/keys', { name: 'Scheduler', teammates: ['wren-sato'], rateLimit: 50 })).body;
  const { key: otherKey } = (await app.send('POST', '/api/admin/keys', { name: 'Other', teammates: ['wren-sato'], rateLimit: 50 })).body;
  const bearer = { Authorization: `Bearer ${key}` };

  const waiting = await raw('POST', '/api/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'Brief on Initech', project: 'initech' } });
  assert.equal(waiting.status, 202);
  const w = await waiting.json();
  assert.equal(w.status, 'awaiting_approval');
  assert.ok(w.estimate.amount > 1);
  // Streaming callers get the same JSON answer.
  const streamed = await raw('POST', '/api/teammates/wren-sato/tasks', { headers: { ...bearer, Accept: 'text/event-stream' }, body: { task: 'Second brief' } });
  assert.equal(streamed.status, 202);
  const second = await streamed.json();

  const poll = async (id, k = key) => (await raw('GET', `/api/teammates/wren-sato/tasks/${id}`, { headers: { Authorization: `Bearer ${k}` } })).json();
  assert.equal((await poll(w.workId)).status, 'awaiting_approval');
  assert.equal((await raw('GET', `/api/teammates/wren-sato/tasks/${w.workId}`, { headers: { Authorization: `Bearer ${otherKey}` } })).status, 404);

  const pending = (await app.get('/api/approvals?status=pending')).body.approvals;
  assert.deepEqual(pending.map((a) => a.id).sort(), [w.workId, second.workId].sort());
  assert.equal(pending.find((a) => a.id === w.workId).task, 'Brief on Initech');

  assert.equal((await app.send('POST', `/api/approvals/${w.workId}/approve`)).status, 202);
  assert.equal((await app.send('POST', `/api/approvals/${w.workId}/approve`)).body.error.code, 'approval_decided');
  await app.invocation.idle();
  const done = await poll(w.workId);
  assert.equal(done.status, 'completed');
  assert.ok(done.output.length > 0);
  assert.equal(done.approvedBy, 'Stevie');
  const work = (await app.get(`/api/teammates/wren-sato/work/${w.workId}`)).body;
  assert.deepEqual([work.caller.name, work.project, work.approvedBy], ['Scheduler', 'initech', 'Stevie']);

  const declined = await app.send('POST', `/api/approvals/${second.workId}/decline`, { reason: 'Not this week' });
  assert.equal(declined.body.status, 'declined');
  assert.deepEqual([(await poll(second.workId)).status, (await poll(second.workId)).reason], ['declined', 'Not this week']);
  assert.equal((await app.send('POST', `/api/approvals/${second.workId}/approve`)).status, 409);

  // The owner is asked to confirm instead, and can go ahead.
  const owner = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Owner brief' });
  assert.equal(owner.status, 409);
  assert.equal(owner.body.error.code, 'approval_required');
  assert.ok(owner.body.error.details.estimate.amount > 1);
  const confirmed = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Owner brief', confirmCost: true });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.approvedBy, 'Stevie');
  // Keys can't confirm their own way past the threshold.
  const sneaky = await raw('POST', '/api/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'x', confirmCost: true } });
  assert.equal(sneaky.status, 202);

  // Without a threshold everything runs straight away.
  await app.send('PATCH', '/api/teammates/wren-sato', { approvalThreshold: null });
  assert.equal((await raw('POST', '/api/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'y' } })).status, 200);
});

// ---------- Alerts ----------

test('crossing the cap warning raises one alert, on screen and by signed webhook', async () => {
  await app.send('PATCH', '/api/settings', { alerts: { warnAtPct: 80 } });
  const created = await app.send('POST', '/api/webhooks', { name: 'Alerts', url: 'https://hooks.example.com/teammates', events: ['cap.warning', 'cap.reached', 'budget.warning', 'budget.reached'] });
  assert.equal(created.status, 201);
  const secret = created.body.secret;
  assert.match(secret, /^whsec_/);
  const listed = (await app.get('/api/webhooks')).body.endpoints.find((e) => e.id === created.body.endpoint.id);
  assert.deepEqual([listed.hasSecret, listed.secret], [true, undefined], 'the secret is never sent back');

  // Learn what one small task costs, then set the cap so the next one lands at about 90% of it.
  await app.send('PATCH', '/api/teammates/milo-brightwater', { monthlyCap: 1000000, status: 'available' });
  const first = await app.send('POST', '/api/teammates/milo-brightwater/tasks', { task: 'Fix the hero copy' });
  await app.invocation.idle();
  const used = (await app.get('/api/teammates/milo-brightwater')).body.monthBilled;
  await app.send('PATCH', '/api/teammates/milo-brightwater', { monthlyCap: Math.round(((used + first.body.amount) / 0.9) * 100) / 100 });
  webhooks.length = 0;
  assert.equal((await app.send('POST', '/api/teammates/milo-brightwater/tasks', { task: 'And the footer' })).status, 200);
  await app.invocation.idle();
  await app.alerts.check('milo-brightwater'); // checking again raises nothing new
  const capHooks = webhooks.filter((h) => h.body.event.startsWith('cap.') && h.body.data.teammate === 'milo-brightwater');
  assert.equal(capHooks.length, 1, 'raised once per threshold per month');
  const [hook] = capHooks;
  assert.equal(hook.body.event, 'cap.warning');
  assert.equal(hook.url, 'https://hooks.example.com/teammates');
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(hook.body)).digest('hex');
  assert.equal(hook.headers['X-Teammates-Signature'], `sha256=${expected}`);

  const current = (await app.get('/api/alerts')).body;
  const milo = current.items.find((a) => a.kind === 'cap' && a.id === 'milo-brightwater');
  assert.equal(milo.level, 'warning');
  assert.match(milo.message, /Milo Brightwater has used \d+% of the \$[\d,]+ monthly cap/);

  const test = await app.send('POST', `/api/webhooks/${created.body.endpoint.id}/test`);
  assert.deepEqual([test.body.ok, test.body.event], [true, 'webhook.test']);
  assert.equal((await app.get('/api/webhooks')).body.endpoints.find((e) => e.id === created.body.endpoint.id).lastDelivery.event, 'webhook.test');
});

// ---------- Budget and token views ----------

test('pending time counts towards the budget and is reported separately', async () => {
  const b = (await app.get('/api/billing?period=month')).body;
  const pending = b.review.entries.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
  assert.equal(b.budget.pending, Math.round(pending * 100) / 100);
  assert.equal(b.budget.used, b.totals.amount);
  assert.ok(b.budget.pending > 0);
});

test('the token view reconciles with the export and shows margin over API cost', async () => {
  const t = (await app.get('/api/billing/tokens?period=month&offset=-1')).body;
  const [, ...rows] = csvLines((await app.get('/api/billing/export.csv?period=month&offset=-1')).body);
  const sum = (i) => Math.round(rows.reduce((s, r) => s + Number(r.split(',').at(i)), 0) * 100) / 100;
  assert.equal(t.totals.tokens, sum(-7));
  assert.equal(t.totals.amount, sum(-5));
  assert.equal(t.totals.apiCost, sum(-4));
  assert.equal(t.totals.margin, Math.round((t.totals.amount - t.totals.apiCost) * 100) / 100);
  assert.equal(t.byModel.reduce((s, m) => s + m.tokens, 0), t.totals.tokens);
  assert.ok(t.byTeammate.every((r) => r.marginPct <= 100 && r.apiCostPerMTok > 0));
  assert.equal((await app.get('/api/billing/tokens?period=year')).status, 400);
});

test('billing administration is owner-only', async () => {
  const { key } = (await app.send('POST', '/api/admin/keys', { name: 'Reader', rateLimit: 50 })).body;
  for (const url of ['/api/invoices/INV-0009', '/api/settings', '/api/models', '/api/approvals', '/api/alerts', '/api/billing/tokens']) {
    assert.equal((await raw('GET', url, { headers: { Authorization: `Bearer ${key}` } })).status, 403, url);
    assert.equal((await app.get(url, { auth: false })).status, 401, url);
  }
});
