/**
 * @fileoverview File handling policy — the single source of truth for how each
 * file class is viewed, downloaded and searched.
 *
 * The guiding principle: the uploaded original is always preserved and is always
 * what you download. A *derived* markdown artifact is generated only when the
 * original cannot do a job itself:
 *
 *   - Office (docx/xls/ppt…): can't render in a browser and can't be searched
 *       → view the derived markdown, download the original, search the markdown.
 *   - PDF: renders natively but can't be searched well
 *       → view the original (rendered), download the original, search the markdown.
 *   - Text/code/data: already serves all three jobs in its original form
 *       → view / download / search the original. No derivation.
 *
 * ALL per-document artifacts are stored FOLDER-LOCAL, in a `.system/` directory
 * inside the *same folder* as the document they belong to. Nothing mirrors the
 * space tree from a root namespace:
 *
 *   <folder>/.system/derived/    markdown extracted from a binary the user still
 *                                owns as the primary document — PDFs, office docs
 *                                (`sub/report.pdf` → `sub/.system/derived/report.pdf.md`).
 *                                Feeds the markdown view (office) and search/context.
 *   <folder>/.system/originals/  the untouched source of a document whose markdown
 *                                became the *visible* page — office drops
 *                                (`sub/report.docx` → `sub/.system/originals/report.docx`).
 *                                Served by the `sub/report.md` page's download link.
 *   <folder>/.system/context/    AI-generated context (`sub/report.md` →
 *                                `sub/.system/context/report.md`, plus a
 *                                `_folder.md` roll-up for the folder itself).
 *   <folder>/.system/file-order.json, file-types.json   child ordering + colours.
 *   <folder>/.system/home-seed.json  provenance for a `.home.md` the context build
 *                                seeded, so a rebuild may refresh its own page but
 *                                never a hand-written one (see HOME_SEED_FILE).
 *
 * Keeping these beside their source means the artifacts travel with the content:
 * spaces whose folders are symlinks to separate git repositories keep each repo's
 * derived/context/originals inside that repo, so they are versioned and cloned
 * along with the documents they describe.
 *
 * IMPORTANT — the space root is itself a folder that holds documents. Its
 * `<space>/.system/` therefore serves BOTH roles at once:
 *   • folder-local artifacts for files sitting directly in the space root
 *     (`home.md` → `.system/context/home.md`, `.system/file-order.json`, …), and
 *   • the space-SCOPED sub-folder `useractivity/`, which belongs to the space
 *     rather than to any document.
 * These never collide: the space-scoped names are fixed and distinct from the
 * `derived`/`originals`/`context` artifact folders. Do not read `<space>/.system/
 * derived/` as a tree-mirroring namespace — it holds sidecars for the ROOT's own
 * files only, exactly like any other folder's `.system/derived/`.
 *
 * `templates/` is the one namespace that is BOTH, and deliberately so:
 *
 *   <folder>/.system/templates/  document templates offered when creating a file
 *                                *in or below* that folder. Resolved as a CASCADE
 *                                (`templateDirsFor`) — the target folder first,
 *                                then each ancestor, ending at the space root's
 *                                `.system/templates/`, which is therefore the
 *                                space-wide tier every folder inherits.
 *
 * So the space root's copy is not a different KIND of thing, it is the last stop
 * of the same walk — which is why a folder template of the same name shadows it.
 * The two tiers differ only in who may write them (see `spacePermissions.js`):
 * the root's require a space admin, a folder's require only the right to write
 * that folder.
 *
 * Because the wiki tree builders skip dot-prefixed names (`.system` included),
 * none of these ever surface as their own documents.
 *
 * @author noobly Team
 * @version 3.0.0
 */

'use strict';

const path = require('node:path');
const { isTextFile } = require('./fileTypeUtils');

/** Office document extensions handled as "view markdown, download original". */
const OFFICE_EXTENSIONS = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];

