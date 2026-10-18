// Playwright for the Knowledge story (roadmap Phase 8: the Wiki Platform hosted at /wiki, with the sample export).
// It runs on its own fresh NooblyJS with the wiki hosted (E2E_WIKI): the wiki starts file watchers and a search index,
// and the other specs expect its rail entry to be a stub. `npm run test:e2e` runs this last.
import { defineConfig } from '@playwright/test';

const PORT = 11296;

export default defineConfig({
  testDir: '.',
  testMatch: 'knowledge.story.js',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', trace: 'retain-on-failure' },
  outputDir: '../../.temp/test-results/e2e-knowledge',
  webServer: {
    command: 'node test/e2e/serve.js',
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 180_000, // the wiki loads its workflows and builds its index at start
    env: {
      PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'development', NOOBLY_DEV_LOGIN: 'true', HTTPS_ENABLED: 'false',
      AUTH_METHOD: 'local', LOG_LEVEL: 'warn', CACHING_SERVICE: 'memory', SEARCH_SERVICE: 'memory', QUEUE_SERVICE: 'memory',
      NOOBLY_OWNERS: '', AI_PROVIDER: 'mock', E2E_WIKI: 'true', API_RATE_LIMIT: '20000', SIGN_IN_RATE_LIMIT: '200', CHAT_MOCK_REPLY_MS: '700',
    },
  },
});
