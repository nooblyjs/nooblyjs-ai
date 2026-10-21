// The scripted threat model (root product.md §3.5 Design): STRIDE per trust boundary, from an item's container view.
// It is what the security agent answers when no model is configured, and what a model's answer is checked against.
//
// Each node is in a zone: people's devices (an app or console), outside (a person or a system of another team), the
// edge (a gateway), a service, or data (a database or a queue). A relation between two zones crosses a trust boundary,
// and gets the threats that boundary is known for, each with one mitigation that is a requirement or a quality
// attribute. Pure: no I/O.

const ZONE_TEXT = { device: "people's devices", outside: 'outside systems', edge: 'the edge', service: 'services', data: 'data' };

export function zoneOf(node) {
  if (node.kind === 'database' || node.kind === 'queue') return 'data';
  if (node.kind === 'person' || node.status === 'external' || node.kind === 'system') return 'outside';
  const words = `${node.label} ${node.description ?? ''}`;
  if (/gateway|edge|load balancer|\bcdn\b/i.test(words)) return 'edge';
  if (/react|mobile|ios|android|browser/i.test(node.tech ?? '') || /\b(app|console)\b/i.test(node.label)) return 'device';
  return 'service';
}

const holds = (node) => /\bholds?\b/i.test(`${node?.description ?? ''} ${node?.label ?? ''}`);

/**
 * @param {{ itemId: string, containers: object[], relations: object[] }} view   the Product section's design inputs
 * @returns {{ boundaries: object[], threats: object[] }}
 */
export function strideFrom({ itemId, containers = [], relations = [] }) {
  const n = String(itemId).replace(/^[A-Z]+-/, '');
  const byId = new Map(containers.map((c) => [c.id, c]));
  // The hold flow: the services that hold slots, and the gateway in front of them.
  const holding = new Set(containers.filter(holds).map((c) => c.id));
  for (const r of relations) if (holding.has(r.to) && zoneOf(byId.get(r.from) ?? {}) === 'edge') holding.add(r.from);
  const boundaries = [];
  const threats = [];
  const add = (r, stride, title, mitigation) => {
    const i = threats.length + 1;
    threats.push({ id: `THR-${n}-${i}`, stride, title, flow: `${r.fromLabel} → ${r.toLabel}${r.label ? ` (${r.label})` : ''}`, boundary: r.boundary, holdFlow: r.holdFlow, mitigation: { id: `MIT-${n}-${i}`, ...mitigation } });
  };
  for (const rel of relations) {
    const from = byId.get(rel.from);
    const to = byId.get(rel.to);
    if (!from || !to) continue;
    const [a, b] = [zoneOf(from), zoneOf(to)];
    if (a === b) continue;
    const boundary = `B${boundaries.length + 1}`;
    boundaries.push({ id: boundary, from: from.label, to: to.label, crossing: `${ZONE_TEXT[a]} → ${ZONE_TEXT[b]}` });
    const holdFlow = holding.has(from.id) || holding.has(to.id);
    const on = holdFlow ? ' on the slot hold flow' : '';
    const r = { fromLabel: from.label, toLabel: to.label, label: rel.label ?? '', boundary, holdFlow };
    if (a === 'device' || (a === 'outside' && from.kind === 'person')) {
      add(r, 'Spoofing', `Someone uses a stolen or guessed session to act as a ${from.label} user`, { becomes: 'requirement', text: `Every call from the ${from.label} needs a signed-in session; a session ends after 15 minutes idle` });
      add(r, 'Denial of service', `A script floods ${to.label} with ${holdFlow ? 'hold requests and holds every slot' : 'requests'}`, { becomes: 'quality-attribute', attribute: 'Security', text: `${to.label} limits each customer's ${holdFlow ? 'holds' : 'requests'}`, target: holdFlow ? 'At most 5 holds a minute per customer' : 'At most 60 requests a minute per customer' });
    } else if (a === 'edge' && b === 'service') {
      add(r, 'Elevation of privilege', `A caller inside the network skips ${from.label} and calls ${to.label} directly${on}`, { becomes: 'requirement', text: `${to.label} accepts calls only from ${from.label}, over mutual TLS` });
      if (holdFlow) add(r, 'Tampering', `A customer changes or releases another customer's hold${on}`, { becomes: 'requirement', text: `${to.label} checks that a hold belongs to the customer before changing or releasing it` });
    } else if (a === 'outside') {
      add(r, 'Spoofing', `Anything on the network can call ${to.label} as ${from.label}${on}`, { becomes: 'requirement', text: `${from.label} calls ${to.label} with its own certificate (mutual TLS), and ${to.label} refuses other callers` });
    } else if (b === 'data' && to.kind === 'queue') {
      add(r, 'Repudiation', `Nobody can say who caused an event on ${to.label}${on}`, { becomes: 'requirement', text: `Every event on ${to.label} names the hold and the customer or service that caused it` });
    } else if (b === 'data') {
      add(r, 'Information disclosure', `Something other than ${from.label} reads ${to.label}${on}`, { becomes: 'quality-attribute', attribute: 'Security', text: `${to.label} needs authentication and TLS, and has no public address`, target: 'No unauthenticated or plain-text connection' });
      if (!/read only/i.test(`${to.description ?? ''} ${rel.label ?? ''}`)) add(r, 'Tampering', `A request writes into ${to.label} what it should not${on}`, { becomes: 'requirement', text: `${from.label} builds every ${to.label} key or query from checked values, never from the request as it is` });
    } else {
      add(r, 'Tampering', `What ${from.label} sends to ${to.label} is changed on the way`, { becomes: 'requirement', text: `${from.label} and ${to.label} talk over TLS` });
    }
  }
  return { boundaries, threats };
}
