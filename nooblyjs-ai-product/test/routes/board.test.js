// The Product board against the seeded PRD-031 story (product.md §5.1). The numbers are the mockup's sample data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from '../helpers.js';

let t;
before(async () => {
  t = await startApp({ seed: true });
});
after(() => t.close());

const column = (board, key) => board.columns.find((c) => c.key === key);
const titles = (board, key) => column(board, key).cards.map((c) => c.title);

test('the board has the five columns with the seeded counts', async () => {
  const { status, json: board } = await t.get('/product/api/v1/board', { as: 'lerato-m' });
  assert.equal(status, 200);
  assert.deepEqual(board.columns.map((c) => [c.label, c.count]), [
    ['Signals', 4], ['Ideas', 3], ['Spec drafting', 2], ['In review', 2], ['To architecture', 2],
  ]);
  assert.deepEqual(titles(board, 'signals'), ['Slots sell out before 10:00', 'Substitutions feel random', "Can't edit order after checkout", 'Promo codes fail on mobile']);
  assert.deepEqual(titles(board, 'in-review'), ['Same-day delivery slots', 'Checkout accessibility']);
  assert.deepEqual(titles(board, 'to-architecture'), ['Live order tracking map', 'Store pickup lockers']);
});

test('cards say their status in words', async () => {
  const { json: board } = await t.get('/product/api/v1/board', { as: 'lerato-m' });
  const text = (key) => column(board, key).cards.map((c) => c.text ?? c.statusText);
  assert.deepEqual(text('signals'), ['412 tickets · Zendesk', '188 app reviews', '96 tickets · Zendesk', '54 tickets · App logs']);
  assert.deepEqual(text('ideas'), ['Delivery · RICE 42', 'Checkout · RICE 38', 'Search · RICE 27']);
  assert.deepEqual(text('spec-drafting'), ['Ada Quill drafting · 64%', 'Awaiting your brief']);
  // Lerato is the waiting reviewer of PRD-029, and has already approved PRD-031.
  assert.deepEqual(text('in-review'), ['1 of 2 reviewers approved', 'Needs your approval']);
  assert.deepEqual(text('to-architecture'), ['Approved', 'Approved']);
  assert.equal(column(board, 'spec-drafting').cards[0].progress, 64);
});

test('"Needs your approval" depends on who asks', async () => {
  const { json: board } = await t.get('/product/api/v1/board', { as: 'stevie' });
  assert.deepEqual(column(board, 'in-review').cards.map((c) => c.statusText), ['Needs your approval', '2 of 3 reviewers approved']);
});

test('filters carry counts over the whole board', async () => {
  const { json: board } = await t.get('/product/api/v1/board', { as: 'lerato-m' });
  assert.deepEqual(board.filters.map((f) => [f.label, f.count]), [['All', 13], ['Mine', 5]]);
  assert.equal(board.filters[0].active, true);
  // A label per portfolio, with what sits in its products; its value streams and products show once it is chosen.
  assert.deepEqual(board.portfolios.map((p) => [p.name, p.count, p.active]), [['Digital', 13, false], ['Buying', 0, false], ['Banking', 0, false]]);
  assert.deepEqual([board.valueStreams, board.products], [[], []]);
  assert.equal(board.catalogue.empty, false);
});

test('filtering by portfolio, by product and by mine narrows the columns', async () => {
  const digital = (await t.get('/product/api/v1/board?portfolio=digital', { as: 'lerato-m' })).json;
  assert.equal(digital.columns.reduce((n, c) => n + c.count, 0), 13);
  assert.equal(digital.portfolios.find((p) => p.name === 'Digital').active, true);
  // Its value streams and products, each with its count, to narrow further.
  assert.deepEqual(digital.valueStreams.map((v) => [v.name, v.count]), [['Digital Commerce', 11], ['Media and Advertising', 0], ['Rewards', 2], ['Data Monetisation', 0]]);
  assert.deepEqual(digital.products.filter((p) => p.count).map((p) => [p.name, p.count]), [['Checkout', 4], ['Delivery', 5], ['Search', 2], ['Rewards', 2]]);

  // A value stream narrows the board and the products to its own; it names its portfolio.
  const commerce = (await t.get('/product/api/v1/board?valueStream=digital%20commerce', { as: 'lerato-m' })).json;
  assert.equal(commerce.columns.reduce((n, c) => n + c.count, 0), 11);
  assert.deepEqual([commerce.filter.portfolio, commerce.filter.valueStream], ['Digital', 'Digital Commerce']);
  assert.deepEqual(commerce.products.map((p) => p.name), ['Registration', 'Products', 'Merchandising', 'Payments', 'Checkout', 'Delivery', 'Search']);
  assert.equal(commerce.valueStreams.find((v) => v.name === 'Digital Commerce').active, true);

  // A product names its portfolio, so the product alone is enough.
  const delivery = (await t.get('/product/api/v1/board?product=delivery', { as: 'lerato-m' })).json;
  assert.deepEqual(delivery.columns.map((c) => c.count), [1, 1, 0, 1, 2]);
  assert.deepEqual(delivery.filter, { portfolio: 'Digital', valueStream: 'Digital Commerce', product: 'Delivery', mine: false });
  assert.equal(delivery.products.find((p) => p.name === 'Delivery').active, true);
  assert.equal(delivery.filters.find((f) => f.label === 'All').count, 13);
  assert.equal((await t.get('/product/api/v1/board?valueStream=Rewards', { as: 'lerato-m' })).json.columns.reduce((n, c) => n + c.count, 0), 2);
  assert.equal((await t.get('/product/api/v1/board?portfolio=Buying', { as: 'lerato-m' })).json.columns.reduce((n, c) => n + c.count, 0), 0);

  const mine = (await t.get('/product/api/v1/board?mine=true', { as: 'lerato-m' })).json;
  assert.equal(mine.columns.reduce((n, c) => n + c.count, 0), 5);
  assert.equal(column(mine, 'signals').count, 0);

  const nothing = (await t.get('/product/api/v1/board?product=Pharmacy', { as: 'lerato-m' })).json;
  assert.equal(nothing.columns.reduce((n, c) => n + c.count, 0), 0);
});

