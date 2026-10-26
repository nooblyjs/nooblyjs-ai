// Phase 27b: no stage key is compared in code (root design.md §13). The stages are data/workflows/lifecycle.yaml's: a
// stage can be renamed, and new ones can go between them. Code asks for a stage by its KIND (stageOfKind('design'),
// item.stageKind === 'design'), never by its key. This reads the source of NooblyJS and every app it hosts and fails on
// a comparison of an item's stage with a key: `x.stage === 'design'`, `['build', 'test'].includes(x.stage)`,
// `items({ stage: 'test' })`. Only src/lifecycle/stages.js (the kinds and history's keys) and the seeds may name them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECTS = ['nooblyjs-ai-host', 'nooblyjs-ai-product', 'nooblyjs-ai-design', 'nooblyjs-ai-factory', 'nooblyjs-ai-operations', 'nooblyjs-ai-security', 'nooblyjs-ai-infrastructure', 'nooblyjs-ai-teammate', 'nooblyjs-ai-knowledge'];
const FOLDERS = ['src', 'public', 'quality/src', 'quality/public', 'index.js'];
const ALLOWED = [/nooblyjs-ai-host\/src\/lifecycle\/stages\.js$/, /\/seed\//, /\/test\//, /\/tests\//, /node_modules/];
// Every stage key there has been: today's built-in ones and history's.
const KEYS = 'discover|product|design|engineer|build|test|release|operate|specify|ux|ui|architect|verify|ship';
const STAGE = String.raw`[\w$.?\]\)]*\bstage\b`;
const PATTERNS = [
  new RegExp(String.raw`${STAGE}\s*[!=]==?\s*'(${KEYS})'`),
  new RegExp(String.raw`'(${KEYS})'\s*[!=]==?\s*${STAGE}(?!\w)`),
  new RegExp(String.raw`\[(?:\s*'(?:${KEYS})',?)+\s*\]\.includes\(${STAGE}\)`),
  new RegExp(String.raw`items\??\.?\(\{\s*stage:\s*'(${KEYS})'`),
];

function files(at) {
  if (!fs.existsSync(at)) return [];
  if (fs.statSync(at).isFile()) return at.endsWith('.js') ? [at] : [];
  return fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : files(path.join(at, e.name))));
}

test('no stage key is compared in code outside stages.js and the seeds', () => {
  const found = [];
  for (const project of PROJECTS) {
    for (const folder of FOLDERS) {
      for (const file of files(path.join(ROOT, project, folder))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (ALLOWED.some((re) => re.test(rel))) continue;
        for (const [i, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
          if (/^\s*(\/\/|\*)/.test(line)) continue;
          if (PATTERNS.some((re) => re.test(line))) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
        }
      }
    }
  }
  assert.deepEqual(found, [], `Compare stage kinds (stageOfKind, isKind, item.stageKind), not keys:\n${found.join('\n')}`);
});
