// The clock NooblyJS and its hosted apps read business time from (host.clock). In development (NOOBLY_DEV_LOGIN=true)
// it can be moved forward from /dev/clock, so approval targets, reminders and escalations can be tested without
// waiting (roadmap test kit). The offset is kept in data/dev/clock.yaml, so it survives a restart. In production
// it is always the real time.
const DAY = 86_400_000;
const HOUR = 3_600_000;
const FILE = ['dev', 'clock.yaml'];
const MAX_AHEAD_MS = 366 * DAY;

/** `n` working days (Monday to Friday, UTC) after `ms`, at the same time of day. */
export function addWorkingDays(ms, n) {
  let at = ms;
  let left = Math.max(0, Math.round(n));
  while (left > 0) {
    at += DAY;
    if (![0, 6].includes(new Date(at).getUTCDay())) left -= 1;
  }
  return at;
}

export async function createClock({ store, movable = false }) {
  let offsetMs = movable ? Number((await store.readYaml(FILE))?.offsetMs) || 0 : 0;
  const now = () => Date.now() + offsetMs;

  async function save() {
    await store.writeYaml(FILE, { offsetMs, movedTo: new Date(now()).toISOString(), note: 'Development clock offset (/dev/clock). Delete this file to return to the real time.' });
  }

  return {
    now,
    iso: () => new Date(now()).toISOString(),
    movable,
    get offsetMs() {
      return offsetMs;
    },
    /** Moves the clock forward by hours and/or working days. Resolves with the new offset. */
    async advance({ hours = 0, workingDays = 0 } = {}) {
      if (!movable) throw new Error('The clock can only be moved in development.');
      const h = Number(hours) || 0;
      const d = Number(workingDays) || 0;
      if (h < 0 || d < 0 || (!h && !d)) throw new RangeError('Move the clock forward by a positive number of hours or working days.');
      const target = addWorkingDays(now(), d) + h * HOUR;
      if (target - Date.now() > MAX_AHEAD_MS) throw new RangeError('The dev clock can be at most a year ahead.');
      offsetMs = target - Date.now();
      await save();
      return offsetMs;
    },
    async reset() {
      offsetMs = 0;
      if (movable) await save();
    },
  };
}
