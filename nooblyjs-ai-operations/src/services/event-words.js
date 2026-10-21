// What each Operations event says in NooblyJS's Activity (the sentence without the actor). Every event this app emits
// goes through withWords(), which adds `system: 'operations'` and the sentence, unless the emitter already gave one.
const WORDS = {
  'release.created': (p) => `made the release ${p.releaseId} of ${p.featureId}`,
  'release.approval_requested': (p) => `asked for the deploy approval of ${p.releaseId}`,
  'release.refused': (p) => `${p.releaseId} can't go to production yet`,
  'release.deployed': (p) => `deployed ${p.releaseId} to ${p.percent}% of ${p.environment}`,
  'release.rolled_back': (p) => `rolled ${p.releaseId} back: ${p.reason}`,
};

/** The host's `events`, with every emit from this app named and worded. */
export function withWords(events) {
  return {
    ...events,
    emit(type, payload = {}, options) {
      const words = WORDS[type];
      return events.emit(type, { system: 'operations', ...payload, ...(payload.summary || !words ? {} : { summary: words(payload) }) }, options);
    },
  };
}
