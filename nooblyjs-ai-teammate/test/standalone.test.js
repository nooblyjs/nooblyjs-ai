// Standalone mode: server.js runs Teammates on its own, with nooblyjs-core's sign-in, the shell's frame and the
// host's double-submit CSRF check, and calls the same register() the NooblyJS AI host calls.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'Standalone-test-1!';

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teammates-standalone-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', DEFAULT_ADMIN_PASSWORD: PASSWORD, AI_PROVIDER: 'mock', LOG_CONSOLE: 'none' },
  stdio: 'ignore',
});
after(async () => {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/login`, { redirect: 'manual' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server.js did not start');
}

const cookieFrom = (res, name) => res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));

test('standalone: core sign-in, the frame, and changes only with the CSRF token', async () => {
  await waitForServer();

  const signedOut = await fetch(`${base}/teammates/team`, { redirect: 'manual' });
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.headers.get('location'), '/services/authservice/views/login.html?returnUrl=%2Fteammates%2Fteam');

  const login = await fetch(`${base}/services/authservice/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@localhost', password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const session = cookieFrom(login, 'nooblyjs.sid');
  assert.ok(session);

  const page = await fetch(`${base}/teammates/team`, { headers: { Cookie: session } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /noobly-rail/);
  const csrf = cookieFrom(page, 'noobly.csrf');
  assert.ok(csrf, 'the frame sets the CSRF cookie');
  const token = csrf.split('=')[1];

  const shell = await (await fetch(`${base}/api/v1/shell`, { headers: { Cookie: session } })).json();
  assert.equal(shell.person.accessRole, 'Owner');
  assert.deepEqual(shell.apps.map((a) => a.mountPath), ['/teammates']);

  const cookies = `${session}; ${csrf}`;
  const patch = (headers) => fetch(`${base}/teammates/api/v1/teammates/ada-quill`, {
    method: 'PATCH', headers: { Cookie: cookies, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ role: 'Research Lead' }),
  });
  assert.equal((await patch({})).status, 403);
  assert.equal((await patch({ 'X-CSRF-Token': token })).status, 200);
  const ada = await (await fetch(`${base}/teammates/api/v1/teammates/ada-quill`, { headers: { Cookie: session } })).json();
  assert.equal(ada.role, 'Research Lead');

  const logout = await fetch(`${base}/logout`, {
    method: 'POST', redirect: 'manual', headers: { Cookie: cookies, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `_csrf=${token}`,
  });
  assert.equal(logout.status, 303);
  assert.equal((await fetch(`${base}/api/v1/shell`, { headers: { Cookie: session } })).status, 401);
});
