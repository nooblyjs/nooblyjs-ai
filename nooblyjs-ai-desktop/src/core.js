'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const serviceRegistry = require('nooblyjs-core');
const config = require('./config');

// nooblyjs-core registers Express 4 route patterns (e.g. `/upload/*`) that
// Express 5's router rejects, so its services live on a separate app built from
// core's own Express 4 copy. The main app forwards /services traffic to it.
const coreExpress = require(require.resolve('express', { paths: [path.dirname(require.resolve('nooblyjs-core'))] }));

// nooblyjs-core is a process-wide singleton: initialize() binds the registry to
// the first Express app it is given and ignores later calls. Every service it
// creates mounts its REST API and dashboard under /services/<name>/ on that app.

const eventEmitter = new EventEmitter();
let coreApp = null;
let services = null;

function initCore() {
  if (services) return services;

  coreApp = coreExpress();
  coreApp.set('x-powered-by', false);
  coreApp.use(coreExpress.json({ limit: config.limits.bodyLimit }));
  coreApp.use(coreExpress.urlencoded({ extended: true, limit: config.limits.bodyLimit }));

  serviceRegistry.initialize(coreApp, eventEmitter, {
    logDir: config.core.logDir,
    dataDir: config.core.dataDir
  });

  services = {
    log: serviceRegistry.logger('file'),
    cache: serviceRegistry.cache('memory'),
    dataServe: serviceRegistry.dataService('memory'),
    filing: serviceRegistry.filing('local'),
    queue: serviceRegistry.queue('memory'),
    scheduling: serviceRegistry.scheduling('memory'),
    searching: serviceRegistry.searching('memory'),
    measuring: serviceRegistry.measuring('memory'),
    notifying: serviceRegistry.notifying('memory'),
    working: serviceRegistry.working('memory'),
    workflow: serviceRegistry.workflow('memory'),
    // Gates the /services dashboards. On first run it creates an admin user,
    // using DEFAULT_ADMIN_PASSWORD or writing a generated one to
    // <dataDir>/INITIAL_ADMIN_PASSWORD.txt.
    auth: serviceRegistry.authservice('file')
  };
  return services;
}

// Middleware for the main app. Called rather than mounted with app.use(coreApp)
// so Express 5 never tries to adopt an Express 4 app as a sub-app.
function coreRouter() {
  initCore();
  return (req, res, next) => {
    if (!req.path.startsWith('/services')) return next();
    // The main app's body parser has already consumed the stream. body-parser
    // 1.x (core's) only knows that from the `_body` flag 2.x no longer sets.
    if (req.body !== undefined) req._body = true;
    return coreApp(req, res, next);
  };
}

function getCore() {
  if (!services) throw new Error('nooblyjs-core has not been initialised; call initCore() first');
  return services;
}

async function shutdownCore() {
  if (!services) return;
  services = null;
  coreApp = null;
  await serviceRegistry.shutdown();
}

module.exports = { initCore, coreRouter, getCore, shutdownCore, serviceRegistry, eventEmitter };
