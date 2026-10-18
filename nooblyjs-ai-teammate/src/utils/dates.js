// Calendar helpers. Dates are plain 'YYYY-MM-DD' strings, interpreted in UTC.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

const toDate = (s) => new Date(`${s}T00:00:00Z`);
export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
export const monthKey = (s) => s.slice(0, 7);

export function addDays(s, n) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function addMonths(s, n) {
  const d = toDate(`${s.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return isoDate(d);
}

/** Monday of the week containing `s`. */
export function startOfWeek(s) {
  const day = toDate(s).getUTCDay(); // 0 = Sunday
  return addDays(s, -((day + 6) % 7));
}

export function isoWeek(s) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // Thursday of this week
  const firstThursday = toDate(`${d.getUTCFullYear()}-01-04`);
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export const monthName = (s) => MONTHS[Number(s.slice(5, 7)) - 1];

export function shortDay(s) {
  const d = toDate(s);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

export function longDate(s) {
  const d = toDate(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dayMonth(s) {
  const d = toDate(s);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/**
 * Billing period range. `offset` steps back (-1) or forward (+1) whole periods.
 * Returns inclusive start/end dates and a human label.
 */
export function periodRange(period, offset = 0, today = isoDate()) {
  if (period === 'week') {
    const start = addDays(startOfWeek(today), offset * 7);
    return { period, offset, start, end: addDays(start, 6), label: offset === 0 ? 'This week' : `Week of ${dayMonth(start)}` };
  }
  if (period === 'quarter') {
    const month = Number(today.slice(5, 7)) - 1;
    const quarterStartMonth = `${today.slice(0, 4)}-${String(month - (month % 3) + 1).padStart(2, '0')}-01`;
    const start = addMonths(quarterStartMonth, offset * 3);
    const end = addDays(addMonths(start, 3), -1);
    const q = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
    return { period, offset, start, end, label: `Q${q} ${start.slice(0, 4)}` };
  }
  const start = addMonths(`${today.slice(0, 7)}-01`, offset);
  const end = addDays(addMonths(start, 1), -1);
  return { period: 'month', offset, start, end, label: monthName(start) };
}

export const inRange = (s, { start, end }) => s >= start && s <= end;

/** Relative "learned" phrasing used on memory items: Today, Yesterday, Tue, last week, 3 weeks ago... */
export function relativeDay(s, today = isoDate()) {
  const days = Math.round((toDate(today) - toDate(s.slice(0, 10))) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][toDate(s.slice(0, 10)).getUTCDay()];
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return dayMonth(s.slice(0, 10));
}
