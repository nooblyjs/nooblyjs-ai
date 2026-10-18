/**
 * @fileoverview Search Indexer Service
 * Coordinates file discovery, content loading, and space-aware indexing.
 * Delegates token-based indexing to core SearchTokenService.
 *
 * @author noobly Team
 * @version 2.1.0
 * @since 2025-08-27
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const mime = require('mime-types');
const { getPolicy, toDerivedRelPath, isDerivedRelPath } = require('../../shared/utils/filePolicy');
const { contentRootKey } = require('../../shared/spaces/contentRoot');
const { SidecarStatus } = require('../utils/derivedSidecar');

// Default: only index markdown files for content
const DEFAULT_CONTENT_EXTENSIONS = new Set(['.md']);

// Chunk size for content indexing — keeps each chunk's token budget meaningful
// while letting the whole document be searchable (not just the first 500 tokens).
const CHUNK_SIZE_CHARS = 4000;
const CHUNK_OVERLAP_CHARS = 200;
const MIN_CONTENT_FOR_CHUNKING = CHUNK_SIZE_CHARS;

// A PROVIDER ROW IS NOT A DOCUMENT — see search().
//
// Chunking means a long document occupies several `<path>#chunk-N` rows in the
// engine, and search() folds them back into ONE result. So the rows asked for
// and the documents handed back are different quantities, and the caller's
// `maxResults` is a document budget. Measured on this corpus the fan-out is
// 5–7.4 rows per document (a query matching 1,916 rows yielded 259 documents),
// and the space/type/folder filters in search() discard more still.
//
// The cap keeps a `limit=1000` facet request from pulling tens of megabytes of
// stored fields back on every search: each row carries the document's excerpt
// and headings, so 1,200 rows is ~8.7MB / ~1s against this SOLR, while 3,000 is
// ~21MB / ~4.5s. Override with WIKI_SEARCH_PROVIDER_ROWS.
const CHUNK_FANOUT = 6;
const PROVIDER_ROW_CAP = Number(process.env.WIKI_SEARCH_PROVIDER_ROWS) || 1000;

// Folder-scope helpers. Indexed paths come from path.relative(), which emits OS
// separators (backslashes on Windows), while the UI sends forward-slash paths —
// so both sides are flattened to '/' and trimmed before comparing. A path is
// "under" a folder when it equals the folder or is nested inside it (segment-aware,
// so "services" never matches "services-archive").
function normalizePathPrefix(prefix) {
    return prefix ? String(prefix).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
}
function isUnderPathPrefix(rawPath, normPrefix) {
    if (!normPrefix) return true;
    const norm = String(rawPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return norm === normPrefix || norm.startsWith(normPrefix + '/');
}

/** Space-relative path in the wiki's canonical '/' form (indexing emits OS separators). */
function toPosixRelPath(rawPath) {
    return String(rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Flatten a name or path into space-separated words for loose matching, so a
 * typed "solution design" finds "Solution Design/Overview.md" — and equally
 * "solution-design" or "Solution_Design". Applied to both sides of the compare.
 */
function flattenForMatch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\\/_.+-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Derive the wiki's search-facet fields from a document's space-relative path.
 *
 * The core search engine stays generic — it just stores whatever metadata it is
 * given. These fields are stamped onto that metadata so search results carry the
 * axes the wiki wants to facet by, without the core knowing anything about them:
 *
 *  - folderL1 / folderL2: the first two folder segments beneath the space root
 *    (null when the file is shallower than that level).
 *  - docType: the file name without its extension — the "kind" of document.
 *    These repositories reuse the same file names across many folders
 *    (e.g. "Business Solution", "Cybersecurity"), so this groups like-with-like.
 *    A folder-home file (.home.md / home.md) is labelled "Home".
 *
 * Separators are normalized here because indexed paths arrive with either style
 * (the filing wrapper emits '/', path.relative() emits '\' on Windows).
 *
 * @param {string} relativePath Space-relative path.
 * @return {{ folderL1: (string|null), folderL2: (string|null), docType: string }}
 */
function deriveFacetFields(relativePath) {
    const norm = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const segments = norm ? norm.split('/') : [];
    const folders = segments.slice(0, -1);
    const base = segments.length ? segments[segments.length - 1] : '';

    let docType;
    if (/^\.?home\.md$/i.test(base) || /^\.home(\.|$)/i.test(base)) {
        docType = 'Home';
    } else {
        docType = base.replace(/\.[^.]+$/, '') || base;
    }

    return {
        folderL1: folders[0] || null,
        folderL2: folders[1] || null,
        docType
    };
}

/**
 * Pull the ATX markdown headings (`#`…`######`) out of a document's content into
 * a single lowercased string. Stored on the document metadata at index time so
 * the search re-rank can cheaply tell whether a query term landed in a heading
 * (a strong relevance signal) without re-reading the file.
 *
 * @param {string} content
 * @param {number} [maxChars=2000] Bound the stored string.
 * @return {string} Heading text joined by " · ", lowercased.
 */
function extractHeadings(content, maxChars = 2000) {
    if (!content) return '';
    const out = [];
    for (const line of String(content).split(/\r?\n/)) {
        const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
        if (m && m[1]) out.push(m[1].trim());
    }
    let joined = out.join(' · ').toLowerCase();
    if (joined.length > maxChars) joined = joined.slice(0, maxChars);
    return joined;
}

/**
 * Wiki-side re-rank weights applied on top of the core BM25 score. Each is a
 * multiplier on the base score (1 = no change), so they compose:
 *  - coverage: reward documents that match ALL query terms over partial matches.
 *  - heading:  reward query terms that appear in the document's headings.
 *  - phrase:   reward the exact query phrase appearing in name / headings / excerpt.
 * Tune here; frequency weighting itself lives in BM25's k1 (set where the core
 * search service is constructed).
 */
const RERANK = {
    coverage: 0.6, // up to +60% when every query term is present
    heading: 0.5,  // up to +50% when every query term appears in a heading
    phrase: 1.5    // ×1.5 when the exact phrase is found
};

/** Union two (possibly undefined) arrays of matched terms, deduped. */
function unionTerms(a, b) {
    if (!a && !b) return [];
    return [...new Set([...(a || []), ...(b || [])])];
}

class SearchIndexer {
    /**
     * Initializes the search indexer.
     * @param {Object} logger - Logger instance
     * @param {Object} spacesDataManager - Data manager for spaces
     * @param {Object} tokenService - Core SearchTokenService (optional; creates fallback if null)
     * @param {Object} filingServiceWrapper - Filing service wrapper (optional)
     * @param {Object} options - Configuration options
     */
    constructor(logger, spacesDataManager, tokenService = null, filingServiceWrapper = null, options = {}) {
        this.logger = logger;
        this.spacesDataManager = spacesDataManager;
        this.filingServiceWrapper = filingServiceWrapper;
        this.tokenService = tokenService;

        // Use appBaseDir from options/env, fall back to legacy hardcoded path
        const appBaseDir = options.appBaseDir
            || process.env.APP_BASE_DIR
            || path.resolve(__dirname, '../../../.application');

        this.documentsDir = path.resolve(__dirname, '../..', 'documents');
        this.documentsSharedDir = path.resolve(__dirname, '../..', 'documents-shared');
        this.documentsReadonlyDir = path.resolve(__dirname, '../..', 'documents-readonly');
        this.docsDir = path.resolve(__dirname, '../..', 'docs');
        this.isIndexing = false;
        this.lastIndexTime = null;

        // Debounced disk-persist timer for incremental updates (see _schedulePersist).
        this._persistTimer = null;

        // Disk-based index storage directory
        this.indexDir = path.join(appBaseDir, 'searchindex');

        // Configurable: which extensions to content-index
        // Default: only .md files to keep memory and index size manageable
        this.contentExtensions = DEFAULT_CONTENT_EXTENSIONS;

        // Repairs a document's derived markdown sidecar when it is missing or
        // stale. Injected (see setDerivedSidecarResolver) rather than required
        // here so the indexer keeps its read-only dependency surface and stays
        // trivially testable; absent, indexing behaves exactly as before.
        this._ensureDerived = null;

        // Counters for the derived-content health of the LAST full index build —
        // reported by getStats() so a corpus indexing by file name only is
        // visible instead of silent. Reset at the start of each build.
        this._derivedStats = this._emptyDerivedStats();

        // Fallback implementation (if no tokenService provided)
        this._useFallback = !tokenService;
        if (this._useFallback) {
            this.index = {
                files: new Map(),
                tokens: new Map(),
            };
        }
    }

    /**
     * Set filing service wrapper after initialization
     */
    setFilingServiceWrapper(wrapper) {
        this.filingServiceWrapper = wrapper;
    }

    /**
     * Supply the function that keeps derived markdown sidecars up to date.
     *
     * Binary documents whose policy is `search: 'markdown'` — PDFs above all —
     * carry their text ONLY in `<folder>/.system/derived/<name>.<ext>.md`. That
     * sidecar is normally written by the file watcher when the document is added
     * or changed, but the watcher starts with `ignoreInitial: true` and therefore
     * never sees a file that was already on disk: a corpus copied in while the
     * backend was down, restored from backup, or pulled into a symlinked git-repo
     * folder arrives with no sidecars at all. Those documents index by FILE NAME
     * ONLY, which is indistinguishable from working search until someone searches
     * for a phrase inside a PDF.
     *
     * An index build already walks every file in every space, so it is the one
     * pass that can find and repair them. Wiring this in makes that happen; the
     * indexed document is still keyed by the ORIGINAL's path, so the search result
     * continues to reference — and open — the PDF itself.
     *
     * @param {function(string, string): Promise<{status: string, written: boolean}>} resolver
     *   Called as (spaceName, spaceRelativePath).
     */
    setDerivedSidecarResolver(resolver) {
        this._ensureDerived = typeof resolver === 'function' ? resolver : null;
    }

    /** @return {Object} A zeroed derived-content counter set. @private */
    _emptyDerivedStats() {
        return {
            /** Documents whose policy requires a derived sidecar. */
            candidates: 0,
            /** …of those, ones written during this pass (missing or stale). */
            generated: 0,
            /** …ones whose conversion failed (corrupt/protected source). */
            failed: 0,
            /** …ones with no Node-side converter at all (e.g. .pptx). */
            unsupported: 0,
            /** …ones still with no readable text after the repair attempt. */
            withoutContent: 0
        };
    }

    /**
     * Bump a derived-content counter, but only while a full build is running.
     *
     * The counters describe ONE corpus-wide pass — "of everything indexed, this
     * many PDFs still have no text". Incremental single-file updates run through
     * the same code, and letting them accumulate would turn that into a
     * meaningless running total that only ever grows with uptime. `isIndexing` is
     * true for exactly the duration of buildIndex() (and incremental updates
     * no-op while it is), so it is the precise gate.
     * @private
     */
    _countDerived(key) {
        if (this.isIndexing) this._derivedStats[key]++;
    }

    /**
     * Make sure a binary document's derived sidecar exists and is newer than its
     * source, so the read that follows indexes real text instead of nothing.
     * No-ops (and stays silent) when no resolver is wired.
     * @private
     */
    async _ensureDerivedContent(spaceName, relativePath) {
        this._countDerived('candidates');
        if (!this._ensureDerived) return;

        try {
            const result = await this._ensureDerived(spaceName, relativePath);
            if (!result) return;
            if (result.written) {
                this._countDerived('generated');
                this.logger.info(`[SearchIndexer] Derived missing markdown for ${spaceName}/${relativePath}`);
            } else if (result.status === SidecarStatus.FAILED) {
                this._countDerived('failed');
            } else if (result.status === SidecarStatus.UNSUPPORTED) {
                this._countDerived('unsupported');
            }
        } catch (error) {
            this._countDerived('failed');
            this.logger.warn(`[SearchIndexer] Could not derive content for ${spaceName}/${relativePath}: ${error.message}`);
        }
    }

    /**
     * Configure which file extensions are content-indexed.
     * @param {string[]} extensions - Array of extensions like ['.md', '.txt']
     */
    setContentExtensions(extensions) {
        this.contentExtensions = new Set(extensions.map(e => e.startsWith('.') ? e : '.' + e));
    }

    // ─── Index Building ──────────────────────────────────────────────

    /**
     * Build complete search index.
     * Tries to load from disk first; rebuilds if unavailable or forced.
     * @param {Object} options
     * @param {boolean} options.force - Force full rebuild even if disk index exists
     */
    async buildIndex(options = {}) {
        if (this.isIndexing) {
            this.logger.warn('Indexing already in progress');
            return;
        }

        this.isIndexing = true;
        this.logger.info('Starting search index build...');

        try {
            // Try loading from disk first (unless forced)
            if (!options.force && this.tokenService) {
                const loaded = await this.tokenService.loadFromDisk('default');
                if (loaded) {
                    this.lastIndexTime = new Date();
                    this.isIndexing = false;
                    return;
                }
            } else if (!options.force && this._useFallback) {
                const loaded = await this._loadIndexFromDisk();
                if (loaded) {
                    this.isIndexing = false;
                    return;
                }
            }

            // Clear existing index. MUST complete before the rebuild starts: on
            // an external store the clear is a delete-by-query over the whole
            // container, so running it concurrently with indexing deletes the
            // documents the rebuild has just written.
            await this.clearIndex();
            this._derivedStats = this._emptyDerivedStats();

            // Build from source
            if (this.filingServiceWrapper) {
                try {
                    const spaces = this.spacesDataManager.getAllSpaces ?
                        this.spacesDataManager.getAllSpaces() :
                        await this.spacesDataManager.read('spaces');

                    this.logger.info(`[SearchIndexer] Indexing ${spaces.length} spaces`);

                    // One pass per CONTENT ROOT, not per space.
                    //
                    // Index entries are keyed by the space-relative path alone
                    // (see _indexFileIntoService — `tokenService.indexDocument(
                    // relativePath, …)` and `this.index.files.set(relativePath,
                    // …)`, neither carrying a space prefix). So when several
                    // spaces share a content root they produce the SAME keys and
                    // simply overwrite one another: the finished index is
                    // whatever the last space wrote, and every earlier pass was
                    // discarded work. With four spaces on one 30,000-file root
                    // that is ~120,000 file reads to produce 30,000 entries.
                    //
                    // Indexing the LAST space of each group keeps the result
                    // byte-identical to the old behaviour — same keys, same
                    // `spaceName` stamped on them — at a quarter of the I/O.
                    // That I/O is not free elsewhere: it saturates libuv's
                    // threadpool and starves the folder-tree walk (see the
                    // UV_THREADPOOL_SIZE note in app.js).
                    const groups = new Map();
                    for (const space of spaces) {
                        const root = this._contentRootKey(space);
                        groups.set(root, space);   // last space on a root wins
                    }

                    if (groups.size < spaces.length) {
                        this.logger.info(
                            `[SearchIndexer] ${spaces.length} space(s) resolve to ${groups.size} content root(s) — `
                            + 'indexing each root once (entries are keyed by path, so extra passes only overwrite)'
                        );
                    }

                    for (const space of groups.values()) {
                        this.logger.info(`[SearchIndexer] Indexing space: "${space.name}" (id: ${space.id})`);
                        try {
                            await this.indexSpaceWithWrapper(space.name);
                        } catch (spaceError) {
                            this.logger.error(`[SearchIndexer] Failed to index space "${space.name}":`, spaceError.message);
                            throw spaceError;
                        }
                    }
                    this.logger.info('[SearchIndexer] All spaces indexed successfully');
                } catch (error) {
                    this.logger.warn(`[SearchIndexer] Wrapper failed, falling back to filesystem: ${error.message}`);
                    await this.indexDirectory(this.documentsDir, 'Personal Space');
                    await this.indexDirectory(this.documentsSharedDir, 'Shared Space');
                    await this.indexDirectory(this.documentsReadonlyDir, 'Read-Only Space');
                }
            } else {
                await this.indexDirectory(this.documentsDir, 'Personal Space');
                await this.indexDirectory(this.documentsSharedDir, 'Shared Space');
                await this.indexDirectory(this.documentsReadonlyDir, 'Read-Only Space');
            }

            this.lastIndexTime = new Date();
            this.logger.info('[SearchIndexer] Index built successfully');
            this._logDerivedSummary();

            // Persist to disk
            if (this.tokenService) {
                await this.tokenService.saveToDisk('default');
            } else if (this._useFallback) {
                await this._saveIndexToDisk();
            }

        } catch (error) {
            // Surface loudly: a provider/interface mismatch (e.g. a search
            // provider missing indexDocument/loadFromDisk) used to be swallowed
            // here, leaving the index silently empty. Log with stack and
            // re-throw so the caller's .catch reports it too.
            this.logger.error('[SearchIndexer] Index build FAILED — the index is empty/stale.');
            this.logger.error(`[SearchIndexer] Reason: ${error && error.message}`);
            if (error && error.stack) this.logger.error(error.stack);
            this.isIndexing = false;
            throw error;
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Log how the build fared on documents that depend on a derived sidecar.
     * A PDF-heavy corpus indexing by file name only otherwise leaves no trace in
     * the logs at all — the read failure is a debug-level line per file.
     * @private
     */
    _logDerivedSummary() {
        const d = this._derivedStats;
        if (d.candidates === 0) return;

        this.logger.info(
            `[SearchIndexer] Derived content: ${d.candidates} document(s) need a markdown sidecar — `
            + `${d.generated} generated this build, ${d.withoutContent} still indexed by file name only `
            + `(${d.unsupported} unsupported type, ${d.failed} conversion failure(s)).`
        );

        if (d.withoutContent > 0 && !this._ensureDerived) {
            this.logger.warn(
                '[SearchIndexer] No derived-sidecar resolver is wired, so missing sidecars cannot be '
                + 'repaired during indexing — those documents are searchable by name only.'
            );
        }
    }

    /**
     * The content root a space's documents live under, normalised for grouping.
     * Thin alias over shared/spaces/contentRoot.js, which DocumentService and
     * the search route also use — the grouping done here decides which space
     * NAME every document is stamped with, and the route decides which stamps
     * a request accepts, so the two must never drift.
     * @param {Object} space
     * @return {string}
     * @private
     */
    _contentRootKey(space) {
        return contentRootKey(space);
    }

    /**
     * Index a space using filing service wrapper
     */
    async indexSpaceWithWrapper(spaceName) {
        try {
            const files = await this.filingServiceWrapper.getAllFilesRecursive(spaceName, '');

            for (const filePath of files) {
                try {
                    await this.indexFileWithWrapper(spaceName, filePath);
                } catch (error) {
                    this.logger.warn(`Error indexing file ${spaceName}/${filePath}:`, error.message);
                }
            }
        } catch (error) {
            this.logger.warn(`Error indexing space ${spaceName} with wrapper:`, error.message);
            throw error;
        }
    }

    /**
     * Index a file using wrapper
     */
    async indexFileWithWrapper(spaceName, filePath) {
        try {
            // Never index a derived markdown sidecar as its own document — its
            // content is indexed under the original it was derived from, so the
            // search result opens the original (office → markdown view, pdf → pdf).
            if (isDerivedRelPath(filePath)) return;

            const fileName = path.basename(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';
            const policy = getPolicy(filePath);

            const fileInfo = {
                path: filePath,
                relativePath: filePath,
                name: fileName,
                title: fileName,
                extension: ext,
                mimeType: mimeType,
                type: this.getFileType(ext, mimeType),
                spaceName: spaceName,
                isIndexed: false,
                excerpt: ''
            };

            // Pick the content source per policy: office/pdf index their derived
            // markdown sidecar; text/code/data index the original; everything else
            // (images, video, audio, binaries) is metadata-only.
            const contentSource =
                policy.search === 'markdown' ? toDerivedRelPath(filePath) :
                policy.search === 'original' ? filePath : null;

            // A PDF or office document has no indexable text of its own — the
            // sidecar is all of it. Repair a missing or stale one BEFORE the read
            // below, so this pass indexes the document's real content rather than
            // just its file name. The indexed key stays `filePath` either way, so
            // the search result still references the PDF itself.
            if (policy.search === 'markdown') {
                await this._ensureDerivedContent(spaceName, filePath);
            }

            let content = '';
            if (contentSource) {
                try {
                    const contentData = await this.filingServiceWrapper.readDocument(spaceName, contentSource);
                    if (contentData) {
                        content = Buffer.isBuffer(contentData) ? contentData.toString('utf8') : String(contentData);
                        fileInfo.isIndexed = true;
                        fileInfo.excerpt = this.generateExcerpt(content);
                    }
                } catch (error) {
                    // Still no content after the repair above: an unsupported type
                    // (.pptx has no Node-side converter) or a source that could not
                    // be parsed. The file remains findable by name/path below.
                    this.logger.debug(`Could not read indexable content for ${filePath} (${contentSource}):`, error.message);
                }
            }

            if (policy.search === 'markdown' && !fileInfo.isIndexed) {
                this._countDerived('withoutContent');
            }

            // Index the file (always under the original path)
            await this._indexFileIntoService(filePath, content, fileInfo);

        } catch (error) {
            this.logger.warn(`Error indexing file ${filePath}:`, error.message);
        }
    }

    /**
     * Index a directory recursively
     */
    async indexDirectory(dirPath, spaceName) {
        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(dirPath, item.name);

                let baseDir;
                if (spaceName === 'Personal Space') baseDir = this.documentsDir;
                else if (spaceName === 'Shared Space') baseDir = this.documentsSharedDir;
                else if (spaceName === 'Read-Only Space') baseDir = this.documentsReadonlyDir;
                else baseDir = this.docsDir;

                const relativePath = path.relative(baseDir, itemPath);

                // Skip hidden dot-folders — the folder-local `.settings` namespace
                // (which holds the `derived/` markdown sidecars) and the per-space
                // `.system` namespace (originals/context/useractivity/
                // continuous-explorations/archive). These hold app-internal data
                // that must never surface in wiki search, mirroring the file-tree's
                // filter. Derived sidecars are still indexed — but under their
                // ORIGINAL's path via indexFile() below, never standalone.
                if (item.isDirectory() && item.name.startsWith('.')) {
                    continue;
                }

                if (item.isDirectory()) {
                    await this.indexDirectory(itemPath, spaceName);
                } else if (item.isFile()) {
                    await this.indexFile(itemPath, relativePath, spaceName);
                }
            }
        } catch (error) {
            this.logger.warn(`Could not index directory ${dirPath}:`, error.message);
        }
    }

    /**
     * Index a single file
     */
    async indexFile(filePath, relativePath, spaceName) {
        try {
            const stats = await fs.stat(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const fileName = path.basename(filePath);
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';

            // Skip derived sidecars — indexed under their original, not standalone.
            if (isDerivedRelPath(relativePath)) return;

            const policy = getPolicy(filePath);

            const fileInfo = {
                path: filePath,
                relativePath: relativePath,
                name: fileName,
                title: fileName,
                size: stats.size,
                extension: ext,
                mimeType: mimeType,
                type: this.getFileType(ext, mimeType),
                spaceName: spaceName,
                modifiedTime: stats.mtime,
                isIndexed: false,
                excerpt: ''
            };

            // office/pdf → derived markdown sidecar; text → original; else metadata-only.
            let contentPath = null;
            if (policy.search === 'markdown') {
                contentPath = path.join(this._getBaseDir(spaceName), toDerivedRelPath(relativePath));
            } else if (policy.search === 'original') {
                contentPath = filePath;
            }

            // Same sidecar repair as the wrapper path above — see
            // setDerivedSidecarResolver for why an index pass is where it belongs.
            if (policy.search === 'markdown') {
                await this._ensureDerivedContent(spaceName, relativePath);
            }

            let content = '';
            if (contentPath) {
                try {
                    content = await fs.readFile(contentPath, 'utf8');
                    fileInfo.isIndexed = true;
                    fileInfo.excerpt = this.generateExcerpt(content);
                } catch (error) {
                    this.logger.debug(`Could not read indexable content for ${filePath} (${contentPath}):`, error.message);
                }
            }

            if (policy.search === 'markdown' && !fileInfo.isIndexed) {
                this._countDerived('withoutContent');
            }

            // Index the file (always under the original relative path)
            await this._indexFileIntoService(relativePath, content, fileInfo);

        } catch (error) {
            this.logger.warn(`Could not index file ${filePath}:`, error.message);
        }
    }

    /**
     * Internal helper: Index a file using token service or fallback.
     * Long documents are chunked so the whole document is searchable, not just
     * the first ~500 tokens. Each chunk is its own indexed entry; search results
     * are deduplicated back to the parent document.
     * @private
     */
    async _indexFileIntoService(relativePath, content, fileInfo) {
        // Stamp the wiki facet fields (Folder L1 / Folder L2 / Type) onto the
        // metadata so every search result carries them. Chunk sub-documents
        // spread fileInfo below, so they inherit these too.
        const facets = deriveFacetFields(relativePath);
        fileInfo.folderL1 = facets.folderL1;
        fileInfo.folderL2 = facets.folderL2;
        fileInfo.docType = facets.docType;

        // Capture headings for the search re-rank (heading-match boost). Taken
        // from the raw content before noise-stripping so `#` lines survive.
        fileInfo.headings = extractHeadings(content);

        const cleanedContent = this._stripIndexingNoise(content || '');

        // Build a header string from the file name + path so name/path tokens
        // are always indexed even when the content is empty or fully stripped.
        const header = `${fileInfo.name || ''} ${relativePath.replace(/[\/\\]/g, ' ')}`;

        if (this.tokenService) {
            const chunks = this._chunkContent(cleanedContent);

            if (chunks.length <= 1) {
                // Small/empty doc — single entry, content + header tokens
                const combined = `${header}\n${cleanedContent}`;
                await this.tokenService.indexDocument(relativePath, combined, fileInfo, 'default');
                return;
            }

            // Large doc — index each chunk as a sub-document. Search dedupes by parentPath.
            for (let i = 0; i < chunks.length; i++) {
                const chunkId = `${relativePath}#chunk-${i}`;
                const chunkContent = i === 0
                    ? `${header}\n${chunks[i]}` // first chunk also carries name/path tokens
                    : chunks[i];
                const chunkInfo = {
                    ...fileInfo,
                    parentPath: relativePath,
                    chunkIndex: i,
                    chunkCount: chunks.length
                };
                await this.tokenService.indexDocument(chunkId, chunkContent, chunkInfo, 'default');
            }
        } else if (this._useFallback) {
            // Fallback: use internal index
            const nameTokens = this.tokenize(fileInfo.name);
            nameTokens.forEach(token => this._addTokenToIndex(token, relativePath));

            const pathTokens = this.tokenize(relativePath.replace(/[\/\\]/g, ' '));
            pathTokens.forEach(token => this._addTokenToIndex(token, relativePath));

            if (cleanedContent) {
                this._indexContentTokens(cleanedContent, relativePath);
            }

            this.index.files.set(relativePath, fileInfo);
        }
    }

    /**
     * Strip indexing noise that wastes the per-doc token budget:
     *  - data: URIs (base64 images embedded in markdown)
     *  - long base64-looking blobs
     *  - HTML tags
     * @private
     */
    _stripIndexingNoise(content) {
        if (!content) return '';
        return content
            // Markdown image with data URI: ![alt](data:image/png;base64,....)
            .replace(/!\[[^\]]*\]\(data:[^)]+\)/gi, ' ')
            // Bare data: URIs
            .replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=\s]+/gi, ' ')
            // Long base64-looking runs (40+ chars of base64 alphabet) outside data URIs
            .replace(/[A-Za-z0-9+/]{60,}={0,2}/g, ' ')
            // HTML tags
            .replace(/<[^>]+>/g, ' ');
    }

    /**
     * Split content into overlapping chunks so the whole document is indexed,
     * not just the first ~500 tokens. Tries to split on whitespace boundaries.
     * @private
     */
    _chunkContent(content) {
        if (!content || content.length <= MIN_CONTENT_FOR_CHUNKING) {
            return content ? [content] : [];
        }

        const chunks = [];
        let start = 0;

        while (start < content.length) {
            let end = Math.min(start + CHUNK_SIZE_CHARS, content.length);

            // Snap to whitespace if we're not at the end of the doc
            if (end < content.length) {
                const ws = content.lastIndexOf(' ', end);
                if (ws > start + CHUNK_SIZE_CHARS / 2) {
                    end = ws;
                }
            }

            chunks.push(content.substring(start, end));

            if (end >= content.length) break;
            start = end - CHUNK_OVERLAP_CHARS;
            if (start < 0) start = 0;
        }

        return chunks;
    }

    /**
     * Clear the search index.
     *
     * ASYNC BECAUSE THE PROVIDER MAY BE REMOTE. The embedded `tokens` provider
     * clears a Map and returns synchronously, so this used to be a plain call.
     * SOLR's clearIndex is a getStats + delete-by-query over HTTP: dropping the
     * returned promise made every failure an *unhandled rejection*, which
     * app.js turns into process.exit(1) — a 10s axios timeout on the stats
     * query was enough to kill the backend at boot, since the SOLR compat shim
     * makes loadFromDisk return false and so every boot rebuilds.
     */
    async clearIndex() {
        if (this.tokenService) {
            await this.tokenService.clearIndex('default');
        } else if (this._useFallback) {
            this.index.files.clear();
            this.index.tokens.clear();
        }
    }

    // ─── Internal Helpers (Fallback) ──────────────────────────────────

    /**
     * Tokenize text into searchable tokens (deduplicated).
     * Minimum token length of 3 to avoid noise from short fragments.
     */
    tokenize(text) {
        if (!text) return [];

        const STOP_WORDS = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
        ]);

        const tokens = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length >= 3)
            .filter(token => !STOP_WORDS.has(token));

        // Deduplicate
        return [...new Set(tokens)];
    }

    /**
     * Add token to search index (fallback)
     * @private
     */
    _addTokenToIndex(token, filePath) {
        if (!this.index.tokens.has(token)) {
            this.index.tokens.set(token, new Set());
        }
        this.index.tokens.get(token).add(filePath);
    }

    /**
     * Tokenize content and add to the token index (fallback)
     * @private
     */
    _indexContentTokens(content, filePath) {
        const contentTokens = this.tokenize(content).slice(0, 500);
        contentTokens.forEach(token => this._addTokenToIndex(token, filePath));
    }

    /**
     * Save index to disk (fallback)
     * @private
     */
    async _saveIndexToDisk() {
        try {
            await fs.mkdir(this.indexDir, { recursive: true });

            const filesObj = {};
            for (const [key, fileInfo] of this.index.files) {
                filesObj[key] = { ...fileInfo };
            }
            await fs.writeFile(
                path.join(this.indexDir, 'files-metadata.json'),
                JSON.stringify(filesObj, null, 0),
                'utf8'
            );

            const tokensObj = {};
            for (const [token, pathSet] of this.index.tokens) {
                tokensObj[token] = Array.from(pathSet);
            }
            await fs.writeFile(
                path.join(this.indexDir, 'tokens-index.json'),
                JSON.stringify(tokensObj, null, 0),
                'utf8'
            );

            await fs.writeFile(
                path.join(this.indexDir, 'index-info.json'),
                JSON.stringify({
                    lastIndexTime: this.lastIndexTime,
                    totalFiles: this.index.files.size,
                    totalTokens: this.index.tokens.size,
                    contentExtensions: Array.from(this.contentExtensions),
                    version: '2.0.0'
                }, null, 2),
                'utf8'
            );

            this.logger.info(`[SearchIndexer] Index saved to disk: ${this.index.files.size} files, ${this.index.tokens.size} tokens`);
        } catch (error) {
            this.logger.error(`[SearchIndexer] Failed to save index to disk: ${error.message}`);
        }
    }

    /**
     * Load index from disk (fallback)
     * @private
     */
    async _loadIndexFromDisk() {
        try {
            const infoPath = path.join(this.indexDir, 'index-info.json');
            await fs.access(infoPath);

            const info = JSON.parse(await fs.readFile(infoPath, 'utf8'));

            if (info.version !== '2.0.0') {
                this.logger.info('[SearchIndexer] Index version mismatch, will rebuild');
                return false;
            }

            // Expire disk index after 24 hours
            if (info.lastIndexTime) {
                const indexAge = Date.now() - new Date(info.lastIndexTime).getTime();
                const maxAge = 24 * 60 * 60 * 1000;
                if (indexAge > maxAge) {
                    this.logger.info(`[SearchIndexer] Disk index is ${Math.round(indexAge / 3600000)}h old, will rebuild`);
                    return false;
                }
            }

            // Load files metadata
            const filesJson = await fs.readFile(path.join(this.indexDir, 'files-metadata.json'), 'utf8');
            const filesObj = JSON.parse(filesJson);
            this.index.files.clear();
            for (const [key, value] of Object.entries(filesObj)) {
                this.index.files.set(key, value);
            }

            // Load token index
            const tokensJson = await fs.readFile(path.join(this.indexDir, 'tokens-index.json'), 'utf8');
            const tokensObj = JSON.parse(tokensJson);
            this.index.tokens.clear();
            for (const [token, paths] of Object.entries(tokensObj)) {
                this.index.tokens.set(token, new Set(paths));
            }

            this.lastIndexTime = info.lastIndexTime ? new Date(info.lastIndexTime) : null;
            this.logger.info(`[SearchIndexer] Loaded index from disk: ${this.index.files.size} files, ${this.index.tokens.size} tokens`);
            return true;
        } catch (error) {
            this.logger.debug(`[SearchIndexer] No valid index on disk: ${error.message}`);
            return false;
        }
    }

    // ─── Search ──────────────────────────────────────────────────────

    /**
     * Search the index.
     */
    async search(query, options = {}) {
        const {
            maxResults = 200,
            includeContent = false,
            fileTypes = [],
            spaceNames = [],
            pathPrefix = ''
        } = options;

        if (!query || query.trim().length < 2) {
            return [];
        }

        // Optional folder scope: keep only results whose space-relative path is the
        // folder itself or sits inside it.
        const normPrefix = normalizePathPrefix(pathPrefix);
        const underPrefix = (result) =>
            isUnderPathPrefix(result.relativePath || result.path || '', normPrefix);

        let searchResults;

        if (this.tokenService) {
            // Ask the engine for a ROW budget, not the caller's DOCUMENT budget.
            //
            // `maxResults` used to be applied only to the final slice below, and
            // the container name was the only thing passed to the provider — so
            // every query fell back to the provider's own default row count
            // (SOLR's is 50) no matter what the caller asked for. Fifty chunk
            // rows are ~9 documents once the dedupe below folds them together,
            // which is what a 43,000-document index looked like from the UI: a
            // handful of results for everything, a facet universe built from
            // those same nine, and AI chat grounded on them too.
            //
            // Scaling by the chunk fan-out restores the caller's budget; the cap
            // bounds the payload (see CHUNK_FANOUT / PROVIDER_ROW_CAP above).
            const providerRows = Math.min(Math.max(maxResults, 1) * CHUNK_FANOUT, PROVIDER_ROW_CAP);

            // Use core token service (async call must be awaited)
            const coreResults = await this.tokenService.search(query, {
                containerName: 'default',
                maxResults: providerRows
            });

            // Dedupe chunked sub-documents back to a single result per parent path.
            // The new core API spreads stored fields (path, spaceName, type, …) at
            // the top of each result instead of nesting them under .metadata, so
            // read them directly off the result. Chunks share parentPath; sum
            // their scores and keep the best chunk's metadata.
            const byParent = new Map();
            for (const result of coreResults) {
                const parentKey = result.parentPath || result.path || result.relativePath || result.key;
                const canonicalPath = result.parentPath || result.path || result.relativePath;
                const existing = byParent.get(parentKey);
                // Union the matched query terms across a document's chunks so the
                // re-rank's "all terms present" coverage is accurate even when the
                // terms are spread over different chunks.
                const mergedTerms = unionTerms(existing && existing.terms, result.terms);
                if (!existing || result.score > existing.score) {
                    byParent.set(parentKey, {
                        ...result,
                        path: canonicalPath,
                        relativePath: canonicalPath,
                        score: (existing ? existing.score : 0) + result.score,
                        terms: mergedTerms
                    });
                } else {
                    existing.score += result.score;
                    existing.terms = mergedTerms;
                }
            }

            const filtered = Array.from(byParent.values())
                .filter(result => {
                    if (fileTypes.length > 0 && !fileTypes.includes(result.type)) return false;
                    if (spaceNames.length > 0 && !spaceNames.includes(result.spaceName)) return false;
                    if (!underPrefix(result)) return false;
                    return true;
                });
            this._rerank(filtered, query);
            searchResults = filtered
                .sort((a, b) => b.score - a.score)
                .slice(0, maxResults);
        } else if (this._useFallback) {
            // Fallback: brute-force search
            const queryTokens = this.tokenize(query.trim());
            const results = new Map();

            queryTokens.forEach(token => {
                if (this.index.tokens.has(token)) {
                    const matchingFiles = this.index.tokens.get(token);
                    matchingFiles.forEach(filePath => {
                        const currentScore = results.get(filePath) || 0;
                        results.set(filePath, currentScore + 1);
                    });
                }
            });

            const filtered = Array.from(results.entries())
                .map(([filePath, score]) => {
                    const fileInfo = this.index.files.get(filePath);
                    if (!fileInfo) return null;
                    // Expose which query tokens hit so the re-rank can score coverage.
                    const terms = queryTokens.filter(t => this.index.tokens.get(t)?.has(filePath));
                    return { ...fileInfo, score, terms };
                })
                .filter(result => {
                    if (!result) return false;
                    if (fileTypes.length > 0 && !fileTypes.includes(result.type)) return false;
                    if (spaceNames.length > 0 && !spaceNames.includes(result.spaceName)) return false;
                    if (!underPrefix(result)) return false;
                    return true;
                });
            this._rerank(filtered, query);
            searchResults = filtered
                .sort((a, b) => b.score - a.score)
                .slice(0, maxResults);
        }

        if (includeContent) {
            searchResults = searchResults.map(result => {
                result._needsContent = true;
                return result;
            });
        }

        return searchResults;
    }

    /**
     * Tokenize a query the same way the index was built, so re-rank coverage is
     * measured against the terms that could actually match.
     * @private
     */
    _queryTokens(query) {
        try {
            if (this.tokenService && typeof this.tokenService.tokenize === 'function') {
                return this.tokenService.tokenize(query);
            }
        } catch (_) { /* fall through */ }
        return this.tokenize(String(query || '').trim());
    }

    /**
     * Phrases the re-rank should look for in a document's name/headings/excerpt,
     * lowercased. Quoted segments win when present — `Oracle "MySQL Enterprise"`
     * boosts documents titled after the phrase, not documents that happen to
     * contain the whole raw query. With no quotes this is just the query, which
     * is the behaviour that predates quoted-phrase support.
     * @private
     */
    _rerankPhrases(query) {
        const raw = String(query || '');
        let phrases = [];
        try {
            if (this.tokenService && typeof this.tokenService.parseQuery === 'function') {
                phrases = this.tokenService.parseQuery(raw).phrases || [];
            } else {
                phrases = (raw.match(/"([^"]+)"|“([^”]+)”/g) || []).map(s => s.slice(1, -1));
            }
        } catch (_) { /* fall through to the whole-query phrase */ }

        const source = phrases.length ? phrases : [raw.replace(/["“”]/g, '')];
        return source
            .map(p => p.toLowerCase().replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    }

    /**
     * Wiki-side re-rank applied on top of BM25 (which already rewards term
     * frequency). Boosts, in-place, each result's score for three signals:
     *  - coverage: matched ALL query terms (vs only some)
     *  - heading:  query terms found in the document's headings
     *  - phrase:   the exact query phrase found in name / headings / excerpt
     * Base BM25 order is preserved when none of the signals fire.
     * @private
     */
    _rerank(results, query) {
        if (!Array.isArray(results) || results.length === 0) return;
        const queryTokens = this._queryTokens(query);
        if (queryTokens.length === 0) return;

        // Phrases to look for in the high-value fields. When the user quoted
        // something, that is the phrase that matters — the core engine has
        // already required it in the body, so the boost here decides whether it
        // also appears in the name/headings/excerpt. Otherwise fall back to the
        // whole query, as before.
        const phrases = this._rerankPhrases(query);
        const multiWord = queryTokens.length > 1;

        for (const r of results) {
            const matched = Array.isArray(r.terms) ? r.terms.length : 0;
            const coverage = Math.min(1, matched / queryTokens.length);

            const headings = String(r.headings || '').toLowerCase();
            let headingHits = 0;
            if (headings) {
                for (const t of queryTokens) if (headings.includes(t)) headingHits++;
            }
            const headingFrac = headingHits / queryTokens.length;

            // Exact phrase check against the text we already hold (no extra I/O):
            // file name, headings, and the stored excerpt.
            let phraseHit = false;
            if (multiWord && phrases.length) {
                const hay = `${r.name || r.title || ''} ${headings} ${r.excerpt || ''}`.toLowerCase();
                phraseHit = phrases.some(p => hay.includes(p));
            }

            let boost = 1;
            boost *= 1 + RERANK.coverage * coverage;
            if (headingFrac > 0) boost *= 1 + RERANK.heading * headingFrac;
            if (phraseHit) boost *= RERANK.phrase;

            r.score = (r.score || 0) * boost;
            r._rankSignals = { coverage, headingFrac, phraseHit, boost };
        }
    }

    /**
     * Load content for a search result on-demand from the original file.
     */
    async loadContent(result) {
        try {
            if (this.filingServiceWrapper) {
                const content = await this.filingServiceWrapper.readDocument(result.spaceName, result.path || result.relativePath);
                if (content) {
                    return Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
                }
            }

            // Fallback: try reading from absolute path
            if (result.path && path.isAbsolute(result.path)) {
                return await fs.readFile(result.path, 'utf8');
            }

            // Fallback: resolve from base directories
            const baseDir = this._getBaseDir(result.spaceName);
            if (baseDir && result.relativePath) {
                return await fs.readFile(path.join(baseDir, result.relativePath), 'utf8');
            }
        } catch (error) {
            this.logger.debug(`Could not load content for ${result.path}: ${error.message}`);
        }
        return null;
    }

    /**
     * Get base directory for a space name
     * @private
     */
    _getBaseDir(spaceName) {
        if (spaceName === 'Personal Space') return this.documentsDir;
        if (spaceName === 'Shared Space') return this.documentsSharedDir;
        if (spaceName === 'Read-Only Space') return this.documentsReadonlyDir;
        return this.docsDir;
    }

    /**
     * Get suggestions for autocomplete.
     *
     * Two shapes come back and callers care which:
     *  - document suggestions — {title, path, spaceName, type}, where `path` is
     *    the SPACE-RELATIVE path, the identity every wiki document API takes;
     *  - bare token strings — index terms to search for, carrying no path.
     *
     * `documentsOnly` returns the first kind exclusively. It also forces the
     * container scan below, because the core token service's suggest() drops
     * path and spaceName from its output — so a caller that has to resolve a
     * suggestion back to an actual document (the pane block's source picker)
     * would otherwise get nothing addressable.
     *
     * @param {string} query
     * @param {Object} [options]
     * @param {number} [options.maxSuggestions=10]
     * @param {Array<string>} [options.spaceNames] Restrict to these space names.
     * @param {string} [options.pathPrefix] Restrict to a folder subtree.
     * @param {boolean} [options.documentsOnly=false] Path-bearing documents only.
     * @param {Array<string>} [options.fileTypes] Keep only these indexer types, e.g. ['markdown'].
     * @param {boolean} [options.matchPaths=false] Match the folder path too, not just the file name.
     * @return {Array<Object|string>}
     */
    getSuggestions(query, options = {}) {
        if (!query || query.length < 2) {
            return [];
        }

        // Suggestions are substring matches over titles and tokens, so the quote
        // characters of a phrase query would match nothing and the dropdown would
        // go blank mid-typing. Suggest on the words; the phrase is enforced when
        // the search itself runs.
        query = query.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
        if (query.length < 2) return [];

        const maxSuggestions = options.maxSuggestions || 10;

        // Optional space filter: an array of space *names* (the route resolves
        // the public spaceId(s) → names before calling us, since the index keys
        // documents by name). Empty/absent means "all spaces".
        const spaceFilter = Array.isArray(options.spaceNames)
            ? options.spaceNames.filter(Boolean)
            : [];
        const hasSpaceFilter = spaceFilter.length > 0;
        const allowedSpaces = new Set(spaceFilter);

        // Optional folder scope (same semantics as search()). The core token
        // service's suggest() can't filter by path, so any active prefix forces
        // the container-scan path below where we can check each document's path.
        const normPrefix = normalizePathPrefix(options.pathPrefix);
        const hasPathPrefix = !!normPrefix;

        // Document-shaped output: no token strings, and never the core fast path.
        const documentsOnly = options.documentsOnly === true;

        // Optional indexer file-type filter (same vocabulary as search():
        // 'markdown', 'pdf', 'office', …).
        const typeFilter = new Set(
            (Array.isArray(options.fileTypes) ? options.fileTypes : [])
                .filter(Boolean)
                .map(t => String(t).toLowerCase())
        );
        const hasTypeFilter = typeFilter.size > 0;

        // Fast path: delegate only when nothing about the result needs
        // per-document knowledge. The core suggest() can't scope by space or
        // folder, can't filter by type, and returns {title, type} + bare tokens
        // with no path — so any of those requirements takes the scan below.
        if (this.tokenService && !hasSpaceFilter && !hasPathPrefix && !documentsOnly && !hasTypeFilter) {
            return this.tokenService.suggest(query, {
                maxSuggestions,
                containerName: 'default'
            });
        }

        const queryLower = query.toLowerCase();
        const matchPaths = options.matchPaths === true;
        const needleTerms = matchPaths ? flattenForMatch(query).split(' ').filter(Boolean) : [];

        // Score an indexed document against the query; 0 means "no match".
        // A name hit always outranks a folder-path hit.
        const scoreDoc = (docName, docPath) => {
            const nameLower = docName.toLowerCase();
            if (nameLower.startsWith(queryLower)) return 3;
            if (nameLower.includes(queryLower)) return 2;
            if (matchPaths && docPath && needleTerms.length > 0) {
                const haystack = flattenForMatch(`${docPath} ${docName}`);
                if (needleTerms.every(term => haystack.includes(term))) return 1;
            }
            return 0;
        };

        // Space-aware path over the core token service's indexed documents.
        // The core suggest() can't scope by space and drops spaceName from its
        // output, so when a filter is active we scan the container ourselves
        // (mirroring how removeFileFromIndex reaches into the container) and
        // keep only documents whose stored spaceName is in the allowed set.
        if (this.tokenService) {
            const container = this.tokenService.containers
                ? this.tokenService.containers.get('default')
                : null;
            if (!container || !container.documents) {
                return [];
            }

            const seen = new Set();
            const documentSuggestions = [];
            for (const docInfo of container.documents.values()) {
                const stored = docInfo.storedFields || {};
                if (hasSpaceFilter && !allowedSpaces.has(stored.spaceName)) continue;
                if (hasTypeFilter && !typeFilter.has(String(stored.type || '').toLowerCase())) continue;

                const docName = stored.name || stored.title
                    || (docInfo.sourceDoc && (docInfo.sourceDoc.name || docInfo.sourceDoc.title))
                    || '';
                if (!docName) continue;

                // SPACE-RELATIVE path first: stored.path is the ABSOLUTE file
                // path, which neither the folder scope below nor any consumer of
                // a suggestion (open document / pane source) can do anything with.
                const docPath = toPosixRelPath(stored.relativePath || stored.parentPath || stored.path || '');
                if (hasPathPrefix && !isUnderPathPrefix(docPath, normPrefix)) continue;

                const relevance = scoreDoc(docName, docPath);
                if (!relevance) continue;

                // Dedupe chunked sub-documents (which share name + path).
                const key = `${stored.spaceName}:${docPath || docName}`;
                if (seen.has(key)) continue;
                seen.add(key);

                documentSuggestions.push({
                    title: docName,
                    path: docPath,
                    spaceName: stored.spaceName,
                    type: stored.type || 'document',
                    relevance
                });
            }

            documentSuggestions.sort((a, b) => b.relevance - a.relevance);
            // Token (string) suggestions are intentionally omitted under a space
            // filter — index tokens aren't attributable to a single space, so
            // surfacing them would leak terms from other spaces.
            return documentSuggestions
                .slice(0, maxSuggestions)
                .map(doc => ({ title: doc.title, path: doc.path, spaceName: doc.spaceName, type: doc.type }));
        }

        // Fallback implementation (no token service): scan the in-memory index.
        const documentSuggestions = [];
        const tokenSuggestions = [];

        for (const [, fileInfo] of this.index.files) {
            if (hasSpaceFilter && !allowedSpaces.has(fileInfo.spaceName)) continue;
            if (hasTypeFilter && !typeFilter.has(String(fileInfo.type || '').toLowerCase())) continue;
            const filePath = toPosixRelPath(fileInfo.relativePath || fileInfo.path);
            if (hasPathPrefix && !isUnderPathPrefix(filePath, normPrefix)) continue;
            const relevance = scoreDoc(fileInfo.name, filePath);
            if (relevance) {
                documentSuggestions.push({
                    title: fileInfo.name,
                    path: filePath,
                    spaceName: fileInfo.spaceName,
                    type: fileInfo.type || 'document',
                    relevance
                });
                if (documentSuggestions.length >= maxSuggestions) break;
            }
        }

        // Global token suggestions only when neither a space nor folder scope is
        // set, and never for a caller that asked for documents only.
        if (!documentsOnly && !hasSpaceFilter && !hasPathPrefix && documentSuggestions.length < maxSuggestions) {
            for (const [token] of this.index.tokens) {
                if (token.startsWith(queryLower) && token !== queryLower) {
                    tokenSuggestions.push(token);
                    if (tokenSuggestions.length >= (maxSuggestions - documentSuggestions.length)) break;
                }
            }
        }

        documentSuggestions.sort((a, b) => b.relevance - a.relevance);

        return [
            ...documentSuggestions.map(doc => ({
                title: doc.title,
                path: doc.path,
                spaceName: doc.spaceName,
                type: doc.type
            })),
            ...tokenSuggestions
        ].slice(0, maxSuggestions);
    }

    /**
     * Get index statistics.
     *
     * ASYNC for the same reason as clearIndex: SOLR answers getStats over HTTP.
     * Spreading the returned promise (`{ ...provider.getStats() }`) yielded an
     * empty object — a Promise has no own enumerable properties — so
     * /search/stats silently lost every total and reported only the `derived`
     * block, which reads exactly like an index that built but found nothing.
     */
    async getStats() {
        // Derived-content health from the last full build, so /search/stats shows
        // whether PDFs and office documents are indexed with their TEXT or only
        // with their file names.
        const derived = { ...this._derivedStats, resolverWired: !!this._ensureDerived };

        if (this.tokenService) {
            return { ...(await this.tokenService.getStats('default')), derived };
        }

        // Fallback
        const stats = {
            derived,
            totalFiles: this.index.files.size,
            indexedFiles: 0,
            totalTokens: this.index.tokens.size,
            lastIndexTime: this.lastIndexTime,
            isIndexing: this.isIndexing,
            contentExtensions: Array.from(this.contentExtensions),
            fileTypes: {},
            spaceNames: {}
        };

        for (const [, fileInfo] of this.index.files) {
            if (fileInfo.isIndexed) stats.indexedFiles++;
            stats.fileTypes[fileInfo.type] = (stats.fileTypes[fileInfo.type] || 0) + 1;
            stats.spaceNames[fileInfo.spaceName] = (stats.spaceNames[fileInfo.spaceName] || 0) + 1;
        }

        return stats;
    }

    // ─── Incremental Updates ─────────────────────────────────────────

    /**
     * Incremental update - add or update a single file
     */
    async updateFile(filePath, spaceName = 'Personal Space') {
        const baseDir = this._getBaseDir(spaceName);
        const relativePath = path.relative(baseDir, filePath);

        this.removeFileFromIndex(relativePath);
        await this.indexFile(filePath, relativePath, spaceName);

        // Persist updated index to disk
        if (this.tokenService) {
            await this.tokenService.saveToDisk('default');
        } else if (this._useFallback) {
            await this._saveIndexToDisk();
        }

        this.logger.info(`Updated index for file: ${relativePath}`);
    }

    /**
     * Incremental update for a file inside a named space, addressed the same
     * way the full rebuild addresses it: a space-relative, forward-slash path
     * (the format FilingServiceWrapper.getAllFilesRecursive emits). Used by the
     * file watcher so files written directly to disk — e.g. by workflows via
     * the filing service — become searchable without a full rebuild.
     *
     * No-ops while a full rebuild is in flight (the rebuild re-lists files at
     * that point, so the file is picked up anyway) and when no filing wrapper
     * is available (legacy layout — updateFile() covers those spaces).
     *
     * @param {string} spaceName Space name (index documents store spaceName).
     * @param {string} relativePath Space-relative path, forward slashes.
     */
    async updateFileInSpace(spaceName, relativePath) {
        if (!this.filingServiceWrapper) {
            this.logger.debug(`[SearchIndexer] No filing wrapper — skipping incremental index of ${spaceName}/${relativePath}`);
            return;
        }
        if (this.isIndexing) {
            this.logger.debug(`[SearchIndexer] Rebuild in progress — skipping incremental index of ${spaceName}/${relativePath}`);
            return;
        }

        const normalized = this._normalizeRelativePath(relativePath);
        if (!normalized) return;

        // Remove first so a document that shrank below the chunking threshold
        // doesn't leave stale #chunk-N entries behind.
        this.removeFileFromIndex(normalized);
        await this.indexFileWithWrapper(spaceName, normalized);
        this._schedulePersist();
        this.logger.info(`[SearchIndexer] Incrementally indexed: ${spaceName}/${normalized}`);
    }

    /**
     * Incremental removal counterpart of updateFileInSpace: drops the document
     * (and its chunks) from the index and schedules a debounced persist.
     *
     * @param {string} relativePath Space-relative path, forward slashes.
     */
    removeFileFromIndexIncremental(relativePath) {
        if (this.isIndexing) return;
        const normalized = this._normalizeRelativePath(relativePath);
        if (!normalized) return;
        this.removeFileFromIndex(normalized);
        this._schedulePersist();
        this.logger.info(`[SearchIndexer] Removed from index: ${normalized}`);
    }

    /**
     * Remove every indexed document under a folder (used when a whole folder
     * is deleted on disk — chokidar emits per-file unlinks too, but this covers
     * files that were indexed but never individually reported, and is cheap).
     *
     * @param {string} folderRelativePath Space-relative folder path.
     */
    removeFolderFromIndex(folderRelativePath) {
        if (this.isIndexing) return;
        const normPrefix = normalizePathPrefix(folderRelativePath);
        if (!normPrefix) return;

        let removed = 0;
        if (this.tokenService) {
            const container = this.tokenService.containers
                ? this.tokenService.containers.get('default')
                : null;
            if (!container || !container.documents) return;

            const ids = [];
            for (const [docId, docInfo] of container.documents) {
                const stored = (docInfo && docInfo.storedFields) || {};
                const docPath = stored.parentPath || stored.path || stored.relativePath || docId;
                if (isUnderPathPrefix(docPath, normPrefix)) ids.push(docId);
            }
            for (const id of ids) {
                this._settle(
                    this.tokenService.removeDocument(id, 'default'),
                    `Removing "${id}" from the index`
                );
            }
            removed = ids.length;
        } else if (this._useFallback) {
            const paths = [];
            for (const p of this.index.files.keys()) {
                if (isUnderPathPrefix(p, normPrefix)) paths.push(p);
            }
            for (const p of paths) this.removeFileFromIndex(p);
            removed = paths.length;
        }

        if (removed > 0) {
            this._schedulePersist();
            this.logger.info(`[SearchIndexer] Removed ${removed} indexed document(s) under folder: ${normPrefix}`);
        }
    }

    /**
     * Flatten separators and strip leading slashes so incremental entries key
     * identically to full-rebuild entries (wrapper paths are '/'-separated).
     * @private
     */
    _normalizeRelativePath(relativePath) {
        return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    }

    /**
     * Debounced index persist. Incremental updates arrive in bursts (a workflow
     * writing hundreds of files), so instead of one disk write per file the
     * persist is deferred until the burst has been quiet for a few seconds.
     * The in-memory index is live immediately; the disk copy only matters for
     * the next restart's warm start.
     * @private
     */
    _schedulePersist(delayMs = 5000) {
        if (this._persistTimer) clearTimeout(this._persistTimer);
        this._persistTimer = setTimeout(() => {
            this._persistTimer = null;
            const persist = this.tokenService
                ? this.tokenService.saveToDisk('default')
                : this._saveIndexToDisk();
            Promise.resolve(persist).catch(error => {
                this.logger.warn(`[SearchIndexer] Failed to persist index to disk: ${error.message}`);
            });
        }, delayMs);
        if (typeof this._persistTimer.unref === 'function') this._persistTimer.unref();
    }

    /**
     * Settle a provider call that may or may not be a promise, logging rather
     * than rejecting.
     *
     * The removal methods are deliberately SYNCHRONOUS — the file watcher and
     * the navigation routes call them fire-and-forget from event handlers, and
     * nothing downstream reads a result. That is fine while the provider is the
     * embedded `tokens` engine (a Map delete), but on SOLR every removal is an
     * HTTP round trip, and an unattended rejection reaches app.js's
     * `unhandledRejection` handler, which exits the process. One failed delete
     * must not take the backend down: log it and carry on, the same way
     * `_schedulePersist` treats a failed persist.
     *
     * @private
     * @param {*} result Whatever the provider returned.
     * @param {string} what Short description used in the warning.
     */
    _settle(result, what) {
        Promise.resolve(result).catch(error => {
            this.logger.warn(`[SearchIndexer] ${what} failed: ${error && error.message}`);
        });
    }

    /**
     * Remove file from index (including any chunked sub-documents)
     */
    removeFileFromIndex(relativePath) {
        if (this.tokenService) {
            // Remove the parent entry (used when doc was small enough to fit in one)
            this._settle(
                this.tokenService.removeDocument(relativePath, 'default'),
                `Removing "${relativePath}" from the index`
            );

            // Remove any chunk entries created by _indexFileIntoService
            const container = this.tokenService.containers
                ? this.tokenService.containers.get('default')
                : null;
            if (container && container.documents) {
                const chunkPrefix = `${relativePath}#chunk-`;
                const chunkIds = [];
                for (const docId of container.documents.keys()) {
                    if (typeof docId === 'string' && docId.startsWith(chunkPrefix)) {
                        chunkIds.push(docId);
                    }
                }
                for (const chunkId of chunkIds) {
                    this._settle(
                        this.tokenService.removeDocument(chunkId, 'default'),
                        `Removing chunk "${chunkId}" from the index`
                    );
                }
            }
        } else if (this._useFallback) {
            const fileInfo = this.index.files.get(relativePath);
            if (fileInfo) {
                for (const [token, pathSet] of this.index.tokens) {
                    pathSet.delete(relativePath);
                    if (pathSet.size === 0) {
                        this.index.tokens.delete(token);
                    }
                }
                this.index.files.delete(relativePath);
            }
        }
    }

    /**
     * Check whether a file extension should be content-indexed
     * @private
     */
    _shouldIndexContent(ext, mimeType) {
        return this.contentExtensions.has(ext) ||
               (this.contentExtensions.has('*text') && mimeType.startsWith('text/'));
    }

    /**
     * Generate excerpt from content
     */
    generateExcerpt(content, maxLength = 200) {
        if (!content) return '';

        const cleanContent = content
            .replace(/#{1,6}\s/g, '')
            .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/\n\s*\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanContent.length <= maxLength) {
            return cleanContent;
        }

        return cleanContent.substring(0, maxLength).replace(/\s+\w*$/, '') + '...';
    }

    /**
     * Determine file type based on extension and mime type
     */
    getFileType(extension, mimeType) {
        if (['.md', '.markdown'].includes(extension)) return 'markdown';
        if (['.txt', '.log'].includes(extension)) return 'text';
        if (['.json', '.yaml', '.yml'].includes(extension)) return 'data';
        if (['.pdf'].includes(extension)) return 'pdf';
        if (mimeType.startsWith('image/')) return 'image';
        if (['.doc', '.docx', '.ppt', '.pptx'].includes(extension)) return 'office';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        return 'other';
    }
}

module.exports = SearchIndexer;
module.exports.normalizePathPrefix = normalizePathPrefix;
module.exports.isUnderPathPrefix = isUnderPathPrefix;
module.exports.deriveFacetFields = deriveFacetFields;
