// @ts-check
// Phase F16: giving a step its factory tools, whichever driver runs it.
//
//   in-process   harness tools (defineTool), called directly, in this process
//   subprocess   <harnessHome>/mcp.json: `noobly` starts `factory mcp --step <run>/<step>` itself,
//                with the step's token in that server's environment
//
// Same names both ways (mcp__factory__read_spec, …), so a role's prompt and permission
// rules don't care which driver runs it. The rule `mcp__factory__*` is added to the
// step's allowed tools: these are OUR tools, scoped to this step, so nobody needs to be asked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool, ToolError } from '../harness.js';
import { openStore } from '../store/events.js';
import { STEP_TOOLS } from './step-tools.js';
import { stepToken } from './tokens.js';

export const SERVER_NAME = 'factory';
export const ALLOW_RULE = `mcp__${SERVER_NAME}__*`;
const BIN = fileURLToPath(new URL('../../bin/factory.js', import.meta.url));

/**
 * @param {{ runId: string, step: string, station: string }} who
 * @param {{ path: string, harnessHome: string }} ws
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ tools: object[], allow: string, close: () => void }}
 */
export function factoryToolsFor(who, ws, env = process.env) {
  // subprocess: the harness reads its user layer from harnessHome, mcp.json included.
  const servers = {
    [SERVER_NAME]: {
      command: process.execPath,
      args: [BIN, 'mcp', '--step', `${who.runId}/${who.step}`, '--station', who.station],
      env: {
        FACTORY_STEP_TOKEN: stepToken(env, who.runId, who.step),
        FACTORY_WORKSPACE: ws.path,
        ...(env.FACTORY_HOME && { FACTORY_HOME: env.FACTORY_HOME }),
      },
    },
  };
  fs.mkdirSync(ws.harnessHome, { recursive: true });
  fs.writeFileSync(path.join(ws.harnessHome, 'mcp.json'), `${JSON.stringify({ servers }, null, 2)}\n`, { mode: 0o600 });

  // in-process: the same handlers, as harness tools. Their own store connection, like the MCP server has.
  let store = null;
  const ctx = () => ({ store: (store ??= openStore({ env })), runId: who.runId, step: who.step, station: who.station, workspace: ws.path, env });
  const tools = STEP_TOOLS.map((t) =>
    defineTool({
      name: `mcp__${SERVER_NAME}__${t.name}`,
      description: t.description,
      inputSchema: t.inputSchema,
      isReadOnly: Boolean(t.readOnly),
      summarize: (input) => JSON.stringify(input ?? {}).slice(0, 60),
      async call(input) {
        try {
          const text = t.handle(ctx(), input ?? {});
          return { content: text, display: text.split('\n')[0].slice(0, 80) };
        } catch (error) {
          throw new ToolError(error instanceof Error ? error.message : String(error));
        }
      },
    }),
  );
  return { tools, allow: ALLOW_RULE, close: () => store?.close() };
}
