// The Edge extension (apps/edge): the manifest is valid Manifest V3, every file it names exists,
// and it asks for no more than it needs. It reads Jira pages and talks only to NooblyJS (product.md §5.11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const EDGE = path.resolve('apps/edge');
const manifest = JSON.parse(await fs.readFile(path.join(EDGE, 'manifest.json'), 'utf8'));
const exists = (file) => fs.stat(path.join(EDGE, file)).then(() => true, () => false);

test('the manifest is Manifest V3 and every file it names exists', async () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    manifest.side_panel.default_path, manifest.background.service_worker, manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const file of files) assert.ok(await exists(file), `${file} is missing`);
});

test('each icon is a PNG of the size the manifest says', async () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = await fs.readFile(path.join(EDGE, file));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Number(size), Number(size)], file);
  }
});

test('it asks for no more than it needs: no cookies, web requests, scripting or broad host access', () => {
  assert.deepEqual(manifest.permissions.sort(), ['sidePanel', 'storage']);
  assert.deepEqual(manifest.host_permissions.sort(), ['http://localhost/*', 'https://localhost/*']);
  for (const c of manifest.content_scripts) {
    for (const match of c.matches) assert.match(match, /^https:\/\/\*\.atlassian\.net\//, `content script on ${match}`);
  }
});

test('the Jira reader only reads: it never types, clicks, submits or calls Jira', async () => {
  const source = await fs.readFile(path.join(EDGE, 'content/jira.js'), 'utf8');
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  for (const write of [/\.click\(/, /\.value\s*=/, /innerHTML\s*=/, /\.submit\(/, /dispatchEvent/, /execCommand/, /\bfetch\(/, /XMLHttpRequest/]) {
    assert.doesNotMatch(code, write, `content/jira.js must not use ${write}`);
  }
});
