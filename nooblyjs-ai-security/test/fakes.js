// Stand-ins for the apps Security talks to, recording what it asks: the Product section's container view of PRD-031
// (as the seed draws it), Digital Teammates (Rook Vale off shift, Rhea Voss on), the lifecycle engine's app approvals,
// and the Software Factory's startWork.
export const PRD031 = {
  itemId: 'PRD-031', title: 'Same-day delivery slots', version: 2,
  containers: [
    { id: 'customerApp', kind: 'container', label: 'Customer app', tech: 'React', description: 'Web + mobile', status: 'existing' },
    { id: 'console', kind: 'container', label: 'Store manager console', tech: 'React', description: 'Web', status: 'existing' },
    { id: 'gateway', kind: 'container', label: 'API gateway', tech: '', description: 'Auth · rate limits', status: 'existing' },
    { id: 'slotApi', kind: 'container', label: 'Slot API', tech: 'Node 22', description: 'holds, release, capacity', status: 'new' },
    { id: 'slotCache', kind: 'database', label: 'Slot cache', tech: 'Redis', description: '30 s TTL', status: 'new' },
    { id: 'eventBus', kind: 'queue', label: 'Event bus', tech: 'Kafka', description: 'slot.released', status: 'existing' },
    { id: 'inventory', kind: 'database', label: 'Store inventory', tech: 'Postgres', description: 'read only', status: 'existing' },
    { id: 'planner', kind: 'system', label: 'Delivery planner', tech: '', description: 'Java', status: 'external' },
  ],
  relations: [
    { from: 'customerApp', to: 'gateway', label: 'HTTPS · JSON' }, { from: 'console', to: 'gateway', label: 'HTTPS · JSON' },
    { from: 'gateway', to: 'slotApi', label: 'gRPC' }, { from: 'slotApi', to: 'slotCache', label: 'Redis protocol' },
    { from: 'slotApi', to: 'eventBus', label: 'publishes slot.released' }, { from: 'slotApi', to: 'inventory', label: 'SQL · read only' },
    { from: 'planner', to: 'slotApi', label: 'gRPC' },
  ],
};

export function fakes() {
  const calls = [];
  const rec = (name, answer = { ok: true }) => async (input) => { calls.push({ name, input }); return typeof answer === 'function' ? answer(input) : answer; };
  let runs = 0;
  return {
    calls,
    services: {
      product: { designInputs: async (id) => (id === 'PRD-031' ? PRD031 : null) },
      teammates: {
        roster: async () => [{ id: 'rook-vale', name: 'Rook Vale' }, { id: 'rhea-voss', name: 'Rhea Voss' }],
        availability: async (slug) => (slug === 'rook-vale' ? { ok: false, code: 'teammate_off_shift', message: 'Rook Vale is off shift' } : { ok: true }),
        runTask: async (req) => { calls.push({ name: 'teammates.runTask', input: req }); return { ...(await req.scripted()), scripted: true }; },
      },
      workflows: {
        requestAppApproval: rec('workflows.requestAppApproval', { approvalId: 'apr_tm' }),
        closeAppApproval: rec('workflows.closeAppApproval', { id: 'apr_tm' }),
        items: async () => [{ id: 'PRD-031', title: 'Same-day delivery slots', stage: 'design', status: 'active', type: 'spec' }, { id: 'PRD-027', title: 'Rewards', stage: 'build', status: 'active', type: 'spec' }],
      },
      factory: { startWork: rec('factory.startWork', () => ({ runId: `run_fix${++runs}` })) },
    },
  };
}
