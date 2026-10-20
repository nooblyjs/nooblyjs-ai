// Playwright for the Infrastructure story (roadmap Phase 9a: nooblyjs-ai-infrastructure hosted at /infrastructure).
// It runs on its own fresh NooblyJS, because it approves a design, pauses provisioning and destroys an environment.
// The mock provisioner takes about 3 seconds a run here, so progress can be seen moving. `npm run test:e2e` runs it last.
import { defineConfig } from '@playwright/test';

const PORT = 11294;

export default defineConfig({
  testDir: '.',
  testMatch: 'infrastructure.story.js',
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', trace: 'retain-on-failure' },
  outputDir: '../../.temp/test-results/e2e-infrastructure',
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
      E2E_INFRA: 'true', INFRA_MOCK_STEP_MS: '300', INFRA_SWEEP_CHECK_MS: '1000',
    },
  },
});
