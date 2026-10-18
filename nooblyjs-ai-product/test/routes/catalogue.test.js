// Portfolios and products (services/catalogue.js): labels people add as they type, that the board filters by.
// Adding takes `draft`; renaming, moving and removing take `approve`. An idea sits in one product, and a new
// product name on it becomes a product. A data folder from before portfolios is filed at the next start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from '../helpers.js';

const API = '/product/api/v1';
const names = (list) => list.map((x) => x.name);

test('nothing set up yet: the catalogue says so; a portfolio and its products are added as labels, once whatever the capitals', async () => {
  const t = await startApp();
  try {
    const empty = (await t.get(`${API}/catalogue`, { as: 'priya-s' })).json;
    assert.deepEqual([empty.empty, empty.portfolios, empty.unfiled], [true, [], []]);
    assert.equal((await t.get(`${API}/board`, { as: 'priya-s' })).json.catalogue.empty, true);

    const made = await t.post(`${API}/catalogue/portfolios`, { as: 'priya-s', body: { name: '  Digital   Commerce ' } });
    assert.deepEqual([made.status, made.json.portfolio, made.json.added], [201, 'Digital Commerce', true]);
    const again = await t.post(`${API}/catalogue/portfolios`, { as: 'priya-s', body: { name: 'digital commerce' } });
    assert.deepEqual([again.status, again.json.added], [200, false]);

    for (const name of ['Registration', 'Products', 'Merchandising', 'Payments']) {
      assert.equal((await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name, portfolio: 'Digital Commerce' } })).status, 201);
    }
    // A product in a portfolio that doesn't exist yet makes the portfolio too.
    const loyalty = await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'Rewards', portfolio: 'Loyalty' } });
    assert.deepEqual([loyalty.json.product, loyalty.json.portfolio, loyalty.json.madePortfolio], ['Rewards', 'Loyalty', true]);
    const c = (await t.get(`${API}/catalogue`, { as: 'priya-s' })).json;
    assert.deepEqual(c.portfolios.map((p) => [p.name, names(p.products)]), [['Digital Commerce', ['Registration', 'Products', 'Merchandising', 'Payments']], ['Loyalty', ['Rewards']]]);
    assert.equal(c.empty, false);
    // A product sits in one portfolio.
    const clash = await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'payments', portfolio: 'Loyalty' } });
    assert.equal(clash.status, 409);
    assert.ok(t.eventLog.some((e) => e.type === 'catalogue.product_added' && e.payload.summary === 'added the product Payments to Digital Commerce'));
  } finally {
    await t.close();
  }
});

test('who may: a Viewer adds nothing; a Contributor adds; renaming, moving and removing need an Approver; names are checked', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await t.post(`${API}/catalogue/portfolios`, { as: 'naledi-k', body: { name: 'Pharmacy' } })).status, 403);
    assert.equal((await t.post(`${API}/catalogue/portfolios`, { as: 'priya-s', body: { name: 'Pharmacy' } })).status, 201);
    assert.equal((await t.patch(`${API}/catalogue/portfolios/Pharmacy`, { as: 'priya-s', body: { name: 'Health' } })).status, 403);
    assert.equal((await t.del(`${API}/catalogue/products/Payments`, { as: 'priya-s' })).status, 403);
    for (const name of ['', '   ', 'x'.repeat(41), 'A <b> label']) {
      assert.equal((await t.post(`${API}/catalogue/portfolios`, { as: 'priya-s', body: { name } })).status, 400, JSON.stringify(name));
    }
    assert.equal((await t.patch(`${API}/catalogue/portfolios/Pharmacy`, { as: 'lerato-m', body: { name: 'Health' } })).status, 200);
    assert.equal((await t.patch(`${API}/catalogue/portfolios/Health`, { as: 'lerato-m', body: { name: 'Buying' } })).status, 409);
    assert.equal((await t.patch(`${API}/catalogue/portfolios/Nope`, { as: 'lerato-m', body: { name: 'X' } })).status, 404);
  } finally {
    await t.close();
  }
});

