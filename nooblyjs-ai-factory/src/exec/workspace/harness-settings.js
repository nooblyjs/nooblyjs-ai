// @ts-check
// Phase F02: telling the harness what this workspace allows.
//
// A problem: noobly deliberately IGNORES a project's own sandbox and
// allow-rule settings until a human trusts the project (harness Phase 12:
// a cloned repo mustn't be able to switch the sandbox off). But the factory
// has to configure exactly those settings for every workspace.
//
// The way through: the harness trusts its USER settings layer
// ($NOOBLY_HOME/settings.json) and command-line flags, because you wrote them.
// So the factory gives every workspace its OWN harness home:
//
//   ~/.factory/workspaces/<id>/
//   ├── meta.json          what this workspace is (for `factory workspace list`)
//   ├── harness/           NOOBLY_HOME for this workspace's agents
//   │   ├── settings.json  ← written by the factory: sandbox, deny rules   (trusted: user layer)
//   │   └── projects/…     ← the harness writes its transcript here: the run's record
//   └── repo/              the git worktree the agent works in
//
// Nothing is written INTO the checkout, so nothing can be committed by accident,
// and the repo can't override it. Side effect: the operator's ~/.noobly/settings.json
// isn't used for factory runs, which is what we want (reproducible runs).
//
// The in-process driver can't do this: NOOBLY_HOME is an environment variable,
// and the environment belongs to the whole process. It gets the same settings
// through createSession({ settings }) instead (the flags layer, also trusted).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STOP_HOOK = fileURLToPath(new URL('../gates/stop-hook.js', import.meta.url));

// Whatever a repo or a prompt says, a factory agent never does these. Only the control
// plane pushes (after checks), and the agent must not re-point or reconfigure git.
export const ALWAYS_DENY = ['Bash(git push:*)', 'Bash(git remote:*)', 'Bash(git config:*)', 'Bash(gh:*)'];

/**
 * Harness settings for agents in a workspace.
 * @param {import('./repo-config.js').RepoConfig} config
 * @param {{ gatesFile?: string }} [options]  Phase F04: where the Stop hook finds its gates
 */
export function harnessSettingsFor(config, { gatesFile } = {}) {
  const settings = {
    sandbox: { enabled: true, network: config.network },
    permissions: { deny: [...ALWAYS_DENY] },
  };
  const fast = (config.gates ?? []).filter((g) => g.fast);
  if (gatesFile && fast.length) {
    // Phase F04: run the fast gates when the agent tries to stop. A hook in the USER layer
    // (our harness home) or the flags layer is trusted by the harness, like the sandbox setting.
    const seconds = Math.ceil(fast.reduce((sum, g) => sum + g.timeoutMs, 0) / 1000) + 10;
    const quote = (p) => `"${p.replace(/(["\\$`])/g, '\\$1')}"`;
    return { ...settings, hooks: { Stop: [{ command: `${quote(process.execPath)} ${quote(STOP_HOOK)} ${quote(gatesFile)}`, timeout: seconds }] } };
  }
  return settings;
}

/** Phase F04: the gates the Stop hook runs, written OUTSIDE the checkout so the agent can't change them. */
export function writeGatesFile(file, config, { allowUnsandboxed = false } = {}) {
  fs.writeFileSync(file, `${JSON.stringify({ gates: config.gates ?? [], network: config.network, allowUnsandboxed }, null, 2)}\n`);
}

/** Write settings.json into a harness home folder. */
export function writeHarnessHome(dir, settings) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
}
