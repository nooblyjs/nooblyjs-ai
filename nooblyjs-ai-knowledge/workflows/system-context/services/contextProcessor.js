/**
 * @fileoverview ContextProcessor — bottom-up AI context generation for a wiki
 * space folder tree.
 *
 * Given a space and a starting folder, it walks the folder tree (fetched from
 * the running backend, which warms the live treeCache) to the deepest folders
 * first, then works back up:
 *
 *   1. For every summarisable file in a folder, ensure an up-to-date per-file
 *      context at `.system/context/<folder>/{filename}` (the sidecar mirrors the
 *      source path and keeps the source file's own name, e.g.
 *      `.system/context/Sell/Overview.md`) — the AI summary saved in full. The
 *      sidecar is reused when it is newer than the source file; a newer source is
 *      re-summarised, but the rewrite (and the bubble-up) is skipped when the new
 *      summary adds no intrinsic value over the old one.
 *   2. After the files, write the folder roll-up at `.system/context/<folder>/_folder.md`:
 *      an AI overview of the folder, a list of the file summaries, and — because
 *      this folder's parent will fold this in — a section per subfolder built
 *      from the subfolder's own overview ("the home file from the folder below").
 *   3. ★ Seed the folder HOME page: if the folder has no home file
 *      (.home.md / home.md / Home.md), copy the roll-up into `.home.md` so the
 *      folder gets a landing page in the wiki — and REFRESH that page on later
 *      runs, but only while `.system/home-seed.json` proves it is still exactly
 *      what we wrote. One human edit makes it theirs for good. See
 *      `ensureFolderHome()`.
 *
 * Because the parent is processed AFTER its children, each parent roll-up is
 * informed by everything beneath it. All sidecars live under the space-root
 * hidden `.system/context/` namespace (mirroring the source tree) so they never
 * appear in the wiki document tree or index.
 *
 * Reads go over HTTP (so they fill the live caches); writes are raw `fs` to the
 * space's on-disk baseDir (the worker shares the disk) so the generated sidecars
 * are not themselves re-indexed as documents.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { prompts } = require('../../common/prompts/prompts');

/** File extensions considered summarisable by default. */
const DEFAULT_EXTENSIONS = ['.md'];

/**
 * Fixed filename for a folder's roll-up context inside its `.context/` dir. A
 * constant (rather than the folder's own name) guarantees it never collides with
 * a file sidecar named after the folder (e.g. folder `Sell` containing `Sell.md`).
 */
const FOLDER_CONTEXT_NAME = '_folder.md';

/**
 * The platform extracts the text of binary documents (PDF, DOCX, …) into a
 * markdown sidecar stored FOLDER-LOCAL, in a `.settings/derived/` directory inside
 * the document's OWN folder, keeping the original's FULL name + `.md` — e.g. an
 * uploaded `Sell/Foo.pdf` yields `Sell/.settings/derived/Foo.pdf.md` (see the
 * knowledge platform's `shared/utils/filePolicy.js` `toDerivedRelPath`, the single
 * source of truth for this layout — keep the two in lockstep). The source-file tree
 * hides all dot-directories and the originals are not markdown, so the normal
 * per-file pass never summarises them. The derived pass (see processFolder) pulls
 * them in so a folder of PDFs still gets per-file context, a roll-up and a seeded
 * home page.
 */
const DERIVED_DIR_REL = path.join('.system', 'derived');

/**
 * Context sidecars are folder-local too: a folder's context lives in its OWN
 * `.system/context/` directory, beside that folder's derived/originals artifacts
 * and its file-order/file-types metadata. Nothing mirrors the space tree from a
 * root namespace — the space root's `.system/` is just the root folder's own copy
 * (it additionally holds the space-scoped `templates/` and `useractivity/`).
 * Mirrors `filePolicy.CONTEXT_DIR` / `toContextRelPath` in the knowledge platform,
 * the single source of truth — keep the two in lockstep.
 */
const CONTEXT_DIR_REL = path.join('.system', 'context');

/**
 * Folder home pages, and the one this build is allowed to write. A `home.md` or
 * `Home.md` is by definition hand-made — we have never created one — so it is never
 * a candidate for the refresh rule in `ensureFolderHome`.
 * Mirrors `filePolicy.HOME_FILE_NAMES` / `SEEDED_HOME_FILE`.
 */
const HOME_FILE_NAMES = ['.home.md', 'home.md', 'Home.md'];
const SEEDED_HOME_NAME = '.home.md';

/**
 * Provenance marker for a home page THIS build seeded, at `<folder>/.system/home-seed.json`.
 * Mirrors `filePolicy.HOME_SEED_FILE` / `toHomeSeedRelPath` in the knowledge platform,
 * the single source of truth — keep the name AND the hashing rule in lockstep, or a
 * seeded page silently freezes at its first version again. See `ensureFolderHome`.
 */
const HOME_SEED_NAME = 'home-seed.json';

/** A file's base name with its final extension removed (`Foo.pdf` -> `Foo`). */
function baseNoExt(name) {
  return String(name == null ? '' : name).replace(/\.[^./\\]+$/, '');
}

/** Normalise a tree path to forward slashes with no leading/trailing slash. */
function normalizeRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Split a normalised relative path into segments ([] for the root). */
function relParts(p) {
  const n = normalizeRel(p);
  return n === '' ? [] : n.split('/');
}

class ContextProcessor {

