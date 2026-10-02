// Outgoing webhooks: a list of endpoints in data/config/webhooks.md, each subscribed to some events.
// Every delivery is a POST of { event, at, data }, signed with HMAC-SHA256 in X-Teammates-Signature.
import crypto from 'node:crypto';
import { HttpError, notFound } from '../util/errors.js';
import { newId } from '../util/ids.js';

const FILE = ['config', 'webhooks.md'];
const TIMEOUT_MS = 5000;

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
  constructor({ store, repos, fetch = globalThis.fetch, log = console }) {
    this.store = store;
    this.repos = repos;
    this.fetch = fetch;
    this.log = log;
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

  /** Sends `event` to every enabled endpoint subscribed to it. Never throws. */
  async emit(event, data) {
    const targets = (await this.endpoints()).filter((e) => e.enabled !== false && e.events?.includes(event));
    return Promise.all(targets.map((e) => this.deliver(e, event, data)));
  }

  async test(id) {
    const e = (await this.endpoints()).find((x) => x.id === id);
    if (!e) throw notFound('Webhook');
    return this.deliver(e, 'webhook.test', { message: 'Test delivery from Teammates. Webhooks are working.' });
  }

  async deliver(endpoint, event, data) {
    const body = JSON.stringify({ event, at: new Date().toISOString(), data });
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Teammates-Webhook/1', 'X-Teammates-Event': event };
    if (endpoint.secret) headers['X-Teammates-Signature'] = `sha256=${crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex')}`;
    let outcome;
    try {
      const res = await this.fetch(endpoint.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
      outcome = { ok: res.ok, status: res.status };
    } catch (err) {
      outcome = { ok: false, error: err.name === 'TimeoutError' ? 'Timed out after 5 seconds' : err.message };
    }
    if (!outcome.ok) this.log.warn?.(`[webhook] ${event} to ${endpoint.name} failed: ${outcome.error ?? `HTTP ${outcome.status}`}`);
    const lastDelivery = { event, at: new Date().toISOString(), ...outcome };
    await this.update((list) => {
      const e = list.find((x) => x.id === endpoint.id);
      if (e) e.lastDelivery = lastDelivery;
    }).catch(() => {});
    return lastDelivery;
  }
}
