/**
 * @fileoverview DOCX to Markdown converter (delegating shim).
 *
 * Single source of truth: this re-exports the application's structured DOCX
 * converter from the sibling `digital-technologies-knowledge` repo
 * (`backend/src/shared/processors/docxprocessor`). That converter goes
 * Mammoth → HTML → structured JSON → markdown, so it preserves table grids,
 * heading hierarchy, lists and images — unlike Mammoth's markdown writer, which
 * flattens tables into loose paragraphs.
 *
 * Both ingest routes now share the exact same converter:
 *   - wiki filesystem drop  → FileWatcher sidecar pipeline (knowledge repo)
 *   - wiki UI drag-and-drop → "Design: Convert File" workflow (this step)
 *
 * The cross-repo require mirrors the pattern already used by the workflow steps
 * (e.g. clean-document.js → backend/src/shared/ai/expertResolver). The knowledge
 * repo is expected as a sibling; the step loaders that require this module are
 * defensive (try/catch) and degrade to "unsupported" if it is ever absent.
 *
 * @author Digital Technologies Team
 * @version 2.0.0
 */

'use strict';

module.exports = require('../../../src/shared/processors/docxprocessor');
