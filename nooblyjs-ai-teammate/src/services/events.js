// In-process event bus. The /api/events SSE endpoint relays these to open browser tabs.
import { EventEmitter } from 'node:events';

export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }

  publish(type, data) {
    this.emit('event', { type, data });
  }
}
