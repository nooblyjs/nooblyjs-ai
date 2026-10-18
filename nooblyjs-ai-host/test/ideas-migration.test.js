// Ideas were "opportunities" until 2026-10-12: a data folder from before is brought up to date at start
// (src/seed/ideas.js). Lifecycle items, the approvals that name them, Jira links and work-role first things follow;
// a second run changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { renameOpportunitiesToIdeas } from '../src/seed/ideas.js';

const { FsStore } = createRequire(import.meta.url)('nooblyjs-core/src/store/fs-store.js');

test('OPP- items, their approvals, Jira links and first things become IDEA- ones, once', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-ideas-'));
  try {
    const store = new FsStore(dir);
    await store.writeDoc(['workflows', 'items', 'OPP-018.md'], { id: 'OPP-018', type: 'opportunity', ref: 'OPP-018', title: 'Smarter substitutions', stage: 'discover' }, '');
    await store.writeDoc(['workflows', 'items', 'PRD-031.md'], { id: 'PRD-031', type: 'spec', title: 'Same-day delivery slots' }, '');
    await store.writeDoc(['workflows', 'approvals', 'apr_opp018.md'], { id: 'apr_opp018', itemId: 'OPP-018' }, '');
    await store.writeYaml(['devtools', 'links.yaml'], { 'OPP-020': [{ key: 'DTE-61' }], 'PRD-031': [{ key: 'DTE-1' }] });
    await store.writeText(['config', 'work-roles.yaml'], 'tasks:\n  - { text: Score the "Smarter substitutions" opportunity, done: { type: opportunity.scored, where: { opportunityId: OPP-018 } } }\n');

    assert.equal((await renameOpportunitiesToIdeas(store)).changed, 4);
    assert.deepEqual(await store.list(['workflows', 'items']), ['IDEA-018.md', 'PRD-031.md']);
    const item = await store.readDoc(['workflows', 'items', 'IDEA-018.md']);
    assert.deepEqual([item.data.id, item.data.type, item.data.ref, item.data.title], ['IDEA-018', 'idea', 'IDEA-018', 'Smarter substitutions']);
    assert.equal((await store.readDoc(['workflows', 'approvals', 'apr_opp018.md'])).data.itemId, 'IDEA-018');
    assert.deepEqual(Object.keys(await store.readYaml(['devtools', 'links.yaml'])), ['IDEA-020', 'PRD-031']);
    assert.equal(await store.readText(['config', 'work-roles.yaml']), 'tasks:\n  - { text: Score the "Smarter substitutions" idea, done: { type: idea.scored, where: { ideaId: IDEA-018 } } }\n');

    assert.equal((await renameOpportunitiesToIdeas(store)).changed, 0, 'a second start changes nothing');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
