// @ts-check
// Phase F17: SERVER-SENT EVENTS. The event log, live, over one long HTTP response.
//
//   GET /api/events?after=120        (or the browser's own Last-Event-ID header on reconnect)
//
//   id: 121
//   event: factory
//   data: {"seq":121,"type":"step.started",…,"line":"▶ build"}
//
// Each message's id is the event's seq, so a browser that loses the connection
// reconnects with Last-Event-ID: 121 and gets exactly what it missed: nothing twice,
// nothing lost. That's the event log paying off again (F05): the log IS the feed.
//
// Other processes (factory serve, submit, inbox answers) append to the same SQLite file,
// so we POLL it (every pollMs, cheap: an indexed "seq > ?"), rather than rely on an
// in-process notification that would only see this process's events.
import { openSSE } from 'nooblyjs-ai-common/sse';

/**
 * @param {import('../store/events.js').Store} store
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ after?: number, pollMs?: number, heartbeatMs?: number, map?: (e: any) => any, filter?: (e: any) => boolean }} [options]
 */
export function streamEvents(store, req, res, { after, pollMs = 500, heartbeatMs = 15_000, map = (e) => e, filter = () => true } = {}) {
  const lastId = Number(req.headers['last-event-id']);
  let seq = Number.isFinite(lastId) && lastId > 0 ? lastId : (after ?? store.read().at(-1)?.seq ?? 0);
  // Headers, the "reconnect after 2s" hint and the keep-alive comments that stop proxies
  // closing a silent connection all come from openSSE (nooblyjs-ai-common).
  const sse = openSSE(res, { retryMs: 2000, heartbeatMs, headers: { 'cache-control': 'no-store' } });

  const flush = () => {
    for (const e of store.read({ after: seq })) {
      seq = e.seq;
      if (!filter(e)) continue;
      sse.send('factory', map(e), { id: e.seq });
    }
  };
  flush();
  const poll = setInterval(flush, pollMs);
  const stop = () => {
    clearInterval(poll);
    sse.stop();
  };
  req.on('close', stop);
  return { stop, get seq() { return seq; } };
}
