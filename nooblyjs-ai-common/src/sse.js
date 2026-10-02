// @ts-check
// Server-Sent Events (SSE): reading them (a model API's streamed reply) and
// writing them (an app streaming to a browser). The parser moved here from the
// harness's providers/sse.js (harness Phase 03).
//
// Reading.
//
// With `stream: true` the API keeps the HTTP response open and writes events
// as the model generates them. On the wire it looks like this:
//
//   event: content_block_delta
//   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}
//   <blank line>
//
// A blank line ends each event. The tricky part: the network hands us bytes in
// chunks of any size, so one chunk can end in the middle of an event, a line,
// or even a multi-byte character like "é". We keep a buffer and only parse
// events once we have seen their closing blank line.

/**
 * Turn a stream of bytes into a stream of { event, data } objects.
 * @param {AsyncIterable<Uint8Array>} byteStream e.g. `response.body` from fetch
 */
export async function* parseSSE(byteStream) {
  // `stream: true` makes the decoder hold back half a character until the rest arrives.
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of byteStream) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');

    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = parseEvent(raw);
      if (event) yield event;
    }
  }

  // The stream ended. Parse anything left that wasn't followed by a blank line.
  buffer += decoder.decode();
  const last = parseEvent(buffer);
  if (last) yield last;
}

/**
 * Parse the text of one event (the lines between two blank lines).
 * @param {string} raw
 */
export function parseEvent(raw) {
  let event = 'message';
  const dataLines = [];

  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // ":" lines are comments / keep-alives
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n');
  // OpenAI-style streams end with a plain "data: [DONE]", which isn't JSON.
  if (data === '[DONE]') return { event: 'done', data: null };
  return { event, data: JSON.parse(data) };
}

// Writing.
//
// The other direction: an app streaming to a browser's EventSource. Each event is
// a few "field: value" lines and a blank line; `id` lets a browser that lost the
// connection reconnect with a Last-Event-ID header and resume, and `retry` tells
// it how long to wait before reconnecting. Lines starting with ":" are comments,
// which keep proxies from closing a connection that has gone quiet.

/**
 * One event as SSE text. Objects are sent as JSON; a string with newlines
 * becomes several data lines, which the browser joins back together.
 * @param {{ event?: string, data?: unknown, id?: string | number, retry?: number }} message
 */
export function formatSSE({ event, data, id, retry }) {
  let text = '';
  if (id !== undefined) text += `id: ${id}\n`;
  if (event) text += `event: ${event}\n`;
  if (retry !== undefined) text += `retry: ${retry}\n`;
  if (data !== undefined) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const line of payload.split('\n')) text += `data: ${line}\n`;
  }
  return `${text}\n`;
}

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform', // no-transform: proxies must not buffer or compress the stream
  connection: 'keep-alive',
  'x-accel-buffering': 'no', // nginx: pass each event through at once
};

/**
 * Start an SSE response on a Node (or Express) response object.
 * @param {import('node:http').ServerResponse} res
 * @param {{ status?: number, retryMs?: number, heartbeatMs?: number, headers?: Record<string, string> }} [options]
 *   heartbeatMs: send a ":" comment this often (0 = never); retryMs: the browser's reconnect delay
 */
export function openSSE(res, { status = 200, retryMs, heartbeatMs = 15_000, headers = {} } = {}) {
  res.writeHead(status, { ...SSE_HEADERS, ...headers });
  res.socket?.setNoDelay(true);
  if (retryMs !== undefined) res.write(`retry: ${retryMs}\n\n`);

  const beat = heartbeatMs > 0 ? setInterval(() => res.write(': keep-alive\n\n'), heartbeatMs) : undefined;
  const stop = () => clearInterval(beat);
  res.on('close', stop);

  return {
    /**
     * @param {string | undefined} event
     * @param {unknown} data
     * @param {{ id?: string | number }} [options]
     */
    send(event, data, { id } = {}) {
      return res.write(formatSSE({ event, data, id }));
    },
    /** @param {string} [text] */
    comment(text = '') {
      return res.write(`: ${text}\n\n`);
    },
    /** Stop the heartbeat, leaving the response open. */
    stop,
    /** Stop the heartbeat and end the response. */
    close() {
      stop();
      res.end();
    },
  };
}