  /**
   * @param {Object} settings
   * @param {{id:number, name:string, baseDir:string}} settings.space
   * @param {string} settings.startFolder - Folder (relative to the space root) to start from; '' = root.
   * @param {Object} settings.wikiApi - File source (DiskFileSource): authenticate(),
   *   getFolderTree(), readDocument(spaceName, relPath).
   * @param {Object} settings.expert - FolderExpert instance.
   * @param {Object} [settings.logger=console]
   * @param {string[]} [settings.extensions] - Summarisable extensions (default ['.md']).
   * @param {boolean} [settings.force=false] - Regenerate sidecars even when present.
   * @param {number} [settings.summaryMaxChars=250] - Per-file summary length cap.
   * @param {number} [settings.folderMaxChars=600] - Folder overview length cap.
   * @param {number} [settings.maxInputChars=12000] - Max document characters fed to the model.
   * @param {Object} [settings.prompts] - Prompt library (see common/prompts/prompts.js).
   *   Defaults to the shared library resolved off APP_BASE_DIR.
   */
  constructor(settings) {
    this.space = settings.space;
    this.startFolder = normalizeRel(settings.startFolder || '');
    this.wikiApi = settings.wikiApi;
    this.expert = settings.expert;
    // Both system prompts live in the platform's prompt library (datasources →
    // AI → Prompts) so they can be tuned without a code change; the step binds
    // this to its own appBaseDir.
    this.prompts = settings.prompts || prompts;
    this.logger = settings.logger || console;
    this.extensions = (settings.extensions && settings.extensions.length
      ? settings.extensions
      : DEFAULT_EXTENSIONS).map((e) => String(e).toLowerCase());
    this.force = !!settings.force;
    this.summaryMaxChars = settings.summaryMaxChars || 500;
    this.folderMaxChars = settings.folderMaxChars || 600;
    this.maxInputChars = settings.maxInputChars || 12000;
    // Word-set (Jaccard) similarity at/above which a regenerated summary is
    // treated as "no intrinsic change" and not rewritten. 0.9 = near-identical.
    this.significanceThreshold = settings.significanceThreshold != null ? settings.significanceThreshold : 0.9;
    // Also summarise binary docs (PDF/DOCX/…) via their `.settings/derived` text.
    // Default on; pass includeDerived:false to restrict the build to markdown.
    this.includeDerived = settings.includeDerived !== false;

    this.stats = {
      foldersProcessed: 0,
      foldersSkipped: 0,
      filesSummarized: 0,
      filesSkipped: 0,
      filesUnchanged: 0,
      filesFailed: 0,
      rollupsWritten: 0,
      homesSeeded: 0,
      // Seeded homes rewritten because the folder moved on and nobody had edited
      // the page — see ensureFolderHome's provenance rule.
      homesRefreshed: 0,
      // Cleanup: sidecars whose source document is gone, and roll-ups of folders
      // that no longer hold anything to roll up. See pruneOrphanContext().
      contextPruned: 0,
      rollupsPruned: 0,
    };
  }

  /** @returns {boolean} Whether a file name should be summarised. */
  isSummarizable(name) {
    return this.extensions.includes(path.extname(name).toLowerCase());
  }

  /** Absolute on-disk directory for a space-relative folder path. */
  absDir(rel) {
    return path.join(this.space.baseDir, ...relParts(rel));
  }

  /**
   * Absolute context directory for a space-relative folder path. Context is
   * FOLDER-LOCAL: it lives in the folder's OWN `.system/context/` directory
   * (folder `Sell` -> `<baseDir>/Sell/.system/context`), beside that folder's
   * derived/originals artifacts — NOT in a space-root namespace mirroring the
   * tree. The source tree hides `.system` entirely.
   */
  ctxDir(rel) {
    return path.join(this.space.baseDir, ...relParts(rel), CONTEXT_DIR_REL);
  }

  /**
   * Path of a file's context sidecar. The sidecar keeps the source file's own
   * name (e.g. `.system/context/Overview.md`), mirroring the source path so it
   * never collides with the real document.
   */
  fileContextPath(folderRel, fileName) {
    return path.join(this.ctxDir(folderRel), fileName);
  }

  /**
   * Path of a folder's roll-up context — a FIXED name (`_folder.md`, e.g.
   * `.system/context/Sell/_folder.md`) so it can never collide with a file
   * sidecar that shares the folder's name.
   */
  folderContextPath(folderRel) {
    return path.join(this.ctxDir(folderRel), FOLDER_CONTEXT_NAME);
  }

  /**
   * Path of a folder's home-seed marker. It sits directly in the folder's own
   * `.system/` — folder-level metadata about the folder's landing page, the same
   * tier as `file-order.json`, not a per-document artifact.
   */
  homeSeedPath(folderRel) {
    return path.join(this.space.baseDir, ...relParts(folderRel), '.system', HOME_SEED_NAME);
  }

  /**
   * Fingerprint of a home page's content, used to answer "is this still exactly
   * what we wrote?".
   *
   * CRLF is normalised away first because the content roots are directories of
   * symlinked git repositories: a checkout with `core.autocrlf` on hands back the
   * same page with different line endings, and hashing those raw would report a
   * hand edit that never happened, freezing the page forever.
   */
  hashHome(text) {
    const normalised = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    return crypto.createHash('sha1').update(normalised, 'utf8').digest('hex');
  }

