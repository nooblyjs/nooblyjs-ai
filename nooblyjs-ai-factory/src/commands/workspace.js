// @ts-check
// Phase F02: `factory workspace`: look at and manage workspaces by hand.
//
//   factory workspace create --repo ../my-app [--base main] [--name x] [--setup] [--allow-unsandboxed]
//   factory workspace list
//   factory workspace release <id> [--keep] [--message "…"]
//   factory workspace clean
import { parseArgs } from 'node:util';
import { commandIsolation } from '../exec/sandbox.js';
import { ensureSetup } from '../exec/workspace/setup-cache.js';
import { acquireWorkspace, cleanWorkspaces, listWorkspaces, loadWorkspace, releaseWorkspace } from '../exec/workspace/worktree.js';

export const HELP = `Usage: factory workspace <create|list|release|clean> [options]

  create --repo <path|url> [--base <ref>] [--name <n>] [--setup] [--allow-unsandboxed]
                         a fresh worktree + branch from the repo's mirror
  list                   every workspace, newest first
  release <id> [--keep] [--message <m>]
                         commit changes to its branch, remove the checkout (unless --keep)
  clean                  delete released workspaces' folders (their branches stay)`;

/** @param {string[]} argv */
export async function workspaceCommand(argv) {
  const [sub, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      base: { type: 'string' },
      name: { type: 'string' },
      setup: { type: 'boolean' },
      'allow-unsandboxed': { type: 'boolean' },
      keep: { type: 'boolean' },
      message: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !sub) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  if (sub === 'create') {
    if (!values.repo) throw new Error('create needs --repo <path|url>.');
    const ws = await acquireWorkspace({ repo: values.repo, base: values.base, name: values.name });
    console.log(`${ws.id}\n  path:    ${ws.path}\n  branch:  ${ws.branch}\n  base:    ${ws.baseRef} @ ${ws.baseSha.slice(0, 12)}\n  network: ${JSON.stringify(ws.config.network)}`);
    for (const warning of ws.config.warnings) console.log(`  ⚠ ${warning}`);
    const sandbox = commandIsolation(); // Phase F23: bubblewrap, or a container image
    console.log(`  sandbox: ${sandbox.available ? sandbox.backend : `none (${sandbox.reason})`}`);
    if (values.setup) {
      const setup = await ensureSetup(ws, ws.config, { allowUnsandboxed: values['allow-unsandboxed'] });
      console.log(`  setup:   ${setup.status}${setup.durationMs ? ` (${(setup.durationMs / 1000).toFixed(1)}s)` : ''}`);
    }
    return 0;
  }

  if (sub === 'list') {
    const all = listWorkspaces();
    if (!all.length) console.log('No workspaces.');
    for (const ws of all) {
      const result = ws.result ? ` · ${ws.result.commits} commit(s)` : '';
      console.log(`${ws.id}  ${ws.status.padEnd(8)} ${ws.branch}${result}\n  ${ws.status === 'released' ? '(checkout removed)' : ws.path}`);
    }
    return 0;
  }

  if (sub === 'release') {
    const ws = loadWorkspace(positionals[0] ?? '');
    if (!ws) throw new Error(`No workspace "${positionals[0] ?? ''}". See: factory workspace list`);
    const result = await releaseWorkspace(ws, { keep: values.keep, message: values.message });
    console.log(result.commits ? `${result.branch}: ${result.commits} commit(s)\n${result.stat}` : 'No changes: branch deleted.');
    return 0;
  }

  if (sub === 'clean') {
    const removed = cleanWorkspaces();
    console.log(removed.length ? `Removed ${removed.length} released workspace folder(s).` : 'Nothing to clean.');
    return 0;
  }

  console.error(`Unknown subcommand "${sub}".\n${HELP}`);
  return 1;
}
