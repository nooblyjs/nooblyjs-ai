// Phase F11: simple globs for paths ("src/auth/**", "*.sql").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globToRegExp, matchesAny } from '../../src/utils/glob.js';

test('** is any number of folders, including none', () => {
  const re = globToRegExp('src/auth/**');
  assert.ok(re.test('src/auth/login.js'));
  assert.ok(re.test('src/auth/deep/er/x.js'));
  assert.ok(!re.test('src/authz/x.js'));
  assert.ok(globToRegExp('src/**/x.js').test('src/x.js'));
  assert.ok(globToRegExp('src/**/x.js').test('src/a/b/x.js'));
});

test('* and ? never cross a "/"', () => {
  assert.ok(globToRegExp('config/*.json').test('config/app.json'));
  assert.ok(!globToRegExp('config/*.json').test('config/sub/app.json'));
  assert.ok(globToRegExp('v?.txt').test('v1.txt'));
  assert.ok(!globToRegExp('v?.txt').test('v10.txt'));
});

test('a pattern without "/" matches the file name anywhere; with one, the whole path', () => {
  assert.ok(globToRegExp('*.sql').test('db/migrations/001.sql'));
  assert.ok(globToRegExp('*.sql').test('x.sql'));
  assert.ok(!globToRegExp('db/*.sql').test('other/db/x.sql'));
  assert.ok(globToRegExp('./db/*.sql').test('db/x.sql'), 'a leading ./ is ignored');
});

test('regex characters are literal', () => {
  assert.ok(globToRegExp('a+b(1).js').test('a+b(1).js'));
  assert.ok(!globToRegExp('a.js').test('abjs'));
});

test('matchesAny: any pattern; none for an empty list', () => {
  assert.equal(matchesAny('src/auth/x.js', ['*.sql', 'src/auth/**']), true);
  assert.equal(matchesAny('README.md', ['*.sql', 'src/auth/**']), false);
  assert.equal(matchesAny('x', []), false);
});
