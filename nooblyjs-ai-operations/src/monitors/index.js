// The monitoring adapter (root design.md §9): what production says about an SLO (its error budget burned) and about a
// goal's measure (its value today). Only the mock exists until a monitoring platform is chosen ([PLACEHOLDER], Phase
// 15); any other OPERATIONS_MONITOR is refused at start, never pretended.
import { createMockMonitor } from './mock.js';

const MONITORS = { mock: createMockMonitor };

export function createMonitor({ name = 'mock', store } = {}) {
  const make = MONITORS[name];
  if (!make) throw new Error(`OPERATIONS_MONITOR=${name} is not a monitoring platform here: only "mock" exists until one is chosen.`);
  return make({ store });
}
