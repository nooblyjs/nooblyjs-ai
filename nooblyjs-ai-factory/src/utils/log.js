// @ts-check
// Phase F00: a debug log that never gets in the way.
//
//   FACTORY_DEBUG=1 factory …
//   tail -f ~/.factory/debug.log
//
// The factory's real record of what happened is its event log (Phase F05).
// This file is only for you, while developing.
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome } from './paths.js';

/** @param {string} message  @param {unknown} [data] */
export function debug(message, data) {
  if (!process.env.FACTORY_DEBUG) return;
  try {
    const file = path.join(factoryHome(), 'debug.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const extra = data === undefined ? '' : ` ${JSON.stringify(data)}`;
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}${extra}\n`);
  } catch {
    // A debug log must never break the program.
  }
}
