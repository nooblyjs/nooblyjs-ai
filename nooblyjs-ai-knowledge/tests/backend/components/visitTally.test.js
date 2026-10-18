'use strict';

/**
 * Daily visit tally — the counter behind the backoffice usage chart.
 *
 * The `recent` list in `activity.json` is deduped by path and capped at 50 per
 * content root, so it can say WHAT somebody read but never HOW MUCH. A chart
 * drawn from it under-reports, and an under-reported day is indistinguishable
 * from a quiet one — which is the whole reason a usage screen exists.
 *
 * These tests pin the four properties that make the chart trustworthy:
 *
 *   1. Days are the SERVER'S LOCAL calendar day, not UTC — a UTC boundary
 *      splits a reader's evening across two bars.
 *   2. Counting is per visit, survives concurrent writes, and never loses a
 *      count to a read-modify-write race.
 *   3. `series()` takes the LARGER of the tally and what `recent` implies, so
 *      history appears immediately on the day this ships and can never be
 *      double-counted once real counting takes over.
 *   4. A corrupt or missing file is an empty tally, never a throw — this file
 *      is written on the request path of every document open.
 */

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const visitTally = require('../../../src/wiki/components/visitTally');
const userStore = require('../../../src/wiki/components/userStore');

/** A content root in a temp dir; the tally lives under `.system/useractivity/`. */
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'visit-tally-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** The file the module writes, read raw. */
function storedFile(identity) {
  return userStore.userPath(root, identity, visitTally.TALLY_FILE);
}

/** A Date at a fixed LOCAL wall-clock time, whatever the runner's timezone. */
function localDate(y, m, d, hh = 12, mm = 0) {
  return new Date(y, m - 1, d, hh, mm, 0);
}

describe('dayKey', () => {
  test('uses the local calendar day, not the UTC one', () => {
    // 23:30 local. In any timezone east of UTC this is already tomorrow in UTC,
    // and west of UTC an early-morning time is still yesterday — either way a
    // `toISOString().slice(0,10)` implementation would name a different day.
    const late = localDate(2026, 9, 5, 23, 30);
    expect(visitTally.dayKey(late)).toBe('2026-09-05');

    const early = localDate(2026, 9, 5, 0, 15);
    expect(visitTally.dayKey(early)).toBe('2026-09-05');
  });

  test('accepts an ISO string and rejects nonsense', () => {
    expect(visitTally.dayKey(localDate(2026, 1, 7).toISOString())).toBe('2026-01-07');
    expect(visitTally.dayKey('not a date')).toBe('');
    expect(visitTally.dayKey(null)).toBe('1970-01-01');   // epoch, but never a throw
  });
});

