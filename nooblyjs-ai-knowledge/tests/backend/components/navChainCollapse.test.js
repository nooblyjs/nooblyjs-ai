'use strict';

/**
 * Collapsing single-folder chains in the left nav.
 *
 * A folder that holds nothing but ONE subfolder is not a level of information,
 * it is one level written twice: `Solution Design / Commercial Services` opens
 * onto a single row, `Technology`, which then opens onto four. The nav collapses
 * such a run into ONE row — `Commercial Services › Technology` — standing for
 * the deepest folder reached.
 *
 * The deliberate choice under test is that this is a DISPLAY transform, never an
 * auto-redirect. Auto-navigating off a thin folder traps the back button (Back
 * lands on the rung, which immediately forwards you off it again), silently
 * re-points shared links and pins (path is identity everywhere in this app), and
 * can strand a folder's own home page with no way to open it. Collapsing keeps
 * every real path addressable and merely stops spending a row on a name that
 * carries no choice.
 *
 * Two properties are load-bearing:
 *
 *   1. LAZINESS — `truncated` means NOT LISTED YET, not empty. A truncated
 *      folder can never be judged a single-child rung, or the nav would collapse
 *      a folder that turns out to hold twenty. Collapsing must also never
 *      require a fetch to discover a chain, since walking the content roots
 *      eagerly is the exact cost the lazy tree exists to avoid.
 *   2. SYMMETRY — drilling in past a skipped rung costs one click, so backing
 *      out must too, or the two directions disagree and the user is returned to
 *      a rung the nav never offered them.
 *
 * navigation-core.js is a browser ES module (also consumed by the Teams wiki via
 * the @nav-core alias), so it is evaluated here in a `vm` with the `export`
 * keywords stripped — the same approach spaceHomeResolution.test.js uses.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORE = path.resolve(
  __dirname,
  '../../../src/web/wiki/public/js/shared/navigation-core.js'
);

function loadCore() {
  const source = fs.readFileSync(CORE, 'utf8').replace(/^export\s+/gm, '');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'navigation-core.js' });
  return vm.runInContext(
    '({ isPassThroughRung, collapseChain, collapseAncestor, resolveDrill, hasVisibleChildren, MAX_CHAIN_SEGMENTS })',
    ctx
  );
}

const {
  isPassThroughRung,
  collapseChain,
  collapseAncestor,
  resolveDrill,
  hasVisibleChildren,
  MAX_CHAIN_SEGMENTS,
} = loadCore();

const folder = (name, parent, children = [], extra = {}) => ({
  name,
  path: parent ? `${parent}/${name}` : name,
  type: 'folder',
  children,
  ...extra,
});
const doc = (name, parent) => ({
  name,
  path: parent ? `${parent}/${name}` : name,
  type: 'document',
});

/**
 * The real Engineering Space shape: Solution Design holds eight folders, but
 * Commercial Services holds only Technology, which holds four.
 */
function buildTree() {
  const SD = 'Solution Design';
  const CS = `${SD}/Commercial Services`;
  const TECH = `${CS}/Technology`;

  const technology = folder('Technology', CS, [
    folder('Observability Platform (Datadog)', TECH, [], { truncated: true }),
    folder('Store Printer Data Collection', TECH, [], { truncated: true }),
    folder('Store Printer Fleet Management', TECH, [], { truncated: true }),
    folder('Utility Monitoring (IOT.nxt)', TECH, [], { truncated: true }),
  ]);

  const commercialServices = folder('Commercial Services', SD, [
    // The folder home is a DOTFILE: it draws no nav row, so it does not stop
    // the collapse. Its content stays reachable — Commercial Services is still
    // a clickable segment of the collapsed label.
    doc('.home.md', CS),
    technology,
  ]);

  const solutionDesign = folder('Solution Design', '', [
    folder('Application Landscapes', SD, [
      folder('Business Domain Landscapes', `${SD}/Application Landscapes`, [], { truncated: true }),
      folder('Interface Landscapes', `${SD}/Application Landscapes`, [], { truncated: true }),
    ]),
    commercialServices,
    folder('Data and Analytics', SD, [
      folder('Artificial Intelligence', `${SD}/Data and Analytics`, [], { truncated: true }),
      folder('Reporting', `${SD}/Data and Analytics`, [], { truncated: true }),
    ]),
  ]);

  // A four-deep run, for the segment cap.
  const archive = folder('Archive', '', [
    folder('2024', 'Archive', [
      folder('Q1', 'Archive/2024', [
        folder('January', 'Archive/2024/Q1', [doc('notes.md', 'Archive/2024/Q1/January')]),
      ]),
    ]),
  ]);

  return { tree: [solutionDesign, archive], solutionDesign, commercialServices, technology, archive };
}

