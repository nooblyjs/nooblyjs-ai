// The drift sweep (product.md §3.11, roadmap I4): every few business hours, each live environment is compared with
// its design and any new drift is recorded (drift.detected). It never repairs anything: a person restores or keeps.
//
// Business time is the host's clock (NooblyJS's dev clock can move it), so the sweep is a check every minute of whether
// enough business time has passed since the last one (sweep.yaml), not a timer of its own length. The first check
// after a fresh start only notes the time.
const FILE = ['sweep.yaml'];
const HOUR = 3_600_000;

export function createSweep({ repos, host, drift, now, log, everyHours = 6 }) {
  let running = null;

  /** Runs the sweep if it is due. Returns { ran: false } or what it checked and found. */
  async function tick() {
    if (running) return running;
    running = (async () => {
      try {
        const at = now();
        const state = (await host.store.readYaml(FILE)) ?? {};
        const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : null;
        if (last === null) {
          await host.store.writeYaml(FILE, { lastRunAt: new Date(at).toISOString(), everyHours });
          return { ran: false, reason: 'first start' };
        }
        if (at - last < everyHours * HOUR) return { ran: false, reason: 'not due' };
        return await sweep(at);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  /** Checks every live environment now, whatever the time. */
  async function sweep(at = now()) {
    const environments = (await repos.environments.list()).filter((env) => env.status === 'live' && env.designId);
    let found = 0;
    for (const env of environments) {
      try {
        found += (await drift.check(env.name, null)).found.length;
      } catch (err) {
        log.warn(`drift sweep: ${env.name}: ${err.message}`);
      }
    }
    await host.store.writeYaml(FILE, { lastRunAt: new Date(at).toISOString(), everyHours, checked: environments.length, found });
    await host.events.emit('drift.sweep_finished', {
      system: 'infrastructure', checked: environments.length, found,
      summary: `checked ${environments.length} environment${environments.length === 1 ? '' : 's'} for drift: ${found ? `${found} new` : 'nothing new'}`,
    }, { actor: null });
    return { ran: true, checked: environments.length, found };
  }

  return { tick, sweep };
}
