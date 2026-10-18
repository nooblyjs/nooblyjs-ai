/**
 * @fileoverview Per-space path visibility (allowedPaths / excludedPaths)
 *
 * A space can expose a CURATED SUBSET of its content root instead of all of it.
 * Two spaces may point at the same `baseDir` and show different slices — which
 * is exactly the Retail/Engineering arrangement: both are rooted at
 * `knowledge-content/engineering`, but Retail shows only three subtrees.
 *
 * The rules live on the space record, under `configuration`:
 *
 *   "allowedPaths":  ["Solution Design/Distribution", "Standards"]
 *   "excludedPaths": ["Solution Design/Distribution/Technology"]
 *
 * MATCHING IS PREFIX / SUBTREE, NOT GLOB. An entry names the ROOT of a subtree
 * and covers everything beneath it. `Standards`, `Standards/` and `Standards/*`
 * are the same rule — the trailing `/*` and `/**` are tolerated and stripped so
 * hand-written config behaves the way it reads. There is deliberately no
 * mid-path wildcard: these lists are curated by hand and a rule that quietly
 * matches more than it appears to is the wrong failure mode for an access
 * boundary. Comparison is case-insensitive (the content lives on Windows).
 *
 * The four rules, in order:
 *
 *   1. excludedPaths WINS. Anything at or below an excluded root is hidden,
 *      even inside an allowed subtree — that is the whole point of the pair
 *      (allow `Distribution`, carve out `Distribution/Technology`).
 *   2. No allowedPaths (absent or empty) = the space is UNRESTRICTED; only the
 *      exclusions apply.
 *   3. With allowedPaths, a path is visible only at or below an allowed root.
 *   4. An ANCESTOR of an allowed root survives as a PASS-THROUGH CONTAINER: the
 *      `Solution Design` folder appears in the nav purely so you can drill into
 *      `Distribution`, but its own files and its other children do not.
 *      A container with nothing left under it is dropped entirely.
 *
 * TWO EXEMPTIONS, both load-bearing:
 *
 *   - ROOT-LEVEL FILES are always visible. `home.md` / `.home.md` is the space
 *     landing page; hiding it behind an allowedPaths list would blank the home
 *     screen of every filtered space. Root-level FOLDERS get no such pass —
 *     they go through the rules like anything else.
 *   - DOT-SEGMENT PATHS resolve to their nearest visible ancestor rather than
 *     being judged on their own. `<folder>/.system/context/x.md` is plumbing
 *     for `<folder>`, so it inherits that folder's verdict. Judging it directly
 *     would fail (a `.system` path matches no rule) and break templates,
 *     context sidecars and office-document originals. Note this deliberately
 *     does NOT open a back door: `Business Processes/.system/originals/x.docx`
 *     resolves to `Business Processes`, which stays hidden.
 *
 * The compiled matcher is a pure function of the SPACE, never of the user, so
 * results stay cacheable per space — both the folder-tree ETag cache (keyed by
 * spaceId) and the search response cache (keyed by query string, which carries
 * spaceId) remain correct. Introducing a per-user rule would break both.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-07-25
 */

'use strict';

/**
 * Normalise a configured rule into a comparable subtree root.
 * Tolerates backslashes, leading `./`, surrounding slashes and a trailing
 * `/*` or `/**`, so every spelling of the same intent compiles identically.
 * @param {string} rule
 * @return {string} normalised root, '' if the rule is empty or a bare wildcard
 */
