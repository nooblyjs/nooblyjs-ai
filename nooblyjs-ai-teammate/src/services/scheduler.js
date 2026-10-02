// Scheduled tasks ("Wren: weekly account briefs every Monday 08:00"). A timer checks every 30 seconds for schedules
// that are due and runs them as ordinary tasks, called by the schedule. Times are in the workspace time zone
// (Settings, default UTC). A run that was missed while the server was down happens once on the next check; it never
// catches up run by run.
import { HttpError, notFound } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { normalizeProject } from './retrieval.js';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // ISO order: 1 = Monday … 7 = Sunday

// ---------- Time zone arithmetic (no dependencies: Intl does the work) ----------

function zoneParts(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t).value;
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), hh: Number(get('hour')), mm: Number(get('minute')), ss: Number(get('second')), dow: DAY_NAMES.indexOf(get('weekday')) + 1 };
}

/** Milliseconds the zone is ahead of UTC at instant `ts`. */
function zoneOffset(ts, tz) {
  const p = zoneParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ts / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in `tz` (handles DST by re-checking the offset once). */
export function zonedTime(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - zoneOffset(guess, tz);
  const second = zoneOffset(ts, tz);
  if (guess - second !== ts) ts = guess - second;
  return ts;
}

/** Next run strictly after `after` (ms) for { days: [1..7], time: 'HH:MM' } in `tz`, as an ISO string. */
export function nextRun({ days, time }, after, tz = 'UTC') {
  const [, hh, mm] = TIME.exec(time).map(Number);
  const start = zoneParts(after, tz);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const dow = ((day.getUTCDay() + 6) % 7) + 1;
    if (!days.includes(dow)) continue;
    const ts = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    if (ts > after) return new Date(ts).toISOString();
  }
  return null;
}

export function describeCadence({ days, time }) {
  const sorted = [...days].sort();
  const label = sorted.length === 7 ? 'Every day' : sorted.join(',') === '1,2,3,4,5' ? 'Weekdays' : `Every ${sorted.map((d) => DAY_NAMES[d - 1]).join(', ')}`;
  return `${label} at ${time}`;
}

