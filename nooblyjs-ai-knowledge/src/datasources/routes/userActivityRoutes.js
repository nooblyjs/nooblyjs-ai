/**
 * @fileoverview User Activity API — the read side of the backoffice usage screen.
 *
 * Answers two questions for a Datasources Administrator: who is using the wiki,
 * and what has one person been reading.
 *
 *   GET /api/user-activity            every known user + a usage summary
 *   GET /api/user-activity/:userKey   one user: their visits and a daily series
 *
 * READ-ONLY, and it writes nothing anywhere.
 *
 * WHERE THE DATA COMES FROM. Per-user artefacts live per CONTENT ROOT, not per
 * space — several spaces are lenses over one directory (see
 * shared/spaces/contentRoot.js), and Engineering / Financial Services / People /
 * Retail all share `knowledge-content/engineering`. So this walks the DISTINCT
 * roots and reads, for each user folder it finds there:
 *
 *   <root>/.system/useractivity/<prefix>/activity.json  → what they opened
 *   <root>/.system/useractivity/<prefix>/visits.json    → how much, per day
 *
 * Reading per root and summing is the only shape that is correct: keying on the
 * space name instead would count one visit four times, and picking a single
 * "primary" space would drop every root but one.
 *
 * WHY `:userKey` IS THE EMAIL PREFIX, NOT THE EMAIL. The folders on disk are
 * named after the email local part (`userStore.userDir`), so the prefix is what
 * actually identifies a record — an email would have to be reduced to it anyway,
 * and would imply a precision the storage does not have. Two users whose emails
 * share a local part share a folder; that is pre-existing, and the list endpoint
 * reports it (`sharedKey`) rather than silently showing one person's reading as
 * the other's.
 *
 * THE USER LIST IS A UNION. Registered users come from the authservice (so
 * somebody who has never opened a document still appears, at zero); activity
 * folders are added on top (so a departed user's history is still reachable, and
 * `anonymous` — logged-out reading — is visible rather than quietly dropped).
 *
 * PRIVACY. This exposes one person's reading history to datasources admins,
 * which is the point of a usage screen, and it is gated behind the same
 * `requireDataSourcesAdmin` middleware as every other /api route in this module
 * (registered in initialize.js). Nothing here is exposed to the wiki frontend.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-09-05
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

// The layout of `.system/useractivity/<prefix>/` is owned by the wiki, which is
// what writes it. Reading it from here means one cross-module require rather
// than a second copy of the path rules that would be free to drift.
const userStore = require('../../wiki/components/userStore');
const spaceUserStore = require('../../wiki/components/spaceUserStore');
const userArtifacts = require('../../wiki/components/userArtifacts');
const visitTally = require('../../wiki/components/visitTally');
const { contentRootKey } = require('../../shared/spaces/contentRoot');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');

/** Window for the chart and the list's "recent activity" column. */
const DEFAULT_WINDOW_DAYS = 30;

/** Widest window a caller may ask for — the tally only keeps RETENTION_DAYS. */
const MAX_WINDOW_DAYS = visitTally.RETENTION_DAYS;

/** Visits returned in the detail view. Generous: the store caps at 50 per root. */
const MAX_VISITS = 500;

/** Characters `userDir()` can produce in a folder name. */
const USER_KEY_RE = /^[a-z0-9._-]+$/;

/**
 * Is `value` usable as a folder name under `.system/useractivity/`?
 *
 * The character class alone is NOT enough: `.` and `..` are made entirely of
 * permitted characters and are path SEGMENTS, so `..` resolves one level out of
 * the activity folder — it reads `<root>/.system/` instead. They are the only
 * two such names, so they are excluded by name.
 */
function isUserKey(value) {
  return typeof value === 'string' && USER_KEY_RE.test(value) && value !== '.' && value !== '..';
}

