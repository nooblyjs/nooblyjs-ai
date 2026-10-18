// Flow across the stages (docs/roadmap-history.md P7): the history of handoffs and send-backs (Handoffs screen, metrics),
// sending an item back (a person's decision, carried out by the NooblyJS lifecycle engine), what is waiting on a person (Home and
// For you), Knowledge flags on specs that cite a flagged answer, and the Product Factory's metrics facts.
import { validator } from '../util/validate.js';
import { isId } from '../util/ids.js';
import { HttpError, notFound } from '../util/errors.js';
import { STAGES, stageLabel } from './stages.js';
import { monthSpend } from './views.js';

const ORDER = STAGES.map((s) => s.key); // product → architecture → ux → ui → build
const DAY = 86400000;
const LIFECYCLE_STAGES = { discover: 'product', specify: 'product', architect: 'architecture' };

export function createFlowService({ repos, host, log, people }) {
  const now = () => new Date().toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });

  /** Appends one handoff or send-back to the history. */
  async function record(entry) {
    await repos.flow.append({ at: entry.at ?? now(), ...entry });
  }

  async function history() {
    try {
      return await repos.flow.list();
    } catch (err) {
      log.warn(`flow history unreadable: ${err.message}`);
      return [];
    }
  }

  /** The Handoffs screen: every stage-to-stage move, newest first, in words. */
  async function handoffs({ kind } = {}) {
    const everyone = new Map((await people.list().catch(() => [])).map((p) => [p.id, p.name]));
    const specs = new Map((await repos.specs.list()).map((s) => [s.id, s]));
    return (await history())
      .filter((h) => !kind || h.kind === kind)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .map((h) => ({
        ...h,
        title: specs.get(h.itemId)?.title ?? h.itemId,
        byName: everyone.get(h.by) ?? h.by,
        text: h.kind === 'sent-back'
          ? `${h.from && h.from !== h.to ? `Sent back from ${stageLabel(h.from)} to ${stageLabel(h.to)}` : `Sent back within ${stageLabel(h.to)}`}: ${h.reason ?? 'no reason given'}`
          : `${stageLabel(h.from)} → ${stageLabel(h.to)}${h.note ? ` · ${h.note}` : ''}`,
      }));
  }

  /**
   * Send back (a person's decision): the NooblyJS lifecycle engine moves the item; the engine keeps every artefact and marks the
   * spec when item.sent_back arrives.
   */
  async function sendBack(itemId, body, actor) {
    const spec = isId(itemId) ? await repos.specs.get(itemId) : null;
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    const f = validator(body).only(['from', 'to', 'reason'])
      .oneOf('from', ORDER).oneOf('to', ORDER, { required: true }).string('reason', { required: true, max: 2000 }).result();
    const from = f.from ?? (spec.status === 'approved' ? 'architecture' : 'product');
    if (ORDER.indexOf(f.to) > ORDER.indexOf(from)) throw new HttpError(422, 'invalid', 'Send back goes to an earlier stage.', { to: `must come before ${stageLabel(from)}` });
    const workflows = host.service('workflows');
    if (typeof workflows?.sendBack !== 'function') {
      throw new HttpError(503, 'workflows_unavailable', 'The NooblyJS lifecycle engine is not running here, so the item can\'t be sent back. Nothing was changed.');
    }
    await workflows.sendBack({ itemId, system: 'product', from, to: f.to, reason: f.reason, actor: { id: actor.id, kind: 'person' } });
    return { itemId, from, to: f.to, sent: true, text: `${itemId} is going back to ${stageLabel(f.to)}. Its work so far is kept.` };
  }

  /** item.sent_back from the NooblyJS lifecycle engine: record it, and reopen the spec when it goes back to Product. */
  async function onSentBack(event) {
    const p = { ...(event?.payload ?? {}) };
    if ((p.system && p.system !== 'product') || !isId(p.itemId ?? '')) return;
    // the NooblyJS lifecycle engine names the lifecycle's stages (specify, architect); here they are the Product Factory's.
    p.from = LIFECYCLE_STAGES[p.from] ?? p.from;
    p.to = LIFECYCLE_STAGES[p.to] ?? p.to;
    try {
      const at = event.at ?? now();
      await record({ at, itemId: p.itemId, kind: 'sent-back', from: p.from ?? null, to: p.to ?? 'product', by: event.actor ?? null, reason: p.reason ?? null });
      await repos.specs.update(p.itemId, (spec) => (spec
        ? { ...spec, sentBack: { from: p.from ?? null, to: p.to ?? 'product', reason: p.reason ?? null, at, by: event.actor ?? null }, ...(p.to === 'product' || !p.to ? { status: 'changes-requested' } : {}), updatedAt: at }
        : null));
      await emit('spec.updated', { specId: p.itemId, change: 'sent-back', to: p.to ?? 'product' }, { id: event.actor });
    } catch (err) {
      log.error(`item.sent_back for ${p.itemId}: ${err.message}`);
    }
  }

  /** knowledge.answer_flagged: specs that cite the flagged knowledge are marked so their owner rechecks them. */
  async function onKnowledgeFlagged(event) {
    const p = event?.payload ?? {};
    const ids = new Set([p.knowledgeId, p.sourceId, ...(p.sourceIds ?? [])].filter(Boolean));
    if (!ids.size) return;
    try {
      for (const spec of await repos.specs.list()) {
        const hits = (spec.knowledge ?? []).filter((k) => ids.has(k.id));
        if (!hits.length) continue;
        await repos.specs.update(spec.id, (s) => (s ? {
          ...s,
          knowledgeFlags: [...(s.knowledgeFlags ?? []).filter((f) => !ids.has(f.id)), ...hits.map((k) => ({ id: k.id, reason: p.reason ?? 'An answer from this source was flagged', at: event.at ?? now() }))],
        } : null));
        await emit('spec.updated', { specId: spec.id, change: 'knowledge-flagged', links: hits.map((k) => k.id) }, { id: event.actor });
      }
    } catch (err) {
      log.error(`knowledge.answer_flagged: ${err.message}`);
    }
  }

  /** What is waiting on this person in the Product Factory (Home · Waiting on you, For you). */
  async function waitingFor(person) {
    if (!person?.id) return [];
    const rows = [];
    const specs = await repos.specs.list();
    for (const s of specs) {
      if (s.status === 'in-review' && (s.reviewers ?? []).some((r) => r.id === person.id && r.status === 'waiting')) {
        rows.push({ kind: 'spec-approval', itemId: s.id, text: `Approve ${s.id} · ${s.title}`, link: `/product/specs/${s.id}` });
      }
      if (s.status === 'awaiting-brief' && s.owner === person.id) {
        rows.push({ kind: 'brief', itemId: s.id, text: `Brief the agent on ${s.id} · ${s.title}`, link: `/product/specs/${s.id}` });
      }
    }
    if (['Architect', 'Owner'].includes(person.accessRole)) {
      for (const itemId of await repos.artefacts.folders(['architecture'])) {
        if (!isId(itemId)) continue;
        for (const adr of await repos.artefacts.list(['architecture', itemId, 'adrs'])) {
          if (adr.status === 'proposed') rows.push({ kind: 'adr', itemId, adrId: adr.id, text: `Accept or discuss ${adr.id} · ${adr.title}`, link: `/product/architecture/${itemId}` });
        }
      }
    }
    if (['Approver', 'Architect', 'Owner'].includes(person.accessRole)) {
      for (const itemId of await repos.artefacts.folders(['ui'])) {
        const h = isId(itemId) ? await repos.artefacts.get(['ui', itemId, 'handoff.md']) : null;
        if (h?.workItems?.length && (h.status ?? 'draft') === 'draft') rows.push({ kind: 'ui-handoff', itemId, text: `Send ${itemId} to the Software Factory (${h.workItems.length} work items)`, link: `/product/ui/${itemId}` });
      }
    }
    return rows;
  }

  /** Metrics facts for NooblyJS Metrics (NooblyJS Phase 10): lead time, sent-back rate per stage, spend. */
  async function metrics({ month = now().slice(0, 7) } = {}) {
    const [h, specs, drafts] = await Promise.all([history(), repos.specs.list(), repos.drafts.list()]);
    const created = new Map(specs.map((s) => [s.id, s.createdAt]));
    const lead = h.filter((x) => x.kind === 'handoff' && x.from === 'product' && created.get(x.itemId))
      .map((x) => (Date.parse(x.at) - Date.parse(created.get(x.itemId))) / DAY).filter((d) => d >= 0).sort((a, b) => a - b);
    const median = lead.length ? lead[Math.floor((lead.length - 1) / 2)] : null;
    const perStage = ORDER.filter((k) => k !== 'build').map((key) => {
      const out = h.filter((x) => x.from === key && x.kind === 'handoff').length;
      const back = h.filter((x) => x.from === key && x.kind === 'sent-back').length;
      const total = out + back;
      return { stage: key, label: stageLabel(key), handedOn: out, sentBack: back, rate: total ? back / total : null, text: total ? `${back} of ${total} sent back` : 'Nothing has left this stage yet' };
    });
    const byStage = {};
    for (const d of drafts.filter((x) => String(x.createdAt ?? '').startsWith(month))) byStage[d.stage ?? 'product'] = Math.round(((byStage[d.stage ?? 'product'] ?? 0) + (Number(d.costUsd) || 0)) * 100) / 100;
    return {
      leadTime: { medianDays: median == null ? null : Math.round(median * 10) / 10, items: lead.length, text: median == null ? 'No spec has reached Architecture yet' : `${Math.round(median * 10) / 10} days from spec to Architecture (median of ${lead.length})` },
      sentBack: perStage,
      spend: { month, usedUsd: monthSpend({ drafts }, month), byStage },
    };
  }

  return { record, history, handoffs, sendBack, onSentBack, onKnowledgeFlagged, waitingFor, metrics };
}

