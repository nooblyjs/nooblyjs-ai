// @ts-check
// Phase F15: `factory github …`
//
//   factory github poll --repo owner/name [--clone <path|url>] [--line …]
//       No public URL for webhooks? Ask GitHub instead: open issues labelled "factory"
//       that the factory hasn't seen yet become queued runs. Run it from cron, or by hand.
//
//   factory github webhook-test
//       Print the settings the webhook server would use (and whether the secret is set).
import { parseArgs } from 'node:util';
import { createGitHubClient } from '../forge/github/client.js';
import { githubSettings } from '../forge/index.js';
import { submitJob } from '../job/run-job.js';
import { openStore } from '../store/events.js';

/** @param {string[]} argv */
export async function githubCommand(argv) {
  const [sub, ...rest] = argv;
  const settings = githubSettings();
  if (sub === 'webhook-test') {
    console.log(JSON.stringify({ ...settings, tokenSet: Boolean(process.env[settings.tokenEnv]), secretSet: Boolean(process.env[settings.secretEnv]) }, null, 2));
    return 0;
  }
  if (sub !== 'poll') throw new Error('Usage: factory github poll --repo owner/name [--clone <path|url>] [--line <line>]   |   factory github webhook-test');
  const { values } = parseArgs({ args: rest, options: { repo: { type: 'string' }, clone: { type: 'string' }, line: { type: 'string' }, autonomy: { type: 'string' } } });
  const [owner, name] = String(values.repo ?? '').split('/');
  if (!owner || !name) throw new Error('--repo owner/name is required.');
  const client = createGitHubClient({ token: /** @type {string} */ (process.env[settings.tokenEnv]), apiUrl: settings.apiUrl });
  const store = openStore();
  try {
    const issues = await pollIssues(store, client, { owner, name, label: settings.label, clone: values.clone, line: values.line, autonomy: values.autonomy, apiUrl: settings.apiUrl });
    console.log(issues.length ? issues.map((i) => `queued ${i.runId}  ${i.ref}: ${i.title}`).join('\n') : `No new issues labelled "${settings.label}" in ${owner}/${name}.`);
    return 0;
  } finally {
    store.close();
  }
}

/**
 * Open issues with the label that have no item yet → queued runs.
 * @returns {Promise<{ runId: string, ref: string, title: string }[]>}
 */
export async function pollIssues(store, client, { owner, name, label, clone, line, autonomy, apiUrl }) {
  const list = await client.request('GET', `/repos/${owner}/${name}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`);
  const queued = [];
  for (const i of list ?? []) {
    if (i.pull_request) continue; // the issues API lists PRs too
    const itemId = `github-${owner}-${name}#${i.number}`;
    if (store.get('items', itemId)) continue; // seen before: a new run only on a new label event
    const issue = { number: i.number, ref: `${owner}/${name}#${i.number}`, title: i.title, body: i.body ?? '', labels: (i.labels ?? []).map((l) => l.name) };
    const runId = submitJob(store, { repo: clone ?? i.repository_url?.replace('api.github.com/repos', 'github.com') ?? `https://github.com/${owner}/${name}.git`, forge: { kind: 'github', owner, name, apiUrl }, issue, line, autonomy }, { key: `github:poll:${itemId}` });
    if (runId) queued.push({ runId, ref: issue.ref, title: issue.title });
  }
  return queued;
}
