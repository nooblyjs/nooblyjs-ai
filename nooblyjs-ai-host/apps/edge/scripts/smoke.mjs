// npm run test:edge (from noobly): loads the unpacked extension into Playwright's Chromium (Edge's engine),
// then checks that the service worker starts, the side panel says whether NooblyJS answers, and the Jira reader
// reads an issue page. Jira is a fake page served by Playwright: nothing reaches a real Jira.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };

// A stand-in NooblyJS that answers /healthz, on a free port.
const noobly = http.createServer((req, res) => {
  if (req.url === '/api/v1/shell') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.end(JSON.stringify({ person: { id: 'stevie', name: 'Stevie', accessRole: 'owner' } }));
    return;
  }
  if (req.url === '/healthz') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'ok', version: 'smoke' })); return; }
  res.statusCode = 404; res.end();
});
await new Promise((resolve) => noobly.listen(0, '127.0.0.1', resolve));
const nooblyUrl = `http://localhost:${noobly.address().port}`;

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-edge-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', // the new headless mode, which loads extensions
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});
try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  check('the service worker starts', Boolean(id), `chrome-extension://${id}`);

  // The fake Jira issue page (served for https://smoke.atlassian.net, which the content script matches).
  await context.route('https://smoke.atlassian.net/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>DTE-42</title>
      <h1 data-testid="issue.views.issue-base.foundation.summary.heading">Show delivery slots by store</h1>
      <button data-testid="issue.views.issue-base.foundation.change-issue-type.button">Story</button>
      <div data-testid="issue.views.issue-base.foundation.status.status-field-wrapper">In Progress</div>`,
  }));
  const jira = await context.newPage();
  await jira.goto('https://smoke.atlassian.net/browse/DTE-42');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`);
  await panel.evaluate((url) => chrome.storage.sync.set({ nooblyUrl: url }), nooblyUrl);
  await panel.reload();
  const status = (await panel.locator('#status').filter({ hasText: /Connected|reachable|answer/ }).textContent({ timeout: 10000 })).trim();
  check('the side panel finds NooblyJS', status === 'Connected to NooblyJS', status);

  const who = (await panel.locator('#who').filter({ hasText: /Signed in|Sign in|reachable/ }).textContent({ timeout: 10000 })).trim();
  check('the side panel knows who you are from your NooblyJS session', who.startsWith('Signed in as Stevie'), who);

  const read = await panel.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try { const ctx = await chrome.tabs.sendMessage(tab.id, { type: 'noobly:context' }); if (ctx) return ctx; } catch { /* no reader on that tab */ }
    }
    return null;
  });
  check('the Jira reader reads the issue', read?.key === 'DTE-42' && read?.summary === 'Show delivery slots by store' && read?.status === 'In Progress',
    read ? `${read.key} · ${read.summary} · ${read.type} · ${read.status}` : 'no answer');

  noobly.close();
  await panel.reload();
  const down = (await panel.locator('#status').filter({ hasText: /Connected|reachable|answer/ }).textContent({ timeout: 10000 })).trim();
  check('the side panel says when NooblyJS is not there', down !== 'Connected to NooblyJS', down);

  const composer = await panel.locator('#ask').isDisabled();
  check('the chat is off until Phase 14', composer);
} finally {
  await context.close();
  noobly.close();
  await fs.rm(profile, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `${failed} of ${checks.length} checks failed` : `all ${checks.length} checks passed`);
process.exitCode = failed ? 1 : 0;
