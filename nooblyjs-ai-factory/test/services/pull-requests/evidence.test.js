// NooblyJS Phase 16e: the required tests of a pull request's commit. Each automated test case of the story's test
// analysis is looked for by its id in the commit's test files: present and passing (the gates passed), failing (a
// failing line names it), present but not proven (the gates didn't pass), or missing. Cases a person checks are listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredTests, requiredTestsSection, requiredTestsText } from '../../../src/services/pull-requests/evidence.js';
import { gitIn, makeRepo } from '../../helpers.js';

const CASES = [
  { id: 'TC-031-1-1', title: 'The last slot goes to one customer', level: 'e2e', automate: true },
  { id: 'TC-031-1-2', title: 'The slot API contract', level: 'contract', automate: true },
  { id: 'TC-031-1-10', title: 'A load test', level: 'performance', automate: true },
  { id: 'TC-031-1-11', title: 'A screen reader check', level: 'manual', automate: false },
];

function repo() {
  const dir = makeRepo({
    'test/slots.test.js': "test('TC-031-1-1: the last slot', () => {});\ntest('TC-031-1-10: a thousand stores', () => {});\n",
    'src/slots.js': '// TC-031-1-2 is named here, but this is not a test file\n',
  });
  return { dir, sha: gitIn(dir, 'rev-parse', 'HEAD') };
}

test('each required test by its id: present and passing, or missing; TC-031-1-1 is not found inside TC-031-1-10', async () => {
  const { dir, sha } = repo();
  const t = await requiredTests({ mirror: dir, sha, cases: CASES, gates: { passed: true, results: [] } });
  assert.deepEqual(t.cases.map((c) => [c.id, c.status, c.found]), [
    ['TC-031-1-1', 'passing', ['test/slots.test.js:1']],
    ['TC-031-1-2', 'missing', []],
    ['TC-031-1-10', 'passing', ['test/slots.test.js:2']],
  ]);
  assert.deepEqual([t.required, t.present, t.passing, t.missing], [3, 2, 2, ['TC-031-1-2']]);
  assert.equal(t.text, '2 of 3 required tests present (TC-031-1-2 missing)');
  assert.deepEqual(t.manual, [{ id: 'TC-031-1-11', title: 'A screen reader check' }]);
  const md = requiredTestsSection(t);
  assert.match(md, /\*\*2 of 3 required tests present \(TC-031-1-2 missing\)\.\*\*/);
  assert.match(md, /\| TC-031-1-2 \| contract \| The slot API contract \| — \| ⛔ missing \|/);
  assert.match(md, /Checked by a person \(the tester, at the Test approval\):\n\n- TC-031-1-11: A screen reader check/);
});

test('failing when a failing line names it; present but not proven when the gates failed elsewhere or none ran', async () => {
  const { dir, sha } = repo();
  const cases = CASES.filter((c) => c.id !== 'TC-031-1-2');
  const failed = await requiredTests({ mirror: dir, sha, cases, gates: { passed: false, results: [{ status: 'failed', excerpt: 'not ok 2 - TC-031-1-10: a thousand stores\n' }] } });
  assert.deepEqual(failed.cases.map((c) => [c.id, c.status]), [['TC-031-1-1', 'unproven'], ['TC-031-1-10', 'failing']]);
  assert.equal(failed.text, '2 of 2 required tests present (TC-031-1-10 failing)');
  const none = await requiredTests({ mirror: dir, sha, cases: cases.slice(0, 1), gates: null });
  assert.equal(none.text, '1 of 1 required tests present, not proven passing (the repository declares no gates)');
  const all = await requiredTests({ mirror: dir, sha, cases: cases.slice(0, 1), gates: { passed: true } });
  assert.equal(all.text, '1 of 1 required tests present, all passing');
  assert.equal(requiredTestsText({ required: 0 }), 'No required tests: the test analysis asks the AI to automate none in this repository');
});
