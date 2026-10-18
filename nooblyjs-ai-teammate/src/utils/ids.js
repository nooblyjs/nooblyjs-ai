import crypto from 'node:crypto';

/** Time-sortable id, e.g. wk_mg3k2a1b_9f2c. */
export const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

export const slugify = (text) =>
  String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48) || 'item';

export const round2 = (n) => Math.round(n * 100) / 100;
export const round1 = (n) => Math.round(n * 10) / 10;
