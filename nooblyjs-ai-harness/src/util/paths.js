// Where noobly keeps its own files.
import os from 'node:os';
import path from 'node:path';

/** ~/.noobly, or $NOOBLY_HOME (tests point this at a temporary folder). */
export function nooblyHome(env = process.env) {
  return env.NOOBLY_HOME ?? path.join(os.homedir(), '.noobly');
}

/** A folder name for a project path: /workspaces/my-app → -workspaces-my-app */
export function projectSlug(cwd) {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}
