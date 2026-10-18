/**
 * @fileoverview Resolve a wiki space (by name or id) to its on-disk content root.
 *
 * The platform stores its spaces in `<appBaseDir>/spaces/spaces.json`; each
 * record carries `id`, `name` and `configuration.filing.baseDir` (the absolute
 * folder that holds that space's content). The wiki HTTP routes read this same
 * file directly (see documentRoutes.js / filingRoutes.js), so a workflow step —
 * which runs in an isolated worker thread without the live space services — does
 * the same: it reads spaces.json off the shared disk to map a space reference to
 * the absolute baseDir it must write `.context` sidecars into, plus the numeric
 * id and name the wiki API endpoints expect.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolve the platform's application base directory (where `spaces/spaces.json`
 * and `configuration/settings/` live).
 *
 * Priority: explicit argument -> APP_BASE_DIR env -> the conventional sibling
 * `<repos-parent>/.application` (this repo sits beside digital-technologies-knowledge
 * under a common parent, and `.application` is a sibling of both).
 *
 * @param {string} [explicit] - Caller-supplied override.
 * @returns {string} Absolute application base directory.
 */
function resolveAppBaseDir(explicit) {
  const dir = explicit
    || process.env.APP_BASE_DIR
    // utilities/ -> build-context/ -> workflows-repo/ -> repos parent (e.g. C:\work-dt)
    || path.resolve(__dirname, '../../..', '.application');
  // The .env APP_BASE_DIR is stored with escaped separators (C:\\work-dt\\.application);
  // normalise so doubled separators collapse to a clean OS path.
  return path.normalize(dir);
}

/**
 * Read and parse `<appBaseDir>/spaces/spaces.json`.
 * @param {string} appBaseDir
 * @returns {Array<Object>} The space records (empty array if the file is empty).
 */
function readSpaces(appBaseDir) {
  const spacesPath = path.join(appBaseDir, 'spaces', 'spaces.json');
  const raw = fs.readFileSync(spacesPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Resolve a space reference (numeric id, numeric string, or name — case
 * insensitive) to a normalised descriptor.
 *
 * @param {string|number} spaceRef - Space id or name.
 * @param {string} appBaseDir - Application base directory.
 * @returns {{id:number, name:string, baseDir:string, visibility:string}}
 * @throws {Error} When the space, or its filing baseDir, cannot be found.
 */
function resolveSpace(spaceRef, appBaseDir) {
  const spaces = readSpaces(appBaseDir);
  const spacesPath = path.join(appBaseDir, 'spaces', 'spaces.json');

  let space = null;
  if (typeof spaceRef === 'number' || /^\d+$/.test(String(spaceRef).trim())) {
    const id = parseInt(spaceRef, 10);
    space = spaces.find((s) => s.id === id) || null;
  }
  if (!space) {
    const key = String(spaceRef).trim().toLowerCase();
    space = spaces.find((s) => String(s.name).trim().toLowerCase() === key) || null;
  }
  if (!space) {
    const known = spaces.map((s) => `${s.id}:${s.name}`).join(', ') || '(none)';
    throw new Error(`Space not found: "${spaceRef}" in ${spacesPath}. Known spaces: ${known}`);
  }

  const baseDir = space.configuration
    && space.configuration.filing
    && space.configuration.filing.baseDir;
  if (!baseDir) {
    throw new Error(`Space "${space.name}" (id ${space.id}) has no configuration.filing.baseDir in ${spacesPath}`);
  }

  return {
    id: space.id,
    name: space.name,
    baseDir,
    visibility: space.visibility,
  };
}

module.exports = { resolveAppBaseDir, readSpaces, resolveSpace };
