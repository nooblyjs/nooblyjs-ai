// The Product section's checks and its part of the trace (NooblyJS Phase 16f, root design.md §4–§5).
//
//   checksFor(itemId)   the spec's readiness (its seven checks, worked out from the spec where the text can say) and the
//                       standards check of its container view, in NooblyJS's one shape (NooblyJS gives each its id)
//   trace(itemId)       the spec, its goals (GOAL-031-1: a row of its Goals table), its decisions (ADR-014) and quality
//                       attributes (QA-031-1), each linked to the item
import { CHECKS } from './readiness.js';
import { parseSpec } from './spec-format.js';

const num = (itemId) => String(itemId).replace(/^[A-Z]+-/, '');

export function createProductChecks({ repos, architecture, specWrites, mountPath = '/product' }) {
  async function checksFor(itemId) {
    const spec = await repos.specs.get(itemId).catch(() => null);
    if (!spec) return [];
    const subject = { item: itemId, ref: `${itemId} v${spec.version ?? 0}` };
    const facts = (await specWrites.facts(itemId).catch(() => null))?.facts ?? {};
    const readiness = CHECKS.map((c) => {
      const f = facts[c.key];
      const result = f?.value === true ? 'passed' : f?.value === false ? 'failed' : 'not-run';
      return {
        key: c.key, kind: 'readiness', subject, definedBy: { system: 'product', ref: `spec readiness · ${c.key}` },
        verifiedBy: f?.source === 'recorded' ? 'person' : 'spec content', severity: 'blocking', result,
        text: result === 'passed' ? c.passed : result === 'failed' ? c.failed : `${c.passed}: not checked yet`,
        evidence: { system: 'product', ref: `${mountPath}/specs/${itemId}`, summary: f?.source === 'recorded' ? 'Recorded on the spec by a person' : `Read from the spec (version ${spec.version ?? 0})` },
        at: spec.updatedAt ?? null,
      };
    });
    const standards = await architecture.standardsCheck(itemId).catch(() => null);
    const std = (standards?.checks ?? []).map((c) => ({
      key: c.key, kind: 'standard', subject, definedBy: { system: 'product', ref: `standards.yaml#${c.key}` },
      verifiedBy: 'standards check', severity: 'blocking', result: c.passed === true ? 'passed' : c.passed === false ? 'failed' : 'not-run',
      text: c.text, evidence: { system: 'product', ref: `${mountPath}/architecture/${itemId}`, summary: `The container view: ${c.text}` }, at: null,
    }));
    return [...readiness, ...std];
  }

  async function trace(itemId) {
    const spec = await repos.specs.get(itemId).catch(() => null);
    if (!spec) return { nodes: [], links: [] };
    const nodes = [{ id: itemId, type: 'item', title: spec.title, system: 'product', href: `${mountPath}/specs/${itemId}` }];
    const links = [];
    parseSpec(spec.body).goals.forEach((g, i) => {
      const id = `GOAL-${num(itemId)}-${i + 1}`;
      nodes.push({ id, type: 'goal', title: `${g.measure}: ${g.today ?? '?'} → ${g.target ?? '?'}`, system: 'product', href: `${mountPath}/specs/${itemId}` });
      links.push({ from: id, rel: 'goal-of', to: itemId });
    });
    for (const a of await architecture.adrs(itemId).catch(() => [])) {
      nodes.push({ id: a.id, type: 'adr', title: `${a.title} (${a.status})`, system: 'product', href: `${mountPath}/architecture/${itemId}` });
      links.push({ from: a.id, rel: 'decides', to: itemId });
    }
    ((await architecture.qualityAttributes(itemId).catch(() => null))?.attributes ?? []).forEach((q, i) => {
      const id = `QA-${num(itemId)}-${i + 1}`;
      nodes.push({ id, type: 'quality-attribute', title: `${q.attribute}: ${q.scenario} · ${q.target}`, system: 'product', href: `${mountPath}/architecture/${itemId}` });
      links.push({ from: id, rel: 'quality-attribute-of', to: itemId });
    });
    return { nodes, links };
  }

  return { checksFor, trace };
}
