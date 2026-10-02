// Phase 22: the EXECUTOR. One long-lived process inside the session's sandbox (Linux).
//
// Phase 20 started a new bubblewrap sandbox for every command. That gave every
// command its own private network, so a dev server started in the background
// (Phase 22) was unreachable from the next command's `curl`. Now each session
// has ONE sandbox, and this small program inside it runs the commands:
//
//   noobly ──unix socket (the sandbox's /tmp/executor.sock)──► executor ──► bash -c "…"
//
// All commands share the sandbox's network (still no internet), its /tmp and its
// processes, like terminals in the same container.
//
// The protocol: one connection per command, one JSON object per line.
//   noobly → executor   {"t":"run","script":"…","cwd":"…","env":{…}}   then maybe {"t":"kill","signal":"SIGTERM"}
//   executor → noobly   {"t":"out","d":"…"} {"t":"err","d":"…"} {"t":"cwd","d":"…"} … {"t":"exit","code":0}
// Closing the connection kills the command: noobly can never leave one behind.
//
//   usage: node executor.js <socket> [<proxy socket> <bridge port>]
import { spawn } from 'node:child_process';
import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { startBridge } from './bridge.js';

const [socketPath, proxySocket, bridgePort] = process.argv.slice(2);
// The bridge must listen BEFORE commands can arrive: noobly sends the first one as soon as the socket exists.
if (proxySocket) await new Promise((resolve) => startBridge(proxySocket, Number(bridgePort)).once('listening', resolve));

net
  .createServer((conn) => {
    let buffer = '';
    let child = null;
    const send = (message) => !conn.destroyed && conn.write(JSON.stringify(message) + '\n');
    const kill = (signal) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      try {
        process.kill(-child.pid, signal); // its whole process group, like runCommand outside
      } catch {}
    };

    conn.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
        const message = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (message.t === 'run') run(message);
        if (message.t === 'kill') kill(message.signal);
      }
    });
    conn.on('close', () => kill('SIGKILL'));
    conn.on('error', () => {});

    function run({ script, cwd, env }) {
      child = spawn('bash', ['-c', script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], detached: true });
      for (const [type, stream] of [['out', child.stdout], ['err', child.stderr], ['cwd', child.stdio[3]]]) {
        const decoder = new StringDecoder('utf8'); // never split a character between two messages
        stream.on('data', (data) => send({ t: type, d: decoder.write(data) }));
        stream.on('end', () => {
          const rest = decoder.end();
          if (rest) send({ t: type, d: rest });
        });
      }
      child.on('error', (error) => send({ t: 'err', d: `Failed to start bash: ${error.message}\n` }));
      child.on('close', (code, signal) => {
        send({ t: 'exit', code, signal });
        conn.end();
      });
    }
  })
  .listen(socketPath);
