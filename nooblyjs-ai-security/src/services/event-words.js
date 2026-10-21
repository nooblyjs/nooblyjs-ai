// What each Security event says in NooblyJS's Activity (the sentence without the actor). Every event this app emits goes
// through withWords(), which adds `system: 'security'` and the sentence, unless the emitter already gave one.
const WORDS = {
  'threat_model.accepted': (p) => `accepted threat model ${p.threatModelId} v${p.version} for ${p.itemId}`,
  'threat_model.changes_requested': (p) => `asked for changes to threat model ${p.threatModelId} v${p.version}${p.comment ? `: ${p.comment}` : ''}`,
  'finding.opened': (p) => `opened ${p.findingId} (${p.severity}) on ${p.repo}: ${p.title}`,
  'finding.closed': (p) => `closed ${p.findingId}: ${p.proof}`,
  'finding.reopened': (p) => `reopened ${p.findingId}: ${p.reason}`,
  'finding.fix_requested': (p) => `asked the Software Factory to fix ${p.findingId} (run ${p.runId})`,
  'finding.owner_changed': (p) => `gave ${p.findingId} to ${p.owner}`,
  'risk.accepted': (p) => `accepted the risk of ${p.findingId} for ${p.days} days: ${p.reason}`,
  'risk.expired': (p) => `the risk acceptance of ${p.findingId} expired`,
};

/** The host's `events`, with every emit from this app named and worded. */
export function withWords(events) {
  return {
    ...events,
    emit(type, payload = {}, options) {
      const words = WORDS[type];
      return events.emit(type, { system: 'security', ...payload, ...(payload.summary || !words ? {} : { summary: words(payload) }) }, options);
    },
  };
}
