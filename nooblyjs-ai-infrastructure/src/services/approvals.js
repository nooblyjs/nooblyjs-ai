// Design approvals through the NooblyJS lifecycle engine (part of NooblyJS, roadmap I3, NooblyJS Phase 9a). A design version
// that waits for approval for a kind of environment (Test, Staging) has one open `infra-design` approval there, so it
// shows on Home · Approvals with the other decisions. Deciding it on Home calls back into this app
// (`services.decideApproval`), which decides exactly as the Design screen does; deciding on the Design screen closes
// the approval there. Without the lifecycle engine (standalone, or switched off) the decision is recorded on the
// design only, as before.
import { KIND_LABEL } from '../util/ids.js';

export const TYPE = 'infra-design';
const APP = 'infrastructure';

export function createApprovals({ repos, host, log, mountPath }) {
  const workflows = () => {
    const w = host.service('workflows');
    return typeof w?.requestAppApproval === 'function' ? w : null;
  };
  const refOf = (design, kind) => ({ app: APP, designId: design.id, version: design.version, kind, kindLabel: KIND_LABEL[kind] });

  /** The kinds the design's current version still waits on, by the apply rules. */
  async function waitingKinds(design) {
    const rules = await repos.config.applyRules();
    const kinds = Object.entries(rules.kinds ?? {}).filter(([, rule]) => rule === 'approval').map(([kind]) => kind);
    if (!['waiting-approval', 'approved'].includes(design.status)) return { all: kinds, waiting: [] };
    const approved = design.approvedVersion === design.version ? design.approvedKinds ?? [] : [];
    return { all: kinds, waiting: kinds.filter((k) => !approved.includes(k)) };
  }

  /**
   * Makes the lifecycle engine open approvals match the design: one per kind its current version waits on, none
   * for the others. `keep` is a kind being decided through the engine right now, which it closes itself.
   * Returns false when the engine isn't there.
   */
  async function sync(designId, { keep = null } = {}) {
    const w = workflows();
    if (!w) return false;
    const design = await repos.designs.get(designId);
    if (!design) return true;
    const { all, waiting } = await waitingKinds(design);
    for (const kind of all) {
      if (kind === keep) continue;
      try {
        if (waiting.includes(kind) && design.itemId) {
          await w.requestAppApproval({
            type: TYPE, itemId: design.itemId, title: design.title, subject: `${design.id} v${design.version}`,
            ref: refOf(design, kind), link: `${mountPath}/designs/${design.id}?kind=${kind}`,
            line: `Approve & provision · drafted by ${design.draftedBy?.name ?? 'a person'}`,
            context: `${design.title}, version ${design.version}. Approving it provisions the ${KIND_LABEL[kind]} environments built from this design.`,
            requestedBy: design.draftedBy ? { id: design.draftedBy.id, name: design.draftedBy.name, kind: design.draftedBy.kind ?? 'person' } : { id: APP, name: 'Infrastructure', kind: 'app' },
          });
        } else {
          await w.withdrawAppApprovals({ type: TYPE, ref: { app: APP, designId: design.id, kind }, reason: design.status === 'changes-requested' ? 'changes were requested' : `${KIND_LABEL[kind]} no longer waits on this design` });
        }
      } catch (err) {
        // The design keeps its own record; the approval on Home is a convenience that can be made again.
        log.warn(`approvals: ${design.id} ${kind}: ${err.message}`);
      }
    }
    return true;
  }

  /** Every design, once the lifecycle engine is there (at start it may mount after this app). */
  let synced = false;
  async function syncAll() {
    if (synced || !workflows()) return synced;
    for (const design of await repos.designs.list()) await sync(design.id);
    synced = true;
    return true;
  }

  /** A decision taken on the Design screen closes the matching approval in the lifecycle engine. */
  async function decidedHere(design, { kind, decision, person, comment }) {
    const w = workflows();
    if (!w || !kind) return null;
    try {
      return await w.closeAppApproval({ type: TYPE, ref: refOf(design, kind), decision, reason: comment ?? null, actor: person });
    } catch (err) {
      log.warn(`approvals: closing ${design.id} ${kind}: ${err.message}`);
      return null;
    }
  }

  return { sync, syncAll, decidedHere, waitingKinds };
}
