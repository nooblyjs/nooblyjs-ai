// Every error leaves in one shape: { error: { code, message, details } }. Unknown API paths answer in JSON too.
import { StoreError } from '../models/fs-store.js';

export const notFoundJson = (req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such API route.' } });

export function errorHandler({ log }) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = err instanceof StoreError ? 400 : err.status ?? err.statusCode ?? 500;
    if (status >= 500) log.error(err, { method: req.method, path: req.path });
    if (res.headersSent) return res.end();
    res.status(status).json({
      error: { code: err.code ?? (status === 400 ? 'bad_request' : 'internal_error'), message: status >= 500 && !err.code ? 'Something went wrong' : err.message, details: err.details },
    });
  };
}
