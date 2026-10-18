// @ts-check
// Phase F15: the webhook ENDPOINT, a small node:http server.
//
//   POST /webhooks/github   → verify → parse → handle → 202 { handled, runId?, reason? }
//   anything else           → 404
//
// It binds to 127.0.0.1 by default: to receive real GitHub webhooks, put a tunnel in
// front of it (e.g. `smee` or `ngrok`) rather than opening a port on your machine.
// Bodies are capped (1 MB) and must be signed (src/controllers/webhooks.js).
import http from 'node:http';
import { createWebhookController } from '../controllers/webhooks.js';
import { readRaw } from '../middleware/body.js';

const MAX_BODY = 1_000_000;

/** @param {import('../controllers/webhooks.js').WebhookOptions} options */
export function createWebhookServer(options) {
  const handle = createWebhookController(options);
  return http.createServer(async (req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/webhooks/github') return respond(404, { error: 'not found' });
    let raw;
    try {
      raw = await readRaw(req, { max: MAX_BODY });
    } catch {
      return; // too big: the connection is already dropped
    }
    const { status, body } = await handle({ headers: req.headers, raw });
    respond(status, body);
  });
}
