// Phase 21: the test runner adapter (root design.md §9). `run(suite, input)` runs one suite in one environment and says
// what passed, what failed and what it measured. Only the mock exists until a test runner is chosen (root stack.md
// §6, Phase 15); any other name is refused at start, never pretended.
import { createMockRunner } from './mock.js';

const RUNNERS = { mock: createMockRunner };

export function createRunner({ name = 'mock' } = {}) {
  const make = RUNNERS[name];
  if (!make) throw new Error(`TEST_RUNNER=${name} is not a test runner here: only "mock" exists until one is approved.`);
  return make();
}
