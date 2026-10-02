import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFrontmatter, parseFrontmatter } from '../src/frontmatter.js';

test('parseFrontmatter reads key: value lines, lists and quotes', () => {
  const { data, body } = parseFrontmatter('---\ndescription: Review "it"\nlabels: [a, "b", c]\nname: \'x\'\n---\nBody text\n');
  assert.deepEqual(data, { description: 'Review "it"', labels: ['a', 'b', 'c'], name: 'x' });
  assert.equal(body, 'Body text\n');
});

test('parseFrontmatter handles CRLF and files without frontmatter', () => {
  assert.deepEqual(parseFrontmatter('---\r\nkey: v\r\n---\r\nrest').data, { key: 'v' });
  assert.deepEqual(parseFrontmatter('# Just markdown'), { data: {}, body: '# Just markdown' });
});

test('formatFrontmatter round-trips through parseFrontmatter', () => {
  const data = { title: 'Add a greeting', labels: ['factory', 'docs'], draft: false, count: 3 };
  const text = formatFrontmatter({ ...data, skipped: undefined, nothing: null }, 'Body\n');
  assert.deepEqual(parseFrontmatter(text), {
    data: { title: 'Add a greeting', labels: ['factory', 'docs'], draft: 'false', count: '3' },
    body: 'Body\n',
  });
});

test('formatFrontmatter quotes values that would break the format', () => {
  const text = formatFrontmatter({ a: '[not a list]', b: 'two\nlines', c: ' padded' }, '');
  assert.deepEqual(parseFrontmatter(text).data, { a: '[not a list]', b: 'two lines', c: ' padded' });
});
