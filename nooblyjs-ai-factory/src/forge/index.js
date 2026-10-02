// @ts-check
// Phase F15: which forge does a run use?
//
//   request.forge = { kind: 'github', owner, name }   → the GitHub forge (token from the operator's env)
//   anything else                                      → the local forge (Phase F03)
//
// The rest of the factory only ever sees the Forge interface.
import { loadFactoryConfig } from '../config/factory-config.js';
import { createGitHubClient } from './github/client.js';
import { createGitHubForge } from './github/forge.js';
import { createLocalForge } from './local.js';

/** The GitHub settings from ~/.factory/config.json "github", with defaults. */
export function githubSettings(env = process.env) {
  const g = loadFactoryConfig(env).github ?? {};
  return {
    tokenEnv: g.tokenEnv ?? 'GITHUB_TOKEN',
    secretEnv: g.webhookSecretEnv ?? 'FACTORY_WEBHOOK_SECRET',
    apiUrl: g.apiUrl ?? 'https://api.github.com',
    label: g.label ?? 'factory',
    allowedUsers: g.allowedUsers ?? [],
    webhookPort: g.webhookPort ?? 8787,
    repos: g.repos ?? [],
  };
}

/**
 * @param {{ forge?: { kind: string, owner?: string, name?: string, apiUrl?: string } }} request
 * @param {{ env?: NodeJS.ProcessEnv, client?: any }} [options]  client: inject one (tests)
 */
export function forgeFor(request, { env = process.env, client } = {}) {
  const f = request?.forge;
  if (f?.kind !== 'github') return createLocalForge({ env });
  const s = githubSettings(env);
  const token = env[s.tokenEnv];
  return createGitHubForge({ client: client ?? createGitHubClient({ token: /** @type {string} */ (token), apiUrl: f.apiUrl ?? s.apiUrl }), owner: /** @type {string} */ (f.owner), name: /** @type {string} */ (f.name), token });
}
