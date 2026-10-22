// Playwright for the stories that carry one item a long way (roadmap Phase 5: PRD-031 from signal to the Software
// Factory). Each `*.story.js` runs on its own fresh NooblyJS and seed, because it changes what the other specs rely on.
// `npm run test:e2e` runs the specs first, then these.
import { defineConfig } from '@playwright/test';

const PORT = 11298;

export default defineConfig({
  testDir: '.',
  testMatch: '*.story.js',
  testIgnore: ['software-factory.story.js', 'knowledge.story.js', 'platform.story.js', 'infrastructure.story.js', 'customers.story.js'], // each has its own config and its own NooblyJS
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', trace: 'retain-on-failure' },
  outputDir: '../../.temp/test-results/e2e-story',
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
