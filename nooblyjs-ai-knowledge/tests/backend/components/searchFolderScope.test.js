/**
 * @fileoverview Tests for the folder-scope path helpers used by the search
 * indexer to constrain results (and AI chat sources) to a folder subtree.
 *
 * The matcher must be separator-agnostic — indexed paths come from path.relative(),
 * which emits backslashes on Windows, while the UI sends forward-slash paths — and
 * segment-aware, so "services" never matches a sibling like "services-archive".
 */

'use strict';

const SearchIndexer = require('../../../src/wiki/activities/searchIndexer');
const { normalizePathPrefix, isUnderPathPrefix } = SearchIndexer;

describe('normalizePathPrefix', () => {
  test('returns empty for falsy input (whole-wiki scope)', () => {
    expect(normalizePathPrefix('')).toBe('');
    expect(normalizePathPrefix(null)).toBe('');
    expect(normalizePathPrefix(undefined)).toBe('');
  });

  test('flattens backslashes and trims leading/trailing slashes', () => {
    expect(normalizePathPrefix('business-processes\\services')).toBe('business-processes/services');
    expect(normalizePathPrefix('/business-processes/')).toBe('business-processes');
    expect(normalizePathPrefix('\\a\\b\\')).toBe('a/b');
  });
});

describe('isUnderPathPrefix', () => {
  const prefix = normalizePathPrefix('business-processes');

  test('empty prefix matches everything (no scope)', () => {
    expect(isUnderPathPrefix('anything/at/all.md', '')).toBe(true);
  });

  test('matches the folder home and nested files', () => {
    expect(isUnderPathPrefix('business-processes/.home.md', prefix)).toBe(true);
    expect(isUnderPathPrefix('business-processes/services/auth.md', prefix)).toBe(true);
    // exact folder path itself counts as "under"
    expect(isUnderPathPrefix('business-processes', prefix)).toBe(true);
  });

  test('matches Windows-separator indexed paths against a forward-slash prefix', () => {
    expect(isUnderPathPrefix('business-processes\\services\\auth.md', prefix)).toBe(true);
  });

  test('is segment-aware — a sibling with the same prefix string does not match', () => {
    expect(isUnderPathPrefix('business-processes-archive/old.md', prefix)).toBe(false);
  });

  test('rejects files in other folders', () => {
    expect(isUnderPathPrefix('product-design/spec.md', prefix)).toBe(false);
  });

  test('handles a nested prefix', () => {
    const nested = normalizePathPrefix('business-processes/services');
    expect(isUnderPathPrefix('business-processes/services/steps/run.md', nested)).toBe(true);
    expect(isUnderPathPrefix('business-processes/tests/a.md', nested)).toBe(false);
  });
});
