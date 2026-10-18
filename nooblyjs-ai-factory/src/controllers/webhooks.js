// @ts-check
// Phase F15: handling one GitHub WEBHOOK DELIVERY: verify → parse → handle.
// Phase F18: "@factory …" comments are commands; everything else is an event.
// Nothing here runs without the secret: an unsigned or wrongly signed body is a 401.
import { handleComment, parseComment } from '../services/forge/github/commands.js';
import { handleWebhook, parseWebhook, verifySignature } from '../services/forge/github/webhooks.js';

/**
 * @typedef {{ store: import('../models/store/events.js').Store, secret: string, settings: { label: string, allowedUsers: string[], apiUrl?: string },
 *           repoPath?: (owner: string, name: string) => string | undefined, line?: string, onHandled?: (r: object) => void,
 *           reply?: (owner: string, name: string, number: number, text: string, key: string) => Promise<unknown> }} WebhookOptions
 */

/**
 * @param {WebhookOptions} options
 * @returns {(delivery: { headers: import('node:http').IncomingHttpHeaders, raw: Buffer }) => Promise<{ status: number, body: object }>}
 */
export function createWebhookController({ store, secret, settings, repoPath, line, onHandled, reply }) {
  if (!secret) throw new Error('A webhook secret is needed (github.webhookSecretEnv, default FACTORY_WEBHOOK_SECRET): unsigned webhooks are never accepted.');
  return async ({ headers, raw }) => {
    if (!verifySignature(secret, raw, /** @type {string} */ (headers['x-hub-signature-256']))) return { status: 401, body: { error: 'bad signature' } };
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return { status: 400, body: { error: 'not JSON' } };
    }
    try {
      const event = String(headers['x-github-event']);
      const ctx = { delivery: String(headers['x-github-delivery'] ?? crypto.randomUUID()), repoPath, apiUrl: settings.apiUrl, line };
      const comment = event === 'issue_comment' ? parseComment(payload, settings) : null;
      const result = event === 'issue_comment' ? handleComment(store, comment, ctx) : handleWebhook(store, parseWebhook(event, payload, settings), ctx);
      if (comment && result.reply && reply) {
        // Keyed by delivery: a redelivered webhook never makes a second reply.
        await reply(comment.owner, comment.name, comment.number, result.reply, `reply:${ctx.delivery}`).catch((error) => onHandled?.({ event, handled: false, reason: `reply failed: ${error.message}` }));
      }
      onHandled?.({ event, ...result });
      return { status: 202, body: result };
    } catch (error) {
      return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
    }
  };
}
