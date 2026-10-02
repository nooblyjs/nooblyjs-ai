// @ts-check
// Phase F25: `factory campaign …`
//
//   factory campaign create --name node24 --spec campaign.md --repos ../a,../b [--repos-file list.txt]
//        [--autonomy L2] [--routing cheap-first] [--script f.json] [--allow-unsandboxed]
//   factory campaign status [<campaignId>]          done / open / failed, per repo
//   factory campaign list
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { campaignStatus, createCampaign } from '../campaign/campaign.js';
import { openStore } from '../store/events.js';

/** @param {string[]} argv */
export async function campaignCommand(argv) {
  const [sub, ...rest] = argv;
  const store = openStore();
  try {
    if (sub === 'create') {
      const { values } = parseArgs({ args: rest, options: { name: { type: 'string' }, spec: { type: 'string' }, repos: { type: 'string' }, 'repos-file': { type: 'string' }, autonomy: { type: 'string' }, routing: { type: 'string' }, line: { type: 'string' }, script: { type: 'string' }, 'allow-unsandboxed': { type: 'boolean' } } });
      if (!values.spec || (!values.repos && !values['repos-file'])) throw new Error('Usage: factory campaign create --name <name> --spec campaign.md --repos a,b,c (or --repos-file list.txt)');
      const listed = [...(values.repos ?? '').split(','), ...(values['repos-file'] ? fs.readFileSync(values['repos-file'], 'utf8').split('\n') : [])].map((r) => r.trim()).filter((r) => r && !r.startsWith('#'));
      const repos = listed.map((r) => (/^(https?|git|ssh):|^git@/.test(r) ? r : path.resolve(r)));
      const c = createCampaign(store, {
        name: values.name ?? path.basename(values.spec, '.md'), repos, spec: fs.readFileSync(values.spec, 'utf8'),
        autonomy: values.autonomy, routing: values.routing, line: values.line, allowUnsandboxed: values['allow-unsandboxed'],
        agent: values.script ? { script: path.resolve(values.script) } : undefined,
      });
      console.log(`campaign ${c?.campaignId}: "${c?.title}" across ${repos.length} repo(s)`);
      for (const i of c?.items ?? []) console.log(`  ${i.error ? '✗' : '⌛'} ${i.repo}  ${i.error ?? `queued ${i.runId}`}`);
      console.log('Runs when `factory serve` is running. Progress: factory campaign status');
      return 0;
    }
    if (sub === 'status' || sub === 'list' || !sub) {
      const all = campaignStatus(store, sub === 'status' ? rest[0] : undefined);
      if (!all.length) console.log('No campaigns yet.');
      for (const c of all) {
        console.log(`${c.campaignId}  ${c.name}: "${c.title}"  ·  ${c.done} done · ${c.open} open · ${c.failed} failed · $${c.costUsd.toFixed(2)}`);
        if (sub === 'list') continue;
        for (const r of c.repos) console.log(`  ${{ done: '✅', open: '⌛', failed: '❌' }[r.state]} ${r.status.padEnd(18)} ${r.repo}${r.pr ? `  ${r.pr}` : ''}${r.reason ? `  (${r.reason})` : ''}`);
      }
      return 0;
    }
    throw new Error('Usage: factory campaign create|status|list');
  } finally {
    store.close();
  }
}
