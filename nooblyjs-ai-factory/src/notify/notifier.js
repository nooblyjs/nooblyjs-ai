// @ts-check
// Phase F18: the NOTIFIER. It follows the event log and sends outgoing webhooks.
//
//   ~/.factory/config.json
//   "notify": { "targets": [
//     { "name": "team", "urlEnv": "SLACK_WEBHOOK_URL", "format": "slack",
//       "events": ["inbox.opened", "run.escalated", "run.delivered", "budget.exceeded"],
//       "repos": ["calc"], "batchMs": 60000 }
//   ] }
//
//   poll()    read new events (after a saved cursor) → notifications → each target's queue, if its filter matches
//   flush()   a target whose oldest queued notification is batchMs old gets ONE message with all of them
//
// Why batch: five runs finishing within a minute should be one ping, not five. People
// mute channels that shout; a muted channel makes escalations invisible.
//
// The cursor (the last seq handled) is saved in ~/.factory/notify-cursor.json, so a
// restart neither repeats nor loses notifications. On the very first start it begins
// at the END of the log: nobody wants a ping for every event since last year.
// Delivery failures are retried a few times, then logged and dropped: a notification
// is a courtesy, never a reason to stop the factory.
import fs from 'node:fs';
import path from 'node:path';
import { systemClock } from '../util/clock.js';
import { factoryHome } from '../util/paths.js';
import { formatBatch, toNotification } from './messages.js';

export const DEFAULT_EVENTS = ['inbox.opened', 'run.escalated', 'run.delivered', 'budget.exceeded'];

/**
 * @param {{ store: import('../store/events.js').Store, targets: any[], env?: NodeJS.ProcessEnv, fetch?: typeof fetch,
 *           clock?: import('../util/clock.js').Clock, sleep?: (ms: number) => Promise<void>, log?: (line: string) => void }} options
 */
export function createNotifier({ store, targets, env = process.env, fetch: doFetch = globalThis.fetch, clock = systemClock, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} }) {
  const cursorFile = path.join(factoryHome(env), 'notify-cursor.json');
  const readCursor = () => {
    try {
      return JSON.parse(fs.readFileSync(cursorFile, 'utf8')).seq;
    } catch {
      return null;
    }
  };
  let cursor = readCursor() ?? store.read().at(-1)?.seq ?? 0;
  const saveCursor = () => fs.writeFileSync(cursorFile, `${JSON.stringify({ seq: cursor })}\n`);

  const live = targets.map((t) => ({
    name: t.name ?? t.format ?? 'target',
    url: t.url ?? (t.urlEnv ? env[t.urlEnv] : undefined),
    format: t.format ?? 'slack',
    events: t.events ?? DEFAULT_EVENTS,
    repos: t.repos ?? null,
    batchMs: t.batchMs ?? 60_000,
    queue: /** @type {import('./messages.js').Notification[]} */ ([]),
    since: 0,
  }));
  for (const t of live) if (!t.url) log(`notify: target "${t.name}" has no URL (set url, or urlEnv to an env variable that is set); it is skipped`);

  const wants = (t, n) => (t.events.includes('*') || t.events.includes(n.kind)) && (!t.repos || !n.slug || t.repos.some((r) => n.slug.includes(r)));

  async function send(t, batch) {
    const body = JSON.stringify(formatBatch(t.format, batch));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await doFetch(/** @type {string} */ (t.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        if (res.ok) return true;
        if (res.status < 500 && res.status !== 429) {
          log(`notify: ${t.name} refused the message (${res.status}); dropped`);
          return false;
        }
      } catch {
        // network: retry
      }
      await sleep(1000 * 2 ** attempt);
    }
    log(`notify: ${t.name} unreachable; ${batch.length} notification(s) dropped`);
    return false;
  }

  return {
    /** New events → queues. Returns how many notifications were queued. */
    poll() {
      let queued = 0;
      for (const e of store.read({ after: cursor })) {
        cursor = e.seq;
        const n = toNotification(e, store);
        if (!n) continue;
        for (const t of live) {
          if (!t.url || !wants(t, n)) continue;
          if (!t.queue.length) t.since = clock.now();
          t.queue.push(n);
          queued++;
        }
      }
      saveCursor();
      return queued;
    },
    /** Send what's due (or everything, with force). Returns the number of messages sent. */
    async flush({ force = false } = {}) {
      let sent = 0;
      for (const t of live) {
        if (!t.queue.length || (!force && clock.now() - t.since < t.batchMs)) continue;
        const batch = t.queue.splice(0);
        if (await send(t, batch)) sent++;
      }
      return sent;
    },
    /** A test message to every target. */
    async test() {
      const n = { kind: 'test', title: '👋 factory notifications work', text: 'This is a test from `factory notify test`.', runId: null, slug: null, seq: 0, at: new Date(clock.now()).toISOString() };
      return Promise.all(live.filter((t) => t.url).map(async (t) => ({ name: t.name, ok: await send(t, [n]) })));
    },
    get pending() {
      return live.reduce((sum, t) => sum + t.queue.length, 0);
    },
  };
}
