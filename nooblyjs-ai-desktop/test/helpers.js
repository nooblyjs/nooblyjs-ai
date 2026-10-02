'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY'];
const BASE_URLS = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GEMINI_BASE_URL', 'DEEPSEEK_BASE_URL'];

// config caches DATA_DIR at require time, so every test process points at a
// fresh temp directory before anything under src/ is loaded. Provider keys are
// cleared too, so a developer's real .env cannot change what the tests assert.
function useTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmproj-test-'));
  process.env.DATA_DIR = dir;
  process.env.NOOBLY_DIR = path.join(dir, '.noobly-core');
  // Set to empty rather than delete: dotenv skips keys already present in the
  // environment, so this also stops a real .env from being loaded over the top.
  for (const name of [...PROVIDER_KEYS, ...BASE_URLS]) process.env[name] = '';
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { useTempDataDir, cleanup };
