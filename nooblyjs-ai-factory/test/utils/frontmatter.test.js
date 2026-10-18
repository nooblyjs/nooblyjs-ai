// "key: value" settings at the top of a Markdown file (from nooblyjs-ai-common).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFrontmatter, parseFrontmatter } from '../../src/utils/frontmatter.js';

test('parse: settings and the body; no frontmatter is all body', () => {
  const { data, body } = parseFrontmatter('---\ntitle: Add half\nlabels: [factory, calc]\n---\nThe body.\n');
  assert.equal(data.title, 'Add half');
  assert.deepEqual(data.labels, ['factory', 'calc']);
  assert.match(body, /The body\./);
  const plain = parseFrontmatter('# Just text\n');
  assert.deepEqual(plain.data, {});
  assert.match(plain.body, /# Just text/);
});

test('format → parse gives plain settings back, and awkward values never break the format', () => {
  const plain = { title: 'Add half', labels: ['factory', 'calc'], note: '[not a list]' };
  const back = parseFrontmatter(formatFrontmatter(plain, 'Body text.\n'));
  assert.deepEqual(back.data, plain);
  assert.match(back.body, /Body text\./);
  // A newline can't start a new setting, and the body stays the body.
  const awkward = parseFrontmatter(formatFrontmatter({ title: 'Line one\ninjected: yes', quote: '"hi"' }, 'Body.\n'));
  assert.deepEqual(Object.keys(awkward.data).sort(), ['quote', 'title']);
  assert.match(awkward.body, /^\s*Body\.\s*$/);
});
