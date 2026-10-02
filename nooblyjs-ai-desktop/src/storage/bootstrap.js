'use strict';

const config = require('../config');
const repo = require('./fsRepository');
const logger = require('../lib/logger');

const DEFAULT_SETTINGS = {
  defaultProvider: null,
  defaultModel: null,
  temperature: config.defaults.temperature,
  maxOutputTokens: config.defaults.maxOutputTokens,
  schemaVersion: 1
};

async function bootstrap() {
  await repo.ensureDir(config.projectsDir);
  if (!(await repo.exists(config.settingsFile))) {
    await repo.writeJsonAtomic(config.settingsFile, DEFAULT_SETTINGS);
    logger.info('Initialised data directory', { dataDir: config.dataDir });
  }
}

module.exports = { bootstrap, DEFAULT_SETTINGS };
