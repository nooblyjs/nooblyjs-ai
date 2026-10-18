/**
 * @fileoverview Walk a content repository, find every business-solution home
 * page, and extract the data the dashboards are built from.
 *
 * The walk starts at `contentfolder` and recurses every sub-folder looking for
 * `.home.md` files. A `.home.md` that carries a ```document``` block is a
 * business solution; its block (owner roles, roadmap id) and body Status table
 * (Current / Future / Pace Layer) are lifted into a flat record. Pages without
 * a document block (section landing pages, the repo root home) are skipped.
 *
 * The resulting records are cached to a JSON file so the content builder can run
 * as a separate step without re-walking the tree.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 2026-06-08
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { glob } = require('glob');

const { parseHomePage } = require('../utilities/markdownDocument.js');

/**
 * The document-block keys the dashboards rely on, mapped to the record field
 * names. Keeping this in one place documents exactly which metadata is consumed.
 */
const FIELD_MAP = {
   roadmap: 'Roadmap',
   businessSolution: 'Business solution',
   solutionsArchitect: 'Solutions Architect',
   hod: 'HOD',
   responsibleExecutive: 'Responsible Executive',
   businessOwner: 'Business Owner',
};

class DashboardDataClass {

   /**
    * @param {Object} settings
    * @param {string[]} settings.contentfolders - Root folders to walk for `.home.md`
    * @param {string} settings.cachefile - Path to write the records cache
    */
   constructor(settings) {
      this.settings = settings || {};
   }

   /**
    * Walk every configured content folder, parse each business-solution home
    * page, and return the aggregated flat solution records. A person's solutions
    * can live across more than one content repository, so the records from all
    * folders are merged before the dashboards are built. Also writes the records
    * to the cache file.
    *
    * @returns {Promise<Array<Object>>} the solution records
    */
   async retrieve() {
      const contentfolders = (this.settings.contentfolders || []).filter(Boolean);
      if (contentfolders.length === 0) {
         throw new Error('Dashboards: no content folders configured.');
      }

      const records = [];
      for (const contentfolder of contentfolders) {
         if (!fs.existsSync(contentfolder)) {
            console.warn('Dashboards: content folder does not exist, skipping:', contentfolder);
            continue;
         }
         // Find every `.home.md` beneath the content folder. `dot: true` is
         // required because the file (and many of its folders) are dot-prefixed.
         const pattern = path.join(contentfolder, '**', '.home.md').replace(/\\/g, '/');
         const files = await glob(pattern, { dot: true });
         for (const file of files) {
            const parsed = this._parseFile(file);
            if (parsed) records.push(parsed);
         }
      }

      this._writeCache(records);
      return records;
   }

   /**
    * Parse a single `.home.md` into a solution record, or null when the page is
    * not a business solution (no document block) or cannot be read.
    *
    * @private
    * @param {string} file
    * @returns {Object|null}
    */
   _parseFile(file) {
      let markdown;
      try {
         markdown = fs.readFileSync(file, 'utf8');
      } catch (error) {
         console.error('Dashboards: could not read', file, error.message);
         return null;
      }

      const parsed = parseHomePage(markdown);
      if (!parsed) return null; // not a business solution

      const doc = parsed.document;
      const record = { sourcePath: file };
      for (const [field, key] of Object.entries(FIELD_MAP)) {
         record[field] = (doc[key] || '').trim();
      }
      record.current = parsed.status.current || '';
      record.future = parsed.status.future || '';
      record.paceLayer = parsed.status.paceLayer || '';

      // A record is only useful when it names a solution.
      if (!record.businessSolution) return null;
      return record;
   }

   /**
    * Persist the records to the cache file (pretty JSON).
    *
    * @private
    * @param {Array<Object>} records
    */
   _writeCache(records) {
      const cachefile = this.settings.cachefile;
      if (!cachefile) return;
      fs.mkdirSync(path.dirname(cachefile), { recursive: true });
      fs.writeFileSync(cachefile, JSON.stringify(records, null, 2));
   }

   /**
    * Read the records back from the cache file. Returns null when absent so the
    * caller can decide to re-walk.
    *
    * @returns {Array<Object>|null}
    */
   readCache() {
      const cachefile = this.settings.cachefile;
      if (!cachefile || !fs.existsSync(cachefile)) return null;
      try {
         return JSON.parse(fs.readFileSync(cachefile, 'utf8'));
      } catch (error) {
         return null;
      }
   }
}

module.exports = DashboardDataClass;
