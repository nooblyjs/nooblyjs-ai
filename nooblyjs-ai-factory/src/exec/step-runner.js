// @ts-check
// Phase F02: one agent STEP, start to finish, in its own workspace.
// Phase F04: …and VERIFIED by deterministic gates before the workspace is released.
//
//   check isolation → acquire workspace → can we run its commands? → setup (cached)
//     → run the agent (with the Stop hook) → run ALL gates → release
//
// This is the smallest version of the step runner in Architecture §2. Later
// phases keep the shape and add around it: events into the store (F05),
// leases (F06).
import { runGates } from './gates/runner.js';
import { createDriver } from './harness/driver.js';
import { isolationProblem, sandboxStatus, commandIsolation } from './sandbox.js';
import { writeGatesFile, writeHarnessHome } from './workspace/harness-settings.js';
import { factoryToolsFor } from '../mcp/wire.js';
import { ensureSetup } from './workspace/setup-cache.js';
import { worktreeProvider } from './workspace/provider.js';

/**
 * @typedef {Object} StepRequest
 * @property {string} repo                       a local path or git URL
 * @property {string} [base]                     branch or commit (default: the repo's default branch)
 * @property {string} [name]                     for the branch name
 * @property {string} [driver]                   'subprocess' (default) | 'in-process'
 * @property {boolean} [keepWorkspace]           keep the checkout even on success
 * @property {string} [commitMessage]            for the factory's commit (default: the prompt's first line)
 * @property {boolean} [allowUnsandboxed]        run setup / gates / Bash-allowed agents without an OS sandbox
 * @property {(line: string) => void} [log]      progress messages for people
 * @property {(ws: import('./workspace/worktree.js').Workspace) => void} [onWorkspace]  called as soon as the workspace exists
 * @property {boolean} [verify]                  run all gates after the agent (default true). Phase F07: the line's
 *                                               verify station does that on a clean checkout instead
 * @property {string} [configSha]                read the repo config from this commit (see acquireWorkspace)
 * @property {(ws: any, result: any) => Promise<{ ok: boolean, problems: string[] }>} [check]   Phase F08: a DETERMINISTIC check of
 *                                               the agent's work (e.g. "is the spec valid?"). Problems go back to the agent…
 * @property {(problems: string[]) => string} [fixPrompt]   …in this prompt, in the same workspace…
 * @property {number} [maxFixes]                 …at most this many times (default 2)
 * @property {boolean} [stopHook]                install the gates' Stop hook (default true). Phase F07: only for agents that
 *                                               CHANGE code; a read-only triager must not be told to keep going because tests fail
 * @property {Omit<import('./harness/driver.js').AgentRun, 'cwd' | 'settings' | 'harnessHome'>} agent
 */

/**
 * @param {StepRequest} step
 * @param {{ provider?: import('./workspace/provider.js').WorkspaceProvider, env?: NodeJS.ProcessEnv, runSetup?: any, runGate?: any }} [deps]
 */
