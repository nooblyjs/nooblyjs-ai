// @ts-check
// Phase F23: `factory worker`
//
//   factory worker --server http://host:8790 --enroll <token> [--name box-2]   register, then run steps until Ctrl+C
//   factory worker --server … --token <worker token>                           already registered
//   factory worker list | revoke <workerId>                                    (on the control plane)
//
// The worker needs: git, node, this package (for `noobly`), and the model provider's key in
// ITS environment (steps name a provider; the key never travels over the wire).
import os from 'node:os';
import { parseArgs } from 'node:util';
import { createWorker } from '../remote/worker.js';
import { revokeWorker, workersFrom } from '../server/workers-api.js';
import { openStore } from '../store/events.js';

/** @param {string[]} argv */
export async function workerCommand(argv) {
  if (argv[0] === 'list' || argv[0] === 'revoke') {
    const store = openStore();
    try {
      if (argv[0] === 'revoke') {
        if (!argv[1]) throw new Error('Usage: factory worker revoke <workerId>');
        revokeWorker(store, argv[1]);
        console.log(`Revoked ${argv[1]}: its token no longer works.`);
        return 0;
      }
      const workers = workersFrom(store);
      console.log(workers.length ? workers.map((w) => `${w.id}  ${w.name.padEnd(20)} ${w.revoked ? 'REVOKED' : 'active'}  since ${w.registeredAt.slice(0, 16)}`).join('\n') : 'No workers have registered.');
      return 0;
    } finally {
      store.close();
    }
  }
  const { values } = parseArgs({ args: argv, options: { server: { type: 'string' }, enroll: { type: 'string' }, token: { type: 'string' }, name: { type: 'string' } } });
  if (!values.server || (!values.enroll && !values.token)) throw new Error('Usage: factory worker --server <url> (--enroll <token> | --token <worker token>) [--name <name>]');
  const name = values.name ?? os.hostname();
  let token = values.token;
  if (!token) {
    const res = await fetch(`${values.server.replace(/\/+$/, '')}/worker/register`, { method: 'POST', headers: { authorization: `Bearer ${values.enroll}`, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (!res.ok) throw new Error(`Registering failed: ${data.error ?? res.status}`);
    token = data.token;
    console.log(`Registered as ${data.workerId}. (Next time: --token ${token})`);
  }
  const say = (l) => console.log(`${new Date().toISOString().slice(11, 19)} ${l}`);
  const worker = createWorker({ server: values.server, token: /** @type {string} */ (token), name, log: say });
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  say(`worker ${name}: waiting for steps from ${values.server} (Ctrl+C to stop)`);
  await worker.loop(stop.signal);
  return 0;
}
