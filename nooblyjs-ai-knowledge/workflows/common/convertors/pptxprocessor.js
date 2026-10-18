/**
 * @fileoverview PPTX to Markdown converter (delegating shim).
 *
 * Single source of truth: re-exports the application's PPTX converter from the
 * sibling `nooblyjs-ai-knowledge` repo
 * (`backend/src/shared/processors/pptxprocessor`). Its `convertToMarkdown(src,
 * outputMdPath)` signature is preserved (the convert-document step passes the
 * output path for presentations).
 *
 * Note: the underlying `pptx-parser` needs a browser `window` and fails to load
 * under Node — so this module throws at require time and the step loaders (which
 * wrap the require in try/catch) degrade PPTX to "unsupported", exactly as the
 * previous local copy did.
 *
 * @author NooblyJS Team
 * @version 2.0.0
 */

'use strict';

module.exports = require('../../../src/shared/processors/pptxprocessor');
