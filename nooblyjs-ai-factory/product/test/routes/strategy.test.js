// Strategic themes, portfolios and value streams (product.md §4, §5.7, §5.8): themes sit above portfolios; a portfolio
// has none or many value streams; each portfolio and value stream has a Markdown document made from its template,
// and the templates are changed in Settings by an Approver (a person, never an agent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from '../helpers.js';
import { PEOPLE } from '../fixtures/host.js';

const API = '/product/api/v1';
const enc = encodeURIComponent;

test('strategic themes: a Contributor adds one; an Approver links portfolios to it; a rename follows; one in use stays', async () => {
  const t = await startApp({ seed: true });
  try {
    const c = (await t.get(`${API}/catalogue`, { as: 'naledi-k' })).json;
    assert.deepEqual(c.themes.map((x) => [x.name, x.portfolios]), [['Solve the every day', ['Digital']], ['Leverage AI', ['Digital']]]);
    assert.deepEqual(c.portfolios.find((p) => p.name === 'Digital').themes, ['Solve the every day', 'Leverage AI']);

    assert.equal((await t.post(`${API}/catalogue/themes`, { as: 'naledi-k', body: { name: 'Grow banking' } })).status, 403);
    const made = await t.post(`${API}/catalogue/themes`, { as: 'priya-s', body: { name: ' Grow   banking ', description: 'More customers bank with us.' } });
    assert.deepEqual([made.status, made.json.theme, made.json.added], [201, 'Grow banking', true]);
    assert.equal((await t.post(`${API}/catalogue/themes`, { as: 'priya-s', body: { name: 'grow banking' } })).json.added, false);

    // Linking a portfolio to its themes is an Approver's; each theme must exist.
    const url = `${API}/catalogue/portfolios/Banking`;
    assert.equal((await t.patch(url, { as: 'priya-s', body: { themes: ['Grow banking'] } })).status, 403);
    assert.equal((await t.patch(url, { as: 'lerato-m', body: { themes: ['World peace'] } })).status, 404);
    const linked = await t.patch(url, { as: 'lerato-m', body: { themes: ['grow banking', 'Solve the every day', 'Grow banking'] } });
    assert.deepEqual([linked.status, linked.json.themes], [200, ['Grow banking', 'Solve the every day']]);
    assert.ok(t.eventLog.some((e) => e.type === 'catalogue.portfolio_themes_changed' && e.payload.summary === 'linked Banking to Grow banking, Solve the every day'));

    // A rename follows into every portfolio linked to it; a description can be cleared.
    const renamed = await t.patch(`${API}/catalogue/themes/${enc('Grow banking')}`, { as: 'lerato-m', body: { name: 'Bank everyone', description: null } });
    assert.deepEqual([renamed.json.theme, renamed.json.description], ['Bank everyone', null]);
    assert.deepEqual(renamed.json.catalogue.portfolios.find((p) => p.name === 'Banking').themes, ['Bank everyone', 'Solve the every day']);

    // A theme a portfolio works towards isn't removed; unlink it first.
    const inUse = await t.del(`${API}/catalogue/themes/${enc('Bank everyone')}`, { as: 'lerato-m' });
    assert.deepEqual([inUse.status, inUse.json.error.details.portfolios], [409, ['Banking']]);
    await t.patch(url, { as: 'lerato-m', body: { themes: [] } });
    assert.equal((await t.del(`${API}/catalogue/themes/${enc('Bank everyone')}`, { as: 'lerato-m' })).status, 200);
  } finally {
    await t.close();
  }
});

