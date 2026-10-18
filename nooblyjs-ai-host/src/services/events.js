// The event log: every state change is a named event (`<entity>.<past-tense verb>`), appended to
// data/events/YYYY/MM/YYYY-MM-DD.yaml and then published to in-process listeners (tech.md §2.1).
import { EventEmitter } from 'node:events';
import { now, daySegments } from '../util/dates.js';
import { newId } from '../util/ids.js';

const TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function createEvents({ store, clock = Date }) {
  const bus = new EventEmitter().setMaxListeners(200);
  return {
    /** Appends the event, then tells listeners. Resolves with the stored record. */
    async emit(type, payload = {}, { actor = null } = {}) {
      if (!TYPE.test(type)) throw new Error(`Event types look like "entity.past_tense_verb", not "${type}".`);
      const at = now(clock);
      const record = { id: newId('evt'), type, at, actor, payload };
      await store.appendYaml(['events', ...daySegments(at)], record);
      bus.emit(type, record);
      bus.emit('*', record);
      return record;
    },
    /** `fn(record)` for one type, or every type with '*'. Returns a function that unsubscribes. */
    on(type, fn) {
      bus.on(type, fn);
      return () => bus.off(type, fn);
    },
    /** The events of one day (YYYY-MM-DD), oldest first. */
    day: (date) => store.readYamlStream(['events', ...daySegments(date)]),
  };
}
