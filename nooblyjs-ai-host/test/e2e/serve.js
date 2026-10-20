// Starts NooblyJS for the e2e tests on a fresh temp DATA_DIR, with the stub apps enabled. Playwright runs it as its
// webServer. Settings come from the environment Playwright passes (they win over .env).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../app.js';
import { seedFiles } from '../../src/seed/index.js';
import { pinClock } from '../helpers.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

// The Software Factory is always hosted: the Product Factory is its Product section (/factory/product) since 2026-10-19.
// Infrastructure only for its story (E2E_INFRA): hosted, it adds two approvals to Stevie's list, and the Home specs
// count the Phase 2 story's four. The wiki only with E2E_WIKI.
// No e2e run calls a model: with the mock, agents answer from their scripts (tech.md §11).
process.env.AI_PROVIDER = 'mock';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-e2e-'));
const store = new FsStore(dataDir);
// On the seed story's weekday, whatever day the run is (BUG-001): the dev clock is moved there before NooblyJS starts.
await seedFiles(store, { now: await pinClock(store) });
await store.writeYaml(['config', 'hosted-apps.yaml'], {
  apps: [
    { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
    { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: process.env.E2E_INFRA === 'true' },
    { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
    { package: 'nooblyjs-ai-knowledge', mountPath: '/wiki', enabled: process.env.E2E_WIKI === 'true' },
    { path: 'test/fixtures/hello-app', mountPath: '/hello', enabled: true },
    { path: 'test/fixtures/throwing-app', mountPath: '/throwing', enabled: true },
  ],
});

const config = loadConfig({ ...process.env, DATA_DIR: dataDir });
const noobly = await createApp({ config });
const server = noobly.app.listen(config.port, config.host, () => console.log(`e2e NooblyJS on http://${config.host}:${config.port} (data: ${dataDir})`));
const stop = async () => {
  server.close();
  await noobly.close();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
