// The shared rules each sibling repo loads (.claude/steering/nooblyjs-ai.md) are generated from one source in noobly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steeringCopies } from '../scripts/sync-steering.js';

test('every sibling repo has an up-to-date copy of the shared rules (npm run steering:sync)', async () => {
  const copies = await steeringCopies();
  const stale = copies.filter((c) => !c.current).map((c) => c.repo);
  assert.deepEqual(stale, [], `out of date: ${stale.join(', ')}. Run npm run steering:sync in nooblyjs-ai-host`);
});
