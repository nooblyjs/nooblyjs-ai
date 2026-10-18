/**
 * @fileoverview Tests for per-space path visibility (allowedPaths/excludedPaths).
 *
 * The fixture mirrors the REAL Retail space and the real
 * `knowledge-content/engineering` tree it is a lens over, because the whole
 * feature exists to make those two spaces show different slices of one
 * content root. Keep it in step with `.application/spaces/spaces.json`.
 */

'use strict';

const {
  compileVisibility,
  normaliseRule,
  normalisePath
} = require('../../../src/shared/spaces/spaceVisibility');

/** The Retail space, as configured. */
const RETAIL = {
  name: 'Retail Collaboration Space',
  configuration: {
    allowedPaths: [
      'Solution Design/Distribution/*',
      'Standards/*',
      'Product Management/Media Rewards Insights/*'
    ],
    excludedPaths: ['Solution Design/Distribution/Technology/*']
  }
};

/** An unrestricted space (no rules at all). */
const ENGINEERING = { name: 'Engineering Collaboration Space', configuration: {} };

const folder = (name, path, children = []) => ({ type: 'folder', name, path, children });
const doc = (name, path) => ({ type: 'document', name, path });

/** Abridged shape of the real engineering content root. */
function engineeringTree() {
  return [
    folder('Application Design', 'Application Design', [doc('Overview.md', 'Application Design/Overview.md')]),
    folder('Business Processes', 'Business Processes', [doc('ARIS.md', 'Business Processes/ARIS.md')]),
    folder('Infrastructure Design', 'Infrastructure Design', []),
    folder('Product Management', 'Product Management', [
      folder('Computicket', 'Product Management/Computicket', [doc('a.md', 'Product Management/Computicket/a.md')]),
      folder('Media Rewards Insights', 'Product Management/Media Rewards Insights', [
        doc('Roadmap.md', 'Product Management/Media Rewards Insights/Roadmap.md')
      ]),
      doc('index.md', 'Product Management/index.md')
    ]),
    folder('Solution Design', 'Solution Design', [
      folder('Commercial Services', 'Solution Design/Commercial Services', []),
      folder('Distribution', 'Solution Design/Distribution', [
        folder('Sell', 'Solution Design/Distribution/Sell', [
          doc('Checkout.md', 'Solution Design/Distribution/Sell/Checkout.md')
        ]),
        folder('Technology', 'Solution Design/Distribution/Technology', [
          doc('Secret.md', 'Solution Design/Distribution/Technology/Secret.md')
        ]),
        doc('home.md', 'Solution Design/Distribution/home.md')
      ]),
      doc('notes.md', 'Solution Design/notes.md')
    ]),
    folder('Standards', 'Standards', [
      folder('Architecture Framework', 'Standards/Architecture Framework', [
        doc('TOGAF.md', 'Standards/Architecture Framework/TOGAF.md')
      ]),
      doc('Principles.pdf', 'Standards/Principles.pdf')
    ]),
    doc('home.md', 'home.md')
  ];
}

/** Collect every surviving path, depth first, for readable assertions. */
function paths(nodes, out = []) {
  for (const node of nodes) {
    out.push(node.path);
    if (node.children) paths(node.children, out);
  }
  return out;
}

describe('spaceVisibility - rule normalisation', () => {
  test('every spelling of a subtree root compiles identically', () => {
    expect(normaliseRule('Standards')).toBe('standards');
    expect(normaliseRule('Standards/')).toBe('standards');
    expect(normaliseRule('Standards/*')).toBe('standards');
    expect(normaliseRule('Standards/**')).toBe('standards');
    expect(normaliseRule('/Standards/')).toBe('standards');
    expect(normaliseRule('./Standards')).toBe('standards');
    expect(normaliseRule('Standards\\Sub')).toBe('standards/sub');
  });

  test('a bare wildcard is a placeholder, not a rule', () => {
    expect(normaliseRule('*')).toBe('');
    expect(normaliseRule('**')).toBe('');
  });

  test('normalisePath matches the rule namespace', () => {
    expect(normalisePath('Solution Design\\Distribution'))
      .toBe('solution design/distribution');
    expect(normalisePath('/a/b/')).toBe('a/b');
  });
});

