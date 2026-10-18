// models/memory.js: the memory cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { FsStore } from '../../src/models/fs-store.js';
import { MemoryRepo } from '../../src/models/memory.js';

test('memory over the cap merges old items instead of deleting, and never touches pinned items', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-mem-'));
  const repo = new MemoryRepo(new FsStore(dir));
  const t = { id: 'tess', memoryMode: 'personal', memoryCap: 0 };
  const day = (n) => `2026-09-${String(n).padStart(2, '0')}T10:00:00Z`;
  const pinned = await repo.add(t, { kind: 'fact', text: 'Oldest but pinned', learnedAt: day(1) });
  await repo.setPinned(t, pinned.id, true);
  for (let i = 2; i <= 6; i++) await repo.add(t, { kind: 'fact', text: `Note ${i}`, learnedAt: day(i), source: `wk_${i}` });
  await repo.add(t, { kind: 'fact', text: 'Acme only', learnedAt: day(7), project: 'acme' });

  t.memoryCap = 4;
  await repo.enforceCap(t);
  const items = await repo.list(t);
  assert.equal(items.length, 4);
  assert.ok(items.some((i) => i.id === pinned.id && i.pinned));
  const merged = items.find((i) => i.mergedFrom);
  assert.ok(merged, 'a merged note exists');
  assert.match(merged.text, /Note 2 · Note 3 · Note 4 · Note 5/);
  assert.deepEqual(merged.sources, ['wk_2', 'wk_3', 'wk_4', 'wk_5']);
  assert.ok(items.some((i) => i.text === 'Acme only' && i.project === 'acme'), 'project notes are not merged with shared ones');
});
