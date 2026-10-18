// @ts-check
// NooblyJS Phase 7: THE DEMO REPOSITORY. Something small and real for runs to work on while the
// factory is being tried out inside NooblyJS. It stands in for `web-storefront`, the repository two
// of the seed story's work items name (PRD-028 · Slot picker screens): a tiny Node package
// with one function, a test suite, and a .factory/config.json that declares one gate.
// (examples/make-demo-repo.sh makes `calc` the same way, for the CLI; that one needs bash.)
//
//   seedDemo(env)   the repository under <FACTORY_HOME>/repos/web-storefront, repos.yaml that
//                   maps the name to it, and the scripted agents for the two work items.
//                   Whatever is already there is left alone.
//
// It is sample data, and its README says so.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { factoryHome } from '../../utils/paths.js';

export const DEMO_REPO = 'web-storefront';
const SCRIPTS = fileURLToPath(new URL('../../../examples/noobly/', import.meta.url));

const FILES = {
  'package.json': '{ "name": "web-storefront-demo", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n',
  'README.md': '# web-storefront (demo)\n\nA tiny stand-in for the storefront, made by the Software Factory so runs have a repository to work on (sample data).\nRun the tests with `npm test`.\n',
  'format-slot.js': "/** A delivery slot as people read it: formatSlot('14:00', '15:00') → '14:00–15:00'. */\nexport const formatSlot = (start, end) => `${start}–${end}`;\n",
  'test/format-slot.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { formatSlot } from '../format-slot.js';\n\ntest('formatSlot', () => assert.equal(formatSlot('14:00', '15:00'), '14:00–15:00'));\n",
  '.factory/config.json': `${JSON.stringify({ gates: { test: { command: 'node --test', timeoutMs: 60000 } } }, null, 2)}\n`,
};

function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout.trim();
}

/**
 * Create the demo repository if the folder isn't one yet.
 * @param {string} dir
 * @returns {{ dir: string, created: boolean }}
 */
export function ensureDemoRepo(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) return { dir, created: false };
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} exists and is not a git repository: the demo repo was not created there.`);
  for (const [name, content] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  git(dir, ['init', '-q', '-b', 'main']);
  // Line endings as written, so the first commit is the same on every machine.
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=NooblyJS demo', '-c', 'user.email=demo@noobly.invalid', 'commit', '-q', '-m', 'web-storefront demo: formatSlot()']);
  return { dir, created: true };
}

/**
 * The seed for a factory hosted in NooblyJS: the demo repository, the map that names it, and the
 * scripted agents for the seed story's two web-storefront work items.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ repo: string, created: boolean, wrote: string[] }}
 */
export function seedDemo(env) {
  const home = factoryHome(env);
  const wrote = [];
  const { dir, created } = ensureDemoRepo(path.join(home, 'repos', DEMO_REPO));
  const map = path.join(home, 'repos.yaml');
  if (!fs.existsSync(map)) {
    fs.writeFileSync(map, [
      '# Which folder is which repository (NooblyJS Phase 7). A work item names a repository; this file says where it is.',
      '#   name: folder (relative to this file, or absolute) or a clone URL',
      '# A work item whose repository is not listed here starts nothing: it waits, and says so.',
      '# Only the demo repository is set up. The real ones arrive with GitHub (NooblyJS Phase 12) [PLACEHOLDER].',
      `${DEMO_REPO}: repos/${DEMO_REPO}`,
      '',
    ].join('\n'));
    wrote.push('repos.yaml');
  }
  for (const name of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.json'))) {
    const to = path.join(home, 'scripts', name);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(SCRIPTS, name), to);
    wrote.push(`scripts/${name}`);
  }
  return { repo: dir, created, wrote };
}
