// @ts-check
// Phase F00: THE ONE PLACE the factory imports the harness.
//
// The factory never copies harness code: every agent it runs is a noobly
// session. Importing it through one file means that when the harness changes
// (or grows the exports the factory needs: harness track H31), only this file
// changes.
//
// Two kinds of import:
//   - the public library API (src/index.js of the harness): stable, documented
//   - a few DEEP imports of internals (cost, sandbox). They work because the
//     harness has no "exports" field in package.json, but they are not a
//     promise. Each one is listed here so H31 knows what to export properly.
import { createRequire } from 'node:module';
import path from 'node:path';

export { createSession, query, createMockProvider, createEchoProvider, EVENT, defineTool, ToolError } from 'nooblyjs-ai-harness';

// Deep imports (TODO H31: export these from the harness's src/index.js).
export { createSandbox, detectBackend } from 'nooblyjs-ai-harness/src/sandbox/index.js';

const require = createRequire(import.meta.url);

/** The harness's package folder (node_modules/nooblyjs-ai-harness, a link to ../nooblyjs-ai-harness). */
export function harnessRoot() {
  return path.dirname(require.resolve('nooblyjs-ai-harness/package.json'));
}

/** The `noobly` command, for running it as a separate process (Phase F01). $FACTORY_NOOBLY_BIN overrides it (tests use a fake). */
export function nooblyBin(env = process.env) {
  return env.FACTORY_NOOBLY_BIN ?? path.join(harnessRoot(), 'bin', 'noobly.js');
}

/** The harness version, for logs and (later) compatibility checks. */
export function harnessVersion() {
  return require('nooblyjs-ai-harness/package.json').version;
}
