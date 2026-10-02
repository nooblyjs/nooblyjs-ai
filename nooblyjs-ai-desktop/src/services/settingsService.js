'use strict';

const config = require('../config');
const repo = require('../storage/fsRepository');
const { DEFAULT_SETTINGS } = require('../storage/bootstrap');
const { ValidationError, NotFoundError } = require('../lib/errors');

async function get() {
  try {
    const raw = await repo.readJson(config.settingsFile);
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch (err) {
    if (err instanceof NotFoundError) return { ...DEFAULT_SETTINGS };
    throw err;
  }
}

async function update(patch) {
  const current = await get();
  const next = { ...current };
  if ('defaultProvider' in patch) next.defaultProvider = patch.defaultProvider || null;
  if ('defaultModel' in patch) next.defaultModel = patch.defaultModel || null;
  if ('temperature' in patch) {
    const t = Number(patch.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 2) {
      throw new ValidationError('temperature must be between 0 and 2', { temperature: 'out of range' });
    }
    next.temperature = t;
  }
  if ('maxOutputTokens' in patch) {
    const m = Number(patch.maxOutputTokens);
    if (!Number.isInteger(m) || m < 1 || m > 200000) {
      throw new ValidationError('maxOutputTokens must be between 1 and 200000', {
        maxOutputTokens: 'out of range'
      });
    }
    next.maxOutputTokens = m;
  }
  await repo.writeJsonAtomic(config.settingsFile, next);
  return next;
}

module.exports = { get, update };
