// @ts-check
// Phase F15: the webhook ENDPOINT, a small node:http server.
//
//   POST /webhooks/github   → verify → parse → handle → 202 { handled, runId?, reason? }
//   anything else           → 404
//
// It binds to 127.0.0.1 by default: to receive real GitHub webhooks, put a tunnel in
// front of it (e.g. `smee` or `ngrok`) rather than opening a port on your machine.
// Bodies are capped (1 MB) and must be signed; nothing here runs without the secret.
import http from 'node:http';
import { handleComment, parseComment } from '../forge/github/commands.js';
import { handleWebhook, parseWebhook, verifySignature } from '../forge/github/webhooks.js';

const MAX_BODY = 1_000_000;

/**
 * @param {{ store: import('../store/events.js').Store, secret: string, settings: { label: string, allowedUsers: string[], apiUrl?: string },
 *           repoPath?: (owner: string, name: string) => string | undefined, line?: string, onHandled?: (r: object) => void,
 *           reply?: (owner: string, name: string, number: number, text: string, key: string) => Promise<unknown> }} options
 */
export function createWebhookServer({ store, secret, settings, repoPath, line, onHandled, reply }) {
  if (!secret) throw new Error('A webhook secret is needed (github.webhookSecretEnv, default FACTORY_WEBHOOK_SECRET): unsigned webhooks are never accepted.');
  return http.createServer((req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/webhooks/github') return respond(404, { error: 'not found' });
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      if (!verifySignature(secret, raw, /** @type {string} */ (req.headers['x-hub-signature-256']))) return respond(401, { error: 'bad signature' });
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return respond(400, { error: 'not JSON' });
      }
      try {
        const event = String(req.headers['x-github-event']);
        const ctx = { delivery: String(req.headers['x-github-delivery'] ?? crypto.randomUUID()), repoPath, apiUrl: settings.apiUrl, line };
        // Phase F18: "@factory …" comments are commands; everything else is an event.
        const comment = event === 'issue_comment' ? parseComment(payload, settings) : null;
        const result = event === 'issue_comment' ? handleComment(store, comment, ctx) : handleWebhook(store, parseWebhook(event, payload, settings), ctx);
        if (comment && result.reply && reply) {
          // Keyed by delivery: a redelivered webhook never makes a second reply.
          await reply(comment.owner, comment.name, comment.number, result.reply, `reply:${ctx.delivery}`).catch((error) => onHandled?.({ event, handled: false, reason: `reply failed: ${error.message}` }));
        }
        onHandled?.({ event, ...result });
        respond(202, result);
      } catch (error) {
        respond(500, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}
