/**
 * @fileoverview An empty AI completion must fail, never pass as an answer.
 *
 * Regression cover for silent corpus rot. A reasoning model (gpt-5 family,
 * o-series) bills hidden reasoning tokens against the completion budget, so a cap
 * that is too small is spent thinking and the provider answers HTTP 200 with
 * `content: ''` and no error. FolderExpert used to hand that empty string back,
 * ContextProcessor persisted it as the literal string "(summary unavailable)",
 * and the workflow reported success — 1,018 of 5,710 context sidecars had rotted
 * to the placeholder on one deployment before anyone noticed, and because a
 * manual Regenerate passes `force: true`, each failure OVERWROTE a good summary.
 *
 * Raising the empty completion inside the retry means a transient blank gets
 * another attempt, and a persistent one fails loudly with the token counts that
 * name the cause.
 *
 * Lives in this repo (not the workflows repo, which has no jest) following the
 * cross-repo precedent set by convertDocument.test.js.
 */

'use strict';

// Stub the core registry BEFORE folderExpert is loaded. Importing
// digital-technologies-core constructs a SystemMonitoring singleton at module
// scope, which starts a 1s interval plus a self-rescheduling setImmediate — open
// handles that keep the whole jest run alive after the tests finish. The registry
// is only reached from resolveInstance(), which these tests bypass by injecting
// the AI instance, so an empty module is enough. Both repos resolve the package
// to the same physical directory, so this intercepts folderExpert's own require.
// (No babel transform here, so the mock is registered by call order, not hoisting
// — it must stay above the require below.)
jest.mock('nooblyjs-core', () => ({}));

const FolderExpert = require(
  '../../../workflows/system-context/services/folderExpert.js');

/** Silent logger — retry() logs a warning per failed attempt. */
const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * An expert wired to a stub provider, with the retry backoff collapsed so the
 * failure path doesn't cost the suite six seconds.
 * @param {Array<*>} responses - Returned per call; the last repeats.
 * @param {Object} [options]
 * @returns {{expert: Object, calls: Array<string>}}
 */
function makeExpert(responses, options = {}) {
  const calls = [];
  const expert = new FolderExpert({
    appBaseDir: 'unused — the instance is injected',
    logger: quietLogger,
    retries: options.retries != null ? options.retries : 2,
    retryDelayMs: 1
  });

  // resolveInstance() short-circuits on a cached instance, so this never reads
  // settings-agents.json or touches the network.
  expert._instance = {
    prompt: async (combined) => {
      calls.push(combined);
      const idx = Math.min(calls.length - 1, responses.length - 1);
      return responses[idx];
    }
  };

  return { expert, calls };
}

describe('FolderExpert.prompt — empty completions', () => {
  test('returns the model text when there is any', async () => {
    const { expert, calls } = makeExpert([{ content: 'A tidy summary.' }]);

    await expect(expert.prompt('system', 'user')).resolves.toBe('A tidy summary.');
    expect(calls).toHaveLength(1);
  });

  test('an empty completion is retried, then raised — never returned', async () => {
    const { expert, calls } = makeExpert([{ content: '' }], { retries: 3 });

    await expect(expert.prompt('system', 'user')).rejects.toThrow(/empty completion/i);
    expect(calls).toHaveLength(3); // every attempt used
  });

  test('a whitespace-only completion counts as empty', async () => {
    const { expert } = makeExpert([{ content: '   \n\t  ' }]);

    await expect(expert.prompt('system', 'user')).rejects.toThrow(/empty completion/i);
  });

  test('a transient blank is recovered by the retry', async () => {
    const { expert, calls } = makeExpert([{ content: '' }, { content: 'Second time lucky.' }]);

    await expect(expert.prompt('system', 'user')).resolves.toBe('Second time lucky.');
    expect(calls).toHaveLength(2);
  });

  test('the error carries the token counts that explain the blank', async () => {
    // The shape the failure actually takes: the completion count sits exactly on
    // the model's cap because reasoning consumed the whole budget.
    const { expert } = makeExpert([{
      content: '',
      usage: { promptTokens: 1543, completionTokens: 1000, totalTokens: 2543 }
    }]);

    await expect(expert.prompt('system', 'user')).rejects.toThrow(/1543 prompt \/ 1000 completion tokens/);
    await expect(expert.prompt('system', 'user')).rejects.toThrow(/maxtokens/);
  });

  test('a bare string response is still accepted', async () => {
    const { expert } = makeExpert(['not wrapped in an object']);

    await expect(expert.prompt('system', 'user')).resolves.toBe('not wrapped in an object');
  });

  test('a null response fails rather than becoming an empty summary', async () => {
    const { expert } = makeExpert([null]);

    await expect(expert.prompt('system', 'user')).rejects.toThrow(/empty completion/i);
  });
});
