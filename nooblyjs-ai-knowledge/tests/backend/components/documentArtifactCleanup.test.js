/**
 * @fileoverview Deleting a document must take its artifacts with it.
 *
 * Every per-document artifact lives in `<the document's folder>/.system/`, which is in
 * the file watcher's IGNORED_SEGMENT — so nothing else ever revisits it. Left behind
 * after a delete, a derived sidecar keeps answering content searches for a document
 * that opens 404, and a context sidecar keeps feeding chat grounding a summary of
 * content that no longer exists (and gets folded straight back into the next folder
 * roll-up).
 *
 * Covered here:
 *   - `documentArtifacts.removeDocumentArtifacts` — the mapping from a deleted
 *     document to every artifact it owned, for each of the shapes that mapping takes
 *     (PDF keeps its original + derived; an office drop's source lives under a
 *     visible `.md` page; a plain markdown page owns only its context sidecar);
 *   - `artifactCleanup`'s two gates — the hidden-path gate that keeps the cleanup from
 *     reacting to artifact churn, and the eligibility gate that decides whether a
 *     delete is worth an AI context rebuild.
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const {
  artifactRelPathsFor,
  removeDocumentArtifacts
} = require('../../../src/wiki/utils/documentArtifacts');

const { isHiddenPath, ownsContext } = require('../../../src/wiki/activities/artifactCleanup');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let spaceRoot;

beforeEach(async () => {
  spaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'artifact-cleanup-'));
});

afterEach(async () => {
  await fsp.rm(spaceRoot, { recursive: true, force: true });
});

/** Write a file (creating parents) and return its space-relative path. */
async function writeFile(relativePath, content = 'x') {
  const abs = path.join(spaceRoot, relativePath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
  return relativePath;
}

const exists = (relativePath) => fs.existsSync(path.join(spaceRoot, relativePath));

describe('artifactRelPathsFor', () => {
  test('maps a document to its derived, context and originals paths', () => {
    const paths = artifactRelPathsFor('Standards/Report.pdf');
    expect(paths).toEqual(expect.arrayContaining([
      'Standards/.system/derived/Report.pdf.md',
      'Standards/.system/context/Report.pdf.md',
      'Standards/.system/originals/Report.pdf'
    ]));
  });

  test('a markdown page also probes every office source it could have been converted from', () => {
    const paths = artifactRelPathsFor('Standards/Report.md');
    expect(paths).toEqual(expect.arrayContaining([
      'Standards/.system/context/Report.md',
      'Standards/.system/originals/Report.docx',
      'Standards/.system/originals/Report.xlsx'
    ]));
  });

  test('a space-root document keeps its artifacts in the root .system', () => {
    expect(artifactRelPathsFor('home.md')).toEqual(expect.arrayContaining(['.system/context/home.md']));
  });
});

describe('removeDocumentArtifacts', () => {
  test('removes a deleted PDF\'s derived text and context sidecar', async () => {
    await writeFile('Standards/.system/derived/Report.pdf.md', '# Extracted');
    await writeFile('Standards/.system/context/Report.pdf.md', 'A summary.');

    const { removed } = await removeDocumentArtifacts(spaceRoot, 'Standards/Report.pdf', { log: silentLogger });

    expect(removed.sort()).toEqual([
      'Standards/.system/context/Report.pdf.md',
      'Standards/.system/derived/Report.pdf.md'
    ]);
    expect(exists('Standards/.system/derived/Report.pdf.md')).toBe(false);
    expect(exists('Standards/.system/context/Report.pdf.md')).toBe(false);
  });

  test('removes the stored office source behind a deleted markdown page', async () => {
    await writeFile('Standards/.system/originals/Report.docx', 'binary');
    await writeFile('Standards/.system/context/Report.md', 'A summary.');

    const { removed } = await removeDocumentArtifacts(spaceRoot, 'Standards/Report.md', { log: silentLogger });

    expect(removed).toContain('Standards/.system/originals/Report.docx');
    expect(removed).toContain('Standards/.system/context/Report.md');
    expect(exists('Standards/.system/originals/Report.docx')).toBe(false);
  });

  test('leaves other documents\' artifacts alone', async () => {
    await writeFile('Standards/.system/context/Report.md', 'gone');
    await writeFile('Standards/.system/context/Keep.md', 'kept');
    await writeFile('Standards/.system/context/_folder.md', 'roll-up');

    await removeDocumentArtifacts(spaceRoot, 'Standards/Report.md', { log: silentLogger });

    expect(exists('Standards/.system/context/Keep.md')).toBe(true);
    expect(exists('Standards/.system/context/_folder.md')).toBe(true);
  });

  test('a PDF and a markdown page of the same base name never collide', async () => {
    await writeFile('Standards/.system/context/Report.pdf.md', 'pdf summary');
    await writeFile('Standards/.system/context/Report.md', 'markdown summary');

    await removeDocumentArtifacts(spaceRoot, 'Standards/Report.pdf', { log: silentLogger });

    expect(exists('Standards/.system/context/Report.pdf.md')).toBe(false);
    expect(exists('Standards/.system/context/Report.md')).toBe(true);
  });

  test('a document with no artifacts is a no-op, not an error', async () => {
    await expect(removeDocumentArtifacts(spaceRoot, 'Standards/photo.png', { log: silentLogger }))
      .resolves.toEqual({ removed: [] });
  });

  test('prunes an artifact directory once it is empty, but keeps a shared one', async () => {
    await writeFile('Standards/.system/context/Report.md', 'gone');
    await writeFile('Standards/.system/derived/Other.pdf.md', 'still needed');

    await removeDocumentArtifacts(spaceRoot, 'Standards/Report.md', { log: silentLogger });

    expect(exists('Standards/.system/context')).toBe(false);
    expect(exists('Standards/.system/derived')).toBe(true);
  });
});

describe('artifactCleanup gates', () => {
  test('ignores deletes inside the hidden namespaces the cleanup itself writes', () => {
    // Reacting to these would mean deriving a "document" from an artifact path — and
    // the `.aicontext` chat cache churns constantly.
    expect(isHiddenPath('Standards/.system/context/Report.md')).toBe(true);
    expect(isHiddenPath('Standards/.aicontext/Report-summary.md')).toBe(true);
    expect(isHiddenPath('Standards/.home.md')).toBe(true);
    expect(isHiddenPath('Standards/Report.md')).toBe(false);
  });

  test('only documents that could have had context are worth an AI rebuild', () => {
    expect(ownsContext('Standards/Notes.md')).toBe(true);
    expect(ownsContext('Standards/Report.pdf')).toBe(true);
    expect(ownsContext('Standards/Deck.docx')).toBe(true);
    expect(ownsContext('Standards/photo.png')).toBe(false);
    expect(ownsContext('Standards/clip.mp4')).toBe(false);
  });
});