/**
 * The hidden per-folder namespace. Every folder that holds documents may carry one,
 * containing that folder's own artifacts. The space root's copy additionally holds
 * the space-scoped `useractivity/` (see the file header).
 */
const SYSTEM_DIR = '.system';

/**
 * Artifact directories, each relative to the folder of the document they belong to
 * — NOT to the space root. See the file header for why they stay beside the source.
 */
const DERIVED_DIR = `${SYSTEM_DIR}/derived`;
const ORIGINALS_DIR = `${SYSTEM_DIR}/originals`;
const CONTEXT_DIR = `${SYSTEM_DIR}/context`;

/**
 * Document templates. Folder-local like the artifact dirs above, but read as a
 * CASCADE rather than for one document — see `templateDirsFor`.
 */
const TEMPLATES_DIR = `${SYSTEM_DIR}/templates`;

/**
 * Space-SCOPED sub-folders of the space root's `.system/`.
 *
 * `templates` is NOT one of them: the root's `.system/templates/` is the last rung
 * of the folder cascade, not a separate namespace. It stays in this list anyway
 * because callers use it to decide "is this space-level rather than a per-document
 * artifact?" — and at the root, a template is exactly that. The check is anchored
 * at position 0, so a folder-local `Buy/.system/templates/` correctly returns false.
 */
const SPACE_SCOPED_SYSTEM_DIRS = Object.freeze(['templates', 'useractivity']);

/**
 * Fixed name of a folder's context roll-up inside `.system/context/`. Fixed (rather
 * than derived from the folder name) so it can never collide with the sidecar of a
 * document that happens to share the folder's name. Must match the sibling
 * `system-context` workflow's `FOLDER_CONTEXT_NAME`.
 */
const FOLDER_CONTEXT_FILE = '_folder.md';

/**
 * The home pages a folder may carry, in the order the seeded one is checked first.
 * A folder home is a VISIBLE document (dot-prefixed only so it stays out of the
 * tree and the folder listing) — never an artifact.
 */
const HOME_FILE_NAMES = Object.freeze(['.home.md', 'home.md', 'Home.md']);

/**
 * The only home file the sibling `system-context` build ever creates. A `home.md`
 * or `Home.md` is by definition hand-made, so it is never a candidate for the
 * provenance rule below.
 */
const SEEDED_HOME_FILE = '.home.md';

/**
 * Provenance marker for a folder home the context build seeded, written at
 * `<folder>/.system/home-seed.json` — folder-level metadata about the folder's own
 * landing page, exactly the tier `file-order.json` / `file-types.json` sit at.
 *
 * WHY IT EXISTS: `ensureFolderHome` in the sibling repo copies a folder's context
 * roll-up into `.home.md` when the folder has none. Without provenance it cannot
 * tell a page it wrote from one a person wrote, so it takes the only safe route and
 * never overwrites — which means adding documents to a folder can never refresh the
 * landing page that describes it. The marker records a hash of exactly what was
 * written, giving a three-way answer instead of two:
 *
 *   - no home file            → seed it, record the hash;
 *   - home file + hash MATCHES → we wrote it and nobody has touched it: refresh it;
 *   - anything else           → hand-written, or edited since we seeded it. Leave
 *                               it alone, permanently. One edit transfers ownership.
 *
 * Every failure mode (missing marker, corrupt JSON, changed line endings) resolves
 * to "not ours", so the marker can only ever make the build MORE conservative than
 * the file alone would.
 *
 * Keep the name and the hashing rule in lockstep with `contextProcessor.js` — see
 * the cross-repo note in CLAUDE.md. Covered by `tests/backend/components/homeSeedMarker.test.js`.
 */
const HOME_SEED_FILE = 'home-seed.json';

/**
 * Split a space-relative path into its folder and file name, POSIX-normalised.
 * @param {string} relativePath
 * @returns {{ dir: string, name: string }} dir is '' for a space-root file.
 * @private
 */
