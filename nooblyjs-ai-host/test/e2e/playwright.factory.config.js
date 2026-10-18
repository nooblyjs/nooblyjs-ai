// Playwright for the Software Factory story (roadmap Phase 7: PRD-028's handoff becomes runs on the demo repository).
// It runs on its own fresh NooblyJS with the Factory hosted (E2E_FACTORY), because its runs do real work and the other
// story's handoff would start runs of its own. `npm run test:e2e` runs the specs, the stories, then this.
import { defineConfig } from '@playwright/test';

const PORT = 11297;

export default defineConfig({
  testDir: '.',
  testMatch: 'software-factory.story.js',
  workers: 1,
  timeout: 420_000, // the Software Factory story waits for real runs (git, a test gate)
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', trace: 'retain-on-failure' },
  outputDir: '../../.temp/test-results/e2e-factory',
  webServer: {
    command: 'node test/e2e/serve.js',
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'development', NOOBLY_DEV_LOGIN: 'true', HTTPS_ENABLED: 'false',
      AUTH_METHOD: 'local', LOG_LEVEL: 'warn', CACHING_SERVICE: 'memory', SEARCH_SERVICE: 'memory', QUEUE_SERVICE: 'memory',
      NOOBLY_OWNERS: '', AI_PROVIDER: 'mock', E2E_FACTORY: 'true', API_RATE_LIMIT: '20000', SIGN_IN_RATE_LIMIT: '200', CHAT_MOCK_REPLY_MS: '700',
    },
  },
});
