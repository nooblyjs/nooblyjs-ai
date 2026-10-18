/**
 * @fileoverview Helpers for turning a person's full name into the values the
 * dashboards need: the dashboard file name and the greeting first name.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 2026-06-08
 */

'use strict';

const fs = require('node:fs');

/**
 * Load the name -> email-prefix map from a JSON config file. The file is either
 * a flat `{ name: prefix }` object or `{ "_README": "...", "people": {...} }`.
 * Returns a plain `{ name: prefix|string[] }` object ({} when absent/unreadable
 * so callers degrade to the derived stem).
 *
 * @param {string} file - Path to the people-emails JSON
 * @returns {Object<string, string|string[]>}
 */
function loadEmailMap(file) {
   if (!file || !fs.existsSync(file)) return {};
   try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const people = parsed && parsed.people ? parsed.people : parsed;
      const out = {};
      for (const [name, value] of Object.entries(people || {})) {
         if (name === '_README') continue;
         out[name] = value;
      }
      return out;
   } catch (error) {
      return {};
   }
}

/**
 * Resolve the dashboard file prefixes (email local-parts) for a person. When the
 * name is in the map its mapped prefix(es) win — a person with several login
 * emails gets one file per prefix. Otherwise falls back to the derived stem.
 *
 * @param {string} fullName
 * @param {Object<string, string|string[]>} [emailMap]
 * @returns {string[]} one or more lower-cased prefixes (deduped, non-empty)
 */
function dashboardPrefixes(fullName, emailMap) {
   const name = String(fullName == null ? '' : fullName).trim();
   const mapped = emailMap && Object.prototype.hasOwnProperty.call(emailMap, name)
      ? emailMap[name]
      : null;

   let prefixes;
   if (mapped != null && mapped !== '') {
      prefixes = (Array.isArray(mapped) ? mapped : [mapped])
         .map((p) => String(p).trim().toLowerCase())
         .filter(Boolean);
   } else {
      const stem = dashboardFileName(name);
      prefixes = stem ? [stem] : [];
   }
   return Array.from(new Set(prefixes));
}

/**
 * Build the dashboard file stem for a person: first character of the first name
 * followed by the last name, all lower case, stripped of anything that is not a
 * letter or digit.
 *
 *   "Debbie Cunningham"   -> "dcunningham"
 *   "Zsa-Jacques Clausen" -> "zclausen"
 *   "Stephen Booysen"     -> "sbooysen"
 *
 * @param {string} fullName
 * @returns {string} the file stem, or "" when the name is empty/unusable
 */
function dashboardFileName(fullName) {
   const parts = String(fullName == null ? '' : fullName).trim().split(/\s+/).filter(Boolean);
   if (parts.length === 0) return '';
   const first = parts[0];
   const last = parts.length > 1 ? parts[parts.length - 1] : '';
   const stem = (first.charAt(0) + last).toLowerCase().replace(/[^a-z0-9]/g, '');
   return stem;
}

/**
 * The greeting first name — the first whitespace-delimited token of the name.
 *
 *   "Debbie Cunningham" -> "Debbie"
 *
 * @param {string} fullName
 * @returns {string}
 */
function firstName(fullName) {
   const parts = String(fullName == null ? '' : fullName).trim().split(/\s+/).filter(Boolean);
   return parts[0] || '';
}

module.exports = {
   dashboardFileName,
   dashboardPrefixes,
   loadEmailMap,
   firstName,
};
