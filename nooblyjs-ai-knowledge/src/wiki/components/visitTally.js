/**
 * @fileoverview Daily visit tally — per user, per content root.
 *
 * WHY THIS EXISTS. `activity.json`'s `recent` list is the only record of what a
 * person has opened, and it cannot answer "how much did they use the app on the
 * 14th" for two structural reasons:
 *
 *   1. IT IS DEDUPED BY PATH. Opening one document forty times replaces the same
 *      entry forty times and leaves ONE record carrying only the last visit.
 *   2. IT IS CAPPED. `userArtifacts.RECENT_LIMIT` is 50 per content root, so a
 *      busy fortnight silently evicts the fortnight before it — and eviction is
 *      indistinguishable from "they were not here".
 *
 * Both are correct for what `recent` is for (a short "jump back to what you were
 * reading" list). Neither is survivable for a usage chart, where an
 * under-reported day looks exactly like a quiet day. So visits are ALSO counted
 * here, in a file that only ever grows:
 *
 *   <content root>/.system/useractivity/<prefix>/visits.json
 *   { "version": 1, "startedAt": "…", "days": { "2026-09-05": { "viewed": 12, "edited": 2 } } }
 *
 * COUNTS, NOT PATHS. The tally is deliberately just numbers per day. It is read
 * by a backoffice usage screen, so keeping the "what did they read" detail in
 * exactly one place — `recent`, which the user can clear themselves — rather
 * than duplicating it into an append-only file is the conservative choice. It is
 * also what keeps the file small enough to read on every request.
 *
 * DAYS ARE LOCAL. `dayKey` uses the server's local calendar day, because the
 * chart is read by a human in that timezone and a UTC boundary would split their
 * evening across two bars.
 *
 * HISTORY. Tallying starts the first time this module records a visit, so it has
 * nothing to say about the past. `series()` therefore merges in what CAN be
 * inferred from `recent` — see the note there. That gives the chart history on
 * the day this ships, with no migration and no seeding step that could
 * double-count.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-09-05
 */

'use strict';

const userStore = require('./userStore');

/** File name inside a user's activity folder. */
const TALLY_FILE = 'visits.json';

/** Days kept. Older buckets are dropped on the next write. */
const RETENTION_DAYS = 400;

/** The two actions `POST /user/visit` reports. Anything else counts as a view. */
const ACTIONS = Object.freeze(['viewed', 'edited']);

/**
 * Local calendar day as `YYYY-MM-DD`.
 *
 * Built from the local getters rather than `toISOString().slice(0, 10)`, which
 * would silently be a UTC day — for a reader east or west of UTC that shifts
 * roughly a third of their activity into the neighbouring bar.
 *
 * @param {Date|string|number} when
 * @return {string} empty string when `when` is unusable
 */
function dayKey(when) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Is `key` a day this module could have written?
 *
 * The shape alone is not enough: `2026-13-99` matches the pattern, sorts
 * plausibly, and would therefore survive pruning forever while matching no day
 * the chart ever asks for. Round-tripping it through a Date settles both
 * questions at once.
 */
function isDayKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return dayKey(new Date(`${key}T00:00:00`)) === key;
}

/** The local day `offset` days before `from`. */
function shiftDays(from, offset) {
  const d = new Date(from instanceof Date ? from.getTime() : new Date(from).getTime());
  d.setDate(d.getDate() - offset);
  return d;
}

/** 'edited' or 'viewed'; anything unrecognised is a view. */
function normaliseAction(action) {
  return action === 'edited' ? 'edited' : 'viewed';
}

/** An empty bucket — always both actions, so callers never guard for undefined. */
function emptyBucket() {
  return { viewed: 0, edited: 0 };
}

/** A tally with nothing in it. */
function emptyTally() {
  return { version: 1, startedAt: null, days: {} };
}

/**
 * Coerce whatever is on disk into the shape above.
 *
 * Anything unusable becomes an empty tally rather than throwing: this file is a
 * counter, and a corrupt counter must not be able to break the visit it was
 * being written for, nor the screen reading it. The next write replaces it.
 *
 * @param {*} raw
 * @return {{version:number, startedAt:?string, days:Object}}
 */
function normalise(raw) {
  const tally = emptyTally();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return tally;

  if (typeof raw.startedAt === 'string') tally.startedAt = raw.startedAt;

  const days = raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const [key, value] of Object.entries(days)) {
    if (!isDayKey(key)) continue;
    const bucket = emptyBucket();
    // A day may legitimately have been stored as a bare number by a hand edit;
    // read that as views rather than discarding the day.
    if (typeof value === 'number') {
      bucket.viewed = Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
    } else if (value && typeof value === 'object') {
      for (const action of ACTIONS) {
        const n = Number(value[action]);
        bucket[action] = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
      }
    }
    if (bucket.viewed || bucket.edited) tally.days[key] = bucket;
  }
  return tally;
}

/** Drop buckets older than RETENTION_DAYS. Mutates and returns `tally`. */
function prune(tally, now = new Date()) {
  const cutoff = dayKey(shiftDays(now, RETENTION_DAYS));
  for (const key of Object.keys(tally.days)) {
    if (key < cutoff) delete tally.days[key];   // ISO dates sort lexicographically
  }
  return tally;
}

/**
 * Serialise work per file.
 *
 * Recording is read-modify-write, so two visits landing together would both read
 * the old counts and the second `writeJson` would rename its file over the
 * first, losing a count. A per-path promise chain costs nothing at this volume
 * and removes the race entirely within a process. (Across processes the atomic
 * rename still guarantees a readable file; only the count can drift, which for a
 * usage chart is invisible.)
 */
