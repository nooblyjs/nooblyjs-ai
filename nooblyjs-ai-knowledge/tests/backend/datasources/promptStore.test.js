/**
 * @fileoverview Tests for the shared prompt store.
 * Covers seeding, key lookup, {{variable}} substitution, CRUD and the
 * mtime-based cache that makes UI edits visible to prompts.get() immediately.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PromptStore, slugify, extractVariables, applyVariables, DEFAULT_PROMPTS
} = require('../../../src/shared/prompts/promptStore');

/**
 * Prompt keys the workflow steps in the sibling
 * `noobly-app-wiki-workflows` repo read by key. `get()` throws on
 * a missing key, so losing one of these breaks a workflow at run time — keep this
 * list in step with the `prompts.get(...)` calls over there.
 */
const WORKFLOW_PROMPT_KEYS = [
  'document-summary',                  // contextProcessor — per-file sidecar
  'folder-context-overview',           // contextProcessor — folder roll-up
  'document-cleaning',                 // documentCleaner
  'code-documentation',                // codeProcessor — architect persona
  'code-documentation-renderer-rules'  // codeProcessor — formatting rules
];

describe('promptStore', () => {
  let baseDir;
  let store;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-store-'));
    store = new PromptStore({ appBaseDir: baseDir });
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  describe('slugify', () => {
    test('turns a name into a lookup key', () => {
      expect(slugify('PDF document processing')).toBe('pdf-document-processing');
      expect(slugify('  Mixed CASE & symbols!  ')).toBe('mixed-case-symbols');
    });

    test('returns an empty string when nothing survives', () => {
      expect(slugify('!!!')).toBe('');
      expect(slugify(null)).toBe('');
    });
  });

  describe('variables', () => {
    test('extracts distinct placeholder names', () => {
      expect(extractVariables('a {{one}} b {{two}} c {{one}}')).toEqual(['one', 'two']);
    });

    test('substitutes supplied values and leaves unknown placeholders alone', () => {
      expect(applyVariables('max {{n}} of {{unit}}', { n: 5 })).toBe('max 5 of {{unit}}');
    });
  });

  describe('seeding', () => {
    test('writes the default prompts when no store file exists', () => {
      const keys = store.all().map((p) => p.key);
      expect(keys).toContain('document-processing-pdf');
      expect(fs.existsSync(store.filePath)).toBe(true);
    });

    test('does not seed when seeding is disabled', () => {
      const bare = new PromptStore({ appBaseDir: baseDir, seed: false });
      expect(bare.all()).toEqual([]);
    });

    test('seeds every prompt the workflow steps read by key', () => {
      const keys = store.all().map((p) => p.key);
      for (const key of WORKFLOW_PROMPT_KEYS) expect(keys).toContain(key);
    });

    test('built-in keys are unique', () => {
      const keys = DEFAULT_PROMPTS.map((p) => slugify(p.key || p.name));
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('ensureDefaults', () => {
    test('backfills built-ins missing from a store written by an earlier release', async () => {
      const bare = new PromptStore({ appBaseDir: baseDir, seed: false });
      await bare.create({ name: 'Hand written', content: 'kept' });

      const added = bare.ensureDefaults();

      expect(added).toEqual(expect.arrayContaining(WORKFLOW_PROMPT_KEYS));
      // The pre-existing prompt survives untouched.
      expect(bare.get('hand-written')).toBe('kept');
      expect(bare.get('document-cleaning')).toContain('document processing expert');
    });

    test('leaves an edited built-in alone and reports nothing to add', async () => {
      store.all(); // seed
      await store.update('document-cleaning', { content: 'my own cleaning rules' });

      expect(store.ensureDefaults()).toEqual([]);
      expect(store.get('document-cleaning')).toBe('my own cleaning rules');
    });

    test('is idempotent', () => {
      expect(store.ensureDefaults()).toEqual([]);
      expect(store.ensureDefaults()).toEqual([]);
    });

    test('refuses to overwrite a store file it cannot parse', () => {
      fs.mkdirSync(path.dirname(store.filePath), { recursive: true });
      fs.writeFileSync(store.filePath, '{ not json', 'utf-8');

      expect(store.ensureDefaults()).toEqual([]);
      expect(fs.readFileSync(store.filePath, 'utf-8')).toBe('{ not json');
    });
  });

  describe('get', () => {
    test('returns the prompt text by key', () => {
      expect(store.get('document-processing-pdf')).toContain('document conversion assistant');
    });

    test('accepts an unslugged key', () => {
      expect(store.get('Document Processing PDF')).toContain('document conversion assistant');
    });

    test('fills variables', () => {
      expect(store.get('document-summary', { maxChars: 400 })).toContain('at most 400 characters');
    });

    test('throws on an unknown key rather than returning an empty prompt', () => {
      expect(() => store.get('does-not-exist')).toThrow(/not found/i);
    });

    test('getOr falls back instead of throwing', () => {
      expect(store.getOr('does-not-exist', 'fallback {{x}}', { x: 1 })).toBe('fallback 1');
    });
  });

  describe('create', () => {
    test('derives the key from the name and records the variables', async () => {
      const created = await store.create({ name: 'My New Prompt', content: 'Hi {{who}}' });
      expect(created.key).toBe('my-new-prompt');
      expect(created.variables).toEqual(['who']);
      expect(created.version).toBe(1);
      expect(store.get('my-new-prompt', { who: 'there' })).toBe('Hi there');
    });

    test('rejects a duplicate key', async () => {
      await store.create({ name: 'Dup', content: 'x' });
      await expect(store.create({ name: 'dup', content: 'y' })).rejects.toThrow(/already exists/);
    });

    test('rejects missing name or content', async () => {
      await expect(store.create({ content: 'x' })).rejects.toThrow(/Name is required/);
      await expect(store.create({ name: 'x' })).rejects.toThrow(/content is required/i);
    });
  });

  describe('update', () => {
    test('bumps the version when the body changes', async () => {
      const created = await store.create({ name: 'Versioned', content: 'one' });
      const updated = await store.update(created.id, { content: 'two' });
      expect(updated.version).toBe(2);
      expect(store.get('versioned')).toBe('two');
    });

    test('leaves the version alone for metadata-only edits', async () => {
      const created = await store.create({ name: 'Meta', content: 'body' });
      const updated = await store.update(created.id, { description: 'now described' });
      expect(updated.version).toBe(1);
      expect(updated.description).toBe('now described');
    });

    test('preserves the execution counter', async () => {
      const created = await store.create({ name: 'Counted', content: 'body' });
      await store.recordUsage(created.id);
      const updated = await store.update(created.id, { content: 'new body' });
      expect(updated.executions).toBe(1);
    });

    test('rejects renaming onto an existing key', async () => {
      await store.create({ name: 'First', content: 'a' });
      const second = await store.create({ name: 'Second', content: 'b' });
      await expect(store.update(second.id, { key: 'first' })).rejects.toThrow(/already exists/);
    });

    test('throws for an unknown prompt', async () => {
      await expect(store.update('nope', { content: 'x' })).rejects.toThrow(/not found/i);
    });
  });

  describe('remove', () => {
    test('deletes by key', async () => {
      await store.create({ name: 'Doomed', content: 'x' });
      await store.remove('doomed');
      expect(store.find('doomed')).toBeNull();
    });
  });

  describe('cache', () => {
    test('picks up an out-of-band edit to the store file', async () => {
      await store.create({ name: 'Live', content: 'original' });
      expect(store.get('live')).toBe('original');

      // Simulate another process (the UI) rewriting the file.
      const onDisk = JSON.parse(fs.readFileSync(store.filePath, 'utf-8'));
      onDisk.prompts.find((p) => p.key === 'live').content = 'edited';
      fs.writeFileSync(store.filePath, JSON.stringify(onDisk, null, 2), 'utf-8');
      // mtime granularity can hide a same-millisecond rewrite; force a new stamp.
      const future = new Date(Date.now() + 2000);
      fs.utimesSync(store.filePath, future, future);

      expect(store.get('live')).toBe('edited');
    });

    test('a corrupt store file yields an empty list rather than throwing', () => {
      fs.mkdirSync(path.dirname(store.filePath), { recursive: true });
      fs.writeFileSync(store.filePath, '{ not json', 'utf-8');
      expect(store.all()).toEqual([]);
    });
  });

  describe('stats', () => {
    test('counts published, drafts and runs', async () => {
      const bare = new PromptStore({ appBaseDir: baseDir, seed: false });
      await bare.create({ name: 'A', content: 'a', status: 'published' });
      const draft = await bare.create({ name: 'B', content: 'b', status: 'draft' });
      await bare.recordUsage(draft.id);
      expect(bare.stats()).toEqual({
        totalPrompts: 2, published: 1, drafts: 1, totalExecutions: 1
      });
    });
  });
});
