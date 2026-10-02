// Phase 20: network access for SOME domains only.
//
// A sandbox without network is simple: bwrap gives the command its own empty
// network. But `npm install` needs registry.npmjs.org. So when `sandbox.network`
// lists domains, the command still gets no network of its own, and reaches the
// outside through this PROXY, which runs in noobly (outside the sandbox) and
// only connects to allowed domains:
//
//   sandboxed command ──HTTP(S)_PROXY──► bridge (inside, 127.0.0.1:3128)
//        ──unix socket──► this proxy (outside) ──► registry.npmjs.org ✓
//                                                 ──► evil.example      ✗ 403
//
// HTTPS stays encrypted end to end: the client sends "CONNECT host:443" and we
// only see the host name, which is all we need to decide.
//
// Honest limit: only programs that use HTTP(S)_PROXY get through at all. That
// fails closed (no proxy support = no network), which is the safe direction.
import http from 'node:http';
import net from 'node:net';
import { domainAllowed } from './policy.js';

/**
 * @param {{ domains: string[], socketPath?: string, connect?: typeof net.connect }} options
 *   socketPath: listen on a unix socket (Linux); otherwise on 127.0.0.1 with a free port (macOS)
 * @returns {Promise<{ socketPath?: string, port?: number, blocked: Set<string>, close(): Promise<void> }>}
 */
export async function startProxy({ domains, socketPath, connect = net.connect }) {
  const blocked = new Set(); // hosts refused since the last check, to explain failures to the model
  const refuse = (host) => {
    blocked.add(host);
    return `noobly sandbox: ${host} is not in sandbox.network (allowed: ${domains.join(', ')}).\n`;
  };

  const server = http.createServer((req, res) => {
    // Plain HTTP through a proxy: the request line has the full URL.
    let url;
    try {
      url = new URL(req.url);
    } catch {
      res.writeHead(400).end('noobly sandbox proxy: expected an absolute URL.\n');
      return;
    }
    if (!domainAllowed(url.hostname, domains)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end(refuse(url.hostname));
      return;
    }
    const upstream = http.request(
      { host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: req.headers, createConnection: (o) => connect(o.port, o.host) },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', (error) => res.headersSent ? res.destroy() : res.writeHead(502).end(`noobly sandbox proxy: ${error.message}\n`));
    req.pipe(upstream);
  });

  // HTTPS: "CONNECT host:443", then we just pass bytes both ways.
  server.on('connect', (req, client, head) => {
    const [host, port = '443'] = req.url.split(/:(?=\d+$)/);
    client.on('error', () => {});
    if (!domainAllowed(host, domains)) {
      client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${refuse(host)}`);
      return;
    }
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', (error) => client.end(`HTTP/1.1 502 Bad Gateway\r\n\r\nnoobly sandbox proxy: ${error.message}\n`));
    client.on('close', () => upstream.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    if (socketPath) server.listen(socketPath, resolve);
    else server.listen(0, '127.0.0.1', resolve);
  });
  server.unref(); // never keep noobly running just for the proxy

  return {
    socketPath,
    port: socketPath ? undefined : server.address().port,
    blocked,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
