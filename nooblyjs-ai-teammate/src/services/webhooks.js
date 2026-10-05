// Outgoing webhooks: a list of endpoints in data/config/webhooks.md, each subscribed to some events.
// Every delivery is a POST of { event, at, data }, signed with HMAC-SHA256 in X-Teammates-Signature.
// Deliveries go through core's queueing service. One that fails with a network error, a timeout, 429 or a 5xx is
// retried after 10 s, 1 min and 5 min with the same body and X-Teammates-Delivery id, so receivers can de-duplicate.
import crypto from 'node:crypto';
import { HttpError, notFound } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { JobQueue } from '../core/job-queue.js';

const FILE = ['config', 'webhooks.md'];
const TIMEOUT_MS = 5000;
export const RETRY_DELAYS_MS = [10000, 60000, 300000];
const retryable = (outcome) => !outcome.ok && (outcome.status === undefined || outcome.status === 429 || outcome.status >= 500);

export const WEBHOOK_EVENTS = {
  'task.completed': 'A teammate finished a task',
  'task.failed': 'A task failed (model error, or a teammate could not take it)',
  'approval.requested': 'A task is waiting for approval (over a threshold)',
  'action.requested': 'A teammate asked to use a tool with side effects',
  'teammate.message': 'A teammate sent a message with the notify tool (after approval)',
  'budget.warning': 'A budget passed the warning share',
  'budget.reached': 'A budget is used up',
  'cap.warning': "A teammate passed the warning share of their monthly cap",
  'cap.reached': "A teammate reached their monthly cap",
};
export const ALERT_EVENTS = ['budget.warning', 'budget.reached', 'cap.warning', 'cap.reached'];

const visible = ({ secret, ...e }) => ({ ...e, hasSecret: Boolean(secret) });

export class WebhookService {
  constructor({ store, repos, fetch = globalThis.fetch, log = console, queue = null, metrics = null, retryDelaysMs = RETRY_DELAYS_MS }) {
    this.store = store;
    this.repos = repos;
    this.fetch = fetch;
    this.log = log;
    this.metrics = metrics;
    this.retryDelaysMs = retryDelaysMs;
    this.jobs = queue
      ? new JobQueue({
        queue, name: 'webhooks', log, retryDelaysMs,
        handler: (job, { attempt }) => this.deliverJob(job, attempt),
        shouldRetry: (result) => Boolean(result?.retrying),
      })
      : null;
  }

  /** Resolves once no delivery is queued or in flight (retries waiting on their delay don't count). */
  idle() {
    return this.jobs?.idle();
  }

  close() {
    this.jobs?.close();
  }

  /** Moves the Phase 5 single alert webhook (settings.alerts.webhookUrl) into the endpoint list. */
  async init() {
    if (await this.store.exists(FILE)) return;
    const settings = await this.repos.config.getSettings();
    const { webhookUrl, webhookSecret, ...alerts } = settings.alerts ?? {};
    const endpoints = webhookUrl
      ? [{ id: newId('whk'), name: 'Alerts', url: webhookUrl, events: ALERT_EVENTS, secret: webhookSecret, enabled: true, createdAt: new Date().toISOString() }]
      : [];
    await this.write(endpoints);
    if (webhookUrl || webhookSecret) await this.repos.config.updateSettings({ alerts });
  }

  async endpoints() {
    return (await this.store.readDoc(FILE))?.data?.endpoints ?? [];
  }

  async write(endpoints) {
    await this.store.writeDoc(FILE, { endpoints }, 'Webhook endpoints. Each receives a signed POST for the events it subscribes to. Edit on Settings → Webhooks.');
  }

  async update(fn) {
    let result;
    await this.store.updateDoc(FILE, (doc) => {
      const endpoints = doc?.data?.endpoints ?? [];
      result = fn(endpoints);
      return { data: { endpoints }, body: doc?.body ?? '' };
    });
    return result;
  }

  async list() {
    return (await this.endpoints()).map(visible);
  }

