/**
 * @fileoverview Derived markdown sidecars — the contract that keeps a PDF
 * searchable by its CONTENT while the search result still references the PDF.
 *
 * The rule under test, end to end:
 *   - a PDF's text lives only in `<folder>/.system/derived/<name>.pdf.md`;
 *   - the indexer reads that sidecar but keys the document under the PDF's own
 *     path, so a hit opens the PDF (never the sidecar, which is not a document);
 *   - a missing or stale sidecar is repaired during an index pass, because the
 *     file watcher (`ignoreInitial: true`) never sees files that were already on
 *     disk at startup.
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const {
  SidecarStatus,
  spaceRootOf,
  sidecarPathFor,
  sidecarStatus,
  ensureSidecar,
  removeSidecar
} = require('../../../src/wiki/utils/derivedSidecar');

const SearchIndexer = require('../../../src/wiki/activities/searchIndexer');

// The sidecar module converts real files, so stub the dispatcher: these tests are
// about WHEN a sidecar is written and what the indexer does with it, not about
// PDF parsing.
jest.mock('../../../src/shared/processors/documentConverter', () => {
  const nodePath = require('node:path');
  const SUPPORTED_EXTENSIONS = new Set(['.docx', '.doc', '.pdf', '.xlsx', '.xls']);
  return {
    SUPPORTED_EXTENSIONS,
    canConvert: (filePath) => SUPPORTED_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase()),
    convertToMarkdown: jest.fn(async (filePath) => {
      if (nodePath.basename(filePath).startsWith('corrupt')) {
        throw new Error('could not parse document');
      }
      return `# Extracted\n\nText of ${nodePath.basename(filePath)}\n`;
    })
  };
});

const { convertToMarkdown } = require('../../../src/shared/processors/documentConverter');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let spaceRoot;

beforeEach(async () => {
  spaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'derived-sidecar-'));
  convertToMarkdown.mockClear();
});

afterEach(async () => {
  await fsp.rm(spaceRoot, { recursive: true, force: true });
});

/** Write a file (creating parents) and return its absolute path. */
async function writeFile(relativePath, content = 'x') {
  const abs = path.join(spaceRoot, relativePath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
  return abs;
}

/** Push a file's mtime into the past so staleness comparisons are unambiguous. */
async function ageFile(relativePath, secondsAgo) {
  const abs = path.join(spaceRoot, relativePath);
  const when = new Date(Date.now() - secondsAgo * 1000);
  await fsp.utimes(abs, when, when);
}

describe('sidecarPathFor — where a PDF\'s text is kept', () => {
  test('is folder-local and keeps the source extension', () => {
    expect(sidecarPathFor(spaceRoot, 'reports/Q3.pdf'))
      .toBe(path.join(spaceRoot, 'reports', '.system', 'derived', 'Q3.pdf.md'));
  });

  test('a PDF and a markdown page of the same stem never collide', () => {
    expect(sidecarPathFor(spaceRoot, 'a/Plan.pdf'))
      .not.toBe(sidecarPathFor(spaceRoot, 'a/Plan.docx'));
  });
});

describe('sidecarStatus', () => {
  test('markdown and text need no sidecar at all', async () => {
    await writeFile('notes.md', '# hi');
    await expect(sidecarStatus(spaceRoot, 'notes.md')).resolves.toBe(SidecarStatus.NOT_APPLICABLE);
  });

  test('pptx wants one but has no Node-side converter', async () => {
    await writeFile('deck.pptx');
    await expect(sidecarStatus(spaceRoot, 'deck.pptx')).resolves.toBe(SidecarStatus.UNSUPPORTED);
  });

  test('a PDF with no sidecar reports missing — this is the corpus-copied-in case', async () => {
    await writeFile('reports/Q3.pdf');
    await expect(sidecarStatus(spaceRoot, 'reports/Q3.pdf')).resolves.toBe(SidecarStatus.MISSING);
  });

  test('a sidecar older than its PDF is stale', async () => {
    await writeFile('reports/Q3.pdf');
    await writeFile('reports/.system/derived/Q3.pdf.md', '# old');
    await ageFile('reports/.system/derived/Q3.pdf.md', 600);
    await expect(sidecarStatus(spaceRoot, 'reports/Q3.pdf')).resolves.toBe(SidecarStatus.STALE);
  });

  test('a sidecar written just after its PDF is current, not stale', async () => {
    await writeFile('reports/Q3.pdf');
    await writeFile('reports/.system/derived/Q3.pdf.md', '# fresh');
    await expect(sidecarStatus(spaceRoot, 'reports/Q3.pdf')).resolves.toBe(SidecarStatus.CURRENT);
  });
});

describe('ensureSidecar', () => {
  test('writes the missing sidecar and leaves the PDF untouched', async () => {
    const pdfAbs = await writeFile('reports/Q3.pdf', 'PDF-BYTES');

    const result = await ensureSidecar(spaceRoot, 'reports/Q3.pdf', { log: silentLogger });

    expect(result.written).toBe(true);
    expect(result.status).toBe(SidecarStatus.WRITTEN);
    expect(fs.readFileSync(result.path, 'utf8')).toContain('Text of Q3.pdf');
    expect(fs.readFileSync(pdfAbs, 'utf8')).toBe('PDF-BYTES');
  });

  test('is idempotent — a current sidecar is not re-converted', async () => {
    await writeFile('reports/Q3.pdf');
    await ensureSidecar(spaceRoot, 'reports/Q3.pdf', { log: silentLogger });
    convertToMarkdown.mockClear();

    const again = await ensureSidecar(spaceRoot, 'reports/Q3.pdf', { log: silentLogger });

    expect(again.written).toBe(false);
    expect(again.status).toBe(SidecarStatus.CURRENT);
    expect(convertToMarkdown).not.toHaveBeenCalled();
  });

  test('force rewrites a current sidecar (the watcher\'s add/change path)', async () => {
    await writeFile('reports/Q3.pdf');
    await ensureSidecar(spaceRoot, 'reports/Q3.pdf', { log: silentLogger });
    convertToMarkdown.mockClear();

    const forced = await ensureSidecar(spaceRoot, 'reports/Q3.pdf', { force: true, log: silentLogger });

    expect(forced.written).toBe(true);
    expect(convertToMarkdown).toHaveBeenCalledTimes(1);
  });

  test('refreshes a stale sidecar', async () => {
    await writeFile('reports/Q3.pdf');
    await writeFile('reports/.system/derived/Q3.pdf.md', '# stale text');
    await ageFile('reports/.system/derived/Q3.pdf.md', 600);

    const result = await ensureSidecar(spaceRoot, 'reports/Q3.pdf', { log: silentLogger });

    expect(result.written).toBe(true);
    expect(fs.readFileSync(result.path, 'utf8')).toContain('Text of Q3.pdf');
  });

  test('a conversion failure resolves, never throws — one bad PDF cannot abort a build', async () => {
    await writeFile('reports/corrupt.pdf');

    const result = await ensureSidecar(spaceRoot, 'reports/corrupt.pdf', { log: silentLogger });

    expect(result.status).toBe(SidecarStatus.FAILED);
    expect(result.written).toBe(false);
    expect(result.error).toMatch(/could not parse/i);
  });

  test('never touches a file whose policy needs no sidecar', async () => {
    await writeFile('notes.md', '# hi');

    const result = await ensureSidecar(spaceRoot, 'notes.md', { log: silentLogger });

    expect(result.written).toBe(false);
    expect(result.status).toBe(SidecarStatus.NOT_APPLICABLE);
    expect(convertToMarkdown).not.toHaveBeenCalled();
  });
});

describe('removeSidecar', () => {
  test('drops the derived text when its original is deleted', async () => {
    await writeFile('reports/Q3.pdf');
    const { path: sidecar } = await ensureSidecar(spaceRoot, 'reports/Q3.pdf', { log: silentLogger });

    await expect(removeSidecar(spaceRoot, 'reports/Q3.pdf')).resolves.toBe(true);
    expect(fs.existsSync(sidecar)).toBe(false);
  });

  test('a sidecar that was never there is not an error', async () => {
    await expect(removeSidecar(spaceRoot, 'reports/none.pdf')).resolves.toBe(false);
  });
});

describe('spaceRootOf', () => {
  test('reads either shape a space record uses', () => {
    expect(spaceRootOf({ path: '/a' })).toBe('/a');
    expect(spaceRootOf({ configuration: { filing: { baseDir: '/b' } } })).toBe('/b');
    expect(spaceRootOf({})).toBeNull();
    expect(spaceRootOf(null)).toBeNull();
  });
});

describe('SearchIndexer — a PDF indexes its text under its OWN path', () => {
  /**
   * Minimal filing wrapper over the temp space root, matching the two methods
   * the indexer uses. Mirrors the real wrapper's dot-folder filter, so `.system`
   * is invisible to the file listing but still readable by path.
   */
  function makeWrapper() {
    const listFiles = (dir = '') => {
      const abs = path.join(spaceRoot, dir);
      const out = [];
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue; // as buildFileTree does
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listFiles(rel));
        else out.push(rel);
      }
      return out;
    };

    return {
      getAllFilesRecursive: jest.fn(async () => listFiles()),
      readDocument: jest.fn(async (_spaceName, relativePath) =>
        fsp.readFile(path.join(spaceRoot, relativePath), 'utf8'))
    };
  }

  /** Token service stub capturing what got indexed, keyed by document id. */
  function makeTokenService() {
    const documents = new Map();
    return {
      documents,
      containers: new Map([['default', { documents }]]),
      indexDocument: jest.fn(async (id, content, storedFields) => {
        documents.set(id, { storedFields, content });
      }),
      removeDocument: jest.fn((id) => documents.delete(id)),
      clearIndex: jest.fn(() => documents.clear()),
      loadFromDisk: jest.fn(async () => false),
      saveToDisk: jest.fn(async () => true),
      getStats: jest.fn(() => ({ totalFiles: documents.size }))
    };
  }

  function makeIndexer(tokenService, wrapper) {
    const spaces = [{ id: 1, name: 'Knowledge', path: spaceRoot }];
    const indexer = new SearchIndexer(
      silentLogger,
      { getAllSpaces: () => spaces },
      tokenService,
      wrapper,
      { appBaseDir: spaceRoot }
    );
    indexer.setDerivedSidecarResolver(async (_spaceName, relativePath) =>
      ensureSidecar(spaceRoot, relativePath, { log: silentLogger }));
    return indexer;
  }

  test('a PDF with no sidecar is repaired during the build and indexes its text', async () => {
    await writeFile('reports/Q3.pdf', 'PDF-BYTES');

    const tokenService = makeTokenService();
    const indexer = makeIndexer(tokenService, makeWrapper());
    await indexer.buildIndex({ force: true });

    // Keyed by the PDF, not the sidecar — this is what makes a search result
    // open the PDF.
    const entry = tokenService.documents.get('reports/Q3.pdf');
    expect(entry).toBeDefined();
    expect(entry.storedFields.type).toBe('pdf');
    expect(entry.storedFields.isIndexed).toBe(true);
    expect(entry.content).toContain('Text of Q3.pdf');

    // The sidecar is never a document of its own.
    expect([...tokenService.documents.keys()]
      .some(id => id.includes('.system'))).toBe(false);

    // …and it now exists on disk for every later read.
    expect(fs.existsSync(path.join(spaceRoot, 'reports/.system/derived/Q3.pdf.md'))).toBe(true);
  });

  test('an existing sidecar is reused, not re-converted', async () => {
    await writeFile('reports/Q3.pdf');
    await writeFile('reports/.system/derived/Q3.pdf.md', '# Prior extraction\n\nquarterly revenue detail');
    convertToMarkdown.mockClear();

    const tokenService = makeTokenService();
    const indexer = makeIndexer(tokenService, makeWrapper());
    await indexer.buildIndex({ force: true });

    expect(convertToMarkdown).not.toHaveBeenCalled();
    expect(tokenService.documents.get('reports/Q3.pdf').content)
      .toContain('quarterly revenue detail');
  });

  test('a PDF that cannot be converted still indexes by name, and is counted', async () => {
    await writeFile('reports/corrupt.pdf');

    const tokenService = makeTokenService();
    const indexer = makeIndexer(tokenService, makeWrapper());
    await indexer.buildIndex({ force: true });

    const entry = tokenService.documents.get('reports/corrupt.pdf');
    expect(entry).toBeDefined();
    expect(entry.storedFields.isIndexed).toBe(false);
    expect(entry.content).toContain('corrupt.pdf'); // name/path header tokens

    const { derived } = await indexer.getStats();
    expect(derived.candidates).toBe(1);
    expect(derived.failed).toBe(1);
    expect(derived.withoutContent).toBe(1);
  });

  test('build stats report how much of the corpus needed repair', async () => {
    await writeFile('a/One.pdf');
    await writeFile('a/Two.pdf');
    await writeFile('a/notes.md', '# plain markdown');

    const tokenService = makeTokenService();
    const indexer = makeIndexer(tokenService, makeWrapper());
    await indexer.buildIndex({ force: true });

    const { derived } = await indexer.getStats();
    expect(derived.resolverWired).toBe(true);
    expect(derived.candidates).toBe(2);   // markdown is not a candidate
    expect(derived.generated).toBe(2);
    expect(derived.withoutContent).toBe(0);
  });

  test('without a resolver the PDF still indexes by name only — the pre-fix behaviour', async () => {
    await writeFile('reports/Q3.pdf');

    const tokenService = makeTokenService();
    const indexer = makeIndexer(tokenService, makeWrapper());
    indexer.setDerivedSidecarResolver(null);
    await indexer.buildIndex({ force: true });

    const entry = tokenService.documents.get('reports/Q3.pdf');
    expect(entry.storedFields.isIndexed).toBe(false);
    expect((await indexer.getStats()).derived.withoutContent).toBe(1);
  });

  test('an incremental update repairs the sidecar too', async () => {
    await writeFile('reports/Q3.pdf');

    const tokenService = makeTokenService();
    const indexer = makeIndexer(tokenService, makeWrapper());
    await indexer.updateFileInSpace('Knowledge', 'reports/Q3.pdf');

    expect(tokenService.documents.get('reports/Q3.pdf').content).toContain('Text of Q3.pdf');
  });
});