const queues = new Map();

function queued(key, task) {
  const previous = queues.get(key) || Promise.resolve();
  // Run regardless of whether the previous task resolved or rejected — one
  // failed write must not stall every later visit for this user.
  const run = previous.then(task, task);
  const settled = run.catch(() => {});
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return run;
}

/**
 * Read a user's tally. Missing file → an empty tally, never a throw.
 *
 * @param {string} baseDir CONTENT ROOT (not the app base dir — these files are
 *   per content root, exactly like activity.json and pins.json)
 * @param {string} identity email, or 'anonymous'
 * @return {Promise<Object>}
 */
async function read(baseDir, identity) {
  try {
    return normalise(await userStore.readJson(baseDir, identity, TALLY_FILE, null));
  } catch (_) {
    return emptyTally();
  }
}

/**
 * Count one visit.
 *
 * @param {string} baseDir content root
 * @param {string} identity email, or 'anonymous'
 * @param {string} action 'viewed' | 'edited'
 * @param {Date} [when]
 * @return {Promise<Object>} the written tally
 */
async function record(baseDir, identity, action, when = new Date()) {
  return queued(`${baseDir}::${userStore.userDir(identity)}`, async () => {
    const tally = await read(baseDir, identity);
    const key = dayKey(when);
    if (!key) return tally;

    const bucket = tally.days[key] || (tally.days[key] = emptyBucket());
    bucket[normaliseAction(action)] += 1;
    if (!tally.startedAt) tally.startedAt = new Date(when).toISOString();

    prune(tally, when);
    await userStore.writeJson(baseDir, identity, TALLY_FILE, tally);
    return tally;
  });
}

/**
 * Per-day counts inferable from a `recent` list.
 *
 * One entry = one visit on its `visitedAt` day. This UNDER-counts (see the file
 * header) and is only ever used as a floor.
 *
 * @param {Array} recent
 * @return {Object} day → bucket
 */
function fromRecent(recent) {
  const days = {};
  for (const entry of Array.isArray(recent) ? recent : []) {
    if (!entry || !entry.visitedAt) continue;
    const key = dayKey(entry.visitedAt);
    if (!key) continue;
    const bucket = days[key] || (days[key] = emptyBucket());
    bucket[normaliseAction(entry.action)] += 1;
  }
  return days;
}

/**
 * Daily counts for a window, oldest bar first.
 *
 * Each day takes the LARGER of the tally and what `recent` implies, per action.
 * That single rule covers both eras with no boundary date to get wrong:
 *
 *   • Before tallying started the tally is 0, so the `recent` floor shows
 *     through and the chart has history immediately.
 *   • Once tallying is on it counts every visit while `recent` counts distinct
 *     documents, so the tally is always the larger of the two and wins.
 *
 * It can never double-count, which a seed-then-increment scheme could.
 *
 * @param {Object} options
 * @param {Object} options.tally normalised tally
 * @param {Array} [options.recent] the user's recent list
 * @param {number} [options.days=30] window length, inclusive of `endDate`
 * @param {Date} [options.endDate] last day of the window (default: today)
 * @return {Array<{date:string, viewed:number, edited:number, total:number}>}
 */
function series({ tally, recent = [], days = 30, endDate = new Date() } = {}) {
  const floor = fromRecent(recent);
  const stored = (tally && tally.days) || {};
  const out = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = dayKey(shiftDays(endDate, offset));
    const a = stored[key] || emptyBucket();
    const b = floor[key] || emptyBucket();
    const viewed = Math.max(a.viewed, b.viewed);
    const edited = Math.max(a.edited, b.edited);
    out.push({ date: key, viewed, edited, total: viewed + edited });
  }
  return out;
}

/** Sum a series into `{ viewed, edited, total, activeDays, busiestDay }`. */
function summarise(points) {
  const rows = Array.isArray(points) ? points : [];
  const totals = { viewed: 0, edited: 0, total: 0, activeDays: 0, busiestDay: null };
  for (const point of rows) {
    totals.viewed += point.viewed;
    totals.edited += point.edited;
    totals.total += point.total;
    if (point.total > 0) totals.activeDays += 1;
    if (!totals.busiestDay || point.total > totals.busiestDay.total) totals.busiestDay = point;
  }
  if (totals.busiestDay && totals.busiestDay.total === 0) totals.busiestDay = null;
  return totals;
}

/**
 * Merge several tallies — one per content root — into one.
 *
 * A person may work across more than one content root, and the usage screen
 * shows them as one person, so the chart adds the roots together.
 *
 * @param {Array<Object>} tallies
 * @return {Object} a normalised tally
 */
function merge(tallies) {
  const out = emptyTally();
  for (const tally of Array.isArray(tallies) ? tallies : []) {
    if (!tally) continue;
    if (tally.startedAt && (!out.startedAt || tally.startedAt < out.startedAt)) {
      out.startedAt = tally.startedAt;
    }
    for (const [key, bucket] of Object.entries(tally.days || {})) {
      const target = out.days[key] || (out.days[key] = emptyBucket());
      target.viewed += bucket.viewed || 0;
      target.edited += bucket.edited || 0;
    }
  }
  return out;
}

module.exports = {
  TALLY_FILE,
  RETENTION_DAYS,
  ACTIONS,
  dayKey,
  isDayKey,
  shiftDays,
  normalise,
  emptyTally,
  prune,
  read,
  record,
  fromRecent,
  series,
  summarise,
  merge
};
