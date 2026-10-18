// Phase F03/F06: an issue as a Markdown file: title, body, labels, priority.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIssue } from '../../src/models/issue.js';

test('frontmatter: title, labels and priority; the body is the rest', () => {
  const issue = parseIssue('---\ntitle: Add subtract\nlabels: [factory, calc]\npriority: high\n---\n\nsubtract(a, b) returns a - b.\n');
  assert.deepEqual(issue, { title: 'Add subtract', body: 'subtract(a, b) returns a - b.', labels: ['factory', 'calc'], priority: 'high' });
});

test('no frontmatter: the first non-empty line is the title, without its "#"', () => {
  assert.deepEqual(parseIssue('\n\n## Add half\n\nhalf(n) returns n / 2.\n'), { title: 'Add half', body: 'half(n) returns n / 2.', labels: [] });
  assert.deepEqual(parseIssue('Fix the typo'), { title: 'Fix the typo', body: '', labels: [] });
});

test('a single label is a list of one; priority only appears when given', () => {
  const issue = parseIssue('---\ntitle: T\nlabels: docs\n---\nbody');
  assert.deepEqual(issue.labels, ['docs']);
  assert.equal('priority' in issue, false);
});

test('a blank frontmatter title falls back to the first line', () => {
  assert.equal(parseIssue('---\ntitle: "  "\n---\n# From the body\nmore').title, 'From the body');
});

test('no title anywhere → an error that says how to add one', () => {
  assert.throws(() => parseIssue(''), /no title/);
  assert.throws(() => parseIssue('---\nlabels: [x]\n---\n\n  \n'), /"title:" frontmatter/);
});