test('renaming a product refiles everything under it; moving it changes its portfolio; one in use cannot be removed', async () => {
  const t = await startApp({ seed: true });
  try {
    const renamed = await t.patch(`${API}/catalogue/products/Delivery`, { as: 'lerato-m', body: { name: 'Delivery slots' } });
    assert.deepEqual([renamed.status, renamed.json.product, renamed.json.refiled], [200, 'Delivery slots', 5]);
    const spec = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    assert.deepEqual([spec.product, spec.portfolio, spec.valueStream], ['Delivery slots', 'Digital', 'Digital Commerce']);
    assert.equal((await t.get(`${API}/board?product=Delivery%20slots`, { as: 'lerato-m' })).json.columns.reduce((n, c) => n + c.count, 0), 5);

    // Moving to a portfolio its value stream isn't in takes it out of the value stream.
    const moved = await t.patch(`${API}/catalogue/products/Search`, { as: 'lerato-m', body: { portfolio: 'Buying' } });
    assert.deepEqual([moved.json.product, moved.json.portfolio, moved.json.valueStream, moved.json.refiled], ['Search', 'Buying', null, 0]);
    assert.equal((await t.get(`${API}/board?portfolio=Buying`, { as: 'lerato-m' })).json.columns.reduce((n, c) => n + c.count, 0), 2);
    assert.equal((await t.patch(`${API}/catalogue/products/Search`, { as: 'lerato-m', body: { portfolio: 'Nowhere' } })).status, 404);

    const inUse = await t.del(`${API}/catalogue/products/Checkout`, { as: 'lerato-m' });
    assert.deepEqual([inUse.status, inUse.json.error.details.inUse], [409, 4]);
    assert.equal((await t.del(`${API}/catalogue/products/Payments`, { as: 'lerato-m' })).status, 200);
    assert.equal((await t.del(`${API}/catalogue/portfolios/Digital`, { as: 'lerato-m' })).status, 409);
    assert.equal((await t.del(`${API}/catalogue/portfolios/Banking`, { as: 'lerato-m' })).status, 200);
  } finally {
    await t.close();
  }
});

test('an idea sits in one product; a new product name on it becomes a product; its spec sits there too', async () => {
  const t = await startApp({ seed: true });
  try {
    const made = await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'One-tap reorder', product: 'Payments' } });
    assert.deepEqual([made.status, made.json.product, made.json.portfolio, made.json.valueStream, made.json.text], [201, 'Payments', 'Digital', 'Digital Commerce', 'Payments · RICE not scored']);
    // A label typed for the first time, with the portfolio it belongs in.
    const fresh = await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'Birthday vouchers', product: 'Vouchers', portfolio: 'Loyalty' } });
    assert.deepEqual([fresh.json.product, fresh.json.portfolio], ['Vouchers', 'Loyalty']);
    const c = (await t.get(`${API}/catalogue`, { as: 'priya-s' })).json;
    assert.deepEqual(c.portfolios.find((p) => p.name === 'Loyalty').products.map((p) => [p.name, p.count]), [['Vouchers', 1]]);
    assert.equal(c.portfolios.find((p) => p.name === 'Digital').products.find((p) => p.name === 'Rewards').count, 2);
    // Refiled with an edit; an unknown field ("domain") is refused, so an old client finds out.
    const etag = (await t.get(`${API}/ideas/${fresh.json.id}`, { as: 'priya-s' })).etag;
    const moved = await t.put(`${API}/ideas/${fresh.json.id}`, { as: 'priya-s', body: { product: 'Rewards' }, headers: { 'If-Match': etag } });
    assert.deepEqual([moved.status, moved.json.product], [200, 'Rewards']);
    assert.equal((await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'x', domain: 'Checkout' } })).status, 422);
    // A spec takes its idea's product.
    const spec = await t.post(`${API}/specs`, { as: 'lerato-m', body: { title: 'One-tap reorder', idea: made.json.id } });
    assert.deepEqual([spec.status, spec.json.product, spec.json.portfolio], [201, 'Payments', 'Digital']);
  } finally {
    await t.close();
  }
});

