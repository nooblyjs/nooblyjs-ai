// Settings from the environment, read once at start and validated (tech.md §9).
// Runtime settings people change live in data/config/*.yaml and are read by the services that use them.
import path from 'node:path';

export const DEFAULT_PORT = 11001;
const DEFAULT_HOST = '127.0.0.1';
export const SESSION_COOKIE = 'noobly.sid';

export class ConfigError extends Error {}

const flag = (value) => /^(1|true|yes|on)$/i.test(String(value ?? '').trim());

/**
 * AUTH_METHOD selects how people sign in: `local` (nooblyjs-core accounts; the dev picker when NOOBLY_DEV_LOGIN=true)
 * or `azure` (Microsoft Entra ID). `azure` needs AZURE_AD_CLIENT_ID and AZURE_AD_TENANT_ID, or NooblyJS falls back
 * to local sign-in and says why.
 */
function resolveAuthMethod(env) {
  const raw = (env.AUTH_METHOD || 'local').trim().toLowerCase();
  const wantsAzure = ['azure', 'ad', 'entra', 'aad', 'sso'].includes(raw);
  const knownLocal = ['local', 'file', 'passport', 'password', ''].includes(raw);
  if (wantsAzure) {
    if (env.AZURE_AD_CLIENT_ID && env.AZURE_AD_TENANT_ID) return { authMethod: 'azure', authWarning: null };
    return { authMethod: 'local', authWarning: 'AUTH_METHOD=azure but AZURE_AD_CLIENT_ID / AZURE_AD_TENANT_ID are not set: using local sign-in.' };
  }
  return { authMethod: 'local', authWarning: knownLocal ? null : `AUTH_METHOD="${raw}" is not recognised: using local sign-in. Set AUTH_METHOD=local or azure.` };
}

/**
 * Builds the frozen config from `env` (default: process.env). Throws a ConfigError, with a message
 * a person can act on, when a setting is invalid or unsafe.
 */
