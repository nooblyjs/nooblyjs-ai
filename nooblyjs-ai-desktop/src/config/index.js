'use strict';

const path = require('node:path');
require('dotenv').config({ quiet: true });

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
const coreDir = path.resolve(process.cwd(), process.env.NOOBLY_DIR || './.noobly-core');

module.exports = {
  port: Number(process.env.PORT) || 11201,
  host: process.env.HOST || '127.0.0.1',
  logLevel: process.env.LOG_LEVEL || 'info',
  dataDir,
  projectsDir: path.join(dataDir, 'projects'),
  settingsFile: path.join(dataDir, 'settings.json'),
  core: {
    logDir: path.join(coreDir, 'logs'),
    dataDir: path.join(coreDir, 'data')
  },
  limits: {
    nameMaxLength: 100,
    descriptionMaxLength: 20000,
    bodyLimit: '1mb',
    messageMaxLength: 100000
  },
  defaults: {
    temperature: 0.7,
    maxOutputTokens: 4096
  }
};
