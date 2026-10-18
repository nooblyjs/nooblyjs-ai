// Settings: dev login is refused in production, and bad values are explained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError, DEFAULT_PORT } from '../src/config.js';

test('defaults: 127.0.0.1:DEFAULT_PORT, ./data, dev login off, mock AI', () => {
  const c = loadConfig({}, { cwd: '/srv/noobly' });
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, DEFAULT_PORT);
  assert.equal(c.devLogin, false);
  assert.equal(c.aiProvider, 'mock');
  assert.match(c.dataDir, /data$/);
});

test('refuses NOOBLY_DEV_LOGIN=true when NODE_ENV=production, and says why', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', NOOBLY_DEV_LOGIN: 'true' }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /NOOBLY_DEV_LOGIN.*NODE_ENV=production/);
    return true;
  });
});

test('refuses the direct Anthropic API in production, and bad ports', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), AI_PROVIDER: 'anthropic' }), /AI_PROVIDER=anthropic/);
  assert.throws(() => loadConfig({ PORT: 'eighty' }), /PORT must be/);
  assert.equal(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) }).cookieSecure, true);
});

test('production needs a strong SESSION_SECRET', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /SESSION_SECRET must be set/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' }), /SESSION_SECRET must be set/);
});

test('AUTH_METHOD=azure without the Entra settings falls back to local, and says why', () => {
  const c = loadConfig({ AUTH_METHOD: 'azure' });
  assert.equal(c.authMethod, 'local');
  assert.match(c.authWarning, /AZURE_AD_CLIENT_ID/);
  assert.equal(loadConfig({ AUTH_METHOD: 'azure', AZURE_AD_CLIENT_ID: 'id', AZURE_AD_TENANT_ID: 'tenant' }).authMethod, 'azure');
});

test('AUTH_METHOD=google without the Google settings falls back to local, and says why', () => {
  const c = loadConfig({ AUTH_METHOD: 'google', GOOGLE_AUTH_CLIENTID: 'id' });
  assert.equal(c.authMethod, 'local');
  assert.match(c.authWarning, /GOOGLE_AUTH_SECRET/);
  const google = loadConfig({ AUTH_METHOD: 'Google', GOOGLE_AUTH_CLIENTID: 'id', GOOGLE_AUTH_SECRET: 'secret', GOOGLE_AUTH_BASE_URL: 'https://noobly.example/' });
  assert.equal(google.authMethod, 'google');
  assert.equal(google.google.baseUrl, 'https://noobly.example');
});

test('app.js refuses to start with dev login in production', () => {
  const run = spawnSync(process.execPath, ['app.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'production', NOOBLY_DEV_LOGIN: 'true', PORT: '0' },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /NooblyJS refused to start: NOOBLY_DEV_LOGIN=true is not allowed/);
});
