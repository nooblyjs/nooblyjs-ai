/**
 * @fileoverview A user-typed file name reaches disk VERBATIM.
 *
 * The regression this locks down: `POST /applications/wiki/api/documents`
 * derived the file name by slugifying the title —
 * `toLowerCase().replace(/[^a-z0-9]+/g, '-')` — so `.Engineering.md` was created
 * as `engineering.md`. Every part of that mattered:
 *
 *   • the LEADING DOT is identity, not decoration. A hidden root-level
 *     `.<space>.md` is how the several spaces sharing one content root each keep
 *     their own landing page (spaceHomeCandidates), so eating the dot did not
 *     rename the file, it created a different one that no space resolves;
 *   • CASE and SPACES are what the author chose and what they will search for.
 *
 * So the contract is: honour the name, reject only what a filesystem cannot
 * store, and never silently rewrite. The one addition — a default `.md` for a
 * name with no extension — is additive and is reported back in `path`.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_NAME_LENGTH,
  sanitizeFileName,
  toDocumentFileName,
  titleFromFileName
} = require('../../../src/shared/utils/fileNaming');

const CREATE_ROUTE = 'POST /applications/wiki/api/documents';

/** Minimal Express double: records handlers by "METHOD path". */
function makeApp() {
  const routes = new Map();
  const record = (method) => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers[handlers.length - 1]);
  };
  return { get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE'), routes };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; }
  };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

describe('file naming — the name the user typed', () => {
  describe('sanitizeFileName', () => {
    test.each([
      ['.Engineering.md', '.Engineering.md'],
      ['.Engineering', '.Engineering'],
      ['Meeting Notes.md', 'Meeting Notes.md'],
      ['Q3 2026 Plan v1.2.md', 'Q3 2026 Plan v1.2.md'],
      ['ADR-014 Event Bus.md', 'ADR-014 Event Bus.md'],
      ['  Trimmed.md  ', 'Trimmed.md']
    ])('%s survives as %s', (input, expected) => {
      expect(sanitizeFileName(input)).toBe(expected);
    });

    test('case, dots and spaces are all preserved together', () => {
      // The three things the old slug destroyed, in one name.
      expect(sanitizeFileName('.Engineering Home Page.md')).toBe('.Engineering Home Page.md');
    });

    test.each([
      ['', 'empty'],
      ['   ', 'whitespace only'],
      ['..', 'parent traversal'],
      ['.', 'current directory'],
      ['sub/Notes.md', 'forward slash'],
      ['sub\\Notes.md', 'backslash'],
      ['Notes?.md', 'illegal character'],
      ['Notes<1>.md', 'illegal characters'],
      ['CON.md', 'reserved device name'],
      ['Notes.', 'trailing dot is dropped by Windows']
    ])('%s is rejected (%s)', (input) => {
      expect(() => sanitizeFileName(input)).toThrow(
        expect.objectContaining({ code: 'INVALID_FILE_NAME' })
      );
    });

    test('outer whitespace is trimmed rather than rejected', () => {
      // Windows would drop a trailing space anyway, so the file could never
      // carry it; trimming is invisible, not a rewrite of the chosen name.
      expect(sanitizeFileName('Notes.md ')).toBe('Notes.md');
      expect(sanitizeFileName(' .Engineering.md')).toBe('.Engineering.md');
    });

    test('a path separator is REJECTED, never quietly reduced to a basename', () => {
      // Taking the basename would file the document somewhere other than the
      // folder the user picked, with no indication that it had happened.
      expect(() => sanitizeFileName('../../etc/passwd')).toThrow(/path separator/);
    });

    test('a name longer than the filesystem allows is rejected', () => {
      expect(() => sanitizeFileName('x'.repeat(MAX_NAME_LENGTH + 1))).toThrow(/longer than/);
    });
  });

  describe('toDocumentFileName', () => {
    test.each([
      ['.Engineering.md', '.Engineering.md'],
      ['.Engineering', '.Engineering.md'],
      ['Meeting Notes', 'Meeting Notes.md'],
      ['Meeting Notes.md', 'Meeting Notes.md'],
      ['notes.txt', 'notes.txt'],
      ['config.json', 'config.json'],
      ['deploy.sh', 'deploy.sh']
    ])('%s -> %s', (input, expected) => {
      expect(toDocumentFileName(input)).toBe(expected);
    });

    test('a version number is not mistaken for an extension', () => {
      // path.extname('Q3 Plan v1.2') is '.2'. Treating "has a dot" as "has an
      // extension" would leave this document with no extension at all.
      expect(toDocumentFileName('Q3 Plan v1.2')).toBe('Q3 Plan v1.2.md');
    });

    test('a binary extension still gets .md — this route writes text', () => {
      expect(toDocumentFileName('Report.pdf')).toBe('Report.pdf.md');
    });
  });

  describe('titleFromFileName', () => {
    test.each([
      ['.Engineering.md', 'Engineering'],
      ['Meeting Notes.md', 'Meeting Notes'],
      ['notes.txt', 'notes'],
      ['.Engineering', 'Engineering']
    ])('%s -> %s', (input, expected) => {
      expect(titleFromFileName(input)).toBe(expected);
    });
  });
});

