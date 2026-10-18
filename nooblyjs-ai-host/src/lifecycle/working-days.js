// Due times for approvals (product.md §4, "Who approves what"). Times are UTC. A working day is Monday to Friday;
// public holidays are not known yet [PLACEHOLDER: holiday calendar].
const DAY = 86_400_000;
const HOUR = 3_600_000;

const isWeekend = (ms) => [0, 6].includes(new Date(ms).getUTCDay());

/** `n` working days after `at` (ISO or ms), at the same time of day. Weekends don't count. */
export function addWorkingDays(at, n) {
  let ms = new Date(at).getTime();
  let left = Math.max(0, Math.round(n));
  while (left > 0) {
    ms += DAY;
    if (!isWeekend(ms)) left -= 1;
  }
  return new Date(ms).toISOString();
}

/** The last second of the UTC day of `at`. */
export function endOfDay(at) {
  const end = new Date(at);
  end.setUTCHours(23, 59, 59, 0);
  return end.toISOString();
}

/**
 * When an approval requested at `at` is due, from its rule's target (product.md §4):
 *   { workingDays: n }  by the end of the n-th working day after the request ("1 working day": by the end of the
 *                       next working day, so a request on Thursday morning is "due today" on Friday)
 *   { hours: n }        n clock hours later
 *   { sameDay: true }   by the end of that day
 * Null when the rule has no target.
 */
export function dueFrom(at, target) {
  if (!target) return null;
  const ms = new Date(at).getTime();
  if (target.workingDays) return endOfDay(addWorkingDays(ms, target.workingDays));
  if (target.hours) return new Date(ms + target.hours * HOUR).toISOString();
  if (target.sameDay) return endOfDay(ms);
  return null;
}

/** Whole days between two times, rounded down ("Waiting 4 d"). */
export const daysBetween = (from, to) => Math.floor((new Date(to).getTime() - new Date(from).getTime()) / DAY);
