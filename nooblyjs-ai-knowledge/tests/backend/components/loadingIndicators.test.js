'use strict';

/**
 * Loading-state contracts between the JS that SETS a state and the CSS that
 * RENDERS it.
 *
 * These states are invisible by construction: the JS toggles an attribute or a
 * class, and a stylesheet somewhere else decides what that looks like. If the
 * two drift — a rename on one side, a stylesheet section deleted — nothing
 * throws, no test fails, and the app silently returns to the bug the indicator
 * was added for:
 *
 *   • data-brand-loading — assigning `img.src` does NOT clear the picture the
 *     browser is already showing, so without the placeholder the PREVIOUS
 *     space's logo sits in the header beside the NEW space's name until the
 *     file decodes.
 *   • data-brand-pending — a boot with no space in the URL guesses the last
 *     space; the app may auto-select a different one. Without the placeholder
 *     the header confidently claims a space that was never opened.
 *   • .kr-tree-loading / .is-tree-refreshing — without these the nav rail keeps
 *     the previous space's folders while the new tree loads, which reads as a
 *     dead click and shows content from a space the user just left.
 *
 * There is no jsdom in this project's jest environment, so this asserts the
 * source-level contract rather than rendering. That is the part that rots.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const THEME_JS = read('public/js/theme.js');
const KR_BASE_CSS = read('public/css/kr-base.css');
const WIKI_HTML = read('src/web/wiki/public/index.html');
const WIKI_CSS = read('src/web/wiki/public/css/wiki.css');
const NAV_JS = read('src/web/wiki/public/js/modules/navigationcontroller.js');

describe('brand placeholder', () => {
  test.each([
    ['data-brand-loading', 'the logo is swapping'],
    ['data-brand-pending', 'the space is not known yet']
  ])('theme.js sets %s and kr-base.css styles it', (attribute) => {
    expect(THEME_JS).toContain(attribute);
    // The attribute has to actually select something, not merely be written.
    expect(KR_BASE_CSS).toContain(`html[${attribute}]`);
  });

  test('the skeleton element theme.js relies on exists in the page', () => {
    // The placeholder is a SIBLING span, not a background on the <img>: an
    // image paints its bitmap over its own background, so a replaced element
    // that already has content cannot show a placeholder through it.
    expect(WIKI_HTML).toContain('kr-brand-logo-skeleton');
    expect(KR_BASE_CSS).toContain('.kr-brand-logo-skeleton');
    // ...and it must start hidden, or every page paints a shimmer.
    expect(KR_BASE_CSS).toMatch(/\.kr-brand-logo-skeleton\s*\{[^}]*display:\s*none/);
  });

  test('both states hide the real logo, or the stale bitmap stays visible', () => {
    for (const attribute of ['data-brand-loading', 'data-brand-pending']) {
      const hides = new RegExp(
        `html\\[${attribute}\\][^{]*\\.kr-brand-logo[^{]*\\{[^}]*display:\\s*none`
      );
      // The two selectors are written as one comma-separated rule, so match
      // against the rule text rather than requiring a standalone block.
      const rule = KR_BASE_CSS.includes(`html[${attribute}] .kr-brand-logo,`) ||
        KR_BASE_CSS.includes(`html[${attribute}] .kr-brand-logo {`) ||
        hides.test(KR_BASE_CSS);
      expect(rule).toBe(true);
    }
  });

  test('the loading state is always cleared, including on image error', () => {
    // A missing logo must not leave the header shimmering forever.
    expect(THEME_JS).toMatch(/addEventListener\(\s*'error'/);
    // ...and a known space clears `pending` even when the theme is unchanged,
    // since apply() short-circuits on an identical signature — which is exactly
    // the case where the boot guess turned out to be right.
    expect(THEME_JS).toMatch(
      /brandConfirmed\s*=\s*true[\s\S]{0,200}removeAttribute\('data-brand-pending'\)/
    );
  });

  test('re-applying the same logo does not flash a placeholder', () => {
    // Guarded on a CHANGE of src, and on the browser already having the file.
    expect(THEME_JS).toContain('previous !== src');
    expect(THEME_JS).toContain('img.complete');
  });
});

describe('the .placeholder-glow effect is actually implemented', () => {
  // This app loads Bootstrap's JS bundle but NOT its CSS, so every
  // `.placeholder-glow` block in it — the file tree, the spaces list, search
  // results, the document view, the space home — rendered as zero-height
  // invisible divs until these rules were added. The markup was there; the
  // effect never was. If the rules go, they all silently go blank again.
  const APP_JS = read('src/web/wiki/public/js/app.js');
  const DOC_JS = read('src/web/wiki/public/js/modules/documentcontroller.js');

  test('the base rule exists, since Bootstrap CSS is not loaded', () => {
    expect(KR_BASE_CSS).toContain('.placeholder-glow .placeholder');
    expect(KR_BASE_CSS).toMatch(/@keyframes kr-placeholder-glow/);
  });

  test('every width class the existing markup uses is defined', () => {
    const sources = [WIKI_HTML, NAV_JS, APP_JS, DOC_JS].join('\n');
    const used = new Set(
      (sources.match(/placeholder[^"'`]*?\bcol-(\d{1,2})\b/g) || [])
        .map((m) => m.match(/col-(\d{1,2})$/)[1])
    );
    expect(used.size).toBeGreaterThan(0);
    for (const n of used) {
      expect(KR_BASE_CSS).toContain(`.placeholder-glow .placeholder.col-${n}`);
    }
  });

  test('the helpers are SCOPED, so no inert Bootstrap class is revived', () => {
    // Defining `.mb-2` / `.d-flex` globally would change the layout of every
    // element in the app carrying a Bootstrap class that currently does
    // nothing — a far bigger blast radius than a loading placeholder needs.
    for (const helper of ['mb-2', 'ms-3', 'me-2', 'p-2', 'd-flex', 'rounded-circle']) {
      expect(KR_BASE_CSS).toContain(`.placeholder-glow .${helper}`);
      expect(KR_BASE_CSS).not.toMatch(new RegExp(`^\\.${helper}\\s*\\{`, 'm'));
    }
  });
});

describe('navigation tree loading indicator', () => {
  test('the switch placeholder is the SAME markup index.html ships', () => {
    // Two copies have to exist — the static one paints before any JS runs, the
    // controller's paints on every load after that — so the only protection
    // against them drifting into two different-looking effects is this.
    const rows = NAV_JS
      .slice(NAV_JS.indexOf('TREE_PLACEHOLDER_ROWS:'), NAV_JS.indexOf('Show that placeholder'))
      .match(/'([^']*placeholder[^']*)'/g)
      .map((s) => s.slice(1, -1))
      .join('');

    const staticBlock = WIKI_HTML
      .slice(WIKI_HTML.indexOf('<div id="fileTree"'), WIKI_HTML.indexOf('kr-hide-empty'));
    const staticRows = (staticBlock.match(/<div class="placeholder [^"]*"><\/div>/g) || [])
      .join('');

    expect(staticRows).not.toBe('');
    expect(rows).toBe(staticRows);
  });

  test('the tree loading header is rendered and styled', () => {
    expect(NAV_JS).toContain('renderTreeSkeleton');
    for (const cls of ['kr-tree-loading', 'kr-tree-loading-head', 'kr-spinner']) {
      expect(NAV_JS + WIKI_CSS).toContain(cls);
      expect(WIKI_CSS).toContain(cls);
    }
    // The bars come from the shared idiom, not a bespoke one.
    expect(NAV_JS).toContain('placeholder-glow');
  });

  test('the refreshing state is toggled and styled', () => {
    expect(NAV_JS).toContain('is-tree-refreshing');
    expect(WIKI_CSS).toContain('.kr-side-section.is-tree-refreshing');
  });

  test('the skeleton shows only when there is nothing cached to paint', () => {
    // Replacing a usable cached tree with a skeleton would be a downgrade; the
    // cached branch gets the thin progress line instead.
    const cachedBranch = NAV_JS.slice(
      NAV_JS.indexOf('Rendering cached tree for space'),
      NAV_JS.indexOf('2) Validate against the server')
    );
    expect(cachedBranch).toContain('setTreeRefreshing(true)');
    expect(cachedBranch).toContain('renderTreeSkeleton');
    // The skeleton call must sit in the ELSE (no cache) half.
    const elseHalf = cachedBranch.slice(cachedBranch.indexOf('} else {'));
    expect(elseHalf).toContain('renderTreeSkeleton');
    expect(elseHalf).not.toContain('setTreeRefreshing(true)');
  });

  test('the refreshing state is cleared on every exit path', () => {
    // Success, 304, fallback, discard-on-space-change and error all leave
    // loadFileTree — a per-branch call would eventually miss one and leave the
    // rail announcing work that finished.
    expect(NAV_JS).toMatch(/finally\s*\{[^}]*setTreeRefreshing\(false\)/);
  });

  test('animations are disabled under prefers-reduced-motion', () => {
    for (const css of [WIKI_CSS, KR_BASE_CSS]) {
      expect(css).toContain('prefers-reduced-motion');
    }
  });
});

describe('space home placeholder', () => {
  const APP_JS = read('src/web/wiki/public/js/app.js');

  test('it is painted before the awaits, not after them', () => {
    // The space home is the slowest thing on the screen (two round trips per
    // candidate, then a large markdown render). Putting the placeholder up
    // inside loadHomeContent alone would still leave the switch blank while
    // loadUserDashboard ran first.
    const start = APP_JS.indexOf('async showHome(');
    expect(start).toBeGreaterThan(-1);
    const branch = APP_JS.slice(start, APP_JS.indexOf('showSpacesView()', start));

    const placeholderAt = branch.indexOf('showHomeContentPlaceholder');
    const dashboardAt = branch.indexOf('await this.loadUserDashboard()');
    expect(placeholderAt).toBeGreaterThan(-1);
    expect(dashboardAt).toBeGreaterThan(-1);
    expect(placeholderAt).toBeLessThan(dashboardAt);
    // ...and re-asserted by the loader itself, for callers that skip showHome.
    expect(APP_JS).toContain('this.showHomeContentPlaceholder();');
  });

  test('it uses the shared idiom rather than a bespoke effect', () => {
    expect(APP_JS).toMatch(/showHomeContentPlaceholder\(\)[\s\S]{0,900}placeholder-glow/);
  });

  test('a space with no landing page takes the placeholder down', () => {
    // Otherwise it pulses forever at content that is never coming.
    expect(APP_JS).toContain('clearHomeContentPlaceholder');
    const clear = APP_JS.slice(APP_JS.indexOf('clearHomeContentPlaceholder() {'));
    // ...but only when the placeholder is still what's in the box: a completed
    // render replaced it already, and blanking that would undo the load.
    expect(clear).toContain("querySelector('.kr-home-loading')");
  });

  test('re-asserting it does not restart the glow mid-pulse', () => {
    const show = APP_JS.slice(
      APP_JS.indexOf('showHomeContentPlaceholder() {'),
      APP_JS.indexOf('showListPlaceholder(')
    );
    expect(show).toContain("querySelector('.kr-home-loading')");
  });
});

describe('placeholders paint in the same frame as the space change', () => {
  const APP_JS = read('src/web/wiki/public/js/app.js');
  const SPACES_JS = read('src/web/wiki/public/js/modules/spacescontroller.js');

  /** selectSpace's body, up to the first await. */
  function selectSpaceSyncPrefix() {
    const body = SPACES_JS.slice(
      SPACES_JS.indexOf('async selectSpace(spaceId)'),
      SPACES_JS.indexOf('updateWorkspaceHeader()')
    );
    const firstAwait = body.indexOf('await ');
    expect(firstAwait).toBeGreaterThan(-1);
    return { body, sync: body.slice(0, firstAwait) };
  }

  test('the loading state is entered before selectSpace ever awaits', () => {
    // The bug this pins: the nav skeleton painted with the palette flip, but
    // the home placeholders lived inside showHome(), which is only reached
    // AFTER `await loadFileTree()`. One click produced three visual steps —
    // colour, then placeholders a network round trip later, then content.
    const { sync } = selectSpaceSyncPrefix();
    expect(sync).toContain('enterSpaceLoadingState');
  });

  test('it is entered before the palette flip, so they land together', () => {
    const { sync } = selectSpaceSyncPrefix();
    expect(sync.indexOf('enterSpaceLoadingState'))
      .toBeLessThan(sync.indexOf('applyForSpace'));
  });

  test('enterSpaceLoadingState contains no await of its own', () => {
    const fn = APP_JS.slice(
      APP_JS.indexOf('enterSpaceLoadingState(space) {'),
      APP_JS.indexOf('showListPlaceholder(containerId')
    );
    expect(fn).not.toContain('await ');
    // ...and is not declared async, which would make callers await it.
    expect(APP_JS).not.toContain('async enterSpaceLoadingState');
  });

  test('it covers the rail, the landing page and all four list sections', () => {
    const fn = APP_JS.slice(
      APP_JS.indexOf('enterSpaceLoadingState(space) {'),
      APP_JS.indexOf('showListPlaceholder(containerId')
    );
    expect(fn).toContain('renderTreeSkeleton');
    expect(fn).toContain('showHomeContentPlaceholder');
    expect(fn).toContain('showHomeSectionPlaceholders');
  });

  test('the previous space\'s tree is dropped before the hero stats read it', () => {
    const fn = APP_JS.slice(
      APP_JS.indexOf('enterSpaceLoadingState(space) {'),
      APP_JS.indexOf('showListPlaceholder(containerId')
    );
    // restoreHomeView() derives the document count from fullFileTree; left in
    // place it shows the space just left. null, not [], so the count reads
    // "unknown" (—) rather than a confident zero.
    expect(fn).toMatch(/fullFileTree\s*=\s*null/);
    expect(fn.indexOf('fullFileTree = null'))
      .toBeLessThan(fn.indexOf('this.restoreHomeView()'));
  });

  test('every placeholder is idempotent, so re-asserting does not restart it', () => {
    // Each is painted at the click and again inside showHome/loadFileTree.
    // Rewriting the markup restarts the glow mid-pulse, which reads as a
    // second, separate loading state — the thing being fixed.
    const NAV_LOCAL = read('src/web/wiki/public/js/modules/navigationcontroller.js');
    expect(NAV_LOCAL).toMatch(/querySelector\('\.kr-tree-loading'\)/);
    expect(APP_JS).toMatch(/querySelector\('\.kr-home-loading'\)/);
    expect(APP_JS).toMatch(/querySelector\('\.kr-rows-loading'\)/);
  });
});

