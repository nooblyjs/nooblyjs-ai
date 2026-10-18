/**
 * @fileoverview Continuous Exploration wiki-context loader
 *
 * A project's `wikiContext` is an ORDERED list of selections, and since the
 * picker gained a search box it can name a single FILE as readily as a folder.
 * Two properties carry that:
 *
 *   - Folder or file is decided by stat'ing the path, not by the entry's
 *     `kind`. Selections written before that field existed carry no kind at
 *     all, and a `kind` that has gone stale (the path was replaced) must not
 *     silently produce empty grounding.
 *   - Order is data. The loader spends a byte budget as it walks the array, so
 *     what the user dragged to the top is what the AI is guaranteed to see —
 *     nothing here may sort, dedupe or reorder.
 *
 * A picked PDF/office file has no text of its own, so it resolves through the
 * folder-local derived sidecar (`.system/derived/<name>.<ext>.md`) — the same
 * extraction search indexes — while still being CITED under the original's
 * path, which is the document the user actually chose.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WikiContextLoader = require('../../../src/wiki/continuousExploration/wikiContextLoader');

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** Loader wired to a single space rooted at `base`. */
function makeLoader(base, { limits } = {}) {
  const space = { id: 7, name: 'Engineering Space', path: base };
  const app = { get: (key) => (key === 'spaceManager' ? { getSpaceById: (id) => (id === 7 ? space : null) } : null) };
  return new WikiContextLoader({ app, log: noopLog, limits });
}

function write(base, relPath, content) {
  const abs = path.join(base, relPath.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

describe('WikiContextLoader', () => {
  let base;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-ctx-'));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('reads a single picked markdown file, not its whole folder', async () => {
    write(base, 'Design/Chosen.md', 'the chosen one');
    write(base, 'Design/Sibling.md', 'not selected');

    const result = await makeLoader(base).load([
      { spaceId: 7, folderPath: 'Design/Chosen.md', name: 'Chosen.md', kind: 'file' }
    ]);

    expect(result.files.map(f => f.path)).toEqual(['Design/Chosen.md']);
    expect(result.digest).toContain('the chosen one');
    expect(result.digest).not.toContain('not selected');
  });

  test('a folder selection still walks the folder', async () => {
    write(base, 'Design/A.md', 'alpha');
    write(base, 'Design/Nested/B.md', 'bravo');

    const result = await makeLoader(base).load([
      { spaceId: 7, folderPath: 'Design', name: 'Design', kind: 'folder' }
    ]);

    expect(result.files.map(f => f.path).sort()).toEqual(['Design/A.md', 'Design/Nested/B.md']);
  });

  test('file vs folder comes from the filesystem, not from `kind`', async () => {
    write(base, 'Notes/One.md', 'one');
    write(base, 'Solo.md', 'solo');

    // Both entries lie about what they point at; both must still resolve.
    const result = await makeLoader(base).load([
      { spaceId: 7, folderPath: 'Solo.md', name: 'Solo.md', kind: 'folder' },
      { spaceId: 7, folderPath: 'Notes', name: 'Notes', kind: 'file' }
    ]);

    expect(result.files.map(f => f.path)).toEqual(['Solo.md', 'Notes/One.md']);
  });

  test('legacy entries with no `kind` at all still resolve', async () => {
    write(base, 'Legacy/Doc.md', 'legacy content');

    const result = await makeLoader(base).load([
      { spaceId: 7, folderPath: 'Legacy/Doc.md', name: 'Doc.md' }
    ]);

    expect(result.files.map(f => f.path)).toEqual(['Legacy/Doc.md']);
  });

  test('a picked PDF reads its derived sidecar but is cited under its own path', async () => {
    write(base, 'Reports/Q3.pdf', '%PDF-1.7 binary');
    write(base, 'Reports/.system/derived/Q3.pdf.md', 'extracted quarterly text');

    const result = await makeLoader(base).load([
      { spaceId: 7, folderPath: 'Reports/Q3.pdf', name: 'Q3.pdf', kind: 'file' }
    ]);

    expect(result.files.map(f => f.path)).toEqual(['Reports/Q3.pdf']);
    expect(result.digest).toContain('extracted quarterly text');
    expect(result.digest).not.toContain('%PDF');
  });

  test('a picked binary with no extracted text contributes nothing, quietly', async () => {
    write(base, 'Reports/Q4.pdf', '%PDF-1.7 binary');   // no sidecar written
    write(base, 'Diagram.png', 'not text at all');

    const result = await makeLoader(base).load([
      { spaceId: 7, folderPath: 'Reports/Q4.pdf', name: 'Q4.pdf', kind: 'file' },
      { spaceId: 7, folderPath: 'Diagram.png', name: 'Diagram.png', kind: 'file' }
    ]);

    expect(result.files).toEqual([]);
    expect(result.digest).toBe('');
  });

  test('selection ORDER decides who gets the byte budget', async () => {
    write(base, 'First.md', 'A'.repeat(40));
    write(base, 'Second.md', 'B'.repeat(40));

    const entries = [
      { spaceId: 7, folderPath: 'First.md', name: 'First.md', kind: 'file' },
      { spaceId: 7, folderPath: 'Second.md', name: 'Second.md', kind: 'file' }
    ];
    // Budget fits the first file and nothing else.
    const limits = { maxTotalBytes: 40, maxBytesPerFile: 40 };

    const forwards = await makeLoader(base, { limits }).load(entries);
    expect(forwards.files.map(f => f.path)).toEqual(['First.md']);
    expect(forwards.truncated).toBe(true);

    const reversed = await makeLoader(base, { limits }).load(entries.slice().reverse());
    expect(reversed.files.map(f => f.path)).toEqual(['Second.md']);
  });

  test('a selection that has been deleted is skipped, the rest still load', async () => {
    write(base, 'Alive.md', 'still here');

    const result = await makeLoader(base).load([
      { spaceId: 7, folderPath: 'Gone/Missing.md', name: 'Missing.md', kind: 'file' },
      { spaceId: 7, folderPath: 'Alive.md', name: 'Alive.md', kind: 'file' }
    ]);

    expect(result.files.map(f => f.path)).toEqual(['Alive.md']);
  });

  test('a path escaping the space root is refused', async () => {
    const outside = path.join(base, '..', `outside-${path.basename(base)}.md`);
    fs.writeFileSync(outside, 'secret', 'utf8');
    try {
      const result = await makeLoader(base).load([
        { spaceId: 7, folderPath: `../${path.basename(outside)}`, name: 'outside', kind: 'file' }
      ]);
      expect(result.files).toEqual([]);
      expect(result.digest).toBe('');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
