'use strict';

/**
 * Server-side visit capture for document READS (components/readVisit.js).
 *
 * The tally maths lives in visitTally.test.js; what these tests pin is the
 * POLICY readVisit adds on top of it — the reason it exists at all:
 *
 *   1. ONLY READABLE DOCUMENTS COUNT. A markdown/text/code/data/web read is a
 *      view; a 'download' offer (raw office/zip bytes) or a binary asset
 *      (image/pdf/video/audio embedded in a page) is not — nobody read a
 *      document, so nothing is tallied.
 *   2. ONLY IDENTIFIABLE CALLERS COUNT. An anonymous read of a public space is
 *      not attributable to anyone and must not inflate the tally.
 *   3. BULK CALLERS CAN OPT OUT via X-DTK-No-Visit — the escape hatch for a
 *      future indexer/crawler that reads file-content in volume.
 *   4. IT IS BEST EFFORT. A tally that cannot be written must never throw back
 *      into the read it was counting.
 *   5. WHEN IT DOES COUNT, it writes ONE 'viewed' to the space's content-root
 *      tally — the same file POST /user/visit and the usage screen read.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const readVisit = require('../../../src/wiki/components/readVisit');
const visitTally = require('../../../src/wiki/components/visitTally');

/** A content root in a temp dir; the tally lives under `.system/useractivity/`. */
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-visit-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A space record whose content dir is our temp root. */
function space() {
  return { id: 7, name: 'Test Space', path: root, visibility: 'team' };
}

/** Minimal Express request double. */
function makeReq({ email = 'reader@example.com', headers = {} } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    isAuthenticated: () => Boolean(email),
    user: email ? { email } : null,
    headers: lower,
    get(name) { return lower[String(name).toLowerCase()]; }
  };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** Read the stored tally for an identity straight off disk. */
async function storedTally(identity) {
  return visitTally.read(root, identity);
}

describe('shouldRecord', () => {
  test('true for a readable viewer read by an identifiable caller', () => {
    for (const viewer of ['markdown', 'code', 'text', 'data', 'web']) {
      expect(readVisit.shouldRecord(makeReq(), viewer)).toBe(true);
    }
  });

  test('false for non-readable viewers (download/binary assets)', () => {
    for (const viewer of ['download', 'image', 'pdf', 'video', 'audio', 'unknown']) {
      expect(readVisit.shouldRecord(makeReq(), viewer)).toBe(false);
    }
  });

  test('false for an anonymous caller', () => {
    expect(readVisit.shouldRecord(makeReq({ email: null }), 'markdown')).toBe(false);
  });

  test('honours the X-DTK-No-Visit opt-out header', () => {
    expect(readVisit.shouldRecord(makeReq({ headers: { 'X-DTK-No-Visit': '1' } }), 'markdown')).toBe(false);
    expect(readVisit.shouldRecord(makeReq({ headers: { 'x-dtk-no-visit': 'true' } }), 'markdown')).toBe(false);
    // A falsy value is NOT an opt-out — it still counts.
    expect(readVisit.shouldRecord(makeReq({ headers: { 'X-DTK-No-Visit': '0' } }), 'markdown')).toBe(true);
    expect(readVisit.shouldRecord(makeReq({ headers: { 'X-DTK-No-Visit': 'false' } }), 'markdown')).toBe(true);
    expect(readVisit.shouldRecord(makeReq({ headers: { 'X-DTK-No-Visit': '' } }), 'markdown')).toBe(true);
  });
});

describe('identityForRead', () => {
  test('returns the email for an authenticated caller', () => {
    expect(readVisit.identityForRead(makeReq({ email: 'a@b.com' }))).toBe('a@b.com');
  });

  test('returns null (not "anonymous") for an unauthenticated caller', () => {
    expect(readVisit.identityForRead(makeReq({ email: null }))).toBeNull();
  });
});

describe('record', () => {
  test('writes one viewed to the content-root tally for a readable read', async () => {
    await readVisit.record({
      req: makeReq({ email: 'reader@example.com' }),
      space: space(),
      viewerType: 'markdown',
      appBaseDir: root,
      log: noopLog
    });

    const tally = await storedTally('reader@example.com');
    const days = Object.values(tally.days);
    expect(days).toHaveLength(1);
    expect(days[0]).toEqual({ viewed: 1, edited: 0 });
  });

  test('accumulates across reads', async () => {
    const req = makeReq({ email: 'reader@example.com' });
    await readVisit.record({ req, space: space(), viewerType: 'markdown', appBaseDir: root, log: noopLog });
    await readVisit.record({ req, space: space(), viewerType: 'text', appBaseDir: root, log: noopLog });
    await readVisit.record({ req, space: space(), viewerType: 'code', appBaseDir: root, log: noopLog });

    const tally = await storedTally('reader@example.com');
    const total = Object.values(tally.days).reduce((n, b) => n + b.viewed, 0);
    expect(total).toBe(3);
  });

  test('records nothing for a download/binary viewer', async () => {
    for (const viewer of ['download', 'pdf', 'image']) {
      await readVisit.record({
        req: makeReq(), space: space(), viewerType: viewer, appBaseDir: root, log: noopLog
      });
    }
    const tally = await storedTally('reader@example.com');
    expect(Object.keys(tally.days)).toHaveLength(0);
  });

  test('records nothing for an anonymous caller', async () => {
    await readVisit.record({
      req: makeReq({ email: null }), space: space(), viewerType: 'markdown', appBaseDir: root, log: noopLog
    });
    const anon = await storedTally('anonymous');
    expect(Object.keys(anon.days)).toHaveLength(0);
  });

  test('records nothing when the caller opted out', async () => {
    await readVisit.record({
      req: makeReq({ headers: { 'X-DTK-No-Visit': '1' } }),
      space: space(), viewerType: 'markdown', appBaseDir: root, log: noopLog
    });
    const tally = await storedTally('reader@example.com');
    expect(Object.keys(tally.days)).toHaveLength(0);
  });

  test('never throws when the space has no content path — best effort', async () => {
    const warnings = [];
    const log = Object.assign({}, noopLog, { warn: (m) => warnings.push(m) });
    await expect(readVisit.record({
      req: makeReq(),
      space: { id: 9, name: 'No Path' }, // spaceContentDir → null
      viewerType: 'markdown',
      appBaseDir: root,
      log
    })).resolves.toBeUndefined();
    // No path means we simply skip; nothing written, nothing thrown.
    const tally = await storedTally('reader@example.com');
    expect(Object.keys(tally.days)).toHaveLength(0);
  });
});
