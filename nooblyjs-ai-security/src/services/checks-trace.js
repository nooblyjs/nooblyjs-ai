// Security's part of NooblyJS's checks and trace (root design.md §4–§5, NooblyJS Phase 16f's one shape): an item's
// threat model acceptance and its findings as checks; and its threat model, threats, mitigations and findings in the
// trace. Pure over what the services return.
export function createChecksTrace({ findings, threatModels, mountPath }) {
  async function checksFor(itemId) {
    const out = [];
    const tm = await threatModels.forItem(itemId);
    out.push({
      key: 'threat-model-accepted', kind: 'review', subject: { item: itemId, ref: tm?.id ?? null }, definedBy: { system: 'security', ref: 'threat-model' },
      verifiedBy: 'person', severity: 'blocking', result: tm?.status === 'accepted' ? 'passed' : tm ? 'failed' : 'not-run',
      text: tm?.status === 'accepted' ? `${tm.id} v${tm.version} accepted by ${tm.decision?.byName ?? tm.decision?.by}` : tm ? `${tm.id} v${tm.version}: ${tm.statusText.toLowerCase()}` : 'No threat model yet',
      evidence: tm ? { system: 'security', ref: tm.id, summary: tm.text, href: tm.href } : null, override: null, at: tm?.decision?.at ?? tm?.draftedAt ?? null,
    });
    for (const f of await findings.list({ itemId })) {
      out.push({
        key: `finding-${f.id}`, kind: 'scan', subject: { item: itemId, ref: f.subject?.repo ?? null }, definedBy: { system: 'security', ref: `${f.kind}:${f.rule}` },
        verifiedBy: f.kind, severity: ['critical', 'high'].includes(f.severity) ? 'blocking' : 'warning',
        result: f.state === 'closed' ? 'passed' : f.state === 'accepted' ? 'warning' : 'failed',
        text: `${f.id} (${f.severityLabel}): ${f.title} · ${f.stateText} · ${f.fixByText}`,
        evidence: { system: 'security', ref: f.id, summary: f.proof?.text ?? f.detail ?? f.title, href: f.href }, override: f.acceptance && f.state === 'accepted' ? { by: f.acceptance.by, reason: f.acceptance.reason, at: f.acceptance.at } : null,
        at: f.closedAt ?? f.openedAt,
      });
    }
    return out;
  }

  async function trace(itemId) {
    const nodes = [];
    const links = [];
    const tm = await threatModels.forItem(itemId);
    if (tm) {
      nodes.push({ id: tm.id, type: 'threat-model', title: tm.title, status: tm.status, href: tm.href, system: 'security' });
      links.push({ from: tm.id, rel: 'models', to: itemId });
      for (const t of tm.threats) {
        nodes.push({ id: t.id, type: 'threat', title: `${t.stride}: ${t.title}`, href: tm.href, system: 'security' });
        links.push({ from: t.id, rel: 'part-of', to: tm.id });
        nodes.push({ id: t.mitigation.id, type: 'mitigation', title: `${t.mitigation.text} (${t.mitigation.becomes === 'requirement' ? 'a requirement' : 'a quality attribute'})`, href: tm.href, system: 'security' });
        links.push({ from: t.mitigation.id, rel: 'mitigates', to: t.id });
      }
    }
    for (const f of await findings.list({ itemId })) {
      nodes.push({ id: f.id, type: 'finding', title: `${f.title} (${f.stateText})`, status: f.state, href: `${mountPath}/findings/${f.id}`, system: 'security' });
      links.push({ from: f.id, rel: 'found-in', to: itemId });
    }
    return { nodes, links };
  }

  return { checksFor, trace };
}