export class SchedulerService {
  constructor({ repos, invocation, events = null, webhooks = null, clock = () => Date.now(), log = console, intervalMs = 30000 }) {
    this.repos = repos;
    this.invocation = invocation;
    this.events = events;
    this.webhooks = webhooks;
    this.clock = clock;
    this.log = log;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer || !this.intervalMs) return;
    this.timer = setInterval(() => this.tick().catch((err) => this.log.error?.(`[schedule] ${err.message}`)), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async timezone() {
    return (await this.repos.config.getSettings()).timezone ?? 'UTC';
  }

  async view(s) {
    return { ...s, cadenceLabel: describeCadence(s.cadence), timezone: await this.timezone() };
  }

  async list(filter) {
    const tz = await this.timezone();
    return (await this.repos.schedules.list(filter)).map((s) => ({ ...s, cadenceLabel: describeCadence(s.cadence), timezone: tz }));
  }

  async validate(input, { partial = false } = {}) {
    const errors = {};
    const out = {};
    if (input.teammateId !== undefined || !partial) {
      const t = await this.repos.teammates.get(String(input.teammateId ?? ''));
      if (!t || t.retiredAt) errors.teammateId = 'Choose an active teammate';
      else out.teammateId = t.id;
    }
    if (input.name !== undefined || !partial) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 80) errors.name = 'Use 1 to 80 characters';
      else out.name = name;
    }
    if (input.task !== undefined || !partial) {
      const task = String(input.task ?? '').trim();
      if (!task || task.length > 20000) errors.task = 'Describe the work (up to 20,000 characters)';
      else out.task = task;
    }
    if (input.cadence !== undefined || !partial) {
      const days = Array.isArray(input.cadence?.days) ? [...new Set(input.cadence.days.map(Number))].sort() : [];
      if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) errors.days = 'Choose at least one day';
      if (!TIME.test(String(input.cadence?.time ?? ''))) errors.time = 'Use a 24-hour time like 08:00';
      if (!errors.days && !errors.time) out.cadence = { days, time: input.cadence.time };
    }
    if (input.project !== undefined) {
      try {
        out.project = normalizeProject(input.project) ?? undefined;
      } catch (err) {
        errors.project = err.details?.project ?? err.message;
      }
    }
    if (input.costCentre !== undefined && input.costCentre !== '') {
      const centres = (await this.repos.config.getSettings()).costCentres ?? [];
      if (!centres.includes(input.costCentre)) errors.costCentre = 'Unknown cost centre';
      else out.costCentre = input.costCentre;
    }
    if (input.enabled !== undefined) out.enabled = input.enabled !== false;
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please fix the highlighted fields', errors);
    return out;
  }

  async create(input, actor) {
    const fields = await this.validate(input);
    const tz = await this.timezone();
    const schedule = {
      id: newId('sch'), ...fields, enabled: fields.enabled ?? true, createdAt: new Date(this.clock()).toISOString(), createdBy: actor?.name,
      nextRunAt: nextRun(fields.cadence, this.clock(), tz),
    };
    return this.view(await this.repos.schedules.save(schedule));
  }

  async update(id, input) {
    const patch = await this.validate(input, { partial: true });
    const tz = await this.timezone();
    const updated = await this.repos.schedules.update(id, (cur) => {
      const next = { ...cur, ...patch };
      return { ...patch, nextRunAt: next.enabled === false ? null : nextRun(next.cadence, this.clock(), tz) };
    });
    if (!updated) throw notFound('Schedule');
    return this.view(updated);
  }

  async remove(id) {
    const s = await this.repos.schedules.get(id);
    if (!s) throw notFound('Schedule');
    await this.repos.schedules.remove(id);
    return s;
  }

  /** Runs every enabled schedule that is due. Each is claimed (next run moved on) before it starts. */
  async tick(now = this.clock()) {
    const tz = await this.timezone();
    const due = (await this.repos.schedules.list()).filter((s) => s.enabled !== false && s.nextRunAt && Date.parse(s.nextRunAt) <= now);
    const started = [];
    for (const s of due) {
      const claimed = await this.repos.schedules.update(s.id, (cur) =>
        cur.enabled === false || !cur.nextRunAt || Date.parse(cur.nextRunAt) > now ? null : { nextRunAt: nextRun(cur.cadence, now, tz), lastRunAt: new Date(now).toISOString(), lastStatus: 'running' },
      );
      if (claimed?.lastStatus === 'running' && claimed.lastRunAt === new Date(now).toISOString()) {
        started.push(s.id);
        this.invocation.track(this.run(claimed));
      }
    }
    return started;
  }

  /** "Run now": runs immediately without moving the next scheduled run. */
  async runNow(id) {
    const s = await this.repos.schedules.get(id);
    if (!s) throw notFound('Schedule');
    await this.invocation.preflight(s.teammateId);
    await this.repos.schedules.update(id, () => ({ lastRunAt: new Date(this.clock()).toISOString(), lastStatus: 'running' }));
    this.invocation.track(this.run(s));
    return this.view({ ...s, lastStatus: 'running' });
  }

  async run(s) {
    let patch;
    try {
      const result = await this.invocation.assign(s.teammateId, {
        task: s.task, project: s.project, costCentre: s.costCentre,
        caller: { type: 'schedule', id: s.id, name: s.name }, schedule: { id: s.id, name: s.name },
      });
      patch = { lastStatus: result.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed', lastWorkId: result.workId, lastError: undefined };
    } catch (err) {
      this.log.warn?.(`[schedule] ${s.id} (${s.name}) failed: ${err.message}`);
      patch = { lastStatus: 'failed', lastError: err.message };
      // Failures before the model ran (paused, over the cap…) are only reported here; model failures already were.
      if (err.code !== 'provider_error') await this.webhooks?.emit('task.failed', { teammate: s.teammateId, title: s.name, error: err.message, caller: { type: 'schedule', id: s.id, name: s.name }, schedule: { id: s.id, name: s.name } });
    }
    await this.repos.schedules.update(s.id, () => patch);
    this.events?.publish('schedule', { id: s.id, teammateId: s.teammateId, ...patch });
  }
}
