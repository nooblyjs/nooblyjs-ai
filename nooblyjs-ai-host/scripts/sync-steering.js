// npm run steering:sync          copies docs/steering/nooblyjs-ai-shared-rules.md into every sibling project's
//                                .claude/steering/nooblyjs-ai.md, so an agent working there loads the shared rules
// npm run steering:sync -- --check  changes nothing; exits 1 if any copy is missing or out of date
// nooblyjs-ai-host owns everything shared (structure.md §1a); the copies are generated and never edited by hand.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOOBLY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = path.join(NOOBLY, 'docs', 'steering', 'nooblyjs-ai-shared-rules.md');
// The projects next to this one in the nooblyjs-ai monorepo (nooblyjs-core is a general library outside it, so it gets no copy).
export const REPOS = ['nooblyjs-ai-common', 'nooblyjs-ai-harness', 'nooblyjs-ai-product', 'nooblyjs-ai-factory', 'nooblyjs-ai-teammate',
  'nooblyjs-ai-knowledge', 'nooblyjs-ai-infrastructure'];

/** Each sibling repo that exists, with where its copy goes and whether that copy matches the source. */
export async function steeringCopies({ root = path.dirname(NOOBLY) } = {}) {
  const source = await fs.readFile(SOURCE, 'utf8');
  const copies = [];
  for (const repo of REPOS) {
    const dir = path.join(root, repo);
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) continue;
    const target = path.join(dir, '.claude', 'steering', 'nooblyjs-ai.md');
    const now = await fs.readFile(target, 'utf8').catch(() => null);
    copies.push({ repo, target, source, current: now === source });
  }
  return copies;
}

async function main() {
  const check = process.argv.includes('--check');
  const copies = await steeringCopies();
  const stale = copies.filter((c) => !c.current);
  if (check) {
    for (const c of stale) console.error(`out of date: ${c.repo}/.claude/steering/nooblyjs-ai.md (run npm run steering:sync)`);
    if (!stale.length) console.log(`steering: ${copies.length} copies match docs/steering/nooblyjs-ai-shared-rules.md`);
    process.exitCode = stale.length ? 1 : 0;
    return;
  }
  for (const c of stale) {
    await fs.mkdir(path.dirname(c.target), { recursive: true });
    await fs.writeFile(c.target, c.source);
    console.log(`wrote ${c.repo}/.claude/steering/nooblyjs-ai.md`);
  }
  console.log(`steering: ${copies.length} repos, ${stale.length} updated`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
