// Picks the provisioner adapter (stack.md §4). Services call this interface and never a cloud or a tool directly:
//   plan(design, kind) · estimateCost(design, kind) · apply({ from, signal }) · detectDrift(environment, design)
import { createMockProvisioner } from './mock.js';

export function createProvisioner({ name = 'mock', stepMs } = {}) {
  if (name === 'mock') return createMockProvisioner({ stepMs });
  throw new Error(`No provisioner called "${name}". Only "mock" exists until a cloud and a tool are chosen (roadmap I9).`);
}