describe('record', () => {
  test('creates the file and counts the first visit', async () => {
    await visitTally.record(root, 'ana@example.com', 'viewed', localDate(2026, 9, 5));

    const stored = JSON.parse(fs.readFileSync(storedFile('ana@example.com'), 'utf8'));
    expect(stored.days).toEqual({ '2026-09-05': { viewed: 1, edited: 0 } });
    expect(stored.startedAt).toBeTruthy();
  });

  test('files by the email local part, like every other per-user artefact', async () => {
    await visitTally.record(root, 'Ana.Smith@Example.COM', 'viewed', localDate(2026, 9, 5));
    expect(fs.existsSync(path.join(root, '.system', 'useractivity', 'ana.smith', 'visits.json'))).toBe(true);
  });

  test('counts views and edits separately, and treats an unknown action as a view', async () => {
    const day = localDate(2026, 9, 5);
    await visitTally.record(root, 'ana@example.com', 'viewed', day);
    await visitTally.record(root, 'ana@example.com', 'edited', day);
    await visitTally.record(root, 'ana@example.com', 'printed', day);

    const stored = await visitTally.read(root, 'ana@example.com');
    expect(stored.days['2026-09-05']).toEqual({ viewed: 2, edited: 1 });
  });

  test('counts repeat visits to the SAME document — what `recent` cannot do', async () => {
    const day = localDate(2026, 9, 5);
    for (let i = 0; i < 40; i += 1) {
      await visitTally.record(root, 'ana@example.com', 'viewed', day);
    }
    const stored = await visitTally.read(root, 'ana@example.com');
    expect(stored.days['2026-09-05'].viewed).toBe(40);
  });

  test('loses nothing when visits land concurrently', async () => {
    // Read-modify-write without serialisation drops most of these: every call
    // reads the same starting value and the last rename wins.
    const day = localDate(2026, 9, 5);
    await Promise.all(
      Array.from({ length: 25 }, () => visitTally.record(root, 'ana@example.com', 'viewed', day))
    );
    const stored = await visitTally.read(root, 'ana@example.com');
    expect(stored.days['2026-09-05'].viewed).toBe(25);
  });

  test('keeps `startedAt` at the FIRST visit, so the chart can date its own history', async () => {
    await visitTally.record(root, 'ana@example.com', 'viewed', localDate(2026, 9, 1));
    const first = (await visitTally.read(root, 'ana@example.com')).startedAt;

    await visitTally.record(root, 'ana@example.com', 'viewed', localDate(2026, 9, 5));
    expect((await visitTally.read(root, 'ana@example.com')).startedAt).toBe(first);
  });

  test('drops days beyond the retention window on the next write', async () => {
    const now = localDate(2026, 9, 5);
    const ancient = visitTally.shiftDays(now, visitTally.RETENTION_DAYS + 10);

    await visitTally.record(root, 'ana@example.com', 'viewed', ancient);
    await visitTally.record(root, 'ana@example.com', 'viewed', now);

    const stored = await visitTally.read(root, 'ana@example.com');
    expect(Object.keys(stored.days)).toEqual([visitTally.dayKey(now)]);
  });
});

describe('read', () => {
  test('a missing file is an empty tally, not an error', async () => {
    await expect(visitTally.read(root, 'nobody@example.com'))
      .resolves.toEqual({ version: 1, startedAt: null, days: {} });
  });

  test('a corrupt file is an empty tally — this runs on every document open', async () => {
    const file = storedFile('ana@example.com');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{ this is not json', 'utf8');

    await expect(visitTally.read(root, 'ana@example.com')).resolves.toEqual(
      { version: 1, startedAt: null, days: {} });
  });

  test('the next write replaces a corrupt file', async () => {
    const file = storedFile('ana@example.com');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '', 'utf8');            // the zero-byte case seen in production

    await visitTally.record(root, 'ana@example.com', 'viewed', localDate(2026, 9, 5));
    expect((await visitTally.read(root, 'ana@example.com')).days['2026-09-05'].viewed).toBe(1);
  });
});

describe('normalise', () => {
  test('discards malformed day keys and negative counts', () => {
    const cleaned = visitTally.normalise({
      days: {
        '2026-09-05': { viewed: 3, edited: 1 },
        'yesterday': { viewed: 9 },
        '2026-13-99': { viewed: 9 },
        '2026-09-04': { viewed: -5, edited: 'lots' }
      }
    });
    expect(Object.keys(cleaned.days)).toEqual(['2026-09-05']);
  });

  test('reads a hand-edited bare number as views rather than dropping the day', () => {
    const cleaned = visitTally.normalise({ days: { '2026-09-05': 7 } });
    expect(cleaned.days['2026-09-05']).toEqual({ viewed: 7, edited: 0 });
  });

  test('an array or a primitive is an empty tally', () => {
    expect(visitTally.normalise([1, 2, 3]).days).toEqual({});
    expect(visitTally.normalise('nope').days).toEqual({});
    expect(visitTally.normalise(null).days).toEqual({});
  });
});

