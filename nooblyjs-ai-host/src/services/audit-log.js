// The audit log: one record per write and per refusal, appended to data/audit/YYYY/MM/YYYY-MM-DD.yaml.
import { now, daySegments } from '../util/dates.js';
import { newId } from '../util/ids.js';

export function createAuditLog({ store, clock = Date }) {
  return {
    /** Appends `{ actor, action, target, status, … }` with an id and a time. Resolves with the stored record. */
    async record(entry) {
      const at = now(clock);
      const record = { id: newId('aud'), at, actor: null, ...entry };
      await store.appendYaml(['audit', ...daySegments(at)], record);
      return record;
    },
    /** The audit records of one day (YYYY-MM-DD), oldest first. */
    day: (date) => store.readYamlStream(['audit', ...daySegments(date)]),
  };
}
