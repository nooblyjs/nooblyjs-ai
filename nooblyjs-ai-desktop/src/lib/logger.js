'use strict';

const { logLevel } = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[logLevel] || LEVELS.info;

const SECRET_KEY_PATTERN = /(key|token|secret|authorization|password)/i;

function redact(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v);
  }
  return out;
}

function emit(level, message, fields) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, message, ...redact(fields || {}) };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

module.exports = {
  debug: (message, fields) => emit('debug', message, fields),
  info: (message, fields) => emit('info', message, fields),
  warn: (message, fields) => emit('warn', message, fields),
  error: (message, fields) => emit('error', message, fields),
  redact
};
