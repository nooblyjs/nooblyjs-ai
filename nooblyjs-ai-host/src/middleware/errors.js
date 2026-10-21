// The last handlers: 404s and errors, in the one error shape for APIs and a short page otherwise.
import { HttpError, sendError, wantsJson } from '../util/errors.js';

export function notFound(req, res) {
  if (wantsJson(req)) return sendError(res, 404, 'not_found', 'No such API route.');
  res.status(404).type('text').send('Not found.');
}

export function errorHandler({ log }) {
  // Express recognises an error handler by its four parameters.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const clientError = err.status >= 400 && err.status < 500;
    const status = err instanceof HttpError ? err.status : clientError ? err.status : 500;
    if (status >= 500) log.error(`${req.method} ${req.originalUrl}: ${err.stack ?? err.message}`);
    if (res.headersSent) return;
    // Another module's error (the lifecycle engine's) keeps its own code ("people_only"), as an HttpError does.
    const own = clientError && typeof err.code === 'string' && /^[a-z][a-z0-9_]{1,60}$/.test(err.code) ? err.code : null;
    const code = err instanceof HttpError ? err.code : own ?? (status === 500 ? 'internal_error' : 'bad_request');
    const message = status === 500 ? 'Something went wrong on our side. It has been logged.' : err.message;
    if (wantsJson(req)) return sendError(res, status, code, message, err.details);
    res.status(status).type('text').send(message);
  };
}
