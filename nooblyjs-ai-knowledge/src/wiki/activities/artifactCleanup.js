/**
 * @fileoverview Event-bus subscriber that cleans up after a deleted document or folder.
 *
 * Deleting a document leaves three things behind that nothing else ever revisits:
 *
 *   1. its folder-local artifacts — `.system/derived/`, `.system/originals/`,
 *      `.system/context/`, and for a `.home.md` the `.system/home-seed.json` marker
 *      (see utils/documentArtifacts.js for why each one matters);
 *   2. its bullet in the folder's `.system/context/_folder.md` roll-up, and therefore
 *      in the folder's seeded `.home.md`;
 *   3. for a deleted FOLDER, its whole `## Subfolders` section in the PARENT's roll-up.
 *
 * This module closes all three off the event bus, which is the one place every delete
 * converges regardless of how it happened — the file watcher's `unlink`/`unlinkDir`
 * (drag-out, git checkout, a workflow writing to disk) and the wiki's own
 * `DELETE /applications/wiki/api/{documents,folders}/:path` routes both emit here.
 * Subscribing once is what makes the cleanup source-agnostic; doing it inside the
 * watcher's handlers would miss anything the watcher never sees.
 *
 * Both sources firing for the same delete (an API delete also raises the watcher's
 * unlink) is expected and harmless: artifact removal is idempotent, and the two context
 * rebuilds coalesce inside ContextTrigger's per-folder debounce into one job.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

const { needsMarkdownSidecar, isSeededHomeRelPath } = require('../../shared/utils/filePolicy');
const { removeDocumentArtifacts } = require('../utils/documentArtifacts');

/**
 * True when any segment of a space-relative path is dot-prefixed.
 *
 * Deletes under a hidden path are app plumbing, not source documents: the artifacts we
 * would clean up ARE `.system/…` files, and the chat's `.aicontext/` cache churns
 * constantly. Reacting to them would mean deriving a "document" from an artifact path
 * and scheduling AI runs for folders the tree never shows.
 * @private
 */
function isHiddenPath(relativePath) {
  return String(relativePath).split('/').some(segment => segment.startsWith('.'));
}

/**
 * True for the delete of a folder's seeded home page — the ONE hidden path this module
 * reacts to.
 *
 * `.home.md` is dot-prefixed only so it stays out of the tree and the folder listing; it
 * is a visible wiki document, and it owns one artifact: `<folder>/.system/home-seed.json`,
 * the marker recording that the context build wrote that page. Leave the marker behind
 * and the repo carries provenance for a page that no longer exists.
 *
 * The folder itself must still be a real content folder, so a `.home.md` sitting under
 * `.system/` or `.aicontext/` stays excluded — that is plumbing, and letting a basename
 * override the namespace rule would reopen the very hole `isHiddenPath` closes.
 * @private
 */
function isSeededHomeDelete(relativePath) {
  if (!isSeededHomeRelPath(relativePath)) return false;
  const rel = String(relativePath);
  const slash = rel.lastIndexOf('/');
  return slash === -1 || !isHiddenPath(rel.slice(0, slash));
}

/**
 * True when a deleted document could have had a context sidecar, and its folder's
 * roll-up therefore still describes it. Markdown pages are summarised directly; the
 * binaries that yield derived text (office, PDF) are summarised from that text. Images,
 * video and unknown binaries never reach the context build, so deleting one changes
 * nothing a rebuild would fix.
 * @private
 */
function ownsContext(relativePath) {
  return path.extname(relativePath).toLowerCase() === '.md' || needsMarkdownSidecar(relativePath);
}

/**
 * Resolve the event's space to its absolute on-disk content root, the same way every
 * other wiki component does.
 * @param {Object} event - Normalized event-bus event.
 * @param {Object} services
 * @return {Promise<{space: Object, root: string}|null>} null when unresolvable.
 * @private
 */