/** Read many things at a bounded concurrency, preserving input order. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

module.exports = function (type, options, eventEmitter) {
  const app = options.app || options['express-app'];
  const { dependencies = {} } = options;
  const { log = console, appBaseDir, authservice } = dependencies;

  const ok = (res, data) => res.status(200).json({ success: true, data });
  const fail = (res, status, error) => res.status(status).json({ success: false, error });

  /**
   * The DISTINCT content roots behind the configured spaces, each carrying the
   * spaces that read from it and a compiled visibility matcher per space.
   *
   * Spaces are grouped by `contentRootKey` — the same normalisation search and
   * the file watcher use — so two spaces spelling one directory differently
   * still collapse into one root, and one that is misconfigured is skipped
   * rather than collapsing everything into a shared empty key.
   *
   * @return {Promise<Array<{key:string, dir:string, spaces:Array}>>}
   */
  async function contentRoots() {
    const spaces = await spaceUserStore.loadSpaces(appBaseDir);
    const byKey = new Map();

    for (const space of spaces) {
      const dir = spaceUserStore.spaceContentDir(space);
      if (!dir) continue;
      const key = contentRootKey(space);
      const root = byKey.get(key) || { key, dir, spaces: [] };
      root.spaces.push({
        id: space.id,
        name: space.name,
        visibility: compileVisibility(space)
      });
      byKey.set(key, root);
    }
    return [...byKey.values()];
  }

  /** Public shape of a root — the compiled matchers must not reach the client. */
  function describeRoot(root) {
    return {
      key: root.key,
      dir: root.dir,
      spaces: root.spaces.map((s) => ({ id: s.id, name: s.name }))
    };
  }

  /** The user folders that exist under one content root. */
  async function userKeysIn(root) {
    const dir = path.join(root.dir, userStore.ROOT);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // A root nobody has used yet simply has no folder. Anything else is worth
      // saying out loud, because it makes a user look inactive rather than
      // unreadable.
      if (err.code !== 'ENOENT') {
        log.warn?.(`[UserActivity] Could not list ${dir}: ${err.message}`);
      }
      return [];
    }
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.toLowerCase())
      .filter(isUserKey);
  }

  /**
   * One user's stored artefacts on one root: their visits and their tally.
   *
   * `recent` is run through `userArtifacts.normalise`, which drops the legacy
   * `spaceName` stamp and collapses the duplicates it caused — without it the
   * same document read from two views counts twice.
   */
  async function readOnRoot(root, userKey) {
    const [activity, tally] = await Promise.all([
      userStore.readJson(root.dir, userKey, 'activity.json', null).catch(() => null),
      visitTally.read(root.dir, userKey)
    ]);

    const usable = activity && typeof activity === 'object' && !Array.isArray(activity);
    return {
      root,
      recent: userArtifacts.normalise(usable ? activity.recent : []),
      starred: userArtifacts.normalise(usable ? activity.starred : []),
      tally
    };
  }

  /** Every registered user, keyed by the folder name their email reduces to. */
  async function registeredByKey() {
    const byKey = new Map();
    if (!authservice || typeof authservice.listUsers !== 'function') return byKey;

    let users = [];
    try {
      users = await authservice.listUsers() || [];
    } catch (err) {
      // A usage screen that shows only the people with activity folders is much
      // better than one that fails to load.
      log.warn?.(`[UserActivity] Could not list users: ${err.message}`);
      return byKey;
    }

    for (const user of users) {
      if (!user || !user.email) continue;
      const key = userStore.userDir(user.email);
      const list = byKey.get(key) || [];
      list.push({
        email: user.email,
        name: user.fullName || user.name || '',
        roles: Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean),
        isActive: user.isActive !== false,
        createdAt: user.createdAt || null,
        lastLogin: user.lastLogin || null
      });
      byKey.set(key, list);
    }
    return byKey;
  }

  /**
   * Display identity for a folder key.
   *
   * `sharedKey` is set when more than one registered email reduces to this one
   * folder — those people's activity is genuinely commingled on disk, and saying
   * so is the only honest thing the screen can do about it.
   */
  function identityFor(userKey, registered) {
    const accounts = registered.get(userKey) || [];
    const primary = accounts[0] || null;
    return {
      userKey,
      email: primary ? primary.email : null,
      name: primary ? primary.name : '',
      roles: primary ? primary.roles : [],
      isActive: primary ? primary.isActive : null,
      createdAt: primary ? primary.createdAt : null,
      lastLogin: primary ? primary.lastLogin : null,
      registered: accounts.length > 0,
      sharedKey: accounts.length > 1 ? accounts.map((a) => a.email) : null
    };
  }

  /** Window length from `?days=`, clamped to something the tally can answer. */
  function windowDays(req) {
    const raw = Number(req.query.days);
    if (!Number.isFinite(raw)) return DEFAULT_WINDOW_DAYS;
    return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.trunc(raw)));
  }

  // ==========================================================================
  // GET /api/user-activity — the people list
  // ==========================================================================
  app.get('/api/user-activity', async (req, res) => {
    try {
      const days = windowDays(req);
      const roots = await contentRoots();
      const registered = await registeredByKey();

      // Union: folders that exist on disk, plus everyone with an account. A user
      // who has never opened a document has no folder and must still be listed
      // (at zero) or the screen answers "who is using this" with survivorship
      // bias; a folder with no account is a departed user or `anonymous`, whose
      // history is still real.
      const keys = new Set();
      const foundOn = await mapLimit(roots, 4, (root) => userKeysIn(root));
      foundOn.forEach((list) => list.forEach((key) => keys.add(key)));
      registered.forEach((_, key) => keys.add(key));

      // Which roots actually hold a folder for each user. The listing above
      // already answered this, so the reads below touch only files that exist —
      // otherwise every account with no activity costs two failed opens per
      // root, which is most of the work on an install with many users.
      const rootsWithFolder = new Map();
      roots.forEach((root, index) => {
        for (const key of foundOn[index]) {
          const list = rootsWithFolder.get(key) || [];
          list.push(root);
          rootsWithFolder.set(key, list);
        }
      });

      const users = await mapLimit([...keys], 6, async (userKey) => {
        const mine = rootsWithFolder.get(userKey) || [];
        const perRoot = await mapLimit(mine, 4, (root) => readOnRoot(root, userKey));
        const active = perRoot.filter((entry) => entry.recent.length || Object.keys(entry.tally.days).length);

        const points = visitTally.series({
          tally: visitTally.merge(active.map((entry) => entry.tally)),
          recent: active.flatMap((entry) => entry.recent),
          days
        });
        const totals = visitTally.summarise(points);

        const lastVisitAt = active
          .flatMap((entry) => entry.recent.map((item) => item.visitedAt))
          .filter(Boolean)
          .sort()
          .pop() || null;

        return {
          ...identityFor(userKey, registered),
          lastVisitAt,
          documents: new Set(active.flatMap((e) => e.recent.map((i) => i.path))).size,
          starred: active.reduce((sum, entry) => sum + entry.starred.length, 0),
          window: { days, ...totals },
          // The sparkline on the row — totals only; the detail view splits them.
          spark: points.map((point) => point.total),
          roots: active.map((entry) => entry.root.key)
        };
      });

      // Most recently active first; never-active users fall to the bottom in a
      // stable alphabetical order rather than an arbitrary readdir one.
      users.sort((a, b) => {
        if (a.lastVisitAt && b.lastVisitAt) return b.lastVisitAt.localeCompare(a.lastVisitAt);
        if (a.lastVisitAt) return -1;
        if (b.lastVisitAt) return 1;
        return a.userKey.localeCompare(b.userKey);
      });

      ok(res, { days, users, roots: roots.map(describeRoot) });
    } catch (error) {
      log.error?.('[UserActivity] Failed to list users:', error.message);
      fail(res, 500, 'Failed to load user activity');
    }
  });

  // ==========================================================================
  // GET /api/user-activity/:userKey — one person
  // ==========================================================================
  app.get('/api/user-activity/:userKey', async (req, res) => {
    try {
      const userKey = String(req.params.userKey || '').toLowerCase();
      // The key names a directory, so validate its SHAPE before it is joined
      // onto a path — `userDir()` only sanitises on the way in, and this is a
      // different way in.
      if (!isUserKey(userKey)) return fail(res, 400, 'Invalid user key');

      const days = windowDays(req);
      const roots = await contentRoots();
      const registered = await registeredByKey();
      const perRoot = await mapLimit(roots, 4, (root) => readOnRoot(root, userKey));

      const points = visitTally.series({
        tally: visitTally.merge(perRoot.map((entry) => entry.tally)),
        recent: perRoot.flatMap((entry) => entry.recent),
        days
      });

      // One flat, newest-first list of visits. Each carries the root it came
      // from and the spaces on that root that actually EXPOSE it — a curated
      // space hides part of a shared root, so "which space was this read in" is
      // a visibility question, not a stored label. Answering it with the real
      // matcher is the same rule search and the folder tree use.
      const visits = perRoot
        .flatMap((entry) => entry.recent.map((item) => ({
          path: item.path,
          title: item.title || item.path,
          action: item.action || 'viewed',
          visitedAt: item.visitedAt || null,
          root: entry.root.key,
          spaces: entry.root.spaces
            .filter((space) => space.visibility.isFileVisible(item.path))
            .map((space) => space.name)
        })))
        .sort((a, b) => String(b.visitedAt).localeCompare(String(a.visitedAt)))
        .slice(0, MAX_VISITS);

      const starred = perRoot
        .flatMap((entry) => entry.starred.map((item) => ({
          path: item.path,
          title: item.title || item.path,
          starredAt: item.starredAt || null,
          root: entry.root.key
        })))
        .sort((a, b) => String(b.starredAt).localeCompare(String(a.starredAt)));

      const tallyStartedAt = perRoot
        .map((entry) => entry.tally.startedAt)
        .filter(Boolean)
        .sort()
        .shift() || null;

      ok(res, {
        ...identityFor(userKey, registered),
        days,
        series: points,
        window: visitTally.summarise(points),
        visits,
        starred,
        // Everything before this is inferred from the capped `recent` list and
        // is therefore a FLOOR, not a count. The screen says so rather than
        // presenting a thin early chart as fact.
        tallyStartedAt,
        roots: perRoot
          .map((entry) => ({
            ...describeRoot(entry.root),
            visits: entry.recent.length,
            counted: visitTally.summarise(
              visitTally.series({ tally: entry.tally, recent: entry.recent, days })
            ).total
          }))
      });
    } catch (error) {
      log.error?.('[UserActivity] Failed to load user:', error.message);
      fail(res, 500, 'Failed to load user activity');
    }
  });

  log.info?.('✓ User activity routes registered (/api/user-activity)');
};
