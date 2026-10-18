// Live events for open browser tabs. Each one goes to NooblyJS's event stream (host.events), where the UI kit's one
// EventSource per tab hands it to the pages that listen (ctx.sse): Teammates has no stream of its own. They are also
// published on core's notifying service under one topic, so the most recent ones can be inspected on
// /services/notifying/. Without a notifying service (unit tests) a plain in-process emitter is used.
import { EventEmitter } from 'node:events';

export const EVENTS_TOPIC = 'teammates.events';
/** The NooblyJS event each live event becomes. Its data travels as the event's `live` field. */
export const HOST_EVENT = {
  teammate: 'teammates.teammate_changed',
  timesheet: 'teammates.timesheet_changed',
  work: 'teammates.work_changed',
  approval: 'teammates.approval_changed',
  schedule: 'teammates.schedule_changed',
  alert: 'teammates.alert_raised',
  board: 'teammates.board_changed',
};

export class EventBus {
  constructor(notifying = null, { log = null, hostEvents = null } = {}) {
    this.notifying = notifying;
    this.log = log;
    this.hostEvents = hostEvents;
    this.local = notifying ? null : new EventEmitter().setMaxListeners(1000);
  }

  /** Subscribers are called synchronously, in publish order. */
  publish(type, data) {
    const event = { type, data };
    this.toHost(type, data);
    if (this.local) return void this.local.emit('event', event);
    this.notifying.notify(EVENTS_TOPIC, event).catch((err) => this.log?.warn?.(`[events] could not publish ${type}: ${err.message}`));
  }

  /** A host that can't take the event never fails the work that caused it. */
  toHost(type, data) {
    const name = HOST_EVENT[type];
    if (!name || !this.hostEvents?.emit) return;
    try {
      Promise.resolve(this.hostEvents.emit(name, { live: data })).catch((err) => this.log?.warn?.(`[events] the host did not take ${name}: ${err.message}`));
    } catch (err) {
      this.log?.warn?.(`[events] the host did not take ${name}: ${err.message}`);
    }
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
