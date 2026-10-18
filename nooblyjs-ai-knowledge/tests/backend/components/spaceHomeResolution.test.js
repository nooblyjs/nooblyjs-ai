'use strict';

/**
 * Space landing-page resolution at the ROOT.
 *
 * Four spaces sit on ONE content root: Engineering, Retail, Fintech and
 * People are all rooted at `knowledge-content/engineering`, whose root holds
 * `.engineering.md`, `.retail.md`, `.fintech.md` and `.people.md` side by
 * side. Every one of those files therefore EXISTS for every one of those
 * spaces — nothing 404s — so the only thing that decides which page a space
 * opens is its own configuration, and resolving against the wrong space record
 * produces a confident wrong answer instead of a miss.
 *
 * That is exactly what a race produced: two overlapping space loads, candidates
 * computed for one space and fetched against another, and the Engineering home
 * visibly flipping to Retail's. Two properties keep it fixed:
 *
 *   1. ORDER — the space's own `theme.home` / `home` beats `.home.md` /
 *      `home.md`, and the caller takes the first that exists.
 *   2. PURITY — the rule takes the space as an argument, so a caller can pin
 *      one record for a whole async resolution instead of re-reading mutable
 *      "current space" state between awaits.
 *
 * navigation-core.js is a browser ES module (also consumed by the Teams wiki via
 * the @nav-core alias), so it is evaluated here in a `vm` with the `export`
 * keywords stripped — the same approach landingBlocks.test.js uses for the
 * browser-side parser.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORE = path.resolve(
  __dirname,
  '../../../src/web/wiki/public/js/shared/navigation-core.js'
);

/** Evaluate navigation-core in a vm and hand back the bindings we need. */
function loadCore() {
  const source = fs.readFileSync(CORE, 'utf8').replace(/^export\s+/gm, '');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'navigation-core.js' });
  return vm.runInContext(
    '({ spaceHomeCandidates, hasVisibleChildren })',
    ctx
  );
}

const { spaceHomeCandidates } = loadCore();

/** The real shape from spaces.json. */
const RETAIL = {
  id: 5,
  name: 'Retail',
  theme: { title: 'Retail', color: '#0e6362', home: '.retail.md' }
};
const ENGINEERING = {
  id: 1,
  name: 'Engineering',
  theme: { title: 'Engineering', home: '.engineering.md' }
};
const PLAIN = { id: 9, name: 'Plain' };

describe('the space configuration decides the root landing page', () => {
  test("theme.home comes first, so a space opens its OWN page", () => {
    expect(spaceHomeCandidates(RETAIL)[0]).toBe('.retail.md');
    expect(spaceHomeCandidates(ENGINEERING)[0]).toBe('.engineering.md');
  });

  test('.home.md / home.md remain the fallback, after the configured page', () => {
    expect(spaceHomeCandidates(RETAIL)).toEqual([
      '.retail.md', '.home.md', 'home.md'
    ]);
  });

  test('a space that names nothing falls straight back', () => {
    expect(spaceHomeCandidates(PLAIN)).toEqual(['.home.md', 'home.md']);
  });

  test('the older top-level `home` spelling is still honoured', () => {
    expect(spaceHomeCandidates({ home: 'Landing.md' })).toEqual([
      'Landing.md', '.home.md', 'home.md'
    ]);
  });

  test('theme.home wins over a top-level home when both are set', () => {
    const space = { home: 'old.md', theme: { home: 'new.md' } };
    expect(spaceHomeCandidates(space)).toEqual([
      'new.md', 'old.md', '.home.md', 'home.md'
    ]);
  });

  test('leading slashes and backslashes are normalised, duplicates collapse', () => {
    const space = { theme: { home: '\\\\Docs\\Landing.md ' }, home: '/Docs/Landing.md' };
    expect(spaceHomeCandidates(space)).toEqual([
      'Docs/Landing.md', '.home.md', 'home.md'
    ]);
  });

  test('a missing/garbage space still yields the plain fallbacks', () => {
    for (const value of [null, undefined, {}, { theme: 'not-an-object' }, { theme: { home: 42 } }]) {
      expect(spaceHomeCandidates(value)).toEqual(['.home.md', 'home.md']);
    }
  });

  test('resolution is PURE — two spaces on one root never collide', () => {
    // The failure mode: candidates built for one space, used for another. Since
    // both files exist in the shared root, only keeping the lists separate
    // distinguishes them.
    const a = spaceHomeCandidates(RETAIL);
    const b = spaceHomeCandidates(ENGINEERING);

    expect(a[0]).not.toBe(b[0]);
    expect(a).not.toContain('.engineering.md');
    expect(b).not.toContain('.retail.md');
    // ...and calling again does not mutate a previous result.
    expect(spaceHomeCandidates(RETAIL)).toEqual(a);
  });
});

describe('the space-selection generation token', () => {
  // Mirrors app.beginSpaceSelection / isSpaceCurrent: a counter bumped per
  // selection, with every async step carrying the token it started with. The
  // property that matters is LAST SELECTION WINS regardless of which network
  // round trip finishes first.
  function makeApp() {
    return {
      spaceGeneration: 0,
      currentSpace: null,
      beginSpaceSelection() { return ++this.spaceGeneration; },
      isSpaceCurrent(token) { return token === this.spaceGeneration; }
    };
  }

  /** A space load that paints only if it is still the newest. */
  async function loadSpace(app, space, delayMs, painted) {
    app.currentSpace = space;
    const token = app.beginSpaceSelection();
    await new Promise(r => setTimeout(r, delayMs));
    if (!app.isSpaceCurrent(token)) return;
    painted.push(space.name);
  }

  test('a slow earlier selection does not paint over a fast later one', async () => {
    const app = makeApp();
    const painted = [];

    // Engineering starts first but resolves LAST — the exact interleaving that
    // made the wrong home appear.
    await Promise.all([
      loadSpace(app, ENGINEERING, 40, painted),
      loadSpace(app, RETAIL, 5, painted)
    ]);

    expect(painted).toEqual(['Retail']);
  });

  test('the newest selection always paints, however many are queued', async () => {
    const app = makeApp();
    const painted = [];
    const spaces = [ENGINEERING, RETAIL, ENGINEERING, RETAIL];

    await Promise.all(
      spaces.map((space, i) => loadSpace(app, space, 30 - i * 5, painted))
    );

    expect(painted).toEqual(['Retail']);
    expect(app.currentSpace.name).toBe('Retail');
  });

  test('an uncontested selection paints normally', async () => {
    const app = makeApp();
    const painted = [];

    await loadSpace(app, ENGINEERING, 1, painted);

    expect(painted).toEqual(['Engineering']);
  });
});
