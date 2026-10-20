// What each Infrastructure event says in NooblyJS's Activity (the sentence without the actor: "Stevie" + "approved …").
// Every event this app emits goes through withWords(), which adds `system: 'infrastructure'` and the sentence,
// unless the emitter already gave one. An event with no entry here keeps NooblyJS's generic wording.
import { KIND_LABEL } from '../util/ids.js';

const kind = (p) => KIND_LABEL[p.kind] ?? p.kind ?? '';
const design = (p) => `${p.designId}${p.version ?? p.designVersion ? ` v${p.version ?? p.designVersion}` : ''}`;

const WORDS = {
  'infra_design.approved': (p) => `approved infrastructure design ${design(p)} for ${kind(p)}`,
  'infra_design.changes_requested': (p) => `asked for changes to infrastructure design ${design(p)}${p.comment ? `: ${p.comment}` : ''}`,
  'infra_design.updated': (p) => `updated infrastructure design ${design(p)}${p.reason ? ` (${p.reason})` : ''}`,
  'environment.plan_ready': (p) => `planned ${p.environment} from ${design(p)}: +${p.plan?.add ?? 0} to add, ~${p.plan?.change ?? 0} to change`,
  'environment.provisioning_started': (p) => `started provisioning ${p.environment} from ${design(p)}`,
  'environment.provisioned': (p) => `provisioned ${p.environment} from ${design(p)}`,
  'environment.provisioning_failed': (p) => `failed to provision ${p.environment}: ${p.reason}`,
  'drift.detected': (p) => `found drift on ${p.environment}: ${p.summary ?? 'a setting changed by hand'}`,
  'drift.restored': (p) => `restored ${p.environment} from its design`,
  'drift.accepted': (p) => `kept the change made by hand on ${p.environment}; ${design(p)} waits for approval`,
};

/** The host's `events`, with every emit from this app named and worded. */
export function withWords(events) {
  return {
    ...events,
    emit(type, payload = {}, options) {
      const words = WORDS[type];
      // drift.detected's own `summary` is the finding ("Redis cache maxmemory changed by hand"): keep it as detail.
      const said = type === 'drift.detected' ? { summary: words(payload), detail: payload.summary ?? null }
        : payload.summary ? {} : words ? { summary: words(payload) } : {};
      return events.emit(type, { system: 'infrastructure', ...payload, ...said }, options);
    },
  };
}
