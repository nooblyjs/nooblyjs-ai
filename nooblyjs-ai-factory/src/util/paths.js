// @ts-check
// Phase F00: where the factory keeps its own files.
//
//   ~/.factory/                 ($FACTORY_HOME overrides it; tests point it at a temp folder)
//   ├── repos/<slug>.git        mirrors of the repos we work on        (Phase F02)
//   ├── workspaces/<id>/        one folder per agent step               (Phase F02)
//   ├── cache/<slug>/<key>/     setup results (node_modules…)           (Phase F02)
//   └── debug.log               FACTORY_DEBUG=1
//
// Same idea as the harness's ~/.noobly and $NOOBLY_HOME.
import os from 'node:os';
import path from 'node:path';

/** ~/.factory, or $FACTORY_HOME. */
export function factoryHome(env = process.env) {
  return env.FACTORY_HOME ?? path.join(os.homedir(), '.factory');
}

/** A folder-safe name for a repository path or URL: /home/me/my-app → home-me-my-app */
export function repoSlug(repo) {
  return String(repo)
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
