// Starting from scratch (npm run seed:blank): a data folder with the system files and NO sample content. NooblyJS and
// every hosted app start on it, every main page answers with nothing in it, and it stays blank.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createApp } from '../app.js';
import { testConfig, client } from './helpers.js';
import { seedFiles, seedMissing, isBlank } from '../src/seed/index.js';

const { FsStore } = createRequire(import.meta.url)('nooblyjs-core/src/store/fs-store.js');
const SAMPLE = /PRD-0\d\d|IDEA-0\d\d|INF-0\d\d|delivery-squad|lerato|thabo|Juno Park|Otis Fern|web-storefront|sampleData: true|sampleHistory/i;

/** Every file under a folder, with its text. */
async function filesOf(dir, rel = '') {
  const out = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await filesOf(dir, next));
    else out.push(next);
  }
  return out;
}

let dataDir;
let noobly;
let server;
let stevie;
before(async () => {
  dataDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-blank-')), 'data');
  // The script itself, as a person runs it.
  const out = execFileSync(process.execPath, ['scripts/seed.js', '--blank', '--owner', 'stevie@example.com', '--name', 'Stevie B'], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });
  assert.match(out, /system files, no sample content/);
  assert.match(out, /First Owner: Stevie B <stevie@example\.com>/);
  await new FsStore(dataDir).writeYaml(['config', 'hosted-apps.yaml'], { apps: [
    { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
    { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true },
    { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
    { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true },
    { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
  ] });
  noobly = await createApp({ config: testConfig(dataDir) });
  server = noobly.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  stevie = client(`http://127.0.0.1:${server.address().port}`);
  await stevie.signIn('stevie');
});
after(async () => {
  server?.closeAllConnections?.();
  await new Promise((resolve) => server?.close(resolve));
  await noobly?.close();
  await fs.rm(path.dirname(dataDir), { recursive: true, force: true }).catch(() => {});
});

test('the blank folder has the system files and one person: the Owner the script was given', async () => {
  const store = new FsStore(dataDir);
  assert.equal(await isBlank(store), true);
  const people = (await stevie.json('/api/v1/platform/members')).body;
  assert.deepEqual(people.members.filter((m) => m.kind === 'person').map((m) => [m.id, m.accessRole]), [['stevie', 'Owner']]);
  assert.equal(people.members.filter((m) => m.kind === 'agent').length, 0, 'no agent teammate is hired');
  // What is there: who may do what, the rules, the budgets and guardrails.
  const roles = await store.readYaml(['access', 'roles.yaml']);
  assert.deepEqual(roles.roles, ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner']);
  const settings = (await stevie.json('/api/v1/platform/settings')).body;
  assert.ok(settings.models.routes.length > 0 && settings.guardrails.length > 0 && settings.budgets.systems.length > 0);
  // Lifecycle v3 (Phase 16b): seven rules in the seed (spec, adr, design-handoff, engineering-signoff, build-approval,
  // test-approval, deploy) and five built in (infra-design, devtools-write, outcome-review, threat-model,
  // risk-acceptance); the retired release candidate is not listed.
  assert.equal((await stevie.json('/workflows/api/v1/rules')).body.rules.length, 13); // 13 since accepting an idea (Phase 17)
});

test('every main page answers, with nothing in it', async () => {
  const empty = {
    '/workflows/api/v1/items': (b) => (b.items ?? b.rows ?? []).length,
    '/workflows/api/v1/approvals': (b) => (b.rows ?? b.approvals ?? []).length,
    '/product/api/v1/ideas': (b) => (b.ideas ?? b.rows ?? []).length,
    '/product/api/v1/specs': (b) => (b.specs ?? b.rows ?? []).length,
    '/teammates/api/v1/teammates': (b) => b.teammates.length,
    '/factory/api/v1/runs': (b) => (b.runs ?? b).length,
    '/infrastructure/api/v1/designs': (b) => (b.designs ?? b.rows ?? []).length,
    '/infrastructure/api/v1/environments': (b) => (b.environments ?? b.rows ?? []).length,
    '/api/v1/platform/secrets': (b) => (b.secrets ?? b.rows ?? []).length,
  };
  for (const [url, count] of Object.entries(empty)) {
    const { status, body } = await stevie.json(url);
    assert.equal(status, 200, url);
    assert.equal(count(body), 0, `${url} is not empty`);
  }
  for (const url of ['/api/v1/shell', '/api/v1/home/overview', '/api/v1/home/for-you', '/api/v1/activity', '/api/v1/home/metrics', '/api/v1/home/teams', '/api/v1/platform/containers', '/api/v1/platform/repositories', '/product/api/v1/board', '/product/api/v1/catalogue', '/factory/api/v1/status']) {
    const res = await stevie.request(url);
    const text = await res.text();
    assert.equal(res.status, 200, url);
    assert.doesNotMatch(text, SAMPLE, `${url} shows sample content`);
  }
  const overview = (await stevie.json('/api/v1/home/overview')).body;
  assert.equal(overview.lifecycle.inFlight, 0);
  const metrics = (await stevie.json('/api/v1/home/metrics')).body;
  assert.equal(metrics.tiles.prsMerged.count, 0);
  assert.deepEqual((await stevie.json('/api/v1/platform/containers')).body.images.list, [], 'no made-up base images');
});

test('nothing on disk is sample content, and each app wrote only its system files', async () => {
  const files = await filesOf(dataDir);
  for (const f of files.filter((x) => /\.(md|ya?ml)$/.test(x))) {
    // The onboarding copy names example agents by role; that is copy, not data (see the roadmap's "no mocks" phase).
    if (f === 'config/work-roles.yaml') continue;
    // Comments are not data (a system file may say where its starting values came from).
    const data = (await fs.readFile(path.join(dataDir, f), 'utf8')).split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join(' ');
    assert.doesNotMatch(data, SAMPLE, `${f} holds sample content`);
  }
  const top = (dir) => files.filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1).split('/')[0]);
  assert.deepEqual([...new Set(top('workflows'))].sort(), ['approval-rules.yaml', 'readiness.yaml', 'seed.yaml']);
  // Product and Design are apps of their own (CHG-009), each in its own folder: system files only.
  assert.deepEqual([...new Set(top('product'))].sort(), ['accessibility.yaml', 'budget.yaml', 'catalogue.yaml', 'seed.yaml', 'standards.yaml', 'templates']);
  assert.ok(top('design').includes('nfr-catalogue.yaml') && !top('design').includes('items'), 'Design wrote its catalogue, and no design');
  // Infrastructure is an app of its own (CHG-007), in its own folder: system files only.
  assert.ok(top('infrastructure').includes('seed.yaml'), 'Infrastructure wrote its system files');
  assert.ok(!top('infrastructure').some((n) => ['designs', 'environments', 'runs', 'drift', 'cost'].includes(n)));
  const folders = new Set(files.map((f) => f.split('/')[0]));
  assert.ok(folders.has('factory') && !['infrastructure', 'product', 'design'].some((n) => top('factory').includes(n)), 'nothing in the old folders');
  assert.ok(!top('teammates').includes('teammates') || !(await filesOf(path.join(dataDir, 'teammates', 'teammates'))).length, 'nobody is hired');
  assert.ok(top('teammates').includes('skills'), 'the skills library is there');
  assert.ok(!top('factory').includes('repos'), 'no demo repository');
  assert.ok(!files.some((f) => f.startsWith('events/') && /sampleHistory/.test(f)));
  assert.ok(!files.some((f) => f.startsWith('platform/spend/')), 'no sample spend');
  assert.ok(!files.some((f) => f.startsWith('metrics/')), 'no sample metrics history');
});

test('a blank folder stays blank on a later start, and work done in it is real', async () => {
  const store = new FsStore(dataDir);
  const added = await seedMissing(store);
  assert.ok(!added.some((f) => /^(events|metrics|people|teams|platform\/(spend|repositories))/.test(f)), `a later start added ${added.join(', ')}`);
  assert.equal(await isBlank(store), true);
  // The first real thing: a team, made by the Owner.
  const before = (await stevie.json('/api/v1/home/teams')).body;
  assert.equal((before.teams ?? []).length, 0);
});

test('the script never deletes: a folder with something in it is refused, and --reset moves it aside', async () => {
  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-blank2-')), 'data');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'mine.md'), 'keep me');
  const run = (...args) => execFileSync(process.execPath, ['scripts/seed.js', '--blank', ...args], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.throws(() => run(), /is not empty/);
  assert.equal(await fs.readFile(path.join(dir, 'mine.md'), 'utf8'), 'keep me');
  const out = run('--reset');
  const aside = /Moved what was there to (.+)\./.exec(out)?.[1];
  assert.ok(aside, out);
  assert.equal(await fs.readFile(path.join(aside.trim(), 'mine.md'), 'utf8'), 'keep me', 'the old folder is whole, next to the new one');
  assert.equal(await isBlank(new FsStore(dir)), true);
  assert.ok(!(await filesOf(dir)).includes('mine.md'));
  // The full seed is unchanged: seedFiles() with no option still writes the sample story.
  const full = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-full-')), 'data');
  await fs.mkdir(full, { recursive: true });
  const written = await seedFiles(new FsStore(full));
  assert.ok(written.includes('people/stevie/PERSON.md') && written.some((f) => f.startsWith('events/')));
  assert.equal(await isBlank(new FsStore(full)), false);
});
