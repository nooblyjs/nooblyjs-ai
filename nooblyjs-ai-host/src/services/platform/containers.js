// Containers (product.md §5.15, Platform · Containers): where agents' work runs. The hosting target and container
// runtime are not decided (product.md §12 Q3), so this is the SIMULATED runtime behind the ContainerRuntime shape
// a real adapter (Docker, Kubernetes) will implement:
//
//   pools() · workloads() · overview() · logs(id) · stop(id, { by, reason }) · stopAll({ by, reason }) · usage()
//   register(workload) → unregister()     real work shows itself while it runs
//
// Real NooblyJS work appears here while it runs: a teammate task (Digital Teammates registers it, Stop aborts it) and a
// Software Factory run (Stop cancels it). Pools, base images and the sample workloads come from pools.yaml and
// base-images.yaml, as sample data. Nothing here starts a process.
import { HttpError } from '../../util/errors.js';
import { newId } from '../../util/ids.js';

const POOLS = ['platform', 'pools.yaml'];
const IMAGES = ['platform', 'base-images.yaml'];
const KIND_TEXT = { factory: 'Factory station', teammate: 'Teammate sandbox', preview: 'Preview environment', indexer: 'Knowledge indexer' };
// What a real workload is assumed to use until a runtime reports it.
const SIZE = { factory: { cpu: 2, memoryGb: 4, image: 'node-22:22.11' }, teammate: { cpu: 1, memoryGb: 2, image: 'node-22:22.11' } };
const MINUTE = 60_000;

