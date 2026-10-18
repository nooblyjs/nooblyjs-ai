/**
 * navigation-core.js — shared, DOM-free navigation logic for the wiki left nav.
 *
 * SINGLE SOURCE OF TRUTH for the drill-down navigation, the inner breadcrumb,
 * and the ETag/localStorage tree cache. It contains pure functions only — no
 * DOM access, no framework — so it can be consumed by:
 *   • the web wiki (vanilla ES modules, served statically), and
 *   • the Teams wiki (React, bundled by Vite — imports this via the `@nav-core` alias).
 *
 * Renderers stay framework-specific and thin: they call resolveDrill()/
 * buildBreadcrumbSegments() and map the returned plain data to HTML or JSX.
 *
 * A node is `{ name, path, type: 'folder'|'document', title?, spaceName?, children? }`.
 */

/** Strip leading/trailing slashes; '' and '/' both mean the space root. */
export function normalizeDrillPath(path) {
  return (path || '').replace(/^\/+|\/+$/g, '');
}

/**
 * The candidate landing-page documents for a space at its ROOT, most specific
 * first. The caller opens the first one that EXISTS.
 *
 * Order — the space's own configuration always wins:
 *   1. `space.theme.home`  — authored beside the brand, e.g. `".retail.md"`
 *   2. `space.home`        — older top-level spelling, still honoured
 *   3. `.home.md`
 *   4. `home.md`
 *
 * This ordering is not cosmetic. Several spaces sit on ONE content root
 * (Engineering, Retail, Fintech and People are all rooted at
 * `knowledge-content/engineering`, whose root holds `.engineering.md`,
 * `.retail.md`, `.fintech.md` and `.people.md` side by side). Every one of
 * those files therefore exists for every one of those spaces — so nothing
 * 404s, and the ONLY thing that distinguishes which page a space opens is its
 * own configuration. Resolve against the wrong space record and you get a
 * confident, wrong answer rather than a miss.
 *
 * Pure and space-scoped on purpose: pass the space you mean, once, and reuse
 * the result. Deriving it from mutable "current space" state part-way through
 * an async resolution is what let two overlapping space loads mix.
 *
 * @param {Object} space space record from spaces.json
 * @returns {string[]} space-relative paths, most specific first
 */
export function spaceHomeCandidates(space) {
  const candidates = [];
  const add = (value) => {
    if (typeof value !== 'string') return;
    const cleaned = value.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
  };

  const theme = space && space.theme;
  if (theme && typeof theme === 'object') add(theme.home);
  add(space && space.home);
  add('.home.md');
  add('home.md');
  return candidates;
}

/** True when a node is shown in the nav (folders + documents, no dotfiles). */
export function isVisibleNode(node) {
  if (!node || !node.name) return false;
  if (node.name.startsWith('.')) return false;
  return node.type === 'folder' || node.type === 'document';
}

