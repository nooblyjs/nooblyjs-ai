// Phase 25: editing tools shaped for the model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createPermissions, decide } from '../src/permissions/gate.js';
import { applyPatchTool } from '../src/tools/apply-patch.js';
import { editTool } from '../src/tools/edit.js';
import { createDefaultTools, editToolsFor } from '../src/tools/index.js';
import { multiEditTool } from '../src/tools/multi-edit.js';
import { applyChunks, parsePatch } from '../src/tools/patch.js';
import { readTool } from '../src/tools/read.js';
import { fuzzyReplace } from '../src/tools/replace.js';
import { makeProject, toolContext } from './helpers.js';

async function setup(files) {
  const cwd = await makeProject(files);
  const ctx = toolContext(cwd);
  const read = async (...names) => {
    for (const name of names) await readTool.call({ file_path: name }, ctx);
  };
  const file = (name) => fs.readFileSync(path.join(cwd, name), 'utf8');
  return { cwd, ctx, read, file };
}

// ── The forgiving fallback ───────────────────────────────────────────────

test('Edit: whitespace differences are forgiven only when exactly one place matches, and re-indented', async () => {
  const { ctx, read, file } = await setup({ 'a.py': 'def f():\n\tif x:\n\t\treturn 1\n' });
  await read('a.py');
  const out = await editTool.call({ file_path: 'a.py', old_string: '    if x:\n        return 1', new_string: '    if x:\n        return 2' }, ctx);
  assert.match(out.content, /matched only when ignoring whitespace/);
  assert.equal(file('a.py'), 'def f():\n\tif x:\n\t\treturn 2\n', 'the file keeps its tabs');
  assert.equal(fuzzyReplace('a\n  x\nb\n  x\n', 'x', 'y'), null, 'two places match: refused');
  await assert.rejects(editTool.call({ file_path: 'a.py', old_string: 'nothing like this', new_string: 'z' }, ctx), /not found/);
});

// ── MultiEdit ────────────────────────────────────────────────────────────

test('MultiEdit applies edits in order, and writes nothing if one fails', async () => {
  const { ctx, read, file } = await setup({ 'm.js': 'function oldName() {}\noldName();\noldName();\n' });
  await read('m.js');
  const failed = multiEditTool.call({ file_path: 'm.js', edits: [{ old_string: 'function oldName', new_string: 'function newName' }, { old_string: 'missing', new_string: 'x' }] }, ctx);
  await assert.rejects(failed, /Edit 2 of 2 failed, so none were applied/);
  assert.match(file('m.js'), /^function oldName/);
  const out = await multiEditTool.call({ file_path: 'm.js', edits: [{ old_string: 'function oldName', new_string: 'function newName' }, { old_string: 'oldName();', new_string: 'newName();', replace_all: true }] }, ctx);
  assert.equal(file('m.js'), 'function newName() {}\nnewName();\nnewName();\n');
  assert.match(out.content, /2 edits, 3 replacements/);
});

// ── The patch format ─────────────────────────────────────────────────────

const PATCH = `*** Begin Patch
*** Update File: src/app.js
@@ function main
 const a = 1;
-const b = 2;
+const b = 3;
*** Add File: src/new.js
+export const x = 1;
*** Delete File: src/old.js
*** Update File: src/move-me.js
*** Move to: src/moved.js
-old
+new
*** End Patch`;

test('parsePatch: add, update (with context), delete and move', () => {
  const ops = parsePatch(PATCH);
  assert.deepEqual(ops.map((op) => [op.type, op.path, op.moveTo]), [['update', 'src/app.js', undefined], ['add', 'src/new.js', undefined], ['delete', 'src/old.js', undefined], ['update', 'src/move-me.js', 'src/moved.js']]);
  assert.deepEqual(ops[0].chunks, [{ old: ['const a = 1;', 'const b = 2;'], new: ['const a = 1;', 'const b = 3;'] }]);
  assert.throws(() => parsePatch('*** Update File: x\n-a'), /must start with "\*\*\* Begin Patch"/);
  assert.throws(() => parsePatch('*** Begin Patch\n*** Add File: x\nno plus\n*** End Patch'), /must start with "\+"/);
});

