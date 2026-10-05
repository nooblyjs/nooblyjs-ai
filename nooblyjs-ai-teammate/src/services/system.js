// What the nooblyjs-core services are doing, for Admin → System: document cache, webhook queue, the schedule
// check and metrics. Each service also has its own dashboard under /services/.
import { CHECK_TASK } from './scheduler.js';

export class SystemService {
  constructor({ core, store, webhooks, scheduler, invocation, providers }) {
    this.core = core;
    this.store = store;
    this.webhooks = webhooks;
    this.scheduler = scheduler;
    this.invocation = invocation;
    this.providers = providers;
  }

  async scheduleCheck() {
    const s = this.scheduler;
    if (!s.intervalMs) return { mode: 'off' };
    if (!s.scheduling) return { mode: 'timer', intervalSeconds: Math.round(s.intervalMs / 1000) };
    const task = this.core.hasScheduling() ? await this.core.scheduling().getSchedule(CHECK_TASK) : null;
    return {
      mode: 'core', task: CHECK_TASK, intervalSeconds: Math.round(s.intervalMs / 1000), registered: Boolean(task),
      enabled: task?.enabled ?? false, lastStartedAt: task?.lastStartedAt ?? null, lastFinishedAt: task?.lastFinishedAt ?? null, nextRun: task?.nextRun ?? null,
    };
  }

  async status() {
    return {
      instance: this.core.instanceName,
      provider: this.providers.describe(),
      dashboards: '/services/',
      logs: { dir: this.core.logDir },
      cache: this.store.cacheInfo(),
      webhookQueue: await this.webhooks.queueInfo(),
      scheduleCheck: await this.scheduleCheck(),
      backgroundTasks: this.invocation.background.size,
      metrics: this.core.metrics.summary(),
    };
  }
}
