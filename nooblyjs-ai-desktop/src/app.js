'use strict';

const path = require('node:path');
const express = require('express');
const { buildCspDirectives } = require('nooblyjs-core/src/shared/utils/contentSecurityPolicy');
const config = require('./config');
const logger = require('./lib/logger');
const pages = require('./routes/pages');
const projectsApi = require('./routes/projects.api');
const chatsApi = require('./routes/chats.api');
const messagesApi = require('./routes/messages.api');
const documentsApi = require('./routes/documents.api');
const settingsApi = require('./routes/settings.api');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { coreRouter } = require('./core');

const ROOT = path.join(__dirname, '..');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Google Fonts: the shared Noobly theme (public/css/styles.css) imports its typefaces.
  "style-src 'self' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

// The nooblyjs-core dashboards under /services rely on inline scripts and CDN
// assets, so they get core's own policy instead of the strict one above.
const SERVICES_CSP = Object.entries(buildCspDirectives())
  .filter(([, sources]) => sources)
  .map(([name, sources]) => `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${sources.join(' ')}`)
  .join('; ');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));
  app.set('x-powered-by', false);

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', req.path.startsWith('/services') ? SERVICES_CSP : CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: config.limits.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.limits.bodyLimit }));

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.debug('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - startedAt
      });
    });
    next();
  });

  // No max-age: a stale cached stylesheet after an edit is far more costly here
  // than a revalidation request on localhost. ETags still make these 304s.
  app.use('/static', express.static(path.join(ROOT, 'public'), { etag: true, maxAge: 0 }));
  // Client-side Markdown rendering and sanitising, served from node_modules so
  // there is no bundler and no third-party origin in the CSP.
  app.use('/vendor/marked.js', express.static(path.join(ROOT, 'node_modules/marked/lib/marked.esm.js')));
  app.use('/vendor/purify.js', express.static(path.join(ROOT, 'node_modules/dompurify/dist/purify.es.mjs')));
  app.use('/vendor/bootstrap', express.static(path.join(ROOT, 'node_modules/bootstrap/dist')));
  app.use('/vendor/bootstrap-icons', express.static(path.join(ROOT, 'node_modules/bootstrap-icons/font')));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // nooblyjs-core service APIs and dashboards, at /services/
  app.use(coreRouter());

  app.use('/api/projects', projectsApi);
  app.use('/api/projects/:projectId/documents', documentsApi);
  app.use('/api/projects/:projectId/chats', chatsApi);
  app.use('/api/projects/:projectId/chats/:chatId/messages', messagesApi);
  app.use('/api', settingsApi);
  app.use('/', pages);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, CSP };
