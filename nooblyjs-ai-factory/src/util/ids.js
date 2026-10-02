// @ts-check
// Phase F00: ids that SORT BY TIME.
//
// A factory creates a lot of things (items, runs, steps, workspaces) and you
// constantly want "the newest first". If the id starts with the time, sorting
// the ids as plain strings sorts them by creation time, with no extra column.
//
//   ws-mh3k2c9a-4f1a2b   ← prefix · time in base 36 · random
//
// Base 36 keeps it short; the time part is padded so string order = number order.
import crypto from 'node:crypto';
import { systemClock } from './clock.js';

const TIME_WIDTH = 9; // base-36 millisecond timestamps fit in 9 characters until the year 5188

/**
 * A new id like `ws-mh3k2c9a-4f1a2b`.
 * @param {string} prefix   what kind of thing it is: 'item', 'run', 'step', 'ws'…
 * @param {{ now: () => number }} [clock]
 */
export function newId(prefix, clock = systemClock) {
  const time = clock.now().toString(36).padStart(TIME_WIDTH, '0');
  const random = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${time}-${random}`;
}

/** When was this id made? (milliseconds since 1970) */
export function idTime(id) {
  const time = id.split('-').at(-2);
  return parseInt(time ?? '', 36);
}

/** A short, safe name for folders and branches: "Add a --json flag!" → "add-a-json-flag" */
export function slugify(text, max = 30) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, max)
      .replace(/-$/, '') || 'x'
  );
}
