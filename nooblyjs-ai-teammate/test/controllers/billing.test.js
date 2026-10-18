// controllers/billing.js: the billing views and CSV, month close and invoices, budgets, and who may administer billing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let base;
let app;
before(async () => {
  app = await startApp();
  base = app.url; // the app's root, e.g. http://127.0.0.1:port/teammates
});
after(() => app.close());

const send = (method, url, body) => app.send(method, url, body);
const authed = (headers = {}) => ({ ...headers, Cookie: app.session.cookie, 'X-CSRF-Token': app.session.csrf });
const raw = (method, url, { headers = {}, body } = {}) =>
  fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const csvLines = (text) => text.trim().split('\n');

test('CSV export neutralises spreadsheet formulas', async () => {
  await send('POST', '/api/v1/teammates/milo-brightwater/tasks', { task: '=HYPERLINK("http://x")' });
  const res = await fetch(`${base}/api/v1/billing/export.csv?period=month`, { headers: authed() });
  const csv = await res.text();
  assert.match(res.headers.get('content-disposition'), /timesheets-2026-10-01-to-2026-10-31\.csv/);
  assert.match(csv, /"'=HYPERLINK/);
});

test('closing September generates the invoice from approved time, matching the CSV export exactly', async () => {
  assert.equal((await app.send('POST', '/api/v1/invoices', { month: '2026-10' })).body.error.code, 'month_not_ended');
  assert.equal((await app.send('POST', '/api/v1/invoices', { month: 'sept' })).status, 400);

  const preview = await app.get('/api/v1/invoices/close-preview?month=2026-09');
  assert.equal(preview.status, 200);
  assert.ok(preview.body.pending.count > 0, 'the seed has pending September time');
  assert.equal(preview.body.existing.id, 'INV-0009');

  const blocked = await app.send('POST', '/api/v1/invoices', { month: '2026-09' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'pending_entries');
  assert.equal(blocked.body.error.details.count, preview.body.pending.count);

  for (const e of preview.body.pending.entries) {
    assert.equal((await app.send('POST', `/api/v1/teammates/${e.teammateId}/timesheet/${e.id}/approve`)).status, 200);
  }
  const closed = await app.send('POST', '/api/v1/invoices', { month: '2026-09' });
  assert.equal(closed.status, 200, 'regenerates the open seeded invoice under the same number');
  const inv = closed.body;
  assert.equal(inv.id, 'INV-0009');
  assert.equal(inv.status, 'open');
  assert.equal(inv.dueDate, '2026-10-15');
  assert.equal(inv.issuedAt, '2026-10-01');
  assert.equal(inv.excludedPending, undefined);
  assert.equal(inv.byTeammate.reduce((s, r) => s + r.entries, 0), inv.entries);

  // The billing export for September, approved rows only, is the invoice row for row.
  const exported = await app.get('/api/v1/billing/export.csv?period=month&offset=-1');
  const [header, ...rows] = csvLines(exported.body);
  const approved = rows.filter((r) => r.split(',').at(-3) === 'approved');
  assert.equal(approved.length, rows.length, 'everything in September is approved now');
  const sum = Math.round(approved.reduce((s, r) => s + Number(r.split(',').at(-5)), 0) * 100) / 100;
  assert.equal(inv.amount, sum);

  const invCsv = await app.get(`/api/v1/invoices/${inv.id}/csv`);
  assert.match(invCsv.headers.get('content-type'), /text\/csv/);
  assert.match(invCsv.headers.get('content-disposition'), /INV-0009-2026-09\.csv/);
  const [invHeader, ...invRows] = csvLines(invCsv.body);
  assert.equal(invHeader, header);
  assert.deepEqual([...invRows].sort(), [...approved].sort());

  const pdf = await fetch(`${app.url}/api/v1/invoices/${inv.id}/pdf`, { headers: { Cookie: app.session.cookie } });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  assert.ok(bytes.toString('latin1').includes('Invoice INV-0009'));

  const paid = await app.send('PATCH', `/api/v1/invoices/${inv.id}`, { status: 'paid' });
  assert.deepEqual([paid.body.status, paid.body.paidAt], ['paid', '2026-10-01']);
  assert.equal((await app.send('POST', '/api/v1/invoices', { month: '2026-09' })).body.error.code, 'invoice_paid');
  const listed = (await app.get('/api/v1/billing')).body.invoices.find((i) => i.id === 'INV-0009');
  assert.equal(listed.status, 'paid');

  const audit = (await app.get('/api/v1/admin/audit')).body.entries.map((e) => e.action);
  for (const a of ['invoice.regenerate', 'invoice.paid']) assert.ok(audit.includes(a), a);
});

test('a month can be closed without its pending time, and new invoices take the next number', async () => {
  const other = await startApp();
  try {
    // Move one September entry into August so August has something to invoice besides its paid import.
    await other.send('PATCH', '/api/v1/invoices/INV-0008', { status: 'open' });
    const closed = await other.send('POST', '/api/v1/invoices', { month: '2026-09', excludePending: true });
    assert.equal(closed.status, 200);
    assert.ok(closed.body.excludedPending.count > 0);
    const pendingIds = new Set((await other.get('/api/v1/invoices/close-preview?month=2026-09')).body.pending.entries.map((e) => e.id));
    const lines = (await other.get(`/api/v1/invoices/${closed.body.id}`)).body.lines;
    assert.ok(lines.every((l) => !pendingIds.has(l.entryId)));
    assert.equal((await other.send('POST', '/api/v1/invoices', { month: '2026-08' })).body.error.code, 'nothing_to_invoice');
    assert.equal((await other.get('/api/v1/invoices/INV-9999')).status, 404);
    assert.equal(await other.repos.invoices.nextId(), 'INV-0010');
  } finally {
    other.close();
  }
});

test('pending time counts towards the budget and is reported separately', async () => {
  const b = (await app.get('/api/v1/billing?period=month')).body;
  const pending = b.review.entries.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
  assert.equal(b.budget.pending, Math.round(pending * 100) / 100);
  assert.equal(b.budget.used, b.totals.amount);
  assert.ok(b.budget.pending > 0);
});

test('the token view reconciles with the export and shows margin over API cost', async () => {
  const t = (await app.get('/api/v1/billing/tokens?period=month&offset=-1')).body;
  const [, ...rows] = csvLines((await app.get('/api/v1/billing/export.csv?period=month&offset=-1')).body);
  const sum = (i) => Math.round(rows.reduce((s, r) => s + Number(r.split(',').at(i)), 0) * 100) / 100;
  assert.equal(t.totals.tokens, sum(-7));
  assert.equal(t.totals.amount, sum(-5));
  assert.equal(t.totals.apiCost, sum(-4));
  assert.equal(t.totals.margin, Math.round((t.totals.amount - t.totals.apiCost) * 100) / 100);
  assert.equal(t.byModel.reduce((s, m) => s + m.tokens, 0), t.totals.tokens);
  assert.ok(t.byTeammate.every((r) => r.marginPct <= 100 && r.apiCostPerMTok > 0));
  assert.equal((await app.get('/api/v1/billing/tokens?period=year')).status, 400);
});

test('billing administration is owner-only', async () => {
  const { key } = (await app.send('POST', '/api/v1/admin/keys', { name: 'Reader', rateLimit: 50 })).body;
  for (const url of ['/api/v1/invoices/INV-0009', '/api/v1/settings', '/api/v1/models', '/api/v1/approvals', '/api/v1/alerts', '/api/v1/billing/tokens']) {
    assert.equal((await raw('GET', url, { headers: { Authorization: `Bearer ${key}` } })).status, 403, url);
    assert.equal((await app.get(url, { auth: false })).status, 401, url);
  }
});
