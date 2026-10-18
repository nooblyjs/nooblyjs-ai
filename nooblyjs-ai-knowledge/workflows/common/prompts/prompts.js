/**
 * @fileoverview Prompt library access for workflow steps and services (delegating shim).
 *
 * Single source of truth: this re-exports the platform's prompt store from the
 * sibling `nooblyjs-ai-knowledge` repo
 * (`backend/src/shared/prompts/promptStore`). Prompts are authored in the
 * datasources app (AI → Prompts) and read back here by KEY:
 *
 *     const { prompts } = require('../../common/prompts/prompts');
 *     const system = prompts.get('document-cleaning');
 *     const system = prompts.get('document-summary', { maxChars: 500 });
 *
 * That store was built for exactly this consumer: it has zero app dependencies,
 * resolves its file off `<appBaseDir>/configuration/prompts/prompts.json`, and
 * reads SYNCHRONOUSLY with an mtime-invalidated cache — so it works inside a
 * workflow worker thread (where `global.*` from the backend bootstrap does not
 * exist), and a prompt edited in the UI is live on the next `get()` with no
 * restart. Same rationale as `folderExpert` reading `settings-agents.json`.
 *
 * `get()` THROWS on an unknown key rather than returning an empty system prompt,
 * which would produce plausible-looking but ungrounded output. Use `getOr()`
 * where a missing prompt should degrade instead of stopping the run.
 *
 * The cross-repo require mirrors the pattern already used by the convertor shims
 * and the steps (e.g. `backend/src/shared/ai/expertResolver`). The knowledge repo
 * is expected as a sibling.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const {
  PromptStore, prompts, configure, applyVariables, slugify
} = require('../../../src/shared/prompts/promptStore');

/**
 * Build a prompt library bound to a specific application base directory.
 *
 * Steps that have already resolved an `appBaseDir` should use this and pass the
 * result to their service, so the prompts come from the same `.application` the
 * agents and spaces do — rather than relying on APP_BASE_DIR reaching the worker.
 * Missing built-in prompts are backfilled here, so a standalone run against a
 * store written by an older release still finds every key the code reads.
 *
 * @param {string} [appBaseDir] - Application base dir; omit to use APP_BASE_DIR.
 * @returns {PromptStore} A store exposing get()/getOr()/render().
 */
function libraryFor(appBaseDir) {
  const store = new PromptStore(appBaseDir ? { appBaseDir } : {});
  store.ensureDefaults();
  return store;
}

module.exports = {
  prompts,
  libraryFor,
  PromptStore,
  configure,
  applyVariables,
  slugify,
};