export function createContainers({ files, clock, events, services, log }) {
  const now = () => Number(clock.now());
  /** Running workloads by id: real ones (registered) and the samples, loaded once from pools.yaml. */
  const running = new Map();
  let samplesLoaded = null;
  /** Sample queues emptied by Stop all (nothing new starts until the queue is worked again). */
  let queuesCleared = false;

  /** Loads the samples once; calls that arrive together wait for the same load. */
  function loadSamples() {
    samplesLoaded ??= readSamples();
    return samplesLoaded;
  }

  async function readSamples() {
    const doc = (await files.yaml(POOLS)) ?? {};
    for (const s of doc.samples ?? []) {
      running.set(s.id, {
        id: s.id, kind: s.pool, title: s.title, repo: s.repo ?? null, image: s.image ?? null, cpu: Number(s.cpu) || 0,
        memoryGb: Number(s.memoryGb) || 0, startedAt: now() - (Number(s.uptimeMin) || 0) * MINUTE, sample: true, preview: s.preview === true,
        lines: [`[sample] ${s.title} started from ${s.image}`, '[sample] simulated workload: no process is running'],
      });
    }
  }

  /** Real work shows itself while it runs. Returns the function that removes it. */
  function register({ kind = 'teammate', title, repo = null, image, teammateId = null, itemId = null, runId = null, system = null, href = null, stop }) {
    const id = newId('wl');
    const size = SIZE[kind] ?? SIZE.teammate;
    const at = now();
    running.set(id, {
      id, kind, title: String(title ?? kind).slice(0, 120), repo, image: image ?? size.image, cpu: size.cpu, memoryGb: size.memoryGb,
      startedAt: at, sample: false, teammateId, itemId, runId, system, href, stop,
      lines: [`${new Date(at).toISOString()} started: ${title}`, ...(itemId ? [`for ${itemId}`] : []), ...(repo ? [`repository ${repo}`] : [])],
    });
    return () => running.delete(id);
  }

  function view(w) {
    const uptimeMin = Math.max(0, Math.floor((now() - w.startedAt) / MINUTE));
    return {
      id: w.id, kind: w.kind, kindText: KIND_TEXT[w.kind] ?? w.kind, title: w.title, repo: w.repo, image: w.image, cpu: w.cpu,
      memoryGb: w.memoryGb, uptimeMin, uptimeText: uptimeMin >= 60 ? `${Math.floor(uptimeMin / 60)} h ${String(uptimeMin % 60).padStart(2, '0')}` : `${uptimeMin} min`,
      sample: w.sample, action: w.preview ? 'open' : 'logs', href: w.href ?? null, itemId: w.itemId ?? null,
    };
  }

  async function workloads() {
    await loadSamples();
    // With Infrastructure hosted, previews are its environments (listed there), so the sample preview steps aside.
    const hasInfra = typeof services.get('infrastructure')?.previews === 'function';
    return [...running.values()].filter((w) => !(hasInfra && w.sample && w.kind === 'preview')).map(view)
      .sort((a, b) => b.uptimeMin - a.uptimeMin || a.title.localeCompare(b.title));
  }

  /** Infrastructure owns previews: its live ones, or null when it isn't hosted (the samples stand in). */
  async function previews() {
    try {
      return (await services.get('infrastructure')?.previews?.()) ?? null;
    } catch {
      return null;
    }
  }

  async function pools() {
    const doc = (await files.yaml(POOLS)) ?? {};
    const list = await workloads();
    const [factory, fromInfra] = await Promise.all([factoryStatus(), previews()]);
    return (doc.pools ?? []).map((p) => {
      const used = p.id === 'preview' && fromInfra ? fromInfra.length : list.filter((w) => w.kind === p.id).length;
      const fromApp = p.id === 'preview' && fromInfra;
      const queued = queuesCleared ? 0 : fromApp ? fromInfra.filter((e) => e.status === 'provisioning').length : (Number(p.queued) || 0) + (p.id === 'factory' ? factory?.queued ?? 0 : 0);
      const full = used >= p.slots;
      return {
        id: p.id, name: p.name, slots: p.slots, used, queued, full, stateText: full ? 'Full' : `${used} of ${p.slots} slots`,
        note: fromApp ? `${p.note ?? ''} · from Infrastructure`.replace(/^ · /, '') : p.note ?? '',
        ...(fromApp ? { href: '/infrastructure/environments' } : {}),
      };
    });
  }

  async function factoryStatus() {
    try {
      return (await services.get('factory')?.status?.()) ?? null;
    } catch {
      return null;
    }
  }

  async function usage() {
    const doc = (await files.yaml(POOLS)) ?? {};
    const list = await workloads();
    const p = await pools();
    const cluster = doc.cluster ?? {};
    return {
      health: 'healthy',
      healthText: 'Cluster healthy (simulated)',
      running: list.length,
      queued: p.reduce((n, x) => n + x.queued, 0),
      failed: 0,
      vcpu: { used: round(list.reduce((n, w) => n + w.cpu, 0)), total: cluster.vcpu ?? 96 },
      memoryGb: { used: round(list.reduce((n, w) => n + w.memoryGb, 0)), total: cluster.memoryGb ?? 256 },
    };
  }

  async function overview() {
    const [u, p, list, imgs, doc] = await Promise.all([usage(), pools(), workloads(), files.yaml(IMAGES), files.yaml(POOLS)]);
    const cluster = doc?.cluster ?? {};
    return {
      simulated: true,
      cluster: { name: cluster.name ?? '[PLACEHOLDER cluster]', region: cluster.region ?? '[PLACEHOLDER region]', healthText: u.healthText },
      tiles: { ...u, compute: { todayUsd: cluster.computeToday ?? 0, capUsd: cluster.computeDailyCap ?? null } },
      pools: p,
      workloads: list,
      images: { registry: imgs?.registry ?? '[PLACEHOLDER image registry]', list: (imgs?.images ?? []).map(imageView) },
    };
  }

  async function logs(id) {
    await loadSamples();
    const w = running.get(id);
    if (!w) throw new HttpError(404, 'workload_not_found', 'That workload is not running.');
    return w.lines;
  }

  async function stopOne(w, { by, reason }) {
    running.delete(w.id);
    if (!w.sample && typeof w.stop === 'function') {
      try {
        await w.stop();
      } catch (err) {
        log?.warn?.(`containers: stopping ${w.id} (${w.title}): ${err.message}`);
      }
    }
    return { ...view(w), stoppedBy: by?.id ?? null, reason: reason ?? null };
  }

  /** Stops one workload: a teammate task is aborted, a Factory run cancelled, a sample removed. */
  async function stop(id, { by, reason } = {}) {
    await loadSamples();
    const w = running.get(id);
    if (!w) throw new HttpError(404, 'workload_not_found', 'That workload is not running (it may have just finished).');
    const stopped = await stopOne(w, { by, reason });
    await events.emit('container.stopped', {
      system: 'platform', workloadId: id, title: stopped.title, kind: stopped.kind, repo: stopped.repo, itemId: stopped.itemId, reason: reason ?? null,
      summary: `stopped ${stopped.kindText.toLowerCase()} "${stopped.title}"`,
    }, { actor: by?.id ?? null });
    return { stopped };
  }

  /** Stops every workload and the Software Factory (no new runs start until it is resumed in the Factory). */
  async function stopAll({ by, reason } = {}) {
    await loadSamples();
    const stopped = [];
    for (const w of [...running.values()]) stopped.push(await stopOne(w, { by, reason }));
    queuesCleared = true;
    const factory = services.get('factory');
    let factoryStopped = false;
    if (factory?.stopAll) {
      try {
        factoryStopped = Boolean((await factory.stopAll({ by: by?.name ?? 'NooblyJS', reason }))?.stopped);
      } catch (err) {
        log?.warn?.(`containers: the Software Factory did not stop: ${err.message}`);
      }
    }
    await events.emit('containers.stopped_all', {
      system: 'platform', count: stopped.length, factoryStopped, reason: reason ?? null,
      summary: `stopped all containers (${stopped.length} running)${factoryStopped ? ' and the Software Factory' : ''}`,
    }, { actor: by?.id ?? null });
    return { stopped, factoryStopped, usage: await usage() };
  }

  return { register, workloads, pools, usage, overview, logs, stop, stopAll };
}

function imageView(i) {
  const c = i.cves ?? {};
  const found = ['critical', 'high', 'medium', 'low'].filter((k) => Number(c[k]) > 0).map((k) => `${c[k]} ${k}`);
  return { image: i.image, repos: i.repos ?? 0, rolled: i.rolled ?? '', cveText: found.length ? found.join(', ') : '0 CVEs', worst: found.length ? found[0].split(' ')[1] : 'none' };
}

const round = (n) => Math.round(n * 10) / 10;
