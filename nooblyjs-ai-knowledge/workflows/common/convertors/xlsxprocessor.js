/**
 * @fileoverview XLSX to Markdown converter (delegating shim).
 *
 * Single source of truth: re-exports the application's XLSX converter from the
 * sibling `digital-technologies-knowledge` repo
 * (`backend/src/shared/processors/xlsxprocessor`), so the wiki sidecar pipeline
 * and the workflow steps share one converter.
 *
 * The cross-repo require mirrors the pattern already used by clean-document.js
 * (→ backend/src/shared/ai/expertResolver).
 *
 * @author Digital Technologies Team
 * @version 2.0.0
 */

'use strict';

module.exports = require('../../../src/shared/processors/xlsxprocessor');
