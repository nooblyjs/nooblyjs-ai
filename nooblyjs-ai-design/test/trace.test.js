// NooblyJS Phase 16f: the Design section's part of the trace, from an item's design: each business requirement and the
// goal of the spec it quotes (GOAL-031-1), each feature, each story with the feature it builds and the requirements it
// serves, each story's acceptance criteria (AC-031-1-1) and the interfaces. A story's trace is its item's design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesignTrace } from '../src/services/trace.js';

const DESIGN = {
  requirements: [
    { id: 'BR-031-01', text: 'Slots open at 12:00 go from 18% to 45%.', status: 'accepted', source: { section: 'Goals', quote: 'Same-day slots still open at 12:00' } },
    { id: 'BR-031-04', text: 'A customer can see capacity.', status: 'proposed', source: { section: 'User stories', quote: 'As a customer…' } },
  ],
  features: [{ id: 'FEAT-031-1', title: 'See capacity' }],
  interfaces: [{ id: 'IF-031-01', name: 'Customer app → API gateway', from: 'Customer app', to: 'API gateway' }, { id: 'IF-031-02', name: 'Slots', from: 'a', to: '' }],
  stories: [{ id: 'STORY-031-1', title: 'See capacity', feature: 'FEAT-031-1', requirements: ['BR-031-01', 'BR-031-04'], criteria: ['Given a, when b, then c.', 'Given d, when e, then f.'] }],
};
const items = { 'PRD-031': { id: 'PRD-031', type: 'spec' }, 'STORY-031-1': { id: 'STORY-031-1', type: 'story', parentId: 'PRD-031' } };
const host = {
  service: (name) => ({
    workflows: { item: async ({ itemId }) => items[itemId] ?? null },
    product: { designInputs: async () => ({ spec: { goals: [{ measure: 'Basket abandonment' }, { measure: 'Same-day slots still open at 12:00' }] } }) },
  })[name],
};
const repo = { get: async (id) => (id === 'PRD-031' ? DESIGN : null) };

test('requirements to the goals they quote, stories to their feature and requirements, criteria to their story', async () => {
  const { trace } = createDesignTrace({ repo, host });
  const t = await trace('PRD-031');
  const links = t.links.map((l) => `${l.from} ${l.rel} ${l.to}`);
  for (const l of ['BR-031-01 derives-from GOAL-031-2', 'BR-031-04 derives-from PRD-031', 'FEAT-031-1 feature-of PRD-031', 'STORY-031-1 builds FEAT-031-1', 'STORY-031-1 serves BR-031-01', 'STORY-031-1 serves BR-031-04', 'AC-031-1-1 criterion-of STORY-031-1', 'AC-031-1-2 criterion-of STORY-031-1', 'IF-031-01 interface-of PRD-031']) assert.ok(links.includes(l), l);
  assert.deepEqual(t.nodes.filter((n) => n.type === 'interface').map((n) => n.title), ['Customer app → API gateway', 'Slots: a → ?']);
  assert.deepEqual(await trace('STORY-031-1'), t, 'a story\'s trace is its item\'s design');
  assert.deepEqual(await trace('PRD-999'), { nodes: [], links: [] });
});
