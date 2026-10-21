// The scanner adapter (root design.md §9): one interface, scan(kind, target, policies) → findings, for secrets, sast,
// sca, licence, iac, image and dast. `mock` is the default and the only one there is: no scanner is approved yet (root
// stack.md §6), so any other name is refused at start rather than pretending. A real adapter runs the tool inside a
// harness sandbox on the repository's base image, never from a route or a service.
import { createMockScanner } from './mock.js';

const ADAPTERS = { mock: createMockScanner };

export function createScanner({ name = 'mock' } = {}) {
  const make = ADAPTERS[name];
  if (!make) throw new Error(`No "${name}" scanner: no real scanner is approved yet (root stack.md §6), so Security runs on the mock scanner. Unset SECURITY_SCANNER.`);
  return make();
}