describe('spaceVisibility - unrestricted spaces', () => {
  test('a space with no rules sees everything', () => {
    const v = compileVisibility(ENGINEERING);
    expect(v.restricted).toBe(false);
    expect(v.isFileVisible('Business Processes/ARIS.md')).toBe(true);
    expect(v.isFolderVisible('Business Processes')).toBe(true);
    expect(paths(v.filterTree(engineeringTree()))).toEqual(paths(engineeringTree()));
  });

  test('placeholder wildcard lists fail OPEN, they do not blank the space', () => {
    // This is the exact shape spaces 1-3 shipped with. Read literally,
    // excludedPaths:["*"] would hide every document in those spaces.
    const v = compileVisibility({
      configuration: { allowedPaths: ['*'], excludedPaths: ['*'] }
    });
    expect(v.restricted).toBe(false);
    expect(v.isFileVisible('Business Processes/ARIS.md')).toBe(true);
    expect(v.filterTree(engineeringTree()).length).toBe(engineeringTree().length);
  });
});

describe('spaceVisibility - Retail lens over the engineering root', () => {
  const v = compileVisibility(RETAIL);

  test('the space is recognised as restricted', () => {
    expect(v.restricted).toBe(true);
  });

  test('allowed subtrees are visible all the way down', () => {
    expect(v.isFolderVisible('Standards')).toBe(true);
    expect(v.isFolderVisible('Standards/Architecture Framework')).toBe(true);
    expect(v.isFileVisible('Standards/Architecture Framework/TOGAF.md')).toBe(true);
    expect(v.isFileVisible('Solution Design/Distribution/Sell/Checkout.md')).toBe(true);
    expect(v.isFileVisible('Product Management/Media Rewards Insights/Roadmap.md')).toBe(true);
  });

  test('unlisted siblings are hidden', () => {
    expect(v.isFolderVisible('Business Processes')).toBe(false);
    expect(v.isFileVisible('Business Processes/ARIS.md')).toBe(false);
    expect(v.isFolderVisible('Solution Design/Commercial Services')).toBe(false);
    expect(v.isFileVisible('Product Management/Computicket/a.md')).toBe(false);
  });

  test('excludedPaths beats allowedPaths inside an allowed subtree', () => {
    expect(v.isFolderVisible('Solution Design/Distribution')).toBe(true);
    expect(v.isFolderVisible('Solution Design/Distribution/Technology')).toBe(false);
    expect(v.isFileVisible('Solution Design/Distribution/Technology/Secret.md')).toBe(false);
  });

  test('an ancestor is a pass-through container, not a visible folder', () => {
    expect(v.isContainer('Solution Design')).toBe(true);
    expect(v.isFolderVisible('Solution Design')).toBe(false);
    expect(v.isFolderAccessible('Solution Design')).toBe(true);
    // ...and its own loose files stay hidden
    expect(v.isFileVisible('Solution Design/notes.md')).toBe(false);
    expect(v.isFileVisible('Product Management/index.md')).toBe(false);
  });

  test('the space landing page survives the filter', () => {
    expect(v.isFileVisible('home.md')).toBe(true);
    expect(v.isFileVisible('.home.md')).toBe(true);
  });

  test('space-scoped plumbing stays reachable', () => {
    expect(v.isFileVisible('.system/templates/blank.md')).toBe(true);
    expect(v.isFileVisible('.system/useractivity/srb/templates/x.md')).toBe(true);
  });

  test('plumbing inherits its owning folder, so it is not a back door', () => {
    expect(v.isFileVisible('Solution Design/Distribution/.system/context/_folder.md')).toBe(true);
    expect(v.isFileVisible('Standards/.system/derived/Principles.pdf.md')).toBe(true);
    // The reason the exemption is scoped rather than blanket:
    expect(v.isFileVisible('Business Processes/.system/originals/Secret.docx')).toBe(false);
    expect(v.isFileVisible('Solution Design/Distribution/Technology/.system/context/x.md')).toBe(false);
  });

  test('matching is case-insensitive and separator-agnostic', () => {
    expect(v.isFileVisible('STANDARDS/Architecture Framework/TOGAF.md')).toBe(true);
    expect(v.isFileVisible('Standards\\Architecture Framework\\TOGAF.md')).toBe(true);
    expect(v.isFolderVisible('business processes')).toBe(false);
  });

  test('a prefix that is not a path boundary does not match', () => {
    // "Standards" must not swallow "Standards Archive"
    expect(v.isFolderVisible('Standards Archive')).toBe(false);
    expect(v.isFileVisible('Standards Archive/old.md')).toBe(false);
  });
});