function splitRel(relativePath) {
  const norm = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = norm.lastIndexOf('/');
  return slash === -1
    ? { dir: '', name: norm }
    : { dir: norm.slice(0, slash), name: norm.slice(slash + 1) };
}

/**
 * Place a file name inside a folder-local artifact directory.
 * @param {string} dir - Owning folder, '' for the space root.
 * @param {string} artifactDir - One of DERIVED_DIR / ORIGINALS_DIR / CONTEXT_DIR.
 * @param {string} name - File name to place.
 * @returns {string} Space-relative path of the artifact.
 * @private
 */
function joinArtifact(dir, artifactDir, name) {
  return dir ? `${dir}/${artifactDir}/${name}` : `${artifactDir}/${name}`;
}

/**
 * Recover the owning document's space-relative path from an artifact path.
 * @param {string} artifactRelPath
 * @param {string} artifactDir - The artifact directory to strip.
 * @param {(name: string) => string} [mapName] - Transform the artifact file name
 *   back to the original's name (e.g. strip a trailing `.md`).
 * @returns {string|null} null when the path is not in that artifact directory.
 * @private
 */
function fromArtifact(artifactRelPath, artifactDir, mapName = (n) => n) {
  const norm = String(artifactRelPath).replace(/\\/g, '/').replace(/^\/+/, '');
  const marker = `${artifactDir}/`;
  const at = norm.lastIndexOf(marker);
  if (at === -1) return null;
  // Anchor on a segment boundary so `x.system/derived/` can't match.
  if (at !== 0 && norm[at - 1] !== '/') return null;
  const dir = at === 0 ? '' : norm.slice(0, at - 1);
  const name = norm.slice(at + marker.length);
  if (!name || name.includes('/')) return null;
  const original = mapName(name);
  return dir ? `${dir}/${original}` : original;
}

/**
 * True when a space-relative path sits inside the given folder-local artifact dir.
 * @param {string} relativePath
 * @param {string} artifactDir
 * @returns {boolean}
 * @private
 */
function inArtifactDir(relativePath, artifactDir) {
  const norm = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  return norm === artifactDir
    || norm.startsWith(`${artifactDir}/`)
    || norm.endsWith(`/${artifactDir}`)
    || norm.includes(`/${artifactDir}/`);
}

/**
 * Resolve the handling policy for a file by extension.
 *
 * @param {string} filePath - File path or name (only the extension is read).
 * @returns {{ klass: string, view: string, download: string, search: string }}
 *   view:     'markdown' | 'original'   — which content the viewer should serve
 *   download: 'original'                — always the untouched upload
 *   search:   'markdown' | 'original' | 'none' — which content feeds the index
 */
function getPolicy(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (OFFICE_EXTENSIONS.includes(ext)) {
    return { klass: 'office', view: 'markdown', download: 'original', search: 'markdown' };
  }

  if (ext === '.pdf') {
    return { klass: 'pdf', view: 'original', download: 'original', search: 'markdown' };
  }

  if (isTextFile(filePath)) {
    return { klass: 'text', view: 'original', download: 'original', search: 'original' };
  }

  // Images, video, audio and unknown binaries: rendered/downloaded as-is, never
  // searched by content. (The viewer-type resolver decides render vs download.)
  return { klass: 'binary', view: 'original', download: 'original', search: 'none' };
}

/**
 * True when a file needs a derived markdown sidecar (for viewing and/or search).
 * @param {string} filePath
 * @returns {boolean}
 */
function needsMarkdownSidecar(filePath) {
  const policy = getPolicy(filePath);
  return policy.view === 'markdown' || policy.search === 'markdown';
}

/**
 * Map a document's (space-relative) path to its derived sidecar path. The sidecar
 * sits in `<its own folder>/.system/derived/` and keeps the original's full name
 * plus `.md`, so `report.pdf` and `report.docx` in one folder can never collide.
 * Uses POSIX separators to match filing-service relative paths.
 * @param {string} relativePath - Path relative to the space root.
 * @returns {string} e.g. `sub/.system/derived/report.docx.md`
 */