  /**
   * Read a folder's home-seed marker.
   * @returns {Object|null} null when absent, unreadable or corrupt — every one of
   *   which means "we cannot prove we wrote that page", i.e. hands off.
   */
  readHomeSeed(folderRel) {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.homeSeedPath(folderRel), 'utf8'));
      return parsed && typeof parsed === 'object' && typeof parsed.hash === 'string' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Record that we wrote `.home.md` with this exact content.
   *
   * Best-effort: if the marker cannot be written the page we just seeded simply
   * reads as hand-written on the next run and is never refreshed. That is the safe
   * direction to fail, but it is worth a warning — silently losing the marker turns
   * the whole feature off for that folder.
   */
  writeHomeSeed(folderRel, hash, previous) {
    const seedPath = this.homeSeedPath(folderRel);
    const now = new Date().toISOString();
    try {
      this.ensureDir(path.dirname(seedPath));
      fs.writeFileSync(seedPath, `${JSON.stringify({
        file: SEEDED_HOME_NAME,
        hash,
        // First seeding is preserved across refreshes so the marker records how
        // long the page has been machine-owned, not just when it last changed.
        seededAt: (previous && previous.seededAt) || now,
        updatedAt: now,
      }, null, 2)}\n`, 'utf8');
      return true;
    } catch (err) {
      this.logger.warn && this.logger.warn(
        `Context build: could not write home-seed marker for "${folderRel || '(root)'}": ${err.message}`
        + ' — the seeded home will not be refreshed on later runs');
      return false;
    }
  }

  /**
   * Absolute derived-text directory for a space-relative folder path. Derived
   * markdown is FOLDER-LOCAL — it lives in a `.settings/derived/` directory inside
   * the folder itself (folder `Sell` -> `<baseDir>/Sell/.settings/derived`), NOT in
   * a space-root namespace. Mirrors the knowledge platform's
   * `filePolicy.DERIVED_DIR` / `toDerivedRelPath`, the single source of truth.
   */
  derivedDir(folderRel) {
    return path.join(this.space.baseDir, ...relParts(folderRel), DERIVED_DIR_REL);
  }

  /**
   * The platform-extracted markdown for a binary document in `folderRel`. The
   * derived sidecar keeps the original's FULL name + `.md`
   * (`Sell/Foo.pdf` -> `<baseDir>/Sell/.settings/derived/Foo.pdf.md`), matching
   * `filePolicy.toDerivedRelPath`. Returns null when none exists.
   * @param {string} folderRel
   * @param {string} docName - The original document's file name (with extension).
   * @returns {string|null} Absolute path of the derived text, or null.
   */
  derivedTextPathFor(folderRel, docName) {
    const p = path.join(this.derivedDir(folderRel), `${docName}.md`);
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
    } catch (_) {
      return null;
    }
  }

  /** Read a derived-text file, returning null (with a warning) when unreadable. */
  _readDerivedText(absPath) {
    try {
      return fs.readFileSync(absPath, 'utf8');
    } catch (err) {
      this.logger.warn && this.logger.warn(`Context build: cannot read derived text ${absPath}: ${err.message}`);
      return null;
    }
  }

  /** Create a directory if it does not already exist. */
  ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /** Trim a model response, preserving its full text (no truncation). */
  clean(text) {
    return String(text == null ? '' : text).trim();
  }

  /** Collapse a value to a single line for safe embedding in a markdown bullet. */
  inline(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  /**
   * Remove images from document text BEFORE it is summarised. Wiki exports often
   * embed pictures as inline base64 `data:` URIs, and a single one can be
   * hundreds of KB — larger than the whole `maxInputChars` window (a real doc
   * here carries a 255k-char PNG on one line). Left in, truncation would feed the
   * model a slab of base64 and push every line of actual prose out of view, so
   * the summary is built from noise. Images carry no text value to a summariser,
   * so they are stripped entirely; only the alt text is kept as a short caption.
   *
   * Stripped, in order:
   *   - Markdown images  `![alt](url)`  -> `[image: alt]` (or dropped when alt is empty)
   *   - HTML `<img …>` tags             -> dropped
   *   - any stray inline `data:…;base64,…` URI (e.g. a reference-style image
   *     definition) -> dropped
   * Ordinary markdown links `[text](url)` are deliberately left intact.
   *
   * @param {string} text
   * @returns {string}
   */
  stripImages(text) {
    return String(text == null ? '' : text)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => (alt && alt.trim() ? `[image: ${alt.trim()}]` : ''))
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/g, '')
      .replace(/[ \t]+\n/g, '\n')   // tidy trailing spaces a removed inline image leaves
      .replace(/\n{3,}/g, '\n\n');  // collapse the blank gap a removed block image leaves
  }

  /* ---- progress logging helpers ------------------------------------------ */

  /** Two spaces per tree level, so the log reads as the folder hierarchy. */
  _indent(depth) {
    return '  '.repeat(Math.max(0, depth | 0));
  }

  /**
   * Human-friendly elapsed time since a start mark (or since the whole run when
   * no mark is given). ASCII only so it renders in any terminal.
   * @param {number} [sinceMs] - Epoch ms to measure from; defaults to run start.
   * @returns {string}
   */
  _elapsed(sinceMs) {
    const from = sinceMs != null ? sinceMs : (this._t0 || Date.now());
    const ms = Date.now() - from;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return `${m}m${s}s`;
  }

  /**
   * Count the summarisable files + (non-dot) folders beneath a set of tree
   * nodes, used only to print "X folders / Y files to consider" up front.
   * @param {Array<Object>} nodes
   * @returns {{folders:number, files:number}}
   */
  _countTree(nodes) {
    let folders = 0;
    let files = 0;
    const walk = (arr) => {
      for (const n of (arr || [])) {
        if (n && n.type === 'folder' && !String(n.name).startsWith('.')) {
          folders++;
          walk(n.children);
        } else if (n && n.type === 'document' && this.isSummarizable(n.name)) {
          files++;
        }
      }
    };
    walk(nodes);
    return { folders, files };
  }

  /**
   * Locate a folder node in the tree by its space-relative path. The space root
   * ('') is represented as a synthetic folder whose children are the top-level
   * tree entries.
   * @param {Array<Object>} tree
   * @param {string} folderRel - Space-relative folder path ('' = root).
   * @returns {Object|null}
   */
  findFolderNode(tree, folderRel) {
    const target = normalizeRel(folderRel);
    if (target === '') {
      return { type: 'folder', name: '', path: '', children: tree };
    }
    const stack = [...tree];
    while (stack.length) {
      const node = stack.shift();
      if (node && node.type === 'folder') {
        if (normalizeRel(node.path) === target) return node;
        if (Array.isArray(node.children)) stack.push(...node.children);
      }
    }
    return null;
  }

  /**
   * Locate the starting folder node (`this.startFolder`) in the tree.
   * @param {Array<Object>} tree
   * @returns {Object|null}
   */
  findStartNode(tree) {
    return this.findFolderNode(tree, this.startFolder);
  }

  /**
   * Entry point: fetch the tree, then process the starting folder bottom-up.
   * @returns {Promise<Object>} Stats plus the path of the root roll-up.
   */
  async run() {
    this._t0 = Date.now();
    this.logger.info(`Context build: fetching folder tree for space "${this.space.name}" (id ${this.space.id})`);
    const tree = await this.wikiApi.getFolderTree(this.space.id); // warms live treeCache

    const start = this.findStartNode(tree);
    if (!start) {
      throw new Error(`Start folder "${this.startFolder}" not found in space "${this.space.name}"`);
    }

    // Up-front scope so the silence ahead has a denominator: how much there is to do.
    const counts = this._countTree(start.children || []);
    this.logger.info(
      `Context build: tree ready in ${this._elapsed()} — ${counts.folders + 1} folder(s), `
      + `${counts.files} summarisable file(s) to consider (force=${this.force}, `
      + `extensions=${this.extensions.join(',')})`
    );
    this.logger.info('Context build: walking bottom-up (deepest folders first)…');

    const rootName = this.startFolder === ''
      ? (path.basename(this.space.baseDir) || this.space.name)
      : (start.name || path.basename(this.startFolder));

    const result = await this.processFolder(start, this.startFolder, rootName, 0);

    this.logger.info(
      `Context build: sweep finished in ${this._elapsed()} — `
      + `${this.stats.filesSummarized} summarised, ${this.stats.filesSkipped} up-to-date, `
      + `${this.stats.filesUnchanged} unchanged, ${this.stats.filesFailed} failed, `
      + `${this.stats.contextPruned} orphan sidecar(s) pruned, `
      + `${this.stats.rollupsWritten} roll-up(s) written (${this.stats.foldersSkipped} unchanged, `
      + `${this.stats.rollupsPruned} pruned), ${this.stats.homesSeeded} home(s) seeded, `
      + `${this.stats.homesRefreshed} refreshed`
    );
    return { ...this.stats, rootContext: result ? result.rollupPath : null };
  }

  /**
   * Targeted, single-folder rebuild for a specific set of changed and/or REMOVED
   * files — the event-driven on-demand path used by the wiki platform. Unlike
   * `run()`, this does NOT walk the tree, recurse into subfolders, or re-summarise
   * siblings: it force-summarises just the named files, prunes the sidecars of
   * documents that are gone, then rebuilds ONLY their folder's roll-up (reusing the
   * folder's other sidecars, no AI) and re-seeds the folder home when missing. Cost
   * is exactly (changed files) + 1 roll-up AI call.
   *
   * `removedRels` is what makes a DELETE cheap. The deleted path can't be summarised
   * — there is nothing left to read — but it still identifies the folder whose
   * roll-up describes it, so passing it here rebuilds that one roll-up. Without it a
   * delete would have to be expressed as "rebuild this folder", which is the
   * recursive bottom-up walk: minutes of AI for one removed file. It accepts a
   * removed FOLDER path too (the parent's roll-up carries its `## Subfolders`
   * section); pruning simply finds no sidecar under that name, which is correct.
   *
   * All named paths must live in the same folder (the caller groups events by
   * folder); any target in a different folder is ignored with a warning. Parent
   * roll-ups are NOT propagated here — the periodic full sweep (`run()`) owns
   * bottom-up bubble-up. Reuses `collectFolderDocs` so the folder doc set (and the
   * markdown-wins-over-derived rule) is identical to the full walk.
   *
   * @param {string[]|string} fileRels - Space-relative path(s) of changed file(s).
   * @param {string[]|string} [removedRels] - Space-relative path(s) that were deleted.
   * @returns {Promise<Object>} Stats plus the folder + its roll-up path.
   */
  async runFiles(fileRels, removedRels) {
    this._t0 = Date.now();
    const toList = (value) => (value == null ? [] : (Array.isArray(value) ? value : [value]))
      .map((f) => normalizeRel(f))
      .filter(Boolean);
    const rels = toList(fileRels);
    const removed = toList(removedRels);
    if (rels.length === 0 && removed.length === 0) {
      this.logger.warn('Context build (targeted): no files given — nothing to do');
      return { ...this.stats, folder: null, filesTargeted: 0, filesRemoved: 0, rootContext: null };
    }

    const folderOf = (rel) => {
      const dir = path.posix.dirname(rel);
      return dir === '.' ? '' : dir;
    };
    // A pure-delete run has no changed file to take the folder from, so fall back to
    // the removed path's parent — that is the folder whose roll-up is now wrong.
    const folderRel = folderOf(rels.length ? rels[0] : removed[0]);

    // Context belongs to real content folders only. A hidden folder is app
    // plumbing — the chat's `.aicontext` retrieval cache, the `.system`
    // namespace, and so on — and the source tree never shows it. Building
    // context there wastes an AI run and litters a disposable folder with
    // `_folder.md` / `.home.md`. Guarded here as well as in the caller because
    // this step is reachable directly via POST /api/workflows/start.
    if (folderRel.split('/').some((segment) => segment.startsWith('.'))) {
      this.logger.warn(
        `Context build (targeted): refusing hidden folder "${folderRel}" — `
        + 'context is only built for content folders'
      );
      return { ...this.stats, folder: folderRel, filesTargeted: 0, filesRemoved: 0, rootContext: null };
    }

    const targets = new Set();
    for (const rel of rels) {
      if (folderOf(rel) !== folderRel) {
        this.logger.warn(`Context build (targeted): ignoring "${rel}" — not in folder "${folderRel || '(root)'}"`);
        continue;
      }
      targets.add(rel);
    }

    const deletions = new Set();
    for (const rel of removed) {
      if (folderOf(rel) !== folderRel) {
        this.logger.warn(`Context build (targeted): ignoring removed "${rel}" — not in folder "${folderRel || '(root)'}"`);
        continue;
      }
      deletions.add(rel);
    }

    this.logger.info(
      `Context build (targeted): space "${this.space.name}" (id ${this.space.id}), `
      + `folder "${folderRel || '(root)'}", ${targets.size} changed + ${deletions.size} removed file(s) — fetching folder tree…`
    );
    const tree = await this.wikiApi.getFolderTree(this.space.id); // warms live treeCache

    const node = this.findFolderNode(tree, folderRel);
    if (!node) {
      throw new Error(`Targeted context: folder "${folderRel || '(root)'}" not found in space "${this.space.name}"`);
    }

    const { childFolders, docNodes } = this.collectFolderDocs(node, folderRel);
    this.logger.info(
      `Context build (targeted): folder "${folderRel || '(root)'}" — `
      + `${docNodes.length} doc(s), ${childFolders.length} subfolder(s); forcing ${targets.size} target(s)`
    );

    // Drop the sidecars of documents that are gone BEFORE the roll-up is rebuilt,
    // so the new roll-up can't carry a bullet for a file that no longer exists.
    // Driven off the folder's own contents rather than `deletions`, so a delete the
    // platform never told us about is cleaned up on the next rebuild either way.
    this.pruneOrphanContext(folderRel);

    // Per-file: force-regenerate the changed targets; reuse siblings' sidecars
    // (forceOverride=false → up-to-date sidecars are reused with no AI call).
    const fileSummaries = [];
    let idx = 0;
    for (const fn of docNodes) {
      idx++;
      const isTarget = targets.has(normalizeRel(fn.path));
      try {
        const { summary } = await this.ensureFileContext(fn, folderRel, 0, idx, docNodes.length, isTarget);
        fileSummaries.push({ name: fn.name, summary });
      } catch (err) {
        this.stats.filesFailed++;
        this.logger.warn(`  ! [${idx}/${docNodes.length}] ${fn.name}: FAILED - ${err.message}`);
        let prev = '';
        try { prev = fs.readFileSync(this.fileContextPath(folderRel, fn.contextName || fn.name), 'utf8').trim(); } catch (_) {}
        fileSummaries.push({ name: fn.name, summary: prev || '(summary unavailable)' });
      }
    }

    // Subfolder overviews come from each child's EXISTING roll-up (no recursion,
    // no rebuild) so the folder roll-up's "## Subfolders" section stays populated.
    const childResults = [];
    for (const cf of childFolders) {
      const childRel = normalizeRel(cf.path);
      const overview = this.readRollupOverview(this.folderContextPath(childRel));
      childResults.push({ name: cf.name, overview });
    }

    // Nothing left to roll up. On a delete run this is the folder's last document
    // going away, so the roll-up it leaves behind describes contents that no longer
    // exist — drop it rather than leaving a stale overview on disk.
    if (fileSummaries.length === 0 && childResults.length === 0) {
      this.logger.info(`Context build (targeted): folder "${folderRel || '(root)'}" empty — nothing to roll up`);
      this.pruneFolderRollup(folderRel);
      return { ...this.stats, folder: folderRel, filesTargeted: targets.size, filesRemoved: deletions.size, rootContext: null };
    }

    const folderName = folderRel === ''
      ? (path.basename(this.space.baseDir) || this.space.name)
      : (node.name || path.basename(folderRel));
    const { rollupPath } = await this.writeFolderRollup(folderRel, folderName, fileSummaries, childResults);
    this.ensureFolderHome(folderRel);

    this.logger.info(
      `Context build (targeted): done in ${this._elapsed()} — `
      + `${this.stats.filesSummarized} summarised, ${this.stats.filesSkipped} up-to-date, `
      + `${this.stats.filesUnchanged} unchanged, ${this.stats.filesFailed} failed, `
      + `${this.stats.contextPruned} orphan sidecar(s) pruned, `
      + `${this.stats.rollupsWritten} roll-up(s), ${this.stats.homesSeeded} home(s) seeded, `
      + `${this.stats.homesRefreshed} refreshed`
    );
    return { ...this.stats, folder: folderRel, filesTargeted: targets.size, filesRemoved: deletions.size, rootContext: rollupPath };
  }

  /**
   * Delete the context sidecars in a folder whose source document no longer exists.
   *
   * The build only ever WRITES sidecars, so without this a deleted document's summary
   * lives on forever: it keeps feeding chat grounding and the Context Manager, and the
   * next roll-up folds it straight back in as a bullet for a file that isn't there.
   * The wiki platform removes the sidecar as part of its own delete handling
   * (`wiki/utils/documentArtifacts.js`); this is the same job done from the build side,
   * which is what covers deletes that raised no event — a folder emptied while the
   * backend was down, a `git checkout` under a symlinked repo folder, a bulk removal.
   *
   * A sidecar name is ambiguous by construction: `x.md` is the sidecar of `x.md`, while
   * `x.pdf.md` is the sidecar of `x.pdf`. Both candidate sources are probed and the
   * sidecar is kept when EITHER exists, so a legitimately dotted markdown name
   * (`notes.v2.md`, whose stripped candidate `notes.v2` never exists) is never mistaken
   * for an orphan. Only a sidecar with no possible source left is deleted.
   *
   * The folder roll-up (`_folder.md`) belongs to the folder, not to a document, and is
   * always skipped here — it is rewritten (or, for an emptied folder, pruned) by the
   * caller.
   *
   * @param {string} folderRel - Space-relative folder path ('' = root).
   * @returns {number} How many orphaned sidecars were deleted.
   */
  pruneOrphanContext(folderRel) {
    const ctxDir = this.ctxDir(folderRel);
    let entries;
    try {
      entries = fs.readdirSync(ctxDir, { withFileTypes: true });
    } catch (_) {
      return 0; // no context directory yet — nothing to prune
    }

    const srcDir = this.absDir(folderRel);
    let pruned = 0;
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === FOLDER_CONTEXT_NAME) continue;

      const candidates = [entry.name];
      if (entry.name.toLowerCase().endsWith('.md')) {
        const stripped = entry.name.slice(0, -3);
        if (path.extname(stripped)) candidates.push(stripped);
      }
      if (candidates.some((name) => fs.existsSync(path.join(srcDir, name)))) continue;

      try {
        fs.unlinkSync(path.join(ctxDir, entry.name));
        pruned++;
        this.logger.info(`Context build: pruned orphan sidecar "${folderRel || '(root)'}/${entry.name}" (source deleted)`);
      } catch (err) {
        this.logger.warn(`Context build: could not prune orphan sidecar ${entry.name}: ${err.message}`);
      }
    }

    this.stats.contextPruned += pruned;
    return pruned;
  }

  /**
   * Delete a folder's roll-up once the folder holds nothing to roll up — every
   * document and subfolder is gone. Leaving it would keep a folder that is now empty
   * advertising the contents it used to have.
   *
   * The folder's `.home.md` is deliberately NOT touched: it is a VISIBLE wiki document
   * and may have been written by hand, so removing it is a content decision, not
   * cleanup. Note that `ensureFolderHome` will rewrite a page it can PROVE it wrote
   * (see its provenance rule) — that is still not licence to delete one here, because
   * deleting is unrecoverable where a rewrite leaves the folder with a landing page.
   * Deleting a home page is the reader's call, from the folder view.
   *
   * @param {string} folderRel - Space-relative folder path ('' = root).
   * @returns {boolean} True when a roll-up was deleted.
   */
  pruneFolderRollup(folderRel) {
    const rollupPath = this.folderContextPath(folderRel);
    if (!fs.existsSync(rollupPath)) return false;

    // The caller reached here because the folder had nothing to SUMMARISE, which is
    // not the same as having nothing in it: `extensions` or `includeDerived:false`
    // narrows what collectFolderDocs returns, so a folder full of markdown can look
    // empty to a run configured for `.txt`, and a folder of PDFs looks empty to a
    // markdown-only run. Deleting a valid roll-up on the strength of that would be
    // data loss caused purely by a run's settings. Confirm against the disk: only a
    // folder with no visible entries left is genuinely empty. (Dot entries don't
    // count — `.home.md` is itself seeded from the roll-up we are about to drop.)
    let entries;
    try {
      entries = fs.readdirSync(this.absDir(folderRel), { withFileTypes: true });
    } catch (_) {
      return false; // can't confirm it's empty (permissions, race) — never guess
    }
    if (entries.some((entry) => !entry.name.startsWith('.'))) {
      return false;
    }

    try {
      fs.unlinkSync(rollupPath);
      this.stats.rollupsPruned++;
      this.logger.info(`Context build: pruned roll-up for now-empty folder "${folderRel || '(root)'}"`);
      return true;
    } catch (err) {
      this.logger.warn(`Context build: could not prune roll-up for "${folderRel || '(root)'}": ${err.message}`);
      return false;
    }
  }

  /**
   * Collect a folder's summarisable documents. Splits a folder tree node into
   * its (non-dot) subfolders, its markdown files, and the binary documents
   * (PDF/DOCX/…) whose text lives only in the platform's space-root
   * `.settings/derived` sidecar. A derived doc is dropped when a real markdown
   * document of the same base name already exists in the folder (that first-class
   * doc wins); its context sidecar keeps the ORIGINAL name plus `.md`
   * (`Foo.pdf` -> `.system/context/Foo.pdf.md`) so the content API serves it as
   * text, never PDF. `docNodes` is markdown-first, then derived binaries — the
   * combined list that drives per-file summaries, the roll-up and the home page.
   *
   * Shared by the full bottom-up walk (`processFolder`) and the targeted
   * single-file path (`runFiles`) so both see an identical folder doc set.
   *
   * @param {Object} node - Folder tree node.
   * @param {string} rel - Space-relative path of the folder.
   * @returns {{childFolders:Object[], fileNodes:Object[], derivedNodes:Object[], docNodes:Object[]}}
   */
  collectFolderDocs(node, rel) {
    const children = Array.isArray(node.children) ? node.children : [];
    const childFolders = children.filter(
      (c) => c && c.type === 'folder' && !String(c.name).startsWith('.')
    );
    const fileNodes = children.filter(
      (c) => c && c.type === 'document' && this.isSummarizable(c.name)
    );

    const mdBases = new Set(fileNodes.map((f) => baseNoExt(f.name).toLowerCase()));
    const derivedNodes = !this.includeDerived ? [] : children
      .filter((c) => c && c.type === 'document'
        && !this.isSummarizable(c.name)
        && !mdBases.has(baseNoExt(c.name).toLowerCase()))
      .map((c) => {
        const derivedTextPath = this.derivedTextPathFor(rel, c.name);
        if (!derivedTextPath) return null;
        let modified;
        try { modified = fs.statSync(derivedTextPath).mtimeMs; } catch (_) { modified = undefined; }
        return { type: 'document', name: c.name, path: c.path, contextName: `${c.name}.md`, derivedTextPath, modified };
      })
      .filter(Boolean);

    return { childFolders, fileNodes, derivedNodes, docNodes: fileNodes.concat(derivedNodes) };
  }

  /**
   * Process one folder: children first (bottom-up), then this folder's files,
   * then the folder roll-up. Dot-prefixed directories (.context, .git, …) are
   * skipped.
   *
   * @param {Object} node - Folder tree node.
   * @param {string} rel - Space-relative path of this folder.
   * @param {string} displayName - Name used for the roll-up file + headings.
   * @returns {Promise<{name:string, rel:string, rollupPath:string, overview:string}|null>}
   */
  async processFolder(node, rel, displayName, depth = 0) {
    const indent = this._indent(depth);
    const { childFolders, fileNodes, derivedNodes, docNodes } = this.collectFolderDocs(node, rel);

    this.logger.info(
      `${indent}[DIR] "${rel || '(root)'}" - ${fileNodes.length} file(s)`
      + `${derivedNodes.length ? ` + ${derivedNodes.length} derived` : ''}, ${childFolders.length} subfolder(s)`
    );

    // 0. Clean up before building: a document deleted while nothing was watching
    // (backend down, `git checkout` under a symlinked repo folder, a bulk removal)
    // raised no event, so its sidecar is still here and would be folded back into
    // the roll-up below. The sweep is the one pass that visits every folder.
    this.pruneOrphanContext(rel);

    // 1. Bottom-up: process subfolders first.
    const childResults = [];
    for (const cf of childFolders) {
      const childRel = normalizeRel(cf.path);
      const r = await this.processFolder(cf, childRel, cf.name, depth + 1);
      if (r) childResults.push(r);
    }

    // 2. Per-file context summaries for this folder.
    const fileSummaries = [];
    let fileChanged = false;
    let idx = 0;
    for (const fn of docNodes) {
      idx++;
      try {
        const { summary, changed } = await this.ensureFileContext(fn, rel, depth, idx, docNodes.length);
        fileSummaries.push({ name: fn.name, summary });
        if (changed) fileChanged = true;
      } catch (err) {
        this.stats.filesFailed++;
        this.logger.warn(`${indent}  ! [${idx}/${docNodes.length}] ${fn.name}: FAILED - ${err.message}`);
        // Fall back to an existing sidecar so a transient failure doesn't churn
        // the roll-up (and doesn't count as a change that bubbles up).
        let prev = '';
        try { prev = fs.readFileSync(this.fileContextPath(rel, fn.contextName || fn.name), 'utf8').trim(); } catch (_) {}
        fileSummaries.push({ name: fn.name, summary: prev || '(summary unavailable)' });
      }
    }

    // Nothing here and nothing beneath -> no roll-up (keeps empty folders clean).
    // A roll-up from a previous run is now stale — the folder has been emptied since —
    // so it goes too, rather than describing contents that are gone.
    if (fileSummaries.length === 0 && childResults.length === 0) {
      this.pruneFolderRollup(rel);
      return null;
    }

    // 3. Folder roll-up — only (re)written when something below actually changed
    // (a file's summary changed, or a subfolder bubbled up), so an unchanged
    // subtree costs no AI calls. A rebuild here marks this folder changed too, so
    // the change keeps bubbling up to the parent.
    const folderName = displayName || path.basename(this.absDir(rel)) || this.space.name;
    const rollupPath = this.folderContextPath(rel);
    const childChanged = childResults.some((c) => c.changed);
    const needRollup = this.force || fileChanged || childChanged || !fs.existsSync(rollupPath);

    let overview;
    let changed;
    if (needRollup) {
      const why = this.force ? 'force' : (fileChanged ? 'a file changed' : (childChanged ? 'a subfolder changed' : 'no existing roll-up'));
      this.logger.info(`${indent}  * roll-up "${folderName}" (${why}) - asking AI for overview…`);
      const tRoll = Date.now();
      overview = (await this.writeFolderRollup(rel, folderName, fileSummaries, childResults)).overview;
      this.stats.foldersProcessed++;
      changed = true;
      this.logger.info(`${indent}  * roll-up "${folderName}" written in ${this._elapsed(tRoll)}`);
    } else {
      overview = this.readRollupOverview(rollupPath);
      this.stats.foldersSkipped++;
      changed = false;
      this.logger.info(`${indent}  . roll-up "${folderName}" unchanged - skipped (no AI call)`);
    }

    // ★ EXTRA STEP — now that this folder has a `.context/_folder.md` roll-up,
    // give it a home page if it doesn't already have one (see ensureFolderHome).
    this.ensureFolderHome(rel);

    return { name: displayName, rel, rollupPath, overview, changed };
  }

  /**
   * Ensure the file's context sidecar (`.context/{filename}`, keeping the source
   * file's own name) exists, returning its summary. Reuses an up-to-date sidecar
   * unless `force` is set.
   *
   * @param {Object} fn - Document tree node ({ name, path, modified? }). For a
   *   derived (binary) document it also carries `contextName` (the sidecar file
   *   name, e.g. `Foo.pdf.md`) and `derivedTextPath` (the `.settings/derived`
   *   markdown to summarise instead of reading over the wiki API).
   * @param {string} folderRel - Space-relative path of the file's folder.
   * @param {boolean|null} [forceOverride=null] - Per-call force: `true`/`false`
   *   overrides the processor-wide `this.force`; `null` uses `this.force`. Lets a
   *   targeted run (`runFiles`) force just the changed files while reusing the
   *   folder's other sidecars with no AI call.
   * @returns {Promise<{summary:string, changed:boolean}>}
   */
  async ensureFileContext(fn, folderRel, depth = 0, idx = 0, total = 0, forceOverride = null) {
    const force = forceOverride != null ? forceOverride : this.force;
    const indent = `${this._indent(depth)}  `;
    const tag = total ? `[${idx}/${total}] ` : '';
    const ctxDir = this.ctxDir(folderRel);
    // Derived docs keep the ORIGINAL name + `.md` (contextName); markdown docs
    // keep their own name — both live inside the folder's hidden `.context` dir.
    const sidecar = this.fileContextPath(folderRel, fn.contextName || fn.name);
    const sidecarExists = fs.existsSync(sidecar);

    // Up-to-date reuse: the sidecar exists and — when the source mtime is known
    // (fn.modified, set by the disk source) — it is newer than the source file.
    // Skip the read + AI entirely. When the source mtime is unknown (e.g. the
    // wiki-API source) fall back to reuse-by-existence, as before.
    if (!force && sidecarExists) {
      const upToDate = (fn.modified != null)
        ? fs.statSync(sidecar).mtimeMs >= fn.modified
        : true;
      if (upToDate) {
        this.stats.filesSkipped++;
        this.logger.info(`${indent}- ${tag}${fn.name}: up-to-date, reused (no AI call)`);
        let existing = '';
        try { existing = fs.readFileSync(sidecar, 'utf8').trim(); } catch (_) {}
        return { summary: existing, changed: false };
      }
    }

    // The source is newer (or the sidecar is missing / force) — (re)summarise.
    const tFile = Date.now();
    this.logger.info(`${indent}- ${tag}${fn.name}: ${sidecarExists ? 're-summarising' : 'summarising'}${fn.derivedTextPath ? ' (derived)' : ''}…`);
    // Derived docs are summarised from their `.settings/derived` markdown (read
    // straight off the shared disk); markdown docs go over the wiki API so the
    // read also warms the live content cache.
    const rawContent = fn.derivedTextPath
      ? this._readDerivedText(fn.derivedTextPath)
      : await this.wikiApi.readDocument(this.space.name, fn.path);
    // Strip embedded images BEFORE truncation — otherwise one inline base64
    // data-URI image can fill the entire input window and starve the model of
    // the document's actual text. See stripImages().
    const content = this.stripImages(rawContent);

    let summary;
    if (!content || !content.trim()) {
      const imageOnly = rawContent && rawContent.trim();
      summary = '(empty or unreadable document)';
      this.logger.info(`${indent}    ${fn.name}: ${imageOnly ? 'image-only, no text to summarise' : 'empty/unreadable'} - placeholder summary`);
    } else {
      const input = content.length > this.maxInputChars
        ? `${content.slice(0, this.maxInputChars)}\n...[truncated]`
        : content;
      const strippedChars = rawContent.length - content.length;
      this.logger.info(
        `${indent}    ${fn.name}: ${content.length} chars`
        + `${content.length > this.maxInputChars ? ` (truncated to ${this.maxInputChars})` : ''}`
        + `${strippedChars > 0 ? ` (stripped ${strippedChars} image char(s))` : ''} -> AI…`
      );
      const system = this.prompts.get('document-summary', { maxChars: this.summaryMaxChars });
      const user = `File: ${fn.name}\nPath: ${fn.path}\n\nContent:\n${input}\n\n`
        + `Write the summary (<= ${this.summaryMaxChars} characters) now.`;
      const raw = await this.expert.prompt(system, user);
      summary = this.clean(raw);
      // An empty reply is a FAILURE, never a summary. Writing a placeholder here
      // was silent data loss: under `force` it overwrote a perfectly good sidecar
      // with "(summary unavailable)" and the run still reported success, so a
      // model returning nothing (a reasoning model spending its whole completion
      // budget on hidden reasoning, a content filter, a truncated response) could
      // hollow out a corpus unnoticed. Throwing hands control to the caller, which
      // keeps the existing sidecar and counts the file in `filesFailed`.
      if (!summary) {
        throw new Error('the model returned an empty summary');
      }
      this.logger.info(`${indent}    ${fn.name}: AI replied in ${this._elapsed(tFile)} (${summary.length} chars)`);
    }

    // Significance gate: when a sidecar already existed and the new summary adds
    // no intrinsic value over it, leave it as-is — but touch its mtime so this
    // unchanged file isn't re-summarised on every later run. Skipped under force.
    if (!force && sidecarExists) {
      let prev = '';
      try { prev = fs.readFileSync(sidecar, 'utf8').trim(); } catch (_) {}
      if (!this.isSignificantChange(prev, summary)) {
        // Stamp the sidecar strictly past the source mtime so this unchanged file
        // is reused (not re-summarised) on the next run.
        try {
          const stamp = new Date(Math.max(Date.now(), (fn.modified || 0) + 1000));
          fs.utimesSync(sidecar, stamp, stamp);
        } catch (_) {}
        this.stats.filesUnchanged++;
        this.logger.info(`${indent}    ${fn.name}: no significant change - kept existing summary (${this._elapsed(tFile)})`);
        return { summary: prev, changed: false };
      }
    }

    this.ensureDir(ctxDir);
    fs.writeFileSync(sidecar, summary, 'utf8');
    this.stats.filesSummarized++;
    this.logger.info(`${indent}    ${fn.name}: summary saved (${summary.length} chars, ${this._elapsed(tFile)})`);
    return { summary, changed: true };
  }

  /**
   * Whether a regenerated summary differs enough from the previous one to be
   * worth persisting. Compares word sets (Jaccard similarity); at/above
   * `significanceThreshold` the change is treated as cosmetic. An identical
   * normalised string is never significant; empty -> non-empty always is.
   * @param {string} oldText
   * @param {string} newText
   * @returns {boolean}
   */
  isSignificantChange(oldText, newText) {
    const norm = (t) => String(t == null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim();
    const a = norm(oldText);
    const b = norm(newText);
    if (a === b) return false;
    if (!a) return true;
    const wa = new Set(a.split(' ').filter(Boolean));
    const wb = new Set(b.split(' ').filter(Boolean));
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter++;
    const union = wa.size + wb.size - inter;
    const similarity = union === 0 ? 1 : inter / union;
    return similarity < this.significanceThreshold;
  }

  /**
   * Read just the AI overview paragraph back out of an existing folder roll-up
   * (the text between the `# … folder context` heading and the first `##`
   * section), so an unchanged folder's overview can be propagated to its parent
   * without rebuilding it.
   * @param {string} rollupPath
   * @returns {string}
   */
  readRollupOverview(rollupPath) {
    try {
      const doc = fs.readFileSync(rollupPath, 'utf8');
      const afterHeading = doc.replace(/^#[^\n]*\n+/, '');
      const idx = afterHeading.indexOf('\n## ');
      return (idx >= 0 ? afterHeading.slice(0, idx) : afterHeading).trim();
    } catch (_) {
      return '(overview unavailable)';
    }
  }

  /**
   * Build and write the folder roll-up at `.context/_folder.md`.
   *
   * @param {string} rel - Space-relative folder path.
   * @param {string} folderName - Folder name for the file + headings (computed by the caller).
   * @param {Array<{name:string, summary:string}>} fileSummaries
   * @param {Array<{name:string, overview:string}>} childResults
   * @returns {Promise<{rollupPath:string, overview:string}>}
   */
  async writeFolderRollup(rel, folderName, fileSummaries, childResults) {
    // AI overview synthesised from the file + subfolder summaries. Summaries are
    // inlined here (single line) so the prompt + the markdown bullets stay tidy;
    // the full untruncated text is what was saved to each sidecar.
    const fileList = fileSummaries.map((f) => `- ${f.name}: ${this.inline(f.summary)}`).join('\n') || '(none)';
    const subList = childResults.map((c) => `- ${c.name}: ${this.inline(c.overview) || '(see subfolder context)'}`).join('\n') || '(none)';
    let overview;
    try {
      const system = this.prompts.get('folder-context-overview', { maxChars: this.folderMaxChars });
      const user = `Folder: ${folderName}\n\nFiles in this folder:\n${fileList}\n\nSubfolders:\n${subList}\n\n`
        + `Write the folder overview (<= ${this.folderMaxChars} characters) now.`;
      overview = this.clean(await this.expert.prompt(system, user));
      if (!overview) throw new Error('the model returned an empty overview');
    } catch (err) {
      // The roll-up is still worth writing (its file/subfolder bullets are built
      // deterministically), but its overview must not silently regress to a
      // placeholder: reuse the previous one when there is one, exactly as a failed
      // file summary keeps its existing sidecar.
      // readRollupOverview answers with the placeholder itself when there is no
      // roll-up to read, so treat that as "nothing to keep".
      const existing = this.readRollupOverview(this.folderContextPath(rel));
      const previous = existing && existing !== '(overview unavailable)' ? existing : '';
      this.logger.warn(
        `Context build: folder overview failed for "${folderName}": ${err.message}`
        + (previous ? ' - keeping the previous overview' : '')
      );
      overview = previous || '(overview unavailable)';
    }

    // Compose the deterministic roll-up document. File summaries are inlined in
    // the bullet list so a multi-line summary can't break the markdown.
    const lines = [`# ${folderName} — folder context`, '', overview];
    if (fileSummaries.length) {
      lines.push('', '## Files');
      for (const f of fileSummaries) lines.push(`- **${f.name}**: ${this.inline(f.summary)}`);
    }
    if (childResults.length) {
      lines.push('', '## Subfolders');
      for (const c of childResults) {
        lines.push('', `### ${c.name}`, c.overview || '(see subfolder context)');
      }
    }
    const doc = `${lines.join('\n')}\n`;

    const ctxDir = this.ctxDir(rel);
    this.ensureDir(ctxDir);
    const rollupPath = this.folderContextPath(rel);
    fs.writeFileSync(rollupPath, doc, 'utf8');
    this.stats.rollupsWritten++;

    return { rollupPath, overview };
  }

  /* ==========================================================================
   * ★★★  EXTRA STEP — SEED THE FOLDER HOME PAGE FROM ITS ROLL-UP  ★★★
   * --------------------------------------------------------------------------
   * After a folder's `.system/context/_folder.md` roll-up has been built, give the
   * folder a landing page when it has none: if NONE of the recognised home files
   * exist in the folder ( .home.md / home.md / Home.md ), copy the roll-up content
   * into `.home.md`.
   *
   * Why `.home.md` (dot-prefixed)?
   *   - It is the platform's folder-home convention (the wiki renders it as the
   *     folder's home page).
   *   - Dot-prefixed files are hidden from the file sources (DiskFileSource skips
   *     every "." entry; the wiki tree hides dotfiles), so the page we create is
   *     NOT itself re-summarised on the next run — no sidecar, no churn.
   *
   * ★ PROVENANCE — why this is no longer create-only.
   *
   * The page is a landing page DESCRIBING the folder, so when documents are added
   * the description goes stale; but for a long time the build refused to touch an
   * existing home at all, because a page on disk carries no record of who wrote it
   * and destroying someone's hand-written landing page is far worse than leaving a
   * stale one. The only way to get a refresh was to delete the file by hand — and
   * `.home.md` is hidden from the tree, so there was nowhere to click.
   *
   * `.system/home-seed.json` closes that gap by recording a hash of exactly what we
   * wrote, which turns the two-way guess into a three-way fact:
   *
   *   no home file                    → seed it, record the hash;
   *   `.home.md` + hash still MATCHES → we wrote it, nobody has touched it: refresh;
   *   anything else                   → hand-written, edited since, or unprovable.
   *                                     Leave it alone — permanently.
   *
   * The last branch is the important one: a single human edit transfers ownership of
   * that page for good, and so does every failure (marker missing, corrupt, page
   * unreadable). We only ever overwrite content we can prove is byte-for-byte our
   * own, so the safety property the create-only rule was protecting is unchanged —
   * it is simply no longer paid for by freezing every seeded page at version one.
   * ========================================================================== */
  /**
   * Create `.home.md` from the folder's roll-up, or refresh one we previously
   * seeded and nobody has edited since.
   * @param {string} rel - Space-relative folder path ('' = root).
   * @returns {boolean} True if a home page was written this call.
   */
  ensureFolderHome(rel) {
    const dir = this.absDir(rel);
    const homePath = path.join(dir, SEEDED_HOME_NAME);

    // What the folder already has. Checked as a LIST rather than "any of them",
    // because a hand-written `home.md` sitting beside a seeded `.home.md` wins the
    // display — refreshing the copy nobody sees would be pure churn.
    const present = HOME_FILE_NAMES.filter((name) => fs.existsSync(path.join(dir, name)));

    let seed = null;
    if (present.length) {
      if (present.length > 1 || present[0] !== SEEDED_HOME_NAME) return false;

      seed = this.readHomeSeed(rel);
      if (!seed) return false; // no marker: hand-written, or pre-dates provenance

      let current;
      try {
        current = fs.readFileSync(homePath, 'utf8');
      } catch (_) {
        return false; // can't read it, so can't prove it's ours
      }
      if (this.hashHome(current) !== seed.hash) return false; // edited — theirs now
    }

    // Copy straight from the roll-up we just built (or one from a previous run).
    const rollupPath = this.folderContextPath(rel);
    let rollupDoc;
    try {
      rollupDoc = fs.readFileSync(rollupPath, 'utf8');
    } catch (_) {
      return false; // no roll-up to copy from — nothing to do
    }
    if (!rollupDoc.trim()) return false;

    const body = rollupDoc.replaceAll(" — folder context", ""); // Remove the folder conext in the header
    const hash = this.hashHome(body);

    // Refreshing to identical content: skip the write so the page's mtime keeps
    // saying when it last actually changed.
    if (seed && hash === seed.hash) return false;

    try {
      this.ensureDir(dir);
      fs.writeFileSync(homePath, body, 'utf8');
      this.writeHomeSeed(rel, hash, seed);
      if (seed) {
        this.stats.homesRefreshed++;
        this.logger.info(`Context build: refreshed seeded folder home ${homePath} from ${rollupPath}`);
      } else {
        this.stats.homesSeeded++;
        this.logger.info(`Context build: seeded folder home ${homePath} from ${rollupPath}`);
      }
      return true;
    } catch (err) {
      this.logger.warn(`Context build: could not seed folder home for "${rel || '(root)'}": ${err.message}`);
      return false;
    }
  }
}

module.exports = ContextProcessor;
module.exports.normalizeRel = normalizeRel;
module.exports.relParts = relParts;
