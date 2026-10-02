// Phase 27: the repo map.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRepoMap, extractSymbols, rankFiles } from '../src/context/repo-map.js';
import { repoMapTool } from '../src/tools/repo-map.js';
import { makeProject } from './helpers.js';

test('symbols: top-level definitions per language, as signatures without bodies', () => {
  const js = extractSymbols('export async function* runTurn(session, text) {\n  const inner = 1;\n}\nclass Store extends Base {\nexport const LIMIT = 5;\nconst add = (a, b) => a + b;\nexport interface Options {', 'ts');
  assert.deepEqual(js.map((s) => s.text), ['export async function* runTurn(session, text)', 'class Store extends Base', 'export const LIMIT = 5;', 'const add = (a, b) =>', 'export interface Options']);
  assert.deepEqual(extractSymbols('class Parser:\n    def parse(self, text):\ndef main():\n        def deep():', 'py').map((s) => s.name), ['Parser', 'parse', 'main']);
  assert.deepEqual(extractSymbols('func (s *Server) Start() error {\ntype Config struct {', 'go').map((s) => s.name), ['Start', 'Config']);
  assert.deepEqual(extractSymbols('pub fn run() {\nstruct Point {', 'rs').map((s) => s.name), ['run', 'Point']);
  assert.deepEqual(extractSymbols('anything', 'txt'), []);
});

test('rank: files that many others use come first; focus pulls related files up', () => {
  const file = (symbols, words) => ({ symbols: symbols.map((name) => ({ name })), words: new Map(Object.entries(words)) });
  const files = new Map([
    ['util.js', file(['formatDate'], {})],
    ['a.js', file(['pageA'], { formatDate: 2 })],
    ['b.js', file(['pageB'], { formatDate: 1 })],
    ['c.js', file(['pageC'], { formatDate: 1, pageB: 1 })],
  ]);
  const rank = rankFiles(files);
  assert.equal([...rank.entries()].sort((x, y) => y[1] - x[1])[0][0], 'util.js');
  const focused = rankFiles(files, { boost: new Map([['c.js', 10]]) });
  assert.ok(focused.get('c.js') > rank.get('c.js'));
  assert.ok(focused.get('b.js') > focused.get('a.js'), 'what the focused file uses outranks an unrelated file');
});

test('buildRepoMap: ranked, within budget, focus first; RepoMap tool reports coverage', async () => {
  const files = { 'src/util.js': 'export function formatDate(d) {}\nexport function slugify(s) {}\n' };
  for (let i = 0; i < 30; i++) files[`src/page${i}.js`] = `import { formatDate } from './util.js';\nexport function renderPage${i}() { return formatDate(${i}); }\n`;
  const cwd = await makeProject(files);
  const map = await buildRepoMap(cwd, { maxTokens: 400 });
  assert.match(map.text, /^src\/util\.js:\n│ export function formatDate\(d\)\n│ export function slugify\(s\)/);
  assert.ok(map.shown < map.files, 'the budget limits it');
  assert.equal(map.files, 31);
  const focused = await buildRepoMap(cwd, { focus: ['renderPage17'], maxTokens: 400 });
  assert.match(focused.text, /^src\/page17\.js:/);
  const out = await repoMapTool.call({ focus: ['src/page3.js'] }, { cwd });
  assert.match(out.content, /^src\/page3\.js:[\s\S]*\(\d+ of 31 source files shown, most relevant first\.\)$/);
});
