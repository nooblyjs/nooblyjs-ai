/**
 * @fileoverview Build the per-person business-solution dashboards.
 *
 * The wiki space-home loader resolves a person's dashboard by their email
 * prefix — `email.split('@')[0]…` (see backend authRoutes.js) — looking for a
 * single file directly inside the `.dashboards` folder. The dashboards are
 * therefore written FLAT, one file per person, named by that prefix:
 *
 *   .dashboards/
 *     dcunningham.md   (Debbie Cunningham — dcunningham@…)
 *     gvisser.md       (Gavin Visser)
 *     xmakhubela.md    (Xivutiso Makhubela)
 *
 * The source pages only carry names, so the file stem is reconstructed from the
 * name (first initial + last name, lower-cased) — which equals the email prefix
 * for the standard address format.
 *
 * A person can relate to a solution as its Responsible Executive, its HOD or its
 * Solutions Architect. Because the loader serves one file per person, every
 * solution a person touches in ANY of those three roles is merged into their one
 * dashboard — so executives, HODs and architects all get a dashboard from the
 * same flat folder. Inside, solutions are grouped by Solutions Architect, each
 * group a Solution / Current / Future table.
 *
 * @author Digital Technologies Team
 * @version 1.1.0
 * @since 2026-06-08
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { dashboardPrefixes, loadEmailMap, firstName } = require('../utilities/people.js');

/**
 * The record fields that name a person related to a solution, with the role
 * wording shown on that person's dashboard. A record contributes itself to the
 * dashboard of whoever is named in each of these fields.
 */
const ROLE_FIELDS = [
   { field: 'responsibleExecutive', label: 'Responsible Executive' },
   { field: 'hod', label: 'HOD' },
   { field: 'solutionsArchitect', label: 'Solution Architect' },
];

class DashboardContentClass {

   /**
    * @param {Object} settings
    * @param {string[]} settings.dashboardfolders - The `.dashboards` folders to write into
    * @param {string} [settings.emailMapFile] - Path to the name->email-prefix map
    */
   constructor(settings) {
      this.settings = settings || {};
      this.emailMap = loadEmailMap(this.settings.emailMapFile);
   }

   /**
    * Build every person's dashboard from the supplied records and write the
    * resulting set into every configured `.dashboards` folder (the wiki resolves
    * a user's dashboard per space, and each space maps to one content repo).
    *
    * @param {Array<Object>} records - Solution records from DashboardDataClass
    * @returns {{files:number, people:number, byRole:Object, folders:string[]}}
    */
   build(records) {
      const dashboardfolders = (this.settings.dashboardfolders || []).filter(Boolean);
      if (dashboardfolders.length === 0) {
         throw new Error('Dashboards: no dashboard folder configured.');
      }

      const people = this._groupByPerson(records || []);

      // Render each person's markdown once, then fan it out to every prefix
      // (email local-part) and every dashboard folder.
      let files = 0;
      for (const folder of dashboardfolders) {
         // Start clean so people who no longer own any solution don't keep a
         // stale dashboard behind. Only `*.md` files are removed — the records
         // cache (a dotfile) and anything else is left alone.
         fs.mkdirSync(folder, { recursive: true });
         this._clearDashboards(folder);
      }
      for (const person of people.values()) {
         const markdown = this._renderDashboard(person);
         for (const folder of dashboardfolders) {
            for (const prefix of person.prefixes) {
               fs.writeFileSync(path.join(folder, prefix + '.md'), markdown);
               files += 1;
            }
         }
      }

      // Per-role population counts, for the run summary only.
      const byRole = {};
      for (const role of ROLE_FIELDS) {
         byRole[role.field] = Array.from(people.values())
            .filter((p) => p.roles.has(role.label)).length;
      }

      return { files, people: people.size, byRole, folders: dashboardfolders };
   }