test('a data folder from before portfolios is filed at the next start: domains become products, once', async () => {
  const old = (dir) => async () => {
    await fs.mkdir(path.join(dir, 'ideas'), { recursive: true });
    await fs.mkdir(path.join(dir, 'specs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'ideas', 'IDEA-001.md'), '---\nid: IDEA-001\ntitle: Edit order\ndomain: Checkout\nstatus: open\nsampleData: true\n---\n');
    await fs.writeFile(path.join(dir, 'ideas', 'IDEA-002.md'), '---\nid: IDEA-002\ntitle: Points\ndomain: Loyalty\nstatus: open\nsampleData: true\n---\n');
    await fs.writeFile(path.join(dir, 'specs', 'PRD-001.md'), '---\nid: PRD-001\ntitle: Refill reminders\ndomain: Pharmacy\nstatus: drafting\nversion: 1\n---\n');
  };
  let dir;
  const t = await startApp({ before: async (dataDir) => { dir = dataDir; await old(dataDir)(); } });
  try {
    const c = (await t.get(`${API}/catalogue`, { as: 'priya-s' })).json;
    // The seed story's domains go to its portfolios; a name it doesn't know is kept, in no portfolio, for a person to file.
    const digital = c.portfolios.find((p) => p.name === 'Digital');
    assert.ok(digital.products.some((p) => p.name === 'Checkout' && p.valueStream === 'Digital Commerce' && p.count === 1));
    assert.ok(digital.products.some((p) => p.name === 'Rewards' && p.valueStream === 'Rewards' && p.count === 1));
    // Each sample portfolio and value stream gets its document from its template.
    assert.equal((await t.get(`${API}/portfolios/${digital.id}`, { as: 'priya-s' })).json.version, 1);
    assert.deepEqual(c.unfiled.map((p) => [p.name, p.count]), [['Pharmacy', 1]]);
    const file = await fs.readFile(path.join(dir, 'ideas', 'IDEA-002.md'), 'utf8');
    assert.match(file, /product: Rewards/);
    assert.doesNotMatch(file, /domain:/);
    // Filing the product nobody had placed.
    const filed = await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'Pharmacy', portfolio: 'Health' } });
    assert.deepEqual([filed.status, filed.json.filed, filed.json.portfolio], [200, true, 'Health']);
    assert.deepEqual((await t.get(`${API}/catalogue`, { as: 'priya-s' })).json.unfiled, []);
  } finally {
    await t.close();
  }
});

