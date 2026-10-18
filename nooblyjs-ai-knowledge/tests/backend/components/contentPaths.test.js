/**
 * @fileoverview Tests for the global site-content file locations
 * (src/shared/content/contentPaths.js).
 *
 * The contract that matters: reads prefer the canonical <APP_BASE_DIR>/content/
 * location but still fall back to the pre-2026-07-22 hidden `.system/.*`
 * folders, and writes ALWAYS go to the canonical location so an un-migrated
 * install heals itself on the first admin save.
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const {
  CONTENT_KINDS,
  contentDir,
  contentPath,
  legacyContentPath,
  readContent,
  writeContent
} = require('../../../src/shared/content/contentPaths');

const KINDS = Object.keys(CONTENT_KINDS);

function tempBaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contentpaths-'));
}

/** Write a file at `filePath`, creating parents. */
function seed(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

describe('contentPaths locations', () => {
  const baseDir = '/base';

  it('places every kind in <APP_BASE_DIR>/content', () => {
    expect(contentDir(baseDir)).toBe(path.join(baseDir, 'content'));
    expect(contentPath(baseDir, 'headline')).toBe(path.join(baseDir, 'content', 'headline.txt'));
    expect(contentPath(baseDir, 'help')).toBe(path.join(baseDir, 'content', 'help.md'));
    expect(contentPath(baseDir, 'whatsnew')).toBe(path.join(baseDir, 'content', 'whatsnew.md'));
  });

  it('keeps the legacy hidden folders for fallback reads', () => {
    expect(legacyContentPath(baseDir, 'headline'))
      .toBe(path.join(baseDir, '.system', '.headline', 'headline.txt'));
    expect(legacyContentPath(baseDir, 'help'))
      .toBe(path.join(baseDir, '.system', '.help', 'help.md'));
    expect(legacyContentPath(baseDir, 'whatsnew'))
      .toBe(path.join(baseDir, '.system', '.whatsnew', 'whatsnew.md'));
  });

  it.each([['contentPath', contentPath], ['legacyContentPath', legacyContentPath]])(
    '%s throws on an unknown kind',
    (_name, fn) => {
      expect(() => fn(baseDir, 'nope')).toThrow(/Unknown content kind/);
    }
  );
});

describe('readContent', () => {
  it.each(KINDS)('reads %s from the canonical location', async (kind) => {
    const baseDir = tempBaseDir();
    seed(contentPath(baseDir, kind), 'canonical');

    await expect(readContent(baseDir, kind)).resolves.toEqual({ content: 'canonical', from: 'content' });
  });

  it.each(KINDS)('falls back to the legacy location for %s', async (kind) => {
    const baseDir = tempBaseDir();
    seed(legacyContentPath(baseDir, kind), 'legacy');

    await expect(readContent(baseDir, kind)).resolves.toEqual({ content: 'legacy', from: 'legacy' });
  });

  it.each(KINDS)('prefers canonical over legacy for %s', async (kind) => {
    const baseDir = tempBaseDir();
    seed(legacyContentPath(baseDir, kind), 'legacy');
    seed(contentPath(baseDir, kind), 'canonical');

    await expect(readContent(baseDir, kind)).resolves.toEqual({ content: 'canonical', from: 'content' });
  });

  it.each(KINDS)('reports null for %s when neither location exists', async (kind) => {
    const baseDir = tempBaseDir();

    await expect(readContent(baseDir, kind)).resolves.toEqual({ content: null, from: null });
  });

  it('distinguishes an empty file from a missing one', async () => {
    const baseDir = tempBaseDir();
    seed(contentPath(baseDir, 'headline'), '');

    // An admin clearing the headline writes '' — that must not be mistaken for
    // "unset", which is what would re-seed a default in the help route.
    await expect(readContent(baseDir, 'headline')).resolves.toEqual({ content: '', from: 'content' });
  });
});

describe('writeContent', () => {
  it.each(KINDS)('creates the content folder and writes %s there', async (kind) => {
    const baseDir = tempBaseDir();

    const written = await writeContent(baseDir, kind, 'hello');

    expect(written).toBe(contentPath(baseDir, kind));
    await expect(fsp.readFile(contentPath(baseDir, kind), 'utf8')).resolves.toBe('hello');
  });

  it('writes to the canonical location even when a legacy file exists', async () => {
    const baseDir = tempBaseDir();
    seed(legacyContentPath(baseDir, 'help'), 'old');

    await writeContent(baseDir, 'help', 'new');

    // The legacy file is left for the migration script to remove, but it must
    // no longer be what the app reads.
    await expect(fsp.readFile(legacyContentPath(baseDir, 'help'), 'utf8')).resolves.toBe('old');
    await expect(readContent(baseDir, 'help')).resolves.toEqual({ content: 'new', from: 'content' });
  });

  it('round-trips through read after write', async () => {
    const baseDir = tempBaseDir();
    await writeContent(baseDir, 'whatsnew', '# Release 2.1\n\n- Something new\n');

    const { content, from } = await readContent(baseDir, 'whatsnew');
    expect(from).toBe('content');
    expect(content).toBe('# Release 2.1\n\n- Something new\n');
  });
});
