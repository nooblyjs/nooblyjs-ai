const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** $6,814 — shows cents only for small, non-whole amounts. */
export function money(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  return `${sign}$${Number.isInteger(abs) || abs >= 1000 ? whole.format(abs) : cents.format(abs)}`;
}

export const rate = (n) => `${money(n)} / hr`;

export function hours(h) {
  const v = Math.round((Number(h) || 0) * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}h`;
}

/** Fixed one decimal, as in the timesheet columns: 3.0h, 14.5h. */
export const hours1 = (h) => `${(Math.round((Number(h) || 0) * 10) / 10).toFixed(1)}h`;

export function tokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(v);
}

export const count = (n) => whole.format(Number(n) || 0);

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
export const numberWord = (n) => WORDS[n] ?? String(n);
