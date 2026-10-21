// Threat model approvals through the NooblyJS lifecycle engine (root roadmap Phase 19), as Infrastructure's designs do:
// a threat model version waiting to be accepted has one open `threat-model` approval, so it shows on Home · Approvals.
// Deciding it on Home calls back into this app (`services.decideApproval`), which decides exactly as the Threat model
// screen does; deciding on the screen closes the approval there. Without the lifecycle engine (standalone) the
// decision is recorded on the threat model only.
export const TYPE = 'threat-model';
const APP = 'security';

export function createApprovals({ host, log, mountPath }) {
  const workflows = () => {
    const w = host.service('workflows');
    return typeof w?.requestAppApproval === 'function' ? w : null;
  };
  const refOf = (tm) => ({ app: APP, id: tm.id, version: tm.version, kind: TYPE });

  /** Opens (or replaces) the approval of the threat model's current version. False when the engine isn't there. */
  async function request(tm) {
    const w = workflows();
    if (!w) return false;
    try {
      await w.requestAppApproval({
        type: TYPE, itemId: tm.itemId, title: tm.title, subject: `${tm.id} v${tm.version}`, ref: refOf(tm),
        link: `${mountPath}/threat-models/${tm.id}`,
        line: `Accept the threat model · drafted by ${tm.draftedBy?.name ?? 'the security agent'}`,
        context: `${tm.title}, version ${tm.version}: ${tm.threats.length} threats across ${tm.boundaries.length} trust boundaries, each with a mitigation.`,
        requestedBy: tm.draftedBy ? { id: tm.draftedBy.id, name: tm.draftedBy.name, kind: tm.draftedBy.kind ?? 'agent' } : { id: APP, name: 'Security', kind: 'app' },
      });
      return true;
    } catch (err) {
      // The threat model keeps its own record; the approval on Home can be made again.
      log.warn(`approvals: ${tm.id}: ${err.message}`);
      return false;
    }
  }

  /** A decision taken on the Threat model screen closes the matching approval in the lifecycle engine. */
  async function decidedHere(tm, { decision, person, comment }) {
    const w = workflows();
    if (!w) return null;
    try {
      return await w.closeAppApproval({ type: TYPE, ref: refOf(tm), decision, reason: comment ?? null, actor: person });
    } catch (err) {
      log.warn(`approvals: closing ${tm.id}: ${err.message}`);
      return null;
    }
  }

  return { request, decidedHere, refOf };
}
