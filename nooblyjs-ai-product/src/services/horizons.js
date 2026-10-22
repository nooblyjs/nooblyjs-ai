// Now · Next · Later (NooblyJS Phase 25b, your answer of 2026-10-22): Now is today to three months from today, Next the
// three months after that, Later anything after six months. They roll forward with the business clock (host.clock),
// never Date.now(), so the dev clock moves them too.

export const HORIZONS = ['now', 'next', 'later'];
export const HORIZON_WORDS = { now: 'Now', next: 'Next', later: 'Later' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The date `months` calendar months after `iso` (YYYY-MM-DD), the day clamped to the month's length. */
function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

const short = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * The three horizons with their dates, from `nowMs` (the business clock): [{ key, label, from, to, text }]. Later has
 * no end.
 */
export function horizons(nowMs) {
  const today = new Date(Number(nowMs)).toISOString().slice(0, 10);
  const three = addMonths(today, 3);
  const six = addMonths(today, 6);
  return [
    { key: 'now', label: 'Now', from: today, to: three, text: `${short(today)} to ${short(three)}` },
    { key: 'next', label: 'Next', from: three, to: six, text: `${short(three)} to ${short(six)}` },
    { key: 'later', label: 'Later', from: six, to: null, text: `after ${short(six)}` },
  ];
}

export const isHorizon = (h) => HORIZONS.includes(h);
