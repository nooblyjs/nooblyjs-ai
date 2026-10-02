// @ts-check
// Phase F25: CAMPAIGNS. One change, many repositories.
//
//   factory campaign create --name node24 --spec campaign.md --repos ../a,../b,../c
//
//   campaign.created { campaignId, name, repos, title }  ─► one ordinary item per repo, tagged with
//                                                            the campaign: its own run, its own PR,
//                                                            and that repo's OWN steering and gates
//
// What a campaign adds to "submit the same issue N times":
//
//   one spec          campaign.md is the issue every repo gets (steering makes it fit each repo)
//   isolation         a repo that fails to even submit (not a git repo, a typo) is recorded and
//                     skipped; the others go ahead. A run that fails is that repo's problem only.
//   a rate limit      at most N campaign PRs per repo per day (config campaigns.maxPrsPerRepoPerDay):
//                     a fleet change must not bury one team's reviewers
//   batch tracking    `factory campaign status`: done / open / failed, per repo, in one view
import fs from 'node:fs';
import path from 'node:path';
import { parseIssue } from '../job/issue.js';
import { submitJob } from '../job/run-job.js';
import { newId } from '../util/ids.js';
import { factoryHome } from '../util/paths.js';

/**
 * @param {import('../store/events.js').Store} store
 * @param {{ name: string, repos: string[], spec: string, priority?: number, autonomy?: string, line?: string, routing?: string,
 *           agent?: object, allowUnsandboxed?: boolean, key?: string }} options
 *   spec: the issue text (markdown, like an issue file); key: idempotency (schedules)
 */
export function createCampaign(store, { name, repos, spec, priority, autonomy, line, routing, agent, allowUnsandboxed, key }) {
  if (key && store.hasKey(key)) return null;
  repos = [...new Set(repos)]; // one item per repo, however it was listed
  if (!repos.length) throw new Error('A campaign needs at least one repository.');
  const { title } = parseIssue(spec);
  const campaignId = newId('campaign');
  // The spec is written once, as an issue file every item points at (the local forge files it per repo).
  const dir = path.join(factoryHome(store.env), 'campaigns', campaignId);
  fs.mkdirSync(dir, { recursive: true });
  const issueFile = path.join(dir, 'issue.md');
  fs.writeFileSync(issueFile, spec);
  store.append(`campaign:${campaignId}`, 'campaign.created', { campaignId, name, title, repos, issueFile }, key ? { key } : undefined);

  const items = [];
  for (const repo of repos) {
    try {
      if (!fs.existsSync(path.join(repo, '.git')) && !/^(https?|git|ssh):|^git@/.test(repo)) throw new Error(`${repo} is not a git repository`);
      const runId = submitJob(store, { issueFile, repo, campaign: campaignId, autonomy, line, routing, agent, allowUnsandboxed }, { priority });
      store.append(`campaign:${campaignId}`, 'campaign.item_submitted', { campaignId, repo, runId });
      items.push({ repo, runId });
    } catch (error) {
      // One repo's problem is recorded, not fatal: the others go ahead.
      const reason = error instanceof Error ? error.message : String(error);
      store.append(`campaign:${campaignId}`, 'campaign.item_failed', { campaignId, repo, reason });
      items.push({ repo, error: reason });
    }
  }
  return { campaignId, name, title, items };
}

/** Campaigns, and where each repo's item is. */
export function campaignStatus(store, campaignId) {
  const created = store.read({ types: ['campaign.created'] }).map((e) => e.data).filter((c) => !campaignId || c.campaignId === campaignId);
  return created.map((c) => {
    const events = store.read({ stream: `campaign:${c.campaignId}` });
    const repos = c.repos.map((repo) => {
      const failed = events.find((e) => e.type === 'campaign.item_failed' && e.data.repo === repo);
      if (failed) return { repo, state: 'failed', status: 'not submitted', reason: failed.data.reason, runId: null, pr: null };
      const submitted = events.find((e) => e.type === 'campaign.item_submitted' && e.data.repo === repo);
      const run = submitted && store.get('runs', submitted.data.runId);
      const status = run?.status ?? 'unknown';
      const state = ['delivered', 'merged'].includes(status) ? 'done' : ['queued', 'running', 'parked', 'paused'].includes(status) ? 'open' : 'failed';
      return { repo, state, status, runId: run?.id ?? null, pr: run?.pr ?? null, costUsd: run?.costUsd ?? 0 };
    });
    const count = (s) => repos.filter((r) => r.state === s).length;
    return { ...c, repos, done: count('done'), open: count('open'), failed: count('failed'), costUsd: repos.reduce((s, r) => s + (r.costUsd ?? 0), 0) };
  });
}

/** Campaign runs started today (UTC), per repo slug: the scheduler's rate-limit input. */
export function campaignStartsToday(store, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const out = {};
  for (const r of store.list('runs')) {
    if (!r.request?.campaign || !r.startedAt || !r.startedAt.startsWith(day)) continue;
    const slug = r.slug ?? r.itemId?.split('#')[0];
    out[slug] = (out[slug] ?? 0) + 1;
  }
  return out;
}
