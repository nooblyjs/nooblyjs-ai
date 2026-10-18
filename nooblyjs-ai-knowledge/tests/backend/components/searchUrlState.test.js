'use strict';

/**
 * @fileoverview Search deep links — the URL is the whole state of a search view.
 *
 * A search that cannot be linked to cannot be shared, so `parseSearchUrl` and
 * `buildSearchUrl` are an exact inverse pair: whatever the UI writes when you
 * pick facets and a view must come back as the same selections when someone
 * pastes the link. These tests pin that round trip, plus the three details that
 * are easy to get wrong and silently degrade a link:
 *
 *   1. MULTI-VALUE FACETS. Facet values are folder and file names, so they can
 *      contain commas — the values are repeated parameters, never a delimited
 *      list, and a delimiter creeping back in would split "Sales, Marketing"
 *      into two selections that match nothing.
 *   2. THE `list`/`details` SPLIT. The toggle button says "List" but every
 *      consumer stores `details`. A URL is written the way a user would say it,
 *      so the translation has to survive both directions.
 *   3. FOREIGN PARAMETERS. `?embed=1` (Teams shell) and `?sharedBy=` (share
 *      links) ride on the same query string. Rewriting the search must not eat
 *      them, and clearing a facet must not leave a stale copy behind.
 *
 * search-url.js is a browser ES module, so it is evaluated here in a `vm` with
 * the `export` keywords stripped — the same approach navigation-core.js and the
 * markdown parser are tested with.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = path.resolve(
  __dirname,
  '../../../src/web/wiki/public/js/shared/search-url.js'
);

function loadModule() {
  const source = fs.readFileSync(MODULE, 'utf8').replace(/^export\s+/gm, '');
  const ctx = { console, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'search-url.js' });
  return vm.runInContext(
    '({ parseSearchUrl, buildSearchUrl, normaliseViewMode, FACET_PARAMS })',
    ctx
  );
}

const { parseSearchUrl, buildSearchUrl, normaliseViewMode, FACET_PARAMS } = loadModule();

/** Parse a query string into { param: [values] } for order-independent asserts. */
function paramsOf(qs) {
  const out = {};
  for (const [k, v] of new URLSearchParams(qs)) (out[k] = out[k] || []).push(v);
  return out;
}

describe('normaliseViewMode', () => {
  test('maps the word on the button to the value the code stores', () => {
    // The toggle reads "List"; every consumer stores 'details'.
    expect(normaliseViewMode('list')).toBe('details');
  });

  test('the other three modes pass through unchanged', () => {
    expect(normaliseViewMode('grid')).toBe('grid');
    expect(normaliseViewMode('feature')).toBe('feature');
    expect(normaliseViewMode('cards')).toBe('cards');
  });

  test("accepts 'details' too, so an internally-generated link still resolves", () => {
    expect(normaliseViewMode('details')).toBe('details');
  });

  test('is case- and whitespace-insensitive — links get hand-edited', () => {
    expect(normaliseViewMode('  GRID ')).toBe('grid');
    expect(normaliseViewMode('Cards')).toBe('cards');
  });

  test('an unknown mode yields null so the caller keeps its default', () => {
    // Returning a bogus mode would render an empty list for a typo.
    expect(normaliseViewMode('tiles')).toBeNull();
    expect(normaliseViewMode('')).toBeNull();
    expect(normaliseViewMode(undefined)).toBeNull();
  });
});

describe('parseSearchUrl', () => {
  test('a URL without q is not a search, so the caller shows what it meant to', () => {
    expect(parseSearchUrl('')).toBeNull();
    expect(parseSearchUrl('?view=grid')).toBeNull();
    expect(parseSearchUrl('?embed=1&sharedBy=a@b.com')).toBeNull();
  });

  test('a blank or whitespace-only q is not a search either', () => {
    expect(parseSearchUrl('?q=')).toBeNull();
    expect(parseSearchUrl('?q=%20%20')).toBeNull();
  });

  test('reads the query, view and folder scope', () => {
    const s = parseSearchUrl('?q=oracle&view=grid&folder=Solution%20Design/Buy');
    expect(s.query).toBe('oracle');
    expect(s.view).toBe('grid');
    expect(s.folderPath).toBe('Solution Design/Buy');
  });

  test('every facet is present as an array, selected or not', () => {
    const s = parseSearchUrl('?q=x');
    expect(Object.keys(s.facets).sort()).toEqual(
      Object.keys(FACET_PARAMS).sort()
    );
    for (const key of Object.keys(FACET_PARAMS)) expect(s.facets[key]).toEqual([]);
  });

  test('a repeated parameter becomes multiple selections on that facet', () => {
    const s = parseSearchUrl('?q=x&type=Home&type=Design&folder1=Solution%20Design');
    expect(s.facets.docType).toEqual(['Home', 'Design']);
    expect(s.facets.folderL1).toEqual(['Solution Design']);
  });

  test('a value containing a comma survives — values are names, not a list', () => {
    // The reason facets repeat the parameter instead of joining with a delimiter.
    const s = parseSearchUrl('?q=x&folder1=' + encodeURIComponent('Sales, Marketing'));
    expect(s.facets.folderL1).toEqual(['Sales, Marketing']);
  });

  test('duplicate and blank values in a hand-edited link are cleaned up', () => {
    const s = parseSearchUrl('?q=x&type=Home&type=Home&type=&type=%20');
    expect(s.facets.docType).toEqual(['Home']);
  });

  test('an unknown view is dropped rather than honoured', () => {
    expect(parseSearchUrl('?q=x&view=tiles').view).toBeNull();
  });
});

