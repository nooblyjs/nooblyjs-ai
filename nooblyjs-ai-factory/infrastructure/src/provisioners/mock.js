// The mock provisioner (stack.md §4): the default, and the only one until a cloud and an infrastructure-as-code
// tool are chosen (roadmap I9). It touches nothing outside this process. Plans and estimates are computed from the
// design's resources; an apply is a wait with progress; drift is whatever the environment file records as
// `observed` that differs from the design.

const round = (n) => Math.round(n * 100) / 100;

export function createMockProvisioner({ stepMs = 1200 } = {}) {
  return {
    name: 'mock',

    /** What applying this design version would do: resources to add, change and destroy. */
    async plan(design) {
      const resources = design.resources ?? [];
      return {
        add: resources.filter((r) => r.state === 'new').reduce((n, r) => n + (r.creates ?? 1), 0),
        change: resources.filter((r) => r.state === 'changed').length,
        destroy: resources.filter((r) => r.state === 'removed').length,
      };
    },

    /** The estimated cost per day of this design in one kind of environment, in USD. */
    async estimateCost(design, kind) {
      return round((design.resources ?? []).reduce((sum, r) => sum + (r.costPerDay?.[kind] ?? 0), 0));
    },

    /** Applies a plan: yields the progress (0–100) as it goes, starting from where the run was. */
    async* apply({ from = 0, signal } = {}) {
      for (let progress = Math.min(90, Math.floor(from / 10) * 10) + 10; progress <= 100; progress += 10) {
        if (stepMs > 0) await new Promise((resolve) => setTimeout(resolve, stepMs));
        if (signal?.aborted) return;
        yield progress;
      }
    },

    /** Settings of the environment that no longer match the design. */
    async detectDrift(environment, design) {
      const found = [];
      for (const [key, settings] of Object.entries(environment.observed ?? {})) {
        const resource = (design?.resources ?? []).find((r) => r.key === key);
        for (const [setting, actual] of Object.entries(settings ?? {})) {
          const expected = resource?.settings?.[setting];
          if (expected !== undefined && String(expected) !== String(actual)) {
            found.push({ resource: key, resourceName: resource.name.split(' · ')[0], setting, expected: String(expected), actual: String(actual) });
          }
        }
      }
      return found;
    },
  };
}
