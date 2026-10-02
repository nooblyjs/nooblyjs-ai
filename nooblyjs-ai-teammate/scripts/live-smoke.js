// Phase 2.1 live check: one small real task per model tier against a throwaway copy of the seed workspace.
// Usage: ANTHROPIC_API_KEY=... npm run smoke:live   (costs a few cents)
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { createProviders } from '../src/providers/index.js';

const RUNS = [
  { teammate: 'otis-fern', tier: 'haiku', task: 'In two sentences: what is the safest way to deduplicate a CRM export with fuzzy company names?' },
  { teammate: 'wren-sato', tier: 'sonnet', task: 'Write a three-line account brief for a fictional company called Acme Robotics, with an opening line for a sales rep.' },
  { teammate: 'ada-quill', tier: 'opus', task: 'List three questions you would ask before starting a competitor scan, in a short bulleted list.' },
];

// Real calls need ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. AI_PROVIDER=mock is a free dry run.
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const mode = process.env.AI_PROVIDER || (hasKey ? 'anthropic' : null);
if (!mode) {
  console.error('This script needs real credentials. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in .env.\nFor a free dry run: AI_PROVIDER=mock npm run smoke:live');
  process.exit(1);
}
const providers = createProviders({ mode });
console.log(`Provider: ${providers.describe()}${providers.describe() === 'mock' ? ' (dry run, no API calls)' : ''}`);

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teammates-live-'));
const { invocation, repos } = await createApp({ dataDir, providers, log: { info() {}, warn: console.warn, error: console.error } });
let failed = 0;

for (const run of RUNS) {
  const started = Date.now();
  process.stdout.write(`\n— ${run.teammate} (${run.tier}) … `);
  try {
    const r = await invocation.assign(run.teammate, { task: run.task });
    const work = await repos.work.get(run.teammate, r.workId);
    console.log(`${((Date.now() - started) / 1000).toFixed(1)}s, served by ${work.servedBy}, stop: ${r.stopReason}`);
    console.log(`  tokens in/out/cache-read/cache-write: ${r.usage.inputTokens}/${r.usage.outputTokens}/${r.usage.cacheReadTokens}/${r.usage.cacheWriteTokens}`);
    console.log(`  billed ${r.hours}h × $${r.entry.rate} = $${r.amount} · actual API cost $${r.apiCost} · memories +${r.memoriesAdded.length}`);
    for (const m of r.memoriesAdded) console.log(`    [${m.kind}] ${m.text}`);
    console.log(`  output: ${r.output.replace(/\s+/g, ' ').slice(0, 220)}${r.output.length > 220 ? '…' : ''}`);
    if (!r.output.trim() || !(r.usage.outputTokens > 0)) throw new Error('empty output or missing usage');
  } catch (err) {
    failed++;
    console.log(`FAILED: ${err.message}`);
  }
}

console.log(`\nWorkspace kept for inspection: ${dataDir}`);
process.exit(failed ? 1 : 0);