describe('what counts as a pass-through rung', () => {
  test('one subfolder and a hidden home page IS a rung — the dotfile draws no row', () => {
    const { commercialServices } = buildTree();
    expect(isPassThroughRung(commercialServices)).toBe(true);
  });

  test('a VISIBLE document alongside the subfolder is NOT a rung', () => {
    // Collapsing past this would hide `home.md` behind a label claiming to be a
    // shortcut. The predicate matches what the nav renders, so it cannot
    // disagree with what is on screen.
    const node = folder('Commercial Services', 'Solution Design', [
      doc('home.md', 'Solution Design/Commercial Services'),
      folder('Technology', 'Solution Design/Commercial Services', []),
    ]);
    expect(isPassThroughRung(node)).toBe(false);
  });

  test('two subfolders is not a rung — there is a real choice to present', () => {
    const { solutionDesign } = buildTree();
    expect(isPassThroughRung(solutionDesign)).toBe(false);
  });

  test('a TRUNCATED folder is never a rung, however few children it appears to have', () => {
    // The lazy tree stopped walking here. "One child" is not known, and
    // guessing would collapse a folder that in fact holds twenty.
    const unlisted = folder('Unlisted', '', [], { truncated: true });
    expect(unlisted.children).toHaveLength(0);
    expect(isPassThroughRung(unlisted)).toBe(false);
  });
});

describe('collapsing a chain', () => {
  test('Commercial Services collapses onto Technology, keeping both real paths', () => {
    const { commercialServices, technology } = buildTree();
    const { terminal, segments, collapsed } = collapseChain(commercialServices);

    expect(collapsed).toBe(true);
    expect(terminal).toBe(technology);
    expect(segments.map(s => s.label)).toEqual(['Commercial Services', 'Technology']);
    // No synthetic path is invented — this is why pins, deep links, Share links
    // and notification topics keep working across the transform.
    expect(segments.map(s => s.path)).toEqual([
      'Solution Design/Commercial Services',
      'Solution Design/Commercial Services/Technology',
    ]);
  });

  test('a folder with real choices in it is left alone', () => {
    const { solutionDesign } = buildTree();
    const { terminal, segments, collapsed } = collapseChain(solutionDesign);

    expect(collapsed).toBe(false);
    expect(terminal).toBe(solutionDesign);
    expect(segments).toHaveLength(1);
  });

  test('the run stops at the segment cap rather than growing an unreadable label', () => {
    const { archive } = buildTree();
    const { segments, terminal } = collapseChain(archive);

    expect(MAX_CHAIN_SEGMENTS).toBe(3);
    expect(segments.map(s => s.label)).toEqual(['Archive', '2024', 'Q1']);
    expect(terminal.path).toBe('Archive/2024/Q1');
  });

  test('maxSegments is tunable', () => {
    const { archive } = buildTree();
    expect(collapseChain(archive, { maxSegments: 2 }).segments.map(s => s.label))
      .toEqual(['Archive', '2024']);
  });

  test('collapses INTO an unlisted folder but never walks past it', () => {
    // Wrapper's own children are known, so it is judged a rung; the folder it
    // collapses onto is truncated, which ends the walk WITHOUT a fetch. The
    // chain simply lengthens later, once drilling has filled the tree in.
    const deep = folder('Deep', 'Wrapper', [], { truncated: true });
    const wrapper = folder('Wrapper', '', [deep]);
    const { terminal, segments } = collapseChain(wrapper);

    expect(segments.map(s => s.label)).toEqual(['Wrapper', 'Deep']);
    expect(terminal).toBe(deep);
    // The row still offers a drill chevron: truncated means unlisted, not empty.
    expect(hasVisibleChildren(terminal)).toBe(true);
  });

  test('a folder linked onto itself does not spin', () => {
    // The content roots are directories of symlinked git repos and nothing
    // resolves real paths, so a self-referential link has to be survivable.
    const loop = { name: 'Loop', path: 'Loop', type: 'folder', children: [] };
    loop.children.push(loop);
    expect(() => collapseChain(loop)).not.toThrow();
    expect(collapseChain(loop).segments).toHaveLength(1);
  });
});