describe('series', () => {
  const END = localDate(2026, 9, 5);

  test('returns one point per day, oldest first, ending on the window end', () => {
    const points = visitTally.series({ tally: visitTally.emptyTally(), days: 30, endDate: END });
    expect(points).toHaveLength(30);
    expect(points[0].date).toBe('2026-08-07');
    expect(points[29].date).toBe('2026-09-05');
  });

  test('the tally is the count when it has one', () => {
    const points = visitTally.series({
      tally: visitTally.normalise({ days: { '2026-09-05': { viewed: 12, edited: 2 } } }),
      days: 3,
      endDate: END
    });
    expect(points[2]).toEqual({ date: '2026-09-05', viewed: 12, edited: 2, total: 14 });
  });

  test('`recent` shows through for days the tally predates', () => {
    // The point of the merge: on the day this ships the tally is empty, and a
    // chart of nothing would say the platform is unused.
    const points = visitTally.series({
      tally: visitTally.emptyTally(),
      recent: [
        { visitedAt: localDate(2026, 9, 4).toISOString(), action: 'viewed' },
        { visitedAt: localDate(2026, 9, 4).toISOString(), action: 'viewed' },
        { visitedAt: localDate(2026, 9, 4).toISOString(), action: 'edited' }
      ],
      days: 3,
      endDate: END
    });
    expect(points[1]).toEqual({ date: '2026-09-04', viewed: 2, edited: 1, total: 3 });
  });

  test('never double-counts: the tally wins wherever it is larger', () => {
    // The same day seen both ways. `recent` holds one entry per DOCUMENT; the
    // tally holds every VISIT. Summing them would inflate the day by the number
    // of distinct documents, which is exactly the bug the max rule avoids.
    const points = visitTally.series({
      tally: visitTally.normalise({ days: { '2026-09-05': { viewed: 12, edited: 0 } } }),
      recent: [
        { visitedAt: localDate(2026, 9, 5).toISOString(), action: 'viewed' },
        { visitedAt: localDate(2026, 9, 5).toISOString(), action: 'viewed' }
      ],
      days: 1,
      endDate: END
    });
    expect(points[0].viewed).toBe(12);
  });

  test('ignores entries outside the window and unusable timestamps', () => {
    const points = visitTally.series({
      tally: visitTally.emptyTally(),
      recent: [
        { visitedAt: localDate(2026, 1, 1).toISOString(), action: 'viewed' },   // too old
        { visitedAt: 'never', action: 'viewed' },
        { action: 'viewed' },
        null
      ],
      days: 7,
      endDate: END
    });
    expect(points.every((point) => point.total === 0)).toBe(true);
  });
});

describe('summarise', () => {
  test('totals the window and names the busiest day', () => {
    const totals = visitTally.summarise([
      { date: '2026-09-03', viewed: 0, edited: 0, total: 0 },
      { date: '2026-09-04', viewed: 2, edited: 0, total: 2 },
      { date: '2026-09-05', viewed: 4, edited: 1, total: 5 }
    ]);
    expect(totals).toEqual({
      viewed: 6, edited: 1, total: 7, activeDays: 2,
      busiestDay: { date: '2026-09-05', viewed: 4, edited: 1, total: 5 }
    });
  });

  test('an empty window has no busiest day rather than a zero one', () => {
    const totals = visitTally.summarise([{ date: '2026-09-05', viewed: 0, edited: 0, total: 0 }]);
    expect(totals.busiestDay).toBeNull();
    expect(totals.activeDays).toBe(0);
  });
});

describe('merge', () => {
  test('adds the roots together and keeps the earliest start', () => {
    const merged = visitTally.merge([
      { startedAt: '2026-09-01T00:00:00.000Z', days: { '2026-09-05': { viewed: 3, edited: 0 } } },
      { startedAt: '2026-08-01T00:00:00.000Z', days: { '2026-09-05': { viewed: 4, edited: 2 } } },
      null
    ]);
    expect(merged.days['2026-09-05']).toEqual({ viewed: 7, edited: 2 });
    expect(merged.startedAt).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('per content root, like every other per-user artefact', () => {
  test('two roots keep separate files and are combined only on read', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'visit-tally-b-'));
    try {
      const day = localDate(2026, 9, 5);
      await visitTally.record(root, 'ana@example.com', 'viewed', day);
      await visitTally.record(other, 'ana@example.com', 'edited', day);

      expect((await visitTally.read(root, 'ana@example.com')).days['2026-09-05'])
        .toEqual({ viewed: 1, edited: 0 });
      expect((await visitTally.read(other, 'ana@example.com')).days['2026-09-05'])
        .toEqual({ viewed: 0, edited: 1 });

      const combined = visitTally.merge([
        await visitTally.read(root, 'ana@example.com'),
        await visitTally.read(other, 'ana@example.com')
      ]);
      expect(combined.days['2026-09-05']).toEqual({ viewed: 1, edited: 1 });
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
