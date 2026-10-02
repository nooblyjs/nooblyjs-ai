// An error returned by a model API, e.g. a bad key (401) or rate limit (429).
//
// The code now lives in nooblyjs-ai-common (src/errors.js), shared with the other
// nooblyjs AI projects. The explanation moved with it: read it there.
export { ApiError, retryAfterMs } from 'nooblyjs-ai-common/errors';