function normaliseRule(rule) {
  if (typeof rule !== 'string') return '';
  let value = rule.trim().replace(/\\/g, '/');
  value = value.replace(/\/+\*{1,2}$/, '');   // "Standards/*" -> "Standards"
  value = value.replace(/^\.\//, '');
  value = value.replace(/^\/+|\/+$/g, '');
  if (value === '*' || value === '**') return ''; // bare wildcard = "no rule"
  return value.toLowerCase();
}

/**
 * Normalise a runtime path (tree node path, search hit path, request param)
 * into the same space as the rules.
 * @param {string} value
 * @return {string}
 */
function normalisePath(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

/** True when `key` is the root itself or sits beneath it. */
function isAtOrBelow(root, key) {
  return key === root || key.startsWith(root + '/');
}

/**
 * The folder whose verdict a FILE inherits.
 *
 * Normally that is simply the file's directory — a file is as visible as the
 * folder holding it. When the path contains a dot-segment we truncate there
 * instead, so `a/b/.system/context/x.md` inherits from `a/b`: plumbing belongs
 * to the folder it describes, not to itself. Both cases collapse to '' for
 * root-level entries (`home.md`, `.system/templates/x.md`), which is what makes
 * the space landing page and the space-scoped `.system` dirs always reachable.
 *
 * @param {string} key already normalised
 * @return {string} owning folder, '' when the file sits at the space root
 */
function fileOwnerFolder(key) {
  const segments = key.split('/');
  const dotIndex = segments.findIndex(segment => segment.startsWith('.'));
  if (dotIndex !== -1) return segments.slice(0, dotIndex).join('/');
  return segments.slice(0, -1).join('/');
}

/**
 * Read the rule lists off a space record. Accepts them under `configuration`
 * (where they live) or at the top level, so a hand-edited space works either
 * way. A list whose entries all normalise away — `["*"]`, `[""]` — is treated
 * as absent, which is what makes a half-configured space fail OPEN rather than
 * going completely dark.
 * @param {Object} space
 * @return {{allowed: string[], excluded: string[]}}
 */
function readRules(space) {
  const config = (space && space.configuration) || {};
  const pick = (key) => {
    const raw = config[key] !== undefined ? config[key] : (space || {})[key];
    if (!Array.isArray(raw)) return [];
    return raw.map(normaliseRule).filter(Boolean);
  };
  return { allowed: pick('allowedPaths'), excluded: pick('excludedPaths') };
}

/**
 * Compile a space's rules into a reusable matcher.
 *
 * @param {Object} space - space record from spaces.json
 * @return {{
 *   restricted: boolean,
 *   isFileVisible: function(string): boolean,
 *   isFolderVisible: function(string): boolean,
 *   isFolderAccessible: function(string): boolean,
 *   isContainer: function(string): boolean,
 *   filterEntries: function(string, Array): Array,
 *   filterTree: function(Array): Array
 * }}
 */
function compileVisibility(space) {
  const { allowed, excluded } = readRules(space);
  const restricted = allowed.length > 0 || excluded.length > 0;

  const isExcluded = (key) => excluded.some(root => isAtOrBelow(root, key));
  const isAllowed = (key) =>
    allowed.length === 0 || allowed.some(root => isAtOrBelow(root, key));

  /**
   * An ancestor of an allowed root — kept in the tree so the user can drill
   * through it, but not visible in its own right. Normalises its own argument,
   * like every other predicate here; taking a pre-normalised key made callers
   * that passed a raw path silently answer false.
   */
  const isContainer = (rawPath) => {
    const key = normalisePath(rawPath);
    return key !== '' && allowed.some(root => root.startsWith(key + '/'));
  };

  /**
   * Files: judged on the folder that owns them, so `.system` plumbing inherits
   * and root-level files (the space landing page) always pass.
   */
  const isFileVisible = (rawPath) => {
    if (!restricted) return true;
    const key = normalisePath(rawPath);
    if (!key) return true;
    if (isExcluded(key)) return false;
    const owner = fileOwnerFolder(key);
    if (owner === '') return true;              // root-level file, or root plumbing
    if (isExcluded(owner)) return false;
    return isAllowed(owner);
  };

  /**
   * Folders in their own right — a pass-through ancestor is NOT visible by this
   * test, which is what keeps `Solution Design`'s own files hidden. No
   * root-level pass: a root folder goes through the rules like any other.
   */
  const isFolderVisible = (rawPath) => {
    if (!restricted) return true;
    const key = normalisePath(rawPath);
    if (!key) return true;                      // the space root itself
    if (isExcluded(key)) return false;
    return isAllowed(key);
  };

  /**
   * May the user LIST this folder? Broader than isFolderVisible: a pass-through
   * ancestor has to be listable or the nav could show `Solution Design` and
   * then fail to open it. The entries that come back are filtered separately.
   */
  const isFolderAccessible = (rawPath) => {
    if (!restricted) return true;
    const key = normalisePath(rawPath);
    if (!key) return true;
    if (isExcluded(key)) return false;
    return isAllowed(key) || isContainer(key);
  };

  /**
   * Filter one directory listing. `entries` are shaped like the filing
   * service's: objects with `name` plus `isDirectory`/`type`, or bare strings.
   *
   * The file/folder distinction genuinely changes the verdict — a folder is
   * judged on its own path, a file on its parent's — so an entry whose type
   * the filing provider did not report falls back to the extension heuristic
   * the rest of the app already uses for exactly this (see `isFile` in the
   * wiki frontend's handleDeepLink). An extensionless name is treated as a
   * folder, which fails closed: a stray extensionless FILE in a hidden folder
   * stays hidden rather than leaking.
   */
  const filterEntries = (dirPath, entries) => {
    if (!restricted || !Array.isArray(entries)) return entries || [];
    const base = normalisePath(dirPath);
    return entries.filter(entry => {
      const isObject = typeof entry === 'object' && entry !== null;
      const name = isObject ? entry.name : entry;
      if (!name || typeof name !== 'string') return false;

      const childPath = base ? `${base}/${name}` : name;
      const declaredDir = isObject
        ? (entry.isDirectory === true || entry.type === 'folder')
        : null;
      const isDir = isObject && (entry.isDirectory !== undefined || entry.type !== undefined)
        ? declaredDir
        : !/\.[^./\\]+$/.test(name);

      return isDir
        ? (isFolderVisible(childPath) || isContainer(childPath))
        : isFileVisible(childPath);
    });
  };

  /**
   * Prune a nav tree in place-safe fashion (returns new arrays, leaves the
   * caller's nodes untouched so a cached tree can be filtered per space).
   * Recursion continues INSIDE allowed subtrees so carve-out exclusions are
   * honoured at any depth.
   */
  const filterTree = (nodes) => {
    if (!restricted || !Array.isArray(nodes)) return nodes || [];

    const walk = (list) => {
      const kept = [];
      for (const node of list || []) {
        if (!node) continue;
        const key = normalisePath(node.path);
        if (key && isExcluded(key)) continue;

        if (node.type === 'folder') {
          const children = walk(node.children);
          if (isAllowed(key)) {
            kept.push({ ...node, children });
          } else if (isContainer(key) && (children.length > 0 || node.truncated)) {
            // Pass-through ancestor: kept only for what survives beneath it.
            // A TRUNCATED folder has not been walked (the tree is lazy — see
            // filingRoutes' depth limit), so its empty `children` proves
            // nothing. Dropping it would hide the allowed subtree underneath
            // and leave no way to ever drill down to it.
            kept.push({ ...node, children });
          }
        } else if (isFileVisible(node.path)) {
          kept.push(node);
        }
      }
      return kept;
    };

    return walk(nodes);
  };

  return {
    restricted,
    isFileVisible,
    isFolderVisible,
    isFolderAccessible,
    isContainer,
    filterEntries,
    filterTree
  };
}

module.exports = {
  compileVisibility,
  normaliseRule,
  normalisePath,
  readRules
};
