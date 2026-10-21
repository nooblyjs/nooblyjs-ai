// The deployer adapter (root design.md §9): `deploy(release, step)` puts a release in production for a share of the
// traffic, `rollback(release, reason)` returns production to what was there. Only the mock exists until a deployment
// tool is chosen (Phase 15); any other OPERATIONS_DEPLOYER is refused at start, never pretended.
import { createMockDeployer } from './mock.js';

const DEPLOYERS = { mock: createMockDeployer };

export function createDeployer({ name = 'mock', host } = {}) {
  const make = DEPLOYERS[name];
  if (!make) throw new Error(`OPERATIONS_DEPLOYER=${name} is not a deployer here: only "mock" exists until one is approved.`);
  return make({ host });
}
