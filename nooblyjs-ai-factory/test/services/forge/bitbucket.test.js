// NooblyJS Phase 13: the Bitbucket forge. It holds no token: it asks NooblyJS, which decides whether anything is sent.
// Bitbucket is a production system, so NooblyJS here is a stand-in that records what it was asked; nothing is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createLocalForge } from '../../../src/services/forge/local.js';
import { createBitbucketForge } from '../../../src/services/forge/bitbucket.js';
import { forgeFor, setHostDevtools } from '../../../src/services/forge/index.js';
import { gitIn, makeRepo, tmpDir } from '../../helpers.js';

const PR = { title: 'Slot picker', head: 'factory/issue-1/main', base: 'main', status: /** @type {const} */ ('ready'), body: 'What changed.\n', meta: { run: 'run_1', sha: 'abc' } };

/** NooblyJS's devtools.forge, as a stand-in: it keeps what it was asked and answers as told. */
function noobly(answers = {}) {
  const asked = [];
  return {
    asked,
    forge: {
      pushBranch: async (input) => { asked.push(['push', input]); return answers.push ?? { ok: true, sent: true, sha: 'abc' }; },
      openOrUpdatePullRequest: async (input) => { asked.push(['pr', input]); return answers.pr ?? { ok: true, sent: true, action: 'created', id: 7, url: 'https://bitbucket.org/ws/web-storefront/pull-requests/7' }; },
    },
  };
}

test('a push and a pull request are asked of NooblyJS, with the run\'s item and work item; the PR file is still written', async () => {
  const repo = await makeRepo({ 'a.txt': 'a\n' });
  await gitIn(repo, 'checkout', '-q', '-b', 'factory/issue-1/work');
  const host = noobly();
  const forge = createBitbucketForge({ local: createLocalForge({ root: tmpDir() }), devtools: () => host, name: 'web-storefront', noobly: { itemId: 'PRD-031', workItemId: 'WI-PRD-031-1' } });
  assert.equal(forge.name, 'bitbucket');
  const sha = await forge.pushBranch(repo, 'factory/issue-1/work', 'factory/issue-1/main');
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(host.asked[0], ['push', { slug: 'web-storefront', dir: repo, fromBranch: 'factory/issue-1/work', toBranch: 'factory/issue-1/main', itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: null }]);
  const pr = await forge.openOrUpdatePR('app', PR);
  assert.deepEqual([pr.action, pr.number, pr.path, pr.recorded], ['created', 7, 'https://bitbucket.org/ws/web-storefront/pull-requests/7', false]);
  assert.deepEqual(host.asked[1][1].pr, { title: 'Slot picker', head: 'factory/issue-1/main', base: 'main', status: 'ready', body: 'What changed.\n' });
  assert.equal(host.asked[1][1].runId, 'run_1');
  // The local record is what makes a retried delivery a no-op (deliver.js checks its sha).
  assert.equal(forge.findPR('app', 'factory/issue-1/main')?.sha, 'abc');
});

test('while NooblyJS records writes instead of sending them, the forge says so and points at the local record', async () => {
  const host = noobly({ pr: { ok: true, sent: false, recorded: true, id: null, url: null } });
  const forge = createBitbucketForge({ local: createLocalForge({ root: tmpDir() }), devtools: () => host, name: 'web-storefront' });
  const pr = await forge.openOrUpdatePR('app', PR);
  assert.equal(pr.recorded, true);
  assert.ok(fs.existsSync(pr.path), 'the path is the PR file on disk');
  assert.equal(pr.action, 'created');
});

test('refuses: NooblyJS said no (the run fails with its reason), and the forge never merges', async () => {
  const host = noobly({ push: { ok: false, state: 'refused', message: 'Agents may not push branches on ws/web-storefront.' }, pr: { ok: false, state: 'refused', message: 'Agents may not open pull requests on ws/web-storefront.' } });
  const repo = await makeRepo({ 'a.txt': 'a\n' });
  const forge = createBitbucketForge({ local: createLocalForge({ root: tmpDir() }), devtools: () => host, name: 'web-storefront' });
  await assert.rejects(() => forge.pushBranch(repo, 'main', 'factory/issue-1/main'), /NooblyJS did not push .*Agents may not push branches/);
  await assert.rejects(() => forge.openOrUpdatePR('app', PR), /NooblyJS did not open the pull request .*Agents may not open pull requests/);
  const merged = await forge.merge(repo, { head: 'factory/issue-1/main', base: 'main', message: 'Merge' });
  assert.deepEqual([merged.merged, /a person merges the pull request in Bitbucket/.test(merged.reason)], [false, true]);
  assert.equal(host.asked.length, 2, 'a merge was never asked of NooblyJS');
});

test('forgeFor gives the Bitbucket forge only for request.forge.kind "bitbucket", and it needs NooblyJS to be there', async () => {
  const env = { ...process.env, FACTORY_HOME: tmpDir() };
  assert.equal(forgeFor({}, { env }).name, 'local');
  const forge = forgeFor({ forge: { kind: 'bitbucket', name: 'web-storefront' }, noobly: { itemId: 'PRD-031' } }, { env });
  assert.equal(forge.name, 'bitbucket');
  await assert.rejects(() => forge.openOrUpdatePR('app', PR), /NooblyJS is not there to ask/);
  const host = noobly();
  setHostDevtools(() => host);
  try {
    await forge.openOrUpdatePR('app', PR);
    assert.equal(host.asked[0][1].itemId, 'PRD-031');
  } finally { setHostDevtools(null); }
});
