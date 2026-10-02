import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'ink';
import { marked } from 'marked';
import { Markdown, plainText, safeSplitPoint } from '../src/ui/markdown.jsx';

const render = (text) => renderToString(<Markdown>{text}</Markdown>, { columns: 80 });

test('inline formatting: the ** and ` markers disappear', () => {
  const out = render('**bold**, *em*, `code` and ~~gone~~');
  assert.equal(out, 'bold, em, code and gone');
});

test('lists get bullets, numbers and indentation', () => {
  assert.equal(render('- a\n- b\n  - c'), '• a\n• b\n  ◦ c');
  assert.equal(render('3. x\n4. y'), '3. x\n4. y');
  assert.equal(render('- [x] done\n- [ ] todo'), '☑ done\n☐ todo');
});

test('headings, links and paragraphs', () => {
  assert.equal(render('# Title\n\nSee [docs](https://x.io) and <https://y.io>'), 'Title\n\nSee docs (https://x.io) and https://y.io');
});

test('tables are drawn with aligned columns', () => {
  const out = render('| Name | N |\n|---|--:|\n| **a** | 1 |\n| bbb | 22 |');
  assert.equal(
    out,
    ['┌──────┬────┐', '│ Name │  N │', '├──────┼────┤', '│ a    │  1 │', '│ bbb  │ 22 │', '└──────┴────┘'].join('\n'),
  );
});

test('code blocks keep their text, blank lines and language', () => {
  const out = render('```js\nconst a = 1;\n\nconst b = 2;\n```');
  assert.match(out, /│ js\s+│/);
  assert.match(out, /│ const a = 1; │\n│\s+│\n│ const b = 2; │/);
});

test('plainText strips formatting (used to size table columns)', () => {
  const [paragraph] = marked.lexer('**b** `c` [l](u)');
  assert.equal(plainText(paragraph.tokens), 'b c l (u)');
});

test('safeSplitPoint never cuts inside a code block', () => {
  assert.equal(safeSplitPoint('one\n\ntwo'), 3);
  assert.equal(safeSplitPoint('no blank line'), -1);
  // The only blank line is inside an open ``` block: don't cut.
  assert.equal(safeSplitPoint('text\n```js\na\n\nb'), -1);
  // Blank lines before and inside a block: cut at the one before the block.
  assert.equal(safeSplitPoint('intro\n\n```\na\n\nb'), 5);
  // After the block closes, cutting is fine again.
  const text = '```\na\n\nb\n```\n\nafter';
  assert.equal(safeSplitPoint(text), text.indexOf('```\n\nafter') + 3);
});