/** Depth-first search for a node by exact path. */
export function findNodeInTree(nodes, targetPath) {
  if (!nodes) return null;
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Split a node's children into visible folders + files, preserving the order
 * the backend returned them in. The tree comes from `buildTreeFromFiling`, which
 * already applies each folder's saved custom order (`.system/file-order.json`)
 * and falls back to a folders-first, A→Z default — so we must NOT re-sort here,
 * or a user's manual ordering (e.g. "Business Solution" first) gets clobbered.
 */
export function sortVisibleChildren(children) {
  const visible = (children || []).filter((n) => isVisibleNode(n));
  return {
    folders: visible.filter((n) => n.type === 'folder'),
    files: visible.filter((n) => n.type === 'document'),
  };
}

/**
 * Resolve the children to list for a given drill path.
 * Returns { children, exists }. At root, children are the tree's top level.
 */
export function getDrillChildren(tree, normalizedPath) {
  if (!normalizedPath) {
    return { children: tree || [], exists: true };
  }
  const node = findNodeInTree(tree, normalizedPath);
  if (!node || node.type !== 'folder') {
    return { children: [], exists: false };
  }
  return { children: node.children || [], exists: true };
}

/**
 * True when a folder node has at least one visible child.
 *
 * A `truncated` folder counts as having children even though its `children`
 * array is empty: the server stopped the walk there and has not listed it, so
 * "no children loaded" is not "no children". Answering false would render the
 * folder without a drill chevron and make it permanently unopenable — which is
 * the one failure the lazy tree must not have.
 */
export function hasVisibleChildren(node) {
  if (node && node.truncated) return true;
  return (node.children || []).some((c) => isVisibleNode(c));
}

/**
 * How many rungs one collapsed row may show before it stops compressing.
 * Three keeps `A › B › C` readable in the ~230px nav column; past that the
 * label just ellipsises and the compression has cost more than it saved.
 */
export const MAX_CHAIN_SEGMENTS = 3;

/**
 * True when a folder is a PASS-THROUGH RUNG — it exists only to hold one
 * subfolder, so giving it a row of its own tells the reader nothing and costs
 * them a click.
 *
 * "Exactly one visible child, and it is a folder" is deliberately the same
 * predicate the nav renders by (`sortVisibleChildren`), so the rule can never
 * disagree with what is on screen: a folder holding `.home.md` + one subfolder
 * IS a rung (the dotfile draws no row), while one holding a visible `home.md`
 * + one subfolder is NOT — that document draws a row, and collapsing past it
 * would hide content behind a label that claims to be a shortcut.
 *
 * A `truncated` folder is NEVER a rung. The tree is LAZY — the server stopped
 * walking there and has not listed it — so "has one child" is not something we
 * know, and guessing would collapse a folder that turns out to hold twenty.
 * Answering false leaves the row uncompressed until the user drills in and the
 * real children arrive, which is the safe direction to be wrong in.
 */
export function isPassThroughRung(node) {
  if (!node || node.type !== 'folder' || node.truncated) return false;
  const { folders, files } = sortVisibleChildren(node.children);
  return files.length === 0 && folders.length === 1;
}

/**
 * Collapse a run of single-child folders into the one rung worth showing.
 *
 * `Commercial Services` holding only `Technology` is not two levels of
 * information, it is one level written twice. This walks down while each
 * folder is a pass-through rung and returns the DEEPEST folder reached plus
 * every label passed through, so a renderer can draw ONE row reading
 * `Commercial Services › Technology` whose contents, chevron and click target
 * are Technology's.
 *
 * This is a DISPLAY transform and nothing else. Every segment keeps its real
 * path, no synthetic path is invented, and each intermediate folder stays
 * individually addressable — which is what keeps pins, deep links,
 * notification topics and Share links working, and is precisely why this is
 * not an auto-redirect. An auto-redirect also traps the back button (Back to
 * the rung immediately forwards you off it again) and can strand a folder's
 * own home page with no way to open it.
 *
 * Walks ONLY what is already in memory: `isPassThroughRung` refuses a
 * truncated folder, so a chain lengthens as the lazy tree fills in rather than
 * provoking the sequential subtree fetches the lazy tree exists to avoid.
 *
 * @param {object} node folder node to start from
 * @param {{ maxSegments?: number }} [options]
 * @returns {{ terminal: object, segments: Array<{label:string, path:string}>, collapsed: boolean }}
 */
export function collapseChain(node, options = {}) {
  const max = Math.max(1, options.maxSegments || MAX_CHAIN_SEGMENTS);
  const segments = [];
  let terminal = node;
  if (node) segments.push({ label: node.name, path: node.path });

  while (terminal && segments.length < max && isPassThroughRung(terminal)) {
    const next = sortVisibleChildren(terminal.children).folders[0];
    // Defensive: the content roots are directories of symlinked git repos, so
    // a link resolving onto its own ancestor must not spin here.
    if (!next || !next.path || next.path === terminal.path) break;
    terminal = next;
    segments.push({ label: next.name, path: next.path });
  }

  return { terminal, segments, collapsed: segments.length > 1 };
}

/**
 * The folder the BACK row should return to — the inverse of the click that a
 * collapsed row performs.
 *
 * Drilling `Solution Design` → `Commercial Services › Technology` is ONE click,
 * so coming back out has to be one click too, or the user is dropped on a rung
 * the nav never offered them and the two directions disagree. Walks up while
 * each ancestor is a pass-through rung and returns the first that is not
 * ('' = space root).
 *
 * The top breadcrumb is untouched and still lists every rung, so a skipped
 * folder keeps exactly one guaranteed way in — which is what makes skipping it
 * here a shortcut rather than a folder nobody can reach.
 */
export function collapseAncestor(tree, parentPath) {
  let current = normalizeDrillPath(parentPath);
  // Terminates unconditionally: `current` loses a segment every pass.
  while (current && isPassThroughRung(findNodeInTree(tree, current))) {
    current = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
  }
  return current;
}

/**
 * Resolve everything a renderer needs to draw the drill view at `path`.
 *
 * Mirrors the web wiki's renderDrillView data logic:
 *  - falls back to the nearest surviving ancestor (or root) if the path is gone,
 *  - at the space root shows TWO levels (each top folder + its direct children)
 *    for a rich landing; deeper levels show a single level with drill-in chevrons,
 *  - returns a flat `rows` list the renderer maps to markup/JSX.
 *
 * With `options.collapseChains`, single-child folder runs are compressed (see
 * collapseChain): the row's `node` becomes the DEEPEST folder of the run and
 * `chain` carries the labels passed through for the renderer to draw as one
 * compound, per-segment-clickable label. `parentPath` skips the same run
 * upward so back-out costs the same one click that drilling in did. Off by
 * default, so an un-migrated renderer (Teams) is unaffected.
 *
 * @param {Array} tree
 * @param {string} spaceName
 * @param {string} [path]
 * @param {{ collapseChains?: boolean, maxSegments?: number }} [options]
 * @returns {{
 *   drillPath: string, headerLabel: string, headerIsRoot: boolean,
 *   parentPath: string, parentLabel: string|null,
 *   rows: Array<{ kind:'folder'|'file', node:object, level:number, isGroup:boolean,
 *                 hasChildren:boolean, chain:Array<{label:string,path:string}>|null }>,
 *   isEmpty: boolean
 * }}
 */
export function resolveDrill(tree, spaceName, path = '', options = {}) {
  let normalized = normalizeDrillPath(path);
  let { children, exists } = getDrillChildren(tree, normalized);

  if (!exists) {
    // Walk up to the nearest surviving ancestor (or root).
    const parts = normalized.split('/').filter(Boolean);
    normalized = '';
    while (parts.length) {
      parts.pop();
      const candidate = parts.join('/');
      const probe = getDrillChildren(tree, candidate);
      if (probe.exists) { normalized = candidate; children = probe.children; break; }
    }
    if (!normalized) children = getDrillChildren(tree, '').children;
  }

  const collapseChains = !!options.collapseChains;
  const safeSpace = spaceName || 'Space';
  const headerLabel = normalized ? normalized.split('/').pop() : safeSpace;
  const immediateParent = normalized.includes('/')
    ? normalized.slice(0, normalized.lastIndexOf('/'))
    : '';
  const parentPath = collapseChains
    ? collapseAncestor(tree, immediateParent)
    : immediateParent;
  const parentLabel = normalized
    ? (parentPath ? parentPath.split('/').pop() : safeSpace)
    : null; // null → at root, no back row

  const { folders, files } = sortVisibleChildren(children);
  const twoLevel = !normalized; // root only
  const rows = [];

  /**
   * Build one folder row, compressing a single-child run into it when asked.
   * The row's `node` becomes the run's TERMINAL, so its chevron, status colour,
   * click target and drop target all describe the folder whose contents the
   * row actually stands for.
   */
  const folderRow = (node, level, isGroup) => {
    // A group header is never collapsed: the root view already prints its
    // children on the rows beneath it, so compressing the header would say the
    // same thing twice and orphan the inlined rows from their heading.
    if (!collapseChains || isGroup) {
      return { kind: 'folder', node, level, isGroup, hasChildren: hasVisibleChildren(node), chain: null };
    }
    const { terminal, segments, collapsed } = collapseChain(node, options);
    return {
      kind: 'folder',
      node: terminal,
      level,
      isGroup,
      hasChildren: hasVisibleChildren(terminal),
      chain: collapsed ? segments : null,
    };
  };

  for (const folder of folders) {
    if (twoLevel) {
      // Level 0: a top-level folder rendered as an expanded group header.
      rows.push(folderRow(folder, 0, true));
      // Level 1: that folder's own children (the second level).
      const sub = sortVisibleChildren(folder.children);
      for (const subFolder of sub.folders) {
        rows.push(folderRow(subFolder, 1, false));
      }
      for (const subFile of sub.files) {
        rows.push({ kind: 'file', node: subFile, level: 1, isGroup: false, hasChildren: false, chain: null });
      }
    } else {
      // Deeper: a single level — folder row with a drill-in chevron when it has children.
      rows.push(folderRow(folder, 0, false));
    }
  }
  // Files in the current folder come after the folder rows.
  for (const file of files) {
    rows.push({ kind: 'file', node: file, level: 0, isGroup: false, hasChildren: false, chain: null });
  }

  return {
    drillPath: normalized,
    headerLabel,
    headerIsRoot: !normalized,
    parentPath,
    parentLabel,
    rows,
    isEmpty: rows.length === 0,
  };
}

/**
 * Build the segmented folder breadcrumb (Space / A / B / current) as plain data.
 * The last segment is non-clickable (current); earlier ones link to their path.
 * @returns {Array<{ label:string, path:string, isRoot:boolean, isLast:boolean, isLink:boolean }>}
 */
export function buildBreadcrumbSegments(spaceName, folderPath) {
  const normalized = normalizeDrillPath(folderPath);
  const root = { label: spaceName || '', path: '', isRoot: true, isLast: !normalized, isLink: !!normalized };
  if (!normalized) return [root];

  const segments = normalized.split('/').filter(Boolean);
  const out = [root];
  let cumulative = '';
  segments.forEach((segment, idx) => {
    cumulative = cumulative ? `${cumulative}/${segment}` : segment;
    const isLast = idx === segments.length - 1;
    out.push({ label: segment, path: cumulative, isRoot: false, isLast, isLink: !isLast });
  });
  return out;
}

/**
 * Build a folder-overview model for the center content pane: the visible child
 * folders (each with a `childCount`) and files of `folderPath`, plus counts.
 * Mirrors the web wiki's `createFolderOverview` + root handling so both apps
 * derive the same listing from the shared tree. An empty/'/' path is the space
 * root (children are the tree's top level). Returns null if the path isn't a folder.
 *
 * @returns {{
 *   title: string, path: string, spaceName: string,
 *   stats: { files: number, folders: number },
 *   folders: Array<object & { childCount: number }>, files: object[]
 * }|null}
 */
export function buildFolderOverview(tree, folderPath, spaceName) {
  const normalized = normalizeDrillPath(folderPath);
  let node;
  if (!normalized) {
    node = { name: spaceName || 'Root', path: '', type: 'folder', children: tree || [] };
  } else {
    node = findNodeInTree(tree, normalized);
  }
  if (!node || node.type !== 'folder') return null;

  const { folders, files } = sortVisibleChildren(node.children);
  // NOTE: a `truncated` child has not been listed yet (the tree is fetched
  // level by level), so its count here is 0 until it is. The web wiki avoids
  // that by loading a folder's grandchildren before rendering its overview —
  // navigationController.ensureFolderLoaded. `truncated` is carried through on
  // each node so any other renderer can make the same distinction.
  const foldersWithCounts = folders.map((folder) => ({
    ...folder,
    childCount: (folder.children || []).filter((c) => isVisibleNode(c)).length,
  }));
  const withSpace = (item) => ({ ...item, spaceName: item.spaceName || spaceName || '' });

  return {
    title: normalized ? (node.name || normalized.split('/').pop()) : (spaceName || 'Root'),
    path: normalized,
    spaceName: spaceName || '',
    stats: { files: files.length, folders: folders.length },
    folders: foldersWithCounts.map(withSpace),
    files: files.map(withSpace),
  };
}

/**
 * Create a per-space tree cache backed by Web Storage (localStorage by default).
 * Stores `{ tree, etag, savedAt }` keyed by spaceId, with an LRU index capping
 * the number of cached spaces. All failures are swallowed — the cache is always
 * best-effort, so a quota error or private-mode storage never breaks loading.
 */
export function createTreeCache(options = {}) {
  const {
    storage = (typeof localStorage !== 'undefined' ? localStorage : null),
    maxSpaces = 5,
    keyPrefix = 'wiki-tree-',
    indexKey = 'wiki-tree-index',
    // Well under the ~5M-character origin quota, leaving room for the other
    // cached spaces and everything else the app keeps in localStorage.
    maxChars = 3.5 * 1024 * 1024,
  } = options;

  const key = (spaceId) => `${keyPrefix}${spaceId}`;
  let warnedTooLarge = false;

  const readIndex = () => {
    if (!storage) return [];
    try {
      const raw = storage.getItem(indexKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const touchIndex = (spaceId) => {
    if (!storage) return;
    const idx = readIndex().filter((id) => id !== spaceId);
    idx.push(spaceId);
    while (idx.length > maxSpaces) {
      const evicted = idx.shift();
      try { storage.removeItem(key(evicted)); } catch { /* ignore */ }
    }
    try { storage.setItem(indexKey, JSON.stringify(idx)); } catch { /* ignore */ }
  };

  const evictOldest = () => {
    if (!storage) return;
    const idx = readIndex();
    if (idx.length === 0) return;
    const oldest = idx.shift();
    try {
      storage.removeItem(key(oldest));
      storage.setItem(indexKey, JSON.stringify(idx));
    } catch { /* ignore */ }
  };

  return {
    /** @returns {{ tree:any[], etag:string|null }|null} */
    read(spaceId) {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key(spaceId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return { tree: parsed.tree, etag: parsed.etag || null };
      } catch {
        return null;
      }
    },

    write(spaceId, tree, etag) {
      if (!storage) return;
      const payload = JSON.stringify({ tree, etag: etag || null, savedAt: Date.now() });

      // A tree bigger than the origin quota can never be stored, and finding
      // that out costs two throwing setItem calls plus an eviction that
      // discards a perfectly good cache entry for a smaller space. Check first.
      // (Browsers count localStorage in UTF-16 code units, so the character
      // length is the number that matters, not the byte length.)
      if (payload.length > maxChars) {
        if (!warnedTooLarge) {
          warnedTooLarge = true;
          // eslint-disable-next-line no-console
          console.warn(
            `[TreeCache] Space ${spaceId} tree is ${(payload.length / 1048576).toFixed(1)}M chars — over the ~${(maxChars / 1048576).toFixed(0)}M localStorage budget, so it will not be cached. ` +
            'Every load of this space will wait for a full server build.'
          );
        }
        return;
      }

      try {
        storage.setItem(key(spaceId), payload);
        touchIndex(spaceId);
      } catch {
        // QuotaExceededError is the common case — drop oldest and retry once.
        evictOldest();
        try {
          storage.setItem(key(spaceId), payload);
          touchIndex(spaceId);
        } catch { /* give up — cache is best-effort */ }
      }
    },

    invalidate(spaceId) {
      if (!storage) return;
      try { storage.removeItem(key(spaceId)); } catch { /* ignore */ }
    },

    /**
     * Remove every cached space tree and the LRU index. Iterates the storage
     * keyspace directly (not just the index) so orphaned entries are also
     * purged. Returns the number of keys removed.
     * @returns {number}
     */
    clear() {
      if (!storage) return 0;
      let removed = 0;
      try {
        // Collect first, then delete — removing while iterating shifts indices.
        const toRemove = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && (k.startsWith(keyPrefix) || k === indexKey)) toRemove.push(k);
        }
        for (const k of toRemove) {
          try { storage.removeItem(k); removed++; } catch { /* ignore */ }
        }
      } catch { /* best-effort */ }
      return removed;
    },
  };
}