export function loadConfig(env = process.env, { cwd = process.cwd() } = {}) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const devLogin = flag(env.NOOBLY_DEV_LOGIN);

  if (production && devLogin) {
    throw new ConfigError(
      'NOOBLY_DEV_LOGIN=true is not allowed when NODE_ENV=production: the person picker would let anyone sign in as anyone. ' +
      'Remove NOOBLY_DEV_LOGIN, or run without NODE_ENV=production for local development.',
    );
  }

  const sessionSecret = env.SESSION_SECRET || null;
  if (production && (!sessionSecret || sessionSecret.length < 32)) {
    throw new ConfigError('SESSION_SECRET must be set to a strong value (at least 32 characters) when NODE_ENV=production.');
  }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`PORT must be a whole number from 0 to 65535, not "${env.PORT}".`);
  }

  const aiProvider = (env.AI_PROVIDER || 'mock').toLowerCase();
  if (production && aiProvider === 'anthropic') {
    throw new ConfigError('AI_PROVIDER=anthropic is for development only. In production use bedrock, vertex or azure.');
  }

  const apiRateLimit = env.API_RATE_LIMIT === undefined || env.API_RATE_LIMIT === '' ? 500 : Number(env.API_RATE_LIMIT);
  if (!Number.isInteger(apiRateLimit) || apiRateLimit < 10) {
    throw new ConfigError(`API_RATE_LIMIT must be a whole number of at least 10, not "${env.API_RATE_LIMIT}".`);
  }

  const signInRateLimit = env.SIGN_IN_RATE_LIMIT === undefined || env.SIGN_IN_RATE_LIMIT === '' ? 20 : Number(env.SIGN_IN_RATE_LIMIT);
  if (!Number.isInteger(signInRateLimit) || signInRateLimit < 1) {
    throw new ConfigError(`SIGN_IN_RATE_LIMIT must be a whole number of at least 1, not "${env.SIGN_IN_RATE_LIMIT}".`);
  }

  // The Agents Playground posts unsigned activities: accepted only in development, with dev sign-in on.
  const teamsDevUnsigned = flag(env.TEAMS_BOT_DEV_UNSIGNED);
  if (teamsDevUnsigned && (production || !devLogin)) {
    throw new ConfigError('TEAMS_BOT_DEV_UNSIGNED=true accepts unsigned Teams activities for the Agents Playground: it needs NOOBLY_DEV_LOGIN=true and is refused when NODE_ENV=production.');
  }

  const httpsEnabled = flag(env.HTTPS_ENABLED);
  return Object.freeze({
    nodeEnv,
    production,
    host: env.HOST || DEFAULT_HOST,
    port,
    dataDir: path.resolve(cwd, env.DATA_DIR || 'data'),
    devLogin,
    sessionSecret,
    httpsEnabled,
    // Secure cookies over TLS. SameSite=None (needed for Entra's cross-site form_post) requires them.
    cookieSecure: flag(env.COOKIE_SECURE) || production || httpsEnabled,
    trustProxy: env.TRUST_PROXY || null,
    publicBaseUrl: env.PUBLIC_BASE_URL || '',
    // false: an empty data folder gets the system files only, no sample story (people, teams, items, history).
    sampleData: env.NOOBLY_SAMPLE_DATA !== 'false',
    // The Microsoft sign-in also asks for User.Read, to read the person's job title from Graph (Phase 12). Off by
    // default: where the tenant wants admin consent for it, asking stops every sign-in at "Approval required".
    azureReadProfile: env.AZURE_AD_READ_PROFILE === 'true',
    // Backups of data/ (Phase 13): where they go, how many are kept, and the hour of the nightly one (local time).
    backup: Object.freeze({
      dir: env.BACKUP_DIR ? path.resolve(cwd, env.BACKUP_DIR) : '',
      keep: Math.min(Math.max(Number(env.BACKUP_KEEP) || 14, 1), 365),
      hour: Math.min(Math.max(Number.isFinite(Number(env.BACKUP_HOUR)) && env.BACKUP_HOUR !== undefined && env.BACKUP_HOUR !== '' ? Number(env.BACKUP_HOUR) : 2, 0), 23),
    }),
    aiProvider,
    logLevel: env.LOG_LEVEL || 'info',
    // Requests a signed-in person may make to /api/ in 15 minutes (Owners get four times as many, signed-out
    // callers a fifth). Live updates refetch after events, so a very busy tab is throttled in the browser first.
    // How long a scripted agent "works" before its chat reply appears (CHAT_MOCK_REPLY_MS; 0 in tests).
    chatReplyMs: Number.isFinite(Number(env.CHAT_MOCK_REPLY_MS)) && env.CHAT_MOCK_REPLY_MS !== undefined && env.CHAT_MOCK_REPLY_MS !== '' ? Math.max(0, Number(env.CHAT_MOCK_REPLY_MS)) : 1500,
    apiRateLimit,
    // Sign-in attempts from one address in 15 minutes.
    signInRateLimit,
    // Emails that become Owner when their NooblyJS record is created on first sign-in (bootstrapping the first
    // Owners). Never upgrades an existing record. Everyone else starts with roles.yaml's newPersonRole.
    owners: Object.freeze(String(env.NOOBLY_OWNERS ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'))),
    ...resolveAuthMethod(env),
    // The Teams bot (Phase 12): its Entra app, which Teams' tokens are checked against and replies are sent as.
    teams: Object.freeze({
      appId: env.TEAMS_BOT_APP_ID || null,
      secret: env.TEAMS_BOT_APP_SECRET || null,
      tenantId: env.TEAMS_BOT_TENANT_ID || null,
      devUnsigned: teamsDevUnsigned,
      devPerson: teamsDevUnsigned ? (env.TEAMS_BOT_DEV_PERSON || 'stevie') : null,
    }),
    // Microsoft Graph, app-only (Phase 12): approval emails sent from MS_GRAPH_SENDER's mailbox.
    graph: Object.freeze({
      tenantId: env.MS_GRAPH_TENANT_ID || env.AZURE_AD_TENANT_ID || null,
      clientId: env.MS_GRAPH_CLIENT_ID || null,
      secret: env.MS_GRAPH_CLIENT_SECRET || null,
      sender: env.MS_GRAPH_SENDER || null,
    }),
    // Development tools (Phase 11), read only. The Bitbucket user is the Atlassian account email: BITBUCKET_EMAIL,
    // else BITBUCKET_USERNAME when it is an email, else the Jira account (the same Atlassian account).
    devtools: Object.freeze({
      // Writing (Phase 13) is off unless DEVTOOLS_WRITES=true, and uses its own tokens: the read tokens never write.
      writes: env.DEVTOOLS_WRITES === 'true',
      syncMinutes: Math.min(Math.max(Number(env.DEVTOOLS_SYNC_MINUTES) || 5, 1), 120),
      jira: Object.freeze({ site: env.JIRA_SITE || '', email: env.JIRA_USERNAME || '', token: env.JIRA_API_TOKEN || '', writeToken: env.JIRA_WRITE_API_TOKEN || '' }),
      bitbucket: Object.freeze({
        workspace: env.BITBUCKET_WORKSPACE || 'acme',
        email: env.BITBUCKET_EMAIL || (String(env.BITBUCKET_USERNAME ?? '').includes('@') ? env.BITBUCKET_USERNAME : env.JIRA_USERNAME) || '',
        token: env.BITBUCKET_API_TOKEN || '',
        writeToken: env.BITBUCKET_WRITE_API_TOKEN || '',
      }),
    }),
    services: Object.freeze({
      cache: (env.CACHING_SERVICE || 'memory').toLowerCase(),
      search: (env.SEARCH_SERVICE || 'memory').toLowerCase(),
      queue: (env.QUEUE_SERVICE || 'memory').toLowerCase(),
    }),
  });
}
