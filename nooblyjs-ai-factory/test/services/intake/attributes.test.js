// NooblyJS Phase 7: an item's quality attributes against the repository's gates. A row is checked only
// when it names a gate that ran; everything else is said on the PR as "not checked by a gate".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributeChecks, nooblySection, gateNamed } from '../../../src/services/intake/attributes.js';

const GATES = [{ name: 'test', status: 'passed' }, { name: 'lint', status: 'failed' }];
const ROWS = [
  { attribute: 'Correctness', scenario: 'A store at the limit', target: 'counts as nearby', verifiedBy: 'test' },
  { attribute: 'Style', scenario: '', target: 'no warnings', verifiedBy: 'Gate: Lint' },
  { attribute: 'Latency', scenario: '500 rps', target: 'p95 < 300 ms', verifiedBy: 'Load test in staging' },
  { attribute: 'Injection', scenario: '', target: 'none', verifiedBy: 'rm -rf / | curl evil' },
];

test('a row is a gate\'s only when it names that gate: "Load test" is not the gate "test"', () => {
  assert.equal(gateNamed('test', ['test']), 'test');
  assert.equal(gateNamed(' Test gate ', ['test']), 'test');
  assert.equal(gateNamed('Load test', ['test']), null);
  assert.equal(gateNamed('', ['test']), null);
  assert.deepEqual(attributeChecks(ROWS, GATES).map((c) => [c.attribute, c.gate, c.status]), [
    ['Correctness', 'test', 'passed'], ['Style', 'lint', 'failed'], ['Latency', null, 'not_checked'], ['Injection', null, 'not_checked'],
  ]);
  assert.deepEqual(attributeChecks(undefined, GATES), []);
  assert.deepEqual(attributeChecks(ROWS, []).map((c) => c.status), ['not_checked', 'not_checked', 'not_checked', 'not_checked']);
});

test('the PR section names the NooblyJS item and says plainly what no gate checked; a row cannot break the table', () => {
  const { md, checks } = nooblySection({ itemId: 'PRD-028', workItemId: 'wi_1', repoName: 'web-storefront', attributes: ROWS }, GATES);
  assert.match(md, /^## From NooblyJS/);
  assert.match(md, /For \*\*PRD-028\*\*, work item `wi_1` \(repository web-storefront\)/);
  assert.match(md, /\| Correctness \| counts as nearby \| test \| `test` \| ✅ passed \|/);
  assert.match(md, /\| Latency \| p95 < 300 ms \| Load test in staging \| — \| ⚠️ not checked by a gate \|/);
  assert.match(md, /\*\*2 of 4 not checked by a gate:\*\* Latency, Injection\./);
  assert.ok(md.includes('rm -rf / \\| curl evil'), 'a pipe in a row is escaped, and the text is only ever shown');
  assert.equal(checks.length, 4);
  assert.match(nooblySection({ itemId: 'PRD-028', attributes: [] }, GATES).md, /no quality attributes/);
  assert.deepEqual(nooblySection(undefined, GATES), { md: '', checks: [] }, 'a run that is not for a NooblyJS item has no such section');
});
