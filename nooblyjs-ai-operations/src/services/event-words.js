// What each Operations event says in NooblyJS's Activity (the sentence without the actor). Every event this app emits
// goes through withWords(), which adds `system: 'operations'` and the sentence, unless the emitter already gave one.
const WORDS = {
  'release.created': (p) => `made the release ${p.releaseId} of ${p.featureId}`,
  'release.approval_requested': (p) => `asked for the deploy approval of ${p.releaseId}`,
  'release.refused': (p) => `${p.releaseId} can't go to production yet`,
  'release.deployed': (p) => `deployed ${p.releaseId} to ${p.percent}% of ${p.environment}`,
  'release.rolled_back': (p) => `rolled ${p.releaseId} back: ${p.reason}`,
  'slo.created': (p) => `made the SLO ${p.sloId} for ${p.itemId}`,
  'slo.alert': (p) => `alerted on ${p.sloId}: ${p.level}`,
  'incident.declared': (p) => `declared ${p.incidentId}: ${p.title}`,
  'incident.resolved': (p) => `resolved ${p.incidentId}`,
  'outcome_review.closed': (p) => `closed ${p.itemId} with its outcome review`,
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