export async function runStep(step, { provider = worktreeProvider, env = process.env, runSetup, runGate } = {}) {
  const log = step.log ?? (() => {});
  const problem = isolationProblem({ ...step.agent, allowUnsandboxed: step.allowUnsandboxed });
  if (problem) throw new Error(problem);

  const ws = await provider.acquire({ repo: step.repo, base: step.base, name: step.name ?? String(step.agent.prompt), configSha: step.configSha, env });
  step.onWorkspace?.(ws);
  log(`workspace ${ws.id} · ${ws.branch} from ${ws.baseRef} @ ${ws.baseSha.slice(0, 8)}`);
  for (const warning of ws.config.warnings) log(`⚠ ${warning}`);

  // Phase F04: the factory will run this repo's OWN commands (setup, gates). Find out now,
  // before paying for an agent, whether that is allowed here.
  const commands = [ws.config.setup && 'setup', ws.config.gates.length && 'gates'].filter(Boolean);
  const sandbox = commandIsolation(); // Phase F23: bubblewrap, or a container image
  if (commands.length && !sandbox.available && !step.allowUnsandboxed) {
    await provider.release(ws).catch(() => {});
    throw new Error(`This repository's .factory/config.json has ${commands.join(' and ')}: its own commands, which need a sandbox (${sandbox.reason}). Install bubblewrap (sudo apt install bubblewrap), or pass --allow-unsandboxed.`);
  }
  // The Stop hook reads its gates (and whether it may run them unsandboxed) from this file.
  writeGatesFile(ws.gatesFile, ws.config, { allowUnsandboxed: step.allowUnsandboxed });
  let harnessSettings = ws.harnessSettings;
  if (step.stopHook === false && harnessSettings.hooks) {
    const { hooks, ...rest } = harnessSettings;
    harnessSettings = rest;
    writeHarnessHome(ws.harnessHome, rest); // the subprocess driver reads it from here
  }

  // Phase F16: the factory's tools for this step (in-process: harness tools; subprocess: mcp.json).
  const { factoryTools: who, ...agent } = step.agent;
  const factory = who ? factoryToolsFor(who, ws, env) : null;
  const agentRun = { ...agent, ...(factory && { tools: factory.tools, allowedTools: [...(agent.allowedTools ?? []), factory.allow] }) };

  let result;
  let setup;
  let gates = null;
  let check = null;
  try {
    setup = await ensureSetup(ws, ws.config, { allowUnsandboxed: step.allowUnsandboxed, env, ...(runSetup && { run: runSetup }) });
    if (setup.status !== 'none') log(`setup: ${setup.status} (${(setup.durationMs / 1000).toFixed(1)}s)`);
    const driver = await createDriver(step.driver ?? 'subprocess');
    // Phase F08: the prompt may depend on the workspace (e.g. steering read at its pinned base).
    const prompt = typeof step.agent.prompt === 'function' ? await step.agent.prompt(ws) : step.agent.prompt;
    result = await driver.run({
      ...agentRun,
      prompt,
      cwd: ws.path,
      settings: harnessSettings, // in-process: the flags layer
      harnessHome: ws.harnessHome, // subprocess: NOOBLY_HOME with settings.json (the user layer)
    });

    // Phase F08: check → fix, in the same workspace, a bounded number of times. A fresh
    // session each time (the harness can't resume one yet: H34), told exactly what's wrong.
    if (step.check && result.outcome === 'success') {
      check = await step.check(ws, result);
      for (let fix = 1; !check.ok && fix <= (step.maxFixes ?? 2) && !step.agent.signal?.aborted; fix++) {
        log(`check: ${check.problems.length} problem(s) (${check.problems.slice(0, 2).join('; ')}${check.problems.length > 2 ? '; …' : ''}); asking the agent to fix them (${fix}/${step.maxFixes ?? 2})`);
        const again = await driver.run({ ...agentRun, prompt: /** @type {any} */ (step.fixPrompt)(check.problems), cwd: ws.path, settings: harnessSettings, harnessHome: ws.harnessHome });
        result = { ...again, costUsd: result.costUsd + again.costUsd, turns: result.turns + again.turns, toolCalls: result.toolCalls + again.toolCalls, durationMs: result.durationMs + again.durationMs };
        if (again.outcome !== 'success') break;
        check = await step.check(ws, again);
      }
    }

    // Phase F04: the VERDICT. Whatever the agent said, run every gate ourselves.
    // Only when the agent finished: a half-done change failing its tests tells nobody anything.
    if (step.verify !== false && result.outcome === 'success' && ws.config.gates.length) {
      gates = await runGates(ws.config.gates, { cwd: ws.path, network: ws.config.network, allowUnsandboxed: step.allowUnsandboxed, ...(runGate && { run: runGate }) });
      log(`gates: ${gates.results.map((g) => `${g.name} ${g.status}`).join(' · ')}`);
    }
  } catch (error) {
    factory?.close();
    // Setup failed or the driver threw: keep the workspace so a human can look.
    await provider.release(ws, { keep: true, message: `factory: incomplete work (${ws.name})` }).catch(() => {});
    throw error;
  }

  factory?.close();
  // Failed runs and failed gates keep their checkout for inspection. Either way, any work is committed to the branch.
  const keep = step.keepWorkspace || result.outcome !== 'success' || gates?.passed === false || check?.ok === false;
  const message = step.commitMessage ?? `factory: ${String(typeof step.agent.prompt === 'function' ? step.name : step.agent.prompt).split('\n')[0].slice(0, 72)}`;
  const released = await provider.release(ws, { keep, message });
  return { workspace: ws, setup, result, gates, check, ...released };
}
