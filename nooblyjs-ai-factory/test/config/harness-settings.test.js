// Phase F02/F04: the harness settings an agent's workspace gets: sandbox, the deny rules no repo can lift, the Stop hook.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ALWAYS_DENY, harnessSettingsFor } from '../../src/config/harness-settings.js';
import { parseRepoConfig } from '../../src/config/repo-config.js';

test('sandboxed, with the repo\'s network, and git push / remote / config / gh always denied', () => {
  const settings = harnessSettingsFor(parseRepoConfig(JSON.stringify({ network: ['registry.npmjs.org'] })));
  assert.deepEqual(settings.sandbox, { enabled: true, network: ['registry.npmjs.org'] });
  assert.deepEqual(settings.permissions.deny, ALWAYS_DENY);
  assert.ok(ALWAYS_DENY.includes('Bash(git push:*)'));
  assert.equal('hooks' in settings, false, 'no gates file → no Stop hook');
});

test('the deny list is a copy: changing one workspace\'s settings never changes the next', () => {
  const a = harnessSettingsFor(parseRepoConfig(null));
  a.permissions.deny.length = 0;
  assert.deepEqual(harnessSettingsFor(parseRepoConfig(null)).permissions.deny, ALWAYS_DENY);
});

test('fast gates + a gates file → a Stop hook that runs the stop-hook script, with time for every fast gate', () => {
  const config = parseRepoConfig(JSON.stringify({ gates: { lint: { command: 'npm run lint', timeoutMs: 20_000 }, test: { command: 'npm test', fast: false } } }));
  const [hook] = harnessSettingsFor(config, { gatesFile: '/tmp/gates.json' }).hooks.Stop;
  assert.equal(hook.timeout, 30, 'only the fast gate counts: 20 s + 10 s');
  assert.match(hook.command, /stop-hook\.js" "\/tmp\/gates\.json"$/);
  const script = hook.command.match(/"([^"]*stop-hook\.js)"/)[1];
  assert.ok(fs.existsSync(script), `the hook script exists: ${script}`);
  assert.equal(path.basename(path.dirname(script)), 'gates');
});

test('no fast gates → no hook, even with a gates file', () => {
  const config = parseRepoConfig(JSON.stringify({ gates: { test: { command: 'npm test', fast: false } } }));
  assert.equal('hooks' in harnessSettingsFor(config, { gatesFile: '/tmp/gates.json' }), false);
});