test('where a product is built (NooblyJS Phase 11): its repositories from Platform and its Jira project; new work starts with them', async () => {
  const known = {
    'acme/nooblyjs-ai-harness': { name: 'acme/nooblyjs-ai-harness' },
    'acme/nooblyjs-core': { name: 'acme/nooblyjs-core' },
    'acme/old-thing': { name: 'acme/old-thing', gone: true },
  };
  const platform = { repository: async (ref) => known[ref] ?? Object.values(known).find((r) => r.name.endsWith(`/${ref}`)) ?? null };
  const devtools = { config: async () => ({ jira: { projects: ['DTE'] }, bitbucket: { projects: [], repositories: [] } }) };
  const t = await startApp({ services: { platform, devtools } });
  try {
    await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'NooblyJS Harness', portfolio: 'Digital Technologies' } });
    const url = `${API}/catalogue/products/${encodeURIComponent('NooblyJS Harness')}/tools`;
    assert.equal((await t.put(url, { as: 'naledi-k', body: { jiraProject: 'DTE' } })).status, 403, 'a Viewer may not');
    assert.equal((await t.put(url, { as: 'priya-s', body: { repositories: ['acme/nope'] } })).status, 422);
    assert.equal((await t.put(url, { as: 'priya-s', body: { repositories: ['acme/old-thing'] } })).json.error.code, 'repository_gone');
    assert.equal((await t.put(url, { as: 'priya-s', body: { jiraProject: 'SECRET' } })).json.error.code, 'jira_project_not_read');
    assert.equal((await t.put(url, { as: 'priya-s', body: { jiraProject: 'not a key' } })).status, 400);

    // A short name is stored by its full name; a repeat is kept once.
    const set = await t.put(url, { as: 'priya-s', body: { repositories: ['nooblyjs-ai-harness', 'acme/nooblyjs-ai-harness'], jiraProject: 'dte' } });
    assert.deepEqual([set.status, set.json.repositories, set.json.jiraProject, set.json.changed], [200, ['acme/nooblyjs-ai-harness'], 'DTE', true]);
    const product = set.json.catalogue.portfolios.find((p) => p.name === 'Digital Technologies').products[0];
    assert.deepEqual([product.repositories, product.jiraProject], [['acme/nooblyjs-ai-harness'], 'DTE']);
    assert.ok(t.eventLog.some((e) => e.type === 'catalogue.product_tools_changed' && e.payload.summary === 'set where NooblyJS Harness is built: nooblyjs-ai-harness · Jira DTE'));

    // Renaming or moving the product keeps them.
    await t.patch(`${API}/catalogue/products/${encodeURIComponent('NooblyJS Harness')}`, { as: 'lerato-m', body: { name: 'Harness' } });
    const opp = await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'Slash-command autocomplete', product: 'Harness' } });
    assert.deepEqual([opp.status, opp.json.repositories, opp.json.jiraProject], [201, ['acme/nooblyjs-ai-harness'], 'DTE']);
    // The idea's spec takes them from it; a spec in no product has none.
    const spec = await t.post(`${API}/specs`, { as: 'priya-s', body: { title: 'Slash-command autocomplete', idea: opp.json.id } });
    assert.deepEqual([spec.json.product, spec.json.repositories, spec.json.jiraProject], ['Harness', ['acme/nooblyjs-ai-harness'], 'DTE']);
    const bare = await t.post(`${API}/specs`, { as: 'priya-s', body: { title: 'Nothing filed' } });
    assert.deepEqual([bare.json.repositories, bare.json.jiraProject], [[], null]);

    // Cleared with [] and null; the work already filed keeps what it started with.
    const cleared = await t.put(`${API}/catalogue/products/Harness/tools`, { as: 'priya-s', body: { repositories: [], jiraProject: null } });
    assert.deepEqual([cleared.json.repositories, cleared.json.jiraProject], [[], null]);
    assert.deepEqual((await t.get(`${API}/ideas/${opp.json.id}`, { as: 'priya-s' })).json.repositories, ['acme/nooblyjs-ai-harness']);
  } finally {
    await t.close();
  }
});

test('a data folder from before ideas (2026-10-12): opportunities/OPP-… become ideas/IDEA-…, and what points at them follows', async () => {
  let dir;
  const t = await startApp({
    before: async (dataDir) => {
      dir = dataDir;
      for (const folder of ['opportunities', 'specs', 'signals']) await fs.mkdir(path.join(dataDir, folder), { recursive: true });
      await fs.writeFile(path.join(dataDir, 'opportunities', 'OPP-007.md'), '---\nid: OPP-007\ntitle: Edit order\nstatus: open\nversion: 1\n---\nPeople want to change an order.\n');
      await fs.writeFile(path.join(dataDir, 'specs', 'PRD-007.md'), '---\nid: PRD-007\ntitle: Edit order\nopportunity: OPP-007\nstatus: drafting\nversion: 1\n---\n');
      await fs.writeFile(path.join(dataDir, 'signals', 'sig_editorder01.md'), '---\nid: sig_editorder01\ntitle: Edit order\nstatus: opportunity\nopportunity: OPP-007\ncount: 9\n---\n');
    },
  });
  try {
    const idea = await t.get(`${API}/ideas/IDEA-007`, { as: 'priya-s' });
    assert.deepEqual([idea.status, idea.json.title, idea.json.problem], [200, 'Edit order', 'People want to change an order.']);
    assert.equal((await t.get(`${API}/specs/PRD-007`, { as: 'priya-s' })).json.idea, 'IDEA-007');
    const signal = await fs.readFile(path.join(dir, 'signals', 'sig_editorder01.md'), 'utf8');
    assert.match(signal, /status: idea/);
    assert.match(signal, /idea: IDEA-007/);
    await assert.rejects(fs.stat(path.join(dir, 'opportunities')));
    // The next idea continues the numbers.
    assert.equal((await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'Saved baskets' } })).json.id, 'IDEA-008');
  } finally {
    await t.close();
  }
});
