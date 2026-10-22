// Playwright for the pages built in Phases 25a–26 (customer evidence, objectives and the roadmap, team capacity,
// Infrastructure's drafting agent), in a real browser with axe and phone width. It runs on its own fresh NooblyJS with
// Infrastructure hosted, because it logs feedback, moves items on the roadmap and drafts a design.
import { defineConfig } from '@playwright/test';

const PORT = 11293;

export default defineConfig({
  testDir: '.',
  testMatch: 'customers.story.js',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', trace: 'retain-on-failure' },
  outputDir: '../../.temp/test-results/e2e-customers',
  webServer: {
    command: 'node test/e2e/serve.js',
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'development', NOOBLY_DEV_LOGIN: 'true', HTTPS_ENABLED: 'false',
      AUTH_METHOD: 'local', LOG_LEVEL: 'warn', CACHING_SERVICE: 'memory', SEARCH_SERVICE: 'memory', QUEUE_SERVICE: 'memory',
      NOOBLY_OWNERS: '', AI_PROVIDER: 'mock', API_RATE_LIMIT: '20000', SIGN_IN_RATE_LIMIT: '200', CHAT_MOCK_REPLY_MS: '700',
      E2E_INFRA: 'true', INFRA_MOCK_STEP_MS: '0',
    },
  },
});
