// NooblyJS as a desktop app (npm run electron). Electron's main process: it starts NooblyJS the way `npm start` does, as a
// child process with the repo's .env, waits until it answers, and opens it in a window. Closing the window stops
// NooblyJS. When NooblyJS is already running on its port (npm start in another terminal), the window opens that one and
// leaves it running.
//
// NooblyJS itself is not changed and not bundled: this is a window around the same server, on the same address (PORT,
// HTTPS_ENABLED), with the same data folder and the same sign-in, so an Entra redirect URI registered for
// https://localhost:11001 works here too. It runs under the Node on your PATH, not Electron's.
//
//   NOOBLY_URL=https://noobly.example     open an NooblyJS that runs somewhere else instead of starting one
//   NOOBLY_NODE=C:\path\to\node.exe     the Node to run NooblyJS with (default: `node` on the PATH)
//   --smoke                           start, load the first page, print its title and quit (npm run test:electron)
//
// CommonJS on purpose (electron/package.json): Electron loads its main script before any ESM loader is set up.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { parseEnv } = require('node:util');

const ROOT = path.join(__dirname, '..', '..'); // noobly/, from noobly/apps/electron/
const SMOKE = process.argv.includes('--smoke');
const START_TIMEOUT_MS = 90_000;

let server = null; // the NooblyJS child process, when this app started it
let win = null;
let quitting = false;

// Certificates this window accepts although no authority signed them: the development certificate of the NooblyJS on
// this machine (HTTPS_CERT_PATH), and nothing else.
const trustedLocalOrigins = new Set();

/** Where NooblyJS listens on this machine, read the way NooblyJS reads it: the environment first, then .env. */
function localAddress() {
  let file = {};
  try {
    file = parseEnv(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'));
  } catch { /* no .env: the defaults */ }
  const setting = (name) => process.env[name] ?? file[name];
  const protocol = setting('HTTPS_ENABLED') === 'true' ? 'https' : 'http';
  // "localhost", not 127.0.0.1: it is the name sign-in redirect URIs and the development certificate are made for.
  return `${protocol}://localhost:${setting('PORT') || 11001}`;
}

/** True when an NooblyJS answers /healthz at this address. */
function isUp(base) {
  return new Promise((resolve) => {
    const url = new URL('/healthz', base);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    const options = { timeout: 2000, ...(local ? { host: '127.0.0.1', servername: 'localhost', rejectUnauthorized: false } : {}) };
    const req = (url.protocol === 'https:' ? https : http).get(url, options, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
  });
}

/** Resolves when NooblyJS answers /healthz; rejects when it exits first or takes too long. */
function waitUntilUp(base, child) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => { if (!done) { done = true; fn(value); } };
    child?.once('exit', (code) => finish(reject, new Error(`NooblyJS stopped while starting (exit code ${code}). Its output is in the terminal.`)));
    const ask = async () => {
      if (done) return;
      if (await isUp(base)) return finish(resolve);
      if (Date.now() > deadline) return finish(reject, new Error(`NooblyJS did not answer at ${base} within ${START_TIMEOUT_MS / 1000} seconds.`));
      setTimeout(ask, 300);
    };
    ask();
  });
}

/** The address of the NooblyJS on this machine: the one already running there, or one this app starts (npm start). */
async function startNoobly() {
  const base = localAddress();
  trustedLocalOrigins.add(new URL(base).origin);
  if (await isUp(base)) {
    console.log(`electron: NooblyJS is already running at ${base}; opening it (it keeps running when this window closes).`);
    return base;
  }
  server = spawn(process.env.NOOBLY_NODE || 'node', ['--env-file-if-exists=.env', 'app.js'], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  server.once('error', (err) => {
    if (!quitting) dialog.showErrorBox('NooblyJS could not start', `${err.message}\n\nNooblyJS runs under Node.js 22.12 or newer. Install it, or set NOOBLY_NODE to its path.`);
  });
  await waitUntilUp(base, server);
  return base;
}

function stopNoobly() {
  if (!server || server.exitCode !== null) return;
  // NooblyJS closes its hosted apps on SIGTERM/SIGINT; Windows has no signals, so the process is ended there.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
  else server.kill('SIGTERM');
}

function buildMenu(base) {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'NooblyJS', submenu: [
      { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => win?.loadURL(`${base}/`) },
      { label: 'Open in browser', click: () => shell.openExternal(win?.webContents.getURL() || base) },
      { type: 'separator' },
      { role: isMac ? 'close' : 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
}

function openWindow(base) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    title: 'NooblyJS',
    backgroundColor: '#0b1f3a',
    show: !SMOKE,
    // A page is a web page: no Node in it, and nothing of this process.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const origin = new URL(base).origin;
  const inside = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  // Links that leave NooblyJS (GitHub, the docs) open in the person's browser, never in this window. Sign-in is not a
  // link: NooblyJS redirects to Microsoft and Microsoft posts back, and both stay in the window.
  const outside = (url) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inside(url)) return { action: 'allow' };
    outside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (inside(url) || !inside(win.webContents.getURL())) return;
    event.preventDefault();
    outside(url);
  });
  win.on('closed', () => { win = null; });
  if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      console.log(`electron smoke: loaded ${win.webContents.getURL()} "${win.getTitle()}"`);
      app.quit();
    });
    win.webContents.once('did-fail-load', (event, code, text) => {
      console.error(`electron smoke: the page did not load (${code} ${text})`);
      process.exitCode = 1;
      app.quit();
    });
  }
  return win.loadURL(`${base}/`);
}

// One NooblyJS window per machine: a second launch brings the first to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    let trusted = false;
    try {
      trusted = trustedLocalOrigins.has(new URL(url).origin);
    } catch { /* not a URL: not trusted */ }
    if (trusted) event.preventDefault();
    callback(trusted);
  });

  app.whenReady().then(async () => {
    try {
      const base = process.env.NOOBLY_URL ? process.env.NOOBLY_URL.replace(/\/+$/, '') : await startNoobly();
      if (process.env.NOOBLY_URL) await waitUntilUp(base, null);
      buildMenu(base);
      await openWindow(base);
    } catch (err) {
      console.error(`electron: ${err.message}`);
      if (!SMOKE) dialog.showErrorBox('NooblyJS could not start', err.message);
      process.exitCode = 1;
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    stopNoobly();
  });
}
