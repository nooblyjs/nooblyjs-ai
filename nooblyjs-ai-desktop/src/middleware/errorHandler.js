'use strict';

const { AppError } = require('../lib/errors');
const logger = require('../lib/logger');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } });
  }
  return res.status(404).render('error', { title: 'Not found', status: 404, message: 'That page does not exist.' });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, next) {
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : 500;

  if (status >= 500) {
    logger.error('Request failed', { path: req.path, message: err.message, stack: err.stack });
  } else {
    logger.warn('Request rejected', { path: req.path, status, message: err.message });
  }

  if (res.headersSent) return res.end();

  const payload = isApp
    ? err.toJSON()
    : { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } };

  if (req.path.startsWith('/api/')) return res.status(status).json(payload);
  return res.status(status).render('error', {
    title: status === 404 ? 'Not found' : 'Error',
    status,
    message: payload.error.message
  });
}

module.exports = { asyncHandler, notFound, errorHandler };