test('value streams sit in one portfolio, each with a document from its template; products can sit in one', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await t.post(`${API}/catalogue/value-streams`, { as: 'priya-s', body: { name: 'Lending' } })).status, 400, 'a portfolio is needed');
    const made = await t.post(`${API}/catalogue/value-streams`, { as: 'priya-s', body: { name: 'Lending', portfolio: 'Banking' } });
    assert.deepEqual([made.status, made.json.valueStream, made.json.portfolio, made.json.added], [201, 'Lending', 'Banking', true]);
    assert.match(made.json.id, /^vs_/);
    assert.equal((await t.post(`${API}/catalogue/value-streams`, { as: 'priya-s', body: { name: 'lending', portfolio: 'Digital' } })).status, 409);

    // Its document is Markdown made from the value stream template: its headings, empty.
    const file = await fs.readFile(path.join(t.dataDir, 'value-streams', `${made.json.id}.md`), 'utf8');
    assert.match(file, /name: Lending/);
    assert.match(file, /## Value Stream Vision\n\n## Customer Segments/);
    assert.match(file, /## Attachments/);

    // A product in a value stream: the value stream names its portfolio; a value stream in another one is refused.
    const loans = await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'Personal loans', valueStream: 'Lending' } });
    assert.deepEqual([loans.status, loans.json.portfolio, loans.json.valueStream], [201, 'Banking', 'Lending']);
    assert.equal((await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'Card', portfolio: 'Digital', valueStream: 'Lending' } })).status, 409);
    assert.equal((await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'Card', valueStream: 'Nowhere' } })).status, 404);
    // An Approver moves a product into a value stream, and out of it.
    const into = await t.patch(`${API}/catalogue/products/Payments`, { as: 'lerato-m', body: { valueStream: 'Lending' } });
    assert.deepEqual([into.json.portfolio, into.json.valueStream], ['Banking', 'Lending']);
    const out = await t.patch(`${API}/catalogue/products/Payments`, { as: 'lerato-m', body: { valueStream: null } });
    assert.deepEqual([out.json.portfolio, out.json.valueStream], ['Banking', null]);

    // Renaming a value stream: its products and its document follow. Moving it takes its products along.
    assert.equal((await t.patch(`${API}/catalogue/value-streams/Lending`, { as: 'priya-s', body: { name: 'Loans' } })).status, 403);
    await t.patch(`${API}/catalogue/value-streams/Lending`, { as: 'lerato-m', body: { name: 'Loans' } });
    const moved = await t.patch(`${API}/catalogue/value-streams/Loans`, { as: 'lerato-m', body: { portfolio: 'Buying' } });
    assert.deepEqual([moved.json.portfolio, moved.json.products], ['Buying', 1]);
    const product = moved.json.catalogue.portfolios.find((p) => p.name === 'Buying').products[0];
    assert.deepEqual([product.name, product.valueStream], ['Personal loans', 'Loans']);
    const doc = (await t.get(`${API}/value-streams/${made.json.id}`, { as: 'naledi-k' })).json;
    assert.deepEqual([doc.name, doc.portfolio, doc.products], ['Loans', 'Buying', ['Personal loans']]);

    // One with products isn't removed; once empty, it and its document go.
    assert.equal((await t.del(`${API}/catalogue/value-streams/Loans`, { as: 'lerato-m' })).status, 409);
    assert.equal((await t.del(`${API}/catalogue/portfolios/Buying`, { as: 'lerato-m' })).status, 409);
    await t.patch(`${API}/catalogue/products/${enc('Personal loans')}`, { as: 'lerato-m', body: { valueStream: null } });
    assert.equal((await t.del(`${API}/catalogue/value-streams/Loans`, { as: 'lerato-m' })).status, 200);
    await assert.rejects(fs.stat(path.join(t.dataDir, 'value-streams', `${made.json.id}.md`)));
    assert.equal((await t.get(`${API}/value-streams/${made.json.id}`, { as: 'naledi-k' })).status, 404);
  } finally {
    await t.close();
  }
});