test('every card gives its stage in both numberings', async () => {
  const { json: board } = await t.get('/product/api/v1/board', { as: 'lerato-m' });
  const signal = column(board, 'signals').cards[0];
  const review = column(board, 'in-review').cards[0];
  const approved = column(board, 'to-architecture').cards[0];
  assert.deepEqual([signal.stage.factory.number, signal.stage.lifecycle.label], [1, 'Discover']);
  assert.deepEqual([review.stage.factory.number, review.stage.lifecycle.label], [1, 'Specify']);
  assert.deepEqual([approved.stage.factory.label, approved.stage.lifecycle.number], ['Architecture', 3]);
});

test('top signals this week, from six Knowledge sources', async () => {
  const { json: board } = await t.get('/product/api/v1/board', { as: 'naledi-k' });
  assert.equal(board.topSignals.text, 'from Knowledge · 6 sources');
  assert.deepEqual(board.topSignals.items.map((i) => [i.theme, i.count]), [
    ['slot availability', 412], ['substitution quality', 188], ['order editing', 96], ['promo codes on mobile', 54],
  ]);
});

test('the board carries the Now timeline (roadmap.yaml moved onto the specs, Phase 25b), and GET /roadmap has them in Now', async () => {
  const { json: board } = await t.get('/product/api/v1/board', { as: 'naledi-k' });
  assert.equal(board.roadmap.quarter, 'Now');
  const prd031 = board.roadmap.items.find((i) => i.id === 'PRD-031');
  assert.equal(prd031.title, 'Same-day delivery slots');
  assert.equal(prd031.current.key, 'product');
  assert.deepEqual(prd031.spans.map((s) => s.label), ['Product', 'Architecture', 'UX design', 'UI design', 'Software Factory']);
  assert.equal(prd031.spans.find((s) => s.current).stage, 'product');

  const { json: roadmap } = await t.get('/product/api/v1/roadmap', { as: 'naledi-k' });
  const now = roadmap.lanes.flatMap((l) => l.columns.now.map((i) => i.id)).sort();
  assert.deepEqual(now, board.roadmap.items.map((i) => i.id).sort());
  // The file is gone, kept as roadmap.yaml.moved.
  assert.equal(await fs.stat(path.join(t.dataDir, 'roadmap.yaml')).catch(() => null), null);
  assert.ok(await fs.stat(path.join(t.dataDir, 'roadmap.yaml.moved')));
});

test('signals and ideas have their own lists', async () => {
  const signals = (await t.get('/product/api/v1/signals', { as: 'naledi-k' })).json.signals;
  assert.equal(signals.length, 4);
  assert.equal(signals[0].count, 412);

  const opps = (await t.get('/product/api/v1/ideas', { as: 'naledi-k' })).json.ideas;
  assert.deepEqual(opps.map((o) => [o.id, o.rice.score]), [['IDEA-018', 42], ['IDEA-019', 38], ['IDEA-020', 27]]);

  const one = await t.get('/product/api/v1/ideas/IDEA-018', { as: 'naledi-k' });
  assert.equal(one.json.owner.name, 'Lerato M.');
  assert.equal((await t.get('/product/api/v1/ideas/IDEA-999', { as: 'naledi-k' })).status, 404);
  assert.equal((await t.get('/product/api/v1/ideas/..%2Fseed', { as: 'naledi-k' })).status, 404);
});

test('a file someone broke by hand is skipped, not fatal', async () => {
  const broken = path.join(t.dataDir, 'signals', 'sig_brokenbyhand.md');
  await fs.writeFile(broken, '---\nid: [unclosed\n---\n');
  try {
    const res = await t.get('/product/api/v1/board', { as: 'lerato-m' });
    assert.equal(res.status, 200);
    assert.equal(column(res.json, 'signals').count, 4);
    assert.ok(t.serverManager.lines.some((l) => l.level === 'warn' && l.message.includes('sig_brokenbyhand.md')));
  } finally {
    await fs.rm(broken);
  }
});

test('reading the board needs only the read permission', async () => {
  assert.equal((await t.get('/product/api/v1/board', { as: 'naledi-k' })).status, 200);
  assert.equal((await t.get('/product/api/v1/board')).status, 401);
});