describe('buildSearchUrl', () => {
  test('a bare query produces a short, readable link', () => {
    expect(buildSearchUrl({ query: 'oracle' })).toBe('?q=oracle');
  });

  test('no query means no search parameters at all', () => {
    expect(buildSearchUrl({ query: '' })).toBe('');
    expect(buildSearchUrl({ query: '   ' })).toBe('');
  });

  test('writes the view as the word a user would say', () => {
    expect(paramsOf(buildSearchUrl({ query: 'x', view: 'details' })).view).toEqual(['list']);
    expect(paramsOf(buildSearchUrl({ query: 'x', view: 'grid' })).view).toEqual(['grid']);
  });

  test('an unset or unknown view is omitted, not guessed', () => {
    expect(paramsOf(buildSearchUrl({ query: 'x' })).view).toBeUndefined();
    expect(paramsOf(buildSearchUrl({ query: 'x', view: 'nonsense' })).view).toBeUndefined();
  });

  test('accepts Sets, which is what the controller holds facets in', () => {
    const qs = buildSearchUrl({
      query: 'x',
      facets: { docType: new Set(['Home', 'Design']), folderL1: new Set() }
    });
    expect(paramsOf(qs).type).toEqual(['Home', 'Design']);
    expect(paramsOf(qs).folder1).toBeUndefined();
  });

  test('empty facet values are skipped rather than written as blanks', () => {
    const qs = buildSearchUrl({ query: 'x', facets: { docType: ['', '  ', 'Home'] } });
    expect(paramsOf(qs).type).toEqual(['Home']);
  });
});

describe('foreign parameters on the same URL', () => {
  test('parameters this module does not own are preserved', () => {
    // ?embed=1 is the Teams shell's; ?sharedBy= belongs to share links.
    const qs = buildSearchUrl({ query: 'oracle' }, '?embed=1&sharedBy=a%40b.com');
    const p = paramsOf(qs);
    expect(p.embed).toEqual(['1']);
    expect(p.sharedBy).toEqual(['a@b.com']);
    expect(p.q).toEqual(['oracle']);
  });

  test('they survive even when the search is cleared', () => {
    expect(paramsOf(buildSearchUrl({ query: '' }, '?embed=1')).embed).toEqual(['1']);
  });

  test('deselecting the last value of a facet removes it from the URL', () => {
    // The stale-parameter bug: rewriting without clearing first would leave the
    // old selection behind and the link would reproduce a filter nobody set.
    const before = buildSearchUrl({ query: 'x', facets: { docType: ['Home'] } });
    expect(paramsOf(before).type).toEqual(['Home']);

    const after = buildSearchUrl({ query: 'x', facets: { docType: [] } }, before);
    expect(paramsOf(after).type).toBeUndefined();
  });

  test('changing the query does not accumulate old ones', () => {
    const first = buildSearchUrl({ query: 'oracle' });
    const second = buildSearchUrl({ query: 'mysql' }, first);
    expect(paramsOf(second).q).toEqual(['mysql']);
  });
});

describe('round trip', () => {
  const STATE = {
    query: 'oracle mysql',
    facets: {
      space: ['Engineering'],
      folderL1: ['Solution Design'],
      folderL2: [],
      docType: ['Home', 'Design']
    },
    view: 'details',
    folderPath: 'Solution Design/Entreprise Technology/Buy'
  };

  test('what the UI writes is what a pasted link restores', () => {
    const parsed = parseSearchUrl(buildSearchUrl(STATE));
    expect(parsed.query).toBe(STATE.query);
    expect(parsed.view).toBe(STATE.view);
    expect(parsed.folderPath).toBe(STATE.folderPath);
    expect(parsed.facets).toEqual(STATE.facets);
  });

  test('is stable — rebuilding from the parsed state changes nothing', () => {
    const once = buildSearchUrl(STATE);
    const twice = buildSearchUrl(parseSearchUrl(once));
    expect(twice).toBe(once);
  });

  test('a quoted phrase survives the trip intact', () => {
    // Quoted phrases are exact-adjacency searches; mangling the quotes would
    // silently turn one into a loose word match.
    const parsed = parseSearchUrl(buildSearchUrl({ query: '"Oracle MySQL"' }));
    expect(parsed.query).toBe('"Oracle MySQL"');
  });

  test('a query with & and = survives', () => {
    const parsed = parseSearchUrl(buildSearchUrl({ query: 'a&b=c' }));
    expect(parsed.query).toBe('a&b=c');
  });
});
