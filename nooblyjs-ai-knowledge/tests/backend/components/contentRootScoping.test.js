/**
 * @fileoverview Space scoping is by CONTENT ROOT, not by space name.
 *
 * Regression cover for a live outage: `GET /search?q=…&spaceId=1` (Engineering
 * Space) returned nothing for every query, and paid a full-corpus disk walk to
 * do it. Four spaces share `knowledge-content/engineering`; the indexer walks a
 * root once and stamps every document with the LAST space on it (Retail), so
 * a filter built from the requested space's own name matched zero hits in three
 * of the four spaces.
 *
 * These assertions pin the contract the fix depends on: spaces that read the
 * same directory are interchangeable for the purpose of "which index entries
 * belong to me", while what each space may SEE stays with spaceVisibility.
 */

'use strict';

const {
    contentRootKey,
    spacesSharingRoot,
    equivalentSpaceNames
} = require('../../../src/shared/spaces/contentRoot');

/** The live arrangement that produced the outage. */
const SPACES = [
    { id: 1, name: 'Engineering Space', path: '../knowledge-content/engineering' },
    { id: 2, name: 'Financial Services Space', path: '../knowledge-content/engineering' },
    { id: 3, name: 'People Space', path: '../knowledge-content/engineering' },
    { id: 5, name: 'Retail Space', path: '../knowledge-content/engineering' },
    { id: 9, name: 'Other Space', path: '../knowledge-content/other' }
];

describe('contentRootKey', () => {
    test('spaces on the same directory share a key', () => {
        expect(contentRootKey(SPACES[0])).toBe(contentRootKey(SPACES[3]));
    });

    test('a different directory is a different key', () => {
        expect(contentRootKey(SPACES[0])).not.toBe(contentRootKey(SPACES[4]));
    });

    test('case and trailing separators do not split a root — the content is on Windows', () => {
        const a = { id: 1, name: 'A', path: 'C:\\work\\Content\\Engineering' };
        const b = { id: 2, name: 'B', path: 'c:/work/content/engineering/' };
        expect(contentRootKey(a)).toBe(contentRootKey(b));
    });

    test('reads the legacy configuration.filing.baseDir location too', () => {
        const legacy = { id: 7, name: 'Legacy', configuration: { filing: { baseDir: '../knowledge-content/engineering' } } };
        expect(contentRootKey(legacy)).toBe(contentRootKey(SPACES[0]));
    });

    test('a space with no root gets a key unique to itself, never a shared empty one', () => {
        const x = { id: 11, name: 'X' };
        const y = { id: 12, name: 'Y' };
        expect(contentRootKey(x)).toBe('space:11');
        expect(contentRootKey(x)).not.toBe(contentRootKey(y));
    });
});

describe('spacesSharingRoot', () => {
    test('returns every lens over the same directory, including the space itself', () => {
        const names = spacesSharingRoot(SPACES[0], SPACES).map(s => s.name);
        expect(names).toEqual([
            'Engineering Space',
            'Financial Services Space',
            'People Space',
            'Retail Space'
        ]);
    });

    test('a space alone on its root returns just itself', () => {
        expect(spacesSharingRoot(SPACES[4], SPACES).map(s => s.name)).toEqual(['Other Space']);
    });
});

describe('equivalentSpaceNames', () => {
    test('THE FIX: asking for Engineering Space accepts the Retail stamp the indexer wrote', () => {
        const names = equivalentSpaceNames([SPACES[0]], SPACES);
        expect(names.has('Retail Space')).toBe(true);
        expect(names.has('Engineering Space')).toBe(true);
    });

    test('scoping still excludes a genuinely different content root', () => {
        const names = equivalentSpaceNames([SPACES[0]], SPACES);
        expect(names.has('Other Space')).toBe(false);
    });

    test('nothing requested means no filter — not a filter that matches nothing', () => {
        expect(equivalentSpaceNames([], SPACES).size).toBe(0);
    });

    test('a name unknown to spaces.json still filters on itself rather than widening the search', () => {
        const names = equivalentSpaceNames([{ name: 'Renamed Away' }], SPACES);
        expect([...names]).toEqual(['Renamed Away']);
    });

    test('several requested spaces union their roots', () => {
        const names = equivalentSpaceNames([SPACES[0], SPACES[4]], SPACES);
        expect(names.has('Retail Space')).toBe(true);
        expect(names.has('Other Space')).toBe(true);
        expect(names.size).toBe(5);
    });
});