test('a portfolio\'s document: the template\'s sections with their hints, saved with If-Match by anyone who may draft', async () => {
  const t = await startApp({ seed: true });
  try {
    const got = await t.get(`${API}/portfolios/pfl_digital`, { as: 'naledi-k' });
    assert.equal(got.status, 200);
    const doc = got.json;
    assert.deepEqual(doc.sections.map((s) => s.heading), ['Key Partners', 'Key Activities', 'Key Resources', 'Cost Structure', 'Revenue Streams']);
    assert.ok(doc.sections.every((s) => s.hint && s.text === '' && s.inTemplate));
    assert.deepEqual([doc.name, doc.version, doc.etag, got.etag], ['Digital', 1, '"pfl_digital@1"', '"pfl_digital@1"']);
    assert.deepEqual(doc.themes.map((x) => x.name), ['Solve the every day', 'Leverage AI']);
    assert.deepEqual(doc.valueStreams.map((v) => [v.name, v.text]), [['Digital Commerce', '7 products'], ['Media and Advertising', '0 products'], ['Rewards', '1 product'], ['Data Monetisation', '0 products']]);

    const url = `${API}/portfolios/pfl_digital`;
    const body = { sections: [{ heading: 'key partners', text: 'Payment providers\n## Banks' }] };
    assert.equal((await t.put(url, { as: 'naledi-k', body, headers: { 'If-Match': doc.etag } })).status, 403);
    assert.equal((await t.put(url, { as: 'priya-s', body })).status, 428);
    assert.equal((await t.put(url, { as: 'priya-s', body: { sections: [{ heading: 'Mission', text: 'x' }] }, headers: { 'If-Match': doc.etag } })).status, 422);
    const saved = await t.put(url, { as: 'priya-s', body, headers: { 'If-Match': doc.etag } });
    assert.equal(saved.status, 200);
    assert.deepEqual([saved.json.version, saved.json.updatedBy.name, saved.json.filled], [2, 'Priya S.', 1]);
    // A "## " line inside a section stays inside it.
    assert.equal(saved.json.sections[0].text, 'Payment providers\n### Banks');
    assert.equal((await t.put(url, { as: 'priya-s', body, headers: { 'If-Match': doc.etag } })).status, 409, 'an old version is refused');
    assert.ok(t.eventLog.some((e) => e.type === 'portfolio.updated' && e.payload.summary === 'updated the portfolio Digital (version 2)'));
    assert.ok(t.auditLog.some((r) => r.target === 'PUT /product/api/v1/portfolios/pfl_digital'));

    // A new portfolio gets its document at once; a rename follows into it.
    const added = await t.post(`${API}/catalogue/portfolios`, { as: 'priya-s', body: { name: 'Pharmacy' } });
    const id = added.json.catalogue.portfolios.find((p) => p.name === 'Pharmacy').id;
    assert.equal((await t.get(`${API}/portfolios/${id}`, { as: 'priya-s' })).json.version, 1);
    await t.patch(`${API}/catalogue/portfolios/Pharmacy`, { as: 'lerato-m', body: { name: 'Health' } });
    assert.match(await fs.readFile(path.join(t.dataDir, 'portfolios', `${id}.md`), 'utf8'), /name: Health/);
    assert.equal((await t.get(`${API}/portfolios/pfl_nothere`, { as: 'priya-s' })).status, 404);
  } finally {
    await t.close();
  }
});

