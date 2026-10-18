// One error shape for every API answer: { "error": { "code", "message", "details" } } (tech.md §4.2).

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const sendError = (res, status, code, message, details) =>
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

/** True for requests that want JSON back (API calls), false for page loads. */
// originalUrl, not path: inside a hosted app's router req.path is relative (/teammates/api/v1/x arrives as /x).
export const wantsJson = (req) => (req.originalUrl ?? req.url).split('?')[0].includes('/api/') || req.get('accept')?.includes('application/json') === true;
