// One error shape for every API answer: { "error": { "code", "message", "details" } } (noobly structure.md §2a).
// Services throw HttpError; the API's error handler turns it into the shape. Anything else is a 500 and is logged.

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const forbidden = (message, details) => new HttpError(403, 'forbidden', message, details);
export const notFound = (message = 'Not found.', details) => new HttpError(404, 'not_found', message, details);
export const conflict = (message, details) => new HttpError(409, 'conflict', message, details);
export const unprocessable = (message, details) => new HttpError(422, 'invalid', message, details);

export const sendError = (res, status, code, message, details) =>
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

/** The last two handlers of the API router: unknown routes, then errors. */
export function apiNotFound(req, res) {
  sendError(res, 404, 'not_found', 'No such API route.');
}

export function apiErrors({ log }) {
  // Express recognises an error handler by its four parameters.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    // Express's own client errors (a body that isn't JSON, one that's too large) carry a 4xx status.
    const clientError = err.status >= 400 && err.status < 500;
    const status = err instanceof HttpError || clientError ? err.status : 500;
    if (status >= 500) log.error(`${req.method} ${req.originalUrl}: ${err.stack ?? err.message}`);
    if (res.headersSent) return;
    // A refusal passed on from another app (the lifecycle engine's readiness_failed) keeps its own code.
    const passedOn = clientError && typeof err.code === 'string' && /^[a-z][a-z0-9_]{1,60}$/.test(err.code) ? err.code : null;
    const code = err instanceof HttpError ? err.code : status === 500 ? 'internal_error' : passedOn ?? 'bad_request';
    const message = status === 500 ? 'Something went wrong on our side. It has been logged.' : err.message;
    sendError(res, status, code, message, err.details);
  };
}
