// @ts-check
// Phase F08: `factory init <repo>`: draft steering and config, delivered as a PR.
import { parseArgs } from 'node:util';
import { loadScriptedProvider } from '../exec/harness/script.js';
import { createLocalForge } from '../forge/local.js';
import { initRepo } from '../knowledge/init.js';

export const HELP = `Usage: factory init <repo> [--base <ref>] [--agent [--model <id> | --script <file.json>]] [--allow-unsandboxed]

Read the repository and draft .factory/config.json (gates, setup) and
.factory/steering/{product,tech,structure}.md, then deliver them as a draft PR
on factory/init/main for you to edit and merge. Nothing that exists is overwritten.

  --agent      also let an agent refine the drafts by reading the code (a real model, or --script)`;

/** @param {string[]} argv */
export async function initCommand(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { base: { type: 'string' }, agent: { type: 'boolean' }, model: { type: 'string' }, provider: { type: 'string' }, script: { type: 'string' }, 'allow-unsandboxed': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help || !positionals[0]) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }
  const agent = values.agent ? { model: values.model, provider: values.script ? loadScriptedProvider(values.script, 'init') : values.provider } : undefined;
  const out = await initRepo({ repo: positionals[0], base: values.base, forge: createLocalForge(), agent, allowUnsandboxed: values['allow-unsandboxed'], log: (l) => process.stderr.write(`\x1b[2m${l}\x1b[0m\n`) });
  if (!out.pr) {
    console.log('Nothing to draft: the repository already has all of these files.');
    return 0;
  }
  console.log(`Drafted ${out.written.length} file(s) on ${out.head}.\nPR (draft): ${out.pr.path}`);
  return 0;
}