   /**
    * Group records into one entry per person, keyed by the person's primary
    * email prefix (first prefix from the map, or the derived stem). Keying by
    * prefix (not the raw name) merges a person whose name is spelled
    * inconsistently across pages — e.g. "Luke van Wyk" vs "Luke Van Wyk" — into
    * a single dashboard instead of one spelling overwriting the other. Every
    * prefix a person resolves to (e.g. two login emails) is collected so the
    * dashboard is written under each.
    *
    * @private
    * @param {Array<Object>} records
    * @returns {Map<string,{name:string, prefixes:string[], roles:Set<string>, records:Array}>}
    */
   _groupByPerson(records) {
      const people = new Map();

      for (const record of records) {
         for (const role of ROLE_FIELDS) {
            const name = (record[role.field] || '').trim();
            if (!name) continue;
            const prefixes = dashboardPrefixes(name, this.emailMap);
            if (prefixes.length === 0) continue;
            const primary = prefixes[0];

            let person = people.get(primary);
            if (!person) {
               person = { name, prefixes: [], roles: new Set(), records: [], _seen: new Set(), _pre: new Set() };
               people.set(primary, person);
            }
            person.roles.add(role.label);
            for (const p of prefixes) {
               if (!person._pre.has(p)) { person._pre.add(p); person.prefixes.push(p); }
            }

            // A solution can name the same person in two roles (e.g. exec and
            // architect). De-dupe by source path so it appears once.
            if (!person._seen.has(record.sourcePath)) {
               person._seen.add(record.sourcePath);
               person.records.push(record);
            }
         }
      }

      return people;
   }

   /**
    * Render one person's dashboard markdown: a greeting, the role(s) they hold,
    * then their business solutions grouped by Solutions Architect as
    * Solution / Current / Future tables.
    *
    * @private
    * @param {{name:string, roles:Set<string>, records:Array}} person
    */
   _renderDashboard(person) {
      const lines = [];
      lines.push('## Welcome Back ' + firstName(person.name));
      lines.push('');

      // Roles in the canonical order they were declared.
      const roles = ROLE_FIELDS.map((r) => r.label).filter((l) => person.roles.has(l));
      lines.push('*' + roles.join(' · ') + ' dashboard.*');
      lines.push('');
      lines.push('Here are your Business Solutions');
      lines.push('');

      // Group this person's solutions by Solutions Architect, architects A->Z,
      // solutions A->Z within each architect.
      const byArchitect = new Map();
      for (const record of person.records) {
         const architect = (record.solutionsArchitect || '').trim() || 'Unassigned';
         if (!byArchitect.has(architect)) byArchitect.set(architect, []);
         byArchitect.get(architect).push(record);
      }

      const architects = Array.from(byArchitect.keys()).sort((a, b) => a.localeCompare(b));
      for (const architect of architects) {
         lines.push('### ' + architect);
         lines.push('');
         lines.push('| Solution | Current | Future |');
         lines.push('| --- | --- | --- |');
         const solutions = byArchitect.get(architect)
            .slice()
            .sort((a, b) => a.businessSolution.localeCompare(b.businessSolution));
         for (const record of solutions) {
            lines.push('| ' + this._cell(record.businessSolution)
               + ' | ' + this._cell(record.current)
               + ' | ' + this._cell(record.future) + ' |');
         }
         lines.push('');
      }

      return lines.join('\n').trimEnd() + '\n';
   }

   /**
    * Escape a value for a markdown table cell (pipes would break the column),
    * and fall back to an em dash for blanks.
    *
    * @private
    */
   _cell(value) {
      const text = String(value == null ? '' : value).trim();
      if (!text) return '—';
      return text.replace(/\|/g, '\\|');
   }

   /**
    * Remove the generated `*.md` dashboard files from the folder so a rebuild
    * starts clean, without touching the records cache or other files.
    *
    * @private
    */
   _clearDashboards(folder) {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
         if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            fs.rmSync(path.join(folder, entry.name), { force: true });
         }
      }
   }
}

module.exports = DashboardContentClass;