describe('backing out is the inverse of drilling in', () => {
  test('the rung skipped on the way in is skipped on the way out', () => {
    const { tree } = buildTree();
    // Standing in Technology, the immediate parent is Commercial Services —
    // a rung the nav never offered as a destination, so back must not land on it.
    expect(collapseAncestor(tree, 'Solution Design/Commercial Services')).toBe('Solution Design');
  });

  test('a parent with real content is kept', () => {
    const { tree } = buildTree();
    expect(collapseAncestor(tree, 'Solution Design')).toBe('Solution Design');
  });

  test('an unlisted ancestor is never skipped', () => {
    const tree = [folder('Unknown', '', [], { truncated: true })];
    expect(collapseAncestor(tree, 'Unknown')).toBe('Unknown');
  });

  test('round trip: drill in from Solution Design, back out to Solution Design', () => {
    const { tree } = buildTree();
    const view = resolveDrill(tree, 'Engineering Space', 'Solution Design', { collapseChains: true });
    const row = view.rows.find(r => r.chain);

    // One click in…
    const destination = row.node.path;
    expect(destination).toBe('Solution Design/Commercial Services/Technology');

    // …and one click back out lands where it started, not on the skipped rung.
    const back = resolveDrill(tree, 'Engineering Space', destination, { collapseChains: true });
    expect(back.parentPath).toBe('Solution Design');
    expect(back.parentLabel).toBe('Solution Design');
  });
});

describe('resolveDrill wiring', () => {
  test('the collapsed row stands for the TERMINAL folder', () => {
    const { tree } = buildTree();
    const view = resolveDrill(tree, 'Engineering Space', 'Solution Design', { collapseChains: true });
    const row = view.rows.find(r => r.chain);

    // Its click target, chevron and (in the renderer) drop target all describe
    // Technology, because that is the folder whose contents the row shows.
    expect(row.node.name).toBe('Technology');
    expect(row.hasChildren).toBe(true);
    expect(row.chain.map(s => s.label)).toEqual(['Commercial Services', 'Technology']);

    // The rest of the level is untouched.
    const plain = view.rows.filter(r => r.kind === 'folder' && !r.chain);
    expect(plain.map(r => r.node.name).sort())
      .toEqual(['Application Landscapes', 'Data and Analytics']);
  });

  test('OFF by default, so an un-migrated renderer sees the old shape', () => {
    const { tree } = buildTree();
    const view = resolveDrill(tree, 'Engineering Space', 'Solution Design');

    expect(view.rows.every(r => r.chain === null)).toBe(true);
    expect(view.rows.find(r => r.node.name === 'Commercial Services')).toBeTruthy();
    expect(view.parentPath).toBe('');
  });

  test('a root group header is never collapsed — its children already show beneath it', () => {
    // At the space root the view prints two levels: each top folder as a group
    // header with its own children on the rows below. Collapsing the header
    // would say the same thing twice and orphan the inlined rows.
    const { tree } = buildTree();
    const view = resolveDrill(tree, 'Engineering Space', '', { collapseChains: true });

    const archiveHeader = view.rows.find(r => r.isGroup && r.node.name === 'Archive');
    expect(archiveHeader).toBeTruthy();
    expect(archiveHeader.chain).toBeNull();

    // Its level-1 children still collapse (Archive's own child, not Solution
    // Design's — both groups contribute level-1 rows to this one flat list).
    // The run starts a rung lower here than it did from `Archive` itself, so
    // the same folders fit under the cap and reach January. The cap is a
    // per-ROW readability budget, not a claim about the tree.
    const nested = view.rows.find(r => r.level === 1 && r.chain && r.chain[0].label === '2024');
    expect(nested.chain.map(s => s.label)).toEqual(['2024', 'Q1', 'January']);
    expect(nested.node.path).toBe('Archive/2024/Q1/January');
  });

  test('the level-1 row under Solution Design collapses at the root view too', () => {
    const { tree } = buildTree();
    const view = resolveDrill(tree, 'Engineering Space', '', { collapseChains: true });
    const row = view.rows.find(r => r.level === 1 && r.chain && r.chain[0].label === 'Commercial Services');

    expect(row.node.path).toBe('Solution Design/Commercial Services/Technology');
  });
});