function toDerivedRelPath(relativePath) {
  const { dir, name } = splitRel(relativePath);
  return joinArtifact(dir, DERIVED_DIR, `${name}.md`);
}

/**
 * Recover the original path from a derived sidecar path.
 * @param {string} derivedRelPath
 * @returns {string|null} the original space-relative path, or null if not a sidecar.
 */
function fromDerivedRelPath(derivedRelPath) {
  return fromArtifact(derivedRelPath, DERIVED_DIR,
    (name) => (name.endsWith('.md') ? name.slice(0, -3) : name));
}

/**
 * True when a path is inside a folder-local derived-sidecar directory.
 * @param {string} relativePath
 * @returns {boolean}
 */
function isDerivedRelPath(relativePath) {
  return inArtifactDir(relativePath, DERIVED_DIR);
}

/**
 * Map a document's (space-relative) path to its stored-original path. Unlike the
 * derived sidecar this keeps the file's own name/extension — it *is* the source,
 * just relocated into its own folder's `.system/originals/`
 * (e.g. `sub/report.docx` → `sub/.system/originals/report.docx`).
 * @param {string} relativePath - Path relative to the space root.
 * @returns {string}
 */
function toOriginalsRelPath(relativePath) {
  const { dir, name } = splitRel(relativePath);
  return joinArtifact(dir, ORIGINALS_DIR, name);
}

/**
 * Recover the (would-be) original space-relative path from a stored-original path.
 * @param {string} originalsRelPath
 * @returns {string|null}
 */
function fromOriginalsRelPath(originalsRelPath) {
  return fromArtifact(originalsRelPath, ORIGINALS_DIR);
}

/**
 * True when a path is inside a folder-local originals directory.
 * @param {string} relativePath
 * @returns {boolean}
 */
function isOriginalsRelPath(relativePath) {
  return inArtifactDir(relativePath, ORIGINALS_DIR);
}

/**
 * Candidate stored-original paths for a visible markdown page. A dropped office
 * document becomes `<name>.md` with its source relocated to
 * `<its folder>/.system/originals/<name>.<officeext>`; from the page path alone we
 * don't know which office extension it was, so return one candidate per office
 * type for the caller to probe on disk (first hit wins).
 * @param {string} mdRelativePath - Space-relative path of the `.md` page.
 * @returns {string[]} Candidate `…/.system/originals/…` paths (empty if not a .md).
 */
function originalCandidatesForMarkdown(mdRelativePath) {
  const norm = String(mdRelativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm.toLowerCase().endsWith('.md')) return [];
  const { dir, name } = splitRel(norm.slice(0, -3)); // strip trailing ".md"
  return OFFICE_EXTENSIONS.map(ext => joinArtifact(dir, ORIGINALS_DIR, `${name}${ext}`));
}

/**
 * Map a document's (space-relative) path to its AI-context sidecar path, inside
 * `<its folder>/.system/context/`.
 *
 * The sidecar is ALWAYS markdown, so its name mirrors what the sibling
 * `system-context` workflow writes (`contextProcessor.collectFolderDocs`):
 *   - a markdown source keeps its own name  (`report.md`  → `report.md`)
 *   - any other source — a PDF or office doc summarised from its derived text —
 *     keeps its FULL name plus `.md`       (`report.pdf` → `report.pdf.md`)
 * so `report.pdf` and `report.md` in one folder can never collide. Keep this rule
 * in lockstep with the workflow or chat grounding silently misses binaries.
 *
 * @param {string} relativePath - Path relative to the space root.
 * @returns {string} e.g. `sub/.system/context/report.pdf.md`
 */
function toContextRelPath(relativePath) {
  const { dir, name } = splitRel(relativePath);
  const contextName = name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
  return joinArtifact(dir, CONTEXT_DIR, contextName);
}