describe('home list sections (Browse / Pinned / Recent / Starred)', () => {
  const APP_JS = read('src/web/wiki/public/js/app.js');

  test('all four get a placeholder at the start of the switch', () => {
    const fn = APP_JS.slice(
      APP_JS.indexOf('showHomeSectionPlaceholders('),
      APP_JS.indexOf('clearHomeContentPlaceholder() {')
    );
    for (const id of [
      'homeFolderContent',    // Browse
      'pinnedFilesContent',   // Pinned
      'recentFilesContent',   // Recent
      'starredFilesContent'   // Starred
    ]) {
      expect(fn).toContain(id);
      // ...and each id must be a real element on the page.
      expect(WIKI_HTML).toContain(`id="${id}"`);
    }
  });

  test('the placeholders go up before the awaits, like the home content', () => {
    const start = APP_JS.indexOf('async showHome(');
    const branch = APP_JS.slice(start, APP_JS.indexOf('showSpacesView()', start));

    const at = branch.indexOf('showHomeSectionPlaceholders');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(branch.indexOf('await this.loadUserDashboard()'));
  });

  test('the row placeholder uses the shared idiom and is styled', () => {
    const fn = APP_JS.slice(
      APP_JS.indexOf('showListPlaceholder('),
      APP_JS.indexOf('escapeAttr(value) {')
    );
    expect(fn).toContain('placeholder-glow');
    for (const cls of ['kr-rows-loading', 'kr-row-loading', 'kr-row-loading-ico']) {
      expect(fn).toContain(cls);
      expect(KR_BASE_CSS).toContain(cls);
    }
  });

  test('the Browse heading is named on EVERY path out of loadHomeFolder', () => {
    // It used to be written only on the success path, so the two early returns
    // ("tree not ready", "space is empty") left it reading "Browse <previous
    // space>" above the new space's content — the mismatch in the report.
    const fn = APP_JS.slice(
      APP_JS.indexOf('loadHomeFolder() {'),
      APP_JS.indexOf('async loadPinnedFiles()')
    );
    const titleAt = fn.indexOf('titleEl.textContent');
    expect(titleAt).toBeGreaterThan(-1);
    // Ahead of the tree check — that is the branch that returns early while a
    // space is still loading, and the one that stranded the old heading. (The
    // `if (!container) return` above it is not a path that can name anything.)
    expect(titleAt).toBeLessThan(fn.indexOf('const tree = navigationController.fullFileTree'));
    // ...and written exactly once, not re-set per branch.
    expect(fn.match(/titleEl\.textContent/g)).toHaveLength(1);
  });

  test('the switch names the new space immediately, not after the loads', () => {
    const fn = APP_JS.slice(
      APP_JS.indexOf('showHomeSectionPlaceholders('),
      APP_JS.indexOf('clearHomeContentPlaceholder() {')
    );
    expect(fn).toContain('homeFolderTitle');
    expect(fn).toMatch(/Browse \$\{space\?\.name/);
  });
});
