// Phase 16d: the application architecture of a story, drawn from the code. The code map reads modules, exports and
// imports; the reader reads a local git folder from repos.yaml; the service drafts a system's architecture as a
// teammate would with no model, a person accepts it (an agent never), an edit makes it proposed again, a commit to main
// makes it stale, and the sign-off's check and a work item's context come from it. The lifecycle and Design are
// stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mapModules, draftArchitecture, wordsOf } from '../../../src/services/engineering/code-map.js';
import { createRepoReaders } from '../../../src/services/engineering/repo-reader.js';
import { createArchitecture } from '../../../src/services/engineering/architecture.js';
import { makeRepo, commitFiles, gitIn, tmpDir } from '../../helpers.js';

const SOURCES = {
  'src/format-slot.js': 'export const formatSlot = (start, end) => `${start}–${end}`;\n',
  'src/holds.js': "import { formatSlot } from './format-slot.js';\nexport async function holdSlot(slotId, { customerId }) { return { slotId, customerId }; }\nexport class HoldStore {}\nexport { holdSlot as hold };\n",
  'test/holds.test.js': "import { holdSlot } from '../src/holds.js';\n",
};

test('the code map: each module\'s exports with their parameters, its imports, and which are tests', () => {
  const modules = mapModules(SOURCES);
  assert.deepEqual(modules.map((m) => [m.path, m.test]), [['src/format-slot.js', false], ['src/holds.js', false], ['test/holds.test.js', true]]);
  assert.deepEqual(modules[1].exports.map((e) => [e.name, e.kind, e.params.join(',')]), [['holdSlot', 'function', 'slotId,customerId'], ['HoldStore', 'class', ''], ['hold', 'value', '']]);
  assert.deepEqual(modules[1].imports, ['./format-slot.js']);
  assert.ok(wordsOf('holdSlotFor customers').has('slot'));
});

test('the scripted draft names the modules it read, the flow, the objects and a new module where the code keeps its own', () => {
  const modules = mapModules(SOURCES);
  const d = draftArchitecture({
    story: { id: 'STORY-1-1', title: 'Hold a slot while paying', criteria: ['Given a slot is held, when 15 minutes pass, then it is released'] },
    system: { name: 'slots-api' },
    interfaces: [{ id: 'IF-1-01', name: 'web → slots-api', kind: 'api', from: 'web-storefront', to: 'slots-api', contract: 'POST /holds' }],
    nfrs: [{ id: 'NFR-1-01', category: 'performance', requirement: 'Holds are fast', target: 'p95 < 200 ms' }],
    modules, files: Object.keys(SOURCES),
  });
  assert.equal(d.changes[0].path, 'src/hold-slot-paying.js', 'next to the existing source');
  assert.equal(d.changes[1].path, 'test/hold-slot-paying.test.js', 'where the repository keeps its tests');
  assert.ok(d.flow.some((f) => f === 'It uses holdSlot(slotId, customerId) from src/holds.js.'));
  assert.ok(d.flow.some((f) => /web-storefront calls it through IF-1-01 \(api\): POST \/holds/.test(f)));
  assert.deepEqual(d.objects.find((o) => o.name === 'Hold slot')?.fields, ['slotId', 'customerId']);
  assert.deepEqual(d.objects.find((o) => o.name === 'Slot')?.fields, ['start', 'end']);
  assert.ok(d.objects.some((o) => o.name === 'HoldStore' && o.kind === 'class'));
  assert.deepEqual(d.nfrs, [{ component: 'src/hold-slot-paying.js', requirement: 'Holds are fast', target: 'p95 < 200 ms', from: 'NFR-1-01' }]);
  const unread = draftArchitecture({ story: { id: 'S', title: 'x' }, system: { name: 'a' }, modules: null, unread: 'a can\'t be read here' });
  assert.equal(unread.flow[0], 'Drawn from the design alone: a can\'t be read here.');
});

/** A Factory folder whose repos.yaml names a local repository, and stand-ins for the lifecycle and Design. */
function setUp() {
  const home = tmpDir('factory-arch-');
  const repo = makeRepo({ 'format-slot.js': SOURCES['src/format-slot.js'], 'test/format-slot.test.js': "import '../format-slot.js';\n" });
  fs.writeFileSync(path.join(home, 'repos.yaml'), `web-storefront: ${repo}\n`);
  const items = new Map([['STORY-9-1', { id: 'STORY-9-1', ref: 'STORY-9-1', type: 'story', title: 'See the open slots', stage: 'engineer', status: 'active', parentId: 'PRD-009' }]]);
  const design = {
    stories: [{ id: 'STORY-9-1', title: 'See the open slots', systems: ['web-storefront', 'slots-api'], criteria: ['Given a store has open slots, when the customer looks, then they see them'], interfaces: [], technical: [], nfrs: [] }],
    systems: [{ name: 'web-storefront', repo: 'acme/web-storefront', change: 'changed' }, { name: 'slots-api', repo: 'acme/slots-api', change: 'changed' }],
    interfaces: [], technical: [], nfrs: [],
  };
  const auditLog = [];
  const eventLog = [];
  const host = {
    service: (name) => ({ workflows: { item: async ({ itemId }) => items.get(itemId) ?? null }, design: { designFor: async () => design } })[name],
    audit: { record: async (r) => void auditLog.push(r) },
    events: { emit: async (type, payload) => void eventLog.push({ type, payload }) },
  };
  const architecture = createArchitecture({ home, env: { FACTORY_HOME: home }, host });
  return { home, repo, items, architecture, auditLog, eventLog };
}
const person = { id: 'thabo-n', name: 'Thabo N.', kind: 'person' };

