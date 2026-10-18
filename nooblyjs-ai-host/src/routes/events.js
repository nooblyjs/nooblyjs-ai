// GET /api/v1/events/stream: live updates as Server-Sent Events (tech.md §4.2). One stream per tab carries every
// event a signed-in person may see, as `event: noobly` with the Activity row as its data; the kit's sse.js hands each
// to the pages subscribed to its type (or to '*'). There is no WebSocket server: changes are sent with plain POST.
// A reconnecting browser sends Last-Event-ID, and today's events after that one are replayed.
import { daySegments } from '../util/dates.js';

const HEARTBEAT_MS = 25_000;

export function eventRoutes({ express, events, activity, store, clock, requireSignIn, log }) {
  const router = express.Router();
  const open = new Set();

  router.get('/api/v1/events/stream', requireSignIn, async (req, res) => {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: the compression middleware must not buffer the stream.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    const send = async (event) => {
      try {
        const row = await activity.streamRow(event);
        // Events Activity leaves out (sign-ins, the dev clock) still tell pages to refresh, without a row.
        // Chat events say which thread they belong to, so the open panel knows whether to refresh.
        const p = event.payload ?? {};
        const thread = p.threadId ? { threadId: p.threadId, messageId: p.messageId, cardId: p.cardId, agentId: p.agentId, agentName: p.agentName } : {};
        // The Teams simulator follows its meeting the same way.
        const meeting = p.conversationId ? { conversationId: p.conversationId } : {};
        // A hosted app's live update for its own pages carries its data as `live` (Teammates' status changes).
        const live = p.live && typeof p.live === 'object' ? { live: p.live } : {};
        const data = { ...(row ?? { id: event.id, type: event.type, at: event.at }), ...thread, ...meeting, ...live };
        res.write(`id: ${event.id}\nevent: noobly\ndata: ${JSON.stringify({ ...data, topic: event.type })}\n\n`);
      } catch (err) {
        log.warn(`event stream: ${err.message}`);
      }
    };

    const lastId = req.get('last-event-id');
    if (lastId) {
      const today = await store.readYamlStream(['events', ...daySegments(new Date(clock.now()).toISOString())]).catch(() => []);
      const from = today.findIndex((e) => e.id === lastId);
      if (from >= 0) for (const event of today.slice(from + 1)) await send(event);
    }

    // One at a time, so events reach the browser in the order they happened (preparing a row is asynchronous).
    let sending = Promise.resolve();
    const off = events.on('*', (event) => { sending = sending.then(() => send(event)); });
    const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    beat.unref?.();
    const end = () => {
      clearInterval(beat);
      off();
      open.delete(end);
      if (!res.writableEnded) res.end();
    };
    open.add(end);
    req.on('close', end);
  });

  return { router, closeAll: () => { for (const end of [...open]) end(); } };
}
