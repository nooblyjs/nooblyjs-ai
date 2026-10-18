// Standalone mode (noobly structure.md §2a, standalone mode): `npm run seed` and `npm start` run the same register() on the real nooblyjs-core, with
// the stand-in host's dev sign-in. Each test runs server.js in its own process on a temp data folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(args, env) {
  const child = spawn(process.execPath, ['server.js', ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited, output: () => output };
}

test('npm run seed -- --reset writes the story into DATA_DIR/product and exits', async () => {
  const dir = await tempDir();
  try {
    const p = run(['--seed', '--reset'], { DATA_DIR: dir, NODE_ENV: 'development' });
    assert.equal(await p.exited, 0, p.output());
    const files = await fs.readdir(path.join(dir, 'product'));
    for (const f of ['seed.yaml', 'specs', 'architecture', 'ux', 'ui', 'flow', 'standards.yaml', 'budget.yaml']) assert.ok(files.includes(f), f);
    assert.match(p.output(), /seeded .*product \(reset\)/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('npm start serves the API with dev sign-in, sends / to /product, and stops on SIGTERM', async () => {
  const dir = await tempDir();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = run([], { DATA_DIR: dir, PORT: String(port), NODE_ENV: 'development' });
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      up = await fetch(`${base}/login`).then((r) => r.ok, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(up, `server.js did not start:\n${p.output()}`);
    assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location'), '/product');
    assert.equal((await fetch(`${base}/product/api/v1/board`)).status, 401);
    const board = await (await fetch(`${base}/product/api/v1/board`, { headers: { 'x-dev-person': 'lerato-m' } })).json();
    assert.deepEqual(board.columns.map((c) => c.count), [4, 3, 2, 2, 2], 'seeded on the first start');
    // A cookie sign-in needs the CSRF token on a change; the header sign-in doesn't.
    const login = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ person: 'stevie' }), redirect: 'manual' });
    const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const refused = await fetch(`${base}/product/api/v1/seed`, { method: 'POST', headers: { cookie: cookies, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error.code, 'csrf');
  } finally {
    p.child.kill('SIGTERM');
    await p.exited;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('server.js refuses to start in production', async () => {
  const p = run([], { NODE_ENV: 'production' });
  assert.equal(await p.exited, 1);
  assert.match(p.output(), /development only/);
});
