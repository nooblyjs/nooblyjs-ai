/**
 * @fileoverview Importing an export folder (NooblyJS Phase 8).
 *
 * An export is a folder a wiki was exported to:
 *
 *   <export>/export.json              { "name": "…", "spaces": { "<Space name>": { "description": "…" } } }
 *   <export>/<Space name>/**          the pages; other file types are copied as they are
 *
 * Each top-level folder becomes a space (found by name, or created). Each file
 * goes through redact() if it is text (unless NooblyJS Platform's "Redact personal
 * data on ingest" guardrail is off), is written through the space's filing
 * provider and is handed to the search indexer. The unredacted text exists
 * only in memory: it is never written, and never logged.
 *
 * Every import leaves a SOURCE record (store.js): what was imported, from
 * where, when, how many documents per space and how many values were redacted.
 * Importing the same export again replaces the record and overwrites the files.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { redact, isTextFile } = require('./redact');

const SAMPLE_EXPORT = path.join(__dirname, 'sample-export');
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'source';

/** Every file under a folder, as paths relative to it with forward slashes. Dot-folders are skipped. */
async function filesUnder(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await filesUnder(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Object} deps
 * @param {Object} deps.store - the knowledge store
 * @param {Object} deps.spaceManager
 * @param {Object} deps.spaceFilingManager
 * @param {Object} deps.filingServiceWrapper
 * @param {Object} deps.searchIndexer
 * @param {string} deps.appBaseDir
 * @param {Object} deps.logger
 * @param {Function} [deps.now] - () => Date, the host's clock when hosted
 * @param {Function} [deps.redactOnIngest] - () => Promise<boolean>: whether to redact (NooblyJS Platform's guardrail;
 *   on unless the host says it is off)
 * @return {{ importExport: Function, importSample: Function }}
 */
function createImporter({ store, spaceManager, spaceFilingManager, filingServiceWrapper, searchIndexer, appBaseDir, logger, now = () => new Date(), redactOnIngest = async () => true }) {
  async function ensureSpace(name, description, by) {
    const existing = spaceManager.getAllSpaces().find((s) => s.name === name);
    if (existing) return { space: existing, created: false };
    const baseDir = path.join(appBaseDir, 'spaces', slug(name), 'files');
    await fs.mkdir(baseDir, { recursive: true });
    const space = await spaceManager.createSpace({
      name,
      description: description || '',
      type: 'project',
      visibility: 'team',
      permissions: 'read-write',
      allowedUsers: [],
      configuration: { filing: { provider: 'local', baseDir, maxFileSize: MAX_FILE_BYTES, allowedExtensions: ['*'] } },
    }, by);
    await spaceFilingManager.initializeSpace(space);
    return { space, created: true };
  }

  /**
   * @param {{ folder: string, by: string }} o - `by`: who ran it (an id or an email)
   * @return {Promise<Object>} the source record
   */
  async function importExport({ folder, by }) {
    const from = path.resolve(folder);
    let manifest = {};
    try {
      manifest = JSON.parse(await fs.readFile(path.join(from, 'export.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`export.json in ${from} is not valid JSON: ${error.message}`);
    }
    const stat = await fs.stat(from).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`There is no export folder at ${from}.`);

    const name = String(manifest.name || path.basename(from));
    // Asked once per import, so one import is either redacted throughout or not at all.
    const redacting = (await redactOnIngest()) !== false;
    const record = {
      id: slug(name), name, kind: 'folder', description: manifest.description || '', from,
      state: 'Importing', lastRunAt: now().toISOString(), by,
      spaces: [], documents: 0, redaction: redacting ? 'on' : 'off', redacted: { id: 0, email: 0, phone: 0 },
    };

    try {
      const spaceFolders = (await fs.readdir(from, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
      if (!spaceFolders.length) throw new Error('The export has no space folders.');
      for (const spaceName of spaceFolders) {
        const { space, created } = await ensureSpace(spaceName, manifest.spaces?.[spaceName]?.description, by);
        let documents = 0;
        for (const rel of await filesUnder(path.join(from, spaceName))) {
          const bytes = await fs.readFile(path.join(from, spaceName, rel));
          if (bytes.length > MAX_FILE_BYTES) {
            logger?.warn?.(`[Knowledge import] skipped ${spaceName}/${rel}: larger than ${MAX_FILE_BYTES} bytes`);
            continue;
          }
          let content = bytes;
          if (redacting && isTextFile(rel)) {
            const clean = redact(bytes.toString('utf8'));
            for (const key of Object.keys(record.redacted)) record.redacted[key] += clean.counts[key];
            content = clean.text;
          }
          await filingServiceWrapper.writeDocument(space.name, rel, content);
          await searchIndexer.updateFileInSpace(space.name, rel);
          documents += 1;
        }
        record.spaces.push({ name: space.name, documents, created });
        record.documents += documents;
      }
      record.state = 'Imported';
    } catch (error) {
      record.state = `Failed: ${error.message}`;
      await store.saveSource(record);
      throw error;
    }
    await store.saveSource(record);
    logger?.info?.(`[Knowledge import] ${record.name}: ${record.documents} documents into ${record.spaces.length} spaces, ${redacting ? `${record.redacted.id + record.redacted.email + record.redacted.phone} values redacted` : 'not redacted (the Platform guardrail is off)'}`);
    return record;
  }

  /** The bundled PRD-031 sample. `once`: do nothing when it has been imported before (the seed). */
  async function importSample({ by = 'system', once = false } = {}) {
    if (once) {
      const manifest = JSON.parse(await fs.readFile(path.join(SAMPLE_EXPORT, 'export.json'), 'utf8'));
      const existing = await store.source(slug(manifest.name));
      if (existing?.state === 'Imported') return existing;
    }
    return importExport({ folder: SAMPLE_EXPORT, by });
  }

  return { importExport, importSample };
}

module.exports = { createImporter, SAMPLE_EXPORT, slug };
