// @ts-check
// Phase F25: SCHEDULED items. Recurring work, on a clock.
//
//   "schedules": [
//     { "name": "deps-weekly", "cron": "0 9 * * 1", "repos": ["../a", "../b"], "spec": "schedules/deps.md" }
//   ]
//
// Every Monday at 09:00 (UTC), a campaign from deps.md across those repos. `factory serve` checks
// once a tick; each schedule fires at most once per matching minute, because the campaign is
// created with the idempotency key "schedule:<name>:<minute>". A serve that was down at 09:00
// doesn't catch up later: a missed weekly chore waits for next week rather than piling up.
//
// cron here: five fields (minute hour day-of-month month day-of-week), each "*", a number,
// a list "1,3", a range "1-5", or a step "*/15". In UTC. No names, no "@weekly".
import fs from 'node:fs';
import path from 'node:path';
import { createCampaign } from './campaign.js';

const FIELDS = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day', 1, 31],
  ['month', 1, 12],
  ['weekday', 0, 6],
];

/** "*\/15 9-17 * * 1-5" → five sets of allowed values. Throws with the field that's wrong. */
export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${expr}": five fields (minute hour day month weekday), got ${parts.length}.`);
  return parts.map((part, i) => {
    const [name, lo, hi] = FIELDS[i];
    const set = new Set();
    for (const piece of part.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(piece);
      if (!m) throw new Error(`cron "${expr}": can't read the ${name} field "${part}".`);
      const from = m[1] === '*' ? lo : Number(m[2]);
      const to = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : from;
      const step = m[4] ? Number(m[4]) : 1;
      if (from < lo || to > hi || from > to || step < 1) throw new Error(`cron "${expr}": the ${name} field "${part}" is outside ${lo}–${hi}.`);
      for (let v = from; v <= to; v += step) set.add(v);
    }
    return set;
  });
}

/** Does this UTC minute match? (Day-of-month and weekday: if both are restricted, either matches, like cron.) */
export function cronMatches(expr, date) {
  const [min, hour, day, month, weekday] = parseCron(expr);
  const d = new Date(date);
  const dayOk = day.size === 31 || weekday.size === 7 ? day.has(d.getUTCDate()) && weekday.has(d.getUTCDay()) : day.has(d.getUTCDate()) || weekday.has(d.getUTCDay());
  return min.has(d.getUTCMinutes()) && hour.has(d.getUTCHours()) && month.has(d.getUTCMonth() + 1) && dayOk;
}

/**
 * Fire every schedule that matches this minute (once). Returns the campaigns created.
 * @param {import('../store/events.js').Store} store
 * @param {Array<{ name: string, cron: string, repos: string[], spec: string, autonomy?: string, routing?: string }>} schedules
 */
export function runSchedules(store, schedules, { now = Date.now(), baseDir = process.cwd() } = {}) {
  const minute = new Date(Math.floor(now / 60_000) * 60_000).toISOString().slice(0, 16);
  const created = [];
  for (const s of schedules ?? []) {
    if (!cronMatches(s.cron, now)) continue;
    const spec = fs.readFileSync(path.resolve(baseDir, s.spec), 'utf8');
    const c = createCampaign(store, { name: s.name, repos: s.repos.map((r) => path.resolve(baseDir, r)), spec, autonomy: s.autonomy, routing: s.routing, key: `schedule:${s.name}:${minute}` });
    if (c) created.push(c);
  }
  return created;
}
