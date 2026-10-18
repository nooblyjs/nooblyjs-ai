/**
 * @fileoverview Home-seed marker — the provenance that lets the context build refresh
 * a folder home it wrote without ever touching one a person wrote.
 *
 * The build seeds `<folder>/.home.md` from the folder's context roll-up. That page
 * describes the folder, so it goes stale as documents are added — but a page on disk
 * carries no record of its author, and for a long time the build's only safe answer was
 * to never overwrite an existing home at all, freezing every seeded page at version one.
 *
 * `<folder>/.system/home-seed.json` records a hash of exactly what was written, turning
 * that guess into a fact. These tests pin the two halves the platform owns:
 *
 *   1. the marker's LAYOUT (`filePolicy`), which `contextProcessor.js` in the sibling
 *      noobly-app-wiki-workflows repo must resolve identically;
 *   2. the DECISION TABLE the build applies, re-implemented here against a real temp
 *      tree. The build itself lives in the other repo, so this is the executable
 *      statement of the contract it has to satisfy — every branch that is not
 *      "provably ours and unchanged" must leave the page alone.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  SYSTEM_DIR,
  HOME_FILE_NAMES,
  SEEDED_HOME_FILE,
  HOME_SEED_FILE,
  toHomeSeedRelPath,
  folderForHomeSeedRelPath,
  isSeededHomeRelPath,
  isSpaceScopedSystemPath,
  toContextRelPath,
} = require('../../../src/shared/utils/filePolicy');

const {
  artifactRelPathsFor,
  removeDocumentArtifacts,
} = require('../../../src/wiki/utils/documentArtifacts');

const {
  isHiddenPath,
  isSeededHomeDelete,
} = require('../../../src/wiki/activities/artifactCleanup');

describe('filePolicy — home-seed marker layout', () => {
  test('the marker sits in the folder\'s own .system, beside file-order.json', () => {
    expect(HOME_SEED_FILE).toBe('home-seed.json');
    expect(toHomeSeedRelPath('Standards')).toBe('Standards/.system/home-seed.json');
    expect(toHomeSeedRelPath('A/B/C')).toBe('A/B/C/.system/home-seed.json');
  });

  test('the space root is just another folder', () => {
    expect(toHomeSeedRelPath('')).toBe('.system/home-seed.json');
    expect(toHomeSeedRelPath('/')).toBe('.system/home-seed.json');
  });

  test('windows separators are normalised', () => {
    expect(toHomeSeedRelPath('A\\B')).toBe('A/B/.system/home-seed.json');
  });

  test('round-trips back to its owning folder', () => {
    for (const folder of ['', 'Standards', 'A/B/C']) {
      expect(folderForHomeSeedRelPath(toHomeSeedRelPath(folder))).toBe(folder);
    }
    expect(folderForHomeSeedRelPath('Standards/.system/context/x.md')).toBeNull();
  });

  test('it is folder-level metadata, NOT one of the space-scoped dirs', () => {
    // Space-scoped means "belongs to the space rather than to this folder". Every
    // folder may carry its own marker, so treating it as space-scoped would make the
    // root's copy answer for the whole tree.
    expect(isSpaceScopedSystemPath(toHomeSeedRelPath(''))).toBe(false);
    expect(isSpaceScopedSystemPath(toHomeSeedRelPath('Standards'))).toBe(false);
  });

  test('it cannot collide with a document sidecar', () => {
    // Context sidecars live one level deeper, so no document — however named — can
    // ever resolve onto the marker.
    expect(toContextRelPath(`Standards/${HOME_SEED_FILE}`))
      .not.toBe(toHomeSeedRelPath('Standards'));
    expect(toHomeSeedRelPath('Standards').startsWith(`Standards/${SYSTEM_DIR}/`)).toBe(true);
  });

  describe('only .home.md is ever seeded', () => {
    test('the seeded name is the dot-prefixed one', () => {
      expect(SEEDED_HOME_FILE).toBe('.home.md');
      expect(HOME_FILE_NAMES[0]).toBe(SEEDED_HOME_FILE);
      expect(HOME_FILE_NAMES).toEqual(['.home.md', 'home.md', 'Home.md']);
    });

    test('a hand-made home.md / Home.md is never treated as seeded output', () => {
      expect(isSeededHomeRelPath('Standards/.home.md')).toBe(true);
      expect(isSeededHomeRelPath('.home.md')).toBe(true);
      expect(isSeededHomeRelPath('Standards/home.md')).toBe(false);
      expect(isSeededHomeRelPath('Standards/Home.md')).toBe(false);
      expect(isSeededHomeRelPath('Standards/Report.md')).toBe(false);
    });
  });
});

describe('documentArtifacts — the marker is deleted with the page', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-seed-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const write = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  };
  const exists = (rel) => fs.existsSync(path.join(root, rel));

  test('a seeded home claims its marker as an artifact', () => {
    expect(artifactRelPathsFor('Standards/.home.md'))
      .toContain('Standards/.system/home-seed.json');
    expect(artifactRelPathsFor('.home.md')).toContain('.system/home-seed.json');
  });

  test('an ordinary document does not — the marker is not its to drop', () => {
    expect(artifactRelPathsFor('Standards/Report.md'))
      .not.toContain('Standards/.system/home-seed.json');
    // Nor does a hand-written home page, which never owned a marker.
    expect(artifactRelPathsFor('Standards/home.md'))
      .not.toContain('Standards/.system/home-seed.json');
  });

  test('deleting the page removes the marker', async () => {
    write('Standards/.home.md', '# Standards\n');
    write('Standards/.system/home-seed.json', '{"hash":"abc"}');

    const { removed } = await removeDocumentArtifacts(root, 'Standards/.home.md');

    expect(removed).toContain('Standards/.system/home-seed.json');
    expect(exists('Standards/.system/home-seed.json')).toBe(false);
  });

  test('it leaves the folder\'s other .system contents alone', async () => {
    write('Standards/.home.md', '# Standards\n');
    write('Standards/.system/home-seed.json', '{"hash":"abc"}');
    write('Standards/.system/file-order.json', '["a.md"]');
    write('Standards/.system/derived/Report.pdf.md', 'text');

    await removeDocumentArtifacts(root, 'Standards/.home.md');

    expect(exists('Standards/.system/file-order.json')).toBe(true);
    expect(exists('Standards/.system/derived/Report.pdf.md')).toBe(true);
  });
});

describe('artifactCleanup — the one hidden path worth reacting to', () => {
  test('a seeded home is let through despite its leading dot', () => {
    expect(isHiddenPath('Standards/.home.md')).toBe(true);
    expect(isSeededHomeDelete('Standards/.home.md')).toBe(true);
    expect(isSeededHomeDelete('.home.md')).toBe(true);
  });

  test('a .home.md inside a hidden namespace stays excluded', () => {
    // Letting a basename override the namespace rule would reopen the hole
    // isHiddenPath exists to close — `.system` churn is the cleanup's own output.
    expect(isSeededHomeDelete('Standards/.system/.home.md')).toBe(false);
    expect(isSeededHomeDelete('Standards/.aicontext/.home.md')).toBe(false);
    expect(isSeededHomeDelete('.system/templates/.home.md')).toBe(false);
  });

  test('nothing else about the gate moved', () => {
    expect(isSeededHomeDelete('Standards/home.md')).toBe(false);
    expect(isSeededHomeDelete('Standards/Report.md')).toBe(false);
    expect(isSeededHomeDelete('Standards/.system/context/Report.md')).toBe(false);
  });
});

/**
 * The decision table `ensureFolderHome` must implement. The build lives in the sibling
 * workflows repo, so this re-implements the RULE (not the AI, the tree walk or the
 * roll-up) against a real temp tree — the executable statement of the contract, and the
 * thing to check first if a seeded page ever stops refreshing, or worse, a hand-written
 * one starts being overwritten.
 */
