// Playwright for the Platform story (roadmap Phase 9: Platform and governance, the six steps of its test script).
// It runs on its own fresh NooblyJS, because it pauses agents, turns a guardrail off and stops every container.
// `npm run test:e2e` runs it after the Knowledge story.
import { defineConfig } from '@playwright/test';

const PORT = 11295;

export default defineConfig({
  testDir: '.',
  testMatch: 'platform.story.js',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', trace: 'retain-on-failure' },
  outputDir: '../../.temp/test-results/e2e-platform',
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
    },
  },
});
