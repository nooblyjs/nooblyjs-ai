export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what) => new HttpError(404, 'not_found', `${what} not found`);
export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