/**
 * Recover the source document's path from a context sidecar path. Returns null for
 * the folder roll-up (`_folder.md`), which belongs to the folder, not a document.
 *
 * NOTE: a `.md` sidecar is ambiguous by construction — `sub/.system/context/x.md`
 * is the sidecar of `sub/x.md`, while `sub/.system/context/x.pdf.md` is the
 * sidecar of `sub/x.pdf`. We strip a trailing `.md` only when what remains still
 * has an extension, which resolves both cases correctly.
 *
 * @param {string} contextRelPath
 * @returns {string|null}
 */
function fromContextRelPath(contextRelPath) {
  const source = fromArtifact(contextRelPath, CONTEXT_DIR, (name) => {
    if (!name.toLowerCase().endsWith('.md')) return name;
    const stripped = name.slice(0, -3);
    // `x.pdf.md` -> `x.pdf`; `x.md` -> keep `x.md` (the source IS the markdown).
    return path.extname(stripped) ? stripped : name;
  });
  if (source === null) return null;
  return splitRel(source).name === FOLDER_CONTEXT_FILE ? null : source;
}

/**
 * True when a path is inside a folder-local context directory.
 * @param {string} relativePath
 * @returns {boolean}
 */
function isContextRelPath(relativePath) {
  return inArtifactDir(relativePath, CONTEXT_DIR);
}

/**
 * Path of a folder's home-seed marker, inside that folder's own `.system/`.
 * @param {string} folderPath - Space-relative folder, '' for the space root.
 * @returns {string} e.g. `Standards/.system/home-seed.json`
 */
