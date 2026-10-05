// Fetch wrapper for the JSON API plus a Server-Sent Events reader for streamed tasks.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

// The server requires the session's CSRF token on every change; app.js sets it after sign-in.
let csrf = '';
let onSignedOut = () => {};
export const setCsrf = (token) => (csrf = token ?? '');
export const whenSignedOut = (fn) => (onSignedOut = fn);

const headersFor = (method, extra) => ({ ...extra, ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) });

async function fail(res) {
  const err = new ApiError(res.status, await res.json().catch(() => null));
  if (res.status === 401 && err.code === 'unauthenticated') onSignedOut();
  throw err;
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: headersFor(method, body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) await fail(res);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url, body) => request('DELETE', url, body),
};

/** POST and read an SSE response. `on` maps event names to handlers. Resolves when the stream ends. */
export async function stream(url, body, on, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: headersFor('POST', { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) await fail(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data) on[event]?.(JSON.parse(data));
    }
  }
}
