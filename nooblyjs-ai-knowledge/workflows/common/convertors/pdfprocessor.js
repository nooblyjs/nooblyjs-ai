/**
 * @fileoverview PDF to Markdown converter (delegating shim).
 *
 * Single source of truth: re-exports the application's PDF converter from the
 * sibling `nooblyjs-ai-knowledge` repo
 * (`backend/src/shared/processors/pdfprocessor`). That copy is a *pure*
 * converter — it returns markdown and, unlike the old local copy, does NOT write
 * a stray sibling `.md` next to the source (the caller decides where to persist).
 *
 * Keeps both ingest routes (wiki sidecar pipeline and the workflow steps) on the
 * exact same converter. The cross-repo require mirrors the pattern already used
 * by clean-document.js (→ backend/src/shared/ai/expertResolver).
 *
 * @author NooblyJS Team
 * @version 2.0.0
 */

'use strict';

module.exports = require('../../../src/shared/processors/pdfprocessor');
