// The seed is idempotent, never overwrites, and --reset starts again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FsStore, tempDir } from './helpers.js';
import { seedFiles } from '../src/seed/index.js';
import { createPeople } from '../src/services/people.js';

test('first seed writes the people, teams, access matrix and config', async () => {
  const store = new FsStore(await tempDir());
  const written = await seedFiles(store);
  for (const f of ['people/lerato-m/PERSON.md', 'people/lerato-m/profile.md', 'teams/delivery-squad.md',
    'access/roles.yaml', 'config/hosted-apps.yaml']) assert.ok(written.includes(f), `missing ${f}`);
  const people = await createPeople({ store }).list();
  assert.deepEqual(people.map((p) => p.id), ['lerato-m', 'naledi-k', 'priya-s', 'stevie', 'thabo-n']);
  const lerato = people.find((p) => p.id === 'lerato-m');
  assert.equal(lerato.accessRole, 'Approver');
  assert.equal(lerato.workRole, 'product-manager');
  const naledi = people.find((p) => p.id === 'naledi-k');
  assert.equal(naledi.hasProfile, false);
  assert.equal(naledi.jobTitle, 'Product Manager, Digital');
});

test('seeding twice writes nothing the second time and keeps edits', async () => {
  const store = new FsStore(await tempDir());
  await seedFiles(store);
  await store.writeDoc(['people', 'lerato-m', 'PERSON.md'], { id: 'lerato-m', name: 'Lerato (edited)', email: 'lerato-m@noobly.local', accessRole: 'Approver' });
  assert.deepEqual(await seedFiles(store), []);
  assert.equal((await store.readDoc(['people', 'lerato-m', 'PERSON.md'])).data.name, 'Lerato (edited)');
});

test('--reset wipes DATA_DIR and writes the whole seed again', async () => {
  const store = new FsStore(await tempDir());
  await seedFiles(store);
  await fs.writeFile(path.join(store.root, 'stray.txt'), 'x');
  const written = await seedFiles(store, { reset: true });
  assert.ok(written.length >= 15);
  await assert.rejects(fs.access(path.join(store.root, 'stray.txt')));
});