describe('the provenance rule (contract for contextProcessor.ensureFolderHome)', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-rule-'));
    fs.mkdirSync(path.join(root, 'Standards'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** The hash the build takes: CRLF normalised so a git checkout can't fake an edit. */
  const hashHome = (text) => crypto.createHash('sha1')
    .update(String(text == null ? '' : text).replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex');

  const abs = (rel) => path.join(root, rel);
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), body, 'utf8');
  };
  const read = (rel) => fs.readFileSync(abs(rel), 'utf8');

  /** Mirror of ensureFolderHome's guard + write, minus the roll-up generation. */
  function ensureFolderHome(folder, rollup) {
    const dir = folder ? abs(folder) : root;
    const homePath = path.join(dir, SEEDED_HOME_FILE);
    const seedPath = path.join(dir, SYSTEM_DIR, HOME_SEED_FILE);

    const present = HOME_FILE_NAMES.filter((n) => fs.existsSync(path.join(dir, n)));
    let seed = null;
    if (present.length) {
      if (present.length > 1 || present[0] !== SEEDED_HOME_FILE) return false;
      try {
        seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      } catch {
        return false;
      }
      if (!seed || typeof seed.hash !== 'string') return false;
      if (hashHome(fs.readFileSync(homePath, 'utf8')) !== seed.hash) return false;
    }

    const hash = hashHome(rollup);
    if (seed && hash === seed.hash) return false;

    fs.mkdirSync(path.dirname(seedPath), { recursive: true });
    fs.writeFileSync(homePath, rollup, 'utf8');
    fs.writeFileSync(seedPath, JSON.stringify({ file: SEEDED_HOME_FILE, hash }), 'utf8');
    return true;
  }

  test('no home file → seeded, and the marker records what was written', () => {
    expect(ensureFolderHome('Standards', '# v1\n')).toBe(true);
    expect(read('Standards/.home.md')).toBe('# v1\n');
    expect(JSON.parse(read('Standards/.system/home-seed.json')).hash).toBe(hashHome('# v1\n'));
  });

  test('★ ours and untouched → REFRESHED (the whole point of the marker)', () => {
    ensureFolderHome('Standards', '# v1\n');
    expect(ensureFolderHome('Standards', '# v2 with the new documents\n')).toBe(true);
    expect(read('Standards/.home.md')).toBe('# v2 with the new documents\n');
  });

  test('refreshing repeatedly keeps working — ownership is not spent on first use', () => {
    ensureFolderHome('Standards', '# v1\n');
    ensureFolderHome('Standards', '# v2\n');
    expect(ensureFolderHome('Standards', '# v3\n')).toBe(true);
    expect(read('Standards/.home.md')).toBe('# v3\n');
  });

  test('★ edited by hand → left alone, permanently', () => {
    ensureFolderHome('Standards', '# v1\n');
    put('Standards/.home.md', '# My own words\n');

    expect(ensureFolderHome('Standards', '# v2\n')).toBe(false);
    expect(read('Standards/.home.md')).toBe('# My own words\n');
    // And it stays refused on every later run, not just the next one.
    expect(ensureFolderHome('Standards', '# v3\n')).toBe(false);
    expect(read('Standards/.home.md')).toBe('# My own words\n');
  });

  test('no marker → hand-written or pre-dating provenance, so hands off', () => {
    put('Standards/.home.md', '# Written before any of this existed\n');
    expect(ensureFolderHome('Standards', '# v2\n')).toBe(false);
    expect(read('Standards/.home.md')).toBe('# Written before any of this existed\n');
  });

  test('a corrupt marker fails to "not ours", never to "overwrite"', () => {
    ensureFolderHome('Standards', '# v1\n');
    put('Standards/.system/home-seed.json', '{ this is not json');
    expect(ensureFolderHome('Standards', '# v2\n')).toBe(false);
    expect(read('Standards/.home.md')).toBe('# v1\n');
  });

  test('a marker with no hash is not proof of anything', () => {
    ensureFolderHome('Standards', '# v1\n');
    put('Standards/.system/home-seed.json', JSON.stringify({ file: '.home.md' }));
    expect(ensureFolderHome('Standards', '# v2\n')).toBe(false);
  });

  test('a hand-written home.md is never seeded over, marker or not', () => {
    put('Standards/home.md', '# The real landing page\n');
    expect(ensureFolderHome('Standards', '# v1\n')).toBe(false);
    expect(fs.existsSync(abs('Standards/.home.md'))).toBe(false);
  });

  test('a home.md beside a seeded .home.md wins the display, so no churn', () => {
    ensureFolderHome('Standards', '# v1\n');
    put('Standards/home.md', '# The real landing page\n');
    expect(ensureFolderHome('Standards', '# v2\n')).toBe(false);
    expect(read('Standards/.home.md')).toBe('# v1\n');
  });

  test('an unchanged roll-up writes nothing, so the mtime keeps meaning something', () => {
    ensureFolderHome('Standards', '# v1\n');
    expect(ensureFolderHome('Standards', '# v1\n')).toBe(false);
  });

  test('a CRLF round-trip through git is not mistaken for an edit', () => {
    ensureFolderHome('Standards', '# v1\nline two\n');
    put('Standards/.home.md', '# v1\r\nline two\r\n');   // autocrlf checkout
    expect(ensureFolderHome('Standards', '# v2\n')).toBe(true);
  });

  test('deleting the page and its marker gets a fresh one — the reader\'s escape hatch', async () => {
    ensureFolderHome('Standards', '# v1\n');
    put('Standards/.home.md', '# My own words\n');
    expect(ensureFolderHome('Standards', '# v2\n')).toBe(false);

    await removeDocumentArtifacts(root, 'Standards/.home.md');
    fs.unlinkSync(abs('Standards/.home.md'));

    expect(ensureFolderHome('Standards', '# v2\n')).toBe(true);
    expect(read('Standards/.home.md')).toBe('# v2\n');
  });

  test('the space root is just another folder', () => {
    expect(ensureFolderHome('', '# Space\n')).toBe(true);
    expect(read('.home.md')).toBe('# Space\n');
    expect(ensureFolderHome('', '# Space v2\n')).toBe(true);
  });
});
