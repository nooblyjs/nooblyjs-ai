#!/usr/bin/env node
// Runs one npm script in every sub-project, in dependency order.
//
//   node scripts/each.js <script> [--parallel] [--only a,b]
//
// <script> "install" runs `npm install`; anything else runs `npm run <script>`
// and skips projects that don't define it. Sequential runs keep going after a
// failure and exit non-zero at the end if any project failed.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// In dependency order: the harness before the apps that run agents on it, the hosted apps before the host that links
// them. nooblyjs-core (with the AI module, nooblyjs-ai-common, in src/aiservice/common) is a separate repo next to the
// monorepo. The Software Factory carries its Product section (one package since 2026-10-19).
const PROJECTS = [
  'nooblyjs-ai-harness',
  'nooblyjs-ai-factory',
  'nooblyjs-ai-teammate',
  'nooblyjs-ai-infrastructure',
  'nooblyjs-ai-security',
  'nooblyjs-ai-knowledge',
  'nooblyjs-ai-host',
  'nooblyjs-ai-desktop',
];

const args = process.argv.slice(2);
const script = args[0]?.startsWith('--') ? undefined : args[0];
const parallel = args.includes('--parallel');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1].split(',').map((n) => n.replace(/^(nooblyjs-ai-)?/, 'nooblyjs-ai-')) : null;

if (!script) {
  console.error('Usage: node scripts/each.js <script> [--parallel] [--only common,desktop]');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const targets = PROJECTS.filter((name) => !only || only.includes(name)).filter((name) => {
  if (script === 'install') return true;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, name, 'package.json'), 'utf8'));
  if (pkg.scripts?.[script]) return true;
  console.log(`- ${name}: no "${script}" script, skipped`);
  return false;
});

function run(name) {
  const npmArgs = script === 'install' ? ['install'] : ['run', script];
  return new Promise((resolve) => {
    if (!parallel) console.log(`\n=== ${name}: npm ${npmArgs.join(' ')} ===`);
    const child = spawn('npm', npmArgs, {
      cwd: path.join(root, name),
      stdio: parallel ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: process.platform === 'win32',
    });
    if (parallel) {
      const label = `[${name.replace('nooblyjs-ai-', '')}] `;
      for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        let rest = '';
        from.on('data', (chunk) => {
          const lines = (rest + chunk).split('\n');
          rest = lines.pop();
          for (const line of lines) to.write(label + line + '\n');
        });
        from.on('end', () => rest && to.write(label + rest + '\n'));
      }
    }
    child.on('close', (code) => resolve({ name, code: code ?? 1 }));
  });
}

(async () => {
  const results = parallel
    ? await Promise.all(targets.map(run))
    : await targets.reduce(async (acc, name) => [...(await acc), await run(name)], Promise.resolve([]));
  const failed = results.filter((r) => r.code !== 0);
  console.log(`\n${script}: ${results.length - failed.length} ok, ${failed.length} failed` +
    (failed.length ? ` (${failed.map((r) => r.name).join(', ')})` : ''));
  process.exit(failed.length ? 1 : 0);
})();
