// The For you service on its own, with the services it reads stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForYou } from '../../src/services/for-you.js';

const forYou = ({ roster = [] } = {}) => createForYou({
  services: { get: (name) => (name === 'workflows' ? { snapshot: async () => ({ items: [], approvals: [], stages: [], at: '2026-10-16T10:00:00.000Z' }) } : null) },
  profiles: { get: async () => ({ workRole: 'product-manager', teams: [], onboarding: { completed: true } }), firstWeek: async () => null },
  workRoles: { get: async () => ({ key: 'product-manager', name: 'Product manager', layout: 'product-manager', home: '/', agent: 'ada-quill', agents: 'Ada Quill · drafts specs' }) },
  teams: { list: async () => [] },
  agents: { roster: async () => roster },
});

test('BUG-005: a Product manager whose role has a teammate, with nobody hired, is asked to hire one', async () => {
  const home = await forYou().build({ id: 'naledi-k', name: 'Naledi K.' });
  assert.equal(home.layout, 'product-manager');
  assert.equal(home.panels.agent.title, 'No agent teammate is hired yet');
  assert.deepEqual(home.panels.agent.action, { label: 'Hire a teammate', href: '/teammates/hire' });
});

test('a Product manager with a hired teammate sees that teammate', async () => {
  const home = await forYou({ roster: [{ id: 'stevieb', name: 'StevieB' }] }).build({ id: 'naledi-k', name: 'Naledi K.' });
  assert.equal(home.panels.agent.name, 'StevieB');
  assert.equal(home.panels.agent.title, 'StevieB is available');
});
