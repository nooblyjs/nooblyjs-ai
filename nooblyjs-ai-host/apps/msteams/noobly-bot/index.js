// The NooblyJS Teams app's local server (NooblyJS Phase 12). It is not a bot of its own: the NooblyJS bot runs inside NooblyJS, at
// POST /api/teams/messages, where Microsoft's token is checked and every flow lives (noobly/src/teams/).
//
// The Microsoft 365 Agents Toolkit expects a server on port 3978 (its dev tunnel, F5 in Teams, the Agents
// Playground). This is that server: it passes each activity, with its Authorization header untouched, to NooblyJS and
// hands NooblyJS's answer back. Nothing is read, changed or kept here.
//
//   NOOBLY_BOT_URL   where NooblyJS's endpoint is (default https://localhost:11001/api/teams/messages)
//   PORT           where this listens (default 3978)
//
// NooblyJS in development runs on https with its own certificate: for a localhost address only, that certificate is
// accepted without a signature check. Any other address must have a valid certificate.
'use strict';

const http = require('node:http');
const https = require('node:https');

const PORT = Number(process.env.PORT || process.env.port || 3978);
const TARGET = new URL(process.env.NOOBLY_BOT_URL || 'https://localhost:11001/api/teams/messages');
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(TARGET.hostname);
const MAX_BYTES = 1_000_000;

function forward(body, headers) {
  return new Promise((resolve, reject) => {
    const client = TARGET.protocol === 'https:' ? https : http;
    const req = client.request(TARGET, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...(headers.authorization ? { authorization: headers.authorization } : {}) },
      ...(TARGET.protocol === 'https:' && LOCAL ? { rejectUnauthorized: false, servername: 'localhost' } : {}),
      timeout: 15_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('NooblyJS did not answer within 15 seconds')));
    req.on('error', reject);
    req.end(body);
  });
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(`NooblyJS Teams app: activities on POST /api/messages go to ${TARGET.href}\n`);
  }
  if (req.method !== 'POST' || path !== '/api/messages') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Activities go to POST /api/messages.' }));
  }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BYTES) req.destroy();
    else chunks.push(c);
  });
  req.on('end', async () => {
    try {
      const answer = await forward(Buffer.concat(chunks), req.headers);
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(answer.body.length ? answer.body : '{}');
      if (answer.status >= 400) console.warn(`NooblyJS answered ${answer.status}: ${answer.body.toString('utf8').slice(0, 300)}`);
    } catch (err) {
      console.error(`Could not reach NooblyJS at ${TARGET.href}: ${err.message}. Is NooblyJS running (npm start in noobly)?`);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `NooblyJS is not reachable at ${TARGET.href}.` }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`NooblyJS Teams app listening on port ${PORT}: activities go to ${TARGET.href}`);
});