async function resolveSpaceRoot(event, services) {
  const { dataManager, appBaseDir } = services;
  const spaces = await dataManager.read('spaces');
  if (!Array.isArray(spaces)) return null;

  const wantedId = event.space?.id;
  const wantedName = event.space?.name;
  const space = spaces.find(s => wantedId != null && String(s.id) === String(wantedId))
    || spaces.find(s => s.name === wantedName);
  if (!space) return null;

  let root = space.path || space.configuration?.filing?.baseDir;
  if (!root) return null;
  if (!path.isAbsolute(root)) {
    root = path.resolve(appBaseDir || path.join(process.cwd(), '.application'), root);
  }
  return { space, root: path.normalize(root) };
}

/**
 * React to one delete event: remove the item's artifacts, then schedule the owning
 * folder's context rebuild.
 * @param {Object} event - Normalized event-bus event.
 * @param {Object} services
 * @return {Promise<void>}
 * @private
 */
async function handleDelete(event, services) {
  const { log } = services;

  const itemType = event.event.itemType;
  const rel = String(event.item?.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel) return;
  const homeDelete = itemType === 'file' && isSeededHomeDelete(rel);
  if (isHiddenPath(rel) && !homeDelete) return;

  const resolved = await resolveSpaceRoot(event, services);
  if (!resolved) {
    log.debug?.(`[ArtifactCleanup] No on-disk root for space "${event.space?.name}" — skipping ${rel}`);
    return;
  }
  const { space, root } = resolved;

  if (itemType === 'file') {
    const { removed } = await removeDocumentArtifacts(root, rel, { log });
    if (removed.length) {
      log.info(`[ArtifactCleanup] ${space.name}/${rel}: removed ${removed.length} artifact(s) — ${removed.join(', ')}`);
    }
    // A deleted folder home is never rebuilt on the way out. It owns no context
    // sidecar and appears in no roll-up — it is generated FROM the roll-up, so a
    // rebuild here would re-seed the page the reader just chose to remove, from an
    // unchanged roll-up, at the cost of an AI call. Delete means delete; the next
    // context run (or any edit in the folder) seeds a fresh one.
    if (homeDelete) return;
    // A deleted image or video never had context, so its folder's roll-up does not
    // mention it — no AI run needed.
    if (!ownsContext(rel)) return;
  }
  // A deleted FOLDER took its own `.system/` with it; what survives is the PARENT's
  // roll-up, which still carries the folder's `## Subfolders` section. Always rebuild.

  const trigger = services.contextTrigger;
  if (!trigger) return;
  trigger.scheduleRemoval(space, rel);
}

/**
 * Subscribe artifact + context cleanup to the wiki event bus.
 *
 * @param {Object} services - Shared wiki services; needs `dataManager`, `log`,
 *   `appBaseDir` and (for the context rebuild) `contextTrigger`.
 * @return {Function|null} Unsubscribe function, or null when there is no event bus.
 */
function startArtifactCleanup(services) {
  const { log } = services;
  const bus = global.eventBus;

  if (!bus || typeof bus.subscribe !== 'function') {
    log.warn('[ArtifactCleanup] No event bus available — deleted documents will keep their artifacts');
    return null;
  }

  const unsubscribe = bus.subscribe('change', (event) => {
    if (event?.event?.operation !== 'delete') return;
    // Fire-and-forget: the bus emit path is synchronous and must not be blocked by
    // disk work or an AI-backed workflow run.
    handleDelete(event, services).catch((error) => {
      log.warn(`[ArtifactCleanup] Cleanup failed for ${event.item?.path}: ${error.message}`);
    });
  });

  log.info('[ArtifactCleanup] Listening for delete events (artifact removal + context rebuild)');
  return unsubscribe;
}

module.exports = {
  startArtifactCleanup,
  // Exported for tests — these gates decide whether an event costs disk/AI work.
  isHiddenPath,
  isSeededHomeDelete,
  ownsContext
};