test('the reader reads a local repository from repos.yaml: its head, files and text; one it can\'t find is null', async () => {
  const { home, repo } = setUp();
  const read = createRepoReaders({ env: { FACTORY_HOME: home }, host: {} });
  const r = await read('acme/web-storefront');
  assert.equal(r.source, 'local');
  assert.equal(await r.head(), gitIn(repo, 'rev-parse', 'HEAD'));
  assert.deepEqual(await r.files(), ['format-slot.js', 'test/format-slot.test.js']);
  assert.match(await r.read('format-slot.js'), /formatSlot/);
  assert.equal(await r.hasCommit('0000000'), false);
  assert.equal(await read('slots-api'), null);
});

test('a draft from the code, accepted by a person; an agent is refused and audited; an edit makes it proposed again', async () => {
  const { architecture, auditLog, eventLog } = setUp();
  const v = await architecture.draft('STORY-9-1', 'web-storefront', person);
  const ws = v.systems.find((s) => s.name === 'web-storefront');
  assert.deepEqual([ws.status, ws.readAt.source, ws.modules], ['proposed', 'local', ['format-slot.js', 'test/format-slot.test.js']]);
  assert.ok(ws.flow.some((f) => /formatSlot\(start, end\) from format-slot\.js/.test(f)));
  assert.match(ws.currency.text, /^Current with main at/);
  assert.equal(v.summary.text, '0 of 2 systems accepted');
  assert.ok(eventLog.some((e) => e.type === 'engineering.architecture_drafted' && e.payload.systemName === 'web-storefront'));
  await assert.rejects(architecture.accept('STORY-9-1', 'web-storefront', { id: 'rhea-voss', name: 'Rhea Voss', kind: 'agent' }), { code: 'people_only' });
  assert.ok(auditLog.some((r) => r.actor === 'rhea-voss' && r.action === 'access.refused'));
  assert.equal((await architecture.accept('STORY-9-1', 'web-storefront', person)).systems.find((s) => s.name === 'web-storefront').status, 'accepted');
  const edited = await architecture.edit('STORY-9-1', 'web-storefront', { flow: ['One step'], changes: [{ kind: 'new', path: 'open-slots.js', what: 'the entry' }] }, person);
  const e = edited.systems.find((s) => s.name === 'web-storefront');
  assert.deepEqual([e.status, e.flow, e.changes[0].path], ['proposed', ['One step'], 'open-slots.js']);
  await assert.rejects(architecture.accept('STORY-9-1', 'web-storefront', person).then(() => architecture.draft('STORY-9-1', 'nope', person)), { status: 404 });
});

test('a repository that can\'t be read is drawn from the design; a commit to main makes a drawn one stale, and the check says so', async () => {
  const { architecture, repo } = setUp();
  await architecture.draft('STORY-9-1', 'web-storefront', person);
  const slots = (await architecture.draft('STORY-9-1', 'slots-api', person)).systems.find((s) => s.name === 'slots-api');
  assert.deepEqual([slots.readAt.source, slots.currency.stale], ['design', null]);
  assert.match(slots.flow[0], /^Drawn from the design alone/);
  await architecture.accept('STORY-9-1', 'web-storefront', person);
  await architecture.accept('STORY-9-1', 'slots-api', person);
  assert.deepEqual(await architecture.facts('STORY-9-1'), { value: true });
  commitFiles(repo, { 'CHANGELOG.md': 'x\n' }, 'moves main');
  const ws = (await architecture.view('STORY-9-1')).systems.find((s) => s.name === 'web-storefront');
  assert.equal(ws.currency.stale, true);
  assert.deepEqual(await architecture.facts('STORY-9-1'), { value: false, detail: "web-storefront's architecture is stale" });
  await assert.rejects(architecture.edit('STORY-9-1', 'web-storefront', { flow: ['x'] }, person).then(() => architecture.accept('STORY-9-1', 'web-storefront', person)), { code: 'stale' });
  // A work item on web-storefront carries it.
  const lines = await architecture.contextFor('STORY-9-1', 'acme/web-storefront');
  assert.match(lines[0], /^## Application architecture of web-storefront \(proposed, read at [0-9a-f]{7}\)$/);
  assert.deepEqual(await architecture.contextFor('STORY-9-1', 'mobile-app'), []);
});

test('outside Engineer the architecture is read only', async () => {
  const { architecture, items } = setUp();
  items.get('STORY-9-1').stage = 'build';
  await assert.rejects(architecture.draft('STORY-9-1', 'web-storefront', person), { code: 'wrong_stage' });
  assert.equal((await architecture.view('STORY-9-1')).writable, false);
});
