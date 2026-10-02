// A tiny debug logger. Set NOOBLY_DEBUG=1 and it appends to ~/.noobly/debug.log.
// We never print debug output to the terminal because it would break the UI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const enabled = process.env.NOOBLY_DEBUG === '1';
const file = path.join(os.homedir(), '.noobly', 'debug.log');

export function debug(...parts) {
  if (!enabled) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}