describe('POST /applications/wiki/api/documents', () => {
  let appBaseDir;
  let spaceRoot;
  let routes;

  beforeEach(() => {
    appBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-create-'));
    spaceRoot = path.join(appBaseDir, 'content');
    fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
    fs.mkdirSync(path.join(spaceRoot, 'Standards'), { recursive: true });

    const spaces = [{ id: 1, name: 'Engineering', visibility: 'public', path: spaceRoot }];
    fs.writeFileSync(
      path.join(appBaseDir, 'spaces', 'spaces.json'), JSON.stringify(spaces), 'utf8');

    const app = makeApp();
    require('../../../src/wiki/routes/documentRoutes')({ app }, null, {
      dataManager: { read: async () => spaces },
      cache: { delete: async () => {} },
      log: noopLog,
      searchIndexer: { updateFileInSpace: async () => {} },
      documentService: {},
      appBaseDir
    });
    routes = app.routes;
  });

  afterEach(() => {
    fs.rmSync(appBaseDir, { recursive: true, force: true });
  });

  const authedReq = (body) => ({
    isAuthenticated: () => true,
    user: { email: 'a@b.c', role: 'admin' },
    query: {},
    body
  });

  async function create(body) {
    const handler = routes.get(CREATE_ROUTE);
    expect(typeof handler).toBe('function');
    const res = makeRes();
    await handler(authedReq(body), res);
    return res;
  }

  test('.Engineering.md is created as .Engineering.md', async () => {
    const res = await create({ fileName: '.Engineering.md', spaceId: 1, content: '# Hi' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.path).toBe('.Engineering.md');
    expect(fs.existsSync(path.join(spaceRoot, '.Engineering.md'))).toBe(true);
    // The name the slug used to produce must NOT appear.
    expect(fs.existsSync(path.join(spaceRoot, 'engineering.md'))).toBe(false);
  });

  test('spaces and case survive inside a folder', async () => {
    const res = await create({
      fileName: 'Solution Design Notes.md', folderPath: 'Standards', spaceId: 1, content: 'x'
    });

    expect(res.body.path).toBe('Standards/Solution Design Notes.md');
    expect(fs.existsSync(path.join(spaceRoot, 'Standards', 'Solution Design Notes.md'))).toBe(true);
  });

  test('a name with no extension gets .md, and the response says so', async () => {
    const res = await create({ fileName: 'Meeting Notes', spaceId: 1, content: 'x' });

    expect(res.body.path).toBe('Meeting Notes.md');
    expect(fs.existsSync(path.join(spaceRoot, 'Meeting Notes.md'))).toBe(true);
  });

  test('a non-markdown text extension is honoured, not forced to .md', async () => {
    const res = await create({ fileName: 'runbook.sh', spaceId: 1, content: 'echo hi' });

    expect(res.body.path).toBe('runbook.sh');
    expect(fs.existsSync(path.join(spaceRoot, 'runbook.sh'))).toBe(true);
  });

  test('an unusable name answers 400 with a reason, and writes nothing', async () => {
    const res = await create({ fileName: 'bad?name.md', spaceId: 1, content: 'x' });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/< > : " \| \? \*/);
    expect(fs.readdirSync(spaceRoot).filter(n => n.includes('name'))).toEqual([]);
  });

  test('a separator in the name cannot escape the chosen folder', async () => {
    const res = await create({ fileName: '../escaped.md', folderPath: 'Standards', spaceId: 1 });

    expect(res.statusCode).toBe(400);
    expect(fs.existsSync(path.join(appBaseDir, 'escaped.md'))).toBe(false);
    expect(fs.existsSync(path.join(spaceRoot, 'escaped.md'))).toBe(false);
  });

  test('the seeded heading uses the readable title, not the raw file name', async () => {
    await create({ fileName: '.Engineering.md', spaceId: 1 });

    const written = fs.readFileSync(path.join(spaceRoot, '.Engineering.md'), 'utf8');
    expect(written).toMatch(/^# Engineering\n/);
  });

  test('an explicit path is still taken as given (folder home, templates)', async () => {
    const res = await create({
      title: '.home', path: 'Standards/.home.md', spaceId: 1, content: '# Folder home'
    });

    expect(res.body.path).toBe('Standards/.home.md');
    expect(fs.existsSync(path.join(spaceRoot, 'Standards', '.home.md'))).toBe(true);
  });

  test('a legacy title-only caller still creates a file, now unmangled', async () => {
    const res = await create({ title: 'Legacy Caller', spaceId: 1, content: 'x' });

    expect(res.body.path).toBe('Legacy Caller.md');
  });

  describe('create does not overwrite', () => {
    test('an existing document answers 409 and its content is untouched', async () => {
      const target = path.join(spaceRoot, 'Standards', 'Charter.md');
      fs.writeFileSync(target, '# Charter\n\nA year of work.', 'utf8');

      const res = await create({
        fileName: 'Charter.md', folderPath: 'Standards', spaceId: 1, content: ''
      });

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/);
      expect(res.body.path).toBe('Standards/Charter.md');
      // The actual regression: writeFile truncates, so this used to come back
      // as the seeded placeholder while reporting success.
      expect(fs.readFileSync(target, 'utf8')).toBe('# Charter\n\nA year of work.');
    });

    test('the conflict is detected AFTER the name is normalised', async () => {
      // `Charter` and `Charter.md` are the same document once the default
      // extension is applied — checking the raw input would miss it.
      fs.writeFileSync(path.join(spaceRoot, 'Charter.md'), 'original', 'utf8');

      const res = await create({ fileName: 'Charter', spaceId: 1, content: 'replacement' });

      expect(res.statusCode).toBe(409);
      expect(fs.readFileSync(path.join(spaceRoot, 'Charter.md'), 'utf8')).toBe('original');
    });

    test('a name differing only in CASE is a separate document', async () => {
      // Preserving case means `Charter.md` and `charter.md` are distinct names.
      // On a case-insensitive filesystem the second is a conflict; on a
      // case-sensitive one it is a new file. Both are correct — what must never
      // happen is silently truncating whichever one is already there.
      fs.writeFileSync(path.join(spaceRoot, 'Charter.md'), 'original', 'utf8');

      const res = await create({ fileName: 'charter.md', spaceId: 1, content: 'second' });

      if (res.statusCode === 409) {
        expect(fs.readFileSync(path.join(spaceRoot, 'Charter.md'), 'utf8')).toBe('original');
      } else {
        expect(res.statusCode).toBe(200);
        expect(fs.readFileSync(path.join(spaceRoot, 'Charter.md'), 'utf8')).toBe('original');
        expect(fs.readFileSync(path.join(spaceRoot, 'charter.md'), 'utf8')).toBe('second');
      }
    });

    test('a conflict leaves no folders behind', async () => {
      fs.writeFileSync(path.join(spaceRoot, 'Charter.md'), 'original', 'utf8');
      const before = fs.readdirSync(spaceRoot).sort();

      await create({ fileName: 'Charter.md', spaceId: 1 });

      expect(fs.readdirSync(spaceRoot).sort()).toEqual(before);
    });

    test('an existing FOLDER of the same name is also refused', async () => {
      const res = await create({ fileName: 'Standards', spaceId: 1, content: 'x' });
      expect(res.statusCode).toBe(200); // 'Standards' -> 'Standards.md', no clash

      const clash = await create({ path: 'Standards', spaceId: 1, content: 'x' });
      expect(clash.statusCode).toBe(409);
      expect(fs.statSync(path.join(spaceRoot, 'Standards')).isDirectory()).toBe(true);
    });

    test('an explicit template path does not overwrite either', async () => {
      const tplDir = path.join(spaceRoot, '.system', 'templates');
      fs.mkdirSync(tplDir, { recursive: true });
      fs.writeFileSync(path.join(tplDir, 'adr.md'), '# ADR\n\ncurated', 'utf8');

      const res = await create({
        title: 'ADR', path: '.system/templates/adr.md', spaceId: 1, content: '# blank'
      });

      expect(res.statusCode).toBe(409);
      expect(fs.readFileSync(path.join(tplDir, 'adr.md'), 'utf8')).toBe('# ADR\n\ncurated');
    });
  });

  describe('template names (the Templates hub)', () => {
    // The hub sends the template DIRECTORY as folderPath and the typed name as
    // fileName, rather than composing a slugged path itself — so a template
    // keeps the name its author gave it. That matters more here than for an
    // ordinary document: the cascade shadows an ancestor's template BY NAME, so
    // an unpredictable file name is one the author cannot deliberately override.
    test('a space template keeps its name as typed', async () => {
      const res = await create({
        title: 'ADR Record', fileName: 'ADR Record',
        folderPath: '.system/templates', spaceId: 1, content: '# ADR Record'
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.path).toBe('.system/templates/ADR Record.md');
      expect(fs.existsSync(path.join(spaceRoot, '.system', 'templates', 'ADR Record.md'))).toBe(true);
      // Recognised as a template, so it is not registered as a wiki document.
      expect(res.body.message).toMatch(/Template created/);
      expect(res.body.document).toBeUndefined();
    });

    test('a folder template keeps its name and shadows by that name', async () => {
      const res = await create({
        title: 'ADR Record', fileName: 'ADR Record',
        folderPath: 'Standards/.system/templates', spaceId: 1, content: '# Local ADR'
      });

      expect(res.body.path).toBe('Standards/.system/templates/ADR Record.md');
      // Same base name as the space-level tier — which is what lets the nearer
      // folder override the space-wide template.
      expect(path.basename(res.body.path)).toBe('ADR Record.md');
    });

    test('a template name with unusable characters is refused, not slugged', async () => {
      const res = await create({
        title: 'Q&A: Standards', fileName: 'Q&A: Standards',
        folderPath: '.system/templates', spaceId: 1
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/< > : " \| \? \*/);
    });

    test('space-tier RBAC still applies to the composed path', async () => {
      const handler = routes.get(CREATE_ROUTE);
      const res = makeRes();
      await handler({
        isAuthenticated: () => true,
        user: { email: 'nobody@example.com', role: 'user' },
        query: {},
        body: {
          title: 'Sneaky', fileName: 'Sneaky',
          folderPath: '.system/templates', spaceId: 1, content: 'x'
        }
      }, res);

      expect(res.statusCode).toBe(403);
      expect(fs.existsSync(path.join(spaceRoot, '.system', 'templates', 'Sneaky.md'))).toBe(false);
    });
  });

  test('creating a document requires authentication', async () => {
    const handler = routes.get(CREATE_ROUTE);
    const res = makeRes();
    await handler({ isAuthenticated: () => false, query: {}, body: { fileName: 'x.md' } }, res);

    expect(res.statusCode).toBe(401);
  });
});
