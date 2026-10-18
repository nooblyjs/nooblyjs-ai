/**
 * @fileoverview Read a wiki `.home.md` page into a structured object.
 *
 * Each business-solution home page carries a fenced ```document``` block of
 * key/value metadata (owner roles, roadmap id, …) plus a body "Status" table
 * that holds the solution's Current / Future / Pace Layer lifecycle values.
 *
 * This helper uses the `marked` lexer (a small, free, well-maintained markdown
 * parser) to turn the raw markdown into tokens, then lifts the two pieces the
 * dashboards need out of those tokens:
 *
 *   1. the ```document``` code token  -> a flat key/value object
 *   2. the Status table token         -> { current, future, paceLayer }
 *
 * Parsing markdown -> objects (rather than hand-rolling regexes over the raw
 * text) keeps the extraction resilient to incidental whitespace and ordering.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 2026-06-08
 */

'use strict';

const { lexer } = require('marked');

/**
 * Split a ```document``` block body into a flat key/value map.
 *
 * Lines look like `Solutions Architect: Franco Austin`. Blank lines and lines
 * without a colon are ignored. Keys keep their original casing/spacing so the
 * caller can read `doc['Responsible Executive']` directly.
 *
 * @param {string} text - The raw text inside the document block
 * @returns {Object<string,string>} key -> value
 */
function parseDocumentBlock(text) {
   const out = {};
   for (const line of String(text || '').split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) out[key] = value;
   }
   return out;
}

/**
 * Strip the markdown emphasis the Status table wraps its labels in
 * (e.g. `****Current****`) and trim, so labels/values compare cleanly.
 *
 * @param {string} cell
 * @returns {string}
 */
function cleanCell(cell) {
   return String(cell == null ? '' : cell).replace(/\*+/g, '').trim();
}

/**
 * Pull the lifecycle values out of a parsed markdown `table` token whose rows
 * are `| Field | Value |` pairs (Current, Future, Pace Layer).
 *
 * @param {Object} tableToken - A marked `table` token
 * @param {Object} into - The status object to populate
 */
function readStatusTable(tableToken, into) {
   if (!tableToken || !Array.isArray(tableToken.rows)) return;
   for (const row of tableToken.rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const field = cleanCell(row[0].text).toLowerCase();
      const value = cleanCell(row[1].text);
      if (field === 'current') into.current = value;
      else if (field === 'future') into.future = value;
      else if (field === 'pace layer') into.paceLayer = value;
   }
}

/**
 * Parse a `.home.md` page into the structured pieces the dashboards consume.
 *
 * Returns `null` when the page carries no ```document``` block — those pages
 * (section landing pages, the repo root home, …) are not business solutions and
 * are skipped by the walker.
 *
 * @param {string} markdown - The full markdown contents of a `.home.md` file
 * @returns {{document: Object<string,string>, status: Object}|null}
 */
function parseHomePage(markdown) {
   let tokens;
   try {
      tokens = lexer(String(markdown || ''));
   } catch (error) {
      return null;
   }

   const docToken = tokens.find((t) => t.type === 'code' && t.lang === 'document');
   if (!docToken) return null;

   const status = { current: '', future: '', paceLayer: '' };
   for (const token of tokens) {
      if (token.type === 'table') readStatusTable(token, status);
   }

   return {
      document: parseDocumentBlock(docToken.text),
      status,
   };
}

module.exports = {
   parseHomePage,
   parseDocumentBlock,
};
