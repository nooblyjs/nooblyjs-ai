/**
 * 
 */
'use strict';

const config = require('./src/config');
const logger = require('./src/lib/logger');
const registry = require('./src/providers/registry');
const { bootstrap } = require('./src/storage/bootstrap');
const indexCache = require('./src/storage/index');
const { createApp } = require('./src/app');
const { shutdownCore } = require('./src/core');

async function main() {
  await bootstrap();

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    const configured = registry.listAll().filter((p) => p.configured).map((p) => p.id);
    logger.info('Listening', {
      url: `http://${config.host}:${config.port}`,
      dataDir: config.dataDir,
      providers: configured.length ? configured : 'none configured',
      services: `http://${config.host}:${config.port}/services/`
    });
    if (!configured.length) {
      logger.warn('No provider API keys found — set one in .env, then restart');
    }
    if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
      logger.warn('Bound to a non-loopback address; this app has no authentication', { host: config.host });
    }
  });

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    indexCache.close();
    server.close(() => shutdownCore().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Failed to start', { message: err.message, stack: err.stack });
  process.exit(1);
});
