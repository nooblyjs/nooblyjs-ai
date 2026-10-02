// Send signed webhook deliveries to a running webhook server, as GitHub would.
import crypto from 'node:crypto';

/** @returns {(event: string, payload: object, delivery: string, secret?: string) => Promise<{ status: number, body: any }>} */
export function commandsFor(server, secret) {
  return async (event, payload, delivery, useSecret = secret) => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', useSecret).update(body).digest('hex')}`;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/webhooks/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': delivery, 'x-hub-signature-256': signature },
      body,
    });
    return { status: res.status, body: await res.json() };
  };
}