test('applyChunks finds chunks by content (no line numbers), in order, tolerating trailing whitespace', () => {
  const text = 'a\nb   \nc\nb\nd\n';
  assert.equal(applyChunks(text, [{ old: ['b', 'c'], new: ['B', 'C'] }, { old: ['b'], new: ['second b'] }], 'f'), 'a\nB\nC\nsecond b\nd\n');
  assert.throws(() => applyChunks(text, [{ old: ['zzz'], new: [] }], 'f.js'), /Chunk 1 of f\.js: these lines were not found/);
});

test('ApplyPatch: the whole patch, or nothing; files must be Read first', async () => {
  const { ctx, read, file, cwd } = await setup({ 'src/app.js': 'const a = 1;\nconst b = 2;\n', 'src/old.js': 'bye\n', 'src/move-me.js': 'old\n' });
  await assert.rejects(applyPatchTool.call({ patch: PATCH }, ctx), /You must Read src\/app\.js/);
  await read('src/app.js', 'src/old.js', 'src/move-me.js');
  const bad = PATCH.replace('-const b = 2;', '-const b = 999;');
  await assert.rejects(applyPatchTool.call({ patch: bad }, ctx), /not found/);
  assert.equal(fs.existsSync(path.join(cwd, 'src/new.js')), false, 'nothing written');

  const out = await applyPatchTool.call({ patch: PATCH }, ctx);
  assert.match(out.content, /updated src\/app\.js \(1 chunk\); added src\/new\.js; deleted src\/old\.js; moved src\/move-me\.js → src\/moved\.js/);
  assert.equal(file('src/app.js'), 'const a = 1;\nconst b = 3;\n');
  assert.equal(file('src/new.js'), 'export const x = 1;\n');
  assert.equal(file('src/moved.js'), 'new\n');
  assert.equal(fs.existsSync(path.join(cwd, 'src/old.js')), false);
  assert.equal(fs.existsSync(path.join(cwd, 'src/move-me.js')), false);
});

// ── Permissions and tool sets ────────────────────────────────────────────

test('the gate checks every file in a patch, and Edit/Write rules cover the new tools', () => {
  const tools = createDefaultTools({ editTools: 'patch' });
  const session = { cwd: '/p', permissions: createPermissions({ allow: ['Edit(src/**)'] }) };
  const patch = (file) => ({ patch: `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch` });
  assert.equal(decide(session, tools.get('ApplyPatch'), patch('src/a.js')).behavior, 'allow');
  assert.equal(decide(session, tools.get('ApplyPatch'), patch('.env')).behavior, 'deny', 'the default Edit(**/.env*) rule applies');
  const mixed = { patch: '*** Begin Patch\n*** Add File: src/a.js\n+x\n*** Add File: docs/b.md\n+y\n*** End Patch' };
  assert.equal(decide(session, tools.get('ApplyPatch'), mixed).behavior, 'ask', 'one file outside the rule: ask');
  const edits = createDefaultTools();
  assert.equal(decide(session, edits.get('MultiEdit'), { file_path: 'src/x.js', edits: [] }).behavior, 'allow');
  assert.equal(decide({ ...session, permissions: createPermissions({ mode: 'acceptEdits' }) }, edits.get('MultiEdit'), { file_path: 'x.js', edits: [] }).behavior, 'allow');
});

test('tool sets: OpenAI gets ApplyPatch, everyone else Edit + MultiEdit; a setting can choose', () => {
  assert.equal(editToolsFor('auto', 'openai'), 'patch');
  assert.equal(editToolsFor('auto', 'anthropic'), 'edit');
  assert.equal(editToolsFor('edit', 'openai'), 'edit');
  const names = (set) => createDefaultTools({ editTools: set }).list().map((t) => t.name);
  assert.ok(names('patch').includes('ApplyPatch') && !names('patch').includes('Edit'));
  assert.ok(names('edit').includes('MultiEdit') && !names('edit').includes('ApplyPatch'));
});