function toHomeSeedRelPath(folderPath) {
  const dir = String(folderPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return dir ? `${dir}/${SYSTEM_DIR}/${HOME_SEED_FILE}` : `${SYSTEM_DIR}/${HOME_SEED_FILE}`;
}

/**
 * Recover the owning FOLDER from a home-seed marker path ('' for the space root).
 * @param {string} relativePath
 * @returns {string|null} null when the path is not a home-seed marker.
 */
function folderForHomeSeedRelPath(relativePath) {
  const norm = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const suffix = `${SYSTEM_DIR}/${HOME_SEED_FILE}`;
  if (norm === suffix) return '';
  return norm.endsWith(`/${suffix}`) ? norm.slice(0, -(suffix.length + 1)) : null;
}

/**
 * True when a space-relative path is the folder home the context build seeds.
 * Deliberately narrower than "is a home file": a `home.md` is hand-made and owns
 * no marker, so it must not be treated as seeded output.
 * @param {string} relativePath
 * @returns {boolean}
 */
function isSeededHomeRelPath(relativePath) {
  return splitRel(relativePath).name === SEEDED_HOME_FILE;
}

/**
 * Walk `folderPath` and every ancestor, CLOSEST FIRST, appending `subDir` to each
 * and always ending at the space root.
 *
 *   ancestorDirsFor('Solution Design/Entreprise Technology/Buy', '.system/templates') →
 *     [ 'Solution Design/Entreprise Technology/Buy/.system/templates',
 *       'Solution Design/Entreprise Technology/.system/templates',
 *       'Solution Design/.system/templates',
 *       '.system/templates' ]
 *
 * The root entry is what makes a space-wide definition reach every folder while a
 * nearer one can still override it (see `pickClosest`). No directory is read here,
 * so an ancestor that defines nothing simply yields nothing when the caller lists
 * it — the walk is bounded by the path's own depth, not by the tree's size.
 *
 * @param {string} folderPath - Space-relative folder, '' for the space root.
 * @param {string} subDir - Directory to append at each level.
 * @returns {string[]} Directories to consult in priority order.
 */
function ancestorDirsFor(folderPath, subDir) {
  const norm = String(folderPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segments = norm ? norm.split('/').filter(Boolean) : [];
  const dirs = [];
  for (let depth = segments.length; depth > 0; depth--) {
    dirs.push(`${segments.slice(0, depth).join('/')}/${subDir}`);
  }
  dirs.push(subDir); // space root — always the final fallback
  return dirs;
}

/**
 * The document-template directories that apply when creating a file in
 * `folderPath`. See `ancestorDirsFor` for the ordering guarantee.
 * @param {string} folderPath - Space-relative folder, '' for the space root.
 * @returns {string[]}
 */
function templateDirsFor(folderPath) {
  return ancestorDirsFor(folderPath, TEMPLATES_DIR);
}

/**
 * Space-relative path of a template file inside a folder's template directory.
 * @param {string} folderPath - Owning folder, '' for the space root.
 * @param {string} fileName - Template file name, e.g. 'code-repositories.md'.
 * @returns {string}
 */
function toTemplateRelPath(folderPath, fileName) {
  const dir = String(folderPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return dir ? `${dir}/${TEMPLATES_DIR}/${fileName}` : `${TEMPLATES_DIR}/${fileName}`;
}

/**
 * Recover the owning FOLDER from a template path ('' for a space-root template).
 * @param {string} relativePath
 * @returns {string|null} null when the path is not in a template directory.
 */
function folderForTemplateRelPath(relativePath) {
  const norm = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const at = norm.lastIndexOf(`${TEMPLATES_DIR}/`);
  if (at === -1) return null;
  return at === 0 ? '' : norm.slice(0, at - 1);
}

/** True when a space-relative path sits in any folder's `.system/templates/`. */
function isTemplateRelPath(relativePath) {
  return folderForTemplateRelPath(relativePath) !== null;
}

/**
 * Collapse a cascade into what the user should actually be offered: the nearest
 * definition of each template NAME wins and hides the ones above it, so a folder
 * can override a space-wide template without renaming it.
 *
 * `entries` must already be ordered closest-first (the order `templateDirsFor`
 * produces). Comparison is case-insensitive because the content roots include
 * Windows checkouts, where `Report.md` and `report.md` are the same file.
 *
 * @param {Array<{name: string}>} entries
 * @returns {Array} The surviving entries, still in closest-first order.
 */
function pickClosest(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries || []) {
    const key = String(entry && entry.name || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * True when a space-relative path is one of the space-SCOPED sub-folders of the
 * space root's `.system/` (`templates`, `useractivity`) rather than a folder-local
 * artifact directory. Only meaningful at the space root — see the file header.
 * @param {string} relativePath
 * @returns {boolean}
 */
function isSpaceScopedSystemPath(relativePath) {
  const norm = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  return SPACE_SCOPED_SYSTEM_DIRS.some(dir =>
    norm === `${SYSTEM_DIR}/${dir}` || norm.startsWith(`${SYSTEM_DIR}/${dir}/`));
}

module.exports = {
  OFFICE_EXTENSIONS,
  SYSTEM_DIR,
  DERIVED_DIR,
  ORIGINALS_DIR,
  CONTEXT_DIR,
  TEMPLATES_DIR,
  FOLDER_CONTEXT_FILE,
  HOME_FILE_NAMES,
  SEEDED_HOME_FILE,
  HOME_SEED_FILE,
  SPACE_SCOPED_SYSTEM_DIRS,
  getPolicy,
  needsMarkdownSidecar,
  toDerivedRelPath,
  fromDerivedRelPath,
  isDerivedRelPath,
  toOriginalsRelPath,
  fromOriginalsRelPath,
  isOriginalsRelPath,
  originalCandidatesForMarkdown,
  toContextRelPath,
  fromContextRelPath,
  isContextRelPath,
  toHomeSeedRelPath,
  folderForHomeSeedRelPath,
  isSeededHomeRelPath,
  ancestorDirsFor,
  templateDirsFor,
  toTemplateRelPath,
  folderForTemplateRelPath,
  isTemplateRelPath,
  pickClosest,
  isSpaceScopedSystemPath
};