  validate(input, { partial = false } = {}) {
    const errors = {};
    const out = {};
    if (input.name !== undefined || !partial) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 60) errors.name = 'Use 1 to 60 characters';
      else out.name = name;
    }
    if (input.url !== undefined || !partial) {
      const url = String(input.url ?? '').trim();
      let ok = false;
      try {
        ok = ['http:', 'https:'].includes(new URL(url).protocol) && url.length <= 500;
      } catch { /* invalid */ }
      if (!ok) errors.url = 'Enter an http:// or https:// URL';
      else out.url = url;
    }
    if (input.events !== undefined || !partial) {
      const events = Array.isArray(input.events) ? [...new Set(input.events)] : [];
      if (!events.length) errors.events = 'Choose at least one event';
      else if (events.some((e) => !WEBHOOK_EVENTS[e])) errors.events = 'Unknown event';
      else out.events = events;
    }
    if (input.enabled !== undefined) out.enabled = input.enabled !== false;
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please fix the highlighted fields', errors);
    return out;
  }

  /** Adds an endpoint with a generated signing secret, returned once. */
  async create(input) {
    const fields = this.validate(input);
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    const endpoint = { id: newId('whk'), ...fields, secret, enabled: true, createdAt: new Date().toISOString() };
    await this.update((list) => list.push(endpoint));
    return { endpoint: visible(endpoint), secret };
  }

  async edit(id, input) {
    const patch = this.validate(input, { partial: true });
    const out = await this.update((list) => {
      const e = list.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
      return e ? visible(e) : null;
    });
    if (!out) throw notFound('Webhook');
    return out;
  }

  async remove(id) {
    const removed = await this.update((list) => {
      const i = list.findIndex((x) => x.id === id);
      return i === -1 ? null : list.splice(i, 1)[0];
    });
    if (!removed) throw notFound('Webhook');
    return visible(removed);
  }

  /**
   * Sends `event` to every enabled endpoint subscribed to it. Resolves with each endpoint's first attempt; failed
   * deliveries are retried in the background. Never throws.
   */
  async emit(event, data) {
    const targets = (await this.endpoints()).filter((e) => e.enabled !== false && e.events?.includes(event));
    const at = new Date().toISOString();
    return Promise.all(targets.map((e) => {
      const job = { endpointId: e.id, event, at, data, deliveryId: newId('dlv') };
      return this.jobs ? this.jobs.push(job).catch((err) => ({ event, at, ok: false, error: err.message })) : this.deliverJob(job, 1);
    }));
  }

  /** Sent straight away (not queued, never retried): the Settings page shows the result. */
  async test(id) {
    const e = (await this.endpoints()).find((x) => x.id === id);
    if (!e) throw notFound('Webhook');
    const outcome = await this.deliver(e, { event: 'webhook.test', at: new Date().toISOString(), data: { message: 'Test delivery from Teammates. Webhooks are working.' }, deliveryId: newId('dlv') });
    return this.recordDelivery(e, { event: 'webhook.test', at: new Date().toISOString(), ...outcome });
  }

  /** One attempt of a queued delivery. The endpoint is looked up again, as it may have changed before a retry. */
  async deliverJob(job, attempt) {
    const endpoint = (await this.endpoints()).find((x) => x.id === job.endpointId);
    if (!endpoint || endpoint.enabled === false) return { event: job.event, ok: false, skipped: true };
    const outcome = await this.deliver(endpoint, job, attempt);
    const delay = retryable(outcome) ? this.retryDelaysMs[attempt - 1] : undefined;
    const last = { event: job.event, at: new Date().toISOString(), ...outcome, ...(attempt > 1 ? { attempt } : {}) };
    if (delay !== undefined) {
      last.nextRetryAt = new Date(Date.now() + delay).toISOString();
      this.metrics?.record('webhook.retry_scheduled');
    }
    await this.recordDelivery(endpoint, last);
    return { ...last, retrying: delay !== undefined };
  }

  async deliver(endpoint, { event, at, data, deliveryId }, attempt = 1) {
    const body = JSON.stringify({ event, at, data });
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Teammates-Webhook/1', 'X-Teammates-Event': event, 'X-Teammates-Delivery': deliveryId };
    if (attempt > 1) headers['X-Teammates-Attempt'] = String(attempt);
    if (endpoint.secret) headers['X-Teammates-Signature'] = `sha256=${crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex')}`;
    const started = Date.now();
    let outcome;
    try {
      const res = await this.fetch(endpoint.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
      outcome = { ok: res.ok, status: res.status };
    } catch (err) {
      outcome = { ok: false, error: err.name === 'TimeoutError' ? 'Timed out after 5 seconds' : err.message };
    }
    this.metrics?.record(outcome.ok ? 'webhook.delivered' : 'webhook.failed');
    this.metrics?.record('webhook.duration_ms', Date.now() - started);
    if (!outcome.ok) this.log.warn?.(`[webhook] ${event} to ${endpoint.name} failed (attempt ${attempt}): ${outcome.error ?? `HTTP ${outcome.status}`}`);
    return outcome;
  }

  async recordDelivery(endpoint, lastDelivery) {
    await this.update((list) => {
      const e = list.find((x) => x.id === endpoint.id);
      if (e) e.lastDelivery = lastDelivery;
    }).catch(() => {});
    return lastDelivery;
  }

  /** Queue figures for the System page. */
  async queueInfo() {
    if (!this.jobs) return null;
    return { queue: this.jobs.name, waiting: await this.jobs.size(), inFlight: this.jobs.running, retrying: this.jobs.retrying };
  }
}
