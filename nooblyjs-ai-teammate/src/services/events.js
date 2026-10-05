// Live events for open browser tabs: the /api/events SSE endpoint relays them. They are published on core's
// notifying service under one topic, so the most recent ones can be inspected on /services/notifying/.
// Without a notifying service (unit tests) a plain in-process emitter is used.
import { EventEmitter } from 'node:events';

export const EVENTS_TOPIC = 'teammates.events';

export class EventBus {
  constructor(notifying = null, { log = null } = {}) {
    this.notifying = notifying;
    this.log = log;
    this.local = notifying ? null : new EventEmitter().setMaxListeners(1000);
  }

  /** Subscribers are called synchronously, in publish order. */
  publish(type, data) {
    const event = { type, data };
    if (this.local) return void this.local.emit('event', event);
    this.notifying.notify(EVENTS_TOPIC, event).catch((err) => this.log?.warn?.(`[events] could not publish ${type}: ${err.message}`));
  }

  /** Calls `fn({ type, data })` for every event. Resolves with a function that unsubscribes. */
  async subscribe(fn) {
    if (this.local) {
      this.local.on('event', fn);
      return () => this.local.off('event', fn);
    }
    await this.notifying.subscribe(EVENTS_TOPIC, fn);
    return () => this.notifying.unsubscribe(EVENTS_TOPIC, fn);
  }
}
