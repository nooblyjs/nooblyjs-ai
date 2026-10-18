// One error shape for every API answer: { "error": { "code", "message", "details" } } (NooblyJS tech.md §4.2).
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
export const forbidden = (code, message, details) => new HttpError(403, code, message, details);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);
export const refused = (code, message, details) => new HttpError(422, code, message, details);

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
    const clientError = err.status >= 400 && err.status < 500;
    const status = err instanceof HttpError || clientError ? err.status : 500;
    if (status >= 500) log.error(`${req.method} ${req.originalUrl}: ${err.stack ?? err.message}`);
    if (res.headersSent) return;
    const code = err instanceof HttpError ? err.code : status === 500 ? 'internal_error' : 'bad_request';
    const message = status === 500 ? 'Something went wrong on our side. It has been logged.' : err.message;
    sendError(res, status, code, message, err.details);
  };
}