test('templates: anyone reads them; an Approver changes one; documents show the new sections and keep their text', async () => {
  const promoted = PEOPLE.map((p) => (p.id === 'ada-quill' ? { ...p, accessRole: 'Approver' } : p));
  const t = await startApp({ seed: true, people: promoted });
  try {
    const { templates } = (await t.get(`${API}/settings/templates`, { as: 'naledi-k' })).json;
    assert.deepEqual(templates.map((x) => [x.kind, x.version, x.sections.length]), [['portfolio', 1, 5], ['value-stream', 1, 10]]);
    assert.deepEqual(templates[1].sections.map((s) => s.heading), ['Description', 'Value Stream Vision', 'Customer Segments', 'Channels', 'Customer Relationship', 'KPIs or Revenue', 'Solution Context', 'Economic Framework', 'People and Locations', 'Attachments']);

    // Fill in a section the template will lose.
    const doc = (await t.get(`${API}/portfolios/pfl_digital`, { as: 'priya-s' })).json;
    await t.put(`${API}/portfolios/pfl_digital`, { as: 'priya-s', body: { sections: [{ heading: 'Revenue Streams', text: 'Basket margin' }] }, headers: { 'If-Match': doc.etag } });

    const url = `${API}/settings/templates/portfolio`;
    const next = '## Key Partners\n\nWho we work with.\n\n## Customer Segments\n\nWho the portfolio serves.';
    const etag = templates[0].etag;
    assert.equal((await t.put(url, { as: 'priya-s', body: { body: next }, headers: { 'If-Match': etag } })).status, 403);
    const agent = await t.put(url, { as: 'ada-quill', body: { body: next }, headers: { 'If-Match': etag } });
    assert.deepEqual([agent.status, agent.json.error.code], [403, 'people_only']);
    for (const bad of ['No heading here', '## A\n\n## a', '']) {
      assert.equal((await t.put(url, { as: 'lerato-m', body: { body: bad }, headers: { 'If-Match': etag } })).status, 422, JSON.stringify(bad));
    }
    assert.equal((await t.put(url, { as: 'lerato-m', body: { body: next } })).status, 428);
    const saved = await t.put(url, { as: 'lerato-m', body: { body: next }, headers: { 'If-Match': etag } });
    assert.deepEqual([saved.status, saved.json.version, saved.json.updatedBy, saved.json.sections.map((s) => s.heading)], [200, 2, 'Lerato M.', ['Key Partners', 'Customer Segments']]);
    assert.equal((await t.put(url, { as: 'lerato-m', body: { body: next }, headers: { 'If-Match': etag } })).status, 409);
    assert.ok(t.eventLog.some((e) => e.type === 'settings.template_updated' && e.payload.version === 2));

    // An existing document shows the new section empty, and keeps its text in the one the template lost.
    const after = (await t.get(`${API}/portfolios/pfl_digital`, { as: 'priya-s' })).json;
    assert.deepEqual(after.sections.map((s) => [s.heading, s.inTemplate, s.text]), [['Key Partners', true, ''], ['Customer Segments', true, ''], ['Revenue Streams', false, 'Basket margin']]);
    assert.deepEqual([after.template.version, after.template.madeFrom], [2, 1]);
    // Emptying a section the template no longer has drops it.
    const dropped = await t.put(`${API}/portfolios/pfl_digital`, { as: 'priya-s', body: { sections: [{ heading: 'Revenue Streams', text: '' }] }, headers: { 'If-Match': after.etag } });
    assert.deepEqual(dropped.json.sections.map((s) => s.heading), ['Key Partners', 'Customer Segments']);

    // A new portfolio starts from the new template.
    const added = await t.post(`${API}/catalogue/portfolios`, { as: 'priya-s', body: { name: 'Pharmacy' } });
    const id = added.json.catalogue.portfolios.find((p) => p.name === 'Pharmacy').id;
    const file = await fs.readFile(path.join(t.dataDir, 'portfolios', `${id}.md`), 'utf8');
    assert.match(file, /template: 2/);
    assert.match(file, /## Key Partners\n\n## Customer Segments\n/);
    assert.equal((await t.get(`${API}/settings/templates/nope`, { as: 'priya-s' })).status, 404);
  } finally {
    await t.close();
  }
});

test('a blank NooblyJS gets the templates and an empty catalogue; a folder from before documents gets ids and documents', async () => {
  const blank = await startApp();
  try {
    await blank.hosted.seed({ reset: true, content: false });
    assert.match(await fs.readFile(path.join(blank.dataDir, 'templates', 'value-stream.md'), 'utf8'), /## Economic Framework/);
    const c = (await blank.get(`${API}/catalogue`, { as: 'priya-s' })).json;
    assert.deepEqual([c.empty, c.themes, c.portfolios], [true, [], []]);
  } finally {
    await blank.close();
  }

  // A catalogue.yaml with portfolios and value streams but no ids or documents (written before them).
  const t = await startApp({
    before: async (dir) => fs.writeFile(path.join(dir, 'catalogue.yaml'), 'portfolios:\n  - { name: Digital }\nvalueStreams:\n  - { name: Rewards, portfolio: Digital }\nproducts: []\n'),
  });
  try {
    const c = (await t.get(`${API}/catalogue`, { as: 'priya-s' })).json;
    const digital = c.portfolios[0];
    assert.match(digital.id, /^pfl_/);
    assert.match(digital.valueStreams[0].id, /^vs_/);
    const doc = (await t.get(`${API}/value-streams/${digital.valueStreams[0].id}`, { as: 'priya-s' })).json;
    assert.deepEqual([doc.version, doc.sections.length, doc.portfolio], [1, 10, 'Digital']);
  } finally {
    await t.close();
  }
});
