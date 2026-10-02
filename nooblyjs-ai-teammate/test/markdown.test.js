import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/js/markdown.js';

test('renders common Markdown', () => {
  const html = renderMarkdown('# Brief\n\nHello **Acme** and *friends*, see `x < y`.\n\n- one\n- two\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1 < 2;\n```\n\n> quoted');
  assert.match(html, /<h3>Brief<\/h3>/);
  assert.match(html, /<strong>Acme<\/strong> and <em>friends<\/em>/);
  assert.match(html, /<code>x &lt; y<\/code>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<th>A<\/th><th>B<\/th>.*<td>1<\/td><td>2<\/td>/s);
  assert.match(html, /<pre><code data-lang="js">const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
});

test('never emits raw HTML or unsafe links', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n**<img src=x onerror=alert(1)>**\n\n[click](javascript:alert(1)) [ok](https://example.com/?a=1&b=2)');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /click/);
  assert.match(html, /<a href="https:\/\/example.com\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">ok<\/a>/);
});

test('code spans are not formatted further', () => {
  assert.match(renderMarkdown('use `**not bold**` here'), /<code>\*\*not bold\*\*<\/code>/);
});