describe('spaceVisibility - tree filtering', () => {
  const v = compileVisibility(RETAIL);
  const kept = paths(v.filterTree(engineeringTree()));

  test('produces exactly the curated nav', () => {
    expect(kept).toEqual([
      'Product Management',
      'Product Management/Media Rewards Insights',
      'Product Management/Media Rewards Insights/Roadmap.md',
      'Solution Design',
      'Solution Design/Distribution',
      'Solution Design/Distribution/Sell',
      'Solution Design/Distribution/Sell/Checkout.md',
      'Solution Design/Distribution/home.md',
      'Standards',
      'Standards/Architecture Framework',
      'Standards/Architecture Framework/TOGAF.md',
      'Standards/Principles.pdf',
      'home.md'
    ]);
  });

  test('the carve-out is gone from the tree', () => {
    expect(kept).not.toContain('Solution Design/Distribution/Technology');
    expect(kept).not.toContain('Solution Design/Distribution/Technology/Secret.md');
  });

  test('an empty container is dropped rather than left as a dead end', () => {
    const v2 = compileVisibility({
      configuration: { allowedPaths: ['Solution Design/Nonexistent'] }
    });
    expect(paths(v2.filterTree(engineeringTree()))).toEqual(['home.md']);
  });

  test('filtering does not mutate the caller\'s tree', () => {
    const original = engineeringTree();
    const before = paths(original).length;
    v.filterTree(original);
    expect(paths(original).length).toBe(before);
  });
});

describe('spaceVisibility - directory listings', () => {
  const v = compileVisibility(RETAIL);

  test('filters a root listing to containers and allowed roots', () => {
    const entries = [
      { name: 'Business Processes', isDirectory: true },
      { name: 'Solution Design', isDirectory: true },
      { name: 'Standards', isDirectory: true },
      { name: 'home.md', isDirectory: false }
    ];
    expect(v.filterEntries('', entries).map(e => e.name))
      .toEqual(['Solution Design', 'Standards', 'home.md']);
  });

  test('filters inside a container to just the allowed child', () => {
    const entries = [
      { name: 'Commercial Services', isDirectory: true },
      { name: 'Distribution', isDirectory: true },
      { name: 'notes.md', isDirectory: false }
    ];
    expect(v.filterEntries('Solution Design', entries).map(e => e.name))
      .toEqual(['Distribution']);
  });

  test('drops the carve-out from a listing of an allowed folder', () => {
    const entries = [
      { name: 'Sell', isDirectory: true },
      { name: 'Technology', isDirectory: true },
      { name: 'home.md', isDirectory: false }
    ];
    expect(v.filterEntries('Solution Design/Distribution', entries).map(e => e.name))
      .toEqual(['Sell', 'home.md']);
  });

  test('handles bare-string entries from the filing service', () => {
    expect(v.filterEntries('', ['Standards', 'Business Processes']))
      .toEqual(['Standards']);
  });
});
