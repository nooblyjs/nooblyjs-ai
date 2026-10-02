// @ts-check
// Phase F16: `factory mcp`, the factory as an MCP server (stdio).
//
//   factory mcp --step <runId>/<step> [--station <id>]
//       One agent step's tools (read_spec, ask_human, …). Started BY THE HARNESS from the
//       step's mcp.json, with FACTORY_STEP_TOKEN and FACTORY_WORKSPACE in its environment.
//       A wrong or missing token: it refuses to start.
//
//   factory mcp --operator
//       A person's tools (submit_item, list_runs, get_run, answer_inbox), for your own noobly:
//       ~/.noobly/mcp.json → { "servers": { "factory": { "command": "factory", "args": ["mcp", "--operator"] } } }
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { OPERATOR_TOOLS } from '../mcp/operator-tools.js';
import { serveMcp } from '../mcp/server.js';
import { STEP_TOOLS } from '../mcp/step-tools.js';
import { verifyStepToken } from '../mcp/tokens.js';
import { openStore } from '../store/events.js';

const pkg = createRequire(import.meta.url)('../../package.json');

/** @param {string[]} argv */
export async function mcpCommand(argv) {
  const { values } = parseArgs({ args: argv, options: { step: { type: 'string' }, station: { type: 'string' }, operator: { type: 'boolean' } } });
  const env = process.env;
  if (values.operator) {
    const store = openStore({ env });
    await serveMcp({ name: 'factory-operator', version: pkg.version, tools: OPERATOR_TOOLS, ctx: { store, env } });
    store.close();
    return 0;
  }
  if (!values.step?.includes('/')) throw new Error('Usage: factory mcp --step <runId>/<step> [--station <id>]   |   factory mcp --operator');
  const [runId, step] = [values.step.slice(0, values.step.indexOf('/')), values.step.slice(values.step.indexOf('/') + 1)];
  if (!verifyStepToken(env, runId, step, env.FACTORY_STEP_TOKEN)) {
    console.error(`factory mcp: the token does not match ${runId}/${step}. Refusing to serve.`);
    return 1;
  }
  const store = openStore({ env });
  if (!store.get('runs', runId)) {
    store.close();
    console.error(`factory mcp: no run ${runId}.`);
    return 1;
  }
  await serveMcp({ name: 'factory', version: pkg.version, tools: STEP_TOOLS, ctx: { store, runId, step, station: values.station ?? step.split(/[:#]/)[0], workspace: env.FACTORY_WORKSPACE ?? process.cwd(), env } });
  store.close();
  return 0;
}
