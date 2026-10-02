// Phase 20: runs INSIDE the sandbox (Linux), as part of the executor (executor.js).
//
// The sandbox has no network, only its own loopback. The bridge listens there
// (127.0.0.1:<port>) and passes each connection on to the proxy's unix socket,
// which the sandbox can reach because it is a FILE (in the sandbox's /tmp).
// See proxy.js.
import net from 'node:net';

export function startBridge(socketPath, port) {
  return net
    .createServer((client) => {
      const upstream = net.connect(socketPath);
      client.pipe(upstream);
      upstream.pipe(client);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    })
    .listen(port, '127.0.0.1');
}
